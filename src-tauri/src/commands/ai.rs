use std::path::PathBuf;

use davis_ai::{AppStatus, ChosenModel, Connection, ConnectionRequest, Detected, Model, Settings};
use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const SETTINGS_FILE: &str = "settings.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    is_complete: bool,
}

pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_config_dir()?.join(SETTINGS_FILE))
}

#[tauri::command]
pub async fn detect_ai_tools() -> Result<Detected, AppError> {
    Ok(spawn_blocking(davis_ai::detect).await?)
}

#[tauri::command]
pub async fn connect_provider(
    app: AppHandle,
    request: ConnectionRequest,
) -> Result<Connection, AppError> {
    let path = settings_path(&app)?;
    Ok(spawn_blocking(move || davis_ai::connect(request, &path)).await??)
}

#[tauri::command]
pub async fn connected_providers(app: AppHandle) -> Result<Vec<String>, AppError> {
    let path = settings_path(&app)?;
    let settings = spawn_blocking(move || Settings::load(&path)).await??;
    Ok(settings
        .connections
        .into_iter()
        .map(|connection| connection.provider_id)
        .collect())
}

#[tauri::command]
pub async fn list_models(app: AppHandle, provider_id: String) -> Result<Vec<Model>, AppError> {
    let path = settings_path(&app)?;
    Ok(spawn_blocking(move || davis_ai::list_models(&provider_id, &path)).await??)
}

#[tauri::command]
pub async fn chosen_model(app: AppHandle) -> Result<Option<ChosenModel>, AppError> {
    let path = settings_path(&app)?;
    let settings = spawn_blocking(move || Settings::load(&path)).await??;
    Ok(settings.chosen_model)
}

#[tauri::command]
pub async fn choose_model(app: AppHandle, choice: ChosenModel) -> Result<(), AppError> {
    let path = settings_path(&app)?;
    Ok(spawn_blocking(move || {
        Settings::update(&path, |settings| settings.chosen_model = Some(choice))
    })
    .await??)
}

#[tauri::command]
pub async fn disconnect_provider(app: AppHandle, provider_id: String) -> Result<(), AppError> {
    let path = settings_path(&app)?;
    Ok(spawn_blocking(move || davis_ai::disconnect(&provider_id, &path)).await??)
}

#[tauri::command]
pub async fn install_app(
    provider_id: String,
    on_output: Channel<String>,
) -> Result<AppStatus, AppError> {
    Ok(spawn_blocking(move || {
        davis_ai::install_app(&provider_id, |line| {
            let _ = on_output.send(line.to_owned());
        })
    })
    .await??)
}

#[tauri::command]
pub async fn open_sign_in(provider_id: String) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_ai::open_sign_in(&provider_id)).await??)
}

#[tauri::command]
pub async fn onboarding_status(app: AppHandle) -> Result<OnboardingStatus, AppError> {
    let path = settings_path(&app)?;
    let settings = spawn_blocking(move || Settings::load(&path)).await??;
    Ok(OnboardingStatus {
        is_complete: settings.onboarding_complete,
    })
}

#[tauri::command]
pub async fn complete_onboarding(app: AppHandle) -> Result<(), AppError> {
    let path = settings_path(&app)?;
    Ok(spawn_blocking(move || {
        Settings::update(&path, |settings| settings.onboarding_complete = true)
    })
    .await??)
}
