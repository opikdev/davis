use std::path::{Path, PathBuf};

use davis_core::{OpenedTable, QueryTable};
use davis_project::{Chat, Project, RecentProject};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager};

use crate::commands::chat::project_tables;
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
pub async fn data_files_in(paths: Vec<String>) -> Result<Vec<String>, AppError> {
    Ok(spawn_blocking(move || davis_project::data_files_in(&paths)).await??)
}

#[tauri::command]
pub async fn check_data_file(path: String) -> Result<(), AppError> {
    spawn_blocking(move || {
        let file = Path::new(&path);
        if davis_project::is_workbook(file) {
            davis_project::check_workbook(file)?;
        } else {
            davis_core::open_table(&path)?;
        }
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn add_project_file(project: String, path: String) -> Result<OpenedTable, AppError> {
    spawn_blocking(move || {
        let (folder, file) = (Path::new(&project), Path::new(&path));
        if davis_project::is_workbook(file) {
            let added = davis_project::add_workbook(folder, file)?;
            return Ok(davis_core::open_table(&added[0].path)?);
        }
        davis_core::open_table(&path)?;
        let added = davis_project::add_file(folder, file)?;
        Ok(davis_core::open_table(&added.path)?)
    })
    .await?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLink {
    from_file: String,
    from_column: String,
    to_file: String,
    to_column: String,
    match_percent: f64,
}

#[tauri::command]
pub async fn project_links(project: String) -> Result<Vec<FileLink>, AppError> {
    spawn_blocking(move || {
        let tables = project_tables(Path::new(&project))?;
        if tables.len() < 2 {
            return Ok(Vec::new());
        }
        let file_of = |name: &str| {
            tables
                .iter()
                .find(|table| table.name == name)
                .map_or_else(String::new, |table| table.opened.name.clone())
        };
        let query_tables: Vec<QueryTable> = tables
            .iter()
            .map(|table| QueryTable {
                name: table.name.clone(),
                source: table.opened.source.clone(),
            })
            .collect();
        Ok(davis_core::find_links(&query_tables)?
            .into_iter()
            .map(|link| FileLink {
                from_file: file_of(&link.from_table),
                from_column: link.from_column,
                to_file: file_of(&link.to_table),
                to_column: link.to_column,
                match_percent: link.match_percent,
            })
            .collect())
    })
    .await?
}

#[tauri::command]
pub async fn combine_project_files(
    project: String,
    link: FileLink,
) -> Result<OpenedTable, AppError> {
    spawn_blocking(move || {
        let folder = Path::new(&project);
        let tables = project_tables(folder)?;
        let source_of = |file: &str| {
            tables
                .iter()
                .find(|table| table.opened.name == file)
                .map(|table| table.opened.source.clone())
                .ok_or(davis_project::Error::MissingItem)
        };
        let stem = |file: &str| file.split('.').next().unwrap_or(file).to_owned();
        let name = format!(
            "{} with {}.parquet",
            stem(&link.from_file),
            stem(&link.to_file)
        );
        let output = davis_project::new_file_path(folder, &name)?;
        let output = output.to_string_lossy();
        davis_core::combine_tables(
            &source_of(&link.from_file)?,
            &link.from_column,
            &source_of(&link.to_file)?,
            &link.to_column,
            &output,
        )?;
        Ok(davis_core::open_table(&output)?)
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
