use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::Result;
use crate::project::{folder_name, is_project};
use crate::storage::write_json;

const RECENT_LIMIT: usize = 20;

static UPDATES: Mutex<()> = Mutex::new(());

#[derive(Default, Serialize, Deserialize)]
struct Recents {
    projects: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
}

fn load(list: &Path) -> Result<Recents> {
    let text = match fs::read_to_string(list) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Recents::default()),
        Err(error) => return Err(error.into()),
    };
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

fn update(list: &Path, change: impl FnOnce(&mut Vec<String>)) -> Result<()> {
    let _guard = UPDATES.lock().unwrap_or_else(PoisonError::into_inner);
    let mut recents = load(list)?;
    change(&mut recents.projects);
    write_json(list, &recents)
}

pub fn remember_project(list: &Path, folder: &Path) -> Result<()> {
    let folder = folder.to_string_lossy().into_owned();
    update(list, |projects| {
        projects.retain(|path| *path != folder);
        projects.insert(0, folder);
        projects.truncate(RECENT_LIMIT);
    })
}

pub fn forget_project(list: &Path, folder: &Path) -> Result<()> {
    let folder = folder.to_string_lossy();
    update(list, |projects| projects.retain(|path| *path != folder))
}

// Folders can be moved or deleted while Davis is closed, so those are left out.
pub fn recent_projects(list: &Path) -> Result<Vec<RecentProject>> {
    Ok(load(list)?
        .projects
        .into_iter()
        .filter(|path| is_project(Path::new(path)))
        .map(|path| RecentProject {
            name: folder_name(Path::new(&path)),
            path,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::create_project;
    use crate::project::tests::Folder;

    fn names(list: &Path) -> Vec<String> {
        recent_projects(list)
            .unwrap()
            .into_iter()
            .map(|project| project.name)
            .collect()
    }

    fn project(folder: &Folder, name: &str) -> PathBuf {
        PathBuf::from(create_project(folder.path(), name).unwrap().path)
    }

    #[test]
    fn the_last_opened_project_comes_first_without_repeats() {
        let folder = Folder::new("recent");
        let list = folder.path().join("recent.json");
        let first = project(&folder, "First");
        let second = project(&folder, "Second");

        remember_project(&list, &first).unwrap();
        remember_project(&list, &second).unwrap();
        remember_project(&list, &first).unwrap();

        assert_eq!(names(&list), ["First", "Second"]);
    }

    #[test]
    fn a_deleted_project_drops_off_the_list() {
        let folder = Folder::new("gone");
        let list = folder.path().join("recent.json");
        let gone = project(&folder, "Gone");
        remember_project(&list, &gone).unwrap();

        fs::remove_dir_all(&gone).unwrap();

        assert!(names(&list).is_empty());
    }

    #[test]
    fn forgetting_leaves_the_folder_in_place() {
        let folder = Folder::new("forget");
        let list = folder.path().join("recent.json");
        let kept = project(&folder, "Kept");
        remember_project(&list, &kept).unwrap();

        forget_project(&list, &kept).unwrap();

        assert!(names(&list).is_empty());
        assert!(kept.exists());
    }

    #[test]
    fn a_damaged_list_starts_over() {
        let folder = Folder::new("damaged");
        let list = folder.path().join("recent.json");
        fs::write(&list, "not json").unwrap();

        assert!(names(&list).is_empty());
    }
}
