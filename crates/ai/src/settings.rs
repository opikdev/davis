use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

static UPDATES: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub onboarding_complete: bool,
    pub connections: Vec<SavedConnection>,
    pub chosen_model: Option<ChosenModel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChosenModel {
    pub provider_id: String,
    pub model_id: String,
    pub model_name: String,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub provider_id: String,
    pub url: Option<String>,
}

impl Settings {
    pub fn load(path: &Path) -> Result<Self> {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(settings_error(error)),
        };
        match serde_json::from_str(&text) {
            Ok(settings) => Ok(settings),
            Err(_) => {
                fs::rename(path, path.with_extension("damaged")).map_err(settings_error)?;
                Ok(Self::default())
            }
        }
    }

    // Each change reads the latest file, so one change can never overwrite another.
    pub fn update(path: &Path, change: impl FnOnce(&mut Self)) -> Result<()> {
        let _guard = UPDATES.lock().unwrap_or_else(PoisonError::into_inner);
        let mut settings = Self::load(path)?;
        change(&mut settings);
        settings.save(path)
    }

    fn save(&self, path: &Path) -> Result<()> {
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder).map_err(settings_error)?;
        }
        let text = serde_json::to_string_pretty(self).map_err(settings_error)?;
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        let mut file = File::create(&temporary).map_err(settings_error)?;
        file.write_all(text.as_bytes()).map_err(settings_error)?;
        file.sync_all().map_err(settings_error)?;
        fs::rename(&temporary, path).map_err(settings_error)
    }

    pub fn remember(&mut self, connection: SavedConnection) {
        self.connections
            .retain(|saved| saved.provider_id != connection.provider_id);
        self.connections.push(connection);
    }

    pub fn forget(&mut self, provider_id: &str) {
        self.connections
            .retain(|saved| saved.provider_id != provider_id);
        if self
            .chosen_model
            .as_ref()
            .is_some_and(|chosen| chosen.provider_id == provider_id)
        {
            self.chosen_model = None;
        }
    }
}

fn settings_error(error: impl std::fmt::Display) -> Error {
    Error::Settings(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_path(name: &str) -> std::path::PathBuf {
        let folder = std::env::temp_dir().join(format!("davis-{}-{name}", std::process::id()));
        folder.join("settings.json")
    }

    fn connection(provider_id: &str, url: Option<&str>) -> SavedConnection {
        SavedConnection {
            provider_id: provider_id.to_owned(),
            url: url.map(str::to_owned),
        }
    }

    fn chosen(provider_id: &str) -> ChosenModel {
        ChosenModel {
            provider_id: provider_id.to_owned(),
            model_id: "model".to_owned(),
            model_name: "Model".to_owned(),
            effort: Some("high".to_owned()),
        }
    }

    #[test]
    fn the_chosen_model_loads_back() {
        let path = temporary_path("chosen-model");
        let settings = Settings {
            chosen_model: Some(chosen("codex")),
            ..Settings::default()
        };
        settings.save(&path).unwrap();

        assert_eq!(
            Settings::load(&path).unwrap().chosen_model,
            Some(chosen("codex"))
        );
    }

    #[test]
    fn disconnecting_clears_that_provider_s_chosen_model() {
        let mut settings = Settings {
            chosen_model: Some(chosen("codex")),
            ..Settings::default()
        };

        settings.forget("codex");

        assert_eq!(settings.chosen_model, None);
    }

    #[test]
    fn disconnecting_another_provider_keeps_the_chosen_model() {
        let mut settings = Settings {
            chosen_model: Some(chosen("codex")),
            ..Settings::default()
        };

        settings.forget("openai");

        assert_eq!(settings.chosen_model, Some(chosen("codex")));
    }

    #[test]
    fn a_missing_file_means_nothing_is_set_up_yet() {
        let settings = Settings::load(&temporary_path("missing")).unwrap();

        assert!(!settings.onboarding_complete);
        assert!(settings.connections.is_empty());
    }

    #[test]
    fn saved_settings_load_back() {
        let path = temporary_path("round-trip");
        let mut settings = Settings {
            onboarding_complete: true,
            ..Settings::default()
        };
        settings.remember(connection("openai", None));
        settings.save(&path).unwrap();

        let loaded = Settings::load(&path).unwrap();

        assert!(loaded.onboarding_complete);
        assert_eq!(loaded.connections, [connection("openai", None)]);
    }

    #[test]
    fn connecting_again_replaces_the_saved_connection() {
        let mut settings = Settings::default();

        settings.remember(connection("custom", Some("http://old")));
        settings.remember(connection("custom", Some("http://new")));

        assert_eq!(
            settings.connections,
            [connection("custom", Some("http://new"))]
        );
    }

    #[test]
    fn forgetting_removes_only_that_connection() {
        let mut settings = Settings::default();
        settings.remember(connection("openai", None));
        settings.remember(connection("codex", None));

        settings.forget("openai");

        assert_eq!(settings.connections, [connection("codex", None)]);
    }

    #[test]
    fn changes_made_at_the_same_moment_all_survive() {
        let path = temporary_path("concurrent");
        let writers: Vec<_> = (0..16)
            .map(|index| {
                let path = path.clone();
                std::thread::spawn(move || {
                    Settings::update(&path, |settings| {
                        settings.remember(connection(&format!("provider-{index}"), None));
                    })
                })
            })
            .collect();

        for writer in writers {
            writer.join().unwrap().unwrap();
        }

        assert_eq!(Settings::load(&path).unwrap().connections.len(), 16);
    }

    #[test]
    fn a_damaged_file_is_set_aside_and_the_app_starts_fresh() {
        let path = temporary_path("damaged");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();

        let settings = Settings::load(&path).unwrap();

        assert!(!settings.onboarding_complete);
        assert_eq!(
            fs::read_to_string(path.with_extension("damaged")).unwrap(),
            "{ not json"
        );
        Settings::update(&path, |settings| settings.onboarding_complete = true).unwrap();
        assert!(Settings::load(&path).unwrap().onboarding_complete);
    }

    #[test]
    fn saving_leaves_no_temporary_file_behind() {
        let path = temporary_path("clean");

        Settings::update(&path, |_| {}).unwrap();

        let files = fs::read_dir(path.parent().unwrap()).unwrap().count();
        assert_eq!(files, 1);
    }
}
