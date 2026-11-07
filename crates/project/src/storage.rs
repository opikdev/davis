use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::Result;

// Writing beside the target and renaming means a crash never leaves half a file.
pub(crate) fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let text = serde_json::to_string_pretty(value)?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut file = File::create(&temporary)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}
