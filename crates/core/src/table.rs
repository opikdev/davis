use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use duckdb::Connection;
use serde::{Deserialize, Serialize};

use crate::database::{RemoteTable, attach_sources, estimated_rows, remote_scan};
use crate::{Error, Result};

const ENCODING_SAMPLE_BYTES: u64 = 1024 * 1024;
const MAX_ROWS_PER_READ: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Csv,
    Parquet,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf16,
    Latin1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Repair {
    None,
    FillMissingValues,
    SkipBadRows,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSource {
    pub path: String,
    pub format: Format,
    pub encoding: Encoding,
    pub repair: Repair,
    // A table read live from a database, which leaves the file fields unused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<RemoteTable>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnKind {
    Number,
    Date,
    Boolean,
    Text,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub kind: ColumnKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedTable {
    pub source: TableSource,
    pub name: String,
    pub row_count: u64,
    pub skipped_rows: u64,
    pub columns: Vec<Column>,
}

pub type Row = Vec<Option<String>>;

pub fn open_table(path: &str) -> Result<OpenedTable> {
    let file = Path::new(path);
    let name = file.file_name().map_or_else(
        || path.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    let format = format_of(&name)?;
    check_file(file, &name)?;

    let connection = connect()?;
    let encoding = match format {
        Format::Csv => detect_encoding(file, &name)?,
        Format::Parquet | Format::Json => Encoding::Utf8,
    };
    let source = TableSource {
        path: path.to_owned(),
        format,
        encoding,
        repair: Repair::None,
        remote: None,
    };

    let opened = if format == Format::Csv {
        read_csv_shape(&connection, source)
    } else {
        read_shape(&connection, source)
    };
    let (source, row_count, skipped_rows, columns) = opened.map_err(|error| {
        eprintln!("Could not read {name}: {error}");
        Error::Unreadable(name.clone())
    })?;

    Ok(OpenedTable {
        source,
        name,
        row_count,
        skipped_rows,
        columns,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowCount {
    Exact,
    // Postgres keeps an estimate for tables it has analyzed, which spares
    // counting a big table every time a question is asked.
    Estimated,
}

pub fn open_remote_table(
    remote: RemoteTable,
    name: String,
    count: RowCount,
) -> Result<OpenedTable> {
    let source = TableSource {
        path: format!("{}.{}", remote.schema, remote.table),
        format: Format::Parquet,
        encoding: Encoding::Utf8,
        repair: Repair::None,
        remote: Some(remote),
    };
    let connection = connect_for([&source])?;
    let columns = read_columns(&connection, &source)?;
    let estimate = match (count, &source.remote) {
        (RowCount::Estimated, Some(remote)) => estimated_rows(&connection, remote)?,
        _ => None,
    };
    let row_count = match estimate {
        Some(rows) => rows,
        None => count_rows(&connection, &source)?,
    };
    Ok(OpenedTable {
        source,
        name,
        row_count,
        skipped_rows: 0,
        columns,
    })
}

pub fn read_rows(source: &TableSource, offset: u64, limit: u64) -> Result<Vec<Row>> {
    let connection = connect_for([source])?;
    let limit = limit.min(MAX_ROWS_PER_READ);
    let sql = format!(
        "SELECT COLUMNS(*)::VARCHAR FROM {} LIMIT {limit} OFFSET {offset}",
        scan(source, true)
    );
    let mut statement = connection.prepare(&sql)?;
    let mut rows = statement.query([])?;
    let mut read = Vec::new();
    while let Some(row) = rows.next()? {
        let width = row.as_ref().column_count();
        let values = (0..width)
            .map(|index| row.get(index))
            .collect::<duckdb::Result<Row>>()?;
        read.push(values);
    }
    Ok(read)
}

pub(crate) fn connect() -> Result<Connection> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "SET autoinstall_known_extensions = false; SET autoload_known_extensions = false;",
    )?;
    Ok(connection)
}

pub(crate) fn connect_for<'a>(
    sources: impl IntoIterator<Item = &'a TableSource>,
) -> Result<Connection> {
    let connection = connect()?;
    attach_sources(&connection, sources)?;
    Ok(connection)
}

fn format_of(name: &str) -> Result<Format> {
    let lower = name.to_lowercase();
    let plain = lower
        .strip_suffix(".gz")
        .or_else(|| lower.strip_suffix(".zst"))
        .unwrap_or(&lower);
    let extension = Path::new(plain)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();

    match extension {
        "csv" | "tsv" | "tab" | "txt" => Ok(Format::Csv),
        "parquet" | "pq" => Ok(Format::Parquet),
        "json" | "jsonl" | "ndjson" => Ok(Format::Json),
        _ => Err(Error::UnsupportedFile(name.to_owned())),
    }
}

fn check_file(file: &Path, name: &str) -> Result<()> {
    let metadata = fs::metadata(file).map_err(|_| Error::MissingFile(name.to_owned()))?;
    if !metadata.is_file() {
        return Err(Error::UnsupportedFile(name.to_owned()));
    }
    if metadata.len() == 0 {
        return Err(Error::EmptyFile(name.to_owned()));
    }
    Ok(())
}

fn detect_encoding(file: &Path, name: &str) -> Result<Encoding> {
    let unreadable = |error: std::io::Error| {
        eprintln!("Could not read {name}: {error}");
        Error::Unreadable(name.to_owned())
    };
    let mut sample = Vec::new();
    File::open(file)
        .map_err(unreadable)?
        .take(ENCODING_SAMPLE_BYTES)
        .read_to_end(&mut sample)
        .map_err(unreadable)?;

    let is_compressed = sample.starts_with(&[0x1f, 0x8b]) || sample.starts_with(&[0x28, 0xb5]);
    if is_compressed {
        return Ok(Encoding::Utf8);
    }
    if sample.starts_with(&[0xff, 0xfe]) || sample.starts_with(&[0xfe, 0xff]) {
        return Ok(Encoding::Utf16);
    }
    // A sample can end partway through a character, which isn't a sign of another encoding.
    match std::str::from_utf8(&sample) {
        Ok(_) => Ok(Encoding::Utf8),
        Err(error) if error.error_len().is_none() => Ok(Encoding::Utf8),
        Err(_) => Ok(Encoding::Latin1),
    }
}

type Shape = (TableSource, u64, u64, Vec<Column>);

fn read_shape(connection: &Connection, source: TableSource) -> Result<Shape> {
    let columns = read_columns(connection, &source)?;
    let row_count = count_rows(connection, &source)?;
    Ok((source, row_count, 0, columns))
}

// CSV problems often appear only deep in a file, so a full count proves the file can be read.
fn read_csv_shape(connection: &Connection, source: TableSource) -> Result<Shape> {
    let plain = read_shape(connection, source.clone());
    match plain {
        Ok(shape) if shape.3.len() > 1 => return Ok(shape),
        Ok(shape) => {
            return Ok(with_filled_rows(connection, &source)
                .ok()
                .filter(|filled| filled.3.len() > 1)
                .unwrap_or(shape));
        }
        Err(_) => {}
    }

    if let Ok(filled) = with_filled_rows(connection, &source) {
        return Ok(filled);
    }

    let skipping = TableSource {
        repair: Repair::SkipBadRows,
        ..source
    };
    let columns = read_columns(connection, &skipping)?;
    let row_count = count_rows(connection, &skipping)?;
    let skipped_rows = connection.query_row(
        "SELECT count(DISTINCT line)::BIGINT FROM reject_errors",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    Ok((skipping, row_count, skipped_rows.unsigned_abs(), columns))
}

fn with_filled_rows(connection: &Connection, source: &TableSource) -> Result<Shape> {
    read_shape(
        connection,
        TableSource {
            repair: Repair::FillMissingValues,
            ..source.clone()
        },
    )
}

fn read_columns(connection: &Connection, source: &TableSource) -> Result<Vec<Column>> {
    let sql = format!("DESCRIBE SELECT * FROM {}", scan(source, false));
    let mut statement = connection.prepare(&sql)?;
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

fn count_rows(connection: &Connection, source: &TableSource) -> Result<u64> {
    let sql = format!("SELECT count(*)::BIGINT FROM {}", scan(source, true));
    let count = connection.query_row(&sql, [], |row| row.get::<_, i64>(0))?;
    Ok(count.unsigned_abs())
}

pub(crate) fn kind_of(data_type: &str) -> ColumnKind {
    let base = data_type.split('(').next().unwrap_or(data_type);
    match base {
        "TINYINT" | "SMALLINT" | "INTEGER" | "BIGINT" | "HUGEINT" | "UTINYINT" | "USMALLINT"
        | "UINTEGER" | "UBIGINT" | "UHUGEINT" | "FLOAT" | "DOUBLE" | "DECIMAL" => {
            ColumnKind::Number
        }
        "DATE"
        | "TIME"
        | "TIMESTAMP"
        | "TIMESTAMP WITH TIME ZONE"
        | "TIMESTAMP_NS"
        | "TIMESTAMP_MS"
        | "TIMESTAMP_S" => ColumnKind::Date,
        "BOOLEAN" => ColumnKind::Boolean,
        "VARCHAR" => ColumnKind::Text,
        _ => ColumnKind::Other,
    }
}

// Rows are read as plain text so what's shown is exactly what the file holds.
pub(crate) fn scan(source: &TableSource, as_text: bool) -> String {
    if let Some(remote) = &source.remote {
        return remote_scan(remote);
    }
    let path = quoted(&without_wildcards(&source.path));
    match source.format {
        Format::Parquet => format!("read_parquet({path})"),
        Format::Json => format!("read_json({path})"),
        Format::Csv => {
            let mut options = String::new();
            if as_text {
                options.push_str(", all_varchar = true");
            }
            match source.encoding {
                Encoding::Utf8 => {}
                Encoding::Utf16 => options.push_str(", encoding = 'utf-16'"),
                Encoding::Latin1 => options.push_str(", encoding = 'latin-1'"),
            }
            match source.repair {
                Repair::None => {}
                Repair::FillMissingValues => options.push_str(", null_padding = true"),
                Repair::SkipBadRows if as_text => {
                    options.push_str(", ignore_errors = true, store_rejects = true");
                }
                Repair::SkipBadRows => options.push_str(", ignore_errors = true"),
            }
            format!("read_csv({path}{options})")
        }
    }
}

pub(crate) fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

// DuckDB treats these as wildcards, which would read neighbouring files by mistake.
fn without_wildcards(path: &str) -> String {
    let mut escaped = String::with_capacity(path.len());
    for character in path.chars() {
        match character {
            '[' => escaped.push_str("[[]"),
            '*' => escaped.push_str("[*]"),
            '?' => escaped.push_str("[?]"),
            other => escaped.push(other),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("davis-table-{}-{name}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, content: impl AsRef<[u8]>) -> String {
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

    fn all_rows(table: &OpenedTable) -> Vec<Row> {
        read_rows(&table.source, 0, MAX_ROWS_PER_READ).unwrap()
    }

    fn text(values: &[&str]) -> Row {
        values
            .iter()
            .map(|value| Some((*value).to_owned()))
            .collect()
    }

    fn names(table: &OpenedTable) -> Vec<&str> {
        table
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect()
    }

    #[test]
    fn opens_a_csv_with_its_columns_and_row_count() {
        let folder = Folder::new("csv");
        let path = folder.write("sales.csv", "region,amount,day\nEMEA,10,2024-01-02\n");

        let table = open_table(&path).unwrap();

        assert_eq!(table.name, "sales.csv");
        assert_eq!(table.row_count, 1);
        assert_eq!(names(&table), ["region", "amount", "day"]);
        let kinds: Vec<_> = table.columns.iter().map(|column| column.kind).collect();
        assert_eq!(
            kinds,
            [ColumnKind::Text, ColumnKind::Number, ColumnKind::Date]
        );
    }

    #[test]
    fn shows_values_exactly_as_the_file_has_them() {
        let folder = Folder::new("exact");
        let path = folder.write(
            "ids.csv",
            "id,zip,day\n12345678901234567890123,00501,01/02/2024\n",
        );

        let table = open_table(&path).unwrap();

        assert_eq!(
            all_rows(&table),
            [text(&["12345678901234567890123", "00501", "01/02/2024"])]
        );
    }

    #[test]
    fn missing_values_stay_empty() {
        let folder = Folder::new("nulls");
        let path = folder.write("gaps.csv", "a,b\n1,\n,2\n");

        let table = open_table(&path).unwrap();

        assert_eq!(
            all_rows(&table),
            [
                vec![Some("1".to_owned()), None],
                vec![None, Some("2".to_owned())]
            ]
        );
    }

    #[test]
    fn reads_only_the_requested_window() {
        let folder = Folder::new("window");
        let path = folder.write("rows.csv", "a\n1\n2\n3\n4\n");
        let table = open_table(&path).unwrap();

        let rows = read_rows(&table.source, 2, 1).unwrap();

        assert_eq!(rows, [text(&["3"])]);
    }

    #[test]
    fn caps_how_many_rows_one_read_can_return() {
        let folder = Folder::new("cap");
        let lines: String = (0..1_500).map(|row| format!("{row}\n")).collect();
        let path = folder.write("many.csv", format!("a\n{lines}"));
        let table = open_table(&path).unwrap();

        let rows = read_rows(&table.source, 0, 5_000).unwrap();

        assert_eq!(rows.len(), 1_000);
    }

    #[test]
    fn reads_a_latin_1_file() {
        let folder = Folder::new("latin");
        let path = folder.write("names.csv", b"name\nJos\xe9\n".as_slice());

        let table = open_table(&path).unwrap();

        assert_eq!(table.source.encoding, Encoding::Latin1);
        assert_eq!(all_rows(&table), [text(&["José"])]);
    }

    #[test]
    fn reads_a_utf_16_file() {
        let folder = Folder::new("utf16");
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend("a,b\n1,2\n".encode_utf16().flat_map(u16::to_le_bytes));
        let path = folder.write("wide.csv", bytes);

        let table = open_table(&path).unwrap();

        assert_eq!(table.source.encoding, Encoding::Utf16);
        assert_eq!(all_rows(&table), [text(&["1", "2"])]);
    }

    #[test]
    fn text_deep_in_a_number_column_does_not_break_reading() {
        let folder = Folder::new("mixed");
        let lines: String = (0..40_000).map(|row| format!("{row}\n")).collect();
        let path = folder.write("mixed.csv", format!("value\n{lines}oops\n"));

        let table = open_table(&path).unwrap();
        let last = read_rows(&table.source, 40_000, 1).unwrap();

        assert_eq!(table.row_count, 40_001);
        assert_eq!(last, [text(&["oops"])]);
    }

    #[test]
    fn keeps_a_short_row_deep_in_a_file_by_leaving_gaps() {
        let folder = Folder::new("short");
        let lines: String = (0..40_000).map(|row| format!("{row},{row}\n")).collect();
        let path = folder.write("short.csv", format!("a,b\n{lines}only\n"));

        let table = open_table(&path).unwrap();
        let last = read_rows(&table.source, 40_000, 1).unwrap();

        assert_eq!(table.source.repair, Repair::FillMissingValues);
        assert_eq!(table.row_count, 40_001);
        assert_eq!(last, [vec![Some("only".to_owned()), None]]);
    }

    #[test]
    fn counts_rows_it_has_to_skip() {
        let folder = Folder::new("long");
        let lines: String = (0..40_000).map(|row| format!("{row},{row}\n")).collect();
        let path = folder.write("long.csv", format!("a,b\n{lines}1,2,3,4\n5,6\n"));

        let table = open_table(&path).unwrap();

        assert_eq!(table.source.repair, Repair::SkipBadRows);
        assert_eq!(table.skipped_rows, 1);
        assert_eq!(table.row_count, 40_001);
        assert_eq!(all_rows(&table).len(), 1_000);
    }

    #[test]
    fn uneven_rows_do_not_collapse_into_one_column() {
        let folder = Folder::new("uneven");
        let path = folder.write("uneven.csv", "a,b,c\n1,2,3\n4,5\n6,7,8,9\n10,11,12\n");

        let table = open_table(&path).unwrap();

        assert!(table.columns.len() > 1, "got {:?}", names(&table));
    }

    #[test]
    fn opens_a_file_named_with_a_quote() {
        let folder = Folder::new("quote");
        let path = folder.write("it's mine.csv", "a\n1\n");

        assert_eq!(open_table(&path).unwrap().row_count, 1);
    }

    #[test]
    fn brackets_in_a_name_do_not_read_neighbouring_files() {
        let folder = Folder::new("brackets");
        let bracket = folder.write("report[1].csv", "a\n1\n");
        folder.write("report1.csv", "a\n2\n3\n");

        assert_eq!(open_table(&bracket).unwrap().row_count, 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_star_in_a_name_does_not_read_neighbouring_files() {
        let folder = Folder::new("stars");
        let star = folder.write("sales*.csv", "a\n1\n");
        folder.write("sales1.csv", "a\n2\n3\n");

        assert_eq!(open_table(&star).unwrap().row_count, 1);
    }

    #[test]
    fn opens_json_and_shows_nested_values_as_text() {
        let folder = Folder::new("json");
        let path = folder.write("data.json", r#"[{"a":1,"b":{"c":"x"}}]"#);

        let table = open_table(&path).unwrap();

        assert_eq!(table.source.format, Format::Json);
        assert_eq!(all_rows(&table), [text(&["1", "{'c': x}"])]);
        assert_eq!(table.columns[1].kind, ColumnKind::Other);
    }

    #[test]
    fn opens_parquet_with_the_engine_built_in() {
        let folder = Folder::new("parquet");
        let path = folder.0.join("data.parquet").to_string_lossy().into_owned();
        connect()
            .unwrap()
            .execute_batch(&format!(
                "COPY (SELECT 1 AS id, 'x' AS name) TO {} (FORMAT parquet)",
                quoted(&path)
            ))
            .unwrap();

        let table = open_table(&path).unwrap();

        assert_eq!(table.source.format, Format::Parquet);
        assert_eq!(table.row_count, 1);
        assert_eq!(all_rows(&table), [text(&["1", "x"])]);
    }

    #[test]
    fn a_header_with_no_rows_is_an_empty_table() {
        let folder = Folder::new("header");
        let path = folder.write("empty-rows.csv", "a,b\n");

        let table = open_table(&path).unwrap();

        assert_eq!(table.row_count, 0);
        assert_eq!(names(&table), ["a", "b"]);
    }

    #[test]
    fn explains_files_it_cannot_open() {
        let folder = Folder::new("errors");
        let code = |path: &str| open_table(path).unwrap_err().code();

        assert_eq!(code(&folder.write("book.xlsx", "x")), "unsupported-file");
        assert_eq!(code(&folder.write("empty.csv", "")), "empty-file");
        assert_eq!(
            code(&folder.write("broken.parquet", "x")),
            "unreadable-file"
        );
        assert_eq!(
            code(&folder.0.join("gone.csv").to_string_lossy()),
            "missing-file"
        );
    }

    #[test]
    fn a_folder_is_not_a_table() {
        let folder = Folder::new("folder.csv");

        let error = open_table(&folder.0.to_string_lossy()).unwrap_err();

        assert_eq!(error.code(), "unsupported-file");
    }
}
