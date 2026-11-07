use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use davis_agent::{AgentAnswer, AgentRequest, AskStep, ProjectTable, QuestionBox};
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::commands::ai::settings_path;
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

pub(crate) fn project_tables(project: &Path) -> Result<Vec<ProjectTable>, AppError> {
    let mut tables: Vec<ProjectTable> = Vec::new();
    for file in davis_project::read_project(project)?.files {
        // One unreadable file shouldn't stop questions about the others.
        let Ok(opened) = davis_core::open_table(&file.path) else {
            continue;
        };
        let taken: Vec<String> = tables.iter().map(|table| table.name.clone()).collect();
        tables.push(ProjectTable {
            name: davis_core::table_name(&file.name, &taken),
            opened,
        });
    }
    Ok(tables)
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
        let tables = project_tables(Path::new(&project))?;
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
