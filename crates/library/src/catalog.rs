use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

const CATALOG: &str = include_str!("../catalog.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Business,
    World,
    Climate,
    Energy,
    Transport,
    Nature,
    Technology,
    Sports,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct License {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeepFromSpec {
    pub column: String,
    pub value: i64,
}

// Each dataset is downloaded from its publisher and shaped by these steps in
// a staging folder, so nothing is re-hosted and every file ends up readable.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "do",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Step {
    Download {
        url: String,
        save_as: String,
    },
    Unzip {
        archive: String,
        pattern: String,
    },
    Workbook {
        file: String,
    },
    Stack {
        pattern: String,
        save_as: String,
    },
    Join {
        files: Vec<String>,
        on: Vec<String>,
        keep_from: Option<KeepFromSpec>,
        save_as: String,
    },
    Keep {
        file: String,
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dataset {
    pub id: String,
    pub title: String,
    pub category: Category,
    pub summary: String,
    pub covers: String,
    pub publisher: String,
    pub source_url: String,
    pub license: License,
    pub credit: String,
    pub size_bytes: u64,
    pub is_featured: bool,
    pub is_live: bool,
    pub is_advanced: bool,
    pub questions: Vec<String>,
    #[serde(skip_serializing)]
    pub(crate) steps: Vec<Step>,
}

impl Dataset {
    pub(crate) fn kept_files(&self) -> Vec<&str> {
        self.steps
            .iter()
            .filter_map(|step| match step {
                Step::Keep { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect()
    }
}

static DATASETS: LazyLock<Vec<Dataset>> = LazyLock::new(|| {
    serde_json::from_str(CATALOG).expect("the bundled catalog is checked by a test")
});

pub fn datasets() -> &'static [Dataset] {
    &DATASETS
}

pub fn find_dataset(id: &str) -> Option<&'static Dataset> {
    DATASETS.iter().find(|dataset| dataset.id == id)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    const DATA_EXTENSIONS: [&str; 3] = [".csv", ".parquet", ".json"];

    #[test]
    fn every_dataset_is_complete_and_unique() {
        let mut ids = HashSet::new();
        for dataset in datasets() {
            assert!(ids.insert(&dataset.id), "{} is listed twice", dataset.id);
            assert_eq!(dataset.questions.len(), 3, "{}", dataset.id);
            assert!(dataset.size_bytes > 0, "{}", dataset.id);
            assert!(!dataset.credit.is_empty(), "{}", dataset.id);
            assert!(
                !dataset.kept_files().is_empty(),
                "{} keeps nothing",
                dataset.id
            );
        }
    }

    // A step can only use a file an earlier step made, so a typo fails here
    // instead of halfway through someone's download.
    #[test]
    fn every_step_uses_a_file_an_earlier_step_made() {
        for dataset in datasets() {
            let mut made: Vec<String> = Vec::new();
            let exists = |made: &[String], file: &str| made.iter().any(|known| known == file);
            for step in &dataset.steps {
                match step {
                    Step::Download { url, save_as } => {
                        assert!(url.starts_with("https://"), "{}: {url}", dataset.id);
                        made.push(save_as.clone());
                    }
                    Step::Unzip { archive, pattern } => {
                        assert!(exists(&made, archive), "{}: {archive}", dataset.id);
                        made.push(pattern.clone());
                    }
                    Step::Workbook { file } => {
                        assert!(exists(&made, file), "{}: {file}", dataset.id);
                        let stem = file.split('.').next().unwrap_or(file);
                        made.push(format!("{stem}-*.csv"));
                    }
                    Step::Stack { save_as, .. } | Step::Join { save_as, .. } => {
                        made.push(save_as.clone());
                    }
                    Step::Keep { file, name } => {
                        assert!(exists(&made, file), "{}: {file}", dataset.id);
                        assert!(
                            DATA_EXTENSIONS
                                .iter()
                                .any(|extension| name.ends_with(extension)),
                            "{}: {name}",
                            dataset.id
                        );
                    }
                }
            }
        }
    }
}
