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
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
};

pub const EXTENSIONS_EVENT: &str = "app://extensions-changed";
pub const TEXT_LIMIT: usize = 64 * 1024;
const BINARY_LIMIT: usize = 16 * 1024 * 1024;
pub(crate) const PACKAGE_LIMIT: usize = 24 * 1024 * 1024;
const REGISTRY_LIMIT: usize = 1024 * 1024;
const CACHE_LIMIT: u64 = 128 * 1024 * 1024;
const MAX_EXTENSIONS: usize = 24;

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
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionCommand {
    pub id: String,
    pub title: String,
    pub function: String,
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
    pub id: String,
    pub version: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub input_format: ExtensionInputFormat,
    pub result_format: ExtensionResultFormat,
    #[serde(default)]
    pub icon: Option<ExtensionIcon>,
    #[serde(default)]
    pub ui: Option<ExtensionUi>,
    pub commands: Vec<ExtensionCommand>,
    pub permissions: Vec<ExtensionPermission>,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
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
}
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSnapshot {
    pub revision: i32,
    pub items: Vec<ExtensionInfo>,
    pub running_id: Option<String>,
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
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFile {
    pub name: String,
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
            schema_version: 2,
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
    active: Mutex<Option<ActiveRun>>,
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
        if let Ok(mut active) = self.store.0.active.lock()
            && active
                .as_ref()
                .is_some_and(|run| Arc::ptr_eq(&run.stop, &self.stop))
        {
            *active = None;
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
fn valid_id(id: &str) -> bool {
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
    pub(crate) fn validate(&self) -> NativeResult<()> {
        if self.format_version != 2 || self.api_version != 1 {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "Unsupported extension format or API",
            ));
        }
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
        if self.commands.is_empty() || self.commands.len() > 8 {
            return Err(invalid("Declare one to eight commands"));
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
        }
        if self.permissions.iter().collect::<HashSet<_>>().len() != self.permissions.len() {
            return Err(invalid("Duplicate extension permissions"));
        }
        if self.result_format == ExtensionResultFormat::View
            && self.input_format != ExtensionInputFormat::Json
        {
            return Err(invalid("Views require JSON input"));
        }
        if self.ui.is_some() && self.result_format != ExtensionResultFormat::View {
            return Err(invalid("UI contributions require a view result"));
        }
        if self.input_format == ExtensionInputFormat::Text
            && self
                .permissions
                .iter()
                .any(|p| *p != ExtensionPermission::TextRead)
        {
            return Err(invalid("File and HTTPS broker data require JSON input"));
        }
        if self.allowed_hosts.len() > 2
            || self.allowed_hosts.iter().any(|host| {
                !["httpbin.org", "jsonplaceholder.typicode.com"].contains(&host.as_str())
            })
            || self.allowed_hosts.iter().collect::<HashSet<_>>().len() != self.allowed_hosts.len()
        {
            return Err(invalid("Unsupported or duplicate HTTPS broker host"));
        }
        if self
            .permissions
            .contains(&ExtensionPermission::NetworkHttps)
            != !self.allowed_hosts.is_empty()
        {
            return Err(invalid(
                "HTTPS permission and allowed hosts must be declared together",
            ));
        }
        Ok(())
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
            active: Mutex::new(None),
            windows: Mutex::new(HashMap::new()),
        }))
    }
    pub fn begin_shutdown(&self) -> bool {
        if self.0.shutting_down.swap(true, Ordering::SeqCst) {
            return false;
        }
        if let Ok(active) = self.0.active.lock()
            && let Some(run) = active.as_ref()
        {
            run.stop.store(true, Ordering::Relaxed);
        }
        true
    }
    pub fn pause(&self) -> ExtensionPause {
        self.0.pauses.fetch_add(1, Ordering::SeqCst);
        if let Ok(active) = self.0.active.lock()
            && let Some(run) = active.as_ref()
        {
            run.stop.store(true, Ordering::Relaxed);
        }
        ExtensionPause(self.clone())
    }
    pub fn is_running(&self) -> bool {
        self.0.active.lock().map_or(true, |active| active.is_some())
    }
    pub fn wait_stopped(&self) {
        while self.is_running() {
            std::thread::sleep(std::time::Duration::from_millis(10));
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
            != Some(2)
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
                    .any(|grant| !item.package.manifest.permissions.contains(grant))
                || (item.enabled && grants.len() != item.package.manifest.permissions.len())
            {
                return Err(invalid("Invalid installed extension grants"));
            }
        }
        Ok(registry)
    }
    fn snapshot_of(&self, registry: &Registry) -> NativeResult<ExtensionSnapshot> {
        let running_id = self
            .0
            .active
            .lock()
            .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?
            .as_ref()
            .map(|run| run.id.clone());
        Ok(ExtensionSnapshot {
            revision: registry.revision,
            items: registry.extensions.clone(),
            running_id,
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
        if let Ok(active) = self.0.active.lock()
            && let Some(run) = active.as_ref()
        {
            used.insert(run.digest.clone());
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
        if let Ok(active) = self.0.active.lock()
            && let Some(run) = active.as_ref().filter(|run| run.id == id)
        {
            run.stop.store(true, Ordering::Relaxed);
        }
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
            let bundle = package(&bundled_package("starter.extension-lab")?)?;
            self.cache_bundle(&bundle, &registry)?;
            registry.extensions.push(ExtensionInfo {
                package: bundle.preview,
                enabled: false,
                granted_permissions: vec![],
            });
        }
        registry.bundled_initialized = true;
        self.write(&mut registry)?;
        Ok(())
    }
    pub fn window_entry(
        &self,
        id: &str,
        command: &str,
        expected_hash: &str,
    ) -> NativeResult<ExtensionInfo> {
        let item = self
            .snapshot()?
            .items
            .into_iter()
            .find(|item| {
                item.package.manifest.id == id
                    && item.enabled
                    && item.package.sha256 == expected_hash
            })
            .ok_or_else(conflict)?;
        if !item
            .package
            .manifest
            .ui
            .as_ref()
            .is_some_and(|ui| ui.window)
            || !item
                .package
                .manifest
                .commands
                .iter()
                .any(|entry| entry.id == command)
        {
            return Err(invalid("Extension does not declare this window entry"));
        }
        Ok(item)
    }
    fn install_bundle(
        &self,
        bundle: Bundle,
        expected_revision: i32,
        replace_existing: bool,
        expected_hash: &str,
    ) -> NativeResult<ExtensionSnapshot> {
        if bundle.preview.sha256 != expected_hash {
            return Err(conflict());
        }
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
            return Err(invalid("At most 24 extensions can be installed"));
        }
        self.cache_bundle(&bundle, &registry)?;
        let item = ExtensionInfo {
            package: bundle.preview,
            enabled: false,
            granted_permissions: vec![],
        };
        if let Some(index) = position {
            registry.extensions[index] = item;
        } else {
            registry.extensions.push(item);
        }
        let result = self.write(&mut registry)?;
        self.stop_id(&id);
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
        self.install_bundle(package(content)?, revision, replace, expected_hash)
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
                || grants.len() != item.package.manifest.permissions.len()
                || grants.iter().collect::<HashSet<_>>().len() != grants.len()
                || grants
                    .iter()
                    .any(|grant| !item.package.manifest.permissions.contains(grant))
            {
                return Err(invalid(
                    "Confirm trust and all declared capabilities before enabling",
                ));
            }
        }
        item.enabled = enabled;
        item.granted_permissions = if enabled { grants } else { vec![] };
        let result = self.write(&mut registry)?;
        if !enabled {
            self.stop_id(id);
        }
        Ok(result)
    }
    pub fn uninstall(&self, id: &str, revision: i32) -> NativeResult<ExtensionSnapshot> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let mut registry = self.read()?;
        if registry.revision != revision {
            return Err(conflict());
        }
        let before = registry.extensions.len();
        registry
            .extensions
            .retain(|item| item.package.manifest.id != id);
        if registry.extensions.len() == before {
            return Err(NativeError::new(ErrorCode::NotFound, "Extension not found"));
        }
        let result = self.write(&mut registry)?;
        self.stop_id(id);
        self.cleanup(&registry);
        Ok(result)
    }
    pub fn cancel(&self, id: &str, owner: &str) {
        if let Ok(active) = self.0.active.lock()
            && let Some(run) = active
                .as_ref()
                .filter(|run| run.id == id && run.owner == owner)
        {
            run.stop.store(true, Ordering::Relaxed);
        }
    }
    #[cfg(test)]
    fn cancel_window(&self, label: &str) {
        if let Ok(active) = self.0.active.lock()
            && let Some(run) = active.as_ref().filter(|run| run.owner == label)
        {
            run.stop.store(true, Ordering::Relaxed);
        }
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
        // The same lock order as prepare makes closing and granting a lease atomic.
        let active = self
            .0
            .active
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
        if let Some(run) = active.as_ref().filter(|run| run.owner == label) {
            run.stop.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
    pub fn reopen_window(&self, label: &str) -> NativeResult<()> {
        let _active = self
            .0
            .active
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
    fn check_run_available(
        &self,
        active: &Option<ActiveRun>,
        token: &WindowRunToken,
    ) -> NativeResult<()> {
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
        if active.is_some() {
            return Err(NativeError::new(
                ErrorCode::ExtensionBusy,
                "Another extension is still running",
            ));
        }
        Ok(())
    }
    pub fn wait_window_stopped(&self, label: &str) {
        while self.0.active.lock().map_or(true, |active| {
            active.as_ref().is_some_and(|run| run.owner == label)
        }) {
            std::thread::sleep(std::time::Duration::from_millis(10));
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
        {
            let active = self
                .0
                .active
                .lock()
                .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
            self.check_run_available(&active, &token)?;
        }
        let module = self.asset(expected_hash)?;
        let module = read_binary(&module)?;
        if digest(&module) != expected_hash {
            return Err(NativeError::new(
                ErrorCode::StorageCorrupt,
                "Installed module changed; reinstall the trusted package",
            ));
        }
        let mut active = self
            .0
            .active
            .lock()
            .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
        self.check_run_available(&active, &token)?;
        let stop = Arc::new(AtomicBool::new(false));
        *active = Some(ActiveRun {
            id: id.into(),
            owner: token.owner,
            digest: expected_hash.into(),
            stop: stop.clone(),
        });
        Ok(PreparedRun {
            package: item.package.clone(),
            module,
            stop: stop.clone(),
            grants: item.granted_permissions.clone(),
            _lease: RunLease {
                store: self.clone(),
                stop,
            },
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
            store.prepare(id, hash).err().unwrap().code,
            ErrorCode::ExtensionBusy
        );
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
        for schema in [1, 99] {
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
                "/manifest/permissions",
                serde_json::json!(["text:read", "files:read"]),
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
        let payload = match item.package.manifest.input_format {
            ExtensionInputFormat::Text => input.into_bytes(),
            ExtensionInputFormat::Json
                if item.package.manifest.result_format == ExtensionResultFormat::View =>
            {
                serde_json::to_vec(&crate::extension_view::ExtensionViewRequest {
                    version: 1,
                    action: None,
                    state: String::new(),
                    fields: std::collections::BTreeMap::new(),
                    locale: "en".into(),
                })
                .unwrap()
            }
            ExtensionInputFormat::Json => serde_json::to_vec(&ExtensionRequest {
                api_version: 1,
                input_text: input,
                files: vec![ExtensionFile {
                    name: "sample.txt".into(),
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
        if item.package.manifest.result_format == ExtensionResultFormat::View {
            crate::extension_view::ExtensionView::parse(&output).unwrap();
        }
        drop(run);
        store
            .uninstall(&item.package.manifest.id, snapshot.revision)
            .unwrap();
        assert!(store.snapshot().unwrap().items.is_empty());
    }
}
