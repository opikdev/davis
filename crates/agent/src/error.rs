#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error(transparent)]
    Ai(#[from] davis_ai::Error),
    #[error(transparent)]
    Engine(#[from] davis_core::Error),
}

impl AgentError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Ai(error) => error.code(),
            Self::Engine(error) => error.code(),
        }
    }
}

pub type Result<T> = std::result::Result<T, AgentError>;
