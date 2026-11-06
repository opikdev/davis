use std::path::Path;
use std::time::Duration;

use reqwest::StatusCode;
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use url::{Host, Url};

use crate::apps::{Account, AppStatus, check_app, search_folders};
use crate::providers::{Auth, Group, Provider, find_provider};
use crate::settings::{SavedConnection, Settings};
use crate::{Error, Result, secrets};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRequest {
    pub provider_id: String,
    pub api_key: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider_id: String,
    pub account: Option<Account>,
}

pub fn connect(request: ConnectionRequest, settings_path: &Path) -> Result<Connection> {
    let provider = find_provider(&request.provider_id)
        .ok_or_else(|| Error::UnknownProvider(request.provider_id.clone()))?;
    let api_key = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    let url = request
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty());

    let account = if provider.group == Group::App {
        connect_app(provider).or_else(|error| {
            if matches!(error, Error::NotInstalled(_) | Error::NotSignedIn(_)) {
                forget(&provider.id, settings_path)?;
            }
            Err(error)
        })?
    } else {
        check_endpoint(provider, api_key, url)?;
        match api_key {
            Some(key) => secrets::save_key(&provider.id, key)?,
            None => secrets::delete_key(&provider.id)?,
        }
        None
    };

    Settings::update(settings_path, |settings| {
        settings.remember(SavedConnection {
            provider_id: provider.id.clone(),
            url: url.filter(|_| provider.needs_url).map(str::to_owned),
        });
    })?;

    Ok(Connection {
        provider_id: provider.id.clone(),
        account,
    })
}

pub fn disconnect(provider_id: &str, settings_path: &Path) -> Result<()> {
    secrets::delete_key(provider_id)?;
    forget(provider_id, settings_path)
}

fn forget(provider_id: &str, settings_path: &Path) -> Result<()> {
    Settings::update(settings_path, |settings| settings.forget(provider_id))
}

fn connect_app(provider: &Provider) -> Result<Option<Account>> {
    proven_account(provider, check_app(provider, &search_folders()))
}

fn proven_account(provider: &Provider, status: AppStatus) -> Result<Option<Account>> {
    if !status.installed {
        return Err(Error::NotInstalled(provider.name.clone()));
    }
    match status.signed_in {
        Some(true) => Ok(status.account),
        Some(false) => Err(Error::NotSignedIn(provider.name.clone())),
        None => Err(Error::CheckFailed(provider.name.clone())),
    }
}

pub(crate) fn check_endpoint(
    provider: &Provider,
    api_key: Option<&str>,
    url: Option<&str>,
) -> Result<()> {
    if api_key.is_none() && !provider.key_optional {
        return Err(Error::RejectedKey);
    }
    if api_key.is_some_and(|key| key.chars().any(char::is_control)) {
        return Err(Error::RejectedKey);
    }
    let target = endpoint_url(provider, api_key, url)?;
    let client = client_for(&target).map_err(|_| Error::Unreachable)?;
    let request = authorize(client.get(target), provider.auth, api_key);
    let response = request.send().map_err(|_| Error::Unreachable)?;

    match response.status() {
        status if status.is_success() => Ok(()),
        StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED => Err(Error::RejectedKey),
        StatusCode::FORBIDDEN => Err(Error::KeyNotAllowed),
        StatusCode::NOT_FOUND => Err(Error::BadAddress(provider.name.clone())),
        status if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() => {
            Err(Error::Busy)
        }
        _ => Err(Error::Unreachable),
    }
}

// A system proxy must never see a key meant for this computer.
fn client_for(target: &Url) -> reqwest::Result<Client> {
    let builder = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(Policy::none());
    if is_this_computer(target) {
        builder.no_proxy().build()
    } else {
        builder.build()
    }
}

fn endpoint_url(provider: &Provider, api_key: Option<&str>, url: Option<&str>) -> Result<Url> {
    if let Some(test_url) = &provider.test_url {
        return Url::parse(test_url).map_err(|_| Error::BadAddress(test_url.clone()));
    }

    let base = url
        .or(provider.default_url.as_deref())
        .ok_or_else(|| Error::BadAddress(provider.name.clone()))?;
    let path = provider.test_path.as_deref().unwrap_or_default();
    let address = format!("{}{path}", base.trim_end_matches('/'));
    let parsed = Url::parse(&address).map_err(|_| Error::BadAddress(base.to_owned()))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(Error::BadAddress(base.to_owned()));
    }

    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if api_key.is_none() || is_this_computer(&parsed) => Ok(parsed),
        "http" => Err(Error::InsecureAddress(base.to_owned())),
        _ => Err(Error::BadAddress(base.to_owned())),
    }
}

fn is_this_computer(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn authorize(request: RequestBuilder, auth: Option<Auth>, api_key: Option<&str>) -> RequestBuilder {
    let (Some(auth), Some(key)) = (auth, api_key) else {
        return request;
    };
    match auth {
        Auth::Bearer => request.bearer_auth(key),
        Auth::XApiKey => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        Auth::XGoogApiKey => request.header("x-goog-api-key", key),
        Auth::XPortkeyApiKey => request.header("x-portkey-api-key", key),
        Auth::ApiKey => request.header("api-key", key),
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc::{self, Receiver};
    use std::thread;

    use super::*;

    fn serve_once(status_line: &'static str) -> (String, Receiver<String>) {
        serve_once_with_header(status_line, String::new())
    }

    fn serve_once_with_header(
        status_line: &'static str,
        header: String,
    ) -> (String, Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, received) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 4096];
            let size = stream.read(&mut buffer).unwrap();
            let response = format!("HTTP/1.1 {status_line}\r\n{header}Content-Length: 0\r\n\r\n");
            stream.write_all(response.as_bytes()).unwrap();
            sender
                .send(String::from_utf8_lossy(&buffer[..size]).to_lowercase())
                .unwrap();
        });
        (format!("http://127.0.0.1:{port}"), received)
    }

    fn custom_provider() -> Provider {
        find_provider("custom").unwrap().clone()
    }

    fn app_status(installed: bool, signed_in: Option<bool>) -> AppStatus {
        AppStatus {
            id: "codex".to_owned(),
            installed,
            signed_in,
            account: Some(Account {
                email: Some("ada@example.com".to_owned()),
                plan: None,
            }),
        }
    }

    fn proven_code(installed: bool, signed_in: Option<bool>) -> &'static str {
        let codex = find_provider("codex").unwrap();
        proven_account(codex, app_status(installed, signed_in))
            .unwrap_err()
            .code()
    }

    #[test]
    fn a_signed_in_app_connects_with_its_account() {
        let codex = find_provider("codex").unwrap();

        let account = proven_account(codex, app_status(true, Some(true))).unwrap();

        assert_eq!(account.unwrap().email.unwrap(), "ada@example.com");
    }

    #[test]
    fn a_signed_out_app_does_not_connect() {
        assert_eq!(proven_code(true, Some(false)), "not-signed-in");
    }

    #[test]
    fn an_app_whose_sign_in_cannot_be_read_does_not_connect() {
        assert_eq!(proven_code(true, None), "check-failed");
    }

    #[test]
    fn a_missing_app_does_not_connect() {
        assert_eq!(proven_code(false, None), "not-installed");
    }

    #[test]
    fn accepts_a_key_the_server_accepts_and_sends_it_as_bearer() {
        let (url, request) = serve_once("200 OK");

        check_endpoint(&custom_provider(), Some("secret"), Some(&url)).unwrap();

        let request = request.recv().unwrap();
        assert!(request.starts_with("get /models "), "got {request}");
        assert!(
            request.contains("authorization: bearer secret"),
            "got {request}"
        );
    }

    #[test]
    fn reports_a_rejected_key() {
        let (url, _request) = serve_once("401 Unauthorized");

        let error = check_endpoint(&custom_provider(), Some("wrong"), Some(&url)).unwrap_err();

        assert_eq!(error.code(), "rejected-key");
    }

    #[test]
    fn a_forbidden_key_is_not_called_wrong() {
        let (url, _) = serve_once("403 Forbidden");

        let error = check_endpoint(&custom_provider(), Some("key"), Some(&url)).unwrap_err();

        assert_eq!(error.code(), "key-not-allowed");
    }

    #[test]
    fn a_key_with_a_line_break_is_rejected_before_it_is_sent() {
        let error = check_endpoint(
            &custom_provider(),
            Some("one\ntwo"),
            Some("http://localhost:1"),
        )
        .unwrap_err();

        assert_eq!(error.code(), "rejected-key");
    }

    #[test]
    fn an_address_cannot_carry_a_username_or_password() {
        for address in [
            "https://user:secret@example.com",
            "https://user@example.com",
        ] {
            let error = endpoint_url(&custom_provider(), None, Some(address)).unwrap_err();

            assert_eq!(error.code(), "bad-address");
        }
    }

    #[test]
    fn reports_a_rate_limit_as_busy_rather_than_a_bad_key() {
        let (url, _request) = serve_once("429 Too Many Requests");

        let error = check_endpoint(&custom_provider(), None, Some(&url)).unwrap_err();

        assert_eq!(error.code(), "busy");
    }

    #[test]
    fn reports_a_wrong_address_when_the_path_does_not_exist() {
        let (url, _request) = serve_once("404 Not Found");

        let error = check_endpoint(&custom_provider(), None, Some(&url)).unwrap_err();

        assert_eq!(error.code(), "bad-address");
    }

    #[test]
    fn does_not_follow_redirects_with_a_key() {
        let (other_server, other_request) = serve_once("200 OK");
        let location = format!("Location: {other_server}/stolen\r\n");
        let (url, _request) = serve_once_with_header("302 Found", location);

        let error = check_endpoint(&custom_provider(), Some("secret"), Some(&url)).unwrap_err();

        assert_eq!(error.code(), "unreachable");
        assert!(
            other_request
                .recv_timeout(Duration::from_millis(200))
                .is_err(),
            "the redirect target received a request"
        );
    }

    #[test]
    fn reports_a_server_that_is_not_running() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let url = format!("http://127.0.0.1:{port}");
        let error = check_endpoint(&custom_provider(), None, Some(&url)).unwrap_err();

        assert_eq!(error.code(), "unreachable");
    }

    #[test]
    fn refuses_to_send_a_key_over_plain_http_to_another_computer() {
        let error = check_endpoint(
            &custom_provider(),
            Some("secret"),
            Some("http://example.com/v1"),
        )
        .unwrap_err();

        assert_eq!(error.code(), "insecure-address");
    }

    #[test]
    fn rejects_addresses_that_are_not_http() {
        let error =
            check_endpoint(&custom_provider(), None, Some("file:///etc/hosts")).unwrap_err();

        assert_eq!(error.code(), "bad-address");
    }

    #[test]
    fn a_hosted_provider_ignores_any_address_from_the_ui() {
        let openai = find_provider("openai").unwrap();

        let url = endpoint_url(openai, Some("secret"), Some("https://evil.example")).unwrap();

        assert_eq!(url.as_str(), "https://api.openai.com/v1/models");
    }

    #[test]
    fn a_required_key_cannot_be_empty() {
        let openai = find_provider("openai").unwrap();

        let error = check_endpoint(openai, None, None).unwrap_err();

        assert_eq!(error.code(), "rejected-key");
    }

    #[test]
    fn an_unknown_provider_is_an_error() {
        let request = ConnectionRequest {
            provider_id: "not-real".to_owned(),
            api_key: None,
            url: None,
        };

        let error = connect(request, Path::new("/nonexistent")).unwrap_err();

        assert_eq!(error.code(), "unknown-provider");
    }
}
