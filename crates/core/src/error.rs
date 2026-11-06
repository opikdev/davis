#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("DuckDB error: {0}")]
    Duckdb(#[from] duckdb::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
