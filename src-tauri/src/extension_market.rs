//! 维护者控制的签名目录与包下载；不执行插件，也不接受前端 URL。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extensions::{ExtensionPreview, PACKAGE_LIMIT, preview_package},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::{
    collections::HashSet,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_http::reqwest::{Client, redirect::Policy};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use url::Url;

const CATALOG_LIMIT: usize = 2 * 1024 * 1024;
const CACHE_DURATION: Duration = Duration::from_secs(300);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketConfig {
    pub repository: String,
    pub public_key: String,
}
impl MarketConfig {
    pub fn configured() -> NativeResult<Self> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Config {
            extension_market: MarketConfig,
        }
        let config = serde_json::from_str::<Config>(include_str!("../../app.config.json"))
            .map_err(|_| failure(ErrorCode::MarketNotConfigured))?
            .extension_market;
        config.validate()?;
        Ok(config)
    }
    fn validate(&self) -> NativeResult<()> {
        let parts: Vec<_> = self.repository.split('/').collect();
        if self.repository.len() > 200
            || parts.len() != 2
            || parts.iter().any(|part| {
                part.is_empty()
                    || matches!(*part, "." | "..")
                    || !part
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
            })
            || !parts[0]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || self.public_key.len() > 128
            || PublicKey::from_base64(&self.public_key).is_err()
        {
            return Err(failure(ErrorCode::MarketNotConfigured));
        }
        Ok(())
    }
    pub fn catalog_url(&self) -> NativeResult<Url> {
        self.validate()?;
        Url::parse(&format!(
            "https://github.com/{}/releases/latest/download/catalog.json",
            self.repository
        ))
        .map_err(|_| failure(ErrorCode::MarketNotConfigured))
    }
    fn package_url(&self, entry: &MarketEntry) -> NativeResult<Url> {
        Url::parse(&format!(
            "https://github.com/{}/releases/download/{}/{}",
            self.repository, entry.release_tag, entry.asset
        ))
        .map_err(|_| failure(ErrorCode::MarketInvalid))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum MarketCategory {
    Text,
    Data,
    Tools,
    Games,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketEntry {
    pub package: ExtensionPreview,
    pub category: MarketCategory,
    pub featured: bool,
    pub release_tag: String,
    pub asset: String,
    pub package_sha256: String,
    pub package_bytes: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketCatalog {
    pub schema_version: u32,
    pub revision: u32,
    pub repository: String,
    pub entries: Vec<MarketEntry>,
}
#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshot {
    pub catalog: MarketCatalog,
    pub fetched_at: f64,
    pub stale: bool,
}
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MarketDownload {
    pub content: String,
    pub preview: ExtensionPreview,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignedCatalog {
    payload: String,
    signature: String,
}
#[derive(Clone)]
struct VerifiedCatalog {
    catalog: MarketCatalog,
    digest: String,
    fetched_at: f64,
    verified_at: Instant,
}
impl VerifiedCatalog {
    fn is_fresh(&self, now: Instant) -> bool {
        now.duration_since(self.verified_at) < CACHE_DURATION
    }
}

fn failure(code: ErrorCode) -> NativeError {
    let message = match code {
        ErrorCode::MarketNotConfigured => "Extension market is not configured",
        ErrorCode::MarketInvalid => "Extension market verification failed",
        ErrorCode::MarketChanged => "Extension market changed; refresh before downloading",
        _ => "Extension market is unavailable",
    };
    let mut error = NativeError::new(code, message);
    error.retryable = matches!(
        code,
        ErrorCode::MarketUnavailable | ErrorCode::MarketChanged
    );
    error
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn verify_catalog(bytes: &[u8], config: &MarketConfig) -> NativeResult<VerifiedCatalog> {
    config.validate()?;
    if bytes.len() > CATALOG_LIMIT {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let signed: SignedCatalog =
        serde_json::from_slice(bytes).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    if signed.signature.len() > 4096 || signed.payload.len() > CATALOG_LIMIT {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let payload = STANDARD
        .decode(&signed.payload)
        .map_err(|_| failure(ErrorCode::MarketInvalid))?;
    let key = PublicKey::from_base64(&config.public_key)
        .map_err(|_| failure(ErrorCode::MarketNotConfigured))?;
    let signature =
        Signature::decode(&signed.signature).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    key.verify(&payload, &signature, false)
        .map_err(|_| failure(ErrorCode::MarketInvalid))?;
    let catalog: MarketCatalog =
        serde_json::from_slice(&payload).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    validate_catalog(&catalog, config)?;
    Ok(VerifiedCatalog {
        catalog,
        digest: digest(&payload),
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.0,
        verified_at: Instant::now(),
    })
}
fn validate_catalog(catalog: &MarketCatalog, config: &MarketConfig) -> NativeResult<()> {
    if catalog.schema_version != 1
        || catalog.revision == 0
        || catalog.repository != config.repository
        || catalog.entries.len() > 100
    {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let mut ids = HashSet::new();
    for entry in &catalog.entries {
        entry
            .package
            .manifest
            .validate()
            .map_err(|_| failure(ErrorCode::MarketInvalid))?;
        if !ids.insert(&entry.package.manifest.id)
            || !valid_digest(&entry.package.sha256)
            || !valid_digest(&entry.package_sha256)
            || entry.package.bytes == 0
            || entry.package.bytes > 16 * 1024 * 1024
            || entry.package_bytes == 0
            || entry.package_bytes as usize > PACKAGE_LIMIT
            || entry.release_tag != format!("market-{}", catalog.revision)
            || entry.asset
                != format!(
                    "{}-{}.starter-extension.json",
                    entry.package.manifest.id, entry.package.manifest.version
                )
        {
            return Err(failure(ErrorCode::MarketInvalid));
        }
    }
    Ok(())
}
fn entry_for(catalog: MarketCatalog, id: &str, expected_hash: &str) -> NativeResult<MarketEntry> {
    catalog
        .entries
        .into_iter()
        .find(|entry| entry.package.manifest.id == id && entry.package_sha256 == expected_hash)
        .ok_or_else(|| failure(ErrorCode::MarketChanged))
}
fn verify_package(bytes: &[u8], entry: &MarketEntry) -> NativeResult<MarketDownload> {
    if bytes.len() != entry.package_bytes as usize
        || bytes.len() > PACKAGE_LIMIT
        || digest(bytes) != entry.package_sha256
    {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let content =
        String::from_utf8(bytes.to_vec()).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    let preview = preview_package(&content).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    if serde_json::to_value(&preview).ok() != serde_json::to_value(&entry.package).ok() {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    Ok(MarketDownload { content, preview })
}
fn accept_catalog(old: Option<&VerifiedCatalog>, next: &VerifiedCatalog) -> NativeResult<()> {
    if old.is_some_and(|old| {
        next.catalog.revision < old.catalog.revision
            || (next.catalog.revision == old.catalog.revision && next.digest != old.digest)
    }) {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    Ok(())
}
fn allowed_url(url: &Url, repository: &str) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.fragment().is_some()
    {
        return false;
    }
    match url.host_str() {
        Some("github.com") => url.path().starts_with(&format!("/{repository}/releases/")),
        Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => true,
        _ => false,
    }
}
async fn fetch(url: Url, repository: String, limit: usize) -> NativeResult<Vec<u8>> {
    if !allowed_url(&url, &repository) {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let client = Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .user_agent("Tauri-Starter-Extension-Market/1")
        .redirect(Policy::custom(move |attempt| {
            if attempt.previous().len() < 5 && allowed_url(attempt.url(), &repository) {
                attempt.follow()
            } else {
                attempt.error("Market redirect rejected")
            }
        }))
        .build()
        .map_err(|_| failure(ErrorCode::MarketUnavailable))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| failure(ErrorCode::MarketUnavailable))?;
    if !response.status().is_success() {
        return Err(failure(ErrorCode::MarketUnavailable));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| failure(ErrorCode::MarketUnavailable))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(failure(ErrorCode::MarketInvalid));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub struct ExtensionMarket {
    cached: Mutex<Option<VerifiedCatalog>>,
    refresh: AsyncMutex<()>,
    downloads: Semaphore,
}
impl Default for ExtensionMarket {
    fn default() -> Self {
        Self {
            cached: Mutex::new(None),
            refresh: AsyncMutex::new(()),
            downloads: Semaphore::new(2),
        }
    }
}
impl ExtensionMarket {
    fn cache(&self) -> NativeResult<Option<VerifiedCatalog>> {
        self.cached
            .lock()
            .map(|cache| cache.clone())
            .map_err(|_| failure(ErrorCode::MarketUnavailable))
    }
    async fn latest(&self, force: bool) -> NativeResult<VerifiedCatalog> {
        let _refresh = self.refresh.lock().await;
        let config = MarketConfig::configured()?;
        let old = self.cache()?;
        if !force
            && let Some(old) = old.as_ref()
            && old.is_fresh(Instant::now())
        {
            return Ok(old.clone());
        }
        let bytes = fetch(
            config.catalog_url()?,
            config.repository.clone(),
            CATALOG_LIMIT,
        )
        .await?;
        let next = blocking::run(move || verify_catalog(&bytes, &config)).await?;
        accept_catalog(old.as_ref(), &next)?;
        *self
            .cached
            .lock()
            .map_err(|_| failure(ErrorCode::MarketUnavailable))? = Some(next.clone());
        Ok(next)
    }
    pub async fn snapshot(&self, force: bool) -> NativeResult<MarketSnapshot> {
        match self.latest(force).await {
            Ok(value) => Ok(MarketSnapshot {
                catalog: value.catalog,
                fetched_at: value.fetched_at,
                stale: false,
            }),
            Err(error) => match self.cache()? {
                Some(value) => Ok(MarketSnapshot {
                    catalog: value.catalog,
                    fetched_at: value.fetched_at,
                    stale: true,
                }),
                None => Err(error),
            },
        }
    }
    pub async fn download(
        &self,
        id: &str,
        expected_package_sha256: &str,
    ) -> NativeResult<MarketDownload> {
        if id.is_empty() || id.len() > 80 || !valid_digest(expected_package_sha256) {
            return Err(failure(ErrorCode::MarketInvalid));
        }
        let _slot = self
            .downloads
            .try_acquire()
            .map_err(|_| failure(ErrorCode::ExtensionBusy))?;
        // 下载前重新确认当前上架状态，过期的界面不能绕过下架。
        let catalog = self.latest(true).await?;
        let entry = entry_for(catalog.catalog, id, expected_package_sha256)?;
        let config = MarketConfig::configured()?;
        let bytes = fetch(
            config.package_url(&entry)?,
            config.repository,
            entry.package_bytes as usize,
        )
        .await?;
        blocking::run(move || verify_package(&bytes, &entry)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SIGNED: &[u8] = include_bytes!("../test-fixtures/extension-market/catalog.json");
    const PACKAGE: &[u8] = include_bytes!("../test-fixtures/extension-market/package.json");
    fn config() -> MarketConfig {
        MarketConfig {
            repository: "YanChao001/tauri-desktop-starter-extensions".into(),
            public_key: include_str!("../test-fixtures/extension-market/public-key.txt")
                .trim()
                .into(),
        }
    }
    #[test]
    fn signed_catalog_and_package_validate_without_running_wasm() {
        let verified = verify_catalog(SIGNED, &config()).unwrap();
        assert_eq!(verified.catalog.entries.len(), 1);
        let entry = &verified.catalog.entries[0];
        assert_eq!(
            verify_package(PACKAGE, entry).unwrap().preview.manifest.id,
            "market.text-tools"
        );
        let mut tampered = PACKAGE.to_vec();
        tampered.push(b' ');
        assert_eq!(
            verify_package(&tampered, entry).unwrap_err().code,
            ErrorCode::MarketInvalid
        );
        let mut changed = entry.clone();
        changed.package.manifest.name = "Substituted metadata".into();
        assert!(verify_package(PACKAGE, &changed).is_err());
    }
    #[test]
    fn signatures_substituted_keys_and_oversized_catalogs_are_rejected() {
        let mut signed: serde_json::Value = serde_json::from_slice(SIGNED).unwrap();
        signed["payload"] = serde_json::json!(STANDARD.encode(b"{}"));
        assert!(verify_catalog(&serde_json::to_vec(&signed).unwrap(), &config()).is_err());
        let mut substituted_key = STANDARD.decode(config().public_key).unwrap();
        substituted_key[2] ^= 1;
        assert!(
            verify_catalog(
                SIGNED,
                &MarketConfig {
                    public_key: STANDARD.encode(substituted_key),
                    ..config()
                }
            )
            .is_err()
        );
        assert!(verify_catalog(&vec![b' '; CATALOG_LIMIT + 1], &config()).is_err());
    }
    #[test]
    fn cache_expiration_uses_elapsed_time_instead_of_wall_clock() {
        let mut cached = verify_catalog(SIGNED, &config()).unwrap();
        cached.fetched_at = 0.0;
        assert!(cached.is_fresh(cached.verified_at));
        cached.fetched_at = f64::MAX;
        assert!(!cached.is_fresh(cached.verified_at + CACHE_DURATION));
    }
    #[test]
    fn configuration_rejects_repository_dot_segments_and_invalid_owners() {
        for repository in ["owner/.", "owner/..", "under_score/repo", "owner.name/repo"] {
            let invalid = MarketConfig {
                repository: repository.into(),
                ..config()
            };
            assert_eq!(
                invalid.catalog_url().unwrap_err().code,
                ErrorCode::MarketNotConfigured
            );
        }
        let valid = MarketConfig {
            repository: "owner-name/repo.name_with-dashes".into(),
            ..config()
        };
        assert_eq!(
            valid.catalog_url().unwrap().path(),
            "/owner-name/repo.name_with-dashes/releases/latest/download/catalog.json"
        );
    }
    #[test]
    fn cache_rejects_rollback_and_same_revision_replacement() {
        let old = verify_catalog(SIGNED, &config()).unwrap();
        let mut next = old.clone();
        next.catalog.revision = 0;
        assert!(accept_catalog(Some(&old), &next).is_err());
        next.catalog.revision = old.catalog.revision;
        next.digest = "changed".into();
        assert!(accept_catalog(Some(&old), &next).is_err());
        next.catalog.revision += 1;
        assert!(accept_catalog(Some(&old), &next).is_ok());
    }
    #[test]
    fn malformed_catalogs_and_removed_versions_cannot_supply_downloads() {
        let config = config();
        let catalog = verify_catalog(SIGNED, &config).unwrap().catalog;
        let mut duplicate = catalog.clone();
        duplicate.entries.push(duplicate.entries[0].clone());
        assert!(validate_catalog(&duplicate, &config).is_err());
        let mut bad_asset = catalog.clone();
        bad_asset.entries[0].asset = "../outside".into();
        assert!(validate_catalog(&bad_asset, &config).is_err());
        let mut bad_release = catalog.clone();
        bad_release.entries[0].release_tag = "other-release".into();
        assert!(validate_catalog(&bad_release, &config).is_err());
        let mut oversized = catalog.clone();
        oversized.entries[0].package_bytes = PACKAGE_LIMIT as u32 + 1;
        assert!(validate_catalog(&oversized, &config).is_err());
        let entry = &catalog.entries[0];
        assert!(entry_for(catalog.clone(), &entry.package.manifest.id, &"f".repeat(64)).is_err());
        let mut removed = catalog.clone();
        removed.entries.clear();
        assert_eq!(
            entry_for(removed, &entry.package.manifest.id, &entry.package_sha256)
                .unwrap_err()
                .code,
            ErrorCode::MarketChanged
        );
    }
    #[test]
    fn urls_restrict_repository_https_credentials_and_redirect_hosts() {
        let repo = "owner/repo";
        for value in [
            "http://github.com/owner/repo/releases/latest/download/catalog.json",
            "https://github.com/other/repo/releases/download/tag/a",
            "https://github.com/owner/repo.git/releases/a",
            "https://evil.example/owner/repo/releases/a",
            "https://user@github.com/owner/repo/releases/a",
            "https://github.com:444/owner/repo/releases/a",
            "https://release-assets.githubusercontent.com.evil.example/a",
        ] {
            assert!(!allowed_url(&Url::parse(value).unwrap(), repo), "{value}");
        }
        for value in [
            "https://github.com/owner/repo/releases/latest/download/catalog.json",
            "https://release-assets.githubusercontent.com/assets/a?token=opaque",
        ] {
            assert!(allowed_url(&Url::parse(value).unwrap(), repo));
        }
    }
    #[test]
    #[ignore = "requires an explicitly published official market and network access"]
    fn live_official_catalog_download() {
        tauri::async_runtime::block_on(async {
            let market = ExtensionMarket::default();
            let snapshot = market.snapshot(true).await.unwrap();
            assert!(!snapshot.stale);
            let entry = snapshot.catalog.entries.first().unwrap();
            let download = market
                .download(&entry.package.manifest.id, &entry.package_sha256)
                .await
                .unwrap();
            assert_eq!(download.preview.sha256, entry.package.sha256);
            let directory = tempfile::tempdir().unwrap();
            let store =
                crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
            let installed = store
                .install(&download.content, 0, false, &download.preview.sha256)
                .unwrap();
            assert!(!installed.items[0].enabled);
            let enabled = store
                .set_enabled(
                    &entry.package.manifest.id,
                    true,
                    entry.package.manifest.permissions.clone(),
                    installed.revision,
                    true,
                )
                .unwrap();
            let run = store
                .prepare(&entry.package.manifest.id, &entry.package.sha256)
                .unwrap();
            let output = crate::extension_runtime::run(
                &run.module,
                &entry.package.manifest.commands[0].function,
                b"Hello market",
                run.stop.clone(),
            )
            .unwrap();
            assert_eq!(output, "HELLO MARKET");
            drop(run);
            store
                .uninstall(&entry.package.manifest.id, enabled.revision)
                .unwrap();
            assert!(store.snapshot().unwrap().items.is_empty());
        });
    }
}
