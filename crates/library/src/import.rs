use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use davis_core::KeepFrom;
use davis_project::DataSource;
use serde::Serialize;

use crate::catalog::{Dataset, Step};
use crate::{Error, Result};

const USER_AGENT: &str = concat!(
    "Davis/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/opikdev/davis)"
);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
// The biggest dataset is about 140 MB, so this only stops a stalled download.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const PROGRESS_EVERY: Duration = Duration::from_millis(200);
const CHUNK_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub label: String,
    pub received: u64,
    pub total: Option<u64>,
}

struct Run<'a> {
    dataset: &'a Dataset,
    project: &'a Path,
    staging: PathBuf,
    report: &'a mut dyn FnMut(ImportProgress),
}

// Only `*` is needed: patterns name one file or one family of files.
fn matches(pattern: &str, name: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == name,
        Some((start, end)) => {
            name.len() >= start.len() + end.len() && name.starts_with(start) && name.ends_with(end)
        }
    }
}

impl Run<'_> {
    fn unexpected(&self) -> Error {
        Error::Unexpected(self.dataset.publisher.clone())
    }

    fn staged(&self, file: &str) -> PathBuf {
        self.staging.join(file)
    }

    fn staged_matching(&self, pattern: &str) -> Result<Vec<PathBuf>> {
        let mut found: Vec<PathBuf> = fs::read_dir(&self.staging)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .is_some_and(|name| matches(pattern, &name.to_string_lossy()))
            })
            .collect();
        found.sort();
        if found.is_empty() {
            return Err(self.unexpected());
        }
        Ok(found)
    }

    fn download(&mut self, url: &str, save_as: &str) -> Result<()> {
        let failed = |error: &dyn std::fmt::Display| {
            eprintln!("Could not download {url}: {error}");
            Error::Download(self.dataset.publisher.clone())
        };
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_TIMEOUT)
            .build()
            .map_err(|error| failed(&error))?;
        let mut response = client.get(url).send().map_err(|error| failed(&error))?;
        if !response.status().is_success() {
            return Err(failed(&response.status()));
        }
        let total = response.content_length();
        let label = format!("Downloading from {}", self.dataset.publisher);
        let partial = self.staged(&format!("{save_as}.part"));
        let mut file = File::create(&partial)?;
        let mut buffer = vec![0; CHUNK_BYTES];
        let mut received = 0;
        let mut reported = Instant::now();
        loop {
            let read = response.read(&mut buffer).map_err(|error| failed(&error))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])?;
            received += read as u64;
            if reported.elapsed() >= PROGRESS_EVERY {
                reported = Instant::now();
                (self.report)(ImportProgress {
                    label: label.clone(),
                    received,
                    total,
                });
            }
        }
        file.sync_all()?;
        fs::rename(&partial, self.staged(save_as))?;
        Ok(())
    }

    // Entries are written by file name alone, so a path inside an archive can
    // never reach outside the staging folder.
    fn unzip(&self, archive: &str, pattern: &str) -> Result<()> {
        let mut zip = zip::ZipArchive::new(File::open(self.staged(archive))?)
            .map_err(|_| self.unexpected())?;
        let mut found = false;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(|_| self.unexpected())?;
            let Some(name) = entry.enclosed_name().and_then(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            }) else {
                continue;
            };
            if entry.is_dir() || !matches(pattern, &name) {
                continue;
            }
            io::copy(&mut entry, &mut File::create(self.staged(&name))?)?;
            found = true;
        }
        if found {
            Ok(())
        } else {
            Err(self.unexpected())
        }
    }

    fn workbook(&self, file: &str) -> Result<()> {
        let stem = file.split('.').next().unwrap_or(file);
        let sheets = davis_project::workbook_sheets(&self.staged(file))?;
        for (index, (_, csv)) in sheets.iter().enumerate() {
            fs::write(self.staged(&format!("{stem}-{}.csv", index + 1)), csv)?;
        }
        Ok(())
    }

    fn step(&mut self, step: &Step) -> Result<()> {
        match step {
            Step::Download { url, save_as } => self.download(url, save_as),
            Step::Unzip { archive, pattern } => self.unzip(archive, pattern),
            Step::Workbook { file } => self.workbook(file),
            Step::Stack { pattern, save_as } => {
                let inputs = self.staged_matching(pattern)?;
                let inputs: Vec<&Path> = inputs.iter().map(PathBuf::as_path).collect();
                Ok(davis_core::stack_files(&inputs, &self.staged(save_as))?)
            }
            Step::Join {
                files,
                on,
                keep_from,
                save_as,
            } => {
                let inputs: Vec<PathBuf> = files.iter().map(|file| self.staged(file)).collect();
                let inputs: Vec<&Path> = inputs.iter().map(PathBuf::as_path).collect();
                let keys: Vec<&str> = on.iter().map(String::as_str).collect();
                let keep_from = keep_from.as_ref().map(|keep| KeepFrom {
                    column: &keep.column,
                    value: keep.value,
                });
                Ok(davis_core::join_files(
                    &inputs,
                    &keys,
                    keep_from,
                    &self.staged(save_as),
                )?)
            }
            Step::Keep { file, name } => {
                davis_project::install_file(self.project, &self.staged(file), name)?;
                Ok(())
            }
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

// Downloading again replaces the files, which is how a live dataset refreshes.
pub fn import_dataset(
    project: &Path,
    dataset: &Dataset,
    report: &mut dyn FnMut(ImportProgress),
) -> Result<Vec<String>> {
    let staging = project.join(format!(".library-{}", dataset.id));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    let mut run = Run {
        dataset,
        project,
        staging,
        report,
    };
    let outcome = dataset.steps.iter().try_for_each(|step| {
        if !matches!(step, Step::Download { .. }) {
            (run.report)(ImportProgress {
                label: "Preparing the data".to_owned(),
                received: 0,
                total: None,
            });
        }
        run.step(step)
    });
    if let Err(error) = fs::remove_dir_all(&run.staging) {
        eprintln!("Could not remove {}: {error}", run.staging.display());
    }
    outcome?;
    let files: Vec<String> = dataset
        .kept_files()
        .into_iter()
        .map(str::to_owned)
        .collect();
    davis_project::record_source(
        project,
        DataSource {
            dataset: dataset.id.clone(),
            title: dataset.title.clone(),
            publisher: dataset.publisher.clone(),
            license: dataset.license.name.clone(),
            license_url: dataset.license.url.clone(),
            credit: dataset.credit.clone(),
            source_url: dataset.source_url.clone(),
            files: files.clone(),
            added_at: now_millis(),
        },
    )?;
    Ok(files)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::io::Cursor;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::thread;

    use zip::write::SimpleFileOptions;

    use super::*;

    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Folder(PathBuf);

    impl Folder {
        fn new() -> Self {
            let number = NEXT.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("davis-library-{}-{number}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn project(&self) -> PathBuf {
            PathBuf::from(
                davis_project::create_project(&self.0, "Sample")
                    .unwrap()
                    .path,
            )
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // Serves fixed files over HTTP on a free port, like a publisher would.
    fn serve(files: HashMap<&'static str, Vec<u8>>) -> String {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = format!("http://{}", server.server_addr());
        let files = Arc::new(files);
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let path = request.url().trim_start_matches('/').to_owned();
                let response = match files.get(path.as_str()) {
                    Some(body) => tiny_http::Response::from_data(body.clone()),
                    None => tiny_http::Response::from_data(Vec::new()).with_status_code(404),
                };
                let _ = request.respond(response);
            }
        });
        address
    }

    fn zipped(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn dataset(steps: &str) -> Dataset {
        serde_json::from_str(&format!(
            r#"{{"id": "sample", "title": "Sample", "category": "nature",
                "summary": "", "covers": "", "publisher": "Example Org",
                "sourceUrl": "https://example.org", "credit": "Example Org data",
                "license": {{"name": "CC0", "url": "https://example.org/license"}},
                "sizeBytes": 1, "isFeatured": false, "isLive": false,
                "isAdvanced": false, "questions": [], "steps": {steps}}}"#
        ))
        .unwrap()
    }

    fn rows(path: &Path) -> Vec<Vec<String>> {
        let table = davis_core::open_table(&path.to_string_lossy()).unwrap();
        davis_core::read_rows(&table.source, 0, 100)
            .unwrap()
            .into_iter()
            .map(|row| row.into_iter().map(Option::unwrap_or_default).collect())
            .collect()
    }

    fn ignore_progress(_: ImportProgress) {}

    #[test]
    fn a_download_lands_in_the_project_with_its_credit() {
        let folder = Folder::new();
        let project = folder.project();
        let address = serve(HashMap::from([("quakes.csv", b"mag\n4.5\n".to_vec())]));
        let sample = dataset(&format!(
            r#"[{{"do": "download", "url": "{address}/quakes.csv", "saveAs": "q.csv"}},
                {{"do": "keep", "file": "q.csv", "name": "quakes.csv"}}]"#
        ));

        let files = import_dataset(&project, &sample, &mut ignore_progress).unwrap();

        assert_eq!(files, ["quakes.csv"]);
        assert_eq!(rows(&project.join("data/quakes.csv")), [["4.5"]]);
        let sources = davis_project::list_sources(&project).unwrap();
        assert_eq!(sources[0].credit, "Example Org data");
        assert!(!project.join(".library-sample").exists());
    }

    #[test]
    fn files_in_a_zip_inside_a_zip_are_stacked_into_one_table() {
        let folder = Folder::new();
        let project = folder.project();
        let inner = zipped(&[
            ("stations/a.csv", b"station,pm25\nDongsi,10\n"),
            ("stations/b.csv", b"station,pm25\nTiantan,20\n"),
        ]);
        let outer = zipped(&[("inner.zip", &inner), ("photo.jpg", b"not data")]);
        let address = serve(HashMap::from([("air.zip", outer)]));
        let sample = dataset(&format!(
            r#"[{{"do": "download", "url": "{address}/air.zip", "saveAs": "air.zip"}},
                {{"do": "unzip", "archive": "air.zip", "pattern": "inner.zip"}},
                {{"do": "unzip", "archive": "inner.zip", "pattern": "*.csv"}},
                {{"do": "stack", "pattern": "*.csv", "saveAs": "air.parquet"}},
                {{"do": "keep", "file": "air.parquet", "name": "air.parquet"}}]"#
        ));

        import_dataset(&project, &sample, &mut ignore_progress).unwrap();

        assert_eq!(
            rows(&project.join("data/air.parquet")),
            [["Dongsi", "10"], ["Tiantan", "20"]]
        );
    }

    #[test]
    fn files_sharing_keys_are_joined_from_a_year_on() {
        let folder = Folder::new();
        let project = folder.project();
        let address = serve(HashMap::from([
            (
                "gdp.csv",
                b"Entity,Code,Year,GDP\nWorld,,2000,9\nFrance,FRA,1900,1\n".to_vec(),
            ),
            (
                "people.csv",
                b"Entity,Code,Year,People\nWorld,,2000,6\n".to_vec(),
            ),
        ]));
        let sample = dataset(&format!(
            r#"[{{"do": "download", "url": "{address}/gdp.csv", "saveAs": "gdp.csv"}},
                {{"do": "download", "url": "{address}/people.csv", "saveAs": "people.csv"}},
                {{"do": "join", "files": ["gdp.csv", "people.csv"], "on": ["Entity", "Code", "Year"],
                  "keepFrom": {{"column": "Year", "value": 1950}}, "saveAs": "world.parquet"}},
                {{"do": "keep", "file": "world.parquet", "name": "world.parquet"}}]"#
        ));

        import_dataset(&project, &sample, &mut ignore_progress).unwrap();

        assert_eq!(
            rows(&project.join("data/world.parquet")),
            [["World", "", "2000", "9", "6"]]
        );
    }

    #[test]
    fn a_failed_download_says_which_publisher_and_leaves_nothing() {
        let folder = Folder::new();
        let project = folder.project();
        let address = serve(HashMap::new());
        let sample = dataset(&format!(
            r#"[{{"do": "download", "url": "{address}/gone.csv", "saveAs": "gone.csv"}},
                {{"do": "keep", "file": "gone.csv", "name": "gone.csv"}}]"#
        ));

        let error = import_dataset(&project, &sample, &mut ignore_progress).unwrap_err();

        assert_eq!(
            error.to_string(),
            "Couldn't download from Example Org. Check that you're online and try again."
        );
        assert!(!project.join(".library-sample").exists());
        assert!(!project.join("data/gone.csv").exists());
    }

    #[test]
    fn an_archive_without_the_expected_file_is_reported() {
        let folder = Folder::new();
        let project = folder.project();
        let address = serve(HashMap::from([("a.zip", zipped(&[("other.txt", b"x")]))]));
        let sample = dataset(&format!(
            r#"[{{"do": "download", "url": "{address}/a.zip", "saveAs": "a.zip"}},
                {{"do": "unzip", "archive": "a.zip", "pattern": "*.csv"}}]"#
        ));

        let error = import_dataset(&project, &sample, &mut ignore_progress).unwrap_err();

        assert_eq!(error.code(), "dataset-changed");
    }

    #[test]
    fn a_zip_entry_can_never_write_outside_its_folder() {
        let folder = Folder::new();
        let project = folder.project();
        let address = serve(HashMap::from([(
            "evil.zip",
            zipped(&[("../../escaped.csv", b"x\n1\n"), ("fine.csv", b"x\n2\n")]),
        )]));
        let sample = dataset(&format!(
            r#"[{{"do": "download", "url": "{address}/evil.zip", "saveAs": "evil.zip"}},
                {{"do": "unzip", "archive": "evil.zip", "pattern": "*.csv"}},
                {{"do": "keep", "file": "fine.csv", "name": "fine.csv"}}]"#
        ));

        import_dataset(&project, &sample, &mut ignore_progress).unwrap();

        assert!(!folder.0.join("escaped.csv").exists());
        assert!(!project.join("escaped.csv").exists());
        assert_eq!(rows(&project.join("data/fine.csv")), [["2"]]);
    }

    #[test]
    #[ignore = "downloads every dataset from its publisher, about 350 MB"]
    fn every_dataset_imports_from_its_publisher() {
        for dataset in crate::datasets() {
            let folder = Folder::new();
            let project = folder.project();
            let started = Instant::now();

            let files = import_dataset(&project, dataset, &mut ignore_progress)
                .unwrap_or_else(|error| panic!("{}: {error}", dataset.id));

            for file in files {
                let table =
                    davis_core::open_table(&project.join("data").join(&file).to_string_lossy())
                        .unwrap_or_else(|error| panic!("{} {file}: {error}", dataset.id));
                assert!(table.row_count > 0, "{} {file} is empty", dataset.id);
                println!(
                    "{} | {file} | {} rows | {} columns | {:?}",
                    dataset.id,
                    table.row_count,
                    table.columns.len(),
                    started.elapsed()
                );
            }
        }
    }

    #[test]
    fn only_a_star_widens_a_pattern() {
        assert!(matches("PRSA_Data_*.csv", "PRSA_Data_Dongsi_2013.csv"));
        assert!(matches("hour.csv", "hour.csv"));
        assert!(!matches("hour.csv", "day.csv"));
        assert!(!matches("*.csv", "notes.txt"));
    }
}
