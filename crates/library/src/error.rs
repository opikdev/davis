#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("That dataset isn't in the library.")]
    UnknownDataset,
    #[error("Couldn't download from {0}. Check that you're online and try again.")]
    Download(String),
    #[error(
        "The download from {0} wasn't what Davis expected. It may have changed, so please report it."
    )]
    Unexpected(String),
    #[error(transparent)]
    Engine(#[from] davis_core::Error),
    #[error(transparent)]
    Project(#[from] davis_project::Error),
    #[error("Davis couldn't save the download: {0}")]
    Storage(#[from] std::io::Error),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownDataset => "unknown-dataset",
            Self::Download(_) => "dataset-download",
            Self::Unexpected(_) => "dataset-changed",
            Self::Engine(error) => error.code(),
            Self::Project(error) => error.code(),
            Self::Storage(_) => "dataset-storage",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
