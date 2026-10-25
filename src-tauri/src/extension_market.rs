//! 维护者控制的签名目录与包下载；不执行插件，也不接受前端 URL。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extensions::{ExtensionPreview, PACKAGE_LIMIT, preview_package},
    storage::atomic_write,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_http::reqwest::{Client, redirect::Policy};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use url::Url;

const CATALOG_LIMIT: usize = 2 * 1024 * 1024;
const CACHE_DURATION: Duration = Duration::from_secs(300);
const SIGNATURE_LIFETIME: u64 = 30 * 24 * 60 * 60;
const FUTURE_TOLERANCE: u64 = 300;
const TRUST_LIMIT: usize = 64 * 1024;
const TRUST_SOURCES: usize = 64;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketConfig {
    pub repository: String,
    pub public_key: String,
}
fn valid_repository(repository: &str) -> bool {
    let parts: Vec<_> = repository.split('/').collect();
    repository.len() <= 200
        && parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && !matches!(*part, "." | "..")
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        })
        && parts[0]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
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
        if !valid_repository(&self.repository)
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
    fn identity(&self) -> NativeResult<MarketIdentity> {
        self.validate()?;
        let packet = STANDARD
            .decode(&self.public_key)
            .map_err(|_| failure(ErrorCode::MarketNotConfigured))?;
        Ok(MarketIdentity {
            repository: self.repository.to_ascii_lowercase(),
            public_key_fingerprint: digest(
                packet
                    .get(10..)
                    .filter(|key| key.len() == 32)
                    .ok_or_else(|| failure(ErrorCode::MarketNotConfigured))?,
            ),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketIdentity {
    repository: String,
    public_key_fingerprint: String,
}

/// 此收据仅说明来源；安装入口必须重新与已验签目录及完整包内容核对。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketSource {
    pub repository: String,
    pub public_key_fingerprint: String,
    pub catalog_revision: u32,
    pub package_sha256: String,
}
impl MarketSource {
    pub(crate) fn validate(&self) -> NativeResult<()> {
        if !valid_repository(&self.repository)
            || self.repository != self.repository.to_ascii_lowercase()
            || !valid_digest(&self.public_key_fingerprint)
            || self.catalog_revision == 0
            || !valid_digest(&self.package_sha256)
        {
            return Err(failure(ErrorCode::MarketInvalid));
        }
        Ok(())
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
    #[specta(type = f64)]
    pub issued_at: u64,
    #[specta(type = f64)]
    pub expires_at: u64,
    pub entries: Vec<MarketEntry>,
}
#[derive(Debug, Clone, Serialize, Type)]
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
    pub source: MarketSource,
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
    identity: MarketIdentity,
    digest: String,
    fetched_at: f64,
    verified_at: Instant,
    valid_for: Duration,
}
impl VerifiedCatalog {
    fn require_current(&self, now: Instant, wall_now: u64) -> NativeResult<()> {
        validate_catalog_time(&self.catalog, wall_now)?;
        if now.saturating_duration_since(self.verified_at) >= self.valid_for {
            return Err(failure(ErrorCode::MarketExpired));
        }
        Ok(())
    }
    fn is_valid(&self, now: Instant, wall_now: u64) -> bool {
        self.require_current(now, wall_now).is_ok()
    }
    fn is_fresh(&self, now: Instant, wall_now: u64) -> bool {
        self.is_valid(now, wall_now)
            && now.saturating_duration_since(self.verified_at) < CACHE_DURATION
    }
    fn source(&self, entry: &MarketEntry) -> MarketSource {
        MarketSource {
            repository: self.identity.repository.clone(),
            public_key_fingerprint: self.identity.public_key_fingerprint.clone(),
            catalog_revision: self.catalog.revision,
            package_sha256: entry.package_sha256.clone(),
        }
    }
}

fn failure(code: ErrorCode) -> NativeError {
    let message = match code {
        ErrorCode::MarketNotConfigured => "Extension market is not configured",
        ErrorCode::MarketIncompatible => {
            "Signed extension market catalog uses an unsupported version"
        }
        ErrorCode::MarketExpired => "Signed extension market catalog has expired",
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

fn now_seconds() -> NativeResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| failure(ErrorCode::MarketInvalid))
}
fn validate_catalog_time(catalog: &MarketCatalog, now: u64) -> NativeResult<()> {
    if catalog.issued_at == 0
        || catalog.issued_at > now.saturating_add(FUTURE_TOLERANCE)
        || catalog.expires_at <= catalog.issued_at
        || catalog.expires_at - catalog.issued_at > SIGNATURE_LIFETIME
    {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    if catalog.expires_at <= now {
        return Err(failure(ErrorCode::MarketExpired));
    }
    Ok(())
}
fn verify_catalog(bytes: &[u8], config: &MarketConfig) -> NativeResult<VerifiedCatalog> {
    verify_catalog_at(bytes, config, now_seconds()?)
}
fn verify_catalog_at(
    bytes: &[u8],
    config: &MarketConfig,
    now: u64,
) -> NativeResult<VerifiedCatalog> {
    let verified_at = Instant::now();
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
    // 只有验签后的版本字段可用于兼容性诊断；先识别版本，避免旧版或未来
    // DTO 缺失当前字段时被误报为完整性校验失败。
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CatalogVersion {
        schema_version: u32,
    }
    let version: CatalogVersion =
        serde_json::from_slice(&payload).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    if version.schema_version != 2 {
        return Err(failure(ErrorCode::MarketIncompatible));
    }
    let catalog: MarketCatalog =
        serde_json::from_slice(&payload).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    validate_catalog(&catalog, config)?;
    validate_catalog_time(&catalog, now)?;
    let valid_for = Duration::from_secs(catalog.expires_at - now);
    Ok(VerifiedCatalog {
        catalog,
        identity: config.identity()?,
        digest: digest(&payload),
        fetched_at: now as f64 * 1000.0,
        verified_at,
        valid_for,
    })
}
fn validate_catalog(catalog: &MarketCatalog, config: &MarketConfig) -> NativeResult<()> {
    if catalog.schema_version != 2 {
        return Err(failure(ErrorCode::MarketIncompatible));
    }
    if catalog.revision == 0
        || !catalog.repository.eq_ignore_ascii_case(&config.repository)
        || catalog.entries.len() > 100
    {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let mut ids = HashSet::new();
    for entry in &catalog.entries {
        entry
            .package
            .manifest
            .validate_structure()
            .map_err(|_| failure(ErrorCode::MarketInvalid))?;
        entry
            .package
            .validate_ui()
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
fn verify_package(
    bytes: &[u8],
    entry: &MarketEntry,
    source: MarketSource,
) -> NativeResult<MarketDownload> {
    if bytes.len() != entry.package_bytes as usize
        || bytes.len() > PACKAGE_LIMIT
        || digest(bytes) != entry.package_sha256
    {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let content =
        String::from_utf8(bytes.to_vec()).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    let preview = preview_package(&content).map_err(|error| {
        if error.code == ErrorCode::ExtensionIncompatible {
            error
        } else {
            failure(ErrorCode::MarketInvalid)
        }
    })?;
    if serde_json::to_value(&preview).ok() != serde_json::to_value(&entry.package).ok() {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    Ok(MarketDownload {
        content,
        preview,
        source,
    })
}
fn verify_install(
    catalog: &VerifiedCatalog,
    content: &str,
    expected_sha256: &str,
    source: &MarketSource,
) -> NativeResult<MarketSource> {
    source.validate()?;
    let entry = catalog
        .catalog
        .entries
        .iter()
        .find(|entry| {
            entry.package.sha256 == expected_sha256 && entry.package_sha256 == source.package_sha256
        })
        .ok_or_else(|| failure(ErrorCode::MarketChanged))?;
    let trusted_source = catalog.source(entry);
    if source != &trusted_source {
        return Err(failure(ErrorCode::MarketChanged));
    }
    verify_package(content.as_bytes(), entry, trusted_source.clone())?;
    Ok(trusted_source)
}
fn accept_catalog(old: Option<&VerifiedCatalog>, next: &VerifiedCatalog) -> NativeResult<()> {
    if old.is_some_and(|old| {
        next.identity == old.identity
            && (next.catalog.revision < old.catalog.revision
                || (next.catalog.revision == old.catalog.revision && next.digest != old.digest))
    }) {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustRecord {
    identity: MarketIdentity,
    revision: u32,
    digest: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustStore {
    schema_version: u32,
    sources: Vec<TrustRecord>,
}
impl Default for TrustStore {
    fn default() -> Self {
        Self {
            schema_version: 1,
            sources: Vec::new(),
        }
    }
}
fn real_metadata(metadata: &fs::Metadata) -> bool {
    if metadata.is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // 同时拒绝 junction 和其它 reparse point。
        metadata.file_attributes() & 0x400 == 0
    }
    #[cfg(not(windows))]
    {
        true
    }
}
fn checked_directory(path: &Path, create: bool) -> NativeResult<bool> {
    if !path.is_absolute() {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let mut cursor = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) => {
                cursor.push(component);
                continue;
            }
            Component::RootDir | Component::Normal(_) => cursor.push(component),
            _ => return Err(failure(ErrorCode::MarketInvalid)),
        }
        match fs::symlink_metadata(&cursor) {
            Ok(metadata) if metadata.is_dir() && real_metadata(&metadata) => {}
            Ok(_) => return Err(failure(ErrorCode::MarketInvalid)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                fs::create_dir(&cursor).map_err(|_| failure(ErrorCode::MarketUnavailable))?;
                let metadata = fs::symlink_metadata(&cursor)
                    .map_err(|_| failure(ErrorCode::MarketUnavailable))?;
                if !metadata.is_dir() || !real_metadata(&metadata) {
                    return Err(failure(ErrorCode::MarketInvalid));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(failure(ErrorCode::MarketUnavailable)),
        }
    }
    Ok(true)
}
fn trust_file(path: &Path) -> NativeResult<Option<fs::File>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && real_metadata(&metadata) => {}
        Ok(_) => return Err(failure(ErrorCode::MarketInvalid)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(failure(ErrorCode::MarketUnavailable)),
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "macos")]
        options.custom_flags(0x0100); // O_NOFOLLOW
        #[cfg(not(target_os = "macos"))]
        options.custom_flags(0x0002_0000); // O_NOFOLLOW (Linux/Android)
    }
    let file = options
        .open(path)
        .map_err(|_| failure(ErrorCode::MarketUnavailable))?;
    let metadata = file
        .metadata()
        .map_err(|_| failure(ErrorCode::MarketUnavailable))?;
    if !metadata.is_file() || !real_metadata(&metadata) || metadata.len() > TRUST_LIMIT as u64 {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    Ok(Some(file))
}
fn read_trust(root: &Path) -> NativeResult<TrustStore> {
    if !checked_directory(root, false)? {
        return Ok(TrustStore::default());
    }
    let Some(file) = trust_file(&root.join("trust.json"))? else {
        return Ok(TrustStore::default());
    };
    let mut bytes = Vec::new();
    file.take(TRUST_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| failure(ErrorCode::MarketUnavailable))?;
    if bytes.len() > TRUST_LIMIT {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    let store: TrustStore =
        serde_json::from_slice(&bytes).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    let mut identities = HashSet::new();
    if store.schema_version != 1 || store.sources.len() > TRUST_SOURCES {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    for record in &store.sources {
        let repository = &record.identity.repository;
        if !valid_repository(repository)
            || repository.to_ascii_lowercase() != *repository
            || !valid_digest(&record.identity.public_key_fingerprint)
            || !valid_digest(&record.digest)
            || record.revision == 0
            || !identities.insert((repository, &record.identity.public_key_fingerprint))
        {
            return Err(failure(ErrorCode::MarketInvalid));
        }
    }
    Ok(store)
}
fn validate_persisted_trust(store: &TrustStore, next: &VerifiedCatalog) -> NativeResult<()> {
    if store.sources.iter().any(|record| {
        record.identity == next.identity
            && (next.catalog.revision < record.revision
                || (next.catalog.revision == record.revision && next.digest != record.digest))
    }) {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    Ok(())
}
fn persist_catalog_trust(root: &Path, next: &VerifiedCatalog) -> NativeResult<()> {
    // 未来版本、损坏或链接文件必须原样保留，不能因一次刷新覆盖信任历史。
    let mut store = read_trust(root)?;
    validate_persisted_trust(&store, next)?;
    if let Some(record) = store
        .sources
        .iter_mut()
        .find(|record| record.identity == next.identity)
    {
        if next.catalog.revision == record.revision {
            return Ok(());
        }
        record.revision = next.catalog.revision;
        record.digest = next.digest.clone();
    } else {
        if store.sources.len() >= TRUST_SOURCES {
            return Err(failure(ErrorCode::MarketInvalid));
        }
        store.sources.push(TrustRecord {
            identity: next.identity.clone(),
            revision: next.catalog.revision,
            digest: next.digest.clone(),
        });
    }
    let bytes = serde_json::to_vec(&store).map_err(|_| failure(ErrorCode::MarketInvalid))?;
    if bytes.len() > TRUST_LIMIT {
        return Err(failure(ErrorCode::MarketInvalid));
    }
    checked_directory(root, true)?;
    // atomic_write 在同目录创建临时文件并替换最终目录项，绝不写入链接指向的文件。
    trust_file(&root.join("trust.json"))?;
    atomic_write(&root.join("trust.json"), &bytes)
        .map_err(|_| failure(ErrorCode::MarketUnavailable))
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
    root: PathBuf,
    isolated: bool,
    cached: Mutex<Option<VerifiedCatalog>>,
    refresh: AsyncMutex<()>,
    downloads: Semaphore,
}
impl ExtensionMarket {
    pub fn new(root: PathBuf, isolated: bool) -> Self {
        Self {
            root,
            isolated,
            cached: Mutex::new(None),
            refresh: AsyncMutex::new(()),
            downloads: Semaphore::new(2),
        }
    }
    fn cache(&self) -> NativeResult<Option<VerifiedCatalog>> {
        self.cached
            .lock()
            .map(|cache| cache.clone())
            .map_err(|_| failure(ErrorCode::MarketUnavailable))
    }
    async fn latest(&self, force: bool) -> NativeResult<VerifiedCatalog> {
        let _refresh = self.refresh.lock().await;
        if self.isolated {
            return Err(failure(ErrorCode::ExtensionUnavailable));
        }
        let config = MarketConfig::configured()?;
        let identity = config.identity()?;
        let old = self.cache()?.filter(|old| old.identity == identity);
        let root = self.root.clone();
        let cached = old.clone();
        blocking::run(move || {
            let trust = read_trust(&root)?;
            if let Some(cached) = cached {
                validate_persisted_trust(&trust, &cached)?;
            }
            Ok(())
        })
        .await?;
        if !force
            && let Some(old) = old.as_ref()
            && old.is_fresh(Instant::now(), now_seconds()?)
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
        let root = self.root.clone();
        let trusted = next.clone();
        blocking::run(move || persist_catalog_trust(&root, &trusted)).await?;
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
            Err(error) if error.code == ErrorCode::MarketUnavailable => {
                match self.cache()?.filter(|value| {
                    MarketConfig::configured()
                        .and_then(|config| config.identity())
                        .is_ok_and(|identity| identity == value.identity)
                        && now_seconds().is_ok_and(|now| value.is_valid(Instant::now(), now))
                }) {
                    Some(value) => Ok(MarketSnapshot {
                        catalog: value.catalog,
                        fetched_at: value.fetched_at,
                        stale: true,
                    }),
                    None => Err(error),
                }
            }
            Err(error) => Err(error),
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
        let entry = entry_for(catalog.catalog.clone(), id, expected_package_sha256)?;
        let source = catalog.source(&entry);
        let config = MarketConfig::configured()?;
        let bytes = fetch(
            config.package_url(&entry)?,
            config.repository,
            entry.package_bytes as usize,
        )
        .await?;
        catalog.require_current(Instant::now(), now_seconds()?)?;
        let download = blocking::run(move || verify_package(&bytes, &entry, source)).await?;
        catalog.require_current(Instant::now(), now_seconds()?)?;
        Ok(download)
    }
    pub async fn verify_install_source(
        &self,
        content: &str,
        expected_sha256: &str,
        source: &MarketSource,
    ) -> NativeResult<MarketSource> {
        if content.len() > PACKAGE_LIMIT || !valid_digest(expected_sha256) {
            return Err(failure(ErrorCode::MarketInvalid));
        }
        source.validate()?;
        let catalog = self.latest(false).await?;
        let content = content.to_string();
        let expected_sha256 = expected_sha256.to_string();
        let source = source.clone();
        let current = catalog.clone();
        let source =
            blocking::run(move || verify_install(&current, &content, &expected_sha256, &source))
                .await?;
        catalog.require_current(Instant::now(), now_seconds()?)?;
        Ok(source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SIGNED: &[u8] = include_bytes!("../test-fixtures/extension-market/catalog.json");
    const SIGNED_SCHEMA_1: &[u8] =
        include_bytes!("../test-fixtures/extension-market/catalog-schema-1.json");
    const SIGNED_SCHEMA_99: &[u8] =
        include_bytes!("../test-fixtures/extension-market/catalog-schema-99.json");
    const PACKAGE: &[u8] = include_bytes!("../test-fixtures/extension-market/package.json");
    const TEST_NOW: u64 = 1_800_000_000;
    fn verified() -> VerifiedCatalog {
        verify_catalog_at(SIGNED, &config(), TEST_NOW).unwrap()
    }
    fn tempdir() -> tempfile::TempDir {
        tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
    }
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
        let verified = verified();
        assert_eq!(verified.catalog.entries.len(), 1);
        let entry = &verified.catalog.entries[0];
        assert_eq!(
            verify_package(PACKAGE, entry, verified.source(entry))
                .unwrap()
                .preview
                .manifest
                .id,
            "market.text-tools"
        );
        let mut tampered = PACKAGE.to_vec();
        tampered.push(b' ');
        assert_eq!(
            verify_package(&tampered, entry, verified.source(entry))
                .unwrap_err()
                .code,
            ErrorCode::MarketInvalid
        );
        let mut changed = entry.clone();
        changed.package.manifest.name = "Substituted metadata".into();
        assert!(verify_package(PACKAGE, &changed, verified.source(&changed)).is_err());
    }
    #[test]
    fn market_install_verifies_receipt_identity_revision_and_full_package() {
        let catalog = verified();
        let entry = &catalog.catalog.entries[0];
        let source = catalog.source(entry);
        let content = std::str::from_utf8(PACKAGE).unwrap();
        assert_eq!(
            verify_install(&catalog, content, &entry.package.sha256, &source).unwrap(),
            source
        );
        let mut forged = source.clone();
        forged.repository = "other/repository".into();
        assert!(verify_install(&catalog, content, &entry.package.sha256, &forged).is_err());
        forged = source.clone();
        forged.public_key_fingerprint = "a".repeat(64);
        assert!(verify_install(&catalog, content, &entry.package.sha256, &forged).is_err());
        forged = source.clone();
        forged.catalog_revision += 1;
        assert!(verify_install(&catalog, content, &entry.package.sha256, &forged).is_err());
        assert!(
            verify_install(
                &catalog,
                &format!("{content} "),
                &entry.package.sha256,
                &source
            )
            .is_err()
        );
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
    fn only_verified_catalog_versions_report_incompatibility() {
        for signed in [SIGNED_SCHEMA_1, SIGNED_SCHEMA_99] {
            let error = verify_catalog_at(signed, &config(), TEST_NOW)
                .err()
                .unwrap();
            assert_eq!(error.code, ErrorCode::MarketIncompatible);
            assert!(!error.retryable);
        }
        // 未来或历史版本必须先通过同一固定公钥验签，不能依据篡改的
        // schemaVersion 把坏签名伪装成可通过升级 / 重发解决的兼容问题。
        let mut signed: serde_json::Value = serde_json::from_slice(SIGNED).unwrap();
        let mut payload: serde_json::Value = serde_json::from_slice(
            &STANDARD
                .decode(signed["payload"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        payload["schemaVersion"] = 99.into();
        signed["payload"] = STANDARD
            .encode(serde_json::to_vec(&payload).unwrap())
            .into();
        let error = verify_catalog_at(&serde_json::to_vec(&signed).unwrap(), &config(), TEST_NOW)
            .err()
            .unwrap();
        assert_eq!(error.code, ErrorCode::MarketInvalid);
        assert!(!error.retryable);

        let mut signed: serde_json::Value = serde_json::from_slice(SIGNED_SCHEMA_99).unwrap();
        signed["signature"] = "invalid signature".into();
        let error = verify_catalog_at(&serde_json::to_vec(&signed).unwrap(), &config(), TEST_NOW)
            .err()
            .unwrap();
        assert_eq!(error.code, ErrorCode::MarketInvalid);
        assert!(!error.retryable);
    }
    #[test]
    fn expired_verified_catalogs_report_expiry_without_relaxing_other_time_checks() {
        assert!(verify_catalog_at(SIGNED, &config(), TEST_NOW).is_ok());
        for now in [TEST_NOW + 3600, TEST_NOW + 3601] {
            let error = verify_catalog_at(SIGNED, &config(), now).err().unwrap();
            assert_eq!(error.code, ErrorCode::MarketExpired);
            assert!(!error.retryable);
        }
        let error = verify_catalog_at(SIGNED, &config(), TEST_NOW - FUTURE_TOLERANCE - 1)
            .err()
            .unwrap();
        assert_eq!(error.code, ErrorCode::MarketInvalid);
        assert!(!error.retryable);
        let mut catalog = verified().catalog;
        catalog.expires_at = catalog.issued_at;
        assert_eq!(
            validate_catalog_time(&catalog, TEST_NOW + 3600)
                .unwrap_err()
                .code,
            ErrorCode::MarketInvalid
        );
        catalog.expires_at = catalog.issued_at + SIGNATURE_LIFETIME + 1;
        assert_eq!(
            validate_catalog_time(&catalog, catalog.expires_at + 1)
                .unwrap_err()
                .code,
            ErrorCode::MarketInvalid
        );
    }
    #[test]
    fn market_error_retryability_is_explicit() {
        for (code, retryable) in [
            (ErrorCode::MarketNotConfigured, false),
            (ErrorCode::MarketUnavailable, true),
            (ErrorCode::MarketIncompatible, false),
            (ErrorCode::MarketExpired, false),
            (ErrorCode::MarketInvalid, false),
            (ErrorCode::MarketChanged, true),
        ] {
            assert_eq!(failure(code).retryable, retryable, "{code:?}");
        }
    }
    #[test]
    fn cache_expiration_uses_elapsed_time_instead_of_wall_clock() {
        let mut cached = verified();
        cached.fetched_at = 0.0;
        assert!(cached.is_fresh(cached.verified_at, TEST_NOW));
        cached.fetched_at = f64::MAX;
        assert!(!cached.is_fresh(cached.verified_at + CACHE_DURATION, TEST_NOW));
        assert!(!cached.is_valid(cached.verified_at, cached.catalog.expires_at));
        assert_eq!(
            cached
                .require_current(cached.verified_at, cached.catalog.expires_at)
                .unwrap_err()
                .code,
            ErrorCode::MarketExpired
        );
        // 时钟回拨也不能延长本次已验证签名的剩余寿命。
        assert!(!cached.is_valid(cached.verified_at + cached.valid_for, TEST_NOW));
        assert_eq!(
            cached
                .require_current(cached.verified_at + cached.valid_for, TEST_NOW)
                .unwrap_err()
                .code,
            ErrorCode::MarketExpired
        );
    }
    #[test]
    fn signed_catalogs_require_bounded_current_validity() {
        assert!(verify_catalog_at(SIGNED, &config(), TEST_NOW - FUTURE_TOLERANCE).is_ok());
        assert!(verify_catalog_at(SIGNED, &config(), TEST_NOW - FUTURE_TOLERANCE - 1).is_err());
        assert!(verify_catalog_at(SIGNED, &config(), TEST_NOW + 3600).is_err());
        let mut catalog = verified().catalog;
        catalog.expires_at = catalog.issued_at;
        assert!(validate_catalog_time(&catalog, TEST_NOW).is_err());
        catalog.expires_at = catalog.issued_at + SIGNATURE_LIFETIME + 1;
        assert!(validate_catalog_time(&catalog, TEST_NOW).is_err());
    }
    #[test]
    fn trust_watermark_survives_restart_and_is_scoped_to_repository_and_key() {
        let directory = tempdir();
        let root = directory.path().join("market");
        let mut old = verified();
        old.catalog.revision = 8;
        persist_catalog_trust(&root, &old).unwrap();
        assert_eq!(read_trust(&root).unwrap().sources[0].revision, 8);
        let rollback = verified();
        assert!(persist_catalog_trust(&root, &rollback).is_err());
        let mut replacement = old.clone();
        replacement.digest = "f".repeat(64);
        assert!(persist_catalog_trust(&root, &replacement).is_err());
        let mut changed_key = rollback.clone();
        changed_key.identity.public_key_fingerprint = "e".repeat(64);
        persist_catalog_trust(&root, &changed_key).unwrap();
        let mut changed_source = rollback.clone();
        changed_source.identity.repository = "other/repository".into();
        persist_catalog_trust(&root, &changed_source).unwrap();
        assert_eq!(read_trust(&root).unwrap().sources.len(), 3);
        assert!(persist_catalog_trust(&root, &rollback).is_err());
    }
    #[test]
    fn invalid_or_future_trust_store_is_never_replaced() {
        let directory = tempdir();
        let path = directory.path().join("trust.json");
        for content in [
            "{\"schemaVersion\":99,\"sources\":[]}",
            "not-json",
            "{\"schemaVersion\":1,\"sources\":[],\"unexpected\":true}",
        ] {
            fs::write(&path, content).unwrap();
            assert!(persist_catalog_trust(directory.path(), &verified()).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
        fs::write(&path, vec![b' '; TRUST_LIMIT + 1]).unwrap();
        assert!(persist_catalog_trust(directory.path(), &verified()).is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), TRUST_LIMIT as u64 + 1);
    }
    #[test]
    fn trust_sources_are_bounded_without_eviction_of_rollback_history() {
        let directory = tempdir();
        let mut catalog = verified();
        for index in 0..TRUST_SOURCES {
            catalog.identity.repository = format!("source-{index}/repository");
            persist_catalog_trust(directory.path(), &catalog).unwrap();
        }
        let before = fs::read(directory.path().join("trust.json")).unwrap();
        catalog.identity.repository = "new-source/repository".into();
        assert!(persist_catalog_trust(directory.path(), &catalog).is_err());
        assert_eq!(
            fs::read(directory.path().join("trust.json")).unwrap(),
            before
        );
        assert_eq!(
            read_trust(directory.path()).unwrap().sources.len(),
            TRUST_SOURCES
        );
    }
    #[test]
    fn newer_host_requirement_does_not_hide_other_market_entries() {
        let mut catalog = verified().catalog;
        catalog.entries[0].package.manifest.min_host_version = "65535.0.0".into();
        validate_catalog(&catalog, &config()).unwrap();
        let mut package: serde_json::Value = serde_json::from_slice(PACKAGE).unwrap();
        package["manifest"]["minHostVersion"] = serde_json::json!("65535.0.0");
        let bytes = serde_json::to_vec(&package).unwrap();
        let entry = &mut catalog.entries[0];
        entry.package_bytes = bytes.len() as u32;
        entry.package_sha256 = digest(&bytes);
        assert_eq!(
            verify_package(&bytes, entry, verified().source(entry))
                .unwrap_err()
                .code,
            ErrorCode::ExtensionIncompatible
        );
    }
    #[cfg(unix)]
    #[test]
    fn trust_store_rejects_linked_files_and_ancestor_directories() {
        use std::os::unix::fs::symlink;
        let directory = tempdir();
        let real = directory.path().join("real");
        fs::create_dir(&real).unwrap();
        let linked = directory.path().join("linked");
        symlink(&real, &linked).unwrap();
        assert!(persist_catalog_trust(&linked.join("market"), &verified()).is_err());
        let protected = directory.path().join("protected");
        fs::write(&protected, "keep").unwrap();
        symlink(&protected, real.join("trust.json")).unwrap();
        assert!(persist_catalog_trust(&real, &verified()).is_err());
        assert_eq!(fs::read_to_string(protected).unwrap(), "keep");
    }
    #[test]
    fn recovery_isolation_disables_market_and_preserves_trust() {
        let directory = tempdir();
        let market = ExtensionMarket::new(directory.path().join("market"), true);
        let error = tauri::async_runtime::block_on(market.snapshot(false)).unwrap_err();
        assert_eq!(error.code, ErrorCode::ExtensionUnavailable);
        assert!(!market.root.exists());
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
        let old = verified();
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
        let catalog = verify_catalog_at(SIGNED, &config, TEST_NOW)
            .unwrap()
            .catalog;
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
            let directory = tempdir();
            let market = ExtensionMarket::new(directory.path().join("market"), false);
            let snapshot = market.snapshot(true).await.unwrap();
            assert!(!snapshot.stale);
            let entry = snapshot.catalog.entries.first().unwrap();
            let download = market
                .download(&entry.package.manifest.id, &entry.package_sha256)
                .await
                .unwrap();
            assert_eq!(download.preview.sha256, entry.package.sha256);
            assert_eq!(download.source.package_sha256, entry.package_sha256);
        });
    }
}
