use duckdb::Connection;
use serde::Serialize;

use crate::Result;

#[derive(Debug, Serialize)]
pub struct EngineInfo {
    pub version: String,
}

pub fn engine_info() -> Result<EngineInfo> {
    let connection = Connection::open_in_memory()?;
    let version = connection.query_row("SELECT version()", [], |row| row.get(0))?;
    Ok(EngineInfo { version })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_info_reports_the_duckdb_version() {
        let info = engine_info().unwrap();

        assert!(info.version.starts_with('v'), "got {:?}", info.version);
    }
}
