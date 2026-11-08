use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use davis_agent::{DraftKind, DraftSource, ProjectTable};
use davis_core::{
    BuiltQuery, Column, FilterRule, LinkedFilter, OpenedTable, QueryResult, QuerySpec, QueryTable,
    TableFilter, TableSource,
};
use davis_project::{Block, Chat, FilterKind, Page, PageFilter, Project, RecentProject};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager};

use crate::commands::chat::{OfflineDatabase, project_tables, reachable_tables};
use crate::error::AppError;

const RECENTS_FILE: &str = "recent-projects.json";
const PROJECTS_FOLDER: &str = "Davis";

pub(crate) fn recents_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_config_dir()?.join(RECENTS_FILE))
}

pub(crate) fn projects_folder(app: &AppHandle) -> Result<PathBuf, AppError> {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replacement {
    missing_columns: Vec<String>,
}

#[tauri::command]
pub async fn check_replacement(
    project: String,
    name: String,
    path: String,
) -> Result<Replacement, AppError> {
    spawn_blocking(move || {
        let source = Path::new(&path);
        davis_project::check_same_kind(&name, source)?;
        let current = davis_project::read_project(Path::new(&project))?
            .files
            .into_iter()
            .find(|file| file.name == name)
            .ok_or(davis_project::Error::MissingItem)?;
        let current = davis_core::open_table(&current.path)?;
        let next = davis_core::open_table(&path)?;
        let missing_columns = current
            .columns
            .into_iter()
            .map(|column| column.name)
            .filter(|column| !next.columns.iter().any(|kept| &kept.name == column))
            .collect();
        Ok(Replacement { missing_columns })
    })
    .await?
}

#[tauri::command]
pub async fn replace_project_file(
    project: String,
    name: String,
    path: String,
) -> Result<OpenedTable, AppError> {
    spawn_blocking(move || {
        davis_core::open_table(&path)?;
        let replaced = davis_project::replace_file(Path::new(&project), &name, Path::new(&path))?;
        Ok(davis_core::open_table(&replaced.path)?)
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
            if block.id.is_empty() {
                let count: usize = page.rows.iter().map(|row| row.blocks.len()).sum();
                block.id = format!("b{updated_at}-{count}");
            }
            davis_project::place_block(page, block);
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
    trend: Option<QueryResult>,
    sources: BTreeMap<String, QueryResult>,
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
    data_through: Option<String>,
    offline: Vec<OfflineDatabase>,
}

fn rule_of(filter: &PageFilter) -> Option<FilterRule> {
    match filter.kind {
        FilterKind::Values if filter.values.is_empty() => None,
        FilterKind::Values => Some(FilterRule::OneOf(filter.values.clone())),
        FilterKind::Dates if filter.from.is_none() && filter.to.is_none() => None,
        FilterKind::Dates => Some(FilterRule::Between {
            from: filter.from.clone(),
            to: filter.to.clone(),
        }),
    }
}

// Adds each chosen filter to its own table and to every table linked to it.
fn apply_filters(page: &Page, tables: &mut [QueryTable], files: &[String]) -> Vec<FilterReach> {
    let chosen: Vec<_> = page
        .filters
        .iter()
        .filter_map(|filter| Some((filter, rule_of(filter)?)))
        .collect();
    if chosen.is_empty() {
        return Vec::new();
    }
    let links = davis_core::find_links(tables).unwrap_or_default();
    let mut reach = Vec::new();
    for (filter, rule) in chosen {
        let Some(index) = files.iter().position(|name| *name == filter.table) else {
            continue;
        };
        let (name, source) = (tables[index].name.clone(), tables[index].source.clone());
        tables[index].filters.push(TableFilter {
            column: filter.column.clone(),
            rule: rule.clone(),
            through: None,
        });
        let mut reached = vec![filter.table.clone()];
        for link in links.iter().filter(|link| link.to_table == name) {
            let Some(position) = tables
                .iter()
                .position(|table| table.name == link.from_table)
            else {
                continue;
            };
            tables[position].filters.push(TableFilter {
                column: link.from_column.clone(),
                rule: rule.clone(),
                through: Some(LinkedFilter {
                    source: source.clone(),
                    key: link.to_column.clone(),
                    column: filter.column.clone(),
                }),
            });
            if !reached.contains(&files[position]) {
                reached.push(files[position].clone());
            }
        }
        reach.push(FilterReach {
            id: filter.id.clone(),
            files: reached,
        });
    }
    reach
}

// A query over a table whose database is offline fails as an unknown table,
// which would wrongly suggest the block itself is broken.
fn explain_offline(failure: &davis_core::Error, offline: &[OfflineDatabase]) -> String {
    let message = failure.to_string();
    let words: Vec<&str> = message
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .collect();
    offline
        .iter()
        .find(|database| {
            database
                .tables
                .iter()
                .any(|table| words.contains(&table.as_str()))
        })
        .map_or(message, |database| {
            format!(
                "{} couldn't be reached, so this block can't show right now.",
                database.name
            )
        })
}

fn run_block(tables: &[QueryTable], block: &Block, offline: &[OfflineDatabase]) -> BlockResult {
    let run = |sql: &str| davis_core::run_query(tables, sql, Arc::default());
    let (result, error) = match block.sql.as_deref().map(run) {
        None => (None, None),
        Some(Ok(result)) => (Some(result), None),
        Some(Err(failure)) => (None, Some(explain_offline(&failure, offline))),
    };
    BlockResult {
        id: block.id.clone(),
        result,
        error,
        trend: block.trend_sql.as_deref().and_then(|sql| run(sql).ok()),
        sources: block
            .sources
            .iter()
            .filter_map(|(id, sql)| Some((id.clone(), run(sql).ok()?)))
            .collect(),
    }
}

// Each query sets up its own engine, which takes a moment, so the blocks run
// side by side instead of one after another.
fn run_blocks(tables: &[QueryTable], page: &Page, offline: &[OfflineDatabase]) -> Vec<BlockResult> {
    std::thread::scope(|scope| {
        let runs: Vec<_> = page
            .rows
            .iter()
            .flat_map(|row| &row.blocks)
            .map(|block| (block, scope.spawn(|| run_block(tables, block, offline))))
            .collect();
        runs.into_iter()
            .map(|(block, run)| {
                run.join().unwrap_or_else(|_| BlockResult {
                    id: block.id.clone(),
                    result: None,
                    error: Some("Davis couldn't run this block.".to_owned()),
                    trend: None,
                    sources: BTreeMap::new(),
                })
            })
            .collect()
    })
}

fn latest_date(page: &Page, tables: &[ProjectTable]) -> Option<String> {
    page.filters
        .iter()
        .filter(|filter| filter.kind == FilterKind::Dates)
        .find_map(|filter| {
            let table = tables
                .iter()
                .find(|table| table.opened.name == filter.table)?;
            let bounds = davis_core::column_bounds(&table.opened.source, &filter.column);
            Some(bounds.ok()??.1)
        })
}

// Each block runs on its own, so one bad query shows in its block and the rest still load.
#[tauri::command]
pub async fn run_page(project: String, page: Page) -> Result<PageRun, AppError> {
    spawn_blocking(move || {
        let (project_tables, offline) = reachable_tables(Path::new(&project))?;
        let data_through = latest_date(&page, &project_tables);
        let files: Vec<String> = project_tables
            .iter()
            .map(|table| table.opened.name.clone())
            .collect();
        let mut tables: Vec<QueryTable> = project_tables
            .into_iter()
            .map(|table| QueryTable::new(table.name, table.opened.source))
            .collect();
        let filters = apply_filters(&page, &mut tables, &files);
        let blocks = run_blocks(&tables, &page, &offline);
        Ok(PageRun {
            blocks,
            filters,
            data_through,
            offline,
        })
    })
    .await?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectColumns {
    table: String,
    columns: Vec<Column>,
}

#[tauri::command]
pub async fn project_columns(project: String) -> Result<Vec<ProjectColumns>, AppError> {
    spawn_blocking(move || {
        Ok(project_tables(Path::new(&project))?
            .into_iter()
            .map(|table| ProjectColumns {
                columns: table.opened.columns,
                table: table.opened.name,
            })
            .collect())
    })
    .await?
}

fn source_of(project: &str, table: &str) -> Result<TableSource, AppError> {
    Ok(project_tables(Path::new(project))?
        .into_iter()
        .find(|candidate| candidate.opened.name == table)
        .map(|candidate| candidate.opened.source)
        .ok_or(davis_project::Error::MissingItem)?)
}

#[tauri::command]
pub async fn filter_options(
    project: String,
    table: String,
    column: String,
) -> Result<Vec<String>, AppError> {
    spawn_blocking(move || {
        Ok(davis_core::column_options(
            &source_of(&project, &table)?,
            &column,
        )?)
    })
    .await?
}

#[tauri::command]
pub async fn filter_bounds(
    project: String,
    table: String,
    column: String,
) -> Result<Option<(String, String)>, AppError> {
    spawn_blocking(move || {
        Ok(davis_core::column_bounds(
            &source_of(&project, &table)?,
            &column,
        )?)
    })
    .await?
}

#[tauri::command]
pub async fn build_block_query(project: String, spec: QuerySpec) -> Result<BuiltQuery, AppError> {
    spawn_blocking(move || {
        let table = project_tables(Path::new(&project))?
            .into_iter()
            .find(|candidate| candidate.opened.name == spec.table)
            .ok_or(davis_project::Error::MissingItem)?;
        Ok(davis_core::build_query(&spec, &table.name))
    })
    .await?
}

#[tauri::command]
pub async fn draft_page(
    project: String,
    id: String,
    kind: DraftKind,
    updated_at: u64,
) -> Result<Page, AppError> {
    spawn_blocking(move || draft_tables(Path::new(&project), &id, kind, updated_at, None)).await?
}

// `only` limits the draft to some files, such as a dataset just downloaded
// into a project that already had others.
pub(crate) fn draft_tables(
    folder: &Path,
    id: &str,
    kind: DraftKind,
    updated_at: u64,
    only: Option<&[String]>,
) -> Result<Page, AppError> {
    let tables: Vec<ProjectTable> = project_tables(folder)?
        .into_iter()
        .filter(|table| only.is_none_or(|names| names.contains(&table.opened.name)))
        .collect();
    let sources: Vec<DraftSource> = tables
        .iter()
        .filter_map(|table| {
            Some(DraftSource {
                table,
                profile: davis_core::profile_table(&table.opened.source).ok()?,
            })
        })
        .collect();
    let query_tables: Vec<QueryTable> = tables
        .iter()
        .map(|table| QueryTable::new(table.name.clone(), table.opened.source.clone()))
        .collect();
    let links = davis_core::find_links(&query_tables)?;
    Ok(davis_project::change_page(
        folder,
        id,
        updated_at,
        |page| {
            let prefix = format!("b{updated_at}");
            davis_agent::draft_page(page, kind, &sources, &links, &prefix);
        },
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shop_offline() -> Vec<OfflineDatabase> {
        vec![OfflineDatabase {
            id: "c1".to_owned(),
            name: "shop".to_owned(),
            tables: vec!["orders".to_owned()],
            reason: "Couldn't connect to the database.".to_owned(),
            needs_password: false,
        }]
    }

    #[test]
    fn a_block_over_an_offline_database_says_so() {
        let failure = davis_core::Error::InvalidQuery(
            "Catalog Error: Table with name orders does not exist!".to_owned(),
        );

        assert_eq!(
            explain_offline(&failure, &shop_offline()),
            "shop couldn't be reached, so this block can't show right now."
        );
    }

    #[test]
    fn other_block_failures_keep_their_own_message() {
        let failure = davis_core::Error::InvalidQuery(
            "Catalog Error: Table with name orders_archive does not exist!".to_owned(),
        );

        assert_eq!(
            explain_offline(&failure, &shop_offline()),
            "Catalog Error: Table with name orders_archive does not exist!"
        );
    }
}
