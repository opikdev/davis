use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use davis_agent::DraftKind;
use davis_library::{Dataset, ImportProgress};
use davis_project::{Page, Project};
use serde::Serialize;
use tauri::AppHandle;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;

use crate::commands::project::{draft_tables, projects_folder, recents_path};
use crate::error::AppError;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDataset {
    project: Project,
    files: Vec<String>,
    page_id: Option<String>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

// A dataset opens on a Page drafted from its own files, so there's something
// to look at straight away. A dataset with nothing to chart gets no Page.
fn starting_page(
    folder: &Path,
    dataset: &Dataset,
    files: &[String],
) -> Result<Option<String>, AppError> {
    let updated_at = now_millis();
    let id = format!("{}-{updated_at}", dataset.id);
    davis_project::save_page(
        folder,
        &Page {
            id: id.clone(),
            title: dataset.title.clone(),
            updated_at,
            rows: Vec::new(),
            filters: Vec::new(),
        },
    )?;
    let page = draft_tables(folder, &id, DraftKind::Overview, updated_at, Some(files))?;
    if page.rows.is_empty() {
        davis_project::delete_page(folder, &id)?;
        return Ok(None);
    }
    Ok(Some(id))
}

#[tauri::command]
pub fn library_datasets() -> Vec<Dataset> {
    davis_library::datasets().to_vec()
}

// With no project open, the dataset gets a new project named after it.
#[tauri::command]
pub async fn import_dataset(
    app: AppHandle,
    project: Option<String>,
    id: String,
    on_progress: Channel<ImportProgress>,
) -> Result<ImportedDataset, AppError> {
    let list = recents_path(&app)?;
    let parent = projects_folder(&app)?;
    spawn_blocking(move || {
        let dataset =
            davis_library::find_dataset(&id).ok_or(davis_library::Error::UnknownDataset)?;
        let folder = match project {
            Some(path) => PathBuf::from(path),
            None => {
                let created = davis_project::create_project(&parent, &dataset.title)?;
                davis_project::remember_project(&list, Path::new(&created.path))?;
                PathBuf::from(created.path)
            }
        };
        let files = davis_library::import_dataset(&folder, dataset, &mut |progress| {
            let _ = on_progress.send(progress);
        })?;
        let page_id = starting_page(&folder, dataset, &files)?;
        Ok(ImportedDataset {
            project: davis_project::read_project(&folder)?,
            files,
            page_id,
        })
    })
    .await?
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn a_dataset_opens_on_a_page_drafted_from_its_own_files() {
        let parent = std::env::temp_dir().join(format!("davis-start-{}", std::process::id()));
        let project = davis_project::create_project(&parent, "Weather").unwrap();
        let folder = Path::new(&project.path);
        fs::write(
            folder.join("data").join("other.csv"),
            "team,points\nA,1\nB,2\n",
        )
        .unwrap();
        fs::write(
            folder.join("data").join("seattle_weather.csv"),
            "date,precipitation,temp_max,weather\n2012-01-01,0.0,12.8,drizzle\n2012-01-02,10.9,10.6,rain\n",
        )
        .unwrap();
        let dataset = davis_library::find_dataset("seattle-weather").unwrap();

        let id = starting_page(folder, dataset, &["seattle_weather.csv".to_owned()]).unwrap();
        let page = davis_project::read_page(folder, &id.unwrap()).unwrap();
        fs::remove_dir_all(&parent).unwrap();

        assert_eq!(page.title, "Seattle weather");
        let sql: Vec<&str> = page
            .rows
            .iter()
            .flat_map(|row| &row.blocks)
            .filter_map(|block| block.sql.as_deref())
            .collect();
        assert!(!sql.is_empty());
        assert!(sql.iter().all(|sql| !sql.contains("other")), "{sql:?}");
    }
}
