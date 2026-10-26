//! 扩展宿主 effect 调度、命名空间存储和只注入到指定来源的系统凭据。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extension_network::{self, check_cancelled},
    extension_storage::ExtensionStorageStore,
    extensions::{ExtensionManifest, ExtensionPermission, valid_id},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use specta::Type;
use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicBool},
    time::Instant,
};

pub use crate::{
    extension_network::{ExtensionHttpRequest, ExtensionHttpResponse},
    extension_storage::ExtensionStorageSnapshot,
};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionHostContext {
    pub permissions: Vec<ExtensionPermission>,
    pub storage: Option<ExtensionStorageSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ExtensionEffect {
    Http {
        id: String,
        request: ExtensionHttpRequest,
    },
    Storage {
        id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: i32,
        #[specta(type = BTreeMap<String, Option<crate::storage::JsonValue>>)]
        changes: BTreeMap<String, Option<Value>>,
    },
}
impl ExtensionEffect {
    pub fn id(&self) -> &str {
        match self {
            Self::Http { id, .. } | Self::Storage { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionEffectResult {
    pub id: String,
    #[specta(type = Option<crate::storage::JsonValue>)]
    pub value: Option<Value>,
    pub error: Option<NativeError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionCredentialSlot {
    pub origin: String,
    pub alias: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionStorageInfo {
    pub revision: i32,
    pub entries: u32,
    pub bytes: u32,
}

pub fn validate_effect_id(value: &str) -> NativeResult<()> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(invalid(
            "Extension effect ID must be an ASCII identifier of at most 80 bytes",
        ));
    }
    Ok(())
}
fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn credential_error(message: &str) -> NativeError {
    // 系统服务错误可能包含秘密或账户信息，不能拼接进入日志或 IPC。
    NativeError::new(ErrorCode::CredentialError, message)
}
fn credential_alias(alias: &str) -> NativeResult<()> {
    if alias.is_empty()
        || alias.len() > 64
        || !alias
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(invalid(
            "Credential alias must be an ASCII identifier of at most 64 bytes",
        ));
    }
    Ok(())
}
fn credential_origin(manifest: &ExtensionManifest, origin: &str) -> NativeResult<()> {
    if !valid_id(&manifest.id) {
        return Err(invalid("Invalid extension identity"));
    }
    let rule = manifest
        .network
        .iter()
        .find(|rule| rule.origin == origin)
        .ok_or_else(|| invalid("Credential origin must be declared by this extension"))?;
    rule.validate()?;
    Ok(())
}

trait Credentials: Send + Sync {
    fn set(&self, service: &str, account: &str, secret: &str) -> NativeResult<()>;
    fn get(&self, service: &str, account: &str) -> NativeResult<String>;
    fn delete(&self, service: &str, account: &str) -> NativeResult<()>;
}
struct OsCredentials;
fn entry(service: &str, account: &str) -> NativeResult<keyring::Entry> {
    if cfg!(feature = "e2e") {
        return Err(NativeError::new(
            ErrorCode::PlatformUnavailable,
            "Extension credentials are disabled in isolated E2E builds",
        ));
    }
    keyring::Entry::new(service, account)
        .map_err(|_| credential_error("Cannot access the system credential store"))
}
impl Credentials for OsCredentials {
    fn set(&self, service: &str, account: &str, secret: &str) -> NativeResult<()> {
        entry(service, account)?
            .set_password(secret)
            .map_err(|_| credential_error("Cannot store the extension credential"))
    }
    fn get(&self, service: &str, account: &str) -> NativeResult<String> {
        entry(service, account)?.get_password().map_err(|_| {
            credential_error("Extension credential is unavailable; configure it again")
        })
    }
    fn delete(&self, service: &str, account: &str) -> NativeResult<()> {
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(credential_error("Cannot delete the extension credential")),
        }
    }
}

struct HostInner {
    isolated: bool,
    service: String,
    storage: ExtensionStorageStore,
    credential_metadata: ExtensionStorageStore,
    credential_writing: Mutex<()>,
    credential_lookups: Arc<tokio::sync::Semaphore>,
    credentials: Arc<dyn Credentials>,
}

#[derive(Clone)]
pub struct ExtensionHostStore(Arc<HostInner>);

impl ExtensionHostStore {
    pub fn new(root: PathBuf, isolated: bool, credential_service: String) -> Self {
        Self::with_credentials(root, isolated, credential_service, Arc::new(OsCredentials))
    }
    fn with_credentials(
        root: PathBuf,
        isolated: bool,
        service: String,
        credentials: Arc<dyn Credentials>,
    ) -> Self {
        Self(Arc::new(HostInner {
            isolated,
            service: format!("{service}.extensions"),
            storage: ExtensionStorageStore::new(root.join("storage"), isolated),
            credential_metadata: ExtensionStorageStore::new(
                root.join("credential-slots"),
                isolated,
            ),
            credential_writing: Mutex::new(()),
            credential_lookups: Arc::new(tokio::sync::Semaphore::new(2)),
            credentials,
        }))
    }
    pub fn storage_snapshot(&self, id: &str) -> NativeResult<ExtensionStorageSnapshot> {
        self.0.storage.snapshot(id)
    }
    pub fn storage_patch(
        &self,
        id: &str,
        expected_revision: i32,
        changes: BTreeMap<String, Option<Value>>,
    ) -> NativeResult<ExtensionStorageSnapshot> {
        self.0.storage.patch(id, expected_revision, changes)
    }
    pub fn clear_storage(
        &self,
        id: &str,
        expected_revision: i32,
    ) -> NativeResult<ExtensionStorageSnapshot> {
        self.0.storage.clear(id, expected_revision)
    }
    pub fn storage_info(&self, id: &str) -> NativeResult<ExtensionStorageInfo> {
        let snapshot = self.storage_snapshot(id)?;
        let bytes = serde_json::to_vec(&snapshot.values)
            .map_err(|_| {
                NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "Cannot inspect extension storage",
                )
            })?
            .len();
        Ok(ExtensionStorageInfo {
            revision: snapshot.revision,
            entries: snapshot.values.len() as u32,
            bytes: bytes as u32,
        })
    }
    pub fn context(
        &self,
        manifest: &ExtensionManifest,
        grants: &[ExtensionPermission],
    ) -> NativeResult<ExtensionHostContext> {
        Ok(ExtensionHostContext {
            permissions: grants.to_vec(),
            storage: if manifest.has_permission(ExtensionPermission::Storage)
                && grants.contains(&ExtensionPermission::Storage)
            {
                Some(self.storage_snapshot(&manifest.id)?)
            } else {
                None
            },
        })
    }
    fn writable(&self) -> NativeResult<()> {
        if self.0.isolated {
            Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extension credentials are read-only during recovery isolation",
            ))
        } else {
            Ok(())
        }
    }
    fn account(id: &str, origin: &str, alias: &str) -> String {
        // identity、来源和别名均进入账户名；任何一项改变都不能复用另一凭据。
        format!(
            "extension:{id}:{:x}",
            Sha256::digest(format!("{origin}\0{alias}").as_bytes())
        )
    }
    fn read_slots(&self, id: &str) -> NativeResult<(i32, Vec<ExtensionCredentialSlot>)> {
        let snapshot = self.0.credential_metadata.snapshot(id)?;
        let invalid_metadata = || {
            NativeError::new(
                ErrorCode::StorageCorrupt,
                "Extension credential metadata is invalid; preserve it before recovery",
            )
        };
        if snapshot.values.keys().any(|key| key != "slots") {
            return Err(invalid_metadata());
        }
        let slots: Vec<ExtensionCredentialSlot> = snapshot
            .values
            .get("slots")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| invalid_metadata())?
            .unwrap_or_default();
        let mut unique = HashSet::new();
        if slots.len() > 32
            || slots.iter().any(|slot| {
                credential_alias(&slot.alias).is_err()
                    || slot.origin.len() > 2048
                    || url::Url::parse(&slot.origin).map_or(true, |url| {
                        !matches!(url.scheme(), "http" | "https")
                            || url.origin().ascii_serialization() != slot.origin
                    })
                    || !unique.insert((&slot.origin, &slot.alias))
            })
        {
            return Err(invalid_metadata());
        }
        Ok((snapshot.revision, slots))
    }
    fn write_slots(
        &self,
        id: &str,
        revision: i32,
        slots: &[ExtensionCredentialSlot],
    ) -> NativeResult<()> {
        let value = serde_json::to_value(slots)
            .map_err(|_| credential_error("Cannot prepare extension credential metadata"))?;
        self.0.credential_metadata.patch(
            id,
            revision,
            BTreeMap::from([("slots".to_owned(), Some(value))]),
        )?;
        Ok(())
    }
    pub fn credential_slots(
        &self,
        manifest: &ExtensionManifest,
    ) -> NativeResult<Vec<ExtensionCredentialSlot>> {
        let (_, slots) = self.read_slots(&manifest.id)?;
        Ok(slots)
    }
    pub fn set_credential(
        &self,
        manifest: &ExtensionManifest,
        origin: &str,
        alias: &str,
        value: &str,
    ) -> NativeResult<()> {
        self.writable()?;
        credential_origin(manifest, origin)?;
        credential_alias(alias)?;
        bounded_text(value, 8192, "Extension credential")?;
        if value.is_empty() || value.chars().any(char::is_control) {
            return Err(invalid(
                "Extension credential must be nonempty without control characters",
            ));
        }
        let _guard = self
            .0
            .credential_writing
            .lock()
            .map_err(|_| credential_error("Extension credential store is unavailable"))?;
        let (revision, mut slots) = self.read_slots(&manifest.id)?;
        let slot = ExtensionCredentialSlot {
            origin: origin.to_owned(),
            alias: alias.to_owned(),
        };
        let existing = slots.contains(&slot);
        if !existing && slots.len() >= 32 {
            return Err(invalid(
                "An extension can configure at most 32 credential aliases",
            ));
        }
        let account = Self::account(&manifest.id, origin, alias);
        if !existing {
            slots.push(slot);
            slots.sort_by(|left, right| {
                (&left.origin, &left.alias).cmp(&(&right.origin, &right.alias))
            });
            // 先登记再写系统服务，退出或系统写入失败时仍能枚举、重试和清理。
            self.write_slots(&manifest.id, revision, &slots)?;
        }
        self.0.credentials.set(&self.0.service, &account, value)
    }
    pub fn delete_credential(
        &self,
        manifest: &ExtensionManifest,
        origin: &str,
        alias: &str,
    ) -> NativeResult<()> {
        self.writable()?;
        credential_alias(alias)?;
        if !valid_id(&manifest.id) {
            return Err(invalid("Invalid extension identity"));
        }
        let _guard = self
            .0
            .credential_writing
            .lock()
            .map_err(|_| credential_error("Extension credential store is unavailable"))?;
        let (revision, mut slots) = self.read_slots(&manifest.id)?;
        // 升级移除来源后，用户仍可删除已登记的旧凭据；禁止创建或使用该来源。
        let Some(index) = slots
            .iter()
            .position(|slot| slot.origin == origin && slot.alias == alias)
        else {
            return Err(NativeError::new(
                ErrorCode::NotFound,
                "Extension credential alias was not configured",
            ));
        };
        self.0
            .credentials
            .delete(&self.0.service, &Self::account(&manifest.id, origin, alias))?;
        slots.remove(index);
        self.write_slots(&manifest.id, revision, &slots)
    }

    /// 卸载或来源变更前清除所有已登记凭据，包括新清单不再声明的来源。
    /// 部分系统删除失败时保留完整元数据，重试可继续删除，不能宣称清理成功。
    pub fn clear_credentials(&self, manifest: &ExtensionManifest) -> NativeResult<()> {
        self.writable()?;
        if !valid_id(&manifest.id) {
            return Err(invalid("Invalid extension identity"));
        }
        let _guard = self
            .0
            .credential_writing
            .lock()
            .map_err(|_| credential_error("Extension credential store is unavailable"))?;
        let (revision, slots) = self.read_slots(&manifest.id)?;
        if slots.is_empty() {
            return Ok(());
        }
        for slot in &slots {
            self.0.credentials.delete(
                &self.0.service,
                &Self::account(&manifest.id, &slot.origin, &slot.alias),
            )?;
        }
        self.write_slots(&manifest.id, revision, &[])
    }
    fn credential_value(
        &self,
        manifest: &ExtensionManifest,
        origin: &str,
        alias: &str,
    ) -> NativeResult<String> {
        credential_origin(manifest, origin)?;
        credential_alias(alias)?;
        let _guard = self
            .0
            .credential_writing
            .lock()
            .map_err(|_| credential_error("Extension credential store is unavailable"))?;
        let (_, slots) = self.read_slots(&manifest.id)?;
        if !slots
            .iter()
            .any(|slot| slot.origin == origin && slot.alias == alias)
        {
            return Err(credential_error(
                "Configure this credential alias for the requested extension and origin first",
            ));
        }
        self.0
            .credentials
            .get(&self.0.service, &Self::account(&manifest.id, origin, alias))
    }

    pub async fn execute_effect(
        &self,
        manifest: &ExtensionManifest,
        grants: &[ExtensionPermission],
        effect: ExtensionEffect,
        stop: Arc<AtomicBool>,
    ) -> ExtensionEffectResult {
        let id = effect.id().to_owned();
        let result = async {
            validate_effect_id(&id)?;
            check_cancelled(&stop)?;
            if !valid_id(&manifest.id) {
                return Err(invalid("Invalid extension identity"));
            }
            match effect {
                ExtensionEffect::Http { request, .. } => {
                    let deadline = Instant::now() + extension_network::HTTP_TIMEOUT;
                    let validated =
                        extension_network::validate_request(manifest, grants, &request)?;
                    let credential = match request.credential {
                        Some(alias) => {
                            let host = self.clone();
                            let manifest = manifest.clone();
                            let origin = validated.origin.clone();
                            let workers = self.0.credential_lookups.clone();
                            let cancellation = stop.clone();
                            Some(
                                extension_network::cancellable(&stop, deadline, async move {
                                    let permit = workers.acquire_owned().await.map_err(|_| {
                                        credential_error(
                                            "Extension credential lookup is unavailable",
                                        )
                                    })?;
                                    blocking::run(move || {
                                        // 系统凭据服务不可强制中断；取消后的实际调用仍保留容量。
                                        let _permit = permit;
                                        check_cancelled(&cancellation)?;
                                        host.credential_value(&manifest, &origin, &alias)
                                    })
                                    .await
                                })
                                .await?,
                            )
                        }
                        None => None,
                    };
                    let response = extension_network::fetch(
                        validated,
                        request.body,
                        credential,
                        stop,
                        deadline,
                    )
                    .await?;
                    serde_json::to_value(response).map_err(|_| {
                        NativeError::new(ErrorCode::Internal, "Cannot encode extension HTTP result")
                    })
                }
                ExtensionEffect::Storage {
                    expected_revision,
                    changes,
                    ..
                } => {
                    if !manifest.has_permission(ExtensionPermission::Storage)
                        || !grants.contains(&ExtensionPermission::Storage)
                    {
                        return Err(invalid("Extension storage access was not granted"));
                    }
                    let host = self.clone();
                    let extension_id = manifest.id.clone();
                    blocking::run(move || {
                        check_cancelled(&stop)?;
                        let snapshot = host.0.storage.patch_with_stop(
                            &extension_id,
                            expected_revision,
                            changes,
                            &stop,
                        )?;
                        // 成功落盘后的取消不冒充回滚；返回已提交的 revision。
                        serde_json::to_value(snapshot).map_err(|_| {
                            NativeError::new(
                                ErrorCode::Internal,
                                "Cannot encode extension storage result",
                            )
                        })
                    })
                    .await
                }
            }
        }
        .await;
        match result {
            Ok(value) => ExtensionEffectResult {
                id,
                value: Some(value),
                error: None,
            },
            Err(error) => ExtensionEffectResult {
                id,
                value: None,
                error: Some(error),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MemoryCredentials(Mutex<BTreeMap<(String, String), String>>);
    impl Credentials for MemoryCredentials {
        fn set(&self, service: &str, account: &str, secret: &str) -> NativeResult<()> {
            self.0
                .lock()
                .unwrap()
                .insert((service.to_owned(), account.to_owned()), secret.to_owned());
            Ok(())
        }
        fn get(&self, service: &str, account: &str) -> NativeResult<String> {
            self.0
                .lock()
                .unwrap()
                .get(&(service.to_owned(), account.to_owned()))
                .cloned()
                .ok_or_else(|| credential_error("Missing test credential"))
        }
        fn delete(&self, service: &str, account: &str) -> NativeResult<()> {
            self.0
                .lock()
                .unwrap()
                .remove(&(service.to_owned(), account.to_owned()));
            Ok(())
        }
    }
    fn manifest(id: &str) -> ExtensionManifest {
        serde_json::from_value(serde_json::json!({"formatVersion":3,"apiVersion":2,"minHostVersion":"0.1.4",
            "id":id,"version":"1.0.0","name":"Host test","author":"Tests","description":"Host effects test",
            "commands":[{"id":"main","title":"Main","function":"main","inputFormat":"json","resultFormat":"view","permissions":[]}],
            "permissions":[],"optionalPermissions":["storage","network:https"],
            "network":[{"origin":"https://example.com","methods":["GET","POST"]}, {"origin":"https://other.example","methods":["GET"]}]
        })).unwrap()
    }
    #[test]
    fn credentials_are_isolated_and_only_metadata_is_written_to_disk() {
        let temp = crate::extension_paths::temporary_directory();
        let backend = Arc::new(MemoryCredentials::default());
        let host = ExtensionHostStore::with_credentials(
            temp.path().to_owned(),
            false,
            "test.service".to_owned(),
            backend,
        );
        let first = manifest("tests.first");
        let second = manifest("tests.second");
        host.set_credential(
            &first,
            "https://example.com",
            "primary",
            "secret-test-value",
        )
        .unwrap();
        assert_eq!(
            host.credential_value(&first, "https://example.com", "primary")
                .unwrap(),
            "secret-test-value"
        );
        assert!(
            host.credential_value(&second, "https://example.com", "primary")
                .is_err()
        );
        assert!(
            host.credential_value(&first, "https://other.example", "primary")
                .is_err()
        );
        assert!(
            host.credential_value(&first, "https://example.com", "other")
                .is_err()
        );
        assert!(
            host.set_credential(&first, "https://undeclared.example", "primary", "value")
                .is_err()
        );
        for file in std::fs::read_dir(temp.path().join("credential-slots")).unwrap() {
            assert!(
                !std::fs::read_to_string(file.unwrap().path())
                    .unwrap()
                    .contains("secret-test-value")
            );
        }
        host.delete_credential(&first, "https://example.com", "primary")
            .unwrap();
        assert!(host.credential_slots(&first).unwrap().is_empty());
        assert!(
            host.credential_value(&first, "https://example.com", "primary")
                .is_err()
        );
    }
    #[test]
    fn removed_origins_allow_cleanup_but_never_credential_reuse() {
        let temp = crate::extension_paths::temporary_directory();
        let host = ExtensionHostStore::with_credentials(
            temp.path().to_owned(),
            false,
            "test.service".to_owned(),
            Arc::new(MemoryCredentials::default()),
        );
        let mut manifest = manifest("tests.first");
        host.set_credential(&manifest, "https://example.com", "primary", "secret")
            .unwrap();
        manifest.network.clear();
        assert!(
            host.credential_value(&manifest, "https://example.com", "primary")
                .is_err()
        );
        host.delete_credential(&manifest, "https://example.com", "primary")
            .unwrap();
    }
    #[test]
    fn recovery_isolation_denies_credentials_before_accessing_system_store() {
        let temp = crate::extension_paths::temporary_directory();
        let host = ExtensionHostStore::new(temp.path().to_owned(), true, "test.service".to_owned());
        assert_eq!(
            host.set_credential(
                &manifest("tests.first"),
                "https://example.com",
                "primary",
                "secret"
            )
            .unwrap_err()
            .code,
            ErrorCode::ExtensionUnavailable
        );
    }

    #[test]
    fn storage_effects_require_grants_and_report_conflicts_with_the_effect_id() {
        tauri::async_runtime::block_on(async {
            let temp = crate::extension_paths::temporary_directory();
            let host =
                ExtensionHostStore::new(temp.path().to_owned(), false, "test.service".to_owned());
            let manifest = manifest("tests.first");
            let effect = || ExtensionEffect::Storage {
                id: "save-note".to_owned(),
                expected_revision: 0,
                changes: BTreeMap::from([(
                    "note".to_owned(),
                    Some(serde_json::json!({"body":"saved"})),
                )]),
            };
            let denied = host
                .execute_effect(&manifest, &[], effect(), Arc::new(AtomicBool::new(false)))
                .await;
            assert_eq!(denied.id, "save-note");
            assert_eq!(denied.error.unwrap().code, ErrorCode::InvalidArgument);
            assert!(
                host.storage_snapshot(&manifest.id)
                    .unwrap()
                    .values
                    .is_empty()
            );
            let saved = host
                .execute_effect(
                    &manifest,
                    &[ExtensionPermission::Storage],
                    effect(),
                    Arc::new(AtomicBool::new(false)),
                )
                .await;
            assert!(saved.error.is_none());
            assert_eq!(saved.value.unwrap()["revision"], 1);
            let conflict = host
                .execute_effect(
                    &manifest,
                    &[ExtensionPermission::Storage],
                    effect(),
                    Arc::new(AtomicBool::new(false)),
                )
                .await;
            assert_eq!(conflict.id, "save-note");
            assert_eq!(conflict.error.unwrap().code, ErrorCode::Conflict);
            assert_eq!(
                host.context(&manifest, &[ExtensionPermission::Storage])
                    .unwrap()
                    .storage
                    .unwrap()
                    .revision,
                1
            );
            assert!(host.context(&manifest, &[]).unwrap().storage.is_none());
        });
    }

    #[test]
    fn stopped_effects_do_not_commit_storage() {
        tauri::async_runtime::block_on(async {
            let temp = crate::extension_paths::temporary_directory();
            let host =
                ExtensionHostStore::new(temp.path().to_owned(), false, "test.service".to_owned());
            let manifest = manifest("tests.first");
            let effect = ExtensionEffect::Storage {
                id: "save-note".to_owned(),
                expected_revision: 0,
                changes: BTreeMap::from([("note".to_owned(), Some(Value::Bool(true)))]),
            };
            let result = host
                .execute_effect(
                    &manifest,
                    &[ExtensionPermission::Storage],
                    effect,
                    Arc::new(AtomicBool::new(true)),
                )
                .await;
            assert_eq!(result.error.unwrap().code, ErrorCode::UserCancelled);
            assert_eq!(host.storage_snapshot(&manifest.id).unwrap().revision, 0);
            assert!(!temp.path().join("storage").exists());
        });
    }

    #[test]
    fn uninstall_cleanup_clears_all_credential_origins_before_forgetting_metadata() {
        let temp = crate::extension_paths::temporary_directory();
        let backend = Arc::new(MemoryCredentials::default());
        let host = ExtensionHostStore::with_credentials(
            temp.path().to_owned(),
            false,
            "test.service".to_owned(),
            backend.clone(),
        );
        let mut manifest = manifest("tests.first");
        host.set_credential(&manifest, "https://example.com", "primary", "first-secret")
            .unwrap();
        host.set_credential(
            &manifest,
            "https://other.example",
            "secondary",
            "second-secret",
        )
        .unwrap();
        manifest.network.clear();
        host.clear_credentials(&manifest).unwrap();
        assert!(backend.0.lock().unwrap().is_empty());
        assert!(host.credential_slots(&manifest).unwrap().is_empty());
        host.clear_credentials(&manifest).unwrap();
    }

    #[test]
    fn failed_system_cleanup_preserves_alias_metadata_for_retry() {
        struct FailingDelete(MemoryCredentials);
        impl Credentials for FailingDelete {
            fn set(&self, service: &str, account: &str, secret: &str) -> NativeResult<()> {
                self.0.set(service, account, secret)
            }
            fn get(&self, service: &str, account: &str) -> NativeResult<String> {
                self.0.get(service, account)
            }
            fn delete(&self, _service: &str, _account: &str) -> NativeResult<()> {
                Err(credential_error("System credential deletion failed"))
            }
        }
        let temp = crate::extension_paths::temporary_directory();
        let host = ExtensionHostStore::with_credentials(
            temp.path().to_owned(),
            false,
            "test.service".to_owned(),
            Arc::new(FailingDelete(MemoryCredentials::default())),
        );
        let manifest = manifest("tests.first");
        host.set_credential(&manifest, "https://example.com", "primary", "secret")
            .unwrap();
        assert_eq!(
            host.clear_credentials(&manifest).unwrap_err().code,
            ErrorCode::CredentialError
        );
        assert_eq!(host.credential_slots(&manifest).unwrap().len(), 1);
    }

    #[test]
    fn failed_system_writes_preserve_a_registered_alias_for_cleanup_and_retry() {
        struct FailingSet;
        impl Credentials for FailingSet {
            fn set(&self, _service: &str, _account: &str, _secret: &str) -> NativeResult<()> {
                Err(credential_error("System credential write failed"))
            }
            fn get(&self, _service: &str, _account: &str) -> NativeResult<String> {
                Err(credential_error("Missing credential"))
            }
            fn delete(&self, _service: &str, _account: &str) -> NativeResult<()> {
                Ok(())
            }
        }
        let temp = crate::extension_paths::temporary_directory();
        let host = ExtensionHostStore::with_credentials(
            temp.path().to_owned(),
            false,
            "test.service".to_owned(),
            Arc::new(FailingSet),
        );
        let manifest = manifest("tests.first");
        assert_eq!(
            host.set_credential(&manifest, "https://example.com", "primary", "secret")
                .unwrap_err()
                .code,
            ErrorCode::CredentialError
        );
        assert_eq!(host.credential_slots(&manifest).unwrap().len(), 1);
        host.clear_credentials(&manifest).unwrap();
        assert!(host.credential_slots(&manifest).unwrap().is_empty());
    }
}
