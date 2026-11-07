use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::chats::{CHATS_FOLDER, ChatSummary, list_chats};
use crate::pages::{PAGES_FOLDER, PageSummary, list_pages};
use crate::storage::write_json;
use crate::workbook::is_workbook;
use crate::{Error, Result};

const MARKER_FILE: &str = "project.json";
const DATA_FOLDER: &str = "data";
const FORMAT_VERSION: u32 = 1;
const MAX_NAME_LENGTH: usize = 80;
const FORBIDDEN_IN_NAMES: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
const DATA_EXTENSIONS: [&str; 7] = ["csv", "tsv", "txt", "gz", "parquet", "json", "jsonl"];

#[derive(Serialize, Deserialize)]
struct Marker {
    version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub path: String,
    pub name: String,
    pub files: Vec<ProjectFile>,
    pub chats: Vec<ChatSummary>,
    pub pages: Vec<PageSummary>,
}

pub(crate) fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn is_project(folder: &Path) -> bool {
    folder.join(MARKER_FILE).is_file()
}

fn clean_name(name: &str) -> Result<String> {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if FORBIDDEN_IN_NAMES.contains(&character) || character.is_control() {
                ' '
            } else {
                character
            }
        })
        .take(MAX_NAME_LENGTH)
        .collect();
    let cleaned = cleaned.trim_matches(['.', ' ']);
    if cleaned.chars().any(char::is_alphanumeric) {
        Ok(cleaned.to_owned())
    } else {
        Err(Error::InvalidName)
    }
}

fn numbered(folder: &Path, stem: &str, extension: Option<&str>, number: u32) -> PathBuf {
    let stem = match number {
        1 => stem.to_owned(),
        _ => format!("{stem} {number}"),
    };
    match extension {
        Some(extension) => folder.join(format!("{stem}.{extension}")),
        None => folder.join(stem),
    }
}

fn first_free_path(folder: &Path, stem: &str, extension: Option<&str>) -> PathBuf {
    (1..)
        .map(|number| numbered(folder, stem, extension, number))
        .find(|path| !path.exists())
        .expect("an unused number always exists")
}

pub fn create_project(parent: &Path, name: &str) -> Result<Project> {
    let name = clean_name(name)?;
    fs::create_dir_all(parent)?;
    let folder = first_free_path(parent, &name, None);
    fs::create_dir(&folder)?;
    fs::create_dir(folder.join(DATA_FOLDER))?;
    fs::create_dir(folder.join(CHATS_FOLDER))?;
    fs::create_dir(folder.join(PAGES_FOLDER))?;
    write_json(
        &folder.join(MARKER_FILE),
        &Marker {
            version: FORMAT_VERSION,
        },
    )?;
    read_project(&folder)
}

pub fn read_project(folder: &Path) -> Result<Project> {
    if !is_project(folder) {
        return Err(Error::NotAProject(folder_name(folder)));
    }
    Ok(Project {
        path: folder.to_string_lossy().into_owned(),
        name: folder_name(folder),
        files: list_files(folder)?,
        chats: list_chats(folder)?,
        pages: list_pages(folder)?,
    })
}

pub fn rename_project(folder: &Path, name: &str) -> Result<Project> {
    if !is_project(folder) {
        return Err(Error::NotAProject(folder_name(folder)));
    }
    let name = clean_name(name)?;
    if name == folder_name(folder) {
        return read_project(folder);
    }
    let renamed = folder.with_file_name(&name);
    if renamed.exists() {
        return Err(Error::NameTaken(name));
    }
    fs::rename(folder, &renamed)?;
    read_project(&renamed)
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with('.'))
}

fn is_data_file(path: &Path) -> bool {
    let has_data_extension = path.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy().to_lowercase();
        DATA_EXTENSIONS.contains(&extension.as_str())
    });
    path.is_file() && !is_hidden(path) && has_data_extension
}

fn file_details(path: &Path) -> Result<ProjectFile> {
    Ok(ProjectFile {
        name: folder_name(path),
        path: path.to_string_lossy().into_owned(),
        size_bytes: fs::metadata(path)?.len(),
    })
}

// The folder is the list, so files added or removed in Finder just appear or go.
fn list_files(folder: &Path) -> Result<Vec<ProjectFile>> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(folder.join(DATA_FOLDER))? {
        let path = entry?.path();
        if is_data_file(&path) {
            paths.push(path);
        }
    }
    paths.sort();
    paths.iter().map(|path| file_details(path)).collect()
}

pub(crate) fn split_file_name(name: &str) -> (&str, Option<&str>) {
    match name.split_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, Some(extension)),
        _ => (name, None),
    }
}

pub(crate) fn data_folder(project: &Path) -> Result<PathBuf> {
    if !is_project(project) {
        return Err(Error::NotAProject(folder_name(project)));
    }
    let data = project.join(DATA_FOLDER);
    fs::create_dir_all(&data)?;
    Ok(data)
}

pub(crate) fn place_file(data: &Path, name: &str, content: &[u8]) -> Result<ProjectFile> {
    let same_name = data.join(name);
    if same_name.is_file() && fs::metadata(&same_name)?.len() == content.len() as u64 {
        return file_details(&same_name);
    }
    let (stem, extension) = split_file_name(name);
    let target = first_free_path(data, stem, extension);
    let partial = data.join(format!(".{name}.{}.part", std::process::id()));
    fs::write(&partial, content)?;
    fs::rename(&partial, &target)?;
    file_details(&target)
}

pub fn new_file_path(project: &Path, name: &str) -> Result<PathBuf> {
    let data = data_folder(project)?;
    let (stem, extension) = split_file_name(name);
    Ok(first_free_path(&data, stem, extension))
}

// A dropped folder adds the data files directly inside it.
pub fn data_files_in(paths: &[String]) -> Result<Vec<String>> {
    let mut files = Vec::new();
    for path in paths {
        if !Path::new(path).is_dir() {
            files.push(path.clone());
            continue;
        }
        let mut inside = Vec::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?.path();
            if is_data_file(&entry) || (is_workbook(&entry) && !is_hidden(&entry)) {
                inside.push(entry.to_string_lossy().into_owned());
            }
        }
        inside.sort();
        files.append(&mut inside);
    }
    Ok(files)
}

pub fn add_file(project: &Path, source: &Path) -> Result<ProjectFile> {
    let data = data_folder(project)?;
    let name = folder_name(source);
    let same_name = data.join(&name);
    let is_inside_project = source.canonicalize()?.parent() == Some(data.canonicalize()?.as_path());
    let is_same_file =
        same_name.is_file() && fs::metadata(&same_name)?.len() == fs::metadata(source)?.len();
    if is_inside_project || is_same_file {
        return file_details(&same_name);
    }

    let (stem, extension) = split_file_name(&name);
    let target = first_free_path(&data, stem, extension);
    let partial = data.join(format!(".{name}.{}.part", std::process::id()));
    let copied = fs::copy(source, &partial).and_then(|_| fs::rename(&partial, &target));
    if let Err(error) = copied {
        let _ = fs::remove_file(&partial);
        return Err(error.into());
    }
    file_details(&target)
}

fn existing_data_file(project: &Path, name: &str) -> Result<PathBuf> {
    if Path::new(name)
        .file_name()
        .map(|plain| plain.to_string_lossy())
        != Some(name.into())
    {
        return Err(Error::MissingItem);
    }
    let path = project.join(DATA_FOLDER).join(name);
    if !is_data_file(&path) {
        return Err(Error::MissingItem);
    }
    Ok(path)
}

pub fn remove_file(project: &Path, name: &str) -> Result<()> {
    fs::remove_file(existing_data_file(project, name)?)?;
    Ok(())
}

pub fn check_same_kind(name: &str, source: &Path) -> Result<()> {
    let extension = |path: &Path| {
        path.extension()
            .map(|extension| extension.to_string_lossy().to_lowercase())
    };
    let expected = extension(Path::new(name)).unwrap_or_default();
    if extension(source).as_deref() == Some(expected.as_str()) {
        return Ok(());
    }
    Err(Error::WrongFileKind(expected, name.to_owned()))
}

// The name stays the same, so every Page and chat built on this file keeps working.
pub fn replace_file(project: &Path, name: &str, source: &Path) -> Result<ProjectFile> {
    let target = existing_data_file(project, name)?;
    check_same_kind(name, source)?;
    if source.canonicalize()? == target.canonicalize()? {
        return file_details(&target);
    }
    let partial = target.with_file_name(format!(".{name}.{}.part", std::process::id()));
    let copied = fs::copy(source, &partial).and_then(|_| fs::rename(&partial, &target));
    if let Err(error) = copied {
        let _ = fs::remove_file(&partial);
        return Err(error.into());
    }
    file_details(&target)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::{env, fs, process};

    use super::*;

    static NEXT_FOLDER: AtomicU32 = AtomicU32::new(0);

    pub(crate) struct Folder(PathBuf);

    impl Folder {
        pub(crate) fn new(name: &str) -> Self {
            let number = NEXT_FOLDER.fetch_add(1, Ordering::Relaxed);
            let path =
                env::temp_dir().join(format!("davis-project-{name}-{}-{number}", process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        pub(crate) fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn project_in(folder: &Folder) -> PathBuf {
        PathBuf::from(create_project(folder.path(), "Sales").unwrap().path)
    }

    #[test]
    fn creates_a_folder_people_can_read() {
        let folder = Folder::new("create");

        let project = create_project(folder.path(), "Q3 Sales").unwrap();

        assert_eq!(project.name, "Q3 Sales");
        let root = folder.path().join("Q3 Sales");
        assert!(root.join("data").is_dir());
        assert!(root.join("chats").is_dir());
        assert_eq!(
            fs::read_to_string(root.join("project.json")).unwrap(),
            "{\n  \"version\": 1\n}"
        );
    }

    #[test]
    fn a_second_project_with_the_same_name_gets_a_number() {
        let folder = Folder::new("repeat");

        create_project(folder.path(), "Sales").unwrap();
        let second = create_project(folder.path(), "Sales").unwrap();

        assert_eq!(second.name, "Sales 2");
    }

    #[test]
    fn names_cannot_escape_the_folder_or_be_empty() {
        let folder = Folder::new("names");

        let project = create_project(folder.path(), "../../evil: 2026?").unwrap();

        assert_eq!(project.name, "evil  2026");
        assert!(folder.path().join("evil  2026").is_dir());
        assert!(matches!(
            create_project(folder.path(), " ./.. "),
            Err(Error::InvalidName)
        ));
    }

    #[test]
    fn only_a_project_folder_opens() {
        let folder = Folder::new("marker");

        let error = read_project(folder.path()).unwrap_err();

        assert_eq!(error.code(), "not-a-project");
    }

    #[test]
    fn renaming_moves_the_folder_and_refuses_a_taken_name() {
        let folder = Folder::new("rename");
        let project = project_in(&folder);
        create_project(folder.path(), "Taken").unwrap();

        let renamed = rename_project(&project, "Q4").unwrap();
        assert_eq!(renamed.name, "Q4");
        assert!(!project.exists());

        let error = rename_project(Path::new(&renamed.path), "Taken").unwrap_err();
        assert_eq!(error.code(), "name-taken");
    }

    #[test]
    fn adding_a_file_copies_it_and_leaves_the_original_alone() {
        let folder = Folder::new("add");
        let project = project_in(&folder);
        let original = folder.path().join("sales.csv");
        fs::write(&original, "a\n1\n").unwrap();

        let added = add_file(&project, &original).unwrap();

        assert_eq!(added.name, "sales.csv");
        assert_eq!(added.size_bytes, 4);
        assert_eq!(fs::read_to_string(&added.path).unwrap(), "a\n1\n");
        assert_ne!(Path::new(&added.path), original);
        assert_eq!(fs::read_to_string(&original).unwrap(), "a\n1\n");
    }

    #[test]
    fn adding_the_same_file_twice_keeps_one_copy() {
        let folder = Folder::new("twice");
        let project = project_in(&folder);
        let original = folder.path().join("sales.csv");
        fs::write(&original, "a\n1\n").unwrap();

        add_file(&project, &original).unwrap();
        add_file(&project, &original).unwrap();

        assert_eq!(read_project(&project).unwrap().files.len(), 1);
    }

    #[test]
    fn a_different_file_with_the_same_name_keeps_its_data_and_format() {
        let folder = Folder::new("clash");
        let project = project_in(&folder);
        let first = folder.path().join("first");
        let second = folder.path().join("second");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        fs::write(first.join("sales.csv.gz"), "one").unwrap();
        fs::write(second.join("sales.csv.gz"), "other").unwrap();

        add_file(&project, &first.join("sales.csv.gz")).unwrap();
        let added = add_file(&project, &second.join("sales.csv.gz")).unwrap();

        assert_eq!(added.name, "sales 2.csv.gz");
        assert_eq!(fs::read_to_string(&added.path).unwrap(), "other");
    }

    #[test]
    fn adding_a_file_already_in_the_project_changes_nothing() {
        let folder = Folder::new("inside");
        let project = project_in(&folder);
        let inside = project.join("data").join("sales.csv");
        fs::write(&inside, "a\n1\n").unwrap();

        let added = add_file(&project, &inside).unwrap();

        assert_eq!(added.name, "sales.csv");
        assert_eq!(read_project(&project).unwrap().files.len(), 1);
    }

    #[test]
    fn a_failed_copy_leaves_nothing_behind() {
        let folder = Folder::new("failed");
        let project = project_in(&folder);

        let result = add_file(&project, &folder.path().join("missing.csv"));

        assert!(result.is_err());
        assert_eq!(fs::read_dir(project.join("data")).unwrap().count(), 0);
    }

    #[test]
    fn the_data_folder_is_the_file_list() {
        let folder = Folder::new("scan");
        let project = project_in(&folder);
        let data = project.join("data");
        fs::write(data.join("b.parquet"), "x").unwrap();
        fs::write(data.join("a.CSV"), "x").unwrap();
        fs::write(data.join("notes.pdf"), "x").unwrap();
        fs::write(data.join(".hidden.csv"), "x").unwrap();
        fs::create_dir(data.join("folder.csv")).unwrap();

        let names: Vec<String> = read_project(&project)
            .unwrap()
            .files
            .into_iter()
            .map(|file| file.name)
            .collect();

        assert_eq!(names, ["a.CSV", "b.parquet"]);
    }

    #[test]
    fn a_folder_adds_the_data_files_directly_inside_it() {
        let folder = Folder::new("dropped");
        let dropped = folder.path().join("exports");
        fs::create_dir_all(dropped.join("nested")).unwrap();
        fs::write(dropped.join("b.csv"), "x").unwrap();
        fs::write(dropped.join("a.xlsx"), "x").unwrap();
        fs::write(dropped.join("notes.pdf"), "x").unwrap();
        fs::write(dropped.join(".hidden.csv"), "x").unwrap();
        fs::write(dropped.join("nested").join("c.csv"), "x").unwrap();
        let single = folder.path().join("one.pdf").to_string_lossy().into_owned();

        let files =
            data_files_in(&[dropped.to_string_lossy().into_owned(), single.clone()]).unwrap();

        let names: Vec<String> = files
            .iter()
            .map(|path| folder_name(Path::new(path)))
            .collect();
        assert_eq!(names, ["a.xlsx", "b.csv", "one.pdf"]);
    }

    #[test]
    fn replacing_a_file_keeps_its_name_and_changes_its_data() {
        let folder = Folder::new("replace");
        let project = project_in(&folder);
        fs::write(project.join("data").join("sales.csv"), "a\n1\n").unwrap();
        let newer = folder.path().join("sales-may.csv");
        fs::write(&newer, "a\n1\n2\n").unwrap();

        let replaced = replace_file(&project, "sales.csv", &newer).unwrap();

        assert_eq!(replaced.name, "sales.csv");
        assert_eq!(fs::read_to_string(&replaced.path).unwrap(), "a\n1\n2\n");
        let files = read_project(&project).unwrap().files;
        assert_eq!(files.len(), 1);
        assert_eq!(fs::read_to_string(&newer).unwrap(), "a\n1\n2\n");
    }

    #[test]
    fn a_file_of_another_kind_can_not_replace_one() {
        let folder = Folder::new("replace-kind");
        let project = project_in(&folder);
        let current = project.join("data").join("sales.csv");
        fs::write(&current, "a\n1\n").unwrap();
        let other = folder.path().join("sales.parquet");
        fs::write(&other, "x").unwrap();

        let error = replace_file(&project, "sales.csv", &other).unwrap_err();

        assert_eq!(error.code(), "wrong-file-kind");
        assert_eq!(fs::read_to_string(&current).unwrap(), "a\n1\n");
    }

    #[test]
    fn replacing_a_file_with_itself_leaves_it_alone() {
        let folder = Folder::new("replace-self");
        let project = project_in(&folder);
        let current = project.join("data").join("sales.csv");
        fs::write(&current, "a\n1\n").unwrap();

        replace_file(&project, "sales.csv", &current).unwrap();

        assert_eq!(fs::read_to_string(&current).unwrap(), "a\n1\n");
    }

    #[test]
    fn removing_a_file_stays_inside_the_data_folder() {
        let folder = Folder::new("remove");
        let project = project_in(&folder);
        let outside = project.join("project.json");
        fs::write(project.join("data").join("sales.csv"), "a\n").unwrap();

        assert_eq!(
            remove_file(&project, "../project.json").unwrap_err().code(),
            "missing-item"
        );
        assert!(outside.exists());

        remove_file(&project, "sales.csv").unwrap();
        assert!(read_project(&project).unwrap().files.is_empty());
    }
}
