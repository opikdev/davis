use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::table::{Column, Row, TableSource, connect, kind_of, quoted, scan};
use crate::{Error, Result};

const MAX_RESULT_ROWS: usize = 1_000;
const QUERY_TIME_LIMIT: Duration = Duration::from_secs(60);
const STOP_CHECK: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterRule {
    OneOf(Vec<String>),
    Between {
        from: Option<String>,
        to: Option<String>,
    },
}

impl FilterRule {
    fn is_active(&self) -> bool {
        match self {
            Self::OneOf(values) => !values.is_empty(),
            Self::Between { from, to } => from.is_some() || to.is_some(),
        }
    }

    // Comparing the leading characters lets "2026-03" match any day in that month.
    fn condition(&self, column: &str) -> String {
        let text = format!("{column}::VARCHAR");
        match self {
            Self::OneOf(values) => {
                let values = values
                    .iter()
                    .map(|value| quoted(value))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{text} IN ({values})")
            }
            Self::Between { from, to } => {
                let bound = |value: &str, comparison: &str| {
                    format!(
                        "left({text}, {}) {comparison} {}",
                        value.chars().count(),
                        quoted(value)
                    )
                };
                from.iter()
                    .map(|value| bound(value, ">="))
                    .chain(to.iter().map(|value| bound(value, "<=")))
                    .collect::<Vec<_>>()
                    .join(" AND ")
            }
        }
    }
}

// A filter on one table also narrows the tables that link to it, so
// "region = EMEA" on customers reaches a total worked out from orders alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedFilter {
    pub source: TableSource,
    pub key: String,
    pub column: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableFilter {
    pub column: String,
    pub rule: FilterRule,
    pub through: Option<LinkedFilter>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryTable {
    pub name: String,
    pub source: TableSource,
    pub filters: Vec<TableFilter>,
}

impl QueryTable {
    pub fn new(name: impl Into<String>, source: TableSource) -> Self {
        Self {
            name: name.into(),
            source,
            filters: Vec::new(),
        }
    }
}

fn quoted_name(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

// Filtering the table itself means every query over it agrees, aggregates included.
fn filter_clause(filters: &[TableFilter]) -> String {
    let conditions: Vec<String> = filters
        .iter()
        .filter(|filter| filter.rule.is_active())
        .map(|filter| {
            let column = quoted_name(&filter.column);
            match &filter.through {
                None => filter.rule.condition(&column),
                Some(link) => format!(
                    "{column}::VARCHAR IN (SELECT {}::VARCHAR FROM {} WHERE {})",
                    quoted_name(&link.key),
                    scan(&link.source, false),
                    filter.rule.condition(&quoted_name(&link.column)),
                ),
            }
        })
        .collect();
    if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<Column>,
    pub rows: Vec<Row>,
    pub is_truncated: bool,
}

// File names can hold anything, so each becomes a plain name SQL can use unquoted.
pub fn table_name(file_name: &str, taken: &[String]) -> String {
    let stem = file_name.split('.').next().unwrap_or(file_name);
    let mut plain: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    plain = plain.trim_matches('_').to_owned();
    if !plain.starts_with(|character: char| character.is_ascii_alphabetic()) {
        plain = format!("t_{plain}");
    }
    (1..)
        .map(|number| match number {
            1 => plain.clone(),
            _ => format!("{plain}_{number}"),
        })
        .find(|name| !taken.contains(name))
        .expect("an unused number always exists")
}

pub fn run_query(tables: &[QueryTable], sql: &str, stop: Arc<AtomicBool>) -> Result<QueryResult> {
    run_query_within(tables, sql, QUERY_TIME_LIMIT, stop)
}

fn run_query_within(
    tables: &[QueryTable],
    sql: &str,
    limit: Duration,
    stop: Arc<AtomicBool>,
) -> Result<QueryResult> {
    let connection = locked_connection(tables)?;
    let sql = sql.trim().trim_end_matches(';').trim();
    require_one_select(&connection, sql)?;

    let (finished, wait) = mpsc::channel::<()>();
    let interrupt = connection.interrupt_handle();
    let deadline = Instant::now() + limit;
    let watched = stop.clone();
    thread::spawn(move || {
        while wait.recv_timeout(STOP_CHECK) == Err(mpsc::RecvTimeoutError::Timeout) {
            if watched.load(Ordering::Relaxed) || Instant::now() >= deadline {
                interrupt.interrupt();
                return;
            }
        }
    });
    let result = read_result(&connection, sql);
    drop(finished);
    result.map_err(|error| {
        if stop.load(Ordering::Relaxed) {
            Error::StoppedQuery
        } else {
            explain_failure(error)
        }
    })
}

// The views are created before lockdown because lockdown can't be undone. The files
// stay writable through `allowed_paths`, so `require_one_select` is what protects them.
pub(crate) fn locked_connection(tables: &[QueryTable]) -> Result<Connection> {
    let connection = connect()?;
    let views: String = tables
        .iter()
        .map(|table| {
            format!(
                "CREATE VIEW \"{}\" AS SELECT * FROM {}{};\n",
                table.name.replace('"', "\"\""),
                scan(&table.source, false),
                filter_clause(&table.filters)
            )
        })
        .collect();
    let paths = tables
        .iter()
        .map(|table| quoted(&table.source.path))
        .collect::<Vec<_>>()
        .join(", ");
    connection.execute_batch(&format!(
        "{views}SET allowed_paths = [{paths}];
         SET enable_external_access = false;
         SET lock_configuration = true;"
    ))?;
    Ok(connection)
}

fn require_one_select(connection: &Connection, sql: &str) -> Result<()> {
    let serialized: String = connection.query_row(
        "SELECT json_serialize_sql(?)::VARCHAR",
        params![sql],
        |row| row.get(0),
    )?;
    let parsed: Value = serde_json::from_str(&serialized).map_err(|_| Error::RejectedQuery)?;
    let statements = parsed["statements"].as_array().map_or(0, Vec::len);
    if parsed["error"] == Value::Bool(true) {
        let is_syntax = parsed["error_type"] == "parser";
        return Err(if is_syntax {
            Error::InvalidQuery(parsed["error_message"].as_str().unwrap_or("").to_owned())
        } else {
            Error::RejectedQuery
        });
    }
    if statements == 1 {
        Ok(())
    } else {
        Err(Error::RejectedQuery)
    }
}

fn read_result(connection: &Connection, sql: &str) -> Result<QueryResult> {
    let columns = read_columns(connection, sql)?;
    let mut statement = connection.prepare(&format!(
        "SELECT COLUMNS(*)::VARCHAR FROM ({sql}) LIMIT {}",
        MAX_RESULT_ROWS + 1
    ))?;
    let mut rows = statement.query([])?;
    let mut read = Vec::new();
    while let Some(row) = rows.next()? {
        let values = (0..columns.len())
            .map(|index| row.get(index))
            .collect::<duckdb::Result<Row>>()?;
        read.push(values);
    }
    let is_truncated = read.len() > MAX_RESULT_ROWS;
    read.truncate(MAX_RESULT_ROWS);
    Ok(QueryResult {
        columns,
        rows: read,
        is_truncated,
    })
}

fn read_columns(connection: &Connection, sql: &str) -> Result<Vec<Column>> {
    let mut statement = connection.prepare(&format!("DESCRIBE SELECT * FROM ({sql})"))?;
    let columns = statement
        .query_map([], |row| {
            let data_type: String = row.get(1)?;
            Ok(Column {
                name: row.get(0)?,
                kind: kind_of(&data_type),
                data_type,
            })
        })?
        .collect::<duckdb::Result<_>>()?;
    Ok(columns)
}

// Only mistakes about the query go back to the AI. Other errors can quote file contents.
fn explain_failure(error: Error) -> Error {
    let Error::Duckdb(failure) = &error else {
        return error;
    };
    let message = failure.to_string();
    if ["Binder Error", "Parser Error", "Catalog Error"]
        .iter()
        .any(|kind| message.starts_with(kind))
    {
        return Error::InvalidQuery(message);
    }
    if message.contains("INTERRUPT") || message.contains("Interrupted") {
        return Error::SlowQuery;
    }
    eprintln!("Query failed: {message}");
    Error::FailedQuery
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::table::open_table;

    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("davis-query-{}-{name}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, content: &str) -> String {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path.to_string_lossy().into_owned()
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const SALES: &str = "region,amount\nEMEA,10\nEMEA,5\nAPAC,20\n";

    fn sales(folder: &Folder) -> (String, TableSource) {
        let path = folder.write("sales.csv", SALES);
        let source = open_table(&path).unwrap().source;
        (path, source)
    }

    fn data_table(source: &TableSource) -> Vec<QueryTable> {
        vec![QueryTable::new("data", source.clone())]
    }

    fn ask(source: &TableSource, sql: &str) -> Result<QueryResult> {
        run_query(&data_table(source), sql, Arc::new(AtomicBool::new(false)))
    }

    fn table(folder: &Folder, name: &str, content: &str) -> QueryTable {
        let path = folder.write(&format!("{name}.csv"), content);
        QueryTable::new(name, open_table(&path).unwrap().source)
    }

    fn code(source: &TableSource, sql: &str) -> &'static str {
        ask(source, sql).unwrap_err().code()
    }

    fn cells(values: &[&str]) -> Row {
        values
            .iter()
            .map(|value| Some((*value).to_owned()))
            .collect()
    }

    #[test]
    fn answers_a_question_about_the_table() {
        let folder = Folder::new("answer");
        let (_, source) = sales(&folder);

        let result = ask(
            &source,
            "SELECT region, sum(amount) AS total FROM data GROUP BY 1 ORDER BY total DESC;",
        )
        .unwrap();

        assert_eq!(
            result.rows,
            [cells(&["APAC", "20"]), cells(&["EMEA", "15"])]
        );
        assert_eq!(result.columns[0].name, "region");
        assert_eq!(result.columns[1].kind, crate::ColumnKind::Number);
        assert!(!result.is_truncated);
    }

    #[test]
    fn accepts_common_table_expressions() {
        let folder = Folder::new("cte");
        let (_, source) = sales(&folder);

        let result = ask(
            &source,
            "WITH t AS (SELECT count(*) AS n FROM data) SELECT n FROM t",
        )
        .unwrap();

        assert_eq!(result.rows, [cells(&["3"])]);
    }

    #[test]
    fn caps_large_results() {
        let folder = Folder::new("cap");
        let (_, source) = sales(&folder);

        let result = ask(&source, "SELECT * FROM range(5000)").unwrap();

        assert_eq!(result.rows.len(), MAX_RESULT_ROWS);
        assert!(result.is_truncated);
    }

    #[test]
    fn nothing_can_change_the_users_file() {
        let folder = Folder::new("protect");
        let (path, source) = sales(&folder);
        let attempts = [
            format!("COPY (SELECT 1) TO {} (FORMAT csv)", quoted(&path)),
            format!(
                "COPY (SELECT 1) TO {} (FORMAT csv, USE_TMP_FILE false)",
                quoted(&path)
            ),
            format!(
                "SELECT 1; COPY (SELECT 1) TO {} (FORMAT csv, USE_TMP_FILE false)",
                quoted(&path)
            ),
            format!(
                "SELECT * FROM query('COPY (SELECT 1) TO {} (FORMAT csv, USE_TMP_FILE false)')",
                quoted(&path).replace('\'', "''")
            ),
            format!(
                "SELECT 1); COPY (SELECT 1) TO {} (FORMAT csv, USE_TMP_FILE false); SELECT * FROM (SELECT 1",
                quoted(&path)
            ),
        ];

        for sql in &attempts {
            let outcome = ask(&source, sql);
            assert!(outcome.is_err(), "{sql} should fail");
        }

        assert_eq!(fs::read_to_string(&path).unwrap(), SALES);
    }

    #[test]
    fn refuses_anything_but_one_read_query() {
        let folder = Folder::new("refuse");
        let (_, source) = sales(&folder);

        for sql in [
            "DROP VIEW data",
            "CREATE TABLE t AS SELECT 1",
            "INSERT INTO data VALUES ('x', 1)",
            "ATTACH 'x.db'",
            "INSTALL httpfs",
            "SET threads = 1",
            "SELECT 1; SELECT 2",
        ] {
            assert_eq!(code(&source, sql), "rejected-query", "{sql}");
        }
    }

    #[test]
    fn a_query_cannot_reach_other_files_or_the_network() {
        let folder = Folder::new("reach");
        let (_, source) = sales(&folder);
        let other = folder.write("private.csv", "secret\n1\n");

        for sql in [
            format!("SELECT * FROM read_csv({})", quoted(&other)),
            "SELECT * FROM read_csv('/etc/passwd')".to_owned(),
            "SELECT * FROM read_csv('https://example.com/a.csv')".to_owned(),
            "SELECT * FROM glob('/etc/*')".to_owned(),
        ] {
            assert!(ask(&source, &sql).is_err(), "{sql} should fail");
        }
    }

    #[test]
    fn a_wrong_column_can_be_sent_back_to_the_ai() {
        let folder = Folder::new("wrong");
        let (_, source) = sales(&folder);

        assert_eq!(code(&source, "SELECT nope FROM data"), "invalid-query");
        assert_eq!(code(&source, "SELEC 1"), "invalid-query");
    }

    #[test]
    fn a_value_problem_stays_on_this_computer() {
        let folder = Folder::new("value");
        let lines: String = (0..40_000).map(|row| format!("{row}\n")).collect();
        let path = folder.write("mixed.csv", &format!("a\n{lines}private-text\n"));
        let source = open_table(&path).unwrap().source;

        let error = ask(&source, "SELECT sum(a) FROM data").unwrap_err();

        assert_eq!(error.code(), "failed-query");
        assert!(!error.to_string().contains("private-text"));
    }

    #[test]
    fn tables_can_be_joined() {
        let folder = Folder::new("join");
        let tables = [
            table(&folder, "orders", "customer,amount\n1,10\n1,5\n2,20\n"),
            table(&folder, "customers", "id,name\n1,Ada\n2,Linus\n"),
        ];

        let result = run_query(
            &tables,
            "SELECT name, sum(amount) AS total FROM orders JOIN customers ON customer = id
             GROUP BY name ORDER BY total DESC",
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(
            result.rows,
            [
                [Some("Linus".to_owned()), Some("20".to_owned())],
                [Some("Ada".to_owned()), Some("15".to_owned())]
            ]
        );
    }

    #[test]
    fn a_query_reaches_only_the_files_it_was_given() {
        let folder = Folder::new("reach");
        let tables = [table(&folder, "orders", "amount\n1\n")];
        let private = folder.write("private.csv", "secret\nCANARY\n");

        let error = run_query(
            &tables,
            &format!("SELECT * FROM read_csv('{private}')"),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap_err();

        assert!(!error.to_string().contains("CANARY"));
        assert_ne!(error.code(), "stopped");
    }

    #[test]
    fn nothing_can_change_any_of_the_files() {
        let folder = Folder::new("many");
        let first = table(&folder, "first", "a\n1\n");
        let second = table(&folder, "second", "a\n2\n");
        let target = second.source.path.clone();
        let attack = format!(
            "SELECT 1); COPY (SELECT 9) TO '{target}' (HEADER false, USE_TMP_FILE false); SELECT * FROM (SELECT 1"
        );

        let result = run_query(&[first, second], &attack, Arc::new(AtomicBool::new(false)));

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "a\n2\n");
    }

    #[test]
    fn a_filter_narrows_every_aggregate_over_that_table() {
        let folder = Folder::new("filter");
        let mut sales = table(
            &folder,
            "sales",
            "region,amount\nEMEA,10\nEMEA,5\nAPAC,20\n",
        );
        sales.filters = vec![TableFilter {
            column: "region".to_owned(),
            rule: FilterRule::OneOf(vec!["EMEA".to_owned()]),
            through: None,
        }];

        let result = run_query(
            &[sales],
            "SELECT sum(amount) AS total, count(*) AS n FROM sales",
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(result.rows, [[Some("15".to_owned()), Some("2".to_owned())]]);
    }

    #[test]
    fn a_filter_reaches_queries_that_join_the_table() {
        let folder = Folder::new("filter-join");
        let mut customers = table(&folder, "customers", "id,region\n1,EMEA\n2,APAC\n");
        customers.filters = vec![TableFilter {
            column: "region".to_owned(),
            rule: FilterRule::OneOf(vec!["APAC".to_owned()]),
            through: None,
        }];
        let orders = table(&folder, "orders", "customer,amount\n1,10\n2,20\n2,5\n");

        let result = run_query(
            &[orders, customers],
            "SELECT sum(amount) FROM orders JOIN customers ON customer = id",
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(result.rows, [[Some("25".to_owned())]]);
    }

    #[test]
    fn a_filter_follows_a_link_to_a_table_that_never_joins_it() {
        let folder = Folder::new("filter-link");
        let customers = table(&folder, "customers", "id,region\n1,EMEA\n2,APAC\n3,EMEA\n");
        let mut orders = table(&folder, "orders", "customer,amount\n1,10\n2,20\n3,5\n");
        orders.filters = vec![TableFilter {
            column: "customer".to_owned(),
            rule: FilterRule::OneOf(vec!["EMEA".to_owned()]),
            through: Some(LinkedFilter {
                source: customers.source.clone(),
                key: "id".to_owned(),
                column: "region".to_owned(),
            }),
        }];

        let result = run_query(
            &[orders, customers],
            "SELECT sum(amount) FROM orders",
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(result.rows, [[Some("15".to_owned())]]);
    }

    #[test]
    fn a_date_range_keeps_the_days_at_both_ends() {
        let folder = Folder::new("filter-dates");
        let mut sales = table(
            &folder,
            "sales",
            "day,amount\n2026-01-31,1\n2026-02-01,2\n2026-02-28,4\n2026-03-01,8\n",
        );
        sales.filters = vec![TableFilter {
            column: "day".to_owned(),
            rule: FilterRule::Between {
                from: Some("2026-02-01".to_owned()),
                to: Some("2026-02-28".to_owned()),
            },
            through: None,
        }];

        let result = run_query(
            &[sales],
            "SELECT sum(amount) FROM sales",
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();

        assert_eq!(result.rows, [[Some("6".to_owned())]]);
    }

    #[test]
    fn a_range_can_be_open_at_one_end_or_be_a_month() {
        let folder = Folder::new("filter-open");
        let source = table(
            &folder,
            "sales",
            "month,amount\n2026-01,1\n2026-02,2\n2026-03,4\n",
        );
        let total = |from: Option<&str>, to: Option<&str>| {
            let mut sales = source.clone();
            sales.filters = vec![TableFilter {
                column: "month".to_owned(),
                rule: FilterRule::Between {
                    from: from.map(str::to_owned),
                    to: to.map(str::to_owned),
                },
                through: None,
            }];
            run_query(
                &[sales],
                "SELECT sum(amount) FROM sales",
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap()
            .rows
        };

        assert_eq!(total(Some("2026-02"), None), [[Some("6".to_owned())]]);
        assert_eq!(total(None, Some("2026-02")), [[Some("3".to_owned())]]);
        assert_eq!(total(None, None), [[Some("7".to_owned())]]);
    }

    #[test]
    fn a_filter_with_nothing_chosen_keeps_every_row() {
        let folder = Folder::new("filter-none");
        let mut sales = table(&folder, "sales", "region\nEMEA\nAPAC\n");
        sales.filters = vec![TableFilter {
            column: "region".to_owned(),
            rule: FilterRule::OneOf(Vec::new()),
            through: None,
        }];

        let result = run_query(
            &[sales],
            "SELECT * FROM sales",
            Arc::new(AtomicBool::new(false)),
        );

        assert_eq!(result.unwrap().rows.len(), 2);
    }

    #[test]
    fn a_filter_value_cannot_break_out_of_the_query() {
        let folder = Folder::new("filter-quote");
        let mut sales = table(&folder, "sales", "region\nO'Brien\nAPAC\n");
        sales.filters = vec![TableFilter {
            column: "region".to_owned(),
            rule: FilterRule::OneOf(vec![
                "O'Brien".to_owned(),
                "x'); DROP VIEW sales; --".to_owned(),
            ]),
            through: None,
        }];

        let result = run_query(
            &[sales],
            "SELECT * FROM sales",
            Arc::new(AtomicBool::new(false)),
        );

        assert_eq!(result.unwrap().rows, [[Some("O'Brien".to_owned())]]);
    }

    #[test]
    fn file_names_become_plain_table_names() {
        let taken = vec!["sales".to_owned()];

        assert_eq!(table_name("Q3 Sales (final).csv", &[]), "q3_sales__final");
        assert_eq!(table_name("2026-orders.parquet", &[]), "t_2026_orders");
        assert_eq!(table_name("sales.csv.gz", &taken), "sales_2");
        assert_eq!(table_name("données.csv", &[]), "donn_es");
        assert_eq!(table_name("___.csv", &[]), "t_");
    }

    #[test]
    fn a_running_query_can_be_stopped() {
        let folder = Folder::new("stop");
        let (_, source) = sales(&folder);
        let stop = Arc::new(AtomicBool::new(false));
        let stopper = stop.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            stopper.store(true, Ordering::Relaxed);
        });

        let error = run_query(
            &data_table(&source),
            "SELECT count(*) FROM range(10000000000) a, range(1000) b WHERE a.range % 7 = b.range",
            stop,
        )
        .unwrap_err();

        assert_eq!(error.code(), "stopped");
    }

    #[test]
    fn stops_a_query_that_runs_too_long() {
        let folder = Folder::new("slow");
        let (_, source) = sales(&folder);

        let error = run_query_within(
            &data_table(&source),
            "SELECT count(*) FROM range(10000000000) a, range(1000) b WHERE a.range % 7 = b.range",
            Duration::from_millis(50),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap_err();

        assert_eq!(error.code(), "slow-query");
    }
}
