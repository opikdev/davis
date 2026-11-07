use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use davis_ai::{AskRequest, ChartKind, ChartPlan, PlanProgress, QueryPlan, plan_query};
use davis_core::{QueryResult, TableSource, run_query};
use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::commands::ai::settings_path;
use crate::error::AppError;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableAnswer {
    title: String,
    sql: Option<String>,
    chart: Option<ChartPlan>,
    result: Option<QueryResult>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepKind {
    Read,
    Think,
    Write,
    Run,
    Chart,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Running,
    Done,
    Failed,
    Stopped,
}

impl StepStatus {
    fn after_failure(code: &str) -> Self {
        if code == "stopped" {
            Self::Stopped
        } else {
            Self::Failed
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskStep {
    id: String,
    kind: StepKind,
    status: StepStatus,
    label: String,
    detail: Option<String>,
    body: Option<String>,
}

impl AskStep {
    fn new(id: String, kind: StepKind, status: StepStatus, label: &str) -> Self {
        Self {
            id,
            kind,
            status,
            label: label.to_owned(),
            detail: None,
            body: None,
        }
    }
}

#[derive(Default)]
pub struct AskRegistry(Mutex<HashMap<u64, Arc<AtomicBool>>>);

impl AskRegistry {
    fn start(&self, turn: u64) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        self.turns().insert(turn, stop.clone());
        stop
    }

    fn finish(&self, turn: u64) {
        self.turns().remove(&turn);
    }

    fn turns(&self) -> MutexGuard<'_, HashMap<u64, Arc<AtomicBool>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[tauri::command]
pub async fn ask_about_table(
    app: AppHandle,
    registry: State<'_, AskRegistry>,
    turn: u64,
    source: TableSource,
    request: AskRequest,
    on_step: Channel<AskStep>,
) -> Result<TableAnswer, AppError> {
    let path = settings_path(&app)?;
    let stop = registry.start(turn);
    let outcome = spawn_blocking(move || answer(&source, &request, &path, &stop, &on_step)).await?;
    registry.finish(turn);
    outcome
}

#[tauri::command]
pub fn stop_asking(registry: State<'_, AskRegistry>, turn: u64) {
    if let Some(stop) = registry.turns().get(&turn) {
        stop.store(true, Ordering::Relaxed);
    }
}

fn answer(
    source: &TableSource,
    request: &AskRequest,
    settings_path: &Path,
    stop: &Arc<AtomicBool>,
    on_step: &Channel<AskStep>,
) -> Result<TableAnswer, AppError> {
    let send = |step: &AskStep| {
        let _ = on_step.send(step.clone());
    };
    let mut columns = AskStep::new(
        "read".to_owned(),
        StepKind::Read,
        StepStatus::Done,
        "Read columns",
    );
    columns.detail = Some(format!("{} names and types", request.columns.len()));
    send(&columns);

    let mut plan = plan_with_steps(request, None, settings_path, stop, 1, &send)?;
    let Some(sql) = plan.sql.clone() else {
        return Ok(TableAnswer {
            title: plan.title,
            sql: None,
            chart: None,
            result: None,
        });
    };

    let result = match run_with_step(source, &sql, stop, 1, &send) {
        Err(davis_core::Error::InvalidQuery(problem)) => {
            let correction = Some((sql.as_str(), problem.as_str()));
            plan = plan_with_steps(request, correction, settings_path, stop, 2, &send)?;
            let corrected = plan.sql.as_deref().unwrap_or(&sql);
            run_with_step(source, corrected, stop, 2, &send)?
        }
        outcome => outcome?,
    };

    if let Some(chart) = &plan.chart {
        let label = match chart.kind {
            ChartKind::Bar => "Draw bar chart",
            ChartKind::Line => "Draw line chart",
        };
        send(&AskStep::new(
            "chart".to_owned(),
            StepKind::Chart,
            StepStatus::Done,
            label,
        ));
    }

    Ok(TableAnswer {
        title: plan.title,
        sql: plan.sql,
        chart: plan.chart,
        result: Some(result),
    })
}

fn plan_with_steps(
    request: &AskRequest,
    correction: Option<(&str, &str)>,
    settings_path: &Path,
    stop: &AtomicBool,
    attempt: u32,
    send: &dyn Fn(&AskStep),
) -> Result<QueryPlan, AppError> {
    let mut think = AskStep::new(
        format!("think-{attempt}"),
        StepKind::Think,
        StepStatus::Running,
        "Thinking",
    );
    let mut write = AskStep::new(
        format!("write-{attempt}"),
        StepKind::Write,
        StepStatus::Running,
        "Writing query",
    );
    let mut is_writing = false;
    send(&think);

    let planned =
        plan_query(
            request,
            correction,
            settings_path,
            stop,
            &mut |progress| match progress {
                PlanProgress::Thinking(text) => {
                    think.body.get_or_insert_default().push_str(&text);
                    send(&think);
                }
                PlanProgress::Writing(sql) => {
                    if !is_writing {
                        is_writing = true;
                        think.status = StepStatus::Done;
                        send(&think);
                    }
                    write.body = Some(sql);
                    send(&write);
                }
            },
        );

    match planned {
        Ok(plan) => {
            if !is_writing {
                think.status = StepStatus::Done;
                send(&think);
            }
            if let Some(sql) = &plan.sql {
                write.status = StepStatus::Done;
                write.body = Some(sql.clone());
                send(&write);
            }
            Ok(plan)
        }
        Err(error) => {
            let step = if is_writing { &mut write } else { &mut think };
            step.status = StepStatus::after_failure(error.code());
            send(step);
            Err(error.into())
        }
    }
}

fn run_with_step(
    source: &TableSource,
    sql: &str,
    stop: &Arc<AtomicBool>,
    attempt: u32,
    send: &dyn Fn(&AskStep),
) -> Result<QueryResult, davis_core::Error> {
    let mut step = AskStep::new(
        format!("run-{attempt}"),
        StepKind::Run,
        StepStatus::Running,
        "Running query",
    );
    step.detail = Some("on this computer".to_owned());
    send(&step);

    let started = Instant::now();
    let outcome = run_query(source, sql, stop.clone());
    match &outcome {
        Ok(result) => {
            step.status = StepStatus::Done;
            step.label = "Ran query".to_owned();
            let rows = result.rows.len();
            let unit = if rows == 1 { "row" } else { "rows" };
            step.detail = Some(format!(
                "{rows} {unit} in {} ms",
                started.elapsed().as_millis()
            ));
        }
        Err(error) => step.status = StepStatus::after_failure(error.code()),
    }
    send(&step);
    outcome
}
