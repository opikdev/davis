use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use davis_project::PageImage;
use serde::Deserialize;
use tauri::AppHandle;
use tauri::async_runtime::spawn_blocking;
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Pdf,
    Png,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Png => "png",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Pdf => "PDF document",
            Self::Png => "PNG image",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    data: String,
    width: u32,
    height: u32,
}

fn decoded(image: &ExportImage) -> Result<Vec<u8>, AppError> {
    let (_, data) = image.data.split_once(',').unwrap_or(("", &image.data));
    STANDARD
        .decode(data)
        .map_err(|error| AppError::Export(error.to_string()))
}

fn file_bytes(format: ExportFormat, images: &[ExportImage]) -> Result<Vec<u8>, AppError> {
    match format {
        ExportFormat::Png => {
            let first = images
                .first()
                .ok_or_else(|| AppError::Export("there was nothing to save".to_owned()))?;
            decoded(first)
        }
        ExportFormat::Pdf => {
            let pages = images
                .iter()
                .map(|image| {
                    Ok(PageImage {
                        jpeg: decoded(image)?,
                        width: image.width,
                        height: image.height,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            Ok(davis_project::images_to_pdf(&pages))
        }
    }
}

fn suggested_name(title: &str, format: ExportFormat) -> String {
    let safe: String = title
        .chars()
        .map(|letter| {
            if r#"/\:*?"<>|"#.contains(letter) {
                '-'
            } else {
                letter
            }
        })
        .collect();
    format!("{}.{}", safe.trim(), format.extension())
}

// Davis asks where to save here, so the page itself can never choose a path to write to.
#[tauri::command]
pub async fn export_page(
    app: AppHandle,
    title: String,
    format: ExportFormat,
    images: Vec<ExportImage>,
) -> Result<Option<String>, AppError> {
    spawn_blocking(move || {
        let bytes = file_bytes(format, &images)?;
        let chosen = app
            .dialog()
            .file()
            .set_file_name(suggested_name(&title, format))
            .add_filter(format.label(), &[format.extension()])
            .blocking_save_file();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path = chosen
            .into_path()
            .map_err(|error| AppError::Export(error.to_string()))?;
        std::fs::write(&path, bytes).map_err(|error| AppError::Export(error.to_string()))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_can_not_become_a_path() {
        assert_eq!(
            suggested_name("Q3 / review: final?", ExportFormat::Pdf),
            "Q3 - review- final-.pdf"
        );
    }

    #[test]
    fn a_data_url_decodes_to_its_bytes() {
        let image = ExportImage {
            data: "data:image/png;base64,aGk=".to_owned(),
            width: 1,
            height: 1,
        };

        assert_eq!(file_bytes(ExportFormat::Png, &[image]).unwrap(), b"hi");
    }

    #[test]
    fn damaged_image_data_is_an_error() {
        let image = ExportImage {
            data: "not base64!".to_owned(),
            width: 1,
            height: 1,
        };

        assert!(file_bytes(ExportFormat::Png, &[image]).is_err());
    }
}
