use std::path::Path;

use davis_core::{
    DatabaseKind, DatabaseLogin, DatabaseTableInfo, OpenedTable, RemoteTable, RowCount, SslMode,
};
use davis_project::{DatabaseConnection, Project};
use serde::Deserialize;
use tauri::async_runtime::spawn_blocking;

use crate::error::AppError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    kind: DatabaseKind,
    host: String,
    port: u16,
    database: String,
    user: String,
    password: String,
    ssl: SslMode,
}

impl From<LoginRequest> for DatabaseLogin {
    fn from(request: LoginRequest) -> Self {
        Self {
            kind: request.kind,
            host: request.host.trim().to_owned(),
            port: request.port,
            database: request.database.trim().to_owned(),
            user: request.user.trim().to_owned(),
            password: request.password,
            ssl: request.ssl,
        }
    }
}

fn login_for(connection: &DatabaseConnection, password: String) -> DatabaseLogin {
    DatabaseLogin {
        kind: connection.kind,
        host: connection.host.clone(),
        port: connection.port,
        database: connection.database.clone(),
        user: connection.user.clone(),
        password,
        ssl: connection.ssl,
    }
}

// Logins come from the keychain once per run, so a connection added on
// another computer, or whose password was removed, asks to reconnect.
pub(crate) fn remember_logins(project: &Path) -> Result<(), AppError> {
    for connection in davis_project::list_connections(project)? {
        if davis_core::has_login(&connection.id) {
            continue;
        }
        if let Some(password) = davis_project::saved_password(&connection.id)? {
            davis_core::remember_login(&connection.id, login_for(&connection, password));
        }
    }
    Ok(())
}

// The default schema adds nothing to a name: Postgres's is "public", and a
// MySQL database is its own schema.
pub(crate) fn table_label(connection: &DatabaseConnection, schema: &str, table: &str) -> String {
    let default_schema = match connection.kind {
        DatabaseKind::Postgres => "public",
        DatabaseKind::Mysql => connection.database.as_str(),
    };
    if schema == default_schema {
        format!("{}.{table}", connection.name)
    } else {
        format!("{}.{schema}.{table}", connection.name)
    }
}

fn find_connection(project: &Path, id: &str) -> Result<DatabaseConnection, AppError> {
    Ok(davis_project::list_connections(project)?
        .into_iter()
        .find(|connection| connection.id == id)
        .ok_or(davis_project::Error::MissingItem)?)
}

#[tauri::command]
pub async fn database_support(kind: DatabaseKind) -> Result<bool, AppError> {
    Ok(spawn_blocking(move || davis_core::has_database_support(kind)).await??)
}

#[tauri::command]
pub async fn install_database_support(kind: DatabaseKind) -> Result<(), AppError> {
    Ok(spawn_blocking(move || davis_core::install_database_support(kind)).await??)
}

#[tauri::command]
pub async fn test_database(login: LoginRequest) -> Result<Vec<DatabaseTableInfo>, AppError> {
    let login = DatabaseLogin::from(login);
    Ok(spawn_blocking(move || davis_core::test_database(&login)).await??)
}

#[tauri::command]
pub async fn add_database(
    project: String,
    connection: DatabaseConnection,
    password: String,
) -> Result<Project, AppError> {
    spawn_blocking(move || {
        let folder = Path::new(&project);
        let login = login_for(&connection, password.clone());
        davis_core::test_database(&login)?;
        davis_project::save_password(&connection.id, &password)?;
        davis_project::save_connection(folder, &connection)?;
        davis_core::remember_login(&connection.id, login);
        Ok(davis_project::read_project(folder)?)
    })
    .await?
}

#[tauri::command]
pub async fn reconnect_database(
    project: String,
    id: String,
    password: String,
) -> Result<Project, AppError> {
    spawn_blocking(move || {
        let folder = Path::new(&project);
        let connection = find_connection(folder, &id)?;
        let login = login_for(&connection, password.clone());
        davis_core::test_database(&login)?;
        davis_project::save_password(&id, &password)?;
        davis_core::remember_login(&id, login);
        Ok(davis_project::read_project(folder)?)
    })
    .await?
}

#[tauri::command]
pub async fn open_database_table(
    project: String,
    connection: String,
    schema: String,
    table: String,
) -> Result<OpenedTable, AppError> {
    spawn_blocking(move || {
        let folder = Path::new(&project);
        remember_logins(folder)?;
        let found = find_connection(folder, &connection)?;
        let label = table_label(&found, &schema, &table);
        let remote = RemoteTable {
            connection,
            schema,
            table,
        };
        Ok(davis_core::open_remote_table(
            remote,
            label,
            RowCount::Exact,
        )?)
    })
    .await?
}

// The last table going takes the connection and its password with it.
#[tauri::command]
pub async fn remove_database_table(
    project: String,
    id: String,
    schema: String,
    table: String,
) -> Result<Project, AppError> {
    spawn_blocking(move || {
        let folder = Path::new(&project);
        let mut connection = find_connection(folder, &id)?;
        connection
            .tables
            .retain(|kept| kept.schema != schema || kept.table != table);
        if connection.tables.is_empty() {
            davis_project::remove_connection(folder, &id)?;
            davis_project::forget_password(&id)?;
            davis_core::forget_login(&id);
        } else {
            davis_project::save_connection(folder, &connection)?;
        }
        Ok(davis_project::read_project(folder)?)
    })
    .await?
}
