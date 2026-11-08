use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::project::{folder_name, is_project};
use crate::storage::write_json;
use crate::{Error, Result};

const SOURCES_FILE: &str = "sources.json";
const DATA_FOLDER: &str = "data";

// Where a downloaded dataset came from, so its credit travels with the
// project and with anything exported from it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSource {
    pub dataset: String,
    pub title: String,
    pub publisher: String,
    pub license: String,
    pub license_url: String,
    pub credit: String,
    pub source_url: String,
    pub files: Vec<String>,
    pub added_at: u64,
}

fn saved_sources(project: &Path) -> Result<Vec<DataSource>> {
    match fs::read_to_string(project.join(SOURCES_FILE)) {
        Ok(text) => Ok(serde_json::from_str(&text)?),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

// A source whose files were all removed no longer needs crediting.
pub fn list_sources(project: &Path) -> Result<Vec<DataSource>> {
    let data = project.join(DATA_FOLDER);
    Ok(saved_sources(project)?
        .into_iter()
        .filter(|source| source.files.iter().any(|file| data.join(file).is_file()))
        .collect())
}

pub fn record_source(project: &Path, source: DataSource) -> Result<()> {
    if !is_project(project) {
        return Err(Error::NotAProject(folder_name(project)));
    }
    let mut sources = saved_sources(project)?;
    sources.retain(|known| known.dataset != source.dataset);
    sources.push(source);
    write_json(&project.join(SOURCES_FILE), &sources)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;
    use crate::create_project;

    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Folder(PathBuf);

    impl Folder {
        fn new() -> Self {
            let number = NEXT.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("davis-sources-{}-{number}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn quakes(added_at: u64) -> DataSource {
        DataSource {
            dataset: "earthquakes".to_owned(),
            title: "Earthquakes".to_owned(),
            publisher: "USGS".to_owned(),
            license: "Public domain".to_owned(),
            license_url: "https://www.usgs.gov".to_owned(),
            credit: "U.S. Geological Survey".to_owned(),
            source_url: "https://earthquake.usgs.gov".to_owned(),
            files: vec!["quakes.csv".to_owned()],
            added_at,
        }
    }

    #[test]
    fn a_dataset_downloaded_again_is_credited_once() {
        let folder = Folder::new();
        let project = create_project(&folder.0, "Quakes").unwrap();
        let project = Path::new(&project.path);
        fs::write(project.join("data").join("quakes.csv"), "mag\n1\n").unwrap();

        record_source(project, quakes(1)).unwrap();
        record_source(project, quakes(2)).unwrap();

        assert_eq!(list_sources(project).unwrap(), [quakes(2)]);
    }

    #[test]
    fn a_source_whose_files_are_gone_is_not_listed() {
        let folder = Folder::new();
        let project = create_project(&folder.0, "Quakes").unwrap();
        let project = Path::new(&project.path);

        record_source(project, quakes(1)).unwrap();

        assert!(list_sources(project).unwrap().is_empty());
    }
}
