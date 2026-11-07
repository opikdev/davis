use std::sync::{Mutex, PoisonError};

use davis_ai::ModelEvent;

use crate::steps::{AskStep, SendStep, StepKind, StepStatus};

#[derive(Default)]
struct Current {
    count: usize,
    thinking: Option<AskStep>,
    note: Option<AskStep>,
}

// Text followed by a tool call is a working note; the last text is the answer,
// so a running note is left for the app to drop when the answer arrives.
pub(crate) struct Narration<'a> {
    send: SendStep<'a>,
    current: Mutex<Current>,
}

impl<'a> Narration<'a> {
    pub(crate) fn new(send: SendStep<'a>) -> Self {
        Self {
            send,
            current: Mutex::new(Current::default()),
        }
    }

    pub(crate) fn hear(&self, event: ModelEvent) {
        let mut current = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        match event {
            ModelEvent::Thinking => {
                self.finish_note(&mut current);
                self.finish_thinking(&mut current);
                current.count += 1;
                let step = AskStep::new(
                    format!("think-{}", current.count),
                    StepKind::Think,
                    StepStatus::Running,
                    "Thinking",
                );
                (self.send)(&step);
                current.thinking = Some(step);
            }
            ModelEvent::Text(text) => {
                self.finish_thinking(&mut current);
                let count = current.count;
                let note = current.note.get_or_insert_with(|| {
                    AskStep::new(
                        format!("note-{count}"),
                        StepKind::Note,
                        StepStatus::Running,
                        "Note",
                    )
                });
                note.body.get_or_insert_default().push_str(&text);
                (self.send)(note);
            }
        }
    }

    pub(crate) fn tool_started(&self) {
        let mut current = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        self.finish_note(&mut current);
        self.finish_thinking(&mut current);
    }

    pub(crate) fn finished(&self, status: StepStatus) {
        let mut current = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(mut step) = current.thinking.take() {
            step.status = status;
            (self.send)(&step);
        }
    }

    fn finish_thinking(&self, current: &mut Current) {
        if let Some(mut step) = current.thinking.take() {
            step.status = StepStatus::Done;
            (self.send)(&step);
        }
    }

    fn finish_note(&self, current: &mut Current) {
        if let Some(mut step) = current.note.take() {
            step.status = StepStatus::Done;
            (self.send)(&step);
        }
    }
}
