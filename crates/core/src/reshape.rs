use std::path::Path;

use crate::profile::describe;
use crate::table::{connect, quoted};
use crate::{Error, Result};

fn csv_list(inputs: &[&Path]) -> Result<String> {
    if inputs.is_empty() {
        return Err(Error::UnsupportedFile("an empty list of files".to_owned()));
    }
    let paths: Vec<String> = inputs
        .iter()
        .map(|path| quoted(&path.to_string_lossy()))
        .collect();
    Ok(format!("[{}]", paths.join(", ")))
}

fn identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

// Files with the same columns, like one per year or one per station, read
// best as a single table.
pub fn stack_files(inputs: &[&Path], output: &Path) -> Result<()> {
    let connection = connect()?;
    connection.execute_batch(&format!(
        "COPY (SELECT * FROM read_csv({}, union_by_name = true))
         TO {} (FORMAT parquet)",
        csv_list(inputs)?,
        quoted(&output.to_string_lossy())
    ))?;
    Ok(())
}

pub struct KeepFrom<'a> {
    pub column: &'a str,
    pub value: i64,
}

// Joins files that share key columns, keeping rows any of them has, so several
// one-measure files become one table to compare measures side by side. Keys
// match even when empty, because rows like a world total have no country code.
pub fn join_files(
    inputs: &[&Path],
    keys: &[&str],
    keep_from: Option<KeepFrom>,
    output: &Path,
) -> Result<()> {
    csv_list(inputs)?;
    let connection = connect()?;
    let read = |path: &Path| format!("read_csv({})", quoted(&path.to_string_lossy()));
    let names_of = |from: &str| -> Result<Vec<String>> {
        Ok(describe(&connection, from)?
            .into_iter()
            .map(|(name, _)| name)
            .collect())
    };
    let is_key = |name: &str| keys.contains(&name);
    let mut sql = format!("SELECT * FROM {}", read(inputs[0]));
    let mut names = names_of(&read(inputs[0]))?;
    for path in &inputs[1..] {
        let other = read(path);
        let other_names = names_of(&other)?;
        let mut select: Vec<String> = keys
            .iter()
            .map(|key| {
                let key = identifier(key);
                format!("coalesce(l.{key}, r.{key}) AS {key}")
            })
            .collect();
        let mut next: Vec<String> = keys.iter().map(|key| (*key).to_owned()).collect();
        for name in names.iter().filter(|name| !is_key(name)) {
            select.push(format!("l.{}", identifier(name)));
            next.push(name.clone());
        }
        for name in other_names.iter().filter(|name| !is_key(name)) {
            let mut alias = name.clone();
            while next.contains(&alias) {
                alias.push_str(" (2)");
            }
            select.push(format!("r.{} AS {}", identifier(name), identifier(&alias)));
            next.push(alias);
        }
        let on = keys
            .iter()
            .map(|key| {
                let key = identifier(key);
                format!("l.{key} IS NOT DISTINCT FROM r.{key}")
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        sql = format!(
            "SELECT {} FROM ({sql}) AS l FULL JOIN {other} AS r ON {on}",
            select.join(", ")
        );
        names = next;
    }
    let filter = keep_from.map_or(String::new(), |keep| {
        format!(" WHERE {} >= {}", identifier(keep.column), keep.value)
    });
    let order = keys
        .iter()
        .map(|key| identifier(key))
        .collect::<Vec<_>>()
        .join(", ");
    connection.execute_batch(&format!(
        "COPY (SELECT * FROM ({sql}){filter} ORDER BY {order})
         TO {} (FORMAT parquet)",
        quoted(&output.to_string_lossy())
    ))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;
    use crate::table::{open_table, read_rows};

    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Folder(PathBuf);

    impl Folder {
        fn new() -> Self {
            let number = NEXT.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("davis-reshape-{}-{number}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, content: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn rows(path: &Path) -> Vec<Vec<String>> {
        let table = open_table(&path.to_string_lossy()).unwrap();
        read_rows(&table.source, 0, 100)
            .unwrap()
            .into_iter()
            .map(|row| row.into_iter().map(Option::unwrap_or_default).collect())
            .collect()
    }

    #[test]
    fn stacked_files_become_one_table() {
        let folder = Folder::new();
        let first = folder.write("a.csv", "station,pm25\nDongsi,10\n");
        let second = folder.write("b.csv", "station,pm25\nTiantan,20\n");
        let output = folder.0.join("all.parquet");

        stack_files(&[&first, &second], &output).unwrap();

        assert_eq!(rows(&output), [["Dongsi", "10"], ["Tiantan", "20"]]);
    }

    #[test]
    fn joined_files_keep_every_key_and_drop_early_years() {
        let folder = Folder::new();
        let gdp = folder.write("gdp.csv", "Code,Year,GDP\nFRA,1940,1\nFRA,2000,30\n");
        let people = folder.write(
            "people.csv",
            "Code,Year,Population\nFRA,2000,59\nIND,2000,1000\n",
        );
        let output = folder.0.join("world.parquet");

        join_files(
            &[&gdp, &people],
            &["Code", "Year"],
            Some(KeepFrom {
                column: "Year",
                value: 1950,
            }),
            &output,
        )
        .unwrap();

        assert_eq!(
            rows(&output),
            [["FRA", "2000", "30", "59"], ["IND", "2000", "", "1000"]]
        );
    }
}
