//! Extism Wasm 扩展包、条件写入和运行租约。
use crate::{
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extension_view::ExtensionIcon,
    storage::atomic_write,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
};

pub const EXTENSIONS_EVENT: &str = "app://extensions-changed";
pub const TEXT_LIMIT: usize = 1024 * 1024;
const BINARY_LIMIT: usize = 16 * 1024 * 1024;
pub(crate) const PACKAGE_LIMIT: usize = 24 * 1024 * 1024;
const REGISTRY_LIMIT: usize = 1024 * 1024;
const CACHE_LIMIT: u64 = 128 * 1024 * 1024;
const MAX_EXTENSIONS: usize = 64;
const MAX_ACTIVE_RUNS: usize = 2;
const MAX_QUEUED_RUNS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionInputFormat {
    Text,
    Json,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionResultFormat {
    Text,
    Json,
    Markdown,
    View,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub enum ExtensionPermission {
    #[serde(rename = "text:read")]
    TextRead,
    #[serde(rename = "files:read")]
    FilesRead,
    #[serde(rename = "network:https")]
    NetworkHttps,
    #[serde(rename = "network:local")]
    NetworkLocal,
    #[serde(rename = "storage")]
    Storage,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionCommand {
    pub id: String,
    pub title: String,
    pub function: String,
    pub input_format: ExtensionInputFormat,
    pub result_format: ExtensionResultFormat,
    #[serde(default)]
    pub ui: Option<ExtensionUi>,
    pub permissions: Vec<ExtensionPermission>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionNetworkRule {
    pub origin: String,
    pub methods: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionUi {
    pub sidebar: bool,
    pub window: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub format_version: u32,
    pub api_version: u32,
    pub min_host_version: String,
    pub id: String,
    pub version: String,
    pub name: String,
    pub author: String,
    pub description: String,
    #[serde(default)]
    pub icon: Option<ExtensionIcon>,
    pub commands: Vec<ExtensionCommand>,
    pub permissions: Vec<ExtensionPermission>,
    pub optional_permissions: Vec<ExtensionPermission>,
    pub network: Vec<ExtensionNetworkRule>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPreview {
    pub manifest: ExtensionManifest,
    pub sha256: String,
    pub bytes: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionInfo {
    pub package: ExtensionPreview,
    pub enabled: bool,
    pub granted_permissions: Vec<ExtensionPermission>,
    pub origin: ExtensionOrigin,
    #[serde(default)]
    pub previous_package: Option<ExtensionPreview>,
    #[serde(default)]
    pub previous_origin: Option<ExtensionOrigin>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ExtensionOrigin {
    Local,
    Bundled,
    Market {
        source: crate::extension_market::MarketSource,
    },
}
impl ExtensionOrigin {
    fn validate(&self) -> NativeResult<()> {
        if let Self::Market { source } = self {
            source.validate()?;
        }
        Ok(())
    }
    pub(crate) fn same_trusted_source(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Bundled, Self::Bundled) => true,
            (Self::Market { source: old }, Self::Market { source: new }) => {
                old.repository == new.repository
                    && old.public_key_fingerprint == new.public_key_fingerprint
            }
            _ => false,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionRunPhase {
    Queued,
    Running,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRunStatus {
    pub id: String,
    pub owner: String,
    pub phase: ExtensionRunPhase,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSnapshot {
    pub revision: i32,
    pub items: Vec<ExtensionInfo>,
    pub runs: Vec<ExtensionRunStatus>,
}
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionRunInput {
    pub id: String,
    pub command_id: String,
    pub expected_sha256: String,
    pub input_text: String,
    pub file_ids: Vec<String>,
    pub url: Option<String>,
}
#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionFileEncoding {
    Utf8,
    Base64,
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFileChoice {
    pub id: String,
    pub name: String,
    pub bytes: f64,
    pub media_type: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFile {
    pub name: String,
    pub encoding: ExtensionFileEncoding,
    pub media_type: String,
    pub content: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionNetworkResponse {
    pub url: String,
    pub status: u16,
    pub body: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRequest {
    pub api_version: u32,
    pub input_text: String,
    pub files: Vec<ExtensionFile>,
    pub network: Vec<ExtensionNetworkResponse>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Package {
    manifest: ExtensionManifest,
    wasm: String,
}
struct Bundle {
    preview: ExtensionPreview,
    binary: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registry {
    schema_version: u32,
    revision: i32,
    extensions: Vec<ExtensionInfo>,
    #[serde(default)]
    bundled_initialized: bool,
}
impl Default for Registry {
    fn default() -> Self {
        Self {
            schema_version: 3,
            revision: 0,
            extensions: vec![],
            bundled_initialized: false,
        }
    }
}
struct ActiveRun {
    id: String,
    owner: String,
    digest: String,
    stop: Arc<AtomicBool>,
    phase: ExtensionRunPhase,
}
#[derive(Default)]
struct WindowSession {
    generation: u64,
    closing: bool,
}
pub struct WindowRunToken {
    owner: String,
    generation: u64,
}
struct StoreInner {
    root: PathBuf,
    isolated: bool,
    shutting_down: AtomicBool,
    pauses: AtomicU32,
    writing: Mutex<()>,
    runs: Mutex<VecDeque<ActiveRun>>,
    run_changed: Condvar,
    windows: Mutex<HashMap<String, WindowSession>>,
}
#[derive(Clone)]
pub struct ExtensionStore(Arc<StoreInner>);
pub struct ExtensionPause(ExtensionStore);
impl ExtensionPause {
    pub fn wait_stopped(&self) {
        self.0.wait_stopped();
    }
}
impl Drop for ExtensionPause {
    fn drop(&mut self) {
        self.0.0.pauses.fetch_sub(1, Ordering::SeqCst);
    }
}
pub struct PreparedRun {
    pub package: ExtensionPreview,
    pub module: Vec<u8>,
    pub stop: Arc<AtomicBool>,
    pub grants: Vec<ExtensionPermission>,
    _lease: RunLease,
}
struct RunLease {
    store: ExtensionStore,
    stop: Arc<AtomicBool>,
}
impl Drop for RunLease {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.store.0.runs.lock() {
            runs.retain(|run| !Arc::ptr_eq(&run.stop, &self.stop));
            promote_runs(&mut runs);
            self.store.0.run_changed.notify_all();
        }
        if let Ok(_guard) = self.store.0.writing.lock()
            && let Ok(registry) = self.store.read()
        {
            self.store.cleanup(&registry);
        }
    }
}
fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn io(message: &str, error: impl std::fmt::Display) -> NativeError {
    NativeError::operation(ErrorCode::StorageIo, message, error)
}
fn conflict() -> NativeError {
    NativeError::new(
        ErrorCode::Conflict,
        "Extensions changed; reload before retrying",
    )
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
pub(crate) fn valid_id(id: &str) -> bool {
    id.len() <= 80
        && id.split('.').count() >= 2
        && id.split('.').all(|part| {
            part.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && !part.ends_with('-')
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}
fn version(value: &str) -> NativeResult<(u16, u16, u16)> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || part.len() > 5
                || (part.len() > 1 && part.starts_with('0'))
                || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(invalid("Use a numeric major.minor.patch extension version"));
    }
    let parse = |part: &str| {
        part.parse::<u16>()
            .map_err(|_| invalid("Extension version is out of range"))
    };
    Ok((parse(parts[0])?, parse(parts[1])?, parse(parts[2])?))
}
impl ExtensionManifest {
    pub fn has_permission(&self, permission: ExtensionPermission) -> bool {
        self.permissions.contains(&permission) || self.optional_permissions.contains(&permission)
    }
    pub fn validate(&self) -> NativeResult<()> {
        self.validate_structure()?;
        if version(&self.min_host_version)? > version(env!("CARGO_PKG_VERSION"))? {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "This extension requires a newer host version",
            ));
        }
        Ok(())
    }
    pub fn validate_structure(&self) -> NativeResult<()> {
        if self.format_version != 3 || self.api_version != 2 {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "Unsupported extension format or API",
            ));
        }
        version(&self.min_host_version)?;
        if !valid_id(&self.id) {
            return Err(invalid("Use a reverse-domain extension ID"));
        }
        version(&self.version)?;
        for (value, limit, field) in [
            (&self.name, 120, "Name"),
            (&self.author, 120, "Author"),
            (&self.description, 1000, "Description"),
        ] {
            bounded_text(value, limit, field)?;
            if value.trim().is_empty() {
                return Err(invalid("Extension metadata must not be empty"));
            }
        }
        let declared: HashSet<_> = self
            .permissions
            .iter()
            .chain(&self.optional_permissions)
            .collect();
        if declared.len() != self.permissions.len() + self.optional_permissions.len() {
            return Err(invalid(
                "Required and optional permissions must be unique and disjoint",
            ));
        }
        if self.commands.is_empty() || self.commands.len() > 32 {
            return Err(invalid("Declare one to thirty-two commands"));
        }
        let mut ids = HashSet::new();
        for command in &self.commands {
            if command.id.is_empty()
                || command.id.len() > 80
                || !command
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                || !ids.insert(&command.id)
            {
                return Err(invalid("Command IDs must be unique lowercase identifiers"));
            }
            bounded_text(&command.title, 120, "Command title")?;
            if command.title.trim().is_empty()
                || command.function.is_empty()
                || command.function.len() > 128
                || !command
                    .function
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
            {
                return Err(invalid("Invalid command title or Wasm export name"));
            }
            if command.permissions.iter().collect::<HashSet<_>>().len() != command.permissions.len()
                || command
                    .permissions
                    .iter()
                    .any(|permission| !declared.contains(permission))
            {
                return Err(invalid(
                    "Command permissions must be unique declared capabilities",
                ));
            }
            if command.result_format == ExtensionResultFormat::View
                && command.input_format != ExtensionInputFormat::Json
            {
                return Err(invalid("Views require JSON input"));
            }
            if command.ui.is_some() && command.result_format != ExtensionResultFormat::View {
                return Err(invalid("UI contributions require a view result"));
            }
            if command.input_format == ExtensionInputFormat::Text
                && command.permissions.iter().any(|permission| {
                    matches!(
                        permission,
                        ExtensionPermission::FilesRead
                            | ExtensionPermission::NetworkHttps
                            | ExtensionPermission::NetworkLocal
                    )
                })
            {
                return Err(invalid("File and network broker data require JSON input"));
            }
        }
        if self.network.len() > 32 {
            return Err(invalid("Declare at most thirty-two network origins"));
        }
        let mut origins = HashSet::new();
        let mut public_network = false;
        let mut local_network = false;
        for rule in &self.network {
            let local = rule.validate()?;
            if !origins.insert(&rule.origin) {
                return Err(invalid("Duplicate network origin"));
            }
            if local {
                local_network = true;
            } else {
                public_network = true;
            }
        }
        if public_network != self.has_permission(ExtensionPermission::NetworkHttps)
            || local_network != self.has_permission(ExtensionPermission::NetworkLocal)
        {
            return Err(invalid(
                "Network permissions and corresponding origins must be declared together",
            ));
        }
        Ok(())
    }
}
impl ExtensionNetworkRule {
    /// Returns whether the exact origin is a separately authorized loopback service.
    pub(crate) fn validate(&self) -> NativeResult<bool> {
        bounded_text(&self.origin, 2048, "Network origin")?;
        let url = url::Url::parse(&self.origin).map_err(|_| invalid("Invalid network origin"))?;
        if url.origin().ascii_serialization() != self.origin
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err(invalid(
                "Declare an exact canonical origin without credentials or a path",
            ));
        }
        let host = url
            .host()
            .ok_or_else(|| invalid("Network origin requires a host"))?;
        let loopback = match host {
            url::Host::Domain(domain) => domain == "localhost",
            url::Host::Ipv4(address) => address.is_loopback(),
            url::Host::Ipv6(address) => address.is_loopback(),
        };
        let local = url.scheme() == "http" && loopback;
        let public = url.scheme() == "https"
            && match host {
                url::Host::Domain(domain) => {
                    domain != "localhost"
                        && !domain.ends_with(".localhost")
                        && !domain.ends_with(".local")
                        && !domain.ends_with('.')
                        && domain.contains('.')
                        && domain.len() <= 253
                        && domain.split('.').all(|label| {
                            !label.is_empty()
                                && label.len() <= 63
                                && !label.starts_with('-')
                                && !label.ends_with('-')
                                && label.bytes().all(|byte| {
                                    byte.is_ascii_lowercase()
                                        || byte.is_ascii_digit()
                                        || byte == b'-'
                                })
                        })
                }
                url::Host::Ipv4(address) => crate::extension_network::is_public_ip(address.into()),
                url::Host::Ipv6(address) => crate::extension_network::is_public_ip(address.into()),
            };
        if !local && !public {
            return Err(invalid(
                "Network origins require public HTTPS or explicitly permitted loopback HTTP",
            ));
        }
        if self.methods.is_empty()
            || self.methods.len() > 7
            || self.methods.iter().collect::<HashSet<_>>().len() != self.methods.len()
            || self.methods.iter().any(|method| {
                !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
                    .contains(&method.as_str())
            })
        {
            return Err(invalid("Declare unique supported uppercase HTTP methods"));
        }
        Ok(local)
    }
}
fn promote_runs(runs: &mut VecDeque<ActiveRun>) {
    runs.retain(|run| run.phase == ExtensionRunPhase::Running || !run.stop.load(Ordering::Relaxed));
    let mut owners: HashSet<_> = runs
        .iter()
        .filter(|run| run.phase == ExtensionRunPhase::Running)
        .map(|run| run.owner.clone())
        .collect();
    let mut active = owners.len();
    // FIFO among runnable owners. A busy owner cannot block unrelated windows.
    for run in runs.iter_mut() {
        if active == MAX_ACTIVE_RUNS {
            break;
        }
        if run.phase == ExtensionRunPhase::Queued && !owners.contains(&run.owner) {
            run.phase = ExtensionRunPhase::Running;
            owners.insert(run.owner.clone());
            active += 1;
        }
    }
}

fn regular(path: &Path) -> NativeResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.is_file() && !info.is_symlink() => Ok(true),
        Ok(_) => Err(invalid("Extension storage refuses links and directories")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io("Cannot inspect extension storage", error)),
    }
}
fn directory(path: &Path, create: bool) -> NativeResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.is_dir() && !info.is_symlink() => Ok(true),
        Ok(_) => Err(invalid("Extension directory must be a real directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            fs::create_dir_all(path)
                .map_err(|error| io("Cannot create extension directory", error))?;
            directory(path, false)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io("Cannot inspect extension directory", error)),
    }
}
fn read_binary(path: &Path) -> NativeResult<Vec<u8>> {
    if !regular(path)? {
        return Err(NativeError::new(
            ErrorCode::NotFound,
            "Extension module is missing",
        ));
    }
    let mut binary = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(BINARY_LIMIT as u64 + 1).read_to_end(&mut binary))
        .map_err(|error| io("Cannot read extension module", error))?;
    if binary.is_empty() || binary.len() > BINARY_LIMIT {
        return Err(invalid("Extension module must be at most 16 MiB"));
    }
    Ok(binary)
}
fn validate_wasm(bytes: &[u8]) -> NativeResult<()> {
    if !bytes.starts_with(b"\0asm\x01\0\0\0") {
        return Err(invalid("Expected a WebAssembly core module"));
    }
    Ok(())
}
fn package(content: &str) -> NativeResult<Bundle> {
    bounded_text(content, PACKAGE_LIMIT, "Wasm extension package")?;
    let package: Package = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|_| invalid("Invalid Wasm extension package JSON"))?;
    package.manifest.validate()?;
    if package.wasm.len() > BINARY_LIMIT.div_ceil(3) * 4 {
        return Err(invalid("Extension module exceeds 16 MiB"));
    }
    let binary = STANDARD
        .decode(package.wasm)
        .map_err(|_| invalid("Invalid module encoding"))?;
    if binary.is_empty() || binary.len() > BINARY_LIMIT {
        return Err(invalid("Extension module exceeds 16 MiB"));
    }
    validate_wasm(&binary)?;
    crate::extension_runtime::validate(
        &binary,
        &package
            .manifest
            .commands
            .iter()
            .map(|command| command.function.as_str())
            .collect::<Vec<_>>(),
    )?;
    Ok(Bundle {
        preview: ExtensionPreview {
            manifest: package.manifest,
            sha256: digest(&binary),
            bytes: binary.len() as u32,
        },
        binary,
    })
}
pub fn preview_package(content: &str) -> NativeResult<ExtensionPreview> {
    Ok(package(content)?.preview)
}
pub fn demo_package() -> String {
    format!(
        "{{\"manifest\":{},\"wasm\":\"{}\"}}",
        include_str!("../../examples/extensions/extension.json"),
        STANDARD.encode(crate::extension_runtime::DEMO_WASM)
    )
}
pub fn bundled_package(id: &str) -> NativeResult<String> {
    let manifest = match id {
        "starter.text-tools" => return Ok(demo_package()),
        "starter.extension-lab" => include_str!("../../examples/extensions/apps/extension.json"),
        _ => return Err(invalid("Unknown bundled extension")),
    };
    Ok(format!(
        "{{\"manifest\":{manifest},\"wasm\":\"{}\"}}",
        STANDARD.encode(include_bytes!("../../resources/extensions/demo-apps.wasm"))
    ))
}
impl ExtensionStore {
    pub fn new(root: PathBuf, isolated: bool) -> Self {
        Self(Arc::new(StoreInner {
            root,
            isolated,
            shutting_down: AtomicBool::new(false),
            pauses: AtomicU32::new(0),
            writing: Mutex::new(()),
            runs: Mutex::new(VecDeque::new()),
            run_changed: Condvar::new(),
            windows: Mutex::new(HashMap::new()),
        }))
    }
    fn stop_matching(&self, predicate: impl Fn(&ActiveRun) -> bool) {
        if let Ok(mut runs) = self.0.runs.lock() {
            for run in runs.iter().filter(|run| predicate(run)) {
                run.stop.store(true, Ordering::Relaxed);
            }
            promote_runs(&mut runs);
            self.0.run_changed.notify_all();
        }
    }
    pub fn begin_shutdown(&self) -> bool {
        if self.0.shutting_down.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.stop_matching(|_| true);
        true
    }
    pub fn pause(&self) -> ExtensionPause {
        self.0.pauses.fetch_add(1, Ordering::SeqCst);
        self.stop_matching(|_| true);
        ExtensionPause(self.clone())
    }
    pub fn is_running(&self) -> bool {
        self.0.runs.lock().map_or(true, |runs| !runs.is_empty())
    }
    pub fn wait_stopped(&self) {
        if let Ok(mut runs) = self.0.runs.lock() {
            while !runs.is_empty() {
                let Ok(next) = self.0.run_changed.wait(runs) else {
                    return;
                };
                runs = next;
            }
        }
    }
    fn read(&self) -> NativeResult<Registry> {
        if self.0.isolated {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extensions are unavailable during startup recovery",
            ));
        }
        if !directory(&self.0.root, false)? {
            return Ok(Registry::default());
        }
        let path = self.0.root.join("registry.json");
        if !regular(&path)? {
            return Ok(Registry::default());
        }
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .and_then(|file| file.take(REGISTRY_LIMIT as u64 + 1).read_to_end(&mut bytes))
            .map_err(|error| io("Cannot read extension registry", error))?;
        if bytes.len() > REGISTRY_LIMIT {
            return Err(invalid("Extension registry exceeds its limit"));
        }
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            NativeError::new(
                ErrorCode::StorageCorrupt,
                "Invalid extension registry; original data kept",
            )
        })?;
        if value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            != Some(3)
        {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "Unsupported extension registry version; original data kept",
            ));
        }
        let registry: Registry = serde_json::from_value(value).map_err(|_| {
            NativeError::new(
                ErrorCode::StorageCorrupt,
                "Invalid extension registry; original data kept",
            )
        })?;
        if registry.revision < 0 || registry.extensions.len() > MAX_EXTENSIONS {
            return Err(invalid("Invalid extension registry limits"));
        }
        let mut ids = HashSet::new();
        for item in &registry.extensions {
            item.package.manifest.validate()?;
            item.origin.validate()?;
            if !valid_digest(&item.package.sha256)
                || item.package.bytes == 0
                || item.package.bytes as usize > BINARY_LIMIT
                || !ids.insert(&item.package.manifest.id)
            {
                return Err(invalid("Invalid installed extension identity"));
            }
            let grants: HashSet<_> = item.granted_permissions.iter().collect();
            if grants.len() != item.granted_permissions.len()
                || grants
                    .iter()
                    .any(|grant| !item.package.manifest.has_permission(**grant))
                || (item.enabled
                    && item
                        .package
                        .manifest
                        .permissions
                        .iter()
                        .any(|permission| !grants.contains(permission)))
                || (!item.enabled && !grants.is_empty())
            {
                return Err(invalid("Invalid installed extension grants"));
            }
            if item.previous_package.is_some() != item.previous_origin.is_some() {
                return Err(invalid("Incomplete extension rollback record"));
            }
            if let Some(previous) = &item.previous_package {
                previous.manifest.validate()?;
                if previous.manifest.id != item.package.manifest.id
                    || !valid_digest(&previous.sha256)
                    || previous.bytes == 0
                    || previous.bytes as usize > BINARY_LIMIT
                {
                    return Err(invalid("Invalid extension rollback record"));
                }
            }
            if let Some(origin) = &item.previous_origin {
                origin.validate()?;
            }
        }
        Ok(registry)
    }
    fn snapshot_of(&self, registry: &Registry) -> NativeResult<ExtensionSnapshot> {
        let runs = self
            .0
            .runs
            .lock()
            .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?
            .iter()
            .map(|run| ExtensionRunStatus {
                id: run.id.clone(),
                owner: run.owner.clone(),
                phase: run.phase,
            })
            .collect();
        Ok(ExtensionSnapshot {
            revision: registry.revision,
            items: registry.extensions.clone(),
            runs,
        })
    }

    pub fn snapshot(&self) -> NativeResult<ExtensionSnapshot> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        self.snapshot_of(&self.read()?)
    }
    fn asset(&self, hash: &str) -> NativeResult<PathBuf> {
        if !valid_digest(hash) {
            return Err(invalid("Invalid module identity"));
        }
        let packages = self.0.root.join("packages");
        directory(&self.0.root, false)?;
        directory(&packages, false)?;
        let folder = packages.join(hash);
        directory(&folder, false)?;
        Ok(folder.join("module.wasm"))
    }

    fn cleanup(&self, registry: &Registry) {
        let packages = self.0.root.join("packages");
        if directory(&packages, false) != Ok(true) {
            return;
        }
        let mut used: HashSet<_> = registry
            .extensions
            .iter()
            .map(|item| item.package.sha256.clone())
            .collect();
        used.extend(
            registry
                .extensions
                .iter()
                .filter_map(|item| item.previous_package.as_ref())
                .map(|package| package.sha256.clone()),
        );
        if let Ok(runs) = self.0.runs.lock() {
            used.extend(runs.iter().map(|run| run.digest.clone()));
        }
        let Ok(entries) = fs::read_dir(&packages) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !valid_digest(&name) || used.contains(&name) {
                continue;
            }
            if let Ok(path) = self.asset(&name) {
                if regular(&path) == Ok(true) {
                    let _ = fs::remove_file(&path);
                }
                // 只移除固定文件及空目录，不递归清理未知文件或跟随目录链接。
                let _ = fs::remove_dir(entry.path());
            }
        }
    }
    fn write(&self, registry: &mut Registry) -> NativeResult<ExtensionSnapshot> {
        registry.revision = registry.revision.checked_add(1).ok_or_else(conflict)?;
        let bytes = serde_json::to_vec_pretty(registry)
            .map_err(|error| io("Cannot encode extensions", error))?;
        if bytes.len() > REGISTRY_LIMIT {
            return Err(invalid("Extension registry exceeds its limit"));
        }
        directory(&self.0.root, true)?;
        atomic_write(&self.0.root.join("registry.json"), &bytes)?;
        self.snapshot_of(registry)
    }
    fn stop_id(&self, id: &str) {
        self.stop_matching(|run| run.id == id);
    }
    fn cache_bundle(&self, bundle: &Bundle, registry: &Registry) -> NativeResult<()> {
        self.cleanup(registry);
        directory(&self.0.root, true)?;
        let packages = self.0.root.join("packages");
        directory(&packages, true)?;
        let folder = packages.join(&bundle.preview.sha256);
        directory(&folder, true)?;
        let path = self.asset(&bundle.preview.sha256)?;
        if regular(&path)? {
            if digest(&read_binary(&path)?) != bundle.preview.sha256 {
                return Err(NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "Installed module hash differs",
                ));
            }
        } else {
            let usage: u64 = fs::read_dir(&packages)
                .map_err(|error| io("Cannot inspect package cache", error))?
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    self.asset(&name)
                        .ok()
                        .and_then(|file| fs::symlink_metadata(file).ok())
                        .map(|info| info.len())
                })
                .sum();
            if usage + bundle.binary.len() as u64 > CACHE_LIMIT {
                return Err(invalid("Wasm extension cache exceeds 128 MiB"));
            }
            atomic_write(&path, &bundle.binary)?;
        }
        Ok(())
    }
    /// Default packages are recorded once, without trusting or replacing user packages.
    pub fn initialize_bundled(&self) -> NativeResult<()> {
        // Preflight and compile before taking the registry mutation lock.
        if self
            .snapshot()?
            .items
            .iter()
            .any(|item| item.package.manifest.id == "starter.extension-lab")
        {
            let _guard = self
                .0
                .writing
                .lock()
                .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
            let mut registry = self.read()?;
            if !registry.bundled_initialized {
                registry.bundled_initialized = true;
                self.write(&mut registry)?;
            }
            return Ok(());
        }
        {
            let _guard = self
                .0
                .writing
                .lock()
                .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
            let registry = self.read()?;
            if registry.bundled_initialized || registry.extensions.len() >= MAX_EXTENSIONS {
                return Ok(());
            }
        }
        let bundle = package(&bundled_package("starter.extension-lab")?)?;
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let mut registry = self.read()?;
        if registry.bundled_initialized {
            return Ok(());
        }
        if !registry
            .extensions
            .iter()
            .any(|item| item.package.manifest.id == "starter.extension-lab")
        {
            if registry.extensions.len() >= MAX_EXTENSIONS {
                return Ok(());
            }
            self.cache_bundle(&bundle, &registry)?;
            registry.extensions.push(ExtensionInfo {
                package: bundle.preview,
                enabled: false,
                granted_permissions: vec![],
                origin: ExtensionOrigin::Bundled,
                previous_package: None,
                previous_origin: None,
            });
        }
        registry.bundled_initialized = true;
        self.write(&mut registry)?;
        Ok(())
    }
    pub fn current_entry(&self, id: &str, expected_hash: &str) -> NativeResult<ExtensionInfo> {
        self.with_current_entry(id, expected_hash, |item| Ok(item.clone()))
    }
    /// Serialize capability metadata mutations with uninstall, replacement and rollback.
    /// The callback must not reenter this store.
    pub(crate) fn with_current_entry<T>(
        &self,
        id: &str,
        expected_hash: &str,
        operation: impl FnOnce(&ExtensionInfo) -> NativeResult<T>,
    ) -> NativeResult<T> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let registry = self.read()?;
        let item = registry
            .extensions
            .iter()
            .find(|item| item.package.manifest.id == id && item.package.sha256 == expected_hash)
            .ok_or_else(conflict)?;
        operation(item)
    }
    pub fn check_permission(
        &self,
        id: &str,
        expected_hash: &str,
        permission: ExtensionPermission,
    ) -> NativeResult<()> {
        let item = self.current_entry(id, expected_hash)?;
        if !item.enabled || !item.granted_permissions.contains(&permission) {
            return Err(invalid("This extension capability has not been granted"));
        }
        Ok(())
    }
    pub fn window_entry(
        &self,
        id: &str,
        command: &str,
        expected_hash: &str,
    ) -> NativeResult<ExtensionInfo> {
        let item = self.current_entry(id, expected_hash)?;
        let entry = item
            .package
            .manifest
            .commands
            .iter()
            .find(|entry| entry.id == command)
            .ok_or_else(|| invalid("Extension does not declare this command"))?;
        if !item.enabled
            || !entry.ui.as_ref().is_some_and(|ui| ui.window)
            || entry
                .permissions
                .iter()
                .any(|permission| !item.granted_permissions.contains(permission))
        {
            return Err(invalid(
                "Extension does not declare an authorized window entry",
            ));
        }
        Ok(item)
    }
    fn install_bundle(
        &self,
        bundle: Bundle,
        expected_revision: i32,
        replace_existing: bool,
        expected_hash: &str,
        origin: ExtensionOrigin,
        before_replace: impl FnOnce(&ExtensionInfo, &ExtensionOrigin) -> NativeResult<()>,
    ) -> NativeResult<ExtensionSnapshot> {
        if bundle.preview.sha256 != expected_hash {
            return Err(conflict());
        }
        origin.validate()?;
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let mut registry = self.read()?;
        if registry.revision != expected_revision {
            return Err(conflict());
        }
        let id = bundle.preview.manifest.id.clone();
        let position = registry
            .extensions
            .iter()
            .position(|item| item.package.manifest.id == id);
        if let Some(index) = position {
            if !replace_existing
                || version(&bundle.preview.manifest.version)?
                    <= version(&registry.extensions[index].package.manifest.version)?
            {
                return Err(conflict());
            }
        } else if registry.extensions.len() >= MAX_EXTENSIONS {
            return Err(invalid("At most 64 extensions can be installed"));
        }
        self.cache_bundle(&bundle, &registry)?;
        let previous = position.map(|index| &registry.extensions[index]);
        let preserve_grants = previous.is_some_and(|old| {
            let old_version = version(&old.package.manifest.version).ok();
            let new_version = version(&bundle.preview.manifest.version).ok();
            old.enabled
                && old.origin.same_trusted_source(&origin)
                && old_version
                    .zip(new_version)
                    .is_some_and(|(old, new)| old.0 == new.0 && old.1 == new.1)
                && bundle
                    .preview
                    .manifest
                    .permissions
                    .iter()
                    .all(|permission| old.granted_permissions.contains(permission))
                && bundle.preview.manifest.network.iter().all(|new| {
                    old.package.manifest.network.iter().any(|rule| {
                        rule.origin == new.origin
                            && new
                                .methods
                                .iter()
                                .all(|method| rule.methods.contains(method))
                    })
                })
        });
        let grants = previous
            .filter(|_| preserve_grants)
            .map_or_else(Vec::new, |old| {
                old.granted_permissions
                    .iter()
                    .copied()
                    .filter(|grant| bundle.preview.manifest.has_permission(*grant))
                    .collect()
            });
        if let Some(previous) = previous {
            before_replace(previous, &origin)?;
        }
        let item = ExtensionInfo {
            package: bundle.preview,
            enabled: preserve_grants,
            granted_permissions: grants,
            origin,
            previous_package: position.map(|index| registry.extensions[index].package.clone()),
            previous_origin: position.map(|index| registry.extensions[index].origin.clone()),
        };
        if let Some(index) = position {
            registry.extensions[index] = item;
        } else {
            registry.extensions.push(item);
        }
        self.stop_id(&id);
        let result = self.write(&mut registry)?;
        self.cleanup(&registry);
        Ok(result)
    }
    pub fn install(
        &self,
        content: &str,
        revision: i32,
        replace: bool,
        expected_hash: &str,
    ) -> NativeResult<ExtensionSnapshot> {
        self.install_with_origin(
            content,
            revision,
            replace,
            expected_hash,
            ExtensionOrigin::Local,
        )
    }
    pub(crate) fn install_with_origin(
        &self,
        content: &str,
        revision: i32,
        replace: bool,
        expected_hash: &str,
        origin: ExtensionOrigin,
    ) -> NativeResult<ExtensionSnapshot> {
        self.install_with_origin_and_cleanup(
            content,
            revision,
            replace,
            expected_hash,
            origin,
            |_, _| Ok(()),
        )
    }
    pub(crate) fn install_with_origin_and_cleanup(
        &self,
        content: &str,
        revision: i32,
        replace: bool,
        expected_hash: &str,
        origin: ExtensionOrigin,
        before_replace: impl FnOnce(&ExtensionInfo, &ExtensionOrigin) -> NativeResult<()>,
    ) -> NativeResult<ExtensionSnapshot> {
        self.install_bundle(
            package(content)?,
            revision,
            replace,
            expected_hash,
            origin,
            before_replace,
        )
    }
    pub fn rollback(&self, id: &str, revision: i32) -> NativeResult<ExtensionSnapshot> {
        self.rollback_with_cleanup(id, revision, |_| Ok(()))
    }
    pub(crate) fn rollback_with_cleanup(
        &self,
        id: &str,
        revision: i32,
        before_rollback: impl FnOnce(&ExtensionInfo) -> NativeResult<()>,
    ) -> NativeResult<ExtensionSnapshot> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let mut registry = self.read()?;
        if registry.revision != revision {
            return Err(conflict());
        }
        let item = registry
            .extensions
            .iter_mut()
            .find(|item| item.package.manifest.id == id)
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Extension not found"))?;
        let previous = item
            .previous_package
            .clone()
            .ok_or_else(|| invalid("No previous extension version is available"))?;
        let previous_origin = item
            .previous_origin
            .clone()
            .ok_or_else(|| invalid("Incomplete rollback record"))?;
        let module = read_binary(&self.asset(&previous.sha256)?)?;
        if digest(&module) != previous.sha256 {
            return Err(NativeError::new(
                ErrorCode::StorageCorrupt,
                "Previous extension module changed",
            ));
        }
        before_rollback(item)?;
        item.previous_package = Some(std::mem::replace(&mut item.package, previous.clone()));
        item.previous_origin = Some(std::mem::replace(&mut item.origin, previous_origin));
        item.enabled = false;
        item.granted_permissions.clear();
        self.stop_id(id);
        let result = self.write(&mut registry)?;
        Ok(result)
    }
    pub fn set_enabled(
        &self,
        id: &str,
        enabled: bool,
        grants: Vec<ExtensionPermission>,
        revision: i32,
        trusted: bool,
    ) -> NativeResult<ExtensionSnapshot> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let mut registry = self.read()?;
        if registry.revision != revision {
            return Err(conflict());
        }
        let item = registry
            .extensions
            .iter_mut()
            .find(|item| item.package.manifest.id == id)
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Extension not found"))?;
        if enabled {
            item.package.manifest.validate()?;
            if !trusted
                || grants.iter().collect::<HashSet<_>>().len() != grants.len()
                || grants
                    .iter()
                    .any(|grant| !item.package.manifest.has_permission(*grant))
                || item
                    .package
                    .manifest
                    .permissions
                    .iter()
                    .any(|permission| !grants.contains(permission))
            {
                return Err(invalid(
                    "Confirm trust and required capabilities before enabling",
                ));
            }
        }
        let changed_grants = item.granted_permissions.len() != grants.len()
            || item
                .granted_permissions
                .iter()
                .any(|grant| !grants.contains(grant));

        item.enabled = enabled;
        item.granted_permissions = if enabled { grants } else { vec![] };
        if !enabled || changed_grants {
            self.stop_id(id);
        }
        let result = self.write(&mut registry)?;
        Ok(result)
    }
    pub fn uninstall(&self, id: &str, revision: i32) -> NativeResult<ExtensionSnapshot> {
        self.uninstall_with_cleanup(id, revision, |_| Ok(()))
    }
    pub(crate) fn uninstall_with_cleanup(
        &self,
        id: &str,
        revision: i32,
        before_uninstall: impl FnOnce(&ExtensionInfo) -> NativeResult<()>,
    ) -> NativeResult<ExtensionSnapshot> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let mut registry = self.read()?;
        if registry.revision != revision {
            return Err(conflict());
        }
        let item = registry
            .extensions
            .iter()
            .find(|item| item.package.manifest.id == id)
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Extension not found"))?;
        before_uninstall(item)?;
        registry
            .extensions
            .retain(|item| item.package.manifest.id != id);
        self.stop_id(id);
        let result = self.write(&mut registry)?;
        self.cleanup(&registry);
        Ok(result)
    }
    pub fn cancel(&self, id: &str, owner: &str) {
        self.stop_matching(|run| run.id == id && run.owner == owner);
    }
    #[cfg(test)]
    fn cancel_window(&self, label: &str) {
        self.stop_matching(|run| run.owner == label);
    }
    /// Capture before queuing blocking work so an old window cannot resume after reopening.
    pub fn window_run_token(&self, owner: String) -> NativeResult<WindowRunToken> {
        let mut windows = self
            .0
            .windows
            .lock()
            .map_err(|_| io("Extension window unavailable", "lock poisoned"))?;
        let window = windows.entry(owner.clone()).or_default();
        if window.closing {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extension window is closing",
            ));
        }
        Ok(WindowRunToken {
            owner,
            generation: window.generation,
        })
    }
    pub fn begin_window_close(&self, label: &str) -> NativeResult<()> {
        // The same lock order as admission makes closing and granting a lease atomic.
        let mut runs = self
            .0
            .runs
            .lock()
            .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
        let mut windows = self
            .0
            .windows
            .lock()
            .map_err(|_| io("Extension window unavailable", "lock poisoned"))?;
        let window = windows.entry(label.into()).or_default();
        window.generation = window.generation.checked_add(1).ok_or_else(conflict)?;
        window.closing = true;
        for run in runs.iter().filter(|run| run.owner == label) {
            run.stop.store(true, Ordering::Relaxed);
        }
        promote_runs(&mut runs);
        self.0.run_changed.notify_all();
        Ok(())
    }
    pub fn reopen_window(&self, label: &str) -> NativeResult<()> {
        let _runs = self
            .0
            .runs
            .lock()
            .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
        let mut windows = self
            .0
            .windows
            .lock()
            .map_err(|_| io("Extension window unavailable", "lock poisoned"))?;
        let window = windows.entry(label.into()).or_default();
        window.generation = window.generation.checked_add(1).ok_or_else(conflict)?;
        window.closing = false;
        Ok(())
    }
    fn check_run_available(&self, token: &WindowRunToken) -> NativeResult<()> {
        if self.0.shutting_down.load(Ordering::SeqCst) || self.0.pauses.load(Ordering::SeqCst) > 0 {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Application is shutting down",
            ));
        }
        let windows = self
            .0
            .windows
            .lock()
            .map_err(|_| io("Extension window unavailable", "lock poisoned"))?;
        if !windows
            .get(&token.owner)
            .is_some_and(|window| !window.closing && window.generation == token.generation)
        {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extension window changed or is closing",
            ));
        }
        Ok(())
    }
    pub fn wait_window_stopped(&self, label: &str) {
        if let Ok(mut runs) = self.0.runs.lock() {
            while runs.iter().any(|run| run.owner == label) {
                let Ok(next) = self.0.run_changed.wait(runs) else {
                    return;
                };
                runs = next;
            }
        }
    }
    #[cfg(test)]
    pub fn prepare(&self, id: &str, expected_hash: &str) -> NativeResult<PreparedRun> {
        self.prepare_in_window(id, expected_hash, "test".into())
    }
    #[cfg(test)]
    pub fn prepare_in_window(
        &self,
        id: &str,
        expected_hash: &str,
        owner: String,
    ) -> NativeResult<PreparedRun> {
        self.prepare_for_window(id, expected_hash, self.window_run_token(owner)?)
    }
    pub fn prepare_for_window(
        &self,
        id: &str,
        expected_hash: &str,
        token: WindowRunToken,
    ) -> NativeResult<PreparedRun> {
        let (package, module, grants, stop) = {
            let _guard = self
                .0
                .writing
                .lock()
                .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
            let registry = self.read()?;
            let item = registry
                .extensions
                .iter()
                .find(|item| item.package.manifest.id == id && item.enabled)
                .ok_or_else(|| {
                    NativeError::new(
                        ErrorCode::NotFound,
                        "Enable the installed extension before running it",
                    )
                })?;
            item.package.manifest.validate()?;
            if item.package.sha256 != expected_hash {
                return Err(conflict());
            }
            let module = read_binary(&self.asset(expected_hash)?)?;
            if digest(&module) != expected_hash {
                return Err(NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "Installed module changed; reinstall the trusted package",
                ));
            }
            let mut runs = self
                .0
                .runs
                .lock()
                .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
            self.check_run_available(&token)?;
            let stop = Arc::new(AtomicBool::new(false));
            runs.push_back(ActiveRun {
                id: id.into(),
                owner: token.owner.clone(),
                digest: expected_hash.into(),
                stop: stop.clone(),
                phase: ExtensionRunPhase::Queued,
            });
            promote_runs(&mut runs);
            if runs
                .iter()
                .filter(|run| run.phase == ExtensionRunPhase::Queued)
                .count()
                > MAX_QUEUED_RUNS
            {
                runs.retain(|run| !Arc::ptr_eq(&run.stop, &stop));
                return Err(NativeError::new(
                    ErrorCode::ExtensionBusy,
                    "Extension queue is full; try again after a task finishes",
                ));
            }
            self.0.run_changed.notify_all();
            (
                item.package.clone(),
                module,
                item.granted_permissions.clone(),
                stop,
            )
        };
        // Queued work owns a lease, but never holds the registry write lock while waiting.
        let lease = RunLease {
            store: self.clone(),
            stop: stop.clone(),
        };
        {
            let mut runs = self
                .0
                .runs
                .lock()
                .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
            loop {
                if stop.load(Ordering::Relaxed) {
                    return Err(NativeError::new(
                        ErrorCode::UserCancelled,
                        "Extension operation was cancelled before execution",
                    ));
                }
                self.check_run_available(&token)?;
                if runs.iter().any(|run| {
                    Arc::ptr_eq(&run.stop, &stop) && run.phase == ExtensionRunPhase::Running
                }) {
                    break;
                }
                runs = self
                    .0
                    .run_changed
                    .wait(runs)
                    .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
            }
        }
        Ok(PreparedRun {
            package,
            module,
            stop,
            grants,
            _lease: lease,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, ExtensionStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ExtensionStore::new(dir.path().join("extensions"), false);
        (dir, store)
    }
    fn install(store: &ExtensionStore) -> ExtensionSnapshot {
        let content = demo_package();
        let preview = preview_package(&content).unwrap();
        store.install(&content, 0, false, &preview.sha256).unwrap()
    }
    fn enable(store: &ExtensionStore, snapshot: &ExtensionSnapshot) -> ExtensionSnapshot {
        let item = &snapshot.items[0];
        store
            .set_enabled(
                &item.package.manifest.id,
                true,
                item.package.manifest.permissions.clone(),
                snapshot.revision,
                true,
            )
            .unwrap()
    }
    fn wait_for_runs(store: &ExtensionStore, expected: usize) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while store.snapshot().unwrap().runs.len() != expected {
            assert!(
                std::time::Instant::now() < deadline,
                "Timed out waiting for extension queue"
            );
            std::thread::yield_now();
        }
    }
    #[test]
    fn optional_grants_allow_offline_use_and_changes_cancel_old_calls() {
        let (_dir, store) = store();
        store.initialize_bundled().unwrap();
        let snapshot = enable(&store, &store.snapshot().unwrap());
        let item = &snapshot.items[0];
        assert!(item.enabled);
        assert!(item.granted_permissions.is_empty());
        let run = store
            .prepare(&item.package.manifest.id, &item.package.sha256)
            .unwrap();
        assert!(
            store
                .check_permission(
                    &item.package.manifest.id,
                    &item.package.sha256,
                    ExtensionPermission::Storage
                )
                .is_err()
        );
        let snapshot = store
            .set_enabled(
                &item.package.manifest.id,
                true,
                vec![ExtensionPermission::Storage],
                snapshot.revision,
                true,
            )
            .unwrap();
        assert!(run.stop.load(Ordering::Relaxed));
        assert!(
            store
                .check_permission(
                    &item.package.manifest.id,
                    &item.package.sha256,
                    ExtensionPermission::Storage
                )
                .is_ok()
        );
        assert_eq!(
            snapshot.items[0].granted_permissions,
            vec![ExtensionPermission::Storage]
        );
    }
    #[test]
    fn installed_disabled_extensions_can_manage_data_without_executing() {
        let (_dir, store) = store();
        let snapshot = install(&store);
        let item = &snapshot.items[0];
        let id = &item.package.manifest.id;
        let hash = &item.package.sha256;
        assert!(!store.current_entry(id, hash).unwrap().enabled);
        store
            .with_current_entry(id, hash, |item| {
                assert!(!item.enabled);
                Ok(())
            })
            .unwrap();
        assert!(
            store
                .check_permission(id, hash, ExtensionPermission::TextRead)
                .is_err()
        );
        assert!(store.prepare(id, hash).is_err());
    }
    #[test]
    fn queue_is_bounded_cancellable_and_retains_active_leases() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let id = snapshot.items[0].package.manifest.id.clone();
        let hash = snapshot.items[0].package.sha256.clone();
        let first = store.prepare_in_window(&id, &hash, "first".into()).unwrap();
        let second = store
            .prepare_in_window(&id, &hash, "second".into())
            .unwrap();
        let mut waiting = Vec::new();
        for index in 0..MAX_QUEUED_RUNS {
            let cloned = store.clone();
            let id = id.clone();
            let hash = hash.clone();
            waiting.push(std::thread::spawn(move || {
                cloned.prepare_in_window(&id, &hash, format!("queued-{index}"))
            }));
        }
        wait_for_runs(&store, MAX_ACTIVE_RUNS + MAX_QUEUED_RUNS);
        assert_eq!(
            store
                .prepare_in_window(&id, &hash, "overflow".into())
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        store.cancel(&id, "queued-0");
        let cancelled = waiting.remove(0).join().unwrap();
        assert_eq!(cancelled.err().unwrap().code, ErrorCode::UserCancelled);
        store
            .set_enabled(&id, false, vec![], snapshot.revision, false)
            .unwrap();
        for worker in waiting {
            assert_eq!(
                worker.join().unwrap().err().unwrap().code,
                ErrorCode::UserCancelled
            );
        }
        assert!(first.stop.load(Ordering::Relaxed) && second.stop.load(Ordering::Relaxed));
        assert_eq!(store.snapshot().unwrap().runs.len(), 2);
        drop(first);
        drop(second);
        assert!(!store.is_running());
    }
    #[test]
    fn queue_preserves_owner_serial_execution_and_fifo_for_available_owners() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let id = snapshot.items[0].package.manifest.id.clone();
        let hash = snapshot.items[0].package.sha256.clone();
        let first = store.prepare_in_window(&id, &hash, "first".into()).unwrap();
        let second = store
            .prepare_in_window(&id, &hash, "second".into())
            .unwrap();
        let spawn = |owner: &'static str| {
            let store = store.clone();
            let id = id.clone();
            let hash = hash.clone();
            std::thread::spawn(move || store.prepare_in_window(&id, &hash, owner.into()))
        };
        let same_owner = spawn("first");
        wait_for_runs(&store, 3);
        let next = spawn("third");
        wait_for_runs(&store, 4);
        drop(second);
        let next = next.join().unwrap().unwrap();
        assert!(
            store
                .snapshot()
                .unwrap()
                .runs
                .iter()
                .any(|run| run.owner == "first" && run.phase == ExtensionRunPhase::Queued)
        );
        drop(first);
        let same_owner = same_owner.join().unwrap().unwrap();
        assert_eq!(store.snapshot().unwrap().runs.len(), 2);
        drop(next);
        drop(same_owner);
    }
    #[test]
    fn rollback_keeps_previous_module_and_always_revokes_grants() {
        let (_dir, store) = store();
        let installed = enable(&store, &install(&store));
        let item = &installed.items[0];
        let old_hash = item.package.sha256.clone();
        let mut value: serde_json::Value = serde_json::from_str(&demo_package()).unwrap();
        value["manifest"]["version"] = "1.0.1".into();
        let mut module = STANDARD.decode(value["wasm"].as_str().unwrap()).unwrap();
        module.extend_from_slice(&[0, 1, 0]); // An empty custom section changes identity without execution.
        value["wasm"] = STANDARD.encode(module).into();
        let content = value.to_string();
        let new_hash = preview_package(&content).unwrap().sha256;
        let upgraded = store
            .install(&content, installed.revision, true, &new_hash)
            .unwrap();
        assert!(store.asset(&old_hash).unwrap().exists());
        assert_eq!(
            upgraded.items[0].previous_package.as_ref().unwrap().sha256,
            old_hash
        );
        let rolled = store
            .rollback(&item.package.manifest.id, upgraded.revision)
            .unwrap();
        assert_eq!(rolled.items[0].package.sha256, old_hash);
        assert!(!rolled.items[0].enabled && rolled.items[0].granted_permissions.is_empty());
        assert_eq!(
            rolled.items[0].previous_package.as_ref().unwrap().sha256,
            new_hash
        );
    }
    #[test]
    fn trusted_patch_updates_keep_only_existing_grants_without_expanding_network_access() {
        for (origin, change, expected_enabled) in [
            (ExtensionOrigin::Bundled, "optional", true),
            (ExtensionOrigin::Local, "optional", false),
            (ExtensionOrigin::Bundled, "required", false),
            (ExtensionOrigin::Bundled, "network", false),
            (ExtensionOrigin::Bundled, "minor", false),
        ] {
            let (_dir, store) = store();
            let content = demo_package();
            let hash = preview_package(&content).unwrap().sha256;
            let initial = store
                .install_with_origin(&content, 0, false, &hash, origin.clone())
                .unwrap();
            let enabled = enable(&store, &initial);
            let mut value: serde_json::Value = serde_json::from_str(&content).unwrap();
            value["manifest"]["version"] = if change == "minor" { "1.1.0" } else { "1.0.1" }.into();
            value["manifest"]["optionalPermissions"] = serde_json::json!(["storage"]);
            if change == "required" {
                value["manifest"]["permissions"] = serde_json::json!(["text:read", "files:read"]);
            }
            if change == "network" {
                value["manifest"]["optionalPermissions"] =
                    serde_json::json!(["storage", "network:https"]);
                value["manifest"]["network"] =
                    serde_json::json!([{ "origin": "https://api.github.com", "methods": ["GET"] }]);
            }
            let updated = store
                .install_with_origin(&value.to_string(), enabled.revision, true, &hash, origin)
                .unwrap();
            assert_eq!(updated.items[0].enabled, expected_enabled, "{change}");
            assert!(
                !updated.items[0]
                    .granted_permissions
                    .contains(&ExtensionPermission::Storage)
            );
            if expected_enabled {
                assert_eq!(
                    updated.items[0].granted_permissions,
                    vec![ExtensionPermission::TextRead]
                );
            } else {
                assert!(updated.items[0].granted_permissions.is_empty());
            }
        }
    }
    #[test]
    fn market_trust_uses_repository_and_key_identity() {
        let source = |repository: &str, key: &str, revision| ExtensionOrigin::Market {
            source: crate::extension_market::MarketSource {
                repository: repository.into(),
                public_key_fingerprint: key.into(),
                catalog_revision: revision,
                package_sha256: "a".repeat(64),
            },
        };
        assert!(
            source("example/market", "key", 1).same_trusted_source(&source(
                "example/market",
                "key",
                2
            ))
        );
        assert!(
            !source("example/market", "key", 1).same_trusted_source(&source(
                "other/market",
                "key",
                2
            ))
        );
        assert!(
            !source("example/market", "key", 1).same_trusted_source(&source(
                "example/market",
                "new-key",
                2
            ))
        );
        assert!(!ExtensionOrigin::Local.same_trusted_source(&ExtensionOrigin::Local));
    }
    #[test]
    fn management_cleanup_failures_keep_the_registry_and_do_not_cancel_execution() {
        let (_dir, store) = store();
        let initial = enable(&store, &install(&store));
        let id = initial.items[0].package.manifest.id.clone();
        let hash = initial.items[0].package.sha256.clone();
        let active = store.prepare(&id, &hash).unwrap();
        let fail = || NativeError::new(ErrorCode::CredentialError, "Retry credential cleanup");
        let mut content: serde_json::Value = serde_json::from_str(&demo_package()).unwrap();
        content["manifest"]["version"] = "1.0.1".into();
        assert!(
            store
                .install_with_origin_and_cleanup(
                    &content.to_string(),
                    initial.revision,
                    true,
                    &hash,
                    ExtensionOrigin::Local,
                    |old, origin| {
                        assert!(old.enabled);
                        assert!(matches!(origin, ExtensionOrigin::Local));
                        Err(fail())
                    }
                )
                .is_err()
        );
        assert!(
            store
                .uninstall_with_cleanup(&id, initial.revision, |_| Err(fail()))
                .is_err()
        );
        assert_eq!(store.snapshot().unwrap().revision, initial.revision);
        assert!(store.snapshot().unwrap().items[0].enabled);
        assert!(!active.stop.load(Ordering::Relaxed));
        let calls = std::cell::Cell::new(0);
        assert!(
            store
                .uninstall_with_cleanup(&id, initial.revision - 1, |_| {
                    calls.set(calls.get() + 1);
                    Ok(())
                })
                .is_err()
        );
        assert_eq!(calls.get(), 0, "Stale mutations cannot delete credentials");
        let upgraded = store
            .install(&content.to_string(), initial.revision, true, &hash)
            .unwrap();
        let enabled = enable(&store, &upgraded);
        assert!(
            store
                .rollback_with_cleanup(&id, enabled.revision, |_| Err(fail()))
                .is_err()
        );
        let retained = store.snapshot().unwrap();
        assert_eq!(retained.revision, enabled.revision);
        assert_eq!(retained.items[0].package.manifest.version, "1.0.1");
        assert!(retained.items[0].enabled);
    }
    #[test]
    fn capability_metadata_mutation_is_serialized_with_uninstall_cleanup() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let id = snapshot.items[0].package.manifest.id.clone();
        let hash = snapshot.items[0].package.sha256.clone();
        let (entered_send, entered_recv) = std::sync::mpsc::channel();
        let (release_send, release_recv) = std::sync::mpsc::channel();
        let mutation = {
            let store = store.clone();
            let id = id.clone();
            let hash = hash.clone();
            std::thread::spawn(move || {
                store.with_current_entry(&id, &hash, |_| {
                    entered_send.send(()).unwrap();
                    release_recv.recv().unwrap();
                    Ok(())
                })
            })
        };
        entered_recv.recv().unwrap();
        let (cleanup_send, cleanup_recv) = std::sync::mpsc::channel();
        let removal = {
            let store = store.clone();
            let id = id.clone();
            std::thread::spawn(move || {
                store.uninstall_with_cleanup(&id, snapshot.revision, |_| {
                    cleanup_send.send(()).unwrap();
                    Ok(())
                })
            })
        };
        assert!(
            cleanup_recv
                .recv_timeout(std::time::Duration::from_millis(30))
                .is_err()
        );
        release_send.send(()).unwrap();
        mutation.join().unwrap().unwrap();
        removal.join().unwrap().unwrap();
        cleanup_recv.recv().unwrap();
        let invoked = std::cell::Cell::new(false);
        assert!(
            store
                .with_current_entry(&id, &hash, |_| {
                    invoked.set(true);
                    Ok(())
                })
                .is_err()
        );
        assert!(
            !invoked.get(),
            "A late request cannot mutate an uninstalled identity"
        );
    }
    #[test]
    fn manifest_supports_mixed_commands_and_rejects_ambiguous_network_or_host_versions() {
        let mut manifest = preview_package(&demo_package()).unwrap().manifest;
        manifest.optional_permissions = vec![
            ExtensionPermission::NetworkHttps,
            ExtensionPermission::NetworkLocal,
        ];
        manifest.network = vec![
            ExtensionNetworkRule {
                origin: "https://api.github.com".into(),
                methods: vec!["GET".into(), "POST".into()],
            },
            ExtensionNetworkRule {
                origin: "http://localhost:11434".into(),
                methods: vec!["POST".into()],
            },
        ];
        manifest.commands[1].input_format = ExtensionInputFormat::Json;
        manifest.commands[1].result_format = ExtensionResultFormat::View;
        manifest.commands[1].permissions = vec![ExtensionPermission::NetworkHttps];
        manifest.commands[1].ui = Some(ExtensionUi {
            sidebar: true,
            window: true,
        });
        manifest.validate().unwrap();
        for origin in [
            "https://api.github.com/",
            "https://api.github.com/path",
            "https://user@api.github.com",
            "https://127.0.0.1",
            "https://192.168.1.1",
            "http://api.github.com",
            "http://localhost.evil.test",
            "https://*.github.com",
            "https://api.github.com?key=secret",
        ] {
            let mut invalid = manifest.clone();
            invalid.network[0].origin = origin.into();
            assert!(invalid.validate().is_err(), "{origin}");
        }
        manifest.min_host_version = "65535.0.0".into();
        assert_eq!(
            manifest.validate().unwrap_err().code,
            ErrorCode::ExtensionIncompatible
        );
    }
    #[test]
    fn defaults_install_once_disabled_and_never_overwrite_or_resurrect() {
        let (_dir, store) = store();
        store.initialize_bundled().unwrap();
        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.items.len(), 1);
        let item = &snapshot.items[0];
        assert_eq!(item.package.manifest.id, "starter.extension-lab");
        assert!(!item.enabled && item.granted_permissions.is_empty());
        store.initialize_bundled().unwrap();
        assert_eq!(store.snapshot().unwrap().revision, snapshot.revision);
        assert!(
            store
                .window_entry("starter.extension-lab", "open", &item.package.sha256)
                .is_err()
        );
        let enabled = enable(&store, &snapshot);
        assert!(
            store
                .window_entry("starter.extension-lab", "open", &item.package.sha256)
                .is_ok()
        );
        assert!(
            store
                .window_entry("starter.extension-lab", "missing", &item.package.sha256)
                .is_err()
        );
        store
            .uninstall("starter.extension-lab", enabled.revision)
            .unwrap();
        store.initialize_bundled().unwrap();
        assert!(store.snapshot().unwrap().items.is_empty());

        let (_dir, store) = self::store();
        let mut content: serde_json::Value =
            serde_json::from_str(&bundled_package("starter.extension-lab").unwrap()).unwrap();
        content["manifest"]["name"] = serde_json::json!("User package, same ID");
        let content = content.to_string();
        let hash = preview_package(&content).unwrap().sha256;
        store.install(&content, 0, false, &hash).unwrap();
        store.initialize_bundled().unwrap();
        assert_eq!(
            store.snapshot().unwrap().items[0].package.manifest.name,
            "User package, same ID"
        );
    }
    #[test]
    fn a_full_existing_registry_records_defaults_without_resurrecting_a_manual_uninstall() {
        let (_dir, store) = store();
        let content = bundled_package("starter.extension-lab").unwrap();
        let preview = preview_package(&content).unwrap();
        let mut snapshot = store.install(&content, 0, false, &preview.sha256).unwrap();
        for index in 1..MAX_EXTENSIONS {
            let mut value: serde_json::Value = serde_json::from_str(&content).unwrap();
            value["manifest"]["id"] = serde_json::json!(format!("example.plugin-{index}"));
            snapshot = store
                .install(
                    &value.to_string(),
                    snapshot.revision,
                    false,
                    &preview.sha256,
                )
                .unwrap();
        }
        store.initialize_bundled().unwrap();
        let revision = store.snapshot().unwrap().revision;
        store.uninstall("starter.extension-lab", revision).unwrap();
        store.initialize_bundled().unwrap();
        assert_eq!(store.snapshot().unwrap().items.len(), MAX_EXTENSIONS - 1);
    }
    #[test]
    fn stop_requests_cannot_cancel_another_windows_run() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let item = &snapshot.items[0];
        let run = store
            .prepare_in_window(
                &item.package.manifest.id,
                &item.package.sha256,
                "extension-owner".into(),
            )
            .unwrap();
        store.cancel(&item.package.manifest.id, "extension-other");
        assert!(!run.stop.load(Ordering::Relaxed));
        store.cancel("another.extension", "extension-owner");
        assert!(!run.stop.load(Ordering::Relaxed));
        store.cancel(&item.package.manifest.id, "extension-owner");
        assert!(run.stop.load(Ordering::Relaxed));
        assert!(store.is_running());
        drop(run);
        assert!(!store.is_running());
    }
    #[test]
    fn window_close_cancels_only_the_call_owned_by_that_window() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let item = &snapshot.items[0];
        let run = store
            .prepare_in_window(
                &item.package.manifest.id,
                &item.package.sha256,
                "extension-owner".into(),
            )
            .unwrap();
        store.cancel_window("extension-other");
        assert!(!run.stop.load(Ordering::Relaxed));
        store.cancel_window("extension-owner");
        assert!(run.stop.load(Ordering::Relaxed));
        assert!(store.is_running());
        drop(run);
        store.wait_window_stopped("extension-owner");
        assert!(!store.is_running());
    }
    #[test]
    fn window_close_blocks_queued_runs_even_after_the_same_label_reopens() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let item = &snapshot.items[0];
        let id = &item.package.manifest.id;
        let hash = &item.package.sha256;
        let late = store.window_run_token("extension-owner".into()).unwrap();
        let run = store
            .prepare_in_window(id, hash, "extension-owner".into())
            .unwrap();
        store.begin_window_close("extension-other").unwrap();
        assert!(!run.stop.load(Ordering::Relaxed));
        store.begin_window_close("extension-owner").unwrap();
        assert!(run.stop.load(Ordering::Relaxed));
        assert!(store.is_running());
        assert!(store.window_run_token("extension-owner".into()).is_err());
        drop(run);
        assert!(
            store
                .prepare_in_window(id, hash, "extension-owner".into())
                .is_err()
        );
        store.reopen_window("extension-owner").unwrap();
        assert_eq!(
            store.prepare_for_window(id, hash, late).err().unwrap().code,
            ErrorCode::ExtensionUnavailable
        );
        let run = store
            .prepare_in_window(id, hash, "extension-owner".into())
            .unwrap();
        assert!(!run.stop.load(Ordering::Relaxed));
    }
    #[test]
    fn install_grants_revision_and_restart_are_enforced() {
        let (_dir, store) = store();
        let snapshot = install(&store);
        let item = &snapshot.items[0];
        let id = &item.package.manifest.id;
        let hash = &item.package.sha256;
        assert!(!item.enabled);
        assert!(store.prepare(id, hash).is_err());
        assert!(
            store
                .set_enabled(id, true, vec![ExtensionPermission::TextRead], 1, false)
                .is_err()
        );
        assert!(store.set_enabled(id, true, vec![], 1, true).is_err());
        assert_eq!(
            store
                .set_enabled(id, true, vec![ExtensionPermission::TextRead], 0, true)
                .unwrap_err()
                .code,
            ErrorCode::Conflict
        );
        let enabled = enable(&store, &snapshot);
        assert_eq!(enabled.revision, 2);
        let restarted = ExtensionStore::new(store.0.root.clone(), false);
        assert!(restarted.snapshot().unwrap().items[0].enabled);
        assert!(store.prepare(id, "wrong hash").is_err());
        let run = store.prepare(id, hash).unwrap();
        assert_eq!(
            crate::extension_runtime::run(&run.module, "uppercase", b"hello", run.stop.clone())
                .unwrap(),
            "HELLO"
        );
        store.set_enabled(id, false, vec![], 2, false).unwrap();
        assert!(run.stop.load(Ordering::Relaxed));
        assert!(store.is_running());
        drop(run);
        assert!(!store.is_running());
    }
    #[test]
    fn upgrades_revoke_grants_and_running_modules_keep_their_lease() {
        let (_dir, store) = store();
        let enabled = enable(&store, &install(&store));
        let item = &enabled.items[0];
        let id = &item.package.manifest.id;
        let hash = &item.package.sha256;
        let run = store.prepare(id, hash).unwrap();
        let mut package: serde_json::Value = serde_json::from_str(&demo_package()).unwrap();
        assert!(store.install(&package.to_string(), 2, true, hash).is_err());
        package["manifest"]["version"] = "1.0.1".into();
        let upgraded = store.install(&package.to_string(), 2, true, hash).unwrap();
        assert!(!upgraded.items[0].enabled);
        assert!(upgraded.items[0].granted_permissions.is_empty());
        assert!(run.stop.load(Ordering::Relaxed));
        store.uninstall(id, upgraded.revision).unwrap();
        let path = store.asset(hash).unwrap();
        assert!(path.exists());
        drop(run);
        assert!(!path.exists());
    }
    #[test]
    fn tampered_modules_unsupported_registries_and_isolation_preserve_data() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let item = &snapshot.items[0];
        fs::write(store.asset(&item.package.sha256).unwrap(), b"tampered").unwrap();
        assert_eq!(
            store
                .prepare(&item.package.manifest.id, &item.package.sha256)
                .err()
                .unwrap()
                .code,
            ErrorCode::StorageCorrupt
        );
        for schema in [1, 2, 99] {
            let original = format!("{{\"schemaVersion\":{schema},\"preserve\":true}}");
            let path = store.0.root.join("registry.json");
            fs::write(&path, &original).unwrap();
            assert!(store.uninstall(&item.package.manifest.id, 2).is_err());
            assert_eq!(fs::read_to_string(path).unwrap(), original);
        }
        let isolated = ExtensionStore::new(store.0.root.clone(), true);
        assert_eq!(
            isolated.snapshot().unwrap_err().code,
            ErrorCode::ExtensionUnavailable
        );
    }
    #[test]
    fn pauses_and_shutdown_cancel_without_releasing_an_active_lease() {
        let (_dir, store) = store();
        let snapshot = enable(&store, &install(&store));
        let item = &snapshot.items[0];
        let run = store
            .prepare(&item.package.manifest.id, &item.package.sha256)
            .unwrap();
        let pause = store.pause();
        assert!(run.stop.load(Ordering::Relaxed));
        drop(run);
        assert!(
            store
                .prepare(&item.package.manifest.id, &item.package.sha256)
                .is_err()
        );
        drop(pause);
        let run = store
            .prepare(&item.package.manifest.id, &item.package.sha256)
            .unwrap();
        assert!(store.begin_shutdown());
        assert!(run.stop.load(Ordering::Relaxed));
        drop(run);
        assert!(
            store
                .prepare(&item.package.manifest.id, &item.package.sha256)
                .is_err()
        );
    }
    #[test]
    fn package_validation_rejects_native_code_duplicate_commands_and_ambiguous_capabilities() {
        let original: serde_json::Value = serde_json::from_str(&demo_package()).unwrap();
        for (pointer, value) in [
            ("/manifest/formatVersion", serde_json::json!(1)),
            ("/wasm", serde_json::json!(STANDARD.encode(b"MZnot-wasm"))),
            ("/manifest/commands", serde_json::json!([])),
            (
                "/manifest/commands/0/permissions",
                serde_json::json!(["network:https"]),
            ),
            ("/manifest/id", serde_json::json!("../escape")),
        ] {
            let mut package = original.clone();
            *package.pointer_mut(pointer).unwrap() = value;
            assert!(preview_package(&package.to_string()).is_err(), "{pointer}");
        }
        let mut package = original;
        package["manifest"]["commands"][1] = package["manifest"]["commands"][0].clone();
        assert!(preview_package(&package.to_string()).is_err());
    }
    #[test]
    #[ignore = "requires a generated package via STARTER_TEST_EXTENSION_PACKAGE"]
    fn external_extism_package_roundtrip() {
        let content = fs::read_to_string(
            std::env::var_os("STARTER_TEST_EXTENSION_PACKAGE")
                .expect("Provide a packaged Extism module"),
        )
        .unwrap();
        let preview = preview_package(&content).unwrap();
        let (_dir, store) = store();
        let snapshot = store.install(&content, 0, false, &preview.sha256).unwrap();
        let snapshot = enable(&store, &snapshot);
        let item = &snapshot.items[0];
        let run = store
            .prepare(&item.package.manifest.id, &item.package.sha256)
            .unwrap();
        let function = &item.package.manifest.commands[0].function;
        let input =
            std::env::var("STARTER_TEST_EXTENSION_INPUT").unwrap_or_else(|_| "hello".into());
        let expected =
            std::env::var("STARTER_TEST_EXTENSION_EXPECT").unwrap_or_else(|_| "HELLO".into());
        let payload = match item.package.manifest.commands[0].input_format {
            ExtensionInputFormat::Text => input.into_bytes(),
            ExtensionInputFormat::Json
                if item.package.manifest.commands[0].result_format
                    == ExtensionResultFormat::View =>
            {
                serde_json::to_vec(&crate::extension_view::ExtensionViewRequest {
                    version: 2,
                    action: None,
                    state: String::new(),
                    fields: std::collections::BTreeMap::new(),
                    locale: "en".into(),
                    host: None,
                    results: vec![],
                })
                .unwrap()
            }
            ExtensionInputFormat::Json => serde_json::to_vec(&ExtensionRequest {
                api_version: 2,
                input_text: input,
                files: vec![ExtensionFile {
                    name: "sample.txt".into(),
                    encoding: ExtensionFileEncoding::Utf8,
                    media_type: "text/plain".into(),
                    content: "selected fixture".into(),
                }],
                network: vec![],
            })
            .unwrap(),
        };
        let output =
            crate::extension_runtime::run(&run.module, function, &payload, run.stop.clone())
                .unwrap();
        assert!(
            output.contains(&expected),
            "Unexpected plugin output: {output}"
        );
        if item.package.manifest.commands[0].result_format == ExtensionResultFormat::View {
            crate::extension_view::ExtensionView::parse(&output).unwrap();
        }
        drop(run);
        store
            .uninstall(&item.package.manifest.id, snapshot.revision)
            .unwrap();
        assert!(store.snapshot().unwrap().items.is_empty());
    }
}
