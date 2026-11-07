use davis_core::{EngineInfo, OpenedTable, Row, TableSource};
use tauri::async_runtime::spawn_blocking;

use crate::error::AppError;

#[tauri::command]
pub async fn engine_info() -> Result<EngineInfo, AppError> {
    Ok(spawn_blocking(davis_core::engine_info).await??)
}

#[tauri::command]
pub async fn open_table(path: String) -> Result<OpenedTable, AppError> {
    Ok(spawn_blocking(move || davis_core::open_table(&path)).await??)
}

#[tauri::command]
pub async fn read_rows(source: TableSource, offset: u64, limit: u64) -> Result<Vec<Row>, AppError> {
    Ok(spawn_blocking(move || davis_core::read_rows(&source, offset, limit)).await??)
}
