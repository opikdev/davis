use std::env;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use crate::apps::{AppStatus, check_app, search_folders};
use crate::process::hidden_command;
use crate::providers::{Group, Provider, find_provider};
use crate::{Error, Result};

const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
const TAIL_LINES: usize = 4;
const PERMISSION_SIGNS: [&str; 4] = ["eacces", "eperm", "permission denied", "access is denied"];

pub fn install_app(provider_id: &str, on_output: impl FnMut(&str)) -> Result<AppStatus> {
    let provider =
        find_provider(provider_id).ok_or_else(|| Error::UnknownProvider(provider_id.to_owned()))?;
    let command = provider
        .install_command_here()
        .filter(|_| provider.group == Group::App)
        .ok_or_else(|| Error::InstallFailed {
            name: provider.name.clone(),
            detail: "no install command".to_owned(),
        })?;

    let folders = search_folders();
    let output = run_install(command, &folders, INSTALL_TIMEOUT, on_output).map_err(|detail| {
        Error::InstallFailed {
            name: provider.name.clone(),
            detail,
        }
    })?;
    check_exit(provider, &output)?;

    confirm_installed(provider, check_app(provider, &search_folders()))
}

fn confirm_installed(provider: &Provider, status: AppStatus) -> Result<AppStatus> {
    if status.installed {
        Ok(status)
    } else {
        Err(Error::NotDetectedAfterInstall(provider.name.clone()))
    }
}

struct InstallOutput {
    status: ExitStatus,
    tail: Vec<String>,
    was_denied: bool,
}

fn check_exit(provider: &Provider, output: &InstallOutput) -> Result<()> {
    if output.status.success() {
        return Ok(());
    }
    if output.was_denied {
        return Err(Error::InstallPermission(provider.name.clone()));
    }
    Err(Error::InstallFailed {
        name: provider.name.clone(),
        detail: output.tail.join("\n"),
    })
}

fn says_permission_denied(line: &str) -> bool {
    let line = line.to_lowercase();
    PERMISSION_SIGNS.iter().any(|sign| line.contains(sign))
}

#[cfg(unix)]
fn install_shell(command: &str) -> Command {
    use std::os::unix::process::CommandExt;

    let mut shell = hidden_command("bash");
    shell
        .args(["-c", &format!("set -o pipefail\n{command}")])
        .process_group(0);
    shell
}

#[cfg(windows)]
fn install_shell(command: &str) -> Command {
    let mut shell = hidden_command("powershell");
    shell.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &format!("$ErrorActionPreference = 'Stop'; {command}"),
    ]);
    shell
}

#[cfg(unix)]
fn stop_install(child: &mut Child) {
    let _ = Command::new("kill")
        .args(["-KILL", "--", &format!("-{}", child.id())])
        .status();
    let _ = child.wait();
}

#[cfg(windows)]
fn stop_install(child: &mut Child) {
    let _ = hidden_command("taskkill")
        .args(["/T", "/F", "/PID", &child.id().to_string()])
        .status();
    let _ = child.wait();
}

fn run_install(
    command: &str,
    folders: &[PathBuf],
    timeout: Duration,
    mut on_output: impl FnMut(&str),
) -> std::result::Result<InstallOutput, String> {
    let path = env::join_paths(folders).map_err(|error| error.to_string())?;
    let mut child = install_shell(command)
        .env("PATH", path)
        .env("CONFIGURE", "false")
        .current_dir(env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let (sender, receiver) = mpsc::channel();
    let stdout = child.stdout.take().ok_or("no installer output")?;
    let stderr = child.stderr.take().ok_or("no installer output")?;
    forward_lines(stdout, sender.clone());
    forward_lines(stderr, sender);

    let deadline = Instant::now() + timeout;
    let mut tail = Vec::new();
    let mut was_denied = false;
    let mut finished: Option<(ExitStatus, Instant)> = None;
    loop {
        let is_closed = match receiver.recv_timeout(POLL_INTERVAL) {
            Ok(line) => {
                let line = clean_line(&line);
                if !line.is_empty() {
                    was_denied |= says_permission_denied(&line);
                    on_output(&line);
                    tail.push(line);
                    if tail.len() > TAIL_LINES {
                        tail.remove(0);
                    }
                }
                false
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };

        if finished.is_none() {
            let status = child.try_wait().map_err(|error| error.to_string())?;
            finished = status.map(|status| (status, Instant::now() + DRAIN_TIMEOUT));
        }
        match finished {
            // A background service started by the installer can keep the pipe open.
            Some((status, drained_by)) if is_closed || Instant::now() >= drained_by => {
                return Ok(InstallOutput {
                    status,
                    tail,
                    was_denied,
                });
            }
            None if Instant::now() >= deadline => {
                stop_install(&mut child);
                return Err(format!(
                    "timed out after {} minutes",
                    timeout.as_secs() / 60
                ));
            }
            None if is_closed => thread::sleep(POLL_INTERVAL),
            _ => {}
        }
    }
}

fn forward_lines(stream: impl Read + Send + 'static, sender: mpsc::Sender<String>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut line = Vec::new();
        while reader
            .read_until(b'\n', &mut line)
            .is_ok_and(|count| count > 0)
        {
            if sender
                .send(String::from_utf8_lossy(&line).into_owned())
                .is_err()
            {
                break;
            }
            line.clear();
        }
    });
}

fn clean_line(line: &str) -> String {
    let latest = line.rsplit('\r').find(|part| !part.trim().is_empty());
    let mut cleaned = String::new();
    let mut characters = latest.unwrap_or_default().chars();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            for code in characters.by_ref() {
                if code.is_ascii_alphabetic() {
                    break;
                }
            }
        } else if !character.is_control() {
            cleaned.push(character);
        }
    }
    cleaned.trim().to_owned()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn tool_folders() -> Vec<PathBuf> {
        ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]
            .map(PathBuf::from)
            .to_vec()
    }

    fn run(
        command: &str,
        timeout: Duration,
    ) -> (std::result::Result<InstallOutput, String>, Vec<String>) {
        let mut lines = Vec::new();
        let result = run_install(command, &tool_folders(), timeout, |line| {
            lines.push(line.to_owned())
        });
        (result, lines)
    }

    fn fails_with(command: &str) -> Error {
        let (result, _lines) = run(command, Duration::from_secs(5));
        check_exit(find_provider("codex").unwrap(), &result.unwrap()).unwrap_err()
    }

    #[test]
    fn streams_stdout_and_stderr_as_they_arrive() {
        let (result, lines) = run("echo one; echo two >&2", Duration::from_secs(5));

        assert!(result.unwrap().status.success());
        assert_eq!(lines.len(), 2);
        assert!(lines.contains(&"one".to_owned()));
        assert!(lines.contains(&"two".to_owned()));
    }

    #[test]
    fn reports_the_exit_code_of_a_failed_install() {
        let (result, _lines) = run("echo broken >&2; exit 7", Duration::from_secs(5));

        let output = result.unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.tail, ["broken"]);
    }

    #[test]
    fn stops_an_install_that_hangs() {
        let started = Instant::now();

        let (result, _lines) = run("echo starting; sleep 30", Duration::from_millis(300));

        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn an_installer_cannot_wait_for_typed_input() {
        let (result, lines) = run("read answer; echo got:$answer", Duration::from_secs(5));

        assert!(result.unwrap().status.success());
        assert_eq!(lines, ["got:"]);
    }

    #[test]
    fn a_permission_problem_is_reported_even_when_later_lines_bury_it() {
        let error = fails_with(
            "echo 'npm error code EACCES' >&2
             echo 'npm error It is likely you do not have the permissions' >&2
             echo 'npm error' >&2
             echo 'npm error If you believe this might be a permissions issue' >&2
             echo 'npm error A complete log of this run' >&2
             exit 243",
        );

        assert_eq!(error.code(), "install-permission");
    }

    #[test]
    fn any_other_failure_keeps_the_installer_message() {
        let error = fails_with("echo 'network down' >&2; exit 1");

        assert_eq!(error.code(), "install-failed");
        assert!(error.to_string().contains("network down"));
    }

    #[test]
    fn a_failed_download_piped_into_a_shell_fails_the_install() {
        let (result, _lines) = run("false | bash", Duration::from_secs(5));

        assert!(!result.unwrap().status.success());
    }

    #[test]
    fn a_timeout_stops_the_whole_install_not_just_its_shell() {
        let marker = env::temp_dir().join(format!("davis-orphan-{}", std::process::id()));
        let command = format!("(sleep 1; touch '{}') | cat", marker.display());

        let (result, _lines) = run(&command, Duration::from_millis(200));
        thread::sleep(Duration::from_millis(1300));

        assert!(result.is_err());
        assert!(!marker.exists());
    }

    #[test]
    fn a_service_left_running_cannot_hold_up_a_finished_install() {
        let started = Instant::now();

        let (result, _lines) = run("sleep 20 & echo done", Duration::from_secs(10));

        assert!(result.unwrap().status.success());
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn output_that_is_not_utf8_cannot_stop_the_install() {
        let (result, lines) = run(
            "printf 'bad \\377 byte\\n'; echo after",
            Duration::from_secs(5),
        );

        assert!(result.unwrap().status.success());
        assert_eq!(lines.last().map(String::as_str), Some("after"));
    }

    #[test]
    fn removes_terminal_colors_and_keeps_the_latest_progress_update() {
        assert_eq!(
            clean_line("\u{1b}[32madded 1 package\u{1b}[0m"),
            "added 1 package"
        );
        assert_eq!(clean_line("10%\r50%\r100%"), "100%");
    }

    fn status(installed: bool) -> AppStatus {
        AppStatus {
            id: "codex".to_owned(),
            installed,
            signed_in: None,
            account: None,
        }
    }

    #[test]
    fn a_clean_exit_is_not_enough_if_the_app_cannot_be_found() {
        let error = confirm_installed(find_provider("codex").unwrap(), status(false)).unwrap_err();

        assert_eq!(error.code(), "not-detected-after-install");
    }

    #[test]
    fn a_found_app_counts_as_installed() {
        let confirmed = confirm_installed(find_provider("codex").unwrap(), status(true)).unwrap();

        assert!(confirmed.installed);
    }

    #[test]
    fn a_provider_that_is_not_an_app_cannot_install() {
        let error = install_app("openai", |_| {}).unwrap_err();

        assert_eq!(error.code(), "install-failed");
    }

    #[test]
    fn an_unknown_provider_cannot_install() {
        let error = install_app("not-real", |_| {}).unwrap_err();

        assert_eq!(error.code(), "unknown-provider");
    }
}
