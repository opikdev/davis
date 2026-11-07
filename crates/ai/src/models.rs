use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::apps::{find_binary, search_folders};
use crate::connection::{fetch, models_url};
use crate::process::run;
use crate::providers::{Group, Provider, find_provider};
use crate::settings::Settings;
use crate::{Error, Result, secrets};

const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const ANTHROPIC_EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const ANTHROPIC_DEFAULT_EFFORT: &str = "high";
const NOT_FOR_CHAT: [&str; 9] = [
    "embed",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "transcribe",
    "rerank",
    "image",
    "realtime",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
}

pub fn list_models(provider_id: &str, settings_path: &Path) -> Result<Vec<Model>> {
    let provider =
        find_provider(provider_id).ok_or_else(|| Error::UnknownProvider(provider_id.to_owned()))?;
    if !provider.models.is_empty() {
        return Ok(provider.models.clone());
    }
    if provider.group == Group::App {
        return app_models(provider);
    }

    let settings = Settings::load(settings_path)?;
    let url = settings
        .connections
        .into_iter()
        .find(|saved| saved.provider_id == provider.id)
        .and_then(|saved| saved.url);
    let key = secrets::saved_key(&provider.id)?;
    service_models(provider, key.as_deref(), url.as_deref())
}

fn app_models(provider: &Provider) -> Result<Vec<Model>> {
    let unavailable = || Error::ModelsUnavailable(provider.name.clone());
    let binary = provider
        .binary
        .as_deref()
        .and_then(|name| find_binary(name, &search_folders()))
        .ok_or_else(|| Error::NotInstalled(provider.name.clone()))?;
    let run_listing = |arguments: &[&str]| {
        let output = run(&binary, arguments, LIST_TIMEOUT).ok_or_else(unavailable)?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(unavailable())
        }
    };

    match provider.id.as_str() {
        "codex" => parse_codex_models(&run_listing(&["debug", "models"])?),
        "opencode" => parse_opencode_models(&run_listing(&["models"])?),
        _ => None,
    }
    .ok_or_else(unavailable)
}

fn service_models(
    provider: &Provider,
    api_key: Option<&str>,
    url: Option<&str>,
) -> Result<Vec<Model>> {
    let target = models_url(provider, api_key, url)?;
    let body = fetch(provider, target, api_key)?
        .text()
        .map_err(|_| Error::Unreachable)?;
    serde_json::from_str(&body)
        .ok()
        .and_then(|body| parse_service_models(&body))
        .ok_or_else(|| Error::ModelsUnavailable(provider.name.clone()))
}

fn parse_codex_models(text: &str) -> Option<Vec<Model>> {
    #[derive(Deserialize)]
    struct Catalog {
        models: Vec<CodexModel>,
    }

    #[derive(Deserialize)]
    struct CodexModel {
        slug: String,
        display_name: String,
        visibility: String,
        default_reasoning_level: Option<String>,
        #[serde(default)]
        supported_reasoning_levels: Vec<CodexEffort>,
    }

    #[derive(Deserialize)]
    struct CodexEffort {
        effort: String,
    }

    let catalog: Catalog = serde_json::from_str(text).ok()?;
    Some(
        catalog
            .models
            .into_iter()
            .filter(|model| model.visibility == "list")
            .map(|model| Model {
                id: model.slug,
                name: model.display_name,
                efforts: model
                    .supported_reasoning_levels
                    .into_iter()
                    .map(|level| level.effort)
                    .collect(),
                default_effort: model.default_reasoning_level,
            })
            .collect(),
    )
}

fn parse_opencode_models(text: &str) -> Option<Vec<Model>> {
    let ids: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| line.contains('/') && !line.contains(' '))
        .collect();
    (!ids.is_empty()).then(|| {
        ids.into_iter()
            .map(|id| Model {
                id: id.to_owned(),
                name: id.to_owned(),
                efforts: Vec::new(),
                default_effort: None,
            })
            .collect()
    })
}

// Services answer in one of three shapes: {"data": []}, {"models": []}, or a bare list.
fn parse_service_models(body: &Value) -> Option<Vec<Model>> {
    let entries = body
        .get("data")
        .or_else(|| body.get("models"))
        .unwrap_or(body)
        .as_array()?;
    Some(entries.iter().filter_map(parse_service_model).collect())
}

fn parse_service_model(entry: &Value) -> Option<Model> {
    let text = |field: &str| entry.get(field).and_then(Value::as_str);
    let raw_id = text("id").or_else(|| text("name"))?;
    let id = raw_id.strip_prefix("models/").unwrap_or(raw_id);
    if !can_chat(entry, id) {
        return None;
    }

    let efforts = anthropic_efforts(entry);
    let default_effort = efforts
        .iter()
        .find(|effort| *effort == ANTHROPIC_DEFAULT_EFFORT)
        .cloned();
    Some(Model {
        id: id.to_owned(),
        name: text("display_name")
            .or_else(|| text("displayName"))
            .or_else(|| text("name"))
            .unwrap_or(id)
            .to_owned(),
        efforts,
        default_effort,
    })
}

fn can_chat(entry: &Value, id: &str) -> bool {
    let is_deprecated = entry.get("lifecycle").and_then(Value::as_str) == Some("deprecated");
    let lacks_gemini_chat = entry
        .get("supportedGenerationMethods")
        .and_then(Value::as_array)
        .is_some_and(|methods| !methods.iter().any(|method| method == "generateContent"));
    let id = id.to_lowercase();
    !is_deprecated && !lacks_gemini_chat && !NOT_FOR_CHAT.iter().any(|word| id.contains(word))
}

fn anthropic_efforts(entry: &Value) -> Vec<String> {
    let supported = |effort: &Value| effort["supported"].as_bool().unwrap_or(false);
    let effort = &entry["capabilities"]["effort"];
    if !supported(effort) {
        return Vec::new();
    }
    ANTHROPIC_EFFORTS
        .into_iter()
        .filter(|level| supported(&effort[*level]))
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use serde_json::json;

    use super::*;

    fn ids(models: &[Model]) -> Vec<&str> {
        models.iter().map(|model| model.id.as_str()).collect()
    }

    #[test]
    fn claude_code_lists_exact_models_with_efforts() {
        let models = list_models("claude-code", Path::new("unused")).unwrap();

        assert_eq!(models[0].name, "Claude Opus 5.5");
        assert_eq!(models[0].id, "claude-opus-5-5");
        assert_eq!(models[0].efforts, ["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(models[0].default_effort.as_deref(), Some("medium"));
    }

    #[test]
    fn an_unknown_provider_has_no_models() {
        let error = list_models("nobody", Path::new("unused")).unwrap_err();

        assert_eq!(error.code(), "unknown-provider");
    }

    #[test]
    fn reads_codex_models_and_skips_hidden_ones() {
        let text = json!({"models": [
            {
                "slug": "gpt-6-luna",
                "display_name": "GPT-6-Luna",
                "visibility": "list",
                "default_reasoning_level": "medium",
                "supported_reasoning_levels": [{"effort": "low"}, {"effort": "ultra"}],
            },
            {"slug": "codex-auto-review", "display_name": "Codex", "visibility": "hide"},
        ]})
        .to_string();

        let models = parse_codex_models(&text).unwrap();

        assert_eq!(
            models,
            [Model {
                id: "gpt-6-luna".to_owned(),
                name: "GPT-6-Luna".to_owned(),
                efforts: vec!["low".to_owned(), "ultra".to_owned()],
                default_effort: Some("medium".to_owned()),
            }]
        );
    }

    #[test]
    fn unexpected_codex_output_gives_no_models() {
        assert!(parse_codex_models("not json").is_none());
    }

    #[test]
    fn reads_opencode_model_lines_and_ignores_notices() {
        let text = "Updating models...\nopencode/big-pickle\nopenrouter/a/b\n\n";

        let models = parse_opencode_models(text).unwrap();

        assert_eq!(ids(&models), ["opencode/big-pickle", "openrouter/a/b"]);
    }

    #[test]
    fn opencode_output_without_models_is_a_failure() {
        assert!(parse_opencode_models("Error: no providers\n").is_none());
    }

    #[test]
    fn reads_each_response_shape() {
        let data = json!({"data": [{"id": "gpt-5"}]});
        let models = json!({"models": [{"name": "llama3:8b"}]});
        let list = json!([{"id": "meta/llama"}]);

        assert_eq!(ids(&parse_service_models(&data).unwrap()), ["gpt-5"]);
        assert_eq!(ids(&parse_service_models(&models).unwrap()), ["llama3:8b"]);
        assert_eq!(ids(&parse_service_models(&list).unwrap()), ["meta/llama"]);
    }

    #[test]
    fn a_response_without_a_list_is_a_failure() {
        assert!(parse_service_models(&json!({"error": "nope"})).is_none());
    }

    #[test]
    fn prefers_the_display_name() {
        let body = json!({"data": [
            {"id": "a", "display_name": "Model A"},
            {"name": "models/b", "displayName": "Model B"},
        ]});

        let models = parse_service_models(&body).unwrap();

        assert_eq!(ids(&models), ["a", "b"]);
        assert_eq!(models[0].name, "Model A");
        assert_eq!(models[1].name, "Model B");
    }

    #[test]
    fn leaves_out_models_that_cannot_chat() {
        let body = json!({"data": [
            {"id": "text-embedding-3-small"},
            {"id": "whisper-1"},
            {"id": "gemini-embedding", "supportedGenerationMethods": ["embedContent"]},
            {"id": "gemini-pro", "supportedGenerationMethods": ["generateContent"]},
            {"id": "claude-old", "lifecycle": "deprecated"},
            {"id": "claude-new", "lifecycle": "active"},
        ]});

        let models = parse_service_models(&body).unwrap();

        assert_eq!(ids(&models), ["gemini-pro", "claude-new"]);
    }

    #[test]
    fn reads_only_the_efforts_a_model_supports() {
        let body = json!({"data": [{
            "id": "claude-a",
            "capabilities": {"effort": {
                "supported": true,
                "low": {"supported": true},
                "medium": {"supported": false},
                "high": {"supported": true},
                "max": {"supported": true},
                "xhigh": null,
            }},
        }]});

        let models = parse_service_models(&body).unwrap();

        assert_eq!(models[0].efforts, ["low", "high", "max"]);
        assert_eq!(models[0].default_effort.as_deref(), Some("high"));
    }

    #[test]
    fn a_model_without_effort_support_offers_none() {
        let body = json!({"data": [{
            "id": "claude-a",
            "capabilities": {"effort": {"supported": false, "low": {"supported": true}}},
        }]});

        let models = parse_service_models(&body).unwrap();

        assert!(models[0].efforts.is_empty());
        assert_eq!(models[0].default_effort, None);
    }

    fn serve_once(status: &'static str, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        format!("http://127.0.0.1:{port}")
    }

    fn custom_provider() -> &'static Provider {
        find_provider("custom").unwrap()
    }

    #[test]
    fn asks_the_service_for_its_models() {
        let url = serve_once("200 OK", r#"{"data":[{"id":"local-model"}]}"#);

        let models = service_models(custom_provider(), None, Some(&url)).unwrap();

        assert_eq!(ids(&models), ["local-model"]);
    }

    #[test]
    fn a_rejected_key_is_reported_when_listing() {
        let url = serve_once("401 Unauthorized", "");

        let error = service_models(custom_provider(), None, Some(&url)).unwrap_err();

        assert_eq!(error.code(), "rejected-key");
    }

    #[test]
    fn an_unreadable_answer_is_reported_when_listing() {
        let url = serve_once("200 OK", "<html>not models</html>");

        let error = service_models(custom_provider(), None, Some(&url)).unwrap_err();

        assert_eq!(error.code(), "models-unavailable");
    }
}
