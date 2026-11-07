use std::env;
use std::ffi::OsString;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::apps::{find_binary, search_folders};
use crate::providers::{Group, Provider, find_provider};
use crate::{Error, Result};

const LINUX_TERMINALS: [(&str, &[&str]); 9] = [
    ("x-terminal-emulator", &["-e"]),
    ("ptyxis", &["--"]),
    ("gnome-terminal", &["--"]),
    ("konsole", &["-e"]),
    ("xfce4-terminal", &["-x"]),
    ("kitty", &[]),
    ("alacritty", &["-e"]),
    ("foot", &[]),
    ("xterm", &["-e"]),
];

pub fn open_sign_in(provider_id: &str) -> Result<()> {
    let provider =
        find_provider(provider_id).ok_or_else(|| Error::UnknownProvider(provider_id.to_owned()))?;
    let command = sign_in_command(provider)?;
    let folders = search_folders();
    let path = env::join_paths(&folders).map_err(terminal_error)?;
    let script = script_for(
        env::consts::OS,
        &provider.name,
        command,
        &path.to_string_lossy(),
    );
    launch(provider_id, &script, &folders)
}

fn sign_in_command(provider: &Provider) -> Result<&str> {
    provider
        .sign_in_command
        .as_deref()
        .filter(|_| provider.group == Group::App)
        .ok_or_else(|| Error::Terminal(format!("{} has no sign-in command", provider.name)))
}

fn script_for(os: &str, name: &str, command: &str, path: &str) -> String {
    match os {
        "windows" => windows_script(name, command, path),
        "macos" => unix_script("#!/bin/zsh -il", name, command, path, ""),
        _ => unix_script("#!/bin/sh", name, command, path, "read -r _\n"),
    }
}

fn unix_script(first_line: &str, name: &str, command: &str, path: &str, hold: &str) -> String {
    let shown = command.replace('\'', r"'\''");
    let path = path.replace('\'', r"'\''");
    format!(
        "{first_line}\n\
         export PATH='{path}':\"$PATH\"\n\
         echo 'Davis is signing you in to {name} with this command:'\n\
         echo '  {shown}'\n\
         echo\n\
         {command}\n\
         echo\n\
         echo 'You can close this window and go back to Davis.'\n\
         {hold}"
    )
}

fn windows_script(name: &str, command: &str, path: &str) -> String {
    format!(
        "@echo off\r\n\
         set \"PATH={path};%PATH%\"\r\n\
         echo Davis is signing you in to {name} with this command:\r\n\
         echo   {command}\r\n\
         echo.\r\n\
         call {command}\r\n\
         echo.\r\n\
         echo You can close this window and go back to Davis.\r\n\
         pause\r\n"
    )
}

fn terminal_for(os: &str, script: &Path, folders: &[PathBuf]) -> Option<Vec<OsString>> {
    let script = script.as_os_str().to_owned();
    match os {
        "macos" => Some(vec!["open".into(), script]),
        "windows" => Some(vec!["cmd".into(), "/C".into(), script]),
        _ => LINUX_TERMINALS.iter().find_map(|(name, arguments)| {
            let terminal = find_binary(name, folders)?;
            let mut command = vec![terminal.into_os_string()];
            command.extend(arguments.iter().map(OsString::from));
            command.push(script.clone());
            Some(command)
        }),
    }
}

fn launch(provider_id: &str, script: &str, folders: &[PathBuf]) -> Result<()> {
    let os = env::consts::OS;
    let path = write_script(provider_id, os, script)?;
    let command = terminal_for(os, &path, folders)
        .ok_or_else(|| Error::Terminal("no terminal app was found".to_owned()))?;
    let mut terminal = terminal_command(&command[0]);
    terminal.args(&command[1..]);

    if os == "macos" {
        let status = terminal.status().map_err(terminal_error)?;
        return if status.success() {
            Ok(())
        } else {
            Err(Error::Terminal(format!("open exited with {status}")))
        };
    }
    let mut child = terminal.spawn().map_err(terminal_error)?;
    thread::spawn(move || child.wait());
    Ok(())
}

fn write_script(provider_id: &str, os: &str, script: &str) -> Result<PathBuf> {
    let extension = match os {
        "macos" => "command",
        "windows" => "cmd",
        _ => "sh",
    };
    let moment = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(terminal_error)?
        .as_nanos();
    let path = env::temp_dir().join(format!("davis-{provider_id}-{moment}.{extension}"));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o700);
    }
    let mut file = options.open(&path).map_err(terminal_error)?;
    file.write_all(script.as_bytes()).map_err(terminal_error)?;
    Ok(path)
}

fn terminal_command(program: &OsString) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        command.creation_flags(CREATE_NEW_CONSOLE);
    }
    command
}

fn terminal_error(error: impl std::fmt::Display) -> Error {
    Error::Terminal(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn the_script_shows_the_command_before_running_it() {
        for os in ["macos", "linux"] {
            let script = script_for(os, "Codex", "codex login", "/bin");

            let shown = script.find("echo '  codex login'").unwrap();
            let run = script.find("\ncodex login\n").unwrap();
            assert!(shown < run);
        }
    }

    #[test]
    fn a_quote_in_a_command_cannot_break_out_of_the_shown_text() {
        let script = script_for("macos", "Example", "echo 'hi'", "/bin");

        assert!(script.contains(r"echo '  echo '\''hi'\'''"), "got {script}");
    }

    #[test]
    fn sign_in_finds_tools_in_the_same_folders_as_detection() {
        let script = script_for("macos", "Codex", "codex login", "/home/ada/.local/bin");
        let export = script
            .find("export PATH='/home/ada/.local/bin':\"$PATH\"")
            .unwrap();

        assert!(export < script.find("\ncodex login\n").unwrap());
    }

    #[test]
    fn a_quote_in_a_folder_cannot_break_out_of_the_path() {
        let script = script_for("linux", "Codex", "codex login", "/home/o'brien/bin");

        assert!(
            script.contains(r"export PATH='/home/o'\''brien/bin'"),
            "got {script}"
        );
    }

    #[test]
    fn a_linux_window_stays_open_until_the_user_has_read_it() {
        assert!(script_for("linux", "Codex", "codex login", "/bin").ends_with("read -r _\n"));
    }

    #[test]
    fn windows_runs_the_command_so_a_cmd_shim_returns_to_the_script() {
        let script = script_for("windows", "Codex", "codex login", r"C:\Tools");

        assert!(script.contains("set \"PATH=C:\\Tools;%PATH%\"\r\n"));
        assert!(script.contains("\r\ncall codex login\r\n"));
        assert!(script.ends_with("pause\r\n"));
    }

    #[test]
    fn opens_the_right_terminal_for_each_system() {
        let script = Path::new("/tmp/sign-in");

        assert_eq!(terminal_for("macos", script, &[]).unwrap()[0], "open");
        assert_eq!(terminal_for("windows", script, &[]).unwrap()[0], "cmd");
    }

    #[cfg(unix)]
    #[test]
    fn linux_uses_the_first_terminal_it_finds() {
        let folder = env::temp_dir().join(format!("davis-terminals-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("konsole"), "").unwrap();
        fs::write(folder.join("xterm"), "").unwrap();

        let command =
            terminal_for("linux", Path::new("/tmp/s"), std::slice::from_ref(&folder)).unwrap();

        assert_eq!(command[0], folder.join("konsole").into_os_string());
        assert_eq!(command[1], "-e");
        assert_eq!(command[2], "/tmp/s");
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn linux_with_no_terminal_says_so() {
        assert!(terminal_for("linux", Path::new("/tmp/s"), &[]).is_none());
    }

    #[test]
    fn scripts_are_never_written_over_an_existing_file() {
        let first = write_script("test", "linux", "one").unwrap();
        let second = write_script("test", "linux", "two").unwrap();

        assert_ne!(first, second);
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
    }

    #[test]
    fn runs_only_the_command_from_the_provider_list() {
        let codex = find_provider("codex").unwrap();

        assert_eq!(sign_in_command(codex).unwrap(), "codex login");
    }

    #[test]
    fn an_app_with_no_sign_in_command_cannot_sign_in() {
        let mut provider = find_provider("codex").unwrap().clone();
        provider.sign_in_command = None;

        assert_eq!(sign_in_command(&provider).unwrap_err().code(), "terminal");
    }

    #[test]
    fn a_provider_that_is_not_an_app_opens_nothing() {
        assert_eq!(open_sign_in("openai").unwrap_err().code(), "terminal");
    }

    #[test]
    fn an_unknown_provider_opens_nothing() {
        assert_eq!(open_sign_in("nope").unwrap_err().code(), "unknown-provider");
    }
}
