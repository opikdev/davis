use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::storage::write_json;
use crate::{Error, Result};

pub(crate) const PAGES_FOLDER: &str = "pages";
const MAX_BLOCKS_IN_ROW: usize = 4;
const CHARTS_IN_ROW: usize = 2;

static UPDATES: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    Figure,
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Block {
    pub id: String,
    pub kind: BlockKind,
    pub title: String,
    pub weight: u32,
    pub sql: Option<String>,
    pub trend_sql: Option<String>,
    pub spec: Option<Value>,
    pub view: Option<String>,
    pub x_column: Option<String>,
    pub y_column: Option<String>,
    pub series_column: Option<String>,
    pub format: Option<String>,
    pub show_labels: bool,
    pub sort: Option<String>,
    pub limit: Option<u32>,
    pub text: Option<String>,
    pub sources: BTreeMap<String, String>,
}

impl Default for Block {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: BlockKind::Text,
            title: String::new(),
            weight: 1,
            sql: None,
            trend_sql: None,
            spec: None,
            view: None,
            x_column: None,
            y_column: None,
            series_column: None,
            format: None,
            show_labels: true,
            sort: None,
            limit: None,
            text: None,
            sources: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRow {
    pub id: String,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterKind {
    #[default]
    Values,
    Dates,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PageFilter {
    pub id: String,
    pub table: String,
    pub column: String,
    pub kind: FilterKind,
    pub values: Vec<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "StoredPage")]
pub struct Page {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub rows: Vec<PageRow>,
    pub filters: Vec<PageFilter>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct GridBlock {
    id: String,
    kind: String,
    x: u32,
    y: u32,
    title: String,
    sql: Option<String>,
    view: Option<String>,
    x_column: Option<String>,
    y_column: Option<String>,
    text: Option<String>,
    table: Option<String>,
    column: Option<String>,
    values: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPage {
    id: String,
    title: String,
    updated_at: u64,
    #[serde(default)]
    rows: Vec<PageRow>,
    #[serde(default)]
    filters: Vec<PageFilter>,
    #[serde(default)]
    blocks: Vec<GridBlock>,
}

// Pages saved on the free grid become rows, top to bottom and left to right.
impl From<StoredPage> for Page {
    fn from(stored: StoredPage) -> Self {
        let mut page = Self {
            id: stored.id,
            title: stored.title,
            updated_at: stored.updated_at,
            rows: stored.rows,
            filters: stored.filters,
        };
        let mut grid = stored.blocks;
        grid.sort_by_key(|block| (block.y, block.x));
        let mut last_y = None;
        for block in grid {
            if block.kind == "filter" {
                page.filters.push(PageFilter {
                    id: block.id,
                    table: block.table.unwrap_or_default(),
                    column: block.column.unwrap_or_default(),
                    values: block.values,
                    ..PageFilter::default()
                });
                continue;
            }
            let y = block.y;
            let converted = Block {
                id: block.id.clone(),
                kind: if block.kind == "text" {
                    BlockKind::Text
                } else {
                    BlockKind::Figure
                },
                title: block.title,
                sql: block.sql,
                view: block.view,
                x_column: block.x_column,
                y_column: block.y_column,
                text: block.text,
                ..Block::default()
            };
            match page.rows.last_mut() {
                Some(row) if last_y == Some(y) && row.blocks.len() < MAX_BLOCKS_IN_ROW => {
                    row.blocks.push(converted);
                }
                _ => page.rows.push(PageRow {
                    id: format!("row-{}", block.id),
                    blocks: vec![converted],
                }),
            }
            last_y = Some(y);
        }
        page
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
}

fn is_number(block: &Block) -> bool {
    block.view.as_deref() == Some("number")
}

fn is_chart(block: &Block) -> bool {
    matches!(
        block.view.as_deref(),
        Some("bar" | "line" | "area" | "stacked" | "scatter")
    )
}

// Numbers sit together, charts go in pairs, and tables and notes take a whole row.
pub fn place_block(page: &mut Page, block: Block) {
    let fits = page.rows.last().is_some_and(|row| {
        if is_number(&block) {
            row.blocks.len() < MAX_BLOCKS_IN_ROW && row.blocks.iter().all(is_number)
        } else if is_chart(&block) {
            row.blocks.len() < CHARTS_IN_ROW && row.blocks.iter().all(is_chart)
        } else {
            false
        }
    });
    match page.rows.last_mut() {
        Some(row) if fits => row.blocks.push(block),
        _ => page.rows.push(PageRow {
            id: format!("row-{}", block.id),
            blocks: vec![block],
        }),
    }
}

pub fn remove_block(page: &mut Page, id: &str) -> bool {
    let before: usize = page.rows.iter().map(|row| row.blocks.len()).sum();
    for row in &mut page.rows {
        row.blocks.retain(|block| block.id != id);
    }
    page.rows.retain(|row| !row.blocks.is_empty());
    let after: usize = page.rows.iter().map(|row| row.blocks.len()).sum();
    after < before
}

pub fn find_block<'a>(page: &'a mut Page, id: &str) -> Option<&'a mut Block> {
    page.rows
        .iter_mut()
        .flat_map(|row| row.blocks.iter_mut())
        .find(|block| block.id == id)
}

fn page_path(project: &Path, id: &str) -> Result<PathBuf> {
    let is_plain_id = !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if !is_plain_id {
        return Err(Error::MissingItem);
    }
    Ok(project.join(PAGES_FOLDER).join(format!("{id}.json")))
}

pub fn save_page(project: &Path, page: &Page) -> Result<()> {
    let _guard = UPDATES.lock().unwrap_or_else(PoisonError::into_inner);
    write_json(&page_path(project, &page.id)?, page)
}

pub fn read_page(project: &Path, id: &str) -> Result<Page> {
    let text = match fs::read_to_string(page_path(project, id)?) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(Error::MissingItem),
        Err(error) => return Err(error.into()),
    };
    Ok(serde_json::from_str(&text)?)
}

pub fn delete_page(project: &Path, id: &str) -> Result<()> {
    match fs::remove_file(page_path(project, id)?) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

// Each change reads the latest file, so the AI and the person never overwrite each other.
pub fn change_page(
    project: &Path,
    id: &str,
    updated_at: u64,
    change: impl FnOnce(&mut Page),
) -> Result<Page> {
    let _guard = UPDATES.lock().unwrap_or_else(PoisonError::into_inner);
    let path = page_path(project, id)?;
    let text = fs::read_to_string(&path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => Error::MissingItem,
        _ => error.into(),
    })?;
    let mut page: Page = serde_json::from_str(&text)?;
    change(&mut page);
    page.updated_at = updated_at;
    write_json(&path, &page)?;
    Ok(page)
}

// One unreadable page must not stop the project opening, so it's left out of the list.
pub(crate) fn list_pages(project: &Path) -> Result<Vec<PageSummary>> {
    let entries = match fs::read_dir(project.join(PAGES_FOLDER)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut pages = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let page = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Page>(&text).ok());
        if let Some(page) = page {
            pages.push(PageSummary {
                id: page.id,
                title: page.title,
                updated_at: page.updated_at,
            });
        }
    }
    pages.sort_by_key(|page| std::cmp::Reverse(page.updated_at));
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::create_project;
    use crate::project::tests::Folder;
    use crate::read_project;

    fn figure(id: &str, view: &str) -> Block {
        Block {
            id: id.to_owned(),
            kind: BlockKind::Figure,
            view: Some(view.to_owned()),
            ..Block::default()
        }
    }

    fn page(id: &str, updated_at: u64) -> Page {
        Page {
            id: id.to_owned(),
            title: format!("Page {id}"),
            updated_at,
            rows: Vec::new(),
            filters: Vec::new(),
        }
    }

    fn project_in(folder: &Folder) -> PathBuf {
        PathBuf::from(create_project(folder.path(), "Sales").unwrap().path)
    }

    fn shape(page: &Page) -> Vec<Vec<&str>> {
        page.rows
            .iter()
            .map(|row| row.blocks.iter().map(|block| block.id.as_str()).collect())
            .collect()
    }

    #[test]
    fn a_saved_page_comes_back_the_same() {
        let folder = Folder::new("page");
        let project = project_in(&folder);
        let mut saved = page("a-1", 5);
        place_block(&mut saved, figure("b1", "bar"));
        saved.filters.push(PageFilter {
            id: "f1".to_owned(),
            kind: FilterKind::Dates,
            from: Some("2026-01-01".to_owned()),
            ..PageFilter::default()
        });

        save_page(&project, &saved).unwrap();

        assert_eq!(read_page(&project, "a-1").unwrap(), saved);
    }

    #[test]
    fn a_page_from_the_free_grid_becomes_rows() {
        let folder = Folder::new("grid");
        let project = project_in(&folder);
        let old = json!({
            "id": "old", "title": "Old", "updatedAt": 1,
            "blocks": [
                { "id": "c", "kind": "figure", "x": 0, "y": 9, "w": 12, "h": 8, "title": "Below", "sql": "SELECT 3" },
                { "id": "b", "kind": "figure", "x": 6, "y": 0, "w": 6, "h": 8, "title": "Right", "sql": "SELECT 2", "view": "bar", "xColumn": "a", "yColumn": "b" },
                { "id": "a", "kind": "figure", "x": 0, "y": 0, "w": 6, "h": 8, "title": "Left", "sql": "SELECT 1" },
                { "id": "n", "kind": "text", "x": 0, "y": 20, "w": 6, "h": 3, "text": "Hello" },
                { "id": "f", "kind": "filter", "x": 9, "y": 0, "w": 3, "h": 3, "table": "customers.csv", "column": "region", "values": ["EMEA"] },
            ],
        });
        fs::write(project.join("pages").join("old.json"), old.to_string()).unwrap();

        let converted = read_page(&project, "old").unwrap();

        assert_eq!(shape(&converted), [vec!["a", "b"], vec!["c"], vec!["n"]]);
        assert_eq!(converted.rows[0].blocks[1].sql.as_deref(), Some("SELECT 2"));
        assert_eq!(converted.rows[0].blocks[1].x_column.as_deref(), Some("a"));
        assert_eq!(converted.rows[2].blocks[0].kind, BlockKind::Text);
        assert_eq!(converted.filters.len(), 1);
        assert_eq!(converted.filters[0].column, "region");
        assert_eq!(converted.filters[0].values, ["EMEA"]);
    }

    #[test]
    fn numbers_sit_together_charts_pair_up_and_tables_get_a_row() {
        let mut built = page("p", 1);
        for (id, view) in [
            ("n1", "number"),
            ("n2", "number"),
            ("c1", "bar"),
            ("c2", "line"),
            ("c3", "bar"),
            ("t1", "table"),
            ("c4", "bar"),
        ] {
            place_block(&mut built, figure(id, view));
        }

        assert_eq!(
            shape(&built),
            [
                vec!["n1", "n2"],
                vec!["c1", "c2"],
                vec!["c3"],
                vec!["t1"],
                vec!["c4"]
            ]
        );
    }

    #[test]
    fn a_row_holds_at_most_four_numbers() {
        let mut built = page("p", 1);
        for id in ["1", "2", "3", "4", "5"] {
            place_block(&mut built, figure(id, "number"));
        }

        assert_eq!(built.rows[0].blocks.len(), 4);
        assert_eq!(built.rows.len(), 2);
    }

    #[test]
    fn removing_the_last_block_in_a_row_removes_the_row() {
        let mut built = page("p", 1);
        place_block(&mut built, figure("t1", "table"));
        place_block(&mut built, figure("t2", "table"));

        assert!(remove_block(&mut built, "t1"));
        assert!(!remove_block(&mut built, "nope"));

        assert_eq!(shape(&built), [vec!["t2"]]);
    }

    #[test]
    fn pages_are_listed_newest_first_and_a_damaged_one_is_skipped() {
        let folder = Folder::new("list");
        let project = project_in(&folder);
        save_page(&project, &page("old", 1)).unwrap();
        save_page(&project, &page("new", 9)).unwrap();
        fs::write(project.join("pages").join("bad.json"), "{ not json").unwrap();

        let ids: Vec<String> = read_project(&project)
            .unwrap()
            .pages
            .into_iter()
            .map(|page| page.id)
            .collect();

        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn a_change_starts_from_what_is_on_disk() {
        let folder = Folder::new("change");
        let project = project_in(&folder);
        save_page(&project, &page("a", 1)).unwrap();

        change_page(&project, "a", 2, |page| {
            place_block(page, figure("b", "table"))
        })
        .unwrap();
        let changed =
            change_page(&project, "a", 3, |page| page.title = "Sales".to_owned()).unwrap();

        assert_eq!(changed.rows.len(), 1);
        assert_eq!(changed.title, "Sales");
        assert_eq!(read_page(&project, "a").unwrap().updated_at, 3);
    }

    #[test]
    fn a_page_id_cannot_reach_outside_the_pages_folder() {
        let folder = Folder::new("escape");
        let project = project_in(&folder);

        for id in ["../project", "a/b", "", "a.b"] {
            assert_eq!(read_page(&project, id).unwrap_err().code(), "missing-item");
            assert_eq!(
                delete_page(&project, id).unwrap_err().code(),
                "missing-item"
            );
        }
        assert!(project.join("project.json").exists());
    }
}
