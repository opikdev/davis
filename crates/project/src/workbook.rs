use std::path::Path;

use calamine::{Data, DataType, Range, Reader, open_workbook_auto};

use crate::project::{ProjectFile, data_folder, folder_name, place_file, split_file_name};
use crate::{Error, Result};

const WORKBOOK_EXTENSIONS: [&str; 5] = ["xlsx", "xlsm", "xlsb", "xls", "ods"];

pub fn is_workbook(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy().to_lowercase();
        WORKBOOK_EXTENSIONS.contains(&extension.as_str())
    })
}

fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty | Data::Error(_) => String::new(),
        Data::String(text) | Data::DateTimeIso(text) | Data::DurationIso(text) => text.clone(),
        Data::Int(number) => number.to_string(),
        Data::Float(number) => number.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::DateTime(_) => cell.as_datetime().map_or_else(String::new, |moment| {
            if moment.time() == chrono::NaiveTime::MIN {
                moment.date().to_string()
            } else {
                moment.format("%Y-%m-%d %H:%M:%S").to_string()
            }
        }),
    }
}

fn csv_field(text: &str) -> String {
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_owned()
    }
}

fn sheet_as_csv(sheet: &Range<Data>) -> Option<String> {
    let mut csv = String::new();
    for row in sheet.rows() {
        if row.iter().all(|cell| cell_text(cell).is_empty()) {
            continue;
        }
        let fields: Vec<String> = row.iter().map(|cell| csv_field(&cell_text(cell))).collect();
        csv.push_str(&fields.join(","));
        csv.push('\n');
    }
    (!csv.is_empty()).then_some(csv)
}

pub fn workbook_sheets(source: &Path) -> Result<Vec<(String, String)>> {
    let name = folder_name(source);
    let unreadable = || Error::UnreadableWorkbook(name.clone());
    let mut workbook = open_workbook_auto(source).map_err(|_| unreadable())?;
    let mut sheets = Vec::new();
    for sheet in workbook.sheet_names() {
        let range = workbook.worksheet_range(&sheet).map_err(|_| unreadable())?;
        if let Some(csv) = sheet_as_csv(&range) {
            sheets.push((sheet, csv));
        }
    }
    if sheets.is_empty() {
        return Err(Error::EmptyWorkbook(name));
    }
    Ok(sheets)
}

pub fn check_workbook(source: &Path) -> Result<()> {
    workbook_sheets(source).map(|_| ())
}

// Each sheet becomes a CSV in the project, so Excel files work like any other
// table without the engine's large Excel extension.
pub fn add_workbook(project: &Path, source: &Path) -> Result<Vec<ProjectFile>> {
    let sheets = workbook_sheets(source)?;
    let file_name = folder_name(source);
    let (stem, _) = split_file_name(&file_name);
    let is_single = sheets.len() == 1;
    let data = data_folder(project)?;
    sheets
        .into_iter()
        .map(|(sheet, csv)| {
            let clean: String = sheet
                .chars()
                .map(|character| {
                    if "/\\:*?\"<>|".contains(character) {
                        ' '
                    } else {
                        character
                    }
                })
                .collect();
            let name = if is_single {
                format!("{stem}.csv")
            } else {
                format!("{stem} - {}.csv", clean.trim())
            };
            place_file(&data, &name, csv.as_bytes())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use rust_xlsxwriter::{ExcelDateTime, Format, Workbook};

    use super::*;
    use crate::project::tests::Folder;
    use crate::{create_project, read_project};

    fn project_in(folder: &Folder) -> PathBuf {
        PathBuf::from(create_project(folder.path(), "Sales").unwrap().path)
    }

    fn two_sheets(folder: &Folder) -> PathBuf {
        let mut workbook = Workbook::new();
        let date = Format::new().set_num_format("yyyy-mm-dd");
        let first = workbook.add_worksheet().set_name("Q1").unwrap();
        first.write(0, 0, "region").unwrap();
        first.write(0, 1, "amount").unwrap();
        first.write(0, 2, "day").unwrap();
        first.write(1, 0, "EMEA, North").unwrap();
        first.write(1, 1, 1200).unwrap();
        first
            .write_datetime_with_format(
                1,
                2,
                ExcelDateTime::parse_from_str("2026-03-09").unwrap(),
                &date,
            )
            .unwrap();
        first.write(2, 0, "says \"hi\"").unwrap();
        first.write(2, 1, 0.5).unwrap();
        let second = workbook.add_worksheet().set_name("Q2 <final>").unwrap();
        second.write(0, 0, "n").unwrap();
        second.write(1, 0, true).unwrap();
        workbook.add_worksheet().set_name("Empty").unwrap();
        let path = folder.path().join("book.xlsx");
        workbook.save(&path).unwrap();
        path
    }

    #[test]
    fn each_sheet_with_data_becomes_a_table() {
        let folder = Folder::new("sheets");
        let project = project_in(&folder);

        let added = add_workbook(&project, &two_sheets(&folder)).unwrap();

        let names: Vec<&str> = added.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, ["book - Q1.csv", "book - Q2  final.csv"]);
        assert_eq!(read_project(&project).unwrap().files.len(), 2);
    }

    #[test]
    fn values_dates_and_awkward_text_survive() {
        let folder = Folder::new("values");
        let project = project_in(&folder);

        let added = add_workbook(&project, &two_sheets(&folder)).unwrap();

        assert_eq!(
            fs::read_to_string(&added[0].path).unwrap(),
            "region,amount,day\n\"EMEA, North\",1200,2026-03-09\n\"says \"\"hi\"\"\",0.5,\n"
        );
        assert_eq!(fs::read_to_string(&added[1].path).unwrap(), "n\ntrue\n");
    }

    #[test]
    fn a_workbook_with_one_sheet_keeps_a_plain_name() {
        let folder = Folder::new("single");
        let project = project_in(&folder);
        let mut workbook = Workbook::new();
        workbook.add_worksheet().write(0, 0, "a").unwrap();
        let path = folder.path().join("simple.xlsx");
        workbook.save(&path).unwrap();

        let added = add_workbook(&project, &path).unwrap();

        assert_eq!(added[0].name, "simple.csv");
    }

    #[test]
    fn adding_the_same_workbook_twice_keeps_one_copy() {
        let folder = Folder::new("again");
        let project = project_in(&folder);
        let path = two_sheets(&folder);

        add_workbook(&project, &path).unwrap();
        add_workbook(&project, &path).unwrap();

        assert_eq!(read_project(&project).unwrap().files.len(), 2);
    }

    #[test]
    fn a_damaged_or_empty_workbook_says_so_and_adds_nothing() {
        let folder = Folder::new("bad");
        let project = project_in(&folder);
        let damaged = folder.path().join("damaged.xlsx");
        fs::write(&damaged, "not a workbook").unwrap();
        let mut workbook = Workbook::new();
        workbook.add_worksheet();
        let empty = folder.path().join("empty.xlsx");
        workbook.save(&empty).unwrap();

        assert_eq!(
            add_workbook(&project, &damaged).unwrap_err().code(),
            "unreadable-workbook"
        );
        assert_eq!(
            add_workbook(&project, &empty).unwrap_err().code(),
            "empty-workbook"
        );
        assert!(read_project(&project).unwrap().files.is_empty());
    }
}
