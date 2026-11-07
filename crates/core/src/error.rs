#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("DuckDB error: {0}")]
    Duckdb(#[from] duckdb::Error),
    #[error("Davis can't open {0} yet. Try a CSV, Parquet, or JSON file.")]
    UnsupportedFile(String),
    #[error("Couldn't find {0}. It may have been moved or deleted.")]
    MissingFile(String),
    #[error("{0} is empty.")]
    EmptyFile(String),
    #[error("Couldn't read {0}. The file may be damaged or not a table.")]
    Unreadable(String),
    #[error("Davis only runs queries that read data.")]
    RejectedQuery,
    #[error("{0}")]
    InvalidQuery(String),
    #[error("That query took too long, so Davis stopped it.")]
    SlowQuery,
    #[error("Stopped.")]
    StoppedQuery,
    #[error("Davis couldn't finish that query. A value may not match its column type.")]
    FailedQuery,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Duckdb(_) => "engine",
            Self::UnsupportedFile(_) => "unsupported-file",
            Self::MissingFile(_) => "missing-file",
            Self::EmptyFile(_) => "empty-file",
            Self::Unreadable(_) => "unreadable-file",
            Self::RejectedQuery => "rejected-query",
            Self::InvalidQuery(_) => "invalid-query",
            Self::SlowQuery => "slow-query",
            Self::StoppedQuery => "stopped",
            Self::FailedQuery => "failed-query",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
