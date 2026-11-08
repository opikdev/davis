use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use duckdb::Connection;
use serde::{Deserialize, Serialize};

use crate::table::{TableSource, connect, quoted};
use crate::{Error, Result};

const POSTGRES_EXTENSION: &str = "postgres_scanner";
const CONNECT_TIMEOUT_SECONDS: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
}

// The password never leaves the backend, so this is built there from the
// project's saved connection and the keychain.
#[derive(Clone, PartialEq, Eq)]
pub struct PostgresLogin {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub ssl: SslMode,
}

impl PostgresLogin {
    fn connection_string(&self) -> String {
        let value = |text: &str| format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"));
        let ssl = match self.ssl {
            SslMode::Disable => "disable",
            SslMode::Prefer => "prefer",
            SslMode::Require => "require",
        };
        format!(
            "host={} port={} dbname={} user={} password={} sslmode={ssl} connect_timeout={CONNECT_TIMEOUT_SECONDS}",
            value(&self.host),
            self.port,
            value(&self.database),
            value(&self.user),
            value(&self.password),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTable {
    pub connection: String,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTableInfo {
    pub schema: String,
    pub table: String,
    pub estimated_rows: Option<u64>,
}

struct Registry {
    extensions: Option<PathBuf>,
    logins: BTreeMap<String, PostgresLogin>,
}

static REGISTRY: Mutex<Registry> = Mutex::new(Registry {
    extensions: None,
    logins: BTreeMap::new(),
});

fn registry() -> std::sync::MutexGuard<'static, Registry> {
    REGISTRY.lock().unwrap_or_else(PoisonError::into_inner)
}

// Extensions are downloaded only when someone asks, into a folder Davis owns.
pub fn set_extension_folder(folder: &Path) {
    registry().extensions = Some(folder.to_path_buf());
}

pub fn remember_login(connection: &str, login: PostgresLogin) {
    registry().logins.insert(connection.to_owned(), login);
}

pub fn has_login(connection: &str) -> bool {
    registry().logins.contains_key(connection)
}

pub fn forget_login(connection: &str) {
    registry().logins.remove(connection);
}

fn extension_settings() -> Result<String> {
    let folder = registry()
        .extensions
        .clone()
        .ok_or(Error::MissingDatabaseSupport)?;
    Ok(format!(
        "SET extension_directory = {};",
        quoted(&folder.to_string_lossy())
    ))
}

pub fn has_postgres_support() -> Result<bool> {
    let connection = connect()?;
    connection.execute_batch(&extension_settings()?)?;
    let installed = connection.query_row(
        "SELECT count(*) > 0 FROM duckdb_extensions() WHERE extension_name = ? AND installed",
        [POSTGRES_EXTENSION],
        |row| row.get(0),
    )?;
    Ok(installed)
}

pub fn install_postgres_support() -> Result<()> {
    let connection = connect()?;
    connection
        .execute_batch(&format!("{}INSTALL postgres;", extension_settings()?))
        .map_err(|error| {
            eprintln!("Could not download Postgres support: {error}");
            Error::DatabaseSupportDownload
        })
}

fn alias_name(connection: &str) -> String {
    format!("db_{connection}")
}

fn alias(connection: &str) -> String {
    format!("\"{}\"", alias_name(connection).replace('"', "\"\""))
}

pub(crate) fn estimated_rows(connection: &Connection, remote: &RemoteTable) -> Result<Option<u64>> {
    let estimate: Option<i64> = connection.query_row(
        "SELECT max(estimated_size) FROM duckdb_tables()
             WHERE database_name = ? AND schema_name = ? AND table_name = ?",
        [
            alias_name(&remote.connection),
            remote.schema.clone(),
            remote.table.clone(),
        ],
        |row| row.get(0),
    )?;
    Ok(estimate.filter(|rows| *rows > 0).map(i64::unsigned_abs))
}

fn quoted_name(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(crate) fn remote_scan(remote: &RemoteTable) -> String {
    format!(
        "{}.{}.{}",
        alias(&remote.connection),
        quoted_name(&remote.schema),
        quoted_name(&remote.table)
    )
}

fn attach(connection: &Connection, name: &str, login: &PostgresLogin) -> Result<()> {
    connection
        .execute_batch(&format!(
            "ATTACH {} AS {} (TYPE postgres, READ_ONLY);",
            quoted(&login.connection_string()),
            alias(name)
        ))
        .map_err(|error| unreachable_database(&error, login))
}

// DuckDB quotes the whole connection string in its errors, password included.
fn without_password(message: &str, login: &PostgresLogin) -> String {
    let hidden = PostgresLogin {
        password: "(hidden)".to_owned(),
        ..login.clone()
    };
    message.replace(&login.connection_string(), &hidden.connection_string())
}

fn unreachable_database(error: &duckdb::Error, login: &PostgresLogin) -> Error {
    let message = without_password(&error.to_string(), login);
    eprintln!("Could not connect to the database: {message}");
    let reason = if message.contains("password authentication failed") {
        "The user name or password is wrong."
    } else if message.contains("does not exist") {
        "That database doesn't exist on the server."
    } else if message.contains("timeout") || message.contains("Connection refused") {
        "The server didn't answer. Check the host and port, and that you're online."
    } else if message.contains("SSL") {
        "The server and Davis couldn't agree on SSL. Try another SSL setting."
    } else {
        "Check the connection details and try again."
    };
    Error::UnreachableDatabase(reason.to_owned())
}

// Every new engine connection attaches only the databases its tables come from.
pub(crate) fn attach_sources<'a>(
    connection: &Connection,
    sources: impl IntoIterator<Item = &'a TableSource>,
) -> Result<()> {
    let names: BTreeSet<&str> = sources
        .into_iter()
        .filter_map(|source| source.remote.as_ref())
        .map(|remote| remote.connection.as_str())
        .collect();
    if names.is_empty() {
        return Ok(());
    }
    let logins: Vec<(&str, PostgresLogin)> = names
        .into_iter()
        .map(|name| {
            registry()
                .logins
                .get(name)
                .cloned()
                .map(|login| (name, login))
                .ok_or(Error::DisconnectedDatabase)
        })
        .collect::<Result<_>>()?;
    connection.execute_batch(&format!("{}LOAD postgres;", extension_settings()?))?;
    for (name, login) in &logins {
        attach(connection, name, login)?;
    }
    Ok(())
}

pub fn test_postgres(login: &PostgresLogin) -> Result<Vec<DatabaseTableInfo>> {
    let connection = connect()?;
    connection.execute_batch(&format!("{}LOAD postgres;", extension_settings()?))?;
    attach(&connection, "test", login)?;
    let mut statement = connection.prepare(
        "SELECT * FROM (
           SELECT schema_name, table_name, estimated_size FROM duckdb_tables()
           WHERE database_name = 'db_test'
           UNION ALL
           SELECT schema_name, view_name, NULL FROM duckdb_views()
           WHERE database_name = 'db_test' AND NOT internal
         )
         WHERE schema_name <> 'information_schema' AND NOT starts_with(schema_name, 'pg_')
         ORDER BY 1, 2",
    )?;
    let tables = statement
        .query_map([], |row| {
            let rows: Option<i64> = row.get(2)?;
            Ok(DatabaseTableInfo {
                schema: row.get(0)?,
                table: row.get(1)?,
                estimated_rows: rows.map(i64::unsigned_abs),
            })
        })?
        .collect::<duckdb::Result<_>>()?;
    Ok(tables)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    use super::*;
    use crate::query::{FilterRule, QueryTable, TableFilter, run_query};
    use crate::table::{RowCount, open_remote_table, read_rows};

    static SETUP: Mutex<bool> = Mutex::new(false);

    // Set DAVIS_TEST_POSTGRES to postgres://user:password@host:port/database,
    // with crates/core/fixtures/postgres.sql loaded, to run these.
    fn test_login() -> Option<PostgresLogin> {
        let url = std::env::var("DAVIS_TEST_POSTGRES").ok()?;
        let rest = url.strip_prefix("postgres://")?;
        let (credentials, place) = rest.split_once('@')?;
        let (user, password) = credentials.split_once(':')?;
        let (address, database) = place.split_once('/')?;
        let (host, port) = address.split_once(':')?;
        let login = PostgresLogin {
            host: host.to_owned(),
            port: port.parse().ok()?,
            database: database.to_owned(),
            user: user.to_owned(),
            password: password.to_owned(),
            ssl: SslMode::Disable,
        };
        let mut is_ready = SETUP.lock().unwrap_or_else(PoisonError::into_inner);
        if !*is_ready {
            set_extension_folder(&std::env::temp_dir().join("davis-test-extensions"));
            install_postgres_support().unwrap();
            *is_ready = true;
        }
        Some(login)
    }

    fn remote(connection: &str, table: &str) -> RemoteTable {
        RemoteTable {
            connection: connection.to_owned(),
            schema: "public".to_owned(),
            table: table.to_owned(),
        }
    }

    fn query(tables: &[QueryTable], sql: &str) -> Result<Vec<crate::Row>> {
        run_query(tables, sql, Arc::new(AtomicBool::new(false))).map(|result| result.rows)
    }

    fn cell(text: &str) -> Option<String> {
        Some(text.to_owned())
    }

    #[test]
    fn a_login_is_quoted_so_no_value_can_add_settings() {
        let login = PostgresLogin {
            host: "db.example.com".to_owned(),
            port: 5432,
            database: "shop".to_owned(),
            user: "o'brien".to_owned(),
            password: "a b' sslmode=disable \\".to_owned(),
            ssl: SslMode::Require,
        };

        assert_eq!(
            login.connection_string(),
            "host='db.example.com' port=5432 dbname='shop' user='o\\'brien' \
             password='a b\\' sslmode=disable \\\\' sslmode=require connect_timeout=10"
        );
    }

    #[test]
    fn a_logged_failure_never_shows_the_password() {
        let login = PostgresLogin {
            host: "127.0.0.1".to_owned(),
            port: 5432,
            database: "shop".to_owned(),
            user: "reader".to_owned(),
            password: "s3cret'pass".to_owned(),
            ssl: SslMode::Disable,
        };
        let failure = format!(
            "IO Error: Unable to connect to Postgres at \"{}\": password authentication failed",
            login.connection_string()
        );

        let logged = without_password(&failure, &login);

        assert!(!logged.contains("s3cret"), "{logged}");
        assert!(logged.contains("password='(hidden)'"), "{logged}");
        assert!(logged.contains("password authentication failed"));
    }

    #[test]
    fn a_live_table_opens_and_answers_queries() {
        let Some(login) = test_login() else { return };
        remember_login("live-open", login);

        let table = open_remote_table(
            remote("live-open", "orders"),
            "orders".to_owned(),
            RowCount::Exact,
        )
        .unwrap();
        let tables = [QueryTable::new("orders", table.source.clone())];

        assert_eq!(table.row_count, 3);
        assert_eq!(read_rows(&table.source, 0, 10).unwrap().len(), 3);
        assert_eq!(
            query(&tables, "SELECT sum(amount)::VARCHAR FROM orders").unwrap(),
            [[cell("35.50")]]
        );
    }

    #[test]
    fn a_filter_narrows_a_live_table() {
        let Some(login) = test_login() else { return };
        remember_login("live-filter", login);
        let table = open_remote_table(
            remote("live-filter", "customers"),
            "customers".to_owned(),
            RowCount::Estimated,
        )
        .unwrap();
        let mut customers = QueryTable::new("customers", table.source);
        customers.filters.push(TableFilter {
            column: "region".to_owned(),
            rule: FilterRule::OneOf(vec!["APAC".to_owned()]),
            through: None,
        });

        assert_eq!(
            query(&[customers], "SELECT name FROM customers").unwrap(),
            [[cell("Grace")]]
        );
    }

    #[test]
    fn nothing_can_change_a_live_database() {
        let Some(login) = test_login() else { return };
        remember_login("live-write", login);
        let table = open_remote_table(
            remote("live-write", "orders"),
            "orders".to_owned(),
            RowCount::Exact,
        )
        .unwrap();
        let tables = [QueryTable::new("orders", table.source)];

        for sql in [
            "INSERT INTO orders VALUES (9, 1, '2026-04-01', 1)",
            "SELECT * FROM postgres_query('db_live-write', 'SELECT 1')",
            "SELECT * FROM postgres_execute('db_live-write', 'DROP TABLE orders')",
            "SELECT * FROM POSTGRES_SCAN('x', 'public', 'orders')",
            "DETACH \"db_live-write\"",
        ] {
            let error = query(&tables, sql).unwrap_err();
            assert_eq!(error.code(), "rejected-query", "{sql}");
        }
        assert_eq!(
            query(&tables, "SELECT count(*)::VARCHAR FROM orders").unwrap(),
            [[cell("3")]]
        );
    }

    #[test]
    fn testing_a_login_lists_its_tables_and_views() {
        let Some(login) = test_login() else { return };

        let names: Vec<String> = test_postgres(&login)
            .unwrap()
            .into_iter()
            .map(|table| format!("{}.{}", table.schema, table.table))
            .collect();

        assert_eq!(
            names,
            ["public.big_orders", "public.customers", "public.orders"]
        );
    }

    #[test]
    fn a_wrong_password_says_so() {
        let Some(login) = test_login() else { return };
        let wrong = PostgresLogin {
            password: "not-the-password".to_owned(),
            ..login
        };

        let error = test_postgres(&wrong).unwrap_err();

        assert_eq!(
            error.to_string(),
            "Couldn't connect to the database. The user name or password is wrong."
        );
    }

    #[test]
    fn a_table_without_its_login_asks_to_reconnect() {
        let Some(_) = test_login() else { return };
        forget_login("never-remembered");

        let error = read_rows(
            &open_failure_source(remote("never-remembered", "orders")),
            0,
            1,
        )
        .unwrap_err();

        assert_eq!(error.code(), "disconnected-database");
    }

    fn open_failure_source(remote: RemoteTable) -> TableSource {
        TableSource {
            path: "public.orders".to_owned(),
            format: crate::table::Format::Parquet,
            encoding: crate::table::Encoding::Utf8,
            repair: crate::table::Repair::None,
            remote: Some(remote),
        }
    }
}
