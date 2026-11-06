#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Unknown AI provider: {0}")]
    UnknownProvider(String),
    #[error("The provider rejected this key")]
    RejectedKey,
    #[error("The provider refused this key")]
    KeyNotAllowed,
    #[error("Could not reach the provider")]
    Unreachable,
    #[error("The provider is busy or having problems")]
    Busy,
    #[error("Invalid address: {0}")]
    BadAddress(String),
    #[error("Keys can only be sent over https, or to this computer: {0}")]
    InsecureAddress(String),
    #[error("{0} is not installed")]
    NotInstalled(String),
    #[error("{0} is not signed in")]
    NotSignedIn(String),
    #[error("Could not check {0}")]
    CheckFailed(String),
    #[error("Installing {0} needs permission Davis doesn't have")]
    InstallPermission(String),
    #[error("Could not install {name}: {detail}")]
    InstallFailed { name: String, detail: String },
    #[error("{0} finished installing, but Davis can't find it")]
    NotDetectedAfterInstall(String),
    #[error("Could not open Terminal: {0}")]
    Terminal(String),
    #[error("Could not use the system keychain: {0}")]
    Keychain(String),
    #[error("Could not read or save settings: {0}")]
    Settings(String),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownProvider(_) => "unknown-provider",
            Self::RejectedKey => "rejected-key",
            Self::KeyNotAllowed => "key-not-allowed",
            Self::Unreachable => "unreachable",
            Self::Busy => "busy",
            Self::BadAddress(_) => "bad-address",
            Self::InsecureAddress(_) => "insecure-address",
            Self::NotInstalled(_) => "not-installed",
            Self::NotSignedIn(_) => "not-signed-in",
            Self::CheckFailed(_) => "check-failed",
            Self::InstallPermission(_) => "install-permission",
            Self::InstallFailed { .. } => "install-failed",
            Self::NotDetectedAfterInstall(_) => "not-detected-after-install",
            Self::Terminal(_) => "terminal",
            Self::Keychain(_) => "keychain",
            Self::Settings(_) => "settings",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
