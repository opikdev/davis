use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use davis_agent::{AgentAnswer, AgentRequest, AskStep, ProjectTable, QuestionBox};
use davis_core::{RemoteTable, RowCount};
use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::commands::ai::settings_path;
use crate::commands::database::{remember_logins, table_label};
use crate::error::AppError;

#[derive(Default, Clone)]
struct AskRun {
    stop: Arc<AtomicBool>,
    questions: Arc<QuestionBox>,
}

#[derive(Default)]
pub struct AskRegistry(Mutex<HashMap<u64, AskRun>>);

impl AskRegistry {
    fn start(&self, turn: u64) -> AskRun {
        let run = AskRun::default();
        self.turns().insert(turn, run.clone());
        run
    }

    fn finish(&self, turn: u64) {
        self.turns().remove(&turn);
    }

    fn turns(&self) -> MutexGuard<'_, HashMap<u64, AskRun>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfflineDatabase {
    pub id: String,
    pub name: String,
    pub tables: Vec<String>,
    pub reason: String,
    pub needs_password: bool,
}

pub(crate) fn project_tables(project: &Path) -> Result<Vec<ProjectTable>, AppError> {
    Ok(reachable_tables(project)?.0)
}

// A database that can't be reached leaves the files usable, and is reported
// once instead of failing every table. Its tables keep their names, so the
// others don't change name while it's away.
pub(crate) fn reachable_tables(
    project: &Path,
) -> Result<(Vec<ProjectTable>, Vec<OfflineDatabase>), AppError> {
    let mut tables: Vec<ProjectTable> = Vec::new();
    let mut taken: Vec<String> = Vec::new();
    let mut offline: Vec<OfflineDatabase> = Vec::new();
    let found = davis_project::read_project(project)?;
    for file in found.files {
        // One unreadable file shouldn't stop questions about the others.
        let Ok(opened) = davis_core::open_table(&file.path) else {
            continue;
        };
        let name = davis_core::table_name(&file.name, &taken);
        taken.push(name.clone());
        tables.push(ProjectTable { name, opened });
    }
    remember_logins(project)?;
    for connection in &found.connections {
        let mut failure = (!davis_core::has_login(&connection.id))
            .then(|| davis_core::Error::DisconnectedDatabase);
        let mut missing = Vec::new();
        for connected in &connection.tables {
            let name = davis_core::table_name(&connected.table, &taken);
            taken.push(name.clone());
            if failure.is_some() {
                missing.push(name);
                continue;
            }
            let remote = RemoteTable {
                connection: connection.id.clone(),
                schema: connected.schema.clone(),
                table: connected.table.clone(),
            };
            let label = table_label(connection, &connected.schema, &connected.table);
            match davis_core::open_remote_table(remote, label, RowCount::Estimated) {
                Ok(opened) => tables.push(ProjectTable { name, opened }),
                Err(
                    error @ (davis_core::Error::UnreachableDatabase(_)
                    | davis_core::Error::DisconnectedDatabase
                    | davis_core::Error::MissingDatabaseSupport),
                ) => {
                    failure = Some(error);
                    missing.push(name);
                }
                Err(error) => eprintln!("Skipped {}: {error}", connected.table),
            }
        }
        if let Some(error) = failure {
            offline.push(OfflineDatabase {
                id: connection.id.clone(),
                name: connection.name.clone(),
                tables: missing,
                needs_password: matches!(error, davis_core::Error::DisconnectedDatabase),
                reason: error.to_string(),
            });
        }
    }
    Ok((tables, offline))
}

#[tauri::command]
pub async fn ask_project(
    app: AppHandle,
    registry: State<'_, AskRegistry>,
    turn: u64,
    project: String,
    request: AgentRequest,
    on_step: Channel<AskStep>,
) -> Result<AgentAnswer, AppError> {
    let settings = settings_path(&app)?;
    let run = registry.start(turn);
    let outcome = spawn_blocking(move || {
        let (tables, offline) = reachable_tables(Path::new(&project))?;
        let mut request = request;
        request.unavailable = offline
            .iter()
            .flat_map(|database| database.tables.iter().cloned())
            .collect();
        let send = |step: &AskStep| {
            let _ = on_step.send(step.clone());
        };
        Ok::<_, AppError>(davis_agent::answer_question(
            &tables,
            &request,
            Path::new(&project),
            &settings,
            &run.stop,
            &run.questions,
            &send,
        )?)
    })
    .await?;
    registry.finish(turn);
    outcome
}

#[tauri::command]
pub fn stop_asking(registry: State<'_, AskRegistry>, turn: u64) {
    if let Some(run) = registry.turns().get(&turn) {
        run.stop.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn answer_agent(registry: State<'_, AskRegistry>, turn: u64, reply: String) -> bool {
    registry
        .turns()
        .get(&turn)
        .is_some_and(|run| run.questions.answer(reply))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use davis_core::{DatabaseKind, DatabaseLogin, SslMode};
    use davis_project::{ConnectedTable, DatabaseConnection};

    use super::*;

    // Needs the Postgres extension, so it runs where the live database tests do.
    #[test]
    fn an_offline_database_is_reported_and_the_files_still_load() {
        if std::env::var("DAVIS_TEST_POSTGRES").is_err() {
            return;
        }
        let extensions = std::env::temp_dir().join("davis-test-extensions");
        davis_core::set_extension_folder(&extensions);
        davis_core::install_database_support(DatabaseKind::Postgres).unwrap();
        let parent = std::env::temp_dir().join(format!("davis-offline-{}", std::process::id()));
        let project = davis_project::create_project(&parent, "Sales").unwrap();
        let folder = Path::new(&project.path);
        fs::write(
            folder.join("data").join("sales.csv"),
            "region,amount\nEMEA,1\n",
        )
        .unwrap();
        let connection = DatabaseConnection {
            id: "offline-test".to_owned(),
            kind: DatabaseKind::Postgres,
            name: "shop".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: 1,
            database: "shop".to_owned(),
            user: "reader".to_owned(),
            ssl: SslMode::Disable,
            tables: vec![ConnectedTable {
                schema: "public".to_owned(),
                table: "orders".to_owned(),
            }],
        };
        davis_project::save_connection(folder, &connection).unwrap();
        davis_core::remember_login(
            "offline-test",
            DatabaseLogin {
                kind: DatabaseKind::Postgres,
                host: "127.0.0.1".to_owned(),
                port: 1,
                database: "shop".to_owned(),
                user: "reader".to_owned(),
                password: "unused".to_owned(),
                ssl: SslMode::Disable,
            },
        );

        let (tables, offline) = reachable_tables(folder).unwrap();
        fs::remove_dir_all(&parent).unwrap();

        let names: Vec<&str> = tables.iter().map(|table| table.name.as_str()).collect();
        assert_eq!(names, ["sales"]);
        assert_eq!(offline.len(), 1);
        assert_eq!(offline[0].name, "shop");
        assert_eq!(offline[0].tables, ["orders"]);
        assert!(!offline[0].needs_password);
        assert!(
            offline[0].reason.contains("The server didn't answer"),
            "{}",
            offline[0].reason
        );
    }
}
