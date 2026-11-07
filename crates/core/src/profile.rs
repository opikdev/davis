use duckdb::Connection;
use serde::Serialize;

use crate::query::{QueryTable, locked_connection};
use crate::table::{ColumnKind, TableSource, connect, kind_of, quoted, scan};
use crate::{Error, Result};

const TOP_VALUES: usize = 5;
const HISTOGRAM_BINS: u32 = 12;
const MIN_MATCH_PERCENT: f64 = 90.0;
const MAX_OPTIONS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnProfile {
    pub name: String,
    pub kind: ColumnKind,
    pub missing_percent: f64,
    pub unique_values: u64,
    pub min: Option<String>,
    pub max: Option<String>,
    pub mean: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueCount {
    pub label: String,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableLink {
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    pub match_percent: f64,
}

fn identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn describe(connection: &Connection, from: &str) -> Result<Vec<(String, String)>> {
    let mut statement = connection.prepare(&format!(
        "SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM {from})"
    ))?;
    let columns = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<duckdb::Result<Vec<_>>>()?;
    Ok(columns)
}

const MEASURES_PER_COLUMN: usize = 5;

fn measures(name: &str, kind: ColumnKind) -> String {
    let column = identifier(name);
    let (text, mean) = match kind {
        ColumnKind::Number => (column.clone(), format!("avg({column})::VARCHAR")),
        ColumnKind::Date => (column.clone(), "NULL::VARCHAR".to_owned()),
        _ => (format!("{column}::VARCHAR"), "NULL::VARCHAR".to_owned()),
    };
    format!(
        "count({column}), approx_count_distinct({column}), min({text})::VARCHAR, \
         max({text})::VARCHAR, {mean}"
    )
}

// One pass over the file, with only what the brief uses, keeps this fast enough
// to run every time a file opens.
pub fn profile_table(source: &TableSource) -> Result<Vec<ColumnProfile>> {
    let connection = connect()?;
    let from = scan(source, false);
    let columns = describe(&connection, &from)?;
    let kinds: Vec<ColumnKind> = columns
        .iter()
        .map(|(_, data_type)| kind_of(data_type))
        .collect();
    let selected = columns
        .iter()
        .zip(&kinds)
        .map(|((name, _), kind)| measures(name, *kind))
        .collect::<Vec<_>>()
        .join(", ");

    let row_count_and_measures = format!("SELECT count(*), {selected} FROM {from}");
    let profiles = connection.query_row(&row_count_and_measures, [], |row| {
        let total: i64 = row.get(0)?;
        columns
            .iter()
            .zip(&kinds)
            .enumerate()
            .map(|(index, ((name, _), kind))| {
                let first = 1 + index * MEASURES_PER_COLUMN;
                let present: i64 = row.get(first)?;
                let unique: i64 = row.get(first + 1)?;
                Ok(ColumnProfile {
                    name: name.clone(),
                    kind: *kind,
                    missing_percent: if total == 0 {
                        0.0
                    } else {
                        100.0 * (total - present) as f64 / total as f64
                    },
                    unique_values: unique.unsigned_abs(),
                    min: row.get(first + 2)?,
                    max: row.get(first + 3)?,
                    mean: row.get(first + 4)?,
                })
            })
            .collect::<duckdb::Result<Vec<_>>>()
    })?;
    Ok(profiles)
}

fn read_counts(connection: &Connection, sql: &str) -> Result<Vec<ValueCount>> {
    let mut statement = connection.prepare(sql)?;
    let counts = statement
        .query_map([], |row| {
            Ok(ValueCount {
                label: row.get(0)?,
                count: row.get::<_, i64>(1)?.unsigned_abs(),
            })
        })?
        .collect::<duckdb::Result<Vec<_>>>()?;
    Ok(counts)
}

// Numbers read best as a shape, and anything else as its most common values.
pub fn column_values(
    source: &TableSource,
    column: &str,
    kind: ColumnKind,
) -> Result<Vec<ValueCount>> {
    let connection = connect()?;
    let from = scan(source, false);
    let name = identifier(column);
    if kind != ColumnKind::Number {
        return read_counts(
            &connection,
            &format!(
                "SELECT {name}::VARCHAR, count(*) FROM {from} WHERE {name} IS NOT NULL
                 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT {TOP_VALUES}"
            ),
        );
    }
    read_counts(
        &connection,
        &format!(
            "WITH bounds AS (SELECT min({name})::DOUBLE AS low, max({name})::DOUBLE AS high FROM {from}),
             binned AS (
               SELECT CASE WHEN high = low THEN 0
                 ELSE least(floor(({name}::DOUBLE - low) / (high - low) * {HISTOGRAM_BINS}), {last})
                 END AS bin, low, high
               FROM {from}, bounds WHERE {name} IS NOT NULL
             )
             SELECT round(low + bin * (high - low) / {HISTOGRAM_BINS}, 2)::VARCHAR, count(*)
             FROM binned GROUP BY bin, low, high ORDER BY bin",
            last = HISTOGRAM_BINS - 1
        ),
    )
}

pub fn column_options(source: &TableSource, column: &str) -> Result<Vec<String>> {
    let connection = connect()?;
    let name = identifier(column);
    let mut statement = connection.prepare(&format!(
        "SELECT DISTINCT {name}::VARCHAR AS value FROM {} WHERE {name} IS NOT NULL
         ORDER BY value LIMIT {MAX_OPTIONS}",
        scan(source, false)
    ))?;
    let options = statement
        .query_map([], |row| row.get(0))?
        .collect::<duckdb::Result<Vec<String>>>()?;
    Ok(options)
}

pub fn column_bounds(source: &TableSource, column: &str) -> Result<Option<(String, String)>> {
    let connection = connect()?;
    let name = identifier(column);
    let bounds: (Option<String>, Option<String>) = connection.query_row(
        &format!(
            "SELECT min({name})::VARCHAR, max({name})::VARCHAR FROM {}",
            scan(source, false)
        ),
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(bounds.0.zip(bounds.1))
}

fn normalized(name: &str) -> String {
    name.to_lowercase().replace(['_', ' ', '-'], "")
}

fn singular(table: &str) -> &str {
    table.strip_suffix('s').unwrap_or(table)
}

fn could_link(from_table: &str, from: &str, to_table: &str, to: &str) -> bool {
    let (from, to) = (normalized(from), normalized(to));
    from == to
        || (to == "id" && from == format!("{}id", normalized(singular(to_table))))
        || (from == "id" && to == format!("{}id", normalized(singular(from_table))))
}

fn column_names(connection: &Connection, table: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(&format!(
        "SELECT column_name FROM (DESCRIBE {})",
        identifier(table)
    ))?;
    let names = statement
        .query_map([], |row| row.get(0))?
        .collect::<duckdb::Result<Vec<String>>>()?;
    Ok(names)
}

fn match_percent(
    connection: &Connection,
    (from_table, from): (&str, &str),
    (to_table, to): (&str, &str),
) -> Result<Option<f64>> {
    let (from_table, from, to_table, to) = (
        identifier(from_table),
        identifier(from),
        identifier(to_table),
        identifier(to),
    );
    let is_key: bool = connection.query_row(
        &format!("SELECT count(*) > 0 AND count(*) = count(DISTINCT {to}) FROM {to_table}"),
        [],
        |row| row.get(0),
    )?;
    if !is_key {
        return Ok(None);
    }
    let percent: Option<f64> = connection.query_row(
        &format!(
            "SELECT 100.0 * count(*) FILTER (WHERE t.{to} IS NOT NULL) / nullif(count(*), 0)
             FROM {from_table} f LEFT JOIN {to_table} t ON f.{from}::VARCHAR = t.{to}::VARCHAR
             WHERE f.{from} IS NOT NULL"
        ),
        [],
        |row| row.get(0),
    )?;
    Ok(percent)
}

// A link is offered only when each row finds at most one match, so combining
// two files can never add or repeat rows.
pub fn find_links(tables: &[QueryTable]) -> Result<Vec<TableLink>> {
    let connection = locked_connection(tables)?;
    let mut links = Vec::new();
    for from in tables {
        let from_columns = column_names(&connection, &from.name)?;
        for to in tables.iter().filter(|table| table.name != from.name) {
            let to_columns = column_names(&connection, &to.name)?;
            for from_column in &from_columns {
                for to_column in &to_columns {
                    if !could_link(&from.name, from_column, &to.name, to_column) {
                        continue;
                    }
                    let found = match_percent(
                        &connection,
                        (&from.name, from_column),
                        (&to.name, to_column),
                    )?;
                    if let Some(match_percent) =
                        found.filter(|percent| *percent >= MIN_MATCH_PERCENT)
                    {
                        links.push(TableLink {
                            from_table: from.name.clone(),
                            from_column: from_column.clone(),
                            to_table: to.name.clone(),
                            to_column: to_column.clone(),
                            match_percent,
                        });
                    }
                }
            }
        }
    }
    Ok(links)
}

pub fn combine_tables(
    main: &TableSource,
    main_column: &str,
    other: &TableSource,
    other_column: &str,
    output: &str,
) -> Result<()> {
    let connection = connect()?;
    let names = |source: &TableSource| -> Result<Vec<String>> {
        let columns = describe(&connection, &scan(source, false))?;
        Ok(columns.into_iter().map(|(name, _)| name).collect())
    };
    let kept = names(main)?;
    let added: Vec<String> = names(other)?
        .into_iter()
        .filter(|name| name != other_column)
        .map(|name| {
            let alias = if kept.contains(&name) {
                format!("{name} (joined)")
            } else {
                name.clone()
            };
            format!("o.{} AS {}", identifier(&name), identifier(&alias))
        })
        .collect();
    let columns = std::iter::once("m.*".to_owned())
        .chain(added)
        .collect::<Vec<_>>()
        .join(", ");
    connection
        .execute_batch(&format!(
            "COPY (SELECT {columns} FROM {} m LEFT JOIN {} o
                   ON m.{}::VARCHAR = o.{}::VARCHAR)
             TO {} (FORMAT parquet)",
            scan(main, false),
            scan(other, false),
            identifier(main_column),
            identifier(other_column),
            quoted(output),
        ))
        .map_err(Error::from)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;
    use crate::table::open_table;

    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Folder(PathBuf);

    impl Folder {
        fn new() -> Self {
            let number = NEXT.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("davis-profile-{}-{number}", std::process::id()));
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

    const ORDERS: &str = "order_id,customer_id,amount,day\n1,10,5,2026-01-01\n2,10,7,2026-01-02\n3,20,,2026-03-09\n4,30,9,2026-03-10\n";
    const CUSTOMERS: &str = "id,name\n10,Ada\n20,Linus\n30,Grace\n";

    #[test]
    fn a_profile_gives_each_column_its_gaps_range_and_mean() {
        let folder = Folder::new();
        let orders = folder.table("orders", ORDERS);

        let profile = profile_table(&orders.source).unwrap();

        let amount = profile
            .iter()
            .find(|column| column.name == "amount")
            .unwrap();
        assert_eq!(amount.kind, ColumnKind::Number);
        assert!((amount.missing_percent - 25.0).abs() < 0.1);
        assert_eq!(amount.min.as_deref(), Some("5"));
        assert_eq!(amount.max.as_deref(), Some("9"));
        let day = profile.iter().find(|column| column.name == "day").unwrap();
        assert_eq!(day.kind, ColumnKind::Date);
        assert_eq!(day.min.as_deref(), Some("2026-01-01"));
    }

    #[test]
    fn text_shows_its_most_common_values() {
        let folder = Folder::new();
        let table = folder.table("t", "city\nOslo\nOslo\nRome\n\n");

        let values = column_values(&table.source, "city", ColumnKind::Text).unwrap();

        assert_eq!(
            values,
            [
                ValueCount {
                    label: "Oslo".to_owned(),
                    count: 2
                },
                ValueCount {
                    label: "Rome".to_owned(),
                    count: 1
                },
            ]
        );
    }

    #[test]
    fn numbers_show_their_shape_and_every_row_lands_in_a_bin() {
        let folder = Folder::new();
        let table = folder.table("t", "n\n1\n2\n3\n50\n100\n");

        let bins = column_values(&table.source, "n", ColumnKind::Number).unwrap();

        assert_eq!(bins.iter().map(|bin| bin.count).sum::<u64>(), 5);
        assert_eq!(bins.first().unwrap().count, 3);
    }

    #[test]
    fn a_column_with_one_value_still_works() {
        let folder = Folder::new();
        let table = folder.table("t", "n\n7\n7\n");

        let bins = column_values(&table.source, "n", ColumnKind::Number).unwrap();

        assert_eq!(bins.len(), 1);
        assert_eq!(bins[0].count, 2);
    }

    #[test]
    fn odd_column_names_are_safe() {
        let folder = Folder::new();
        let table = folder.table("t", "\"a \"\"b\"\" c\"\n1\n");

        let name = &open_table(&table.source.path).unwrap().columns[0].name;
        let values = column_values(&table.source, name, ColumnKind::Text).unwrap();

        assert_eq!(values.len(), 1);
    }

    #[test]
    fn filter_options_are_each_value_once_in_order() {
        let folder = Folder::new();
        let table = folder.table("t", "city\nRome\nOslo\nRome\n\n");

        assert_eq!(
            column_options(&table.source, "city").unwrap(),
            ["Oslo", "Rome"]
        );
    }

    #[test]
    fn finds_a_link_from_a_table_name_and_id() {
        let folder = Folder::new();
        let tables = [
            folder.table("orders", ORDERS),
            folder.table("customers", CUSTOMERS),
        ];

        let links = find_links(&tables).unwrap();

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].from_table, "orders");
        assert_eq!(links[0].from_column, "customer_id");
        assert_eq!(links[0].to_table, "customers");
        assert_eq!(links[0].to_column, "id");
        assert!((links[0].match_percent - 100.0).abs() < 0.1);
    }

    #[test]
    fn a_column_with_repeats_is_never_offered_as_a_key() {
        let folder = Folder::new();
        let tables = [
            folder.table("a", "region,x\nEMEA,1\nEMEA,2\n"),
            folder.table("b", "region,y\nEMEA,3\nEMEA,4\n"),
        ];

        assert!(find_links(&tables).unwrap().is_empty());
    }

    #[test]
    fn a_poor_match_is_not_offered() {
        let folder = Folder::new();
        let tables = [
            folder.table("orders", "customer_id\n1\n2\n3\n4\n"),
            folder.table("customers", "id\n1\n"),
        ];

        let links = find_links(&tables).unwrap();
        assert!(links.iter().all(|link| link.from_table != "orders"));
    }

    #[test]
    fn combining_keeps_every_row_and_adds_the_columns() {
        let folder = Folder::new();
        let orders = folder.table("orders", ORDERS);
        let customers = folder.table("customers", "id,name,amount\n10,Ada,1\n20,Linus,2\n");
        let output = folder.0.join("combined.parquet");

        combine_tables(
            &orders.source,
            "customer_id",
            &customers.source,
            "id",
            &output.to_string_lossy(),
        )
        .unwrap();

        let opened = open_table(&output.to_string_lossy()).unwrap();
        assert_eq!(opened.row_count, 4);
        let names: Vec<&str> = opened.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "order_id",
                "customer_id",
                "amount",
                "day",
                "name",
                "amount (joined)"
            ]
        );
    }
}
