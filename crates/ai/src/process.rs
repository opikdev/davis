use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

const POLL_INTERVAL: Duration = Duration::from_millis(25);
const DRAIN_TIMEOUT: Duration = Duration::from_millis(200);

// A desktop app has no console, so Windows would flash a new window for every child.
pub(crate) fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub(crate) fn run(binary: &Path, arguments: &[&str], timeout: Duration) -> Option<Output> {
    let mut child = hidden_command(binary)
        .args(arguments)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout = collect_output(&mut child)?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(POLL_INTERVAL);
    };

    // A background job can keep the pipe open after the command itself has finished.
    thread::sleep(DRAIN_TIMEOUT);
    let stdout = stdout
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    Some(Output {
        status,
        stdout,
        stderr: Vec::new(),
    })
}

fn collect_output(child: &mut Child) -> Option<Arc<Mutex<Vec<u8>>>> {
    let mut stream = child.stdout.take()?;
    let collected = Arc::new(Mutex::new(Vec::new()));
    let target = Arc::clone(&collected);
    thread::spawn(move || {
        let mut chunk = [0; 4096];
        while let Ok(count) = stream.read(&mut chunk) {
            if count == 0 {
                break;
            }
            target
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .extend_from_slice(&chunk[..count]);
        }
    });
    Some(collected)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn shell(script: &str, timeout: Duration) -> Option<Output> {
        run(Path::new("/bin/sh"), &["-c", script], timeout)
    }

    #[test]
    fn returns_what_a_command_printed() {
        let output = shell("echo hello", Duration::from_secs(5)).unwrap();

        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
    }

    #[test]
    fn large_output_cannot_block_a_command() {
        let script = "i=0; while [ $i -lt 20000 ]; do echo 0123456789; i=$((i+1)); done";

        let output = shell(script, Duration::from_secs(10)).unwrap();

        assert_eq!(output.stdout.len(), 220_000);
    }

    #[test]
    fn a_background_job_holding_the_pipe_cannot_hang_the_call() {
        let started = Instant::now();

        let output = shell("sleep 5 & echo done", Duration::from_secs(4)).unwrap();

        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "done");
    }

    #[test]
    fn gives_up_on_a_command_that_never_finishes() {
        assert!(shell("sleep 5", Duration::from_millis(100)).is_none());
    }
}
