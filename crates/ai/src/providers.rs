use std::sync::OnceLock;

use serde::Deserialize;

const PROVIDERS_JSON: &str = include_str!("../providers.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Group {
    ApiKey,
    Local,
    App,
    Router,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Auth {
    Bearer,
    XApiKey,
    XGoogApiKey,
    XPortkeyApiKey,
    ApiKey,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub group: Group,
    pub auth: Option<Auth>,
    pub test_url: Option<String>,
    pub test_path: Option<String>,
    pub default_url: Option<String>,
    pub binary: Option<String>,
    pub install_command: Option<String>,
    pub install_command_windows: Option<String>,
    pub sign_in_command: Option<String>,
    #[serde(default)]
    pub needs_url: bool,
    #[serde(default)]
    pub key_optional: bool,
}

impl Provider {
    pub(crate) fn install_command_here(&self) -> Option<&str> {
        self.install_command_for(cfg!(windows))
    }

    fn install_command_for(&self, is_windows: bool) -> Option<&str> {
        self.install_command_windows
            .as_deref()
            .filter(|_| is_windows)
            .or(self.install_command.as_deref())
    }
}

pub fn providers() -> &'static [Provider] {
    static PROVIDERS: OnceLock<Vec<Provider>> = OnceLock::new();
    PROVIDERS.get_or_init(|| serde_json::from_str(PROVIDERS_JSON).expect("providers.json is valid"))
}

pub fn find_provider(id: &str) -> Option<&'static Provider> {
    providers().iter().find(|provider| provider.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_providers_only_test_over_https() {
        for provider in providers() {
            if let Some(url) = &provider.test_url {
                assert!(url.starts_with("https://"), "{} uses {url}", provider.id);
            }
        }
    }

    #[test]
    fn every_provider_can_be_tested() {
        for provider in providers() {
            let can_test = match provider.group {
                Group::App => provider.binary.is_some(),
                _ => {
                    provider.auth.is_some()
                        && (provider.test_url.is_some() || provider.test_path.is_some())
                }
            };
            assert!(can_test, "{} has no way to test", provider.id);
        }
    }

    #[test]
    fn every_app_installs_from_a_known_source() {
        for provider in providers().iter().filter(|p| p.group == Group::App) {
            let command = provider.install_command_for(false).unwrap_or_default();
            assert!(
                command.starts_with("npm install -g ")
                    || command.starts_with("curl -fsSL https://"),
                "{} installs with {command:?}",
                provider.id
            );
            let command = provider.install_command_for(true).unwrap_or_default();
            assert!(
                command.starts_with("npm install -g ") || command.starts_with("irm https://"),
                "{} installs on Windows with {command:?}",
                provider.id
            );
        }
    }

    #[test]
    fn every_app_offers_a_download_page() {
        let manifest: serde_json::Value = serde_json::from_str(PROVIDERS_JSON).unwrap();
        for provider in manifest.as_array().unwrap() {
            if provider["group"] == "app" {
                let url = provider["downloadUrl"].as_str().unwrap_or_default();
                assert!(url.starts_with("https://"), "{}", provider["id"]);
            }
        }
    }

    #[test]
    fn only_windows_uses_the_windows_install_command() {
        let claude = find_provider("claude-code").unwrap();

        assert!(
            claude
                .install_command_for(true)
                .unwrap()
                .starts_with("irm ")
        );
        assert!(
            claude
                .install_command_for(false)
                .unwrap()
                .starts_with("curl ")
        );
    }

    #[test]
    fn a_provider_with_a_fixed_url_never_takes_one_from_the_user() {
        for provider in providers() {
            assert!(
                !(provider.test_url.is_some() && provider.needs_url),
                "{} has both",
                provider.id
            );
        }
    }
}
