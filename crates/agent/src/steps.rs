use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepKind {
    Read,
    Think,
    Note,
    Write,
    Run,
    Chart,
    Question,
    Page,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Running,
    Done,
    Failed,
    Stopped,
}

impl StepStatus {
    pub(crate) fn after_failure(code: &str) -> Self {
        if code == "stopped" {
            Self::Stopped
        } else {
            Self::Failed
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskStep {
    pub id: String,
    pub kind: StepKind,
    pub status: StepStatus,
    pub label: String,
    pub detail: Option<String>,
    pub body: Option<String>,
    pub query: Option<String>,
    pub sent_rows: Option<usize>,
    pub options: Option<Vec<String>>,
}

impl AskStep {
    pub(crate) fn new(
        id: impl Into<String>,
        kind: StepKind,
        status: StepStatus,
        label: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind,
            status,
            label: label.into(),
            detail: None,
            body: None,
            query: None,
            sent_rows: None,
            options: None,
        }
    }
}

pub(crate) type SendStep<'a> = &'a (dyn Fn(&AskStep) + Sync);
