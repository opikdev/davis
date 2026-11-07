mod chats;
mod error;
mod pages;
mod pdf;
mod project;
mod recents;
mod storage;
mod workbook;

pub use chats::{Chat, ChatSummary, delete_chat, read_chat, save_chat};
pub use error::{Error, Result};
pub use pages::{
    Block, BlockKind, FilterKind, Page, PageFilter, PageRow, PageSummary, change_page, delete_page,
    find_block, place_block, read_page, remove_block, save_page,
};
pub use pdf::{PageImage, images_to_pdf};
pub use project::{
    Project, ProjectFile, add_file, check_same_kind, create_project, data_files_in, new_file_path,
    read_project, remove_file, rename_project, replace_file,
};
pub use recents::{RecentProject, forget_project, recent_projects, remember_project};
pub use workbook::{add_workbook, check_workbook, is_workbook};
