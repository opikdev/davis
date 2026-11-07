#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0} isn't a Davis project folder.")]
    NotAProject(String),
    #[error("A project called {0} already exists.")]
    NameTaken(String),
    #[error("Give the project a name with letters or numbers in it.")]
    InvalidName,
    #[error("Couldn't find that item in the project.")]
    MissingItem,
    #[error("Couldn't read {0}. It may be damaged or protected by a password.")]
    UnreadableWorkbook(String),
    #[error("{0} has no data in it.")]
    EmptyWorkbook(String),
    #[error("Davis couldn't update the project folder: {0}")]
    Storage(#[from] std::io::Error),
    #[error("Davis couldn't save that: {0}")]
    Encoding(#[from] serde_json::Error),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotAProject(_) => "not-a-project",
            Self::NameTaken(_) => "name-taken",
            Self::InvalidName => "invalid-name",
            Self::MissingItem => "missing-item",
            Self::UnreadableWorkbook(_) => "unreadable-workbook",
            Self::EmptyWorkbook(_) => "empty-workbook",
            Self::Storage(_) => "project-storage",
            Self::Encoding(_) => "project-encoding",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
