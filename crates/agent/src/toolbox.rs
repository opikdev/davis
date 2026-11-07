use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use davis_ai::{ToolDefinition, ToolReply, Toolbox};
use davis_core::{QueryResult, QueryTable, Row, run_query};
use davis_project::{Block, BlockKind, Page, free_spot};
use serde_json::{Value, json};

use crate::answer::{Figure, FigureView, StoredQuery};
use crate::narration::Narration;
use crate::questions::QuestionBox;
use crate::steps::{AskStep, SendStep, StepKind, StepStatus};

pub(crate) const MAX_QUERIES: usize = 10;
const MAX_ROWS_SENT: usize = 50;
const MAX_CELL_CHARACTERS: usize = 200;
const CHART_SIZE: (u32, u32) = (6, 8);
const NUMBER_SIZE: (u32, u32) = (3, 4);
const TEXT_SIZE: (u32, u32) = (6, 3);

fn block_size(view: &str) -> Option<(u32, u32)> {
    match view {
        "bar" | "line" | "table" => Some(CHART_SIZE),
        "number" => Some(NUMBER_SIZE),
        _ => None,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn unique_block_id(page: &Page, base: &str) -> String {
    let number = page.blocks.len();
    format!("{base}-{number}")
}

#[derive(Default)]
pub(crate) struct Findings {
    pub(crate) queries: BTreeMap<String, StoredQuery>,
    pub(crate) figures: Vec<Figure>,
    questions_asked: usize,
    page_changes: usize,
}

pub(crate) struct OpenPage {
    pub(crate) project: PathBuf,
    pub(crate) id: String,
}

pub(crate) struct DataTools<'a> {
    pub(crate) tables: Vec<QueryTable>,
    pub(crate) page: Option<OpenPage>,
    pub(crate) stop: Arc<AtomicBool>,
    pub(crate) questions: &'a QuestionBox,
    pub(crate) send: SendStep<'a>,
    pub(crate) narration: &'a Narration<'a>,
    pub(crate) findings: Mutex<Findings>,
}

fn failed(text: impl Into<String>) -> ToolReply {
    ToolReply {
        text: text.into(),
        is_error: true,
    }
}

fn shortened(cell: &Option<String>) -> Option<String> {
    cell.as_ref().map(|value| {
        if value.chars().count() <= MAX_CELL_CHARACTERS {
            value.clone()
        } else {
            let start: String = value.chars().take(MAX_CELL_CHARACTERS).collect();
            format!("{start}…")
        }
    })
}

// This is everything the AI ever sees of the person's data.
pub(crate) fn sent_to_model(id: &str, result: &QueryResult) -> (Value, usize) {
    let rows: Vec<Row> = result
        .rows
        .iter()
        .take(MAX_ROWS_SENT)
        .map(|row| row.iter().map(shortened).collect())
        .collect();
    let columns: Vec<&str> = result
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    let sent = rows.len();
    let reply = json!({
        "query_id": id,
        "columns": columns,
        "rows": rows,
        "more_rows": result.rows.len() > sent || result.is_truncated,
    });
    (reply, sent)
}

// Only a problem with the query itself may reach the AI: other errors can quote the file.
fn explain_for_model(error: &davis_core::Error) -> String {
    match error {
        davis_core::Error::InvalidQuery(problem) => format!("The query is invalid: {problem}"),
        davis_core::Error::RejectedQuery => "Only one read-only SELECT is allowed.".to_owned(),
        davis_core::Error::SlowQuery => "That query took too long. Try a simpler one.".to_owned(),
        davis_core::Error::StoppedQuery => "The person stopped this.".to_owned(),
        _ => "That query could not run on this data.".to_owned(),
    }
}

impl DataTools<'_> {
    pub(crate) fn findings(&self) -> MutexGuard<'_, Findings> {
        self.findings.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn run_query(&self, input: &Value) -> ToolReply {
        let Some(sql) = input["sql"].as_str() else {
            return failed("Give the query as sql.");
        };
        let number = self.findings().queries.len() + 1;
        if number > MAX_QUERIES {
            return failed("That's the limit of queries for one question. Write your answer now.");
        }
        let id = format!("q{number}");
        let purpose = input["purpose"].as_str().unwrap_or("Run a query");
        let mut step = AskStep::new(
            format!("run-{id}"),
            StepKind::Run,
            StepStatus::Running,
            purpose,
        );
        step.body = Some(sql.to_owned());
        step.detail = Some("on this computer".to_owned());
        (self.send)(&step);

        let started = Instant::now();
        match run_query(&self.tables, sql, self.stop.clone()) {
            Ok(result) => {
                let (reply, sent) = sent_to_model(&id, &result);
                let rows = result.rows.len();
                let unit = if rows == 1 { "row" } else { "rows" };
                step.status = StepStatus::Done;
                step.detail = Some(format!(
                    "{rows} {unit} in {} ms",
                    started.elapsed().as_millis()
                ));
                step.query = Some(id.clone());
                step.sent_rows = Some(sent);
                (self.send)(&step);
                self.findings().queries.insert(
                    id,
                    StoredQuery {
                        sql: sql.to_owned(),
                        page_sql: None,
                        result,
                    },
                );
                ToolReply {
                    text: reply.to_string(),
                    is_error: false,
                }
            }
            Err(error) => {
                step.status = StepStatus::after_failure(error.code());
                step.detail = Some("couldn't run".to_owned());
                (self.send)(&step);
                failed(explain_for_model(&error))
            }
        }
    }

    fn show_result(&self, input: &Value) -> ToolReply {
        let id = input["query_id"].as_str().unwrap_or_default();
        let title = input["title"].as_str().unwrap_or_default();
        let view: Option<FigureView> = serde_json::from_value(input["view"].clone()).ok();
        let Some(view) = view else {
            return failed("Choose a view: bar, line, number or table.");
        };
        if title.is_empty() {
            return failed("Give the view a short title.");
        }
        let text_of = |name: &str| input[name].as_str().map(str::to_owned);
        let (x, y) = (text_of("x"), text_of("y"));

        let mut findings = self.findings();
        let Some(query) = findings.queries.get(id) else {
            return failed(format!("There is no query {id}."));
        };
        let columns = &query.result.columns;
        let has_column = |name: &Option<String>| {
            name.as_ref()
                .is_some_and(|name| columns.iter().any(|column| column.name == *name))
        };
        let needs_axes = matches!(view, FigureView::Bar | FigureView::Line);
        if needs_axes && !(has_column(&x) && has_column(&y)) {
            return failed("A chart needs x and y set to columns of that query.");
        }
        let number = findings.figures.len() + 1;
        findings.figures.push(Figure {
            query: id.to_owned(),
            title: title.to_owned(),
            view,
            x,
            y,
        });
        drop(findings);

        let mut step = AskStep::new(
            format!("show-{number}"),
            StepKind::Chart,
            StepStatus::Done,
            title,
        );
        step.detail = Some(view.label().to_owned());
        (self.send)(&step);
        ToolReply {
            text: "Shown to the person.".to_owned(),
            is_error: false,
        }
    }

    fn change_page(
        &self,
        label: &str,
        detail: &str,
        change: impl FnOnce(&mut Page) -> Result<(), String>,
    ) -> ToolReply {
        let Some(page) = &self.page else {
            return failed("No Page is open.");
        };
        let mut problem = None;
        let changed = davis_project::change_page(&page.project, &page.id, now_ms(), |page| {
            problem = change(page).err();
        });
        if let Some(problem) = problem {
            return failed(problem);
        }
        if changed.is_err() {
            return failed("That Page could not be saved.");
        }
        let number = {
            let mut findings = self.findings();
            findings.page_changes += 1;
            findings.page_changes
        };
        let mut step = AskStep::new(
            format!("page-{number}"),
            StepKind::Page,
            StepStatus::Done,
            label,
        );
        step.detail = Some(detail.to_owned());
        (self.send)(&step);
        ToolReply {
            text: "Done.".to_owned(),
            is_error: false,
        }
    }

    fn add_to_page(&self, input: &Value) -> ToolReply {
        let id = input["query_id"].as_str().unwrap_or_default();
        let title = input["title"].as_str().unwrap_or_default();
        let view = input["view"].as_str().unwrap_or_default();
        if title.is_empty() {
            return failed("Give the block a short title.");
        }
        let Some(size) = block_size(view) else {
            return failed("Choose a view: bar, line, number or table.");
        };
        let text_of = |name: &str| input[name].as_str().map(str::to_owned);
        let (x_column, y_column) = (text_of("x"), text_of("y"));
        let sql = {
            let findings = self.findings();
            let Some(query) = findings.queries.get(id) else {
                return failed(format!("There is no query {id}."));
            };
            let has_column = |name: &Option<String>| {
                name.as_ref()
                    .is_some_and(|name| query.result.columns.iter().any(|c| c.name == *name))
            };
            if matches!(view, "bar" | "line") && !(has_column(&x_column) && has_column(&y_column)) {
                return failed("A chart needs x and y set to columns of that query.");
            }
            query.page_sql.clone().unwrap_or_else(|| query.sql.clone())
        };
        let new_id = format!("b{}", now_ms());
        self.change_page(title, "added to the Page", |page| {
            let (x, y) = free_spot(&page.blocks, size.0, size.1);
            page.blocks.push(Block {
                id: unique_block_id(page, &new_id),
                kind: BlockKind::Figure,
                x,
                y,
                w: size.0,
                h: size.1,
                title: title.to_owned(),
                sql: Some(sql),
                view: Some(view.to_owned()),
                x_column,
                y_column,
                ..Block::default()
            });
            Ok(())
        })
    }

    fn add_text_to_page(&self, input: &Value) -> ToolReply {
        let text = input["text"].as_str().unwrap_or_default();
        if text.trim().is_empty() {
            return failed("Give the text to add.");
        }
        let new_id = format!("b{}", now_ms());
        self.change_page("Note", "added to the Page", |page| {
            let (x, y) = free_spot(&page.blocks, TEXT_SIZE.0, TEXT_SIZE.1);
            page.blocks.push(Block {
                id: unique_block_id(page, &new_id),
                kind: BlockKind::Text,
                x,
                y,
                w: TEXT_SIZE.0,
                h: TEXT_SIZE.1,
                text: Some(text.to_owned()),
                ..Block::default()
            });
            Ok(())
        })
    }

    fn remove_from_page(&self, input: &Value) -> ToolReply {
        let id = input["block_id"].as_str().unwrap_or_default();
        self.change_page("Removed a block", "from the Page", |page| {
            let before = page.blocks.len();
            page.blocks.retain(|block| block.id != id);
            if page.blocks.len() == before {
                Err(format!("There is no block {id}."))
            } else {
                Ok(())
            }
        })
    }

    fn rename_page(&self, input: &Value) -> ToolReply {
        let title = input["title"].as_str().unwrap_or_default().trim();
        if title.is_empty() {
            return failed("Give the Page a title.");
        }
        self.change_page(title, "new Page title", |page| {
            page.title = title.to_owned();
            Ok(())
        })
    }

    fn ask_user(&self, input: &Value) -> ToolReply {
        let Some(question) = input["question"].as_str() else {
            return failed("Give the question to ask.");
        };
        let number = {
            let mut findings = self.findings();
            findings.questions_asked += 1;
            findings.questions_asked
        };
        let mut step = AskStep::new(
            format!("ask-{number}"),
            StepKind::Question,
            StepStatus::Running,
            question,
        );
        step.options = input["options"].as_array().map(|options| {
            options
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        });
        (self.send)(&step);

        match self.questions.wait(&self.stop) {
            Some(reply) => {
                step.status = StepStatus::Done;
                step.detail = Some(reply.clone());
                (self.send)(&step);
                ToolReply {
                    text: reply,
                    is_error: false,
                }
            }
            None => {
                step.status = StepStatus::Stopped;
                (self.send)(&step);
                failed("The person stopped this.")
            }
        }
    }
}

fn page_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "add_to_page",
            description: "Add a chart, number or table from a query you ran to the open Page. \
                It stays linked to the query, so it updates with the data.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query_id": { "type": "string" },
                    "title": { "type": "string", "description": "Short sentence case title" },
                    "view": { "type": "string", "enum": ["bar", "line", "number", "table"] },
                    "x": { "type": "string", "description": "Column for a chart's x axis" },
                    "y": { "type": "string", "description": "Column for a chart's values" },
                },
                "required": ["query_id", "title", "view"],
            }),
        },
        ToolDefinition {
            name: "add_text_to_page",
            description: "Add a short note to the open Page. Type no numbers from the data here, \
                because a note won't update when the data does.",
            input_schema: json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"],
            }),
        },
        ToolDefinition {
            name: "remove_from_page",
            description: "Remove a block from the open Page.",
            input_schema: json!({
                "type": "object",
                "properties": { "block_id": { "type": "string" } },
                "required": ["block_id"],
            }),
        },
        ToolDefinition {
            name: "rename_page",
            description: "Change the title of the open Page.",
            input_schema: json!({
                "type": "object",
                "properties": { "title": { "type": "string" } },
                "required": ["title"],
            }),
        },
    ]
}

impl Toolbox for DataTools<'_> {
    fn definitions(&self) -> Vec<ToolDefinition> {
        let page_tools = if self.page.is_some() {
            page_tools()
        } else {
            Vec::new()
        };
        let mut tools = vec![
            ToolDefinition {
                name: "run_query",
                description: "Run one read-only DuckDB SELECT over the listed tables. Returns a \
                    query id, the columns, and up to 50 rows.",
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "sql": { "type": "string", "description": "One SELECT" },
                        "purpose": {
                            "type": "string",
                            "description": "What this checks, in a few plain words for someone \
                                who doesn't know SQL, like: Compare sales by region",
                        },
                    },
                    "required": ["sql", "purpose"],
                }),
            },
            ToolDefinition {
                name: "show_result",
                description: "Show the person a chart, number or table from a query you ran.",
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query_id": { "type": "string" },
                        "title": { "type": "string", "description": "Short sentence case title" },
                        "view": { "type": "string", "enum": ["bar", "line", "number", "table"] },
                        "x": { "type": "string", "description": "Column for a chart's x axis" },
                        "y": { "type": "string", "description": "Column for a chart's values" },
                    },
                    "required": ["query_id", "title", "view"],
                }),
            },
            ToolDefinition {
                name: "ask_user",
                description: "Ask the person a question and wait for their reply. Use only when \
                    you can't continue without their choice.",
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "question": { "type": "string" },
                        "options": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Two to four short replies to choose from",
                        },
                    },
                    "required": ["question"],
                }),
            },
        ];
        tools.extend(page_tools);
        tools
    }

    fn call(&self, name: &str, input: &Value) -> ToolReply {
        self.narration.tool_started();
        match name {
            "run_query" => self.run_query(input),
            "show_result" => self.show_result(input),
            "ask_user" => self.ask_user(input),
            "add_to_page" => self.add_to_page(input),
            "add_text_to_page" => self.add_text_to_page(input),
            "remove_from_page" => self.remove_from_page(input),
            "rename_page" => self.rename_page(input),
            _ => failed(format!("There is no tool called {name}.")),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::thread;
    use std::time::Duration;

    use davis_core::open_table;

    use super::*;

    static NEXT_FOLDER: AtomicU32 = AtomicU32::new(0);

    struct Folder(PathBuf);

    impl Folder {
        fn new() -> Self {
            let number = NEXT_FOLDER.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("davis-agent-{}-{number}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn table(&self, name: &str, content: &str) -> QueryTable {
            let path = self.0.join(format!("{name}.csv"));
            fs::write(&path, content).unwrap();
            QueryTable::new(name, open_table(&path.to_string_lossy()).unwrap().source)
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    type Steps = Mutex<Vec<AskStep>>;

    fn with_tools<T>(
        tables: Vec<QueryTable>,
        questions: &QuestionBox,
        steps: &Steps,
        stop: Arc<AtomicBool>,
        work: impl FnOnce(&DataTools) -> T,
    ) -> T {
        with_page(tables, None, questions, steps, stop, work)
    }

    fn with_page<T>(
        tables: Vec<QueryTable>,
        page: Option<OpenPage>,
        questions: &QuestionBox,
        steps: &Steps,
        stop: Arc<AtomicBool>,
        work: impl FnOnce(&DataTools) -> T,
    ) -> T {
        let send = |step: &AskStep| steps.lock().unwrap().push(step.clone());
        let narration = Narration::new(&send);
        let tools = DataTools {
            tables,
            page,
            stop,
            questions,
            send: &send,
            narration: &narration,
            findings: Mutex::default(),
        };
        work(&tools)
    }

    fn query(tools: &DataTools, sql: &str) -> ToolReply {
        tools.call("run_query", &json!({ "sql": sql, "purpose": "Check it" }))
    }

    const SALES: &str = "region,amount\nEMEA,10\nAPAC,20\n";

    #[test]
    fn a_query_returns_rows_and_keeps_the_full_result() {
        let folder = Folder::new();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(
            vec![folder.table("sales", SALES)],
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                let reply = query(tools, "SELECT region FROM sales ORDER BY amount");

                assert!(!reply.is_error);
                let sent: Value = serde_json::from_str(&reply.text).unwrap();
                assert_eq!(sent["query_id"], "q1");
                assert_eq!(sent["rows"], json!([["EMEA"], ["APAC"]]));
                assert_eq!(sent["more_rows"], false);
                assert_eq!(tools.findings().queries["q1"].result.rows.len(), 2);
            },
        );

        let steps = steps.lock().unwrap();
        assert_eq!(steps[0].status, StepStatus::Running);
        assert_eq!(steps[0].label, "Check it");
        assert_eq!(steps[1].status, StepStatus::Done);
        assert_eq!(steps[1].query.as_deref(), Some("q1"));
        assert_eq!(steps[1].sent_rows, Some(2));
    }

    #[test]
    fn the_ai_sees_at_most_fifty_rows_and_short_cells() {
        let folder = Folder::new();
        let long = "x".repeat(500);
        let mut csv = String::from("note\n");
        for _ in 0..80 {
            csv.push_str(&long);
            csv.push('\n');
        }
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(
            vec![folder.table("notes", &csv)],
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                let reply = query(tools, "SELECT note FROM notes");

                let sent: Value = serde_json::from_str(&reply.text).unwrap();
                let rows = sent["rows"].as_array().unwrap();
                assert_eq!(rows.len(), 50);
                assert_eq!(rows[0][0].as_str().unwrap().chars().count(), 201);
                assert_eq!(sent["more_rows"], true);
                assert_eq!(tools.findings().queries["q1"].result.rows.len(), 80);
            },
        );

        assert_eq!(steps.lock().unwrap().last().unwrap().sent_rows, Some(50));
    }

    #[test]
    fn a_query_problem_goes_back_so_the_ai_can_fix_it() {
        let folder = Folder::new();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(
            vec![folder.table("sales", SALES)],
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                let reply = query(tools, "SELECT nope FROM sales");

                assert!(reply.is_error);
                assert!(reply.text.contains("nope"));
                assert!(tools.findings().queries.is_empty());
                assert!(!query(tools, "SELECT 1").is_error);
                assert!(tools.findings().queries.contains_key("q1"));
            },
        );
    }

    #[test]
    fn a_problem_with_a_value_stays_on_this_computer() {
        let folder = Folder::new();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(
            vec![folder.table("notes", "a\nprivate-text\n")],
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                let reply = query(tools, "SELECT a::INTEGER FROM notes");

                assert!(reply.is_error);
                assert!(!reply.text.contains("private-text"));
            },
        );
    }

    #[test]
    fn writing_and_reading_other_files_are_refused() {
        let folder = Folder::new();
        let outside = folder.0.join("private.csv");
        fs::write(&outside, "secret\nCANARY\n").unwrap();
        let table = folder.table("sales", SALES);
        let target = table.source.path.clone();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(vec![table], &box_, &steps, Arc::default(), |tools| {
            let read = query(
                tools,
                &format!("SELECT * FROM read_csv('{}')", outside.display()),
            );
            let write = query(tools, &format!("COPY sales TO '{target}'"));

            assert!(read.is_error);
            assert!(!read.text.contains("CANARY"));
            assert!(write.is_error);
        });

        assert_eq!(fs::read_to_string(&target).unwrap(), SALES);
    }

    #[test]
    fn the_query_limit_tells_the_ai_to_finish() {
        let folder = Folder::new();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(
            vec![folder.table("sales", SALES)],
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                for _ in 0..MAX_QUERIES {
                    assert!(!query(tools, "SELECT 1").is_error);
                }
                let reply = query(tools, "SELECT 1");

                assert!(reply.is_error);
                assert!(reply.text.contains("Write your answer now"));
            },
        );
    }

    #[test]
    fn a_chart_must_use_real_columns_of_a_real_query() {
        let folder = Folder::new();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_tools(
            vec![folder.table("sales", SALES)],
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                query(tools, "SELECT region, amount FROM sales");
                let show = |input: Value| tools.call("show_result", &input);

                assert!(show(json!({ "query_id": "q9", "title": "T", "view": "table" })).is_error);
                assert!(show(json!({ "query_id": "q1", "title": "T", "view": "pie" })).is_error);
                assert!(
                    show(json!({
                        "query_id": "q1", "title": "T", "view": "bar", "x": "region", "y": "nope",
                    }))
                    .is_error
                );
                assert!(tools.findings().figures.is_empty());

                let shown = show(json!({
                    "query_id": "q1", "title": "Sales", "view": "bar",
                    "x": "region", "y": "amount",
                }));
                assert!(!shown.is_error);
                assert_eq!(tools.findings().figures[0].title, "Sales");
            },
        );
    }

    #[test]
    fn asking_waits_for_the_person_and_returns_their_reply() {
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        thread::scope(|scope| {
            scope.spawn(|| {
                while !box_.answer("Last year".to_owned()) {
                    thread::sleep(Duration::from_millis(5));
                }
            });
            with_tools(Vec::new(), &box_, &steps, Arc::default(), |tools| {
                let reply = tools.call(
                    "ask_user",
                    &json!({ "question": "Which year?", "options": ["Last year", "This year"] }),
                );

                assert_eq!(reply.text, "Last year");
                assert!(!reply.is_error);
            });
        });

        let steps = steps.lock().unwrap();
        assert_eq!(steps[0].status, StepStatus::Running);
        assert_eq!(steps[0].options.as_ref().unwrap().len(), 2);
        assert_eq!(steps[1].status, StepStatus::Done);
        assert_eq!(steps[1].detail.as_deref(), Some("Last year"));
    }

    #[test]
    fn stopping_ends_a_wait_for_the_person() {
        let steps = Steps::default();
        let box_ = QuestionBox::default();
        let stop = Arc::new(AtomicBool::new(true));

        with_tools(Vec::new(), &box_, &steps, stop, |tools| {
            let reply = tools.call("ask_user", &json!({ "question": "Which year?" }));

            assert!(reply.is_error);
        });

        assert_eq!(
            steps.lock().unwrap().last().unwrap().status,
            StepStatus::Stopped
        );
    }

    fn page_project(folder: &Folder) -> OpenPage {
        let project = davis_project::create_project(&folder.0, "Sales").unwrap();
        let project = PathBuf::from(project.path);
        davis_project::save_page(
            &project,
            &Page {
                id: "p1".to_owned(),
                title: "Overview".to_owned(),
                updated_at: 1,
                blocks: Vec::new(),
            },
        )
        .unwrap();
        OpenPage {
            project,
            id: "p1".to_owned(),
        }
    }

    #[test]
    fn page_tools_exist_only_when_a_page_is_open() {
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        let names = with_tools(Vec::new(), &box_, &steps, Arc::default(), |tools| {
            tools
                .definitions()
                .iter()
                .map(|tool| tool.name)
                .collect::<Vec<_>>()
        });
        assert_eq!(names, ["run_query", "show_result", "ask_user"]);

        with_tools(Vec::new(), &box_, &steps, Arc::default(), |tools| {
            let reply = tools.call("add_text_to_page", &json!({ "text": "Hello" }));
            assert!(reply.is_error);
        });
    }

    #[test]
    fn the_ai_can_add_a_query_to_the_open_page() {
        let folder = Folder::new();
        let page = page_project(&folder);
        let project = page.project.clone();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_page(
            vec![folder.table("sales", SALES)],
            Some(page),
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                query(tools, "SELECT region, amount FROM sales");
                let add = |view: &str| {
                    tools.call(
                        "add_to_page",
                        &json!({
                            "query_id": "q1", "title": "Sales", "view": view,
                            "x": "region", "y": "amount",
                        }),
                    )
                };

                assert!(!add("bar").is_error);
                assert!(!add("line").is_error);
                assert!(add("pie").is_error);
            },
        );

        let saved = davis_project::read_page(&project, "p1").unwrap();
        assert_eq!(saved.blocks.len(), 2);
        assert_ne!(saved.blocks[0].id, saved.blocks[1].id);
        assert_eq!(
            saved.blocks[0].sql.as_deref(),
            Some("SELECT region, amount FROM sales")
        );
        assert_eq!((saved.blocks[1].x, saved.blocks[1].y), (6, 0));
        assert_eq!(steps.lock().unwrap().last().unwrap().kind, StepKind::Page);
    }

    #[test]
    fn a_page_block_must_use_a_real_query_and_real_columns() {
        let folder = Folder::new();
        let page = page_project(&folder);
        let project = page.project.clone();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_page(
            vec![folder.table("sales", SALES)],
            Some(page),
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                query(tools, "SELECT region FROM sales");
                let add = |input: Value| tools.call("add_to_page", &input);

                assert!(add(json!({ "query_id": "q9", "title": "T", "view": "table" })).is_error);
                assert!(
                    add(json!({
                        "query_id": "q1", "title": "T", "view": "bar", "x": "region", "y": "nope",
                    }))
                    .is_error
                );
            },
        );

        assert!(
            davis_project::read_page(&project, "p1")
                .unwrap()
                .blocks
                .is_empty()
        );
    }

    #[test]
    fn the_ai_can_note_rename_and_remove() {
        let folder = Folder::new();
        let page = page_project(&folder);
        let project = page.project.clone();
        let steps = Steps::default();
        let box_ = QuestionBox::default();

        with_page(
            Vec::new(),
            Some(page),
            &box_,
            &steps,
            Arc::default(),
            |tools| {
                assert!(
                    !tools
                        .call("add_text_to_page", &json!({ "text": "Read me" }))
                        .is_error
                );
                assert!(
                    !tools
                        .call("rename_page", &json!({ "title": "Q3" }))
                        .is_error
                );
                let id = davis_project::read_page(&project, "p1").unwrap().blocks[0]
                    .id
                    .clone();
                assert!(
                    tools
                        .call("remove_from_page", &json!({ "block_id": "nope" }))
                        .is_error
                );
                assert!(
                    !tools
                        .call("remove_from_page", &json!({ "block_id": id }))
                        .is_error
                );
            },
        );

        let saved = davis_project::read_page(&project, "p1").unwrap();
        assert_eq!(saved.title, "Q3");
        assert!(saved.blocks.is_empty());
    }

    #[test]
    fn notes_end_when_a_tool_starts_and_the_last_text_stays_open() {
        let folder = Folder::new();
        let steps = Steps::default();
        let box_ = QuestionBox::default();
        let table = folder.table("sales", SALES);

        let send = |step: &AskStep| steps.lock().unwrap().push(step.clone());
        let narration = Narration::new(&send);
        let tools = DataTools {
            tables: vec![table],
            page: None,
            stop: Arc::default(),
            questions: &box_,
            send: &send,
            narration: &narration,
            findings: Mutex::default(),
        };

        narration.hear(davis_ai::ModelEvent::Thinking);
        narration.hear(davis_ai::ModelEvent::Text("Checking ".to_owned()));
        narration.hear(davis_ai::ModelEvent::Text("sales.".to_owned()));
        query(&tools, "SELECT 1");
        narration.hear(davis_ai::ModelEvent::Thinking);
        narration.hear(davis_ai::ModelEvent::Text("The answer".to_owned()));

        let steps = steps.lock().unwrap();
        let notes: Vec<&AskStep> = steps.iter().filter(|s| s.kind == StepKind::Note).collect();
        let first = notes.iter().rfind(|s| s.id == "note-1").unwrap();
        assert_eq!(first.status, StepStatus::Done);
        assert_eq!(first.body.as_deref(), Some("Checking sales."));
        assert_eq!(notes.last().unwrap().id, "note-2");
        assert_eq!(notes.last().unwrap().status, StepStatus::Running);
    }
}
