use keyring::Entry;

use crate::{Error, Result};

const SERVICE: &str = "dev.opik.davis";

fn entry(provider_id: &str) -> Result<Entry> {
    Entry::new(SERVICE, provider_id).map_err(|error| Error::Keychain(error.to_string()))
}

pub(crate) fn save_key(provider_id: &str, key: &str) -> Result<()> {
    entry(provider_id)?
        .set_password(key)
        .map_err(|error| Error::Keychain(error.to_string()))
}

pub fn load_key(provider_id: &str) -> Result<String> {
    entry(provider_id)?
        .get_password()
        .map_err(|error| Error::Keychain(error.to_string()))
}

pub(crate) fn saved_key(provider_id: &str) -> Result<Option<String>> {
    match entry(provider_id)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(Error::Keychain(error.to_string())),
    }
}

pub fn delete_key(provider_id: &str) -> Result<()> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(Error::Keychain(error.to_string())),
    }
}
