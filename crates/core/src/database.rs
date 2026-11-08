use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use duckdb::Connection;
use serde::{Deserialize, Serialize};

use crate::table::{TableSource, connect, quoted};
use crate::{Error, Result};

const CONNECT_TIMEOUT_SECONDS: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Postgres,
    Mysql,
}

impl DatabaseKind {
    fn extension(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
        }
    }

    fn installed_name(self) -> &'static str {
        match self {
            Self::Postgres => "postgres_scanner",
            Self::Mysql => "mysql_scanner",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Postgres => "Postgres",
            Self::Mysql => "MySQL",
        }
    }
}

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
pub struct DatabaseLogin {
    pub kind: DatabaseKind,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub ssl: SslMode,
}

impl DatabaseLogin {
    fn postgres_string(&self) -> String {
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

    // MySQL's connection string has no quoting, so each value goes in a
    // temporary secret as a plain SQL string instead.
    fn mysql_secret(&self, name: &str) -> String {
        let ssl = match self.ssl {
            SslMode::Disable => "disabled",
            SslMode::Prefer => "preferred",
            SslMode::Require => "required",
        };
        format!(
            "CREATE OR REPLACE TEMPORARY SECRET {name} (TYPE mysql, HOST {}, PORT {}, DATABASE {}, USER {}, PASSWORD {}, SSL_MODE '{ssl}');",
            quoted(&self.host),
            self.port,
            quoted(&self.database),
            quoted(&self.user),
            quoted(&self.password),
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
    logins: BTreeMap<String, DatabaseLogin>,
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

pub fn remember_login(connection: &str, login: DatabaseLogin) {
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

pub fn has_database_support(kind: DatabaseKind) -> Result<bool> {
    let connection = connect()?;
    connection.execute_batch(&extension_settings()?)?;
    let installed = connection.query_row(
        "SELECT count(*) > 0 FROM duckdb_extensions() WHERE extension_name = ? AND installed",
        [kind.installed_name()],
        |row| row.get(0),
    )?;
    Ok(installed)
}

pub fn install_database_support(kind: DatabaseKind) -> Result<()> {
    let connection = connect()?;
    connection
        .execute_batch(&format!(
            "{}INSTALL {};",
            extension_settings()?,
            kind.extension()
        ))
        .map_err(|error| {
            eprintln!("Could not download {} support: {error}", kind.label());
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

fn attach(connection: &Connection, name: &str, login: &DatabaseLogin) -> Result<()> {
    let sql = match login.kind {
        DatabaseKind::Postgres => format!(
            "ATTACH {} AS {} (TYPE postgres, READ_ONLY);",
            quoted(&login.postgres_string()),
            alias(name)
        ),
        DatabaseKind::Mysql => {
            let secret = quoted_name(&format!("secret_{name}"));
            format!(
                "{}ATTACH '' AS {} (TYPE mysql, SECRET {secret}, READ_ONLY);",
                login.mysql_secret(&secret),
                alias(name)
            )
        }
    };
    connection
        .execute_batch(&sql)
        .map_err(|error| unreachable_database(&error, login))
}

// Postgres errors quote the whole connection string, password included.
fn without_password(message: &str, login: &DatabaseLogin) -> String {
    if login.password.is_empty() {
        return message.to_owned();
    }
    let escaped = login.password.replace('\\', "\\\\").replace('\'', "\\'");
    message
        .replace(&escaped, "(hidden)")
        .replace(&login.password, "(hidden)")
}

fn unreachable_database(error: &duckdb::Error, login: &DatabaseLogin) -> Error {
    let message = without_password(&error.to_string(), login);
    eprintln!("Could not connect to the database: {message}");
    let reason = if message.contains("password authentication failed")
        || message.contains("Access denied")
    {
        "The user name or password is wrong."
    } else if message.contains("does not exist") || message.contains("Unknown database") {
        "That database doesn't exist on the server."
    } else if message.contains("timeout")
        || message.contains("Connection refused")
        || message.contains("Can't connect")
    {
        "The server didn't answer. Check the host and port, and that you're online."
    } else if message.contains("SSL") {
        "The server and Davis couldn't agree on SSL. Try another SSL setting."
    } else {
        "Check the connection details and try again."
    };
    Error::UnreachableDatabase(reason.to_owned())
}

fn load(connection: &Connection, kinds: impl IntoIterator<Item = DatabaseKind>) -> Result<()> {
    let loads: String = kinds
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|kind| format!("LOAD {};", kind.extension()))
        .collect();
    connection.execute_batch(&format!("{}{loads}", extension_settings()?))?;
    Ok(())
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
    let logins: Vec<(&str, DatabaseLogin)> = names
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
    load(connection, logins.iter().map(|(_, login)| login.kind))?;
    for (name, login) in &logins {
        attach(connection, name, login)?;
    }
    Ok(())
}

// A MySQL "database" is a schema, so only that one is listed. Postgres lists
// every schema the user can see, apart from its own catalogs.
pub fn test_database(login: &DatabaseLogin) -> Result<Vec<DatabaseTableInfo>> {
    let connection = connect()?;
    load(&connection, [login.kind])?;
    attach(&connection, "test", login)?;
    let schemas = match login.kind {
        DatabaseKind::Postgres => {
            "schema_name <> 'information_schema' AND NOT starts_with(schema_name, 'pg_')".to_owned()
        }
        DatabaseKind::Mysql => format!("schema_name = {}", quoted(&login.database)),
    };
    let mut statement = connection.prepare(&format!(
        "SELECT * FROM (
           SELECT schema_name, table_name, estimated_size FROM duckdb_tables()
           WHERE database_name = 'db_test'
           UNION ALL
           SELECT schema_name, view_name, NULL FROM duckdb_views()
           WHERE database_name = 'db_test' AND NOT internal
         )
         WHERE {schemas}
         ORDER BY 1, 2"
    ))?;
    let tables = statement
        .query_map([], |row| {
            let rows: Option<i64> = row.get(2)?;
            Ok(DatabaseTableInfo {
                schema: row.get(0)?,
                table: row.get(1)?,
                estimated_rows: rows.filter(|rows| *rows > 0).map(i64::unsigned_abs),
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
    use crate::table::{Encoding, Format, Repair, RowCount, open_remote_table, read_rows};

    static INSTALLED: Mutex<BTreeSet<DatabaseKind>> = Mutex::new(BTreeSet::new());

    // Set DAVIS_TEST_POSTGRES to postgres://user:password@host:port/database
    // and DAVIS_TEST_MYSQL to mysql://..., each loaded with its file in
    // crates/core/fixtures/, to run the live tests.
    fn test_login(kind: DatabaseKind) -> Option<DatabaseLogin> {
        let (variable, scheme) = match kind {
            DatabaseKind::Postgres => ("DAVIS_TEST_POSTGRES", "postgres://"),
            DatabaseKind::Mysql => ("DAVIS_TEST_MYSQL", "mysql://"),
        };
        let url = std::env::var(variable).ok()?;
        let rest = url.strip_prefix(scheme)?;
        let (credentials, place) = rest.split_once('@')?;
        let (user, password) = credentials.split_once(':')?;
        let (address, database) = place.split_once('/')?;
        let (host, port) = address.split_once(':')?;
        let login = DatabaseLogin {
            kind,
            host: host.to_owned(),
            port: port.parse().ok()?,
            database: database.to_owned(),
            user: user.to_owned(),
            password: password.to_owned(),
            ssl: SslMode::Disable,
        };
        let mut installed = INSTALLED.lock().unwrap_or_else(PoisonError::into_inner);
        if !installed.contains(&kind) {
            set_extension_folder(&std::env::temp_dir().join("davis-test-extensions"));
            install_database_support(kind).unwrap();
            installed.insert(kind);
        }
        Some(login)
    }

    fn schema_of(login: &DatabaseLogin) -> String {
        match login.kind {
            DatabaseKind::Postgres => "public".to_owned(),
            DatabaseKind::Mysql => login.database.clone(),
        }
    }

    fn open(connection: &str, login: &DatabaseLogin, table: &str) -> crate::OpenedTable {
        remember_login(connection, login.clone());
        let remote = RemoteTable {
            connection: connection.to_owned(),
            schema: schema_of(login),
            table: table.to_owned(),
        };
        open_remote_table(remote, table.to_owned(), RowCount::Estimated).unwrap()
    }

    fn query(tables: &[QueryTable], sql: &str) -> Result<Vec<crate::Row>> {
        run_query(tables, sql, Arc::new(AtomicBool::new(false))).map(|result| result.rows)
    }

    fn cell(text: &str) -> Option<String> {
        Some(text.to_owned())
    }

    fn sample_login(kind: DatabaseKind, password: &str) -> DatabaseLogin {
        DatabaseLogin {
            kind,
            host: "db.example.com".to_owned(),
            port: 5432,
            database: "shop".to_owned(),
            user: "o'brien".to_owned(),
            password: password.to_owned(),
            ssl: SslMode::Require,
        }
    }

    #[test]
    fn a_postgres_login_is_quoted_so_no_value_can_add_settings() {
        let login = sample_login(DatabaseKind::Postgres, "a b' sslmode=disable \\");

        assert_eq!(
            login.postgres_string(),
            "host='db.example.com' port=5432 dbname='shop' user='o\\'brien' \
             password='a b\\' sslmode=disable \\\\' sslmode=require connect_timeout=10"
        );
    }

    #[test]
    fn a_mysql_login_goes_in_a_secret_as_plain_strings() {
        let login = sample_login(DatabaseKind::Mysql, "it's");

        assert_eq!(
            login.mysql_secret("s"),
            "CREATE OR REPLACE TEMPORARY SECRET s (TYPE mysql, HOST 'db.example.com', \
             PORT 5432, DATABASE 'shop', USER 'o''brien', PASSWORD 'it''s', SSL_MODE 'required');"
        );
    }

    #[test]
    fn a_logged_failure_never_shows_the_password() {
        let login = sample_login(DatabaseKind::Postgres, "s3cret'pass");
        let failure = format!(
            "IO Error: Unable to connect to Postgres at \"{}\": password authentication failed",
            login.postgres_string()
        );

        let logged = without_password(&failure, &login);

        assert!(!logged.contains("s3cret"), "{logged}");
        assert!(logged.contains("password='(hidden)'"), "{logged}");
        assert!(logged.contains("password authentication failed"));
    }

    #[test]
    fn a_live_table_opens_and_answers_queries() {
        for kind in [DatabaseKind::Postgres, DatabaseKind::Mysql] {
            let Some(login) = test_login(kind) else {
                continue;
            };
            let table = open(&format!("open-{kind:?}"), &login, "orders");
            let tables = [QueryTable::new("orders", table.source.clone())];

            assert_eq!(table.row_count, 3, "{kind:?}");
            assert_eq!(read_rows(&table.source, 0, 10).unwrap().len(), 3);
            assert_eq!(
                query(&tables, "SELECT sum(amount)::VARCHAR FROM orders").unwrap(),
                [[cell("35.50")]],
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a_filter_narrows_a_live_table() {
        for kind in [DatabaseKind::Postgres, DatabaseKind::Mysql] {
            let Some(login) = test_login(kind) else {
                continue;
            };
            let table = open(&format!("filter-{kind:?}"), &login, "customers");
            let mut customers = QueryTable::new("customers", table.source);
            customers.filters.push(TableFilter {
                column: "region".to_owned(),
                rule: FilterRule::OneOf(vec!["APAC".to_owned()]),
                through: None,
            });

            assert_eq!(
                query(&[customers], "SELECT name FROM customers").unwrap(),
                [[cell("Grace")]],
                "{kind:?}"
            );
        }
    }

    #[test]
    fn nothing_can_change_a_live_database() {
        for kind in [DatabaseKind::Postgres, DatabaseKind::Mysql] {
            let Some(login) = test_login(kind) else {
                continue;
            };
            let name = format!("write-{kind:?}");
            let table = open(&name, &login, "orders");
            let tables = [QueryTable::new("orders", table.source)];

            for sql in [
                "INSERT INTO orders VALUES (9, 1, '2026-04-01', 1)".to_owned(),
                format!("SELECT * FROM postgres_query('db_{name}', 'SELECT 1')"),
                format!("SELECT * FROM postgres_execute('db_{name}', 'DROP TABLE orders')"),
                format!("SELECT * FROM mysql_query('db_{name}', 'SELECT 1')"),
                format!("SELECT * FROM MySQL_Execute('db_{name}', 'DROP TABLE orders')"),
                format!("DETACH \"db_{name}\""),
            ] {
                let error = query(&tables, &sql).unwrap_err();
                assert_eq!(error.code(), "rejected-query", "{kind:?} {sql}");
            }
            assert_eq!(
                query(&tables, "SELECT count(*)::VARCHAR FROM orders").unwrap(),
                [[cell("3")]],
                "{kind:?}"
            );
        }
    }

    #[test]
    fn testing_a_login_lists_its_tables_and_views() {
        for kind in [DatabaseKind::Postgres, DatabaseKind::Mysql] {
            let Some(login) = test_login(kind) else {
                continue;
            };
            let schema = schema_of(&login);

            let names: Vec<String> = test_database(&login)
                .unwrap()
                .into_iter()
                .map(|table| format!("{}.{}", table.schema, table.table))
                .collect();

            assert_eq!(
                names,
                [
                    format!("{schema}.big_orders"),
                    format!("{schema}.customers"),
                    format!("{schema}.orders"),
                ],
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a_wrong_password_says_so() {
        for kind in [DatabaseKind::Postgres, DatabaseKind::Mysql] {
            let Some(login) = test_login(kind) else {
                continue;
            };
            let wrong = DatabaseLogin {
                password: "not-the-password".to_owned(),
                ..login
            };

            let error = test_database(&wrong).unwrap_err();

            assert_eq!(
                error.to_string(),
                "Couldn't connect to the database. The user name or password is wrong.",
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a_table_without_its_login_asks_to_reconnect() {
        forget_login("never-remembered");
        let source = TableSource {
            path: "public.orders".to_owned(),
            format: Format::Parquet,
            encoding: Encoding::Utf8,
            repair: Repair::None,
            remote: Some(RemoteTable {
                connection: "never-remembered".to_owned(),
                schema: "public".to_owned(),
                table: "orders".to_owned(),
            }),
        };

        let error = read_rows(&source, 0, 1).unwrap_err();

        assert_eq!(error.code(), "disconnected-database");
    }
}
