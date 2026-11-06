use davis_core::EngineInfo;
use tauri::async_runtime::spawn_blocking;

use crate::error::AppError;

#[tauri::command]
pub async fn engine_info() -> Result<EngineInfo, AppError> {
    Ok(spawn_blocking(davis_core::engine_info).await??)
}
