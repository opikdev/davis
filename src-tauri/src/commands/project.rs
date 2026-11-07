use std::path::{Path, PathBuf};

use davis_core::OpenedTable;
use davis_project::{Chat, Project, RecentProject};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const RECENTS_FILE: &str = "recent-projects.json";
const PROJECTS_FOLDER: &str = "Davis";

fn recents_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_config_dir()?.join(RECENTS_FILE))
}

fn projects_folder(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().document_dir()?.join(PROJECTS_FOLDER))
}

#[tauri::command]
pub async fn recent_projects(app: AppHandle) -> Result<Vec<RecentProject>, AppError> {
    let list = recents_path(&app)?;
    Ok(spawn_blocking(move || davis_project::recent_projects(&list)).await??)
}

#[tauri::command]
pub async fn last_project(app: AppHandle) -> Result<Option<Project>, AppError> {
    let list = recents_path(&app)?;
    Ok(spawn_blocking(move || {
        davis_project::recent_projects(&list)?
            .first()
            .map(|project| davis_project::read_project(Path::new(&project.path)))
            .transpose()
    })
    .await??)
}

#[tauri::command]
pub async fn open_project(app: AppHandle, path: String) -> Result<Project, AppError> {
    let list = recents_path(&app)?;
    Ok(spawn_blocking(move || {
        let folder = Path::new(&path);
        let project = davis_project::read_project(folder)?;
        davis_project::remember_project(&list, folder)?;
        Ok::<_, davis_project::Error>(project)
    })
    .await??)
}

#[tauri::command]
pub async fn create_project(app: AppHandle, name: String) -> Result<Project, AppError> {
    let list = recents_path(&app)?;
    let parent = projects_folder(&app)?;
    Ok(spawn_blocking(move || {
        let project = davis_project::create_project(&parent, &name)?;
        davis_project::remember_project(&list, Path::new(&project.path))?;
        Ok::<_, davis_project::Error>(project)
    })
    .await??)
}

#[tauri::command]
pub async fn rename_project(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<Project, AppError> {
    let list = recents_path(&app)?;
    Ok(spawn_blocking(move || {
        let folder = Path::new(&path);
        let project = davis_project::rename_project(folder, &name)?;
        davis_project::forget_project(&list, folder)?;
        davis_project::remember_project(&list, Path::new(&project.path))?;
        Ok::<_, davis_project::Error>(project)
    })
    .await??)
}

#[tauri::command]
pub async fn add_project_file(project: String, path: String) -> Result<OpenedTable, AppError> {
    spawn_blocking(move || {
        davis_core::open_table(&path)?;
        let added = davis_project::add_file(Path::new(&project), Path::new(&path))?;
        Ok(davis_core::open_table(&added.path)?)
    })
    .await?
}

#[tauri::command]
pub async fn remove_project_file(project: String, name: String) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_project::remove_file(Path::new(&project), &name)).await??)
}

#[tauri::command]
pub async fn save_chat(project: String, chat: Chat) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_project::save_chat(Path::new(&project), &chat)).await??)
}

#[tauri::command]
pub async fn read_chat(project: String, id: String) -> Result<Chat, AppError> {
    Ok(spawn_blocking(move || davis_project::read_chat(Path::new(&project), &id)).await??)
}

#[tauri::command]
pub async fn delete_chat(project: String, id: String) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_project::delete_chat(Path::new(&project), &id)).await??)
}
