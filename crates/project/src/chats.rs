use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::storage::write_json;
use crate::{Error, Result};

pub(crate) const CHATS_FOLDER: &str = "chats";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub table: Option<String>,
    pub turns: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
}

fn chat_path(project: &Path, id: &str) -> Result<PathBuf> {
    let is_plain_id = !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if !is_plain_id {
        return Err(Error::MissingItem);
    }
    Ok(project.join(CHATS_FOLDER).join(format!("{id}.json")))
}

pub fn save_chat(project: &Path, chat: &Chat) -> Result<()> {
    write_json(&chat_path(project, &chat.id)?, chat)
}

pub fn read_chat(project: &Path, id: &str) -> Result<Chat> {
    let text = match fs::read_to_string(chat_path(project, id)?) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(Error::MissingItem),
        Err(error) => return Err(error.into()),
    };
    Ok(serde_json::from_str(&text)?)
}

pub fn delete_chat(project: &Path, id: &str) -> Result<()> {
    match fs::remove_file(chat_path(project, id)?) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

// One unreadable chat must not stop the whole project opening, so it's left out
// of the list and its file stays where it is.
pub(crate) fn list_chats(project: &Path) -> Result<Vec<ChatSummary>> {
    let folder = project.join(CHATS_FOLDER);
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut chats = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let chat = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Chat>(&text).ok());
        if let Some(Chat {
            id,
            title,
            updated_at,
            ..
        }) = chat
        {
            chats.push(ChatSummary {
                id,
                title,
                updated_at,
            });
        }
    }
    chats.sort_by_key(|chat| std::cmp::Reverse(chat.updated_at));
    Ok(chats)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::project::tests::Folder;
    use crate::{create_project, read_project};

    fn chat(id: &str, updated_at: u64) -> Chat {
        Chat {
            id: id.to_owned(),
            title: format!("Chat {id}"),
            updated_at,
            table: Some("sales.csv".to_owned()),
            turns: json!([{ "question": "How many rows?" }]),
        }
    }

    fn project_in(folder: &Folder) -> PathBuf {
        PathBuf::from(create_project(folder.path(), "Sales").unwrap().path)
    }

    #[test]
    fn a_saved_chat_comes_back_the_same() {
        let folder = Folder::new("chat");
        let project = project_in(&folder);

        save_chat(&project, &chat("a-1", 5)).unwrap();

        assert_eq!(read_chat(&project, "a-1").unwrap(), chat("a-1", 5));
    }

    #[test]
    fn the_newest_chat_comes_first() {
        let folder = Folder::new("order");
        let project = project_in(&folder);
        save_chat(&project, &chat("old", 1)).unwrap();
        save_chat(&project, &chat("new", 9)).unwrap();

        let ids: Vec<String> = read_project(&project)
            .unwrap()
            .chats
            .into_iter()
            .map(|chat| chat.id)
            .collect();

        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn a_damaged_chat_does_not_stop_the_project_opening() {
        let folder = Folder::new("damaged");
        let project = project_in(&folder);
        save_chat(&project, &chat("good", 1)).unwrap();
        let damaged = project.join("chats").join("bad.json");
        fs::write(&damaged, "{ not json").unwrap();

        let chats = read_project(&project).unwrap().chats;

        assert_eq!(chats.len(), 1);
        assert!(damaged.exists());
        assert_eq!(
            read_chat(&project, "bad").unwrap_err().code(),
            "project-encoding"
        );
    }

    #[test]
    fn a_chat_id_cannot_reach_outside_the_chats_folder() {
        let folder = Folder::new("escape");
        let project = project_in(&folder);

        for id in ["../project", "a/b", "", "a.b"] {
            assert_eq!(read_chat(&project, id).unwrap_err().code(), "missing-item");
            assert_eq!(
                delete_chat(&project, id).unwrap_err().code(),
                "missing-item"
            );
        }
        assert!(project.join("project.json").exists());
    }

    #[test]
    fn deleting_a_chat_removes_it_and_deleting_again_is_fine() {
        let folder = Folder::new("delete");
        let project = project_in(&folder);
        save_chat(&project, &chat("a", 1)).unwrap();

        delete_chat(&project, "a").unwrap();
        delete_chat(&project, "a").unwrap();

        assert!(read_project(&project).unwrap().chats.is_empty());
    }
}
