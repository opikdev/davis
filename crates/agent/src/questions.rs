use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

const STOP_CHECK: Duration = Duration::from_millis(50);

#[derive(Default)]
pub struct QuestionBox(Mutex<Option<Sender<String>>>);

impl QuestionBox {
    pub fn answer(&self, reply: String) -> bool {
        let waiting = self.0.lock().unwrap_or_else(PoisonError::into_inner).take();
        waiting.is_some_and(|sender| sender.send(reply).is_ok())
    }

    pub(crate) fn wait(&self, stop: &AtomicBool) -> Option<String> {
        let (sender, replies) = mpsc::channel();
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(sender);
        loop {
            match replies.recv_timeout(STOP_CHECK) {
                Ok(reply) => return Some(reply),
                Err(RecvTimeoutError::Disconnected) => return None,
                Err(RecvTimeoutError::Timeout) if stop.load(Ordering::Relaxed) => return None,
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }
}
