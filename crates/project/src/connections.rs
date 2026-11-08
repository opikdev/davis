use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use davis_core::SslMode;
use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::project::{folder_name, is_project};
use crate::storage::write_json;
use crate::{Error, Result};

pub(crate) const CONNECTIONS_FOLDER: &str = "connections";
const KEYCHAIN_SERVICE: &str = "dev.opik.davis";
const MAX_ID_LENGTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedTable {
    pub schema: String,
    pub table: String,
}

// Everything needed to reach the database except the password, which lives in
// the system keychain so the project folder can be shared safely.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub ssl: SslMode,
    pub tables: Vec<ConnectedTable>,
}

fn check_id(id: &str) -> Result<()> {
    let is_plain = !id.is_empty()
        && id.len() <= MAX_ID_LENGTH
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if is_plain {
        Ok(())
    } else {
        Err(Error::MissingItem)
    }
}

fn connection_path(project: &Path, id: &str) -> Result<PathBuf> {
    if !is_project(project) {
        return Err(Error::NotAProject(folder_name(project)));
    }
    check_id(id)?;
    Ok(project.join(CONNECTIONS_FOLDER).join(format!("{id}.json")))
}

pub fn list_connections(project: &Path) -> Result<Vec<DatabaseConnection>> {
    let entries = match fs::read_dir(project.join(CONNECTIONS_FOLDER)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut connections = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            // A damaged file shouldn't hide the project's other connections.
            match serde_json::from_str(&fs::read_to_string(&path)?) {
                Ok(connection) => connections.push(connection),
                Err(error) => eprintln!("Skipped {}: {error}", path.display()),
            }
        }
    }
    connections.sort_by(|a: &DatabaseConnection, b| a.name.cmp(&b.name));
    Ok(connections)
}

pub fn save_connection(project: &Path, connection: &DatabaseConnection) -> Result<()> {
    write_json(&connection_path(project, &connection.id)?, connection)
}

pub fn remove_connection(project: &Path, id: &str) -> Result<()> {
    match fs::remove_file(connection_path(project, id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn keychain_entry(id: &str) -> Result<Entry> {
    check_id(id)?;
    Entry::new(KEYCHAIN_SERVICE, &format!("connection-{id}"))
        .map_err(|error| Error::Keychain(error.to_string()))
}

pub fn save_password(id: &str, password: &str) -> Result<()> {
    keychain_entry(id)?
        .set_password(password)
        .map_err(|error| Error::Keychain(error.to_string()))
}

pub fn saved_password(id: &str) -> Result<Option<String>> {
    match keychain_entry(id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(Error::Keychain(error.to_string())),
    }
}

pub fn forget_password(id: &str) -> Result<()> {
    match keychain_entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(Error::Keychain(error.to_string())),
    }
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
            let path = std::env::temp_dir()
                .join(format!("davis-connections-{}-{number}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn shop(id: &str) -> DatabaseConnection {
        DatabaseConnection {
            id: id.to_owned(),
            name: "shop".to_owned(),
            host: "db.example.com".to_owned(),
            port: 5432,
            database: "shop".to_owned(),
            user: "reader".to_owned(),
            ssl: SslMode::Require,
            tables: vec![ConnectedTable {
                schema: "public".to_owned(),
                table: "orders".to_owned(),
            }],
        }
    }

    #[test]
    fn a_saved_connection_is_listed_without_any_password() {
        let folder = Folder::new();
        let project = create_project(&folder.0, "Sales").unwrap();
        let project = Path::new(&project.path);

        save_connection(project, &shop("c1")).unwrap();

        assert_eq!(list_connections(project).unwrap(), [shop("c1")]);
        let saved = fs::read_to_string(project.join(CONNECTIONS_FOLDER).join("c1.json")).unwrap();
        assert!(!saved.contains("password"));
    }

    #[test]
    fn a_removed_connection_is_gone() {
        let folder = Folder::new();
        let project = create_project(&folder.0, "Sales").unwrap();
        let project = Path::new(&project.path);
        save_connection(project, &shop("c1")).unwrap();

        remove_connection(project, "c1").unwrap();

        assert!(list_connections(project).unwrap().is_empty());
    }

    #[test]
    fn an_id_that_could_reach_another_folder_is_refused() {
        let folder = Folder::new();
        let project = create_project(&folder.0, "Sales").unwrap();
        let project = Path::new(&project.path);

        for id in ["../escape", "a/b", "", "with space"] {
            assert!(save_connection(project, &shop(id)).is_err(), "{id}");
        }
    }

    #[test]
    fn a_damaged_connection_file_hides_only_itself() {
        let folder = Folder::new();
        let project = create_project(&folder.0, "Sales").unwrap();
        let project = Path::new(&project.path);
        save_connection(project, &shop("c1")).unwrap();
        fs::write(
            project.join(CONNECTIONS_FOLDER).join("c2.json"),
            "{ not json",
        )
        .unwrap();

        assert_eq!(list_connections(project).unwrap(), [shop("c1")]);
    }
}
