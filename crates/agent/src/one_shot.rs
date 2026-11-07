use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use davis_ai::{AskColumn, AskRequest, AskTurn, ChartKind, PlanProgress, QueryPlan, plan_query};
use davis_core::{QueryResult, QueryTable, run_query};

use crate::answer::{AgentAnswer, AgentRequest, Figure, FigureView, StoredQuery};
use crate::prompt::ProjectTable;
use crate::steps::{AskStep, SendStep, StepKind, StepStatus};
use crate::{AgentError, Result};

const ONE_SHOT_TABLE: &str = "data";

// Tools that can't be locked down get one question and one query, about the open file.
pub(crate) fn answer_once(
    tables: &[ProjectTable],
    request: &AgentRequest,
    settings_path: &Path,
    stop: &Arc<AtomicBool>,
    send: SendStep,
) -> Result<AgentAnswer> {
    let table = request
        .active_table
        .as_ref()
        .and_then(|name| tables.iter().find(|table| table.opened.name == *name))
        .or_else(|| tables.first())
        .ok_or(AgentError::Ai(davis_ai::Error::UnclearReply(
            "Davis".to_owned(),
        )))?;
    let ask = AskRequest {
        question: request.question.clone(),
        columns: table
            .opened
            .columns
            .iter()
            .map(|column| AskColumn {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
            })
            .collect(),
        history: request
            .history
            .iter()
            .flat_map(|turn| {
                turn.queries.first().map(|sql| AskTurn {
                    question: turn.question.clone(),
                    sql: sql.clone(),
                })
            })
            .collect(),
    };
    let query_table = [QueryTable::new(ONE_SHOT_TABLE, table.opened.source.clone())];

    let mut plan = plan_with_steps(&ask, None, settings_path, stop, 1, send)?;
    let Some(sql) = plan.sql.clone() else {
        return Ok(AgentAnswer::plain(plan.title));
    };
    let (sql, result) = match run_with_step(&query_table, &sql, stop, 1, send) {
        Err(davis_core::Error::InvalidQuery(problem)) => {
            let correction = Some((sql.as_str(), problem.as_str()));
            plan = plan_with_steps(&ask, correction, settings_path, stop, 2, send)?;
            let corrected = plan.sql.clone().unwrap_or(sql.clone());
            let result = run_with_step(&query_table, &corrected, stop, 2, send)?;
            (corrected, result)
        }
        outcome => (sql.clone(), outcome?),
    };
    Ok(answer_from(plan, sql, result, &table.name, send))
}

fn answer_from(
    plan: QueryPlan,
    sql: String,
    result: QueryResult,
    table: &str,
    send: SendStep,
) -> AgentAnswer {
    const QUERY_ID: &str = "q1";
    let (view, x, y) = match &plan.chart {
        Some(chart) => {
            let view = match chart.kind {
                ChartKind::Bar => FigureView::Bar,
                ChartKind::Line => FigureView::Line,
            };
            (view, Some(chart.x.clone()), Some(chart.y.clone()))
        }
        None if result.rows.len() == 1 && result.columns.len() == 1 => {
            (FigureView::Number, None, None)
        }
        None => (FigureView::Table, None, None),
    };
    let mut shown = AskStep::new(
        "show-1",
        StepKind::Chart,
        StepStatus::Done,
        plan.title.clone(),
    );
    shown.detail = Some(view.label().to_owned());
    send(&shown);

    AgentAnswer {
        figures: vec![Figure {
            query: QUERY_ID.to_owned(),
            title: plan.title.clone(),
            view,
            x,
            y,
        }],
        queries: BTreeMap::from([(
            QUERY_ID.to_owned(),
            StoredQuery {
                page_sql: Some(format!(
                    "WITH {ONE_SHOT_TABLE} AS (SELECT * FROM \"{table}\") {sql}"
                )),
                sql,
                result,
            },
        )]),
        title: plan.title,
        text: String::new(),
        follow_ups: Vec::new(),
    }
}

fn plan_with_steps(
    request: &AskRequest,
    correction: Option<(&str, &str)>,
    settings_path: &Path,
    stop: &AtomicBool,
    attempt: u32,
    send: SendStep,
) -> Result<QueryPlan> {
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
    tables: &[QueryTable],
    sql: &str,
    stop: &Arc<AtomicBool>,
    attempt: u32,
    send: SendStep,
) -> davis_core::Result<QueryResult> {
    let mut step = AskStep::new(
        format!("run-{attempt}"),
        StepKind::Run,
        StepStatus::Running,
        "Running query",
    );
    step.detail = Some("on this computer".to_owned());
    send(&step);

    let started = Instant::now();
    let outcome = run_query(tables, sql, stop.clone());
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
