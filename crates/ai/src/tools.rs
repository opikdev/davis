use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use url::Url;

use crate::apps::{find_binary, search_folders};
use crate::ask::{
    ANTHROPIC_VERSION, MAX_OUTPUT_TOKENS, SERVICE_TIME_LIMIT, chat_address, chat_auth,
};
use crate::bridge::{BridgeAddress, with_bridge};
use crate::connection::{models_url, post_json};
use crate::process::run_lines;
use crate::providers::{Auth, Group, Provider, find_provider};
use crate::settings::{ChosenModel, Settings};
use crate::{Error, Result, secrets};

const SERVER_NAME: &str = "davis";
const RUN_TIME_LIMIT: Duration = Duration::from_secs(30 * 60);
const STOP_CHECK: Duration = Duration::from_millis(50);
const TOOL_WAIT_LIMIT_MS: &str = "3600000";

pub struct ToolDefinition {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolReply {
    pub text: String,
    pub is_error: bool,
}

pub trait Toolbox: Sync {
    fn definitions(&self) -> Vec<ToolDefinition>;
    fn call(&self, name: &str, input: &Value) -> ToolReply;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelEvent {
    Thinking,
    Text(String),
}

pub struct ToolRun<'a> {
    pub settings_path: &'a Path,
    pub system: &'a str,
    pub prompt: &'a str,
    pub tools: &'a dyn Toolbox,
    pub max_model_turns: u32,
    pub stop: &'a AtomicBool,
}

struct Chosen {
    settings: Settings,
    choice: ChosenModel,
    provider: &'static Provider,
}

fn chosen(settings_path: &Path) -> Result<Chosen> {
    let settings = Settings::load(settings_path)?;
    let choice = settings.chosen_model.clone().ok_or(Error::NoModelChosen)?;
    let provider = find_provider(&choice.provider_id)
        .ok_or_else(|| Error::UnknownProvider(choice.provider_id.clone()))?;
    Ok(Chosen {
        settings,
        choice,
        provider,
    })
}

// Codex and OpenCode stay on one-shot answers until each passes a full lockdown test.
pub fn can_use_tools(settings_path: &Path) -> Result<bool> {
    let provider = chosen(settings_path)?.provider;
    Ok(provider.group != Group::App || provider.id == "claude-code")
}

pub fn run_with_tools(run: &ToolRun, on_event: &mut dyn FnMut(ModelEvent)) -> Result<String> {
    let Chosen {
        settings,
        choice,
        provider,
    } = chosen(run.settings_path)?;
    if provider.group == Group::App {
        return run_claude_code(provider, &choice, run, on_event);
    }

    let url = settings
        .connections
        .into_iter()
        .find(|saved| saved.provider_id == provider.id)
        .and_then(|saved| saved.url);
    let key = secrets::saved_key(&provider.id)?;
    let models = models_url(provider, key.as_deref(), url.as_deref())?;
    let service = Service {
        name: provider.name.clone(),
        auth: if provider.auth == Some(Auth::XApiKey) {
            provider.auth
        } else {
            chat_auth(provider)
        },
        key,
        model: choice.model_id,
        effort: choice.effort,
    };
    if provider.auth == Some(Auth::XApiKey) {
        return run_anthropic(chat_address(&models, "messages")?, &service, run, on_event);
    }
    let target = provider
        .chat_url
        .as_deref()
        .map(|address| Url::parse(address).map_err(|_| Error::BadAddress(address.to_owned())))
        .unwrap_or_else(|| chat_address(&models, "chat/completions"))?;
    run_openai_compatible(target, &service, run, on_event)
}

fn tool_names(tools: &dyn Toolbox) -> String {
    tools
        .definitions()
        .iter()
        .map(|tool| format!("mcp__{SERVER_NAME}__{}", tool.name))
        .collect::<Vec<_>>()
        .join(",")
}

fn claude_code_arguments(
    choice: &ChosenModel,
    run: &ToolRun,
    bridge: &BridgeAddress,
) -> Vec<String> {
    let server = json!({
        "mcpServers": {
            SERVER_NAME: {
                "type": "http",
                "url": bridge.url,
                "headers": { "Authorization": format!("Bearer {}", bridge.token) },
            }
        }
    });
    let mut arguments: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
    ]
    .map(str::to_owned)
    .to_vec();
    arguments.extend([
        "--mcp-config".to_owned(),
        server.to_string(),
        "--allowedTools".to_owned(),
        tool_names(run.tools),
        "--max-turns".to_owned(),
        run.max_model_turns.to_string(),
        "--model".to_owned(),
        choice.model_id.clone(),
        "--system-prompt".to_owned(),
        run.system.to_owned(),
    ]);
    if let Some(effort) = &choice.effort {
        arguments.extend(["--effort".to_owned(), effort.clone()]);
    }
    arguments.push(run.prompt.to_owned());
    arguments
}

#[derive(Default)]
struct ClaudeReply {
    text: String,
    has_failed: bool,
}

fn read_claude_event(line: &str, reply: &mut ClaudeReply, on_event: &mut dyn FnMut(ModelEvent)) {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return;
    };
    match message["type"].as_str() {
        Some("stream_event") => {
            let event = &message["event"];
            match event["type"].as_str() {
                Some("message_start") => on_event(ModelEvent::Thinking),
                Some("content_block_delta") if event["delta"]["type"] == "text_delta" => {
                    if let Some(text) = event["delta"]["text"].as_str() {
                        on_event(ModelEvent::Text(text.to_owned()));
                    }
                }
                _ => {}
            }
        }
        Some("result") => {
            reply.has_failed = message["is_error"] == true;
            reply.text = message["result"].as_str().unwrap_or_default().to_owned();
        }
        _ => {}
    }
}

fn run_claude_code(
    provider: &Provider,
    choice: &ChosenModel,
    run: &ToolRun,
    on_event: &mut dyn FnMut(ModelEvent),
) -> Result<String> {
    let binary = provider
        .binary
        .as_deref()
        .and_then(|name| find_binary(name, &search_folders()))
        .ok_or_else(|| Error::NotInstalled(provider.name.clone()))?;
    let mut reply = ClaudeReply::default();
    let finished = with_bridge(run.tools, |bridge| {
        let arguments = claude_code_arguments(choice, run, bridge);
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
        run_lines(
            &binary,
            &arguments,
            &[("MCP_TOOL_TIMEOUT", TOOL_WAIT_LIMIT_MS)],
            RUN_TIME_LIMIT,
            run.stop,
            |line| read_claude_event(line, &mut reply, on_event),
        )
    })?;

    if run.stop.load(Ordering::Relaxed) {
        return Err(Error::Stopped);
    }
    match finished {
        Some(true) if !reply.text.is_empty() && !reply.has_failed => Ok(reply.text),
        _ => Err(Error::AskFailed(provider.name.clone())),
    }
}

struct Service {
    name: String,
    auth: Option<Auth>,
    key: Option<String>,
    model: String,
    effort: Option<String>,
}

// A web request can't be cancelled, so Stop stops waiting and leaves it to finish.
fn post_until_stopped(
    target: &Url,
    service: &Service,
    header: Option<(&'static str, &'static str)>,
    body: Value,
    stop: &AtomicBool,
) -> Result<Value> {
    let (sender, receiver) = mpsc::channel();
    let (target, auth, key) = (target.clone(), service.auth, service.key.clone());
    thread::spawn(move || {
        let reply = post_json(
            target,
            auth,
            key.as_deref(),
            header,
            &body,
            SERVICE_TIME_LIMIT,
        );
        let _ = sender.send(reply);
    });
    loop {
        match receiver.recv_timeout(STOP_CHECK) {
            Ok(reply) => return reply,
            Err(RecvTimeoutError::Disconnected) => return Err(Error::Unreachable),
            Err(RecvTimeoutError::Timeout) if stop.load(Ordering::Relaxed) => {
                return Err(Error::Stopped);
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn run_anthropic(
    target: Url,
    service: &Service,
    run: &ToolRun,
    on_event: &mut dyn FnMut(ModelEvent),
) -> Result<String> {
    let definitions: Vec<Value> = run
        .tools
        .definitions()
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            })
        })
        .collect();
    let mut messages = vec![json!({ "role": "user", "content": run.prompt })];

    for _ in 0..run.max_model_turns {
        on_event(ModelEvent::Thinking);
        let mut body = json!({
            "model": service.model,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "system": run.system,
            "tools": definitions,
            "messages": messages,
        });
        if let Some(effort) = &service.effort {
            body["output_config"] = json!({ "effort": effort });
        }
        let reply = post_until_stopped(
            &target,
            service,
            Some(("anthropic-version", ANTHROPIC_VERSION)),
            body,
            run.stop,
        )?;
        if reply["stop_reason"] == "refusal" {
            return Err(Error::AskRefused(service.name.clone()));
        }

        let blocks = reply["content"].as_array().cloned().unwrap_or_default();
        let mut text = String::new();
        let mut results = Vec::new();
        for block in &blocks {
            match block["type"].as_str() {
                Some("text") => {
                    let part = block["text"].as_str().unwrap_or_default();
                    on_event(ModelEvent::Text(part.to_owned()));
                    text.push_str(part);
                }
                Some("tool_use") => {
                    let answer = run
                        .tools
                        .call(block["name"].as_str().unwrap_or_default(), &block["input"]);
                    results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": block["id"],
                        "content": answer.text,
                        "is_error": answer.is_error,
                    }));
                }
                _ => {}
            }
        }
        if run.stop.load(Ordering::Relaxed) {
            return Err(Error::Stopped);
        }
        if results.is_empty() {
            return finished_text(text, service);
        }
        messages.push(json!({ "role": "assistant", "content": blocks }));
        messages.push(json!({ "role": "user", "content": results }));
    }
    Err(Error::AskFailed(service.name.clone()))
}

fn finished_text(text: String, service: &Service) -> Result<String> {
    if text.trim().is_empty() {
        Err(Error::AskFailed(service.name.clone()))
    } else {
        Ok(text)
    }
}

fn run_openai_compatible(
    target: Url,
    service: &Service,
    run: &ToolRun,
    on_event: &mut dyn FnMut(ModelEvent),
) -> Result<String> {
    let definitions: Vec<Value> = run
        .tools
        .definitions()
        .into_iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            })
        })
        .collect();
    let mut messages = vec![
        json!({ "role": "system", "content": run.system }),
        json!({ "role": "user", "content": run.prompt }),
    ];

    for _ in 0..run.max_model_turns {
        on_event(ModelEvent::Thinking);
        let body = json!({
            "model": service.model,
            "tools": definitions,
            "messages": messages,
        });
        let reply = post_until_stopped(&target, service, None, body, run.stop)?;
        let message = reply["choices"][0]["message"].clone();
        let text = message["content"].as_str().unwrap_or_default().to_owned();
        if !text.is_empty() {
            on_event(ModelEvent::Text(text.clone()));
        }
        let calls = message["tool_calls"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if calls.is_empty() {
            return finished_text(text, service);
        }
        messages.push(message);
        for call in &calls {
            let function = &call["function"];
            let input = function["arguments"]
                .as_str()
                .and_then(|arguments| serde_json::from_str(arguments).ok())
                .unwrap_or_else(|| json!({}));
            let answer = run
                .tools
                .call(function["name"].as_str().unwrap_or_default(), &input);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call["id"],
                "content": answer.text,
            }));
        }
        if run.stop.load(Ordering::Relaxed) {
            return Err(Error::Stopped);
        }
    }
    Err(Error::AskFailed(service.name.clone()))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use tiny_http::{Response, Server};

    use super::*;

    #[derive(Default)]
    struct CountingTools {
        calls: Mutex<Vec<String>>,
    }

    impl Toolbox for CountingTools {
        fn definitions(&self) -> Vec<ToolDefinition> {
            vec![ToolDefinition {
                name: "run_query",
                description: "Runs a query",
                input_schema: json!({ "type": "object" }),
            }]
        }

        fn call(&self, name: &str, input: &Value) -> ToolReply {
            self.calls
                .lock()
                .unwrap()
                .push(format!("{name}:{}", input["sql"]));
            ToolReply {
                text: "7 rows".to_owned(),
                is_error: false,
            }
        }
    }

    // Plays back model replies in order and keeps every request it was sent.
    fn model_server(replies: Vec<Value>) -> (Url, thread::JoinHandle<Vec<Value>>) {
        let server = Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let handle = thread::spawn(move || {
            let mut seen = Vec::new();
            for reply in replies {
                let mut request = server.recv().unwrap();
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                seen.push(serde_json::from_str(&body).unwrap());
                request
                    .respond(Response::from_string(reply.to_string()))
                    .unwrap();
            }
            seen
        });
        (
            Url::parse(&format!("http://127.0.0.1:{port}/v1/chat")).unwrap(),
            handle,
        )
    }

    fn service() -> Service {
        Service {
            name: "Test".to_owned(),
            auth: None,
            key: None,
            model: "model-a".to_owned(),
            effort: None,
        }
    }

    fn tool_run<'a>(tools: &'a CountingTools, stop: &'a AtomicBool) -> ToolRun<'a> {
        ToolRun {
            settings_path: Path::new("unused"),
            system: "The instructions",
            prompt: "The question",
            tools,
            max_model_turns: 3,
            stop,
        }
    }

    #[test]
    fn anthropic_runs_tools_until_the_model_answers() {
        let (target, server) = model_server(vec![
            json!({
                "stop_reason": "tool_use",
                "content": [
                    { "type": "text", "text": "Checking." },
                    { "type": "tool_use", "id": "t1", "name": "run_query", "input": { "sql": "SELECT 1" } },
                ],
            }),
            json!({
                "stop_reason": "end_turn",
                "content": [{ "type": "text", "text": "Seven rows." }],
            }),
        ]);
        let tools = CountingTools::default();
        let stop = AtomicBool::new(false);
        let mut events = Vec::new();

        let answer = run_anthropic(target, &service(), &tool_run(&tools, &stop), &mut |event| {
            events.push(event);
        })
        .unwrap();

        assert_eq!(answer, "Seven rows.");
        assert_eq!(*tools.calls.lock().unwrap(), ["run_query:\"SELECT 1\""]);
        assert_eq!(
            events,
            [
                ModelEvent::Thinking,
                ModelEvent::Text("Checking.".to_owned()),
                ModelEvent::Thinking,
                ModelEvent::Text("Seven rows.".to_owned()),
            ]
        );
        let seen = server.join().unwrap();
        assert_eq!(seen[0]["tools"][0]["name"], "run_query");
        assert_eq!(seen[0]["system"], "The instructions");
        let messages = seen[1]["messages"].as_array().unwrap();
        assert_eq!(messages[1]["content"][1]["id"], "t1");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "t1");
        assert_eq!(messages[2]["content"][0]["content"], "7 rows");
    }

    #[test]
    fn anthropic_refusals_are_reported() {
        let (target, _server) =
            model_server(vec![json!({ "stop_reason": "refusal", "content": [] })]);
        let tools = CountingTools::default();
        let stop = AtomicBool::new(false);

        let error =
            run_anthropic(target, &service(), &tool_run(&tools, &stop), &mut |_| {}).unwrap_err();

        assert_eq!(error.code(), Error::AskRefused(String::new()).code());
    }

    #[test]
    fn openai_compatible_runs_tools_until_the_model_answers() {
        let (target, server) = model_server(vec![
            json!({ "choices": [{ "message": {
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "c1", "type": "function",
                    "function": { "name": "run_query", "arguments": "{\"sql\":\"SELECT 2\"}" },
                }],
            } }] }),
            json!({ "choices": [{ "message": { "role": "assistant", "content": "Done." } }] }),
        ]);
        let tools = CountingTools::default();
        let stop = AtomicBool::new(false);

        let answer =
            run_openai_compatible(target, &service(), &tool_run(&tools, &stop), &mut |_| {})
                .unwrap();

        assert_eq!(answer, "Done.");
        assert_eq!(*tools.calls.lock().unwrap(), ["run_query:\"SELECT 2\""]);
        let seen = server.join().unwrap();
        assert_eq!(seen[0]["messages"][0]["role"], "system");
        assert_eq!(seen[0]["tools"][0]["function"]["name"], "run_query");
        let messages = seen[1]["messages"].as_array().unwrap();
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "c1");
    }

    #[test]
    fn a_model_that_never_finishes_runs_out_of_turns() {
        let looping = json!({
            "stop_reason": "tool_use",
            "content": [{ "type": "tool_use", "id": "t", "name": "run_query", "input": {} }],
        });
        let (target, _server) = model_server(vec![looping.clone(), looping.clone(), looping]);
        let tools = CountingTools::default();
        let stop = AtomicBool::new(false);

        let error =
            run_anthropic(target, &service(), &tool_run(&tools, &stop), &mut |_| {}).unwrap_err();

        assert_eq!(error.code(), Error::AskFailed(String::new()).code());
        assert_eq!(tools.calls.lock().unwrap().len(), 3);
    }

    #[test]
    fn stopping_ends_the_wait_for_a_slow_model() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let target = Url::parse(&format!("http://127.0.0.1:{port}/v1/chat")).unwrap();
        let tools = CountingTools::default();
        let stop = AtomicBool::new(true);

        let error =
            run_anthropic(target, &service(), &tool_run(&tools, &stop), &mut |_| {}).unwrap_err();

        assert_eq!(error.code(), "stopped");
        drop(server);
    }

    #[test]
    fn claude_code_gets_only_davis_tools_and_a_private_server() {
        let tools = CountingTools::default();
        let stop = AtomicBool::new(false);
        let choice = ChosenModel {
            provider_id: "claude-code".to_owned(),
            model_id: "model-a".to_owned(),
            model_name: "Model A".to_owned(),
            effort: Some("low".to_owned()),
        };
        let bridge = BridgeAddress {
            url: "http://127.0.0.1:1234/mcp".to_owned(),
            token: "secret".to_owned(),
        };

        let arguments = claude_code_arguments(&choice, &tool_run(&tools, &stop), &bridge);

        let after = |flag: &str| {
            let index = arguments.iter().position(|value| value == flag).unwrap();
            arguments[index + 1].clone()
        };
        assert_eq!(after("--tools"), "");
        assert_eq!(after("--allowedTools"), "mcp__davis__run_query");
        assert!(arguments.iter().any(|value| value == "--strict-mcp-config"));
        assert!(
            arguments
                .iter()
                .any(|value| value == "--no-session-persistence")
        );
        let server: Value = serde_json::from_str(&after("--mcp-config")).unwrap();
        let davis = &server["mcpServers"]["davis"];
        assert_eq!(davis["url"], "http://127.0.0.1:1234/mcp");
        assert_eq!(davis["headers"]["Authorization"], "Bearer secret");
        assert_eq!(arguments.last().unwrap(), "The question");
    }

    #[test]
    fn claude_code_output_becomes_events_and_a_result() {
        let mut reply = ClaudeReply::default();
        let mut events = Vec::new();
        let mut on_event = |event| events.push(event);

        for line in [
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":""}}}"#,
            "not json",
            r#"{"type":"result","is_error":false,"result":"The answer"}"#,
        ] {
            read_claude_event(line, &mut reply, &mut on_event);
        }

        assert_eq!(
            events,
            [ModelEvent::Thinking, ModelEvent::Text("Hi".to_owned())]
        );
        assert_eq!(reply.text, "The answer");
        assert!(!reply.has_failed);
    }
}
