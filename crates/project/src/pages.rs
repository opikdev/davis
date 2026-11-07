use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::storage::write_json;
use crate::{Error, Result};

pub(crate) const PAGES_FOLDER: &str = "pages";
const GRID_COLUMNS: u32 = 12;

static UPDATES: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    Figure,
    Text,
    Filter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Block {
    pub id: String,
    pub kind: BlockKind,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub title: String,
    pub sql: Option<String>,
    pub view: Option<String>,
    pub x_column: Option<String>,
    pub y_column: Option<String>,
    pub text: Option<String>,
    pub table: Option<String>,
    pub column: Option<String>,
    pub values: Vec<String>,
}

impl Default for Block {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: BlockKind::Text,
            x: 0,
            y: 0,
            w: 6,
            h: 4,
            title: String::new(),
            sql: None,
            view: None,
            x_column: None,
            y_column: None,
            text: None,
            table: None,
            column: None,
            values: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
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

fn overlaps(block: &Block, x: u32, y: u32, w: u32, h: u32) -> bool {
    x < block.x + block.w && block.x < x + w && y < block.y + block.h && block.y < y + h
}

// The first free spot, reading left to right and then down.
pub fn free_spot(blocks: &[Block], w: u32, h: u32) -> (u32, u32) {
    let w = w.min(GRID_COLUMNS);
    let bottom = blocks
        .iter()
        .map(|block| block.y + block.h)
        .max()
        .unwrap_or(0);
    for y in 0..=bottom {
        for x in 0..=(GRID_COLUMNS - w) {
            if !blocks.iter().any(|block| overlaps(block, x, y, w, h)) {
                return (x, y);
            }
        }
    }
    (0, bottom)
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
    use super::*;
    use crate::create_project;
    use crate::project::tests::Folder;
    use crate::read_project;

    fn block(x: u32, y: u32, w: u32, h: u32) -> Block {
        Block {
            x,
            y,
            w,
            h,
            ..Block::default()
        }
    }

    fn page(id: &str, updated_at: u64) -> Page {
        Page {
            id: id.to_owned(),
            title: format!("Page {id}"),
            updated_at,
            blocks: vec![block(0, 0, 6, 4)],
        }
    }

    fn project_in(folder: &Folder) -> PathBuf {
        PathBuf::from(create_project(folder.path(), "Sales").unwrap().path)
    }

    #[test]
    fn a_saved_page_comes_back_the_same() {
        let folder = Folder::new("page");
        let project = project_in(&folder);

        save_page(&project, &page("a-1", 5)).unwrap();

        assert_eq!(read_page(&project, "a-1").unwrap(), page("a-1", 5));
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

        change_page(&project, "a", 2, |page| page.blocks.push(block(6, 0, 6, 4))).unwrap();
        let changed =
            change_page(&project, "a", 3, |page| page.title = "Sales".to_owned()).unwrap();

        assert_eq!(changed.blocks.len(), 2);
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

    #[test]
    fn a_new_block_takes_the_first_free_spot() {
        assert_eq!(free_spot(&[], 6, 8), (0, 0));
        assert_eq!(free_spot(&[block(0, 0, 6, 8)], 6, 8), (6, 0));
        assert_eq!(
            free_spot(&[block(0, 0, 6, 8), block(6, 0, 6, 8)], 6, 8),
            (0, 8)
        );
        assert_eq!(free_spot(&[block(0, 0, 12, 2)], 3, 2), (0, 2));
    }

    #[test]
    fn a_block_wider_than_the_grid_still_fits() {
        assert_eq!(free_spot(&[], 20, 2), (0, 0));
    }
}
