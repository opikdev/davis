use std::path::{Path, PathBuf};
use std::sync::Arc;

use davis_core::{LinkedFilter, OpenedTable, QueryResult, QueryTable, TableFilter};
use davis_project::{Block, BlockKind, Chat, Page, Project, RecentProject};
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
            .map(|table| QueryTable::new(table.name.clone(), table.opened.source.clone()))
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

#[tauri::command]
pub async fn save_page(project: String, page: Page) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_project::save_page(Path::new(&project), &page)).await??)
}

#[tauri::command]
pub async fn read_page(project: String, id: String) -> Result<Page, AppError> {
    Ok(spawn_blocking(move || davis_project::read_page(Path::new(&project), &id)).await??)
}

#[tauri::command]
pub async fn delete_page(project: String, id: String) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_project::delete_page(Path::new(&project), &id)).await??)
}

#[tauri::command]
pub async fn add_block(
    project: String,
    id: String,
    mut block: Block,
    updated_at: u64,
) -> Result<Page, AppError> {
    Ok(spawn_blocking(move || {
        davis_project::change_page(Path::new(&project), &id, updated_at, |page| {
            (block.x, block.y) = davis_project::free_spot(&page.blocks, block.w, block.h);
            if block.id.is_empty() {
                block.id = format!("b{updated_at}-{}", page.blocks.len());
            }
            page.blocks.push(block);
        })
    })
    .await??)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockResult {
    id: String,
    result: Option<QueryResult>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterReach {
    id: String,
    files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRun {
    blocks: Vec<BlockResult>,
    filters: Vec<FilterReach>,
}

fn file_of(tables: &[QueryTable], files: &[String], name: &str) -> Option<String> {
    let index = tables.iter().position(|table| table.name == name)?;
    files.get(index).cloned()
}

// Adds each chosen filter to its own table and to every table linked to it.
fn apply_filters(page: &Page, tables: &mut [QueryTable], files: &[String]) -> Vec<FilterReach> {
    let chosen: Vec<_> = page
        .blocks
        .iter()
        .filter(|block| block.kind == BlockKind::Filter && !block.values.is_empty())
        .collect();
    if chosen.is_empty() {
        return Vec::new();
    }
    let links = davis_core::find_links(tables).unwrap_or_default();
    let mut reach = Vec::new();
    for block in chosen {
        let (Some(file), Some(column)) = (&block.table, &block.column) else {
            continue;
        };
        let Some(index) = files.iter().position(|name| name == file) else {
            continue;
        };
        let (name, source) = (tables[index].name.clone(), tables[index].source.clone());
        tables[index].filters.push(TableFilter {
            column: column.clone(),
            values: block.values.clone(),
            through: None,
        });
        let mut reached = vec![file.clone()];
        for link in links.iter().filter(|link| link.to_table == name) {
            let linked = file_of(tables, files, &link.from_table);
            let Some(from) = tables
                .iter_mut()
                .find(|table| table.name == link.from_table)
            else {
                continue;
            };
            from.filters.push(TableFilter {
                column: link.from_column.clone(),
                values: block.values.clone(),
                through: Some(LinkedFilter {
                    source: source.clone(),
                    key: link.to_column.clone(),
                    column: column.clone(),
                }),
            });
            reached.extend(linked.filter(|linked| linked != file));
        }
        reached.dedup();
        reach.push(FilterReach {
            id: block.id.clone(),
            files: reached,
        });
    }
    reach
}

// Each block runs on its own, so one bad query shows in its block and the rest still load.
#[tauri::command]
pub async fn run_page(project: String, page: Page) -> Result<PageRun, AppError> {
    spawn_blocking(move || {
        let project_tables = project_tables(Path::new(&project))?;
        let files: Vec<String> = project_tables
            .iter()
            .map(|table| table.opened.name.clone())
            .collect();
        let mut tables: Vec<QueryTable> = project_tables
            .into_iter()
            .map(|table| QueryTable::new(table.name, table.opened.source))
            .collect();
        let filters = apply_filters(&page, &mut tables, &files);
        let blocks = page
            .blocks
            .iter()
            .filter_map(|block| Some((block.id.clone(), block.sql.as_ref()?)))
            .map(
                |(id, sql)| match davis_core::run_query(&tables, sql, Arc::default()) {
                    Ok(result) => BlockResult {
                        id,
                        result: Some(result),
                        error: None,
                    },
                    Err(error) => BlockResult {
                        id,
                        result: None,
                        error: Some(error.to_string()),
                    },
                },
            )
            .collect();
        Ok(PageRun { blocks, filters })
    })
    .await?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterChoice {
    table: String,
    columns: Vec<String>,
}

#[tauri::command]
pub async fn filter_choices(project: String) -> Result<Vec<FilterChoice>, AppError> {
    spawn_blocking(move || {
        Ok(project_tables(Path::new(&project))?
            .into_iter()
            .map(|table| FilterChoice {
                columns: table
                    .opened
                    .columns
                    .into_iter()
                    .map(|column| column.name)
                    .collect(),
                table: table.opened.name,
            })
            .collect())
    })
    .await?
}

#[tauri::command]
pub async fn filter_options(
    project: String,
    table: String,
    column: String,
) -> Result<Vec<String>, AppError> {
    spawn_blocking(move || {
        let source = project_tables(Path::new(&project))?
            .into_iter()
            .find(|candidate| candidate.opened.name == table)
            .map(|candidate| candidate.opened.source)
            .ok_or(davis_project::Error::MissingItem)?;
        Ok(davis_core::column_options(&source, &column)?)
    })
    .await?
}
