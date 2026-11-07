use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::connection::check_endpoint;
use crate::process::{hidden_command, run};
use crate::providers::{Group, Provider, providers};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(8);
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(6);
const SHELL_TIMEOUT: Duration = Duration::from_secs(3);
const PATH_MARKER: &str = "__DAVIS_PATH__";
const BINARY_SUFFIXES: &[&str] = if cfg!(windows) {
    &[".exe", ".cmd", ".bat"]
} else {
    &[""]
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: Option<String>,
    pub plan: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: String,
    pub installed: bool,
    pub signed_in: Option<bool>,
    pub account: Option<Account>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    pub os: &'static str,
    pub apps: Vec<AppStatus>,
    pub local_servers: Vec<String>,
    pub has_npm: bool,
}

pub fn detect() -> Detected {
    let folders = search_folders();
    let folders = folders.as_slice();
    thread::scope(|scope| {
        let apps: Vec<_> = providers()
            .iter()
            .filter(|provider| provider.group == Group::App)
            .map(|provider| scope.spawn(move || check_app(provider, folders)))
            .collect();
        let servers: Vec<_> = providers()
            .iter()
            .filter(|provider| provider.group == Group::Local)
            .map(|provider| {
                scope.spawn(|| {
                    check_endpoint(provider, None, None)
                        .ok()
                        .map(|()| provider.id.clone())
                })
            })
            .collect();

        Detected {
            os: env::consts::OS,
            apps: apps
                .into_iter()
                .filter_map(|app| app.join().ok())
                .filter(|app| app.installed)
                .collect(),
            local_servers: servers
                .into_iter()
                .filter_map(|server| server.join().ok().flatten())
                .collect(),
            has_npm: find_binary("npm", folders).is_some(),
        }
    })
}

pub(crate) fn check_app(provider: &Provider, folders: &[PathBuf]) -> AppStatus {
    let binary = provider
        .binary
        .as_deref()
        .and_then(|name| find_binary(name, folders));
    let Some(binary) = binary else {
        return AppStatus {
            id: provider.id.clone(),
            installed: false,
            signed_in: None,
            account: None,
        };
    };

    let (signed_in, account) = match provider.id.as_str() {
        "claude-code" => check_claude(&binary),
        "codex" => check_codex(&binary),
        "opencode" => check_opencode(&binary),
        _ => (None, None),
    };

    AppStatus {
        id: provider.id.clone(),
        installed: true,
        signed_in,
        account,
    }
}

fn check_claude(binary: &Path) -> (Option<bool>, Option<Account>) {
    let Some(output) = run(binary, &["auth", "status"], COMMAND_TIMEOUT) else {
        return (None, None);
    };
    if !output.status.success() {
        return (Some(false), None);
    }
    (
        Some(true),
        parse_claude_status(&String::from_utf8_lossy(&output.stdout)),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeStatus {
    email: Option<String>,
    subscription_type: Option<String>,
}

fn parse_claude_status(text: &str) -> Option<Account> {
    let status: ClaudeStatus = serde_json::from_str(text).ok()?;
    Some(Account {
        email: status.email,
        plan: status.subscription_type,
    })
}

fn check_opencode(binary: &Path) -> (Option<bool>, Option<Account>) {
    let Some(output) = run(binary, &["auth", "list"], COMMAND_TIMEOUT) else {
        return (None, None);
    };
    let count = credential_count(&String::from_utf8_lossy(&output.stdout));
    (count.map(|count| count > 0), None)
}

fn credential_count(text: &str) -> Option<u32> {
    let words: Vec<&str> = text.split_whitespace().collect();
    words.windows(2).find_map(|pair| {
        pair[1]
            .starts_with("credential")
            .then(|| pair[0].parse().ok())
            .flatten()
    })
}

fn check_codex(binary: &Path) -> (Option<bool>, Option<Account>) {
    let Some(output) = run(binary, &["login", "status"], COMMAND_TIMEOUT) else {
        return (None, None);
    };
    if !output.status.success() {
        return (Some(false), None);
    }
    (Some(true), read_codex_account(binary))
}

// `app-server` is marked experimental, so a failure here only loses the account details.
fn read_codex_account(binary: &Path) -> Option<Account> {
    let mut child = hidden_command(binary)
        .arg("app-server")
        .current_dir(env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;

    let requests = concat!(
        r#"{"id":1,"method":"initialize","params":{"clientInfo":{"name":"davis","title":"Davis","version":"0.1.0"}}}"#,
        "\n",
        r#"{"method":"initialized"}"#,
        "\n",
        r#"{"id":2,"method":"account/read","params":{"refreshToken":false}}"#,
        "\n",
    );
    let written = stdin
        .write_all(requests.as_bytes())
        .and_then(|()| stdin.flush());

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + ACCOUNT_TIMEOUT;
    let mut account = None;
    while written.is_ok() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(line) = receiver.recv_timeout(remaining) else {
            break;
        };
        if let Some(found) = parse_codex_account(&line) {
            account = found;
            break;
        }
    }

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    account
}

#[derive(Deserialize)]
struct CodexResponse {
    id: Option<u64>,
    result: Option<CodexResult>,
}

#[derive(Deserialize)]
struct CodexResult {
    account: Option<CodexAccount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAccount {
    email: Option<String>,
    plan_type: Option<String>,
}

fn parse_codex_account(line: &str) -> Option<Option<Account>> {
    let response: CodexResponse = serde_json::from_str(line).ok()?;
    if response.id != Some(2) {
        return None;
    }
    Some(
        response
            .result
            .and_then(|result| result.account)
            .filter(|account| account.email.is_some())
            .map(|account| Account {
                email: account.email,
                plan: account.plan_type,
            }),
    )
}

pub(crate) fn find_binary(name: &str, folders: &[PathBuf]) -> Option<PathBuf> {
    find_with_suffixes(name, folders, BINARY_SUFFIXES)
}

fn find_with_suffixes(name: &str, folders: &[PathBuf], suffixes: &[&str]) -> Option<PathBuf> {
    folders.iter().find_map(|folder| {
        suffixes
            .iter()
            .map(|suffix| folder.join(format!("{name}{suffix}")))
            .find(|candidate| candidate.is_file())
    })
}

// Read fresh each time, because an installer can add a new folder to the shell's PATH.
pub(crate) fn search_folders() -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default();
    folders.extend(login_shell_path());
    folders.extend(common_folders());
    folders
}

// Desktop apps on macOS start with a minimal PATH that omits Homebrew and user tools.
fn login_shell_path() -> Vec<PathBuf> {
    let Some(shell) = env::var_os("SHELL") else {
        return Vec::new();
    };
    let script = format!("printf '\\n{PATH_MARKER}%s\\n' \"$PATH\"");
    let output = run(Path::new(&shell), &["-ilc", &script], SHELL_TIMEOUT);
    output
        .map(|output| parse_shell_path(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

fn parse_shell_path(text: &str) -> Vec<PathBuf> {
    text.lines()
        .find_map(|line| line.strip_prefix(PATH_MARKER))
        .map(|path| env::split_paths(path).collect())
        .unwrap_or_default()
}

fn common_folders() -> Vec<PathBuf> {
    let mut folders = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        folders.extend(
            [
                ".local/bin",
                ".npm-global/bin",
                ".bun/bin",
                ".cargo/bin",
                ".opencode/bin",
            ]
            .map(|folder| home.join(folder)),
        );
    }
    if let Some(app_data) = env::var_os("APPDATA") {
        folders.push(PathBuf::from(app_data).join("npm"));
    }
    folders
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_email_and_plan_from_claude_status() {
        let text = r#"{"loggedIn":true,"email":"ada@example.com","subscriptionType":"max"}"#;

        assert_eq!(
            parse_claude_status(text),
            Some(Account {
                email: Some("ada@example.com".to_owned()),
                plan: Some("max".to_owned()),
            })
        );
    }

    #[test]
    fn claude_status_without_a_plan_still_gives_the_email() {
        let text = r#"{"loggedIn":true,"email":"ada@example.com"}"#;

        assert_eq!(parse_claude_status(text).unwrap().plan, None);
    }

    #[test]
    fn unexpected_claude_output_gives_no_account() {
        assert_eq!(parse_claude_status("Logged in"), None);
    }

    #[test]
    fn reads_the_email_and_plan_from_the_codex_response() {
        let line = r#"{"id":2,"result":{"account":{"type":"chatgpt","email":"ada@example.com","planType":"plus"}}}"#;

        assert_eq!(
            parse_codex_account(line),
            Some(Some(Account {
                email: Some("ada@example.com".to_owned()),
                plan: Some("plus".to_owned()),
            }))
        );
    }

    #[test]
    fn a_codex_api_key_login_has_no_account_details() {
        let line = r#"{"id":2,"result":{"account":{"type":"apiKey"}}}"#;

        assert_eq!(parse_codex_account(line), Some(None));
    }

    #[test]
    fn ignores_other_codex_messages() {
        assert_eq!(parse_codex_account(r#"{"id":1,"result":{}}"#), None);
        assert_eq!(parse_codex_account("not json"), None);
    }

    #[test]
    fn counts_opencode_credentials_in_its_formatted_output() {
        let text = "┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  OpenRouter api\n│\n└  2 credentials\n";

        assert_eq!(credential_count(text), Some(2));
    }

    #[test]
    fn zero_opencode_credentials_is_a_count_not_a_failure() {
        assert_eq!(credential_count("└  0 credentials\n"), Some(0));
    }

    #[test]
    fn unexpected_opencode_output_gives_no_count() {
        assert_eq!(credential_count("Usage: opencode auth"), None);
    }

    #[test]
    fn finds_a_windows_binary_by_its_extension() {
        let folder = env::temp_dir().join(format!("davis-binary-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("npm.cmd"), "").unwrap();

        let found = find_with_suffixes("npm", std::slice::from_ref(&folder), &[".exe", ".cmd"]);

        assert_eq!(found, Some(folder.join("npm.cmd")));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn finds_the_path_among_shell_startup_noise() {
        let path = env::join_paths(["/opt/one", "/opt/two"]).unwrap();
        let text = format!("Welcome back!\n__DAVIS_PATH__{}\n", path.display());

        assert_eq!(
            parse_shell_path(&text),
            [PathBuf::from("/opt/one"), PathBuf::from("/opt/two")]
        );
    }
}
