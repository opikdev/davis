use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::tools::Toolbox;
use crate::{Error, Result};

const ACCEPT_POLL: Duration = Duration::from_millis(50);
const SERVER_NAME: &str = "davis";
const JSON_CONTENT: &[u8] = b"application/json";

pub(crate) struct BridgeAddress {
    pub(crate) url: String,
    pub(crate) token: String,
}

fn new_token() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| Error::Unreachable)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn dispatch(tools: &dyn Toolbox, message: &Value) -> Option<Value> {
    let id = message.get("id")?;
    let params = &message["params"];
    let result = match message["method"].as_str()? {
        "initialize" => json!({
            "protocolVersion": params["protocolVersion"],
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
        }),
        "ping" => json!({}),
        "tools/list" => {
            let tools: Vec<Value> = tools
                .definitions()
                .into_iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": tool.input_schema,
                    })
                })
                .collect();
            json!({ "tools": tools })
        }
        "tools/call" => {
            let reply = tools.call(
                params["name"].as_str().unwrap_or_default(),
                &params["arguments"],
            );
            json!({
                "content": [{ "type": "text", "text": reply.text }],
                "isError": reply.is_error,
            })
        }
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "Method not found" },
            }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn is_authorized(request: &Request, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    request
        .headers()
        .iter()
        .any(|header| header.field.equiv("Authorization") && header.value.as_str() == expected)
}

fn empty(status: u16) -> Response<std::io::Empty> {
    Response::empty(status)
}

fn handle(mut request: Request, tools: &dyn Toolbox, token: &str) {
    if !is_authorized(&request, token) {
        let _ = request.respond(empty(401));
        return;
    }
    if *request.method() != Method::Post {
        let _ = request.respond(empty(405));
        return;
    }
    let mut body = String::new();
    if request.as_reader().read_to_string(&mut body).is_err() {
        let _ = request.respond(empty(400));
        return;
    }
    let Ok(message) = serde_json::from_str::<Value>(&body) else {
        let _ = request.respond(empty(400));
        return;
    };
    let _ = match dispatch(tools, &message) {
        Some(reply) => {
            let response = Response::from_string(reply.to_string()).with_header(
                Header::from_bytes(b"Content-Type", JSON_CONTENT).expect("the header is valid"),
            );
            request.respond(response)
        }
        None => request.respond(empty(202)),
    };
}

// The server lives only for this run, on this computer, behind a secret made for it.
pub(crate) fn with_bridge<T>(
    tools: &dyn Toolbox,
    work: impl FnOnce(&BridgeAddress) -> T,
) -> Result<T> {
    let server = Server::http("127.0.0.1:0").map_err(|_| Error::Unreachable)?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or(Error::Unreachable)?
        .port();
    let token = new_token()?;
    let address = BridgeAddress {
        url: format!("http://127.0.0.1:{port}/mcp"),
        token: token.clone(),
    };
    let is_finished = AtomicBool::new(false);

    Ok(thread::scope(|scope| {
        scope.spawn(|| {
            while !is_finished.load(Ordering::Relaxed) {
                if let Ok(Some(request)) = server.recv_timeout(ACCEPT_POLL) {
                    let token = token.as_str();
                    scope.spawn(move || handle(request, tools, token));
                }
            }
        });
        let outcome = work(&address);
        is_finished.store(true, Ordering::Relaxed);
        outcome
    }))
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use reqwest::blocking::Client;

    use super::*;
    use crate::tools::{ToolDefinition, ToolReply};

    struct EchoTools;

    impl Toolbox for EchoTools {
        fn definitions(&self) -> Vec<ToolDefinition> {
            vec![ToolDefinition {
                name: "run_query",
                description: "Runs a query",
                input_schema: json!({ "type": "object" }),
            }]
        }

        fn call(&self, name: &str, input: &Value) -> ToolReply {
            ToolReply {
                text: format!("{name} got {}", input["sql"]),
                is_error: input["sql"] == "bad",
            }
        }
    }

    fn post(address: &BridgeAddress, body: &Value) -> Value {
        Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(&address.url)
            .bearer_auth(&address.token)
            .body(body.to_string())
            .send()
            .and_then(|response| response.text())
            .map(|text| serde_json::from_str(&text).unwrap())
            .unwrap()
    }

    #[test]
    fn answers_the_start_of_a_session() {
        let reply = with_bridge(&EchoTools, |address| {
            post(
                address,
                &json!({
                    "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": { "protocolVersion": "2026-01-01" },
                }),
            )
        })
        .unwrap();

        assert_eq!(reply["result"]["protocolVersion"], "2026-01-01");
        assert_eq!(reply["result"]["serverInfo"]["name"], "davis");
    }

    #[test]
    fn lists_and_calls_tools() {
        let (listed, called, failed) = with_bridge(&EchoTools, |address| {
            let call = |sql: &str| {
                post(
                    address,
                    &json!({
                        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                        "params": { "name": "run_query", "arguments": { "sql": sql } },
                    }),
                )
            };
            (
                post(
                    address,
                    &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
                ),
                call("SELECT 1"),
                call("bad"),
            )
        })
        .unwrap();

        assert_eq!(listed["result"]["tools"][0]["name"], "run_query");
        assert_eq!(
            listed["result"]["tools"][0]["inputSchema"]["type"],
            "object"
        );
        assert_eq!(
            called["result"]["content"][0]["text"],
            "run_query got \"SELECT 1\""
        );
        assert_eq!(called["result"]["isError"], false);
        assert_eq!(failed["result"]["isError"], true);
    }

    #[test]
    fn notifications_get_no_reply_and_unknown_methods_say_so() {
        let (notified, unknown) = with_bridge(&EchoTools, |address| {
            let client = Client::builder().no_proxy().build().unwrap();
            let notified = client
                .post(&address.url)
                .bearer_auth(&address.token)
                .body(
                    json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string(),
                )
                .send()
                .unwrap()
                .status();
            (
                notified,
                post(
                    address,
                    &json!({ "jsonrpc": "2.0", "id": 4, "method": "nothing" }),
                ),
            )
        })
        .unwrap();

        assert_eq!(notified, StatusCode::ACCEPTED);
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn only_the_holder_of_the_secret_gets_in() {
        let statuses = with_bridge(&EchoTools, |address| {
            let client = Client::builder().no_proxy().build().unwrap();
            let body = json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/list" }).to_string();
            [
                client.post(&address.url).body(body.clone()).send(),
                client
                    .post(&address.url)
                    .bearer_auth("wrong")
                    .body(body)
                    .send(),
                client.get(&address.url).bearer_auth(&address.token).send(),
            ]
            .map(|response| response.unwrap().status())
        })
        .unwrap();

        assert_eq!(
            statuses,
            [
                StatusCode::UNAUTHORIZED,
                StatusCode::UNAUTHORIZED,
                StatusCode::METHOD_NOT_ALLOWED
            ]
        );
    }

    #[test]
    fn listens_on_this_computer_only_and_closes_after_the_run() {
        let url = with_bridge(&EchoTools, |address| {
            assert!(address.url.starts_with("http://127.0.0.1:"));
            address.url.clone()
        })
        .unwrap();

        let closed = Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(url)
            .send();
        assert!(closed.is_err());
    }
}
