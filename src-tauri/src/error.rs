use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Agent(#[from] davis_agent::AgentError),
    #[error(transparent)]
    Ai(#[from] davis_ai::Error),
    #[error(transparent)]
    Engine(#[from] davis_core::Error),
    #[error(transparent)]
    Library(#[from] davis_library::Error),
    #[error(transparent)]
    Project(#[from] davis_project::Error),
    #[error("Davis couldn't export this Page: {0}")]
    Export(String),
    #[error("Background task failed: {0}")]
    Task(#[from] tauri::Error),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            Self::Agent(error) => error.code(),
            Self::Ai(error) => error.code(),
            Self::Engine(error) => error.code(),
            Self::Library(error) => error.code(),
            Self::Project(error) => error.code(),
            Self::Export(_) => "export",
            Self::Task(_) => "task",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut error = serializer.serialize_struct("AppError", 2)?;
        error.serialize_field("kind", self.kind())?;
        error.serialize_field("message", &self.to_string())?;
        error.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_the_shape_the_frontend_reads() {
        let error = AppError::Task(tauri::Error::WindowNotFound);

        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"kind":"task","message":"Background task failed: window not found"}"#
        );
    }
}
