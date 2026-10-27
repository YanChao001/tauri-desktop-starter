//! 只归档精确认出的旧开发版，不迁移、不清除未知或未来数据。
use super::*;
use std::{fs::Metadata, path::Component};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionArchiveStatus {
    Legacy,
    Current,
    Future,
    Invalid,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionArchivePreview {
    pub status: ExtensionArchiveStatus,
    pub schema_version: Option<u32>,
    pub fingerprint: Option<String>,
    pub installed_count: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionArchiveResult {
    pub archive_path: String,
}

impl ExtensionArchivePreview {
    fn new(status: ExtensionArchiveStatus, schema_version: Option<u32>) -> Self {
        Self {
            status,
            schema_version,
            fingerprint: None,
            installed_count: 0,
        }
    }
}

// These DTOs only recognize an archive candidate. They never load or run an old module.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyRegistry {
    schema_version: u32,
    revision: i32,
    extensions: Vec<LegacyEntry>,
    #[serde(default, rename = "bundledInitialized")]
    _bundled_initialized: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyEntry {
    package: LegacyPackage,
    enabled: bool,
    granted_permissions: Vec<ExtensionPermission>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyPackage {
    manifest: LegacyManifest,
    sha256: String,
    bytes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyManifest {
    format_version: u32,
    api_version: u32,
    id: String,
    version: String,
    name: String,
    author: String,
    description: String,
    input_format: ExtensionInputFormat,
    result_format: ExtensionResultFormat,
    #[serde(default)]
    icon: Option<ExtensionIcon>,
    #[serde(default)]
    ui: Option<ExtensionUi>,
    commands: Vec<LegacyCommand>,
    permissions: Vec<ExtensionPermission>,
    #[serde(default)]
    allowed_hosts: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyCommand {
    id: String,
    title: String,
    function: String,
}

impl LegacyRegistry {
    fn valid(self) -> bool {
        if !matches!(self.schema_version, 1 | 2) || self.revision < 0 || self.extensions.len() > 24
        {
            return false;
        }
        let mut ids = HashSet::new();
        for entry in self.extensions {
            let old = entry.package.manifest;
            let old_permissions = &old.permissions;
            let grants: HashSet<_> = entry.granted_permissions.iter().collect();
            if old.format_version != self.schema_version
                || old.api_version != 1
                || !valid_digest(&entry.package.sha256)
                || entry.package.bytes == 0
                || entry.package.bytes as usize > BINARY_LIMIT
                || !ids.insert(old.id.clone())
                || old.commands.is_empty()
                || old.commands.len() > 8
                || old_permissions.iter().any(|permission| {
                    !matches!(
                        permission,
                        ExtensionPermission::TextRead
                            | ExtensionPermission::FilesRead
                            | ExtensionPermission::NetworkHttps
                    )
                })
                || grants.len() != entry.granted_permissions.len()
                || grants
                    .iter()
                    .any(|permission| !old_permissions.contains(permission))
                || (entry.enabled && grants.len() != old_permissions.len())
                || (!entry.enabled && !grants.is_empty())
                || old.allowed_hosts.len() > 2
                || old.allowed_hosts.iter().any(|host| {
                    !["httpbin.org", "jsonplaceholder.typicode.com"].contains(&host.as_str())
                })
            {
                return false;
            }
            let manifest = ExtensionManifest {
                format_version: 3,
                api_version: 2,
                min_host_version: env!("CARGO_PKG_VERSION").into(),
                id: old.id,
                version: old.version,
                name: old.name,
                author: old.author,
                description: old.description,
                commands: old
                    .commands
                    .into_iter()
                    .map(|command| ExtensionCommand {
                        id: command.id,
                        title: command.title,
                        function: command.function,
                        input_format: old.input_format,
                        result_format: old.result_format,
                        execution_budget: Default::default(),
                        ui: old.ui.clone(),
                        permissions: old.permissions.clone(),
                    })
                    .collect(),
                icon: old.icon,
                permissions: old.permissions,
                optional_permissions: vec![],
                network: old
                    .allowed_hosts
                    .into_iter()
                    .map(|host| ExtensionNetworkRule {
                        origin: format!("https://{host}"),
                        methods: vec!["GET".into()],
                    })
                    .collect(),
            };
            if manifest.validate_structure().is_err() {
                return false;
            }
        }
        true
    }
}

fn linked(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.is_symlink()
    }
}

fn real_ancestors(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        && path
            .ancestors()
            .all(|ancestor| match fs::symlink_metadata(ancestor) {
                Ok(metadata) => metadata.is_dir() && !linked(&metadata),
                Err(error) => error.kind() == std::io::ErrorKind::NotFound,
            })
}

fn real_directory(path: &Path) -> bool {
    real_ancestors(path) && fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir())
}

/// Inspect every archived entry without following links, with a bounded traversal.
fn real_tree(root: &Path) -> bool {
    real_directory(root)
        && walkdir::WalkDir::new(root)
            .follow_links(false)
            .max_depth(16)
            .into_iter()
            .take(4097)
            .enumerate()
            .all(|(index, entry)| {
                index < 4096
                    && entry.is_ok_and(|entry| {
                        entry.depth() < 16
                            && fs::symlink_metadata(entry.path()).is_ok_and(|metadata| {
                                !linked(&metadata) && (metadata.is_dir() || metadata.is_file())
                            })
                    })
            })
}

impl ExtensionStore {
    fn archive_unavailable(&self) -> bool {
        self.0.isolated
            || self.0.shutting_down.load(Ordering::SeqCst)
            || self.0.pauses.load(Ordering::SeqCst) > 0
    }

    fn inspect_archive(&self) -> NativeResult<ExtensionArchivePreview> {
        use ExtensionArchiveStatus::*;
        if self.archive_unavailable() {
            return Ok(ExtensionArchivePreview::new(Unavailable, None));
        }
        if !real_ancestors(&self.0.root) {
            return Ok(ExtensionArchivePreview::new(Invalid, None));
        }
        let path = self.0.root.join("registry.json");
        match fs::symlink_metadata(&self.0.root) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ExtensionArchivePreview::new(Current, Some(3)));
            }
            Err(error) => return Err(io("Cannot inspect extension archive source", error)),
            Ok(_) => {}
        }
        if !real_tree(&self.0.root) {
            return Ok(ExtensionArchivePreview::new(Invalid, None));
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ExtensionArchivePreview::new(Current, Some(3)));
            }
            Err(error) => return Err(io("Cannot inspect extension registry", error)),
        };
        if !metadata.is_file() || linked(&metadata) || metadata.len() > REGISTRY_LIMIT as u64 {
            return Ok(ExtensionArchivePreview::new(Invalid, None));
        }
        let mut bytes = Vec::new();
        fs::File::open(path)
            .and_then(|file| file.take(REGISTRY_LIMIT as u64 + 1).read_to_end(&mut bytes))
            .map_err(|error| io("Cannot read extension archive source", error))?;
        if bytes.len() > REGISTRY_LIMIT {
            return Ok(ExtensionArchivePreview::new(Invalid, None));
        }
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            return Ok(ExtensionArchivePreview::new(Invalid, None));
        };
        let schema = value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok());
        if schema.is_some_and(|schema| schema > 3) {
            return Ok(ExtensionArchivePreview::new(Future, schema));
        }
        if schema == Some(3) {
            return Ok(match self.read() {
                Ok(registry) => ExtensionArchivePreview {
                    installed_count: registry.extensions.len() as u32,
                    ..ExtensionArchivePreview::new(Current, schema)
                },
                Err(error) if error.code == ErrorCode::ExtensionIncompatible => {
                    ExtensionArchivePreview::new(Future, schema)
                }
                Err(_) => ExtensionArchivePreview::new(Invalid, schema),
            });
        }
        let count = value
            .get("extensions")
            .and_then(serde_json::Value::as_array)
            .map_or(0, Vec::len);
        if matches!(schema, Some(1 | 2))
            && serde_json::from_slice::<LegacyRegistry>(&bytes).is_ok_and(LegacyRegistry::valid)
        {
            return Ok(ExtensionArchivePreview {
                status: Legacy,
                schema_version: schema,
                fingerprint: Some(digest(&bytes)),
                installed_count: count as u32,
            });
        }
        Ok(ExtensionArchivePreview::new(Invalid, schema))
    }

    pub fn preview_archive(&self) -> NativeResult<ExtensionArchivePreview> {
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        self.inspect_archive()
    }

    pub fn archive_legacy(&self, expected_sha256: &str) -> NativeResult<ExtensionArchiveResult> {
        if !valid_digest(expected_sha256) {
            return Err(invalid("Invalid extension archive fingerprint"));
        }
        let _guard = self
            .0
            .writing
            .lock()
            .map_err(|_| io("Extension registry unavailable", "lock poisoned"))?;
        let runs = self
            .0
            .runs
            .lock()
            .map_err(|_| io("Extension execution unavailable", "lock poisoned"))?;
        if self.archive_unavailable() {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extension recovery is unavailable during startup recovery, pause or shutdown",
            ));
        }
        if !runs.is_empty() {
            return Err(NativeError::new(
                ErrorCode::ExtensionBusy,
                "Wait for extension execution to finish before archiving",
            ));
        }
        let preview = self.inspect_archive()?;
        if preview.status != ExtensionArchiveStatus::Legacy {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "Only recognized legacy development extensions can be archived",
            ));
        }
        if preview.fingerprint.as_deref() != Some(expected_sha256) {
            return Err(conflict());
        }
        let parent = self
            .0
            .root
            .parent()
            .filter(|parent| real_directory(parent))
            .ok_or_else(|| invalid("Invalid extension archive parent"))?;
        let container = tempfile::Builder::new()
            .prefix("extensions-archive-")
            .tempdir_in(parent)
            .map_err(|error| io("Cannot create extension archive location", error))?;
        let destination = container.path().join("extensions");
        if self.archive_unavailable() {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extension recovery was interrupted before archiving",
            ));
        }
        fs::rename(&self.0.root, &destination).map_err(|error| {
            io(
                "Cannot archive legacy extensions; original data kept",
                error,
            )
        })?;
        // Persist immediately after the rename; no later failure may remove the archive.
        let archive = container.keep().join("extensions");
        Ok(ExtensionArchiveResult {
            archive_path: archive.to_string_lossy().into_owned(),
        })
    }
}

#[cfg(test)]
#[path = "extension_recovery_tests.rs"]
mod tests;
