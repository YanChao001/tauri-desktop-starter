use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
#[cfg(not(feature = "e2e"))]
use tauri::Manager;

use crate::{
    error::{ErrorCode, NativeError, NativeResult},
    network::NetworkMode,
};

pub const SETTINGS_EVENT: &str = "app://settings-changed";
pub(crate) const SETTINGS_SCHEMA_VERSION: u32 = 6;
const MAX_SETTINGS_SIZE: usize = 128 * 1024;
pub(crate) const MAX_SETTINGS_FILE_SIZE: usize = MAX_SETTINGS_SIZE + 1024;
const MAX_BACKGROUND_DATA_LENGTH: usize = 96 * 1024;

/// 具名递归类型使 Rust 与 TypeScript 的 JSON 契约保持有限定义。
/// serde_json::Number 保留传输过程中的整数值。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum JsonValue {
    Null(()),
    Boolean(bool),
    Number(#[specta(type = f64)] serde_json::Number),
    String(String),
    Array(Vec<JsonValue>),
    Object(std::collections::BTreeMap<String, JsonValue>),
}

#[derive(Clone)]
pub struct DataPaths {
    pub config: PathBuf,
    pub data: PathBuf,
    pub logs: PathBuf,
}

impl DataPaths {
    pub fn resolve(app: &tauri::AppHandle) -> NativeResult<Self> {
        #[cfg(feature = "e2e")]
        {
            if !app.config().identifier.ends_with(".e2e") {
                return Err(NativeError::new(
                    ErrorCode::InvalidArgument,
                    "E2E builds require a separate .e2e application identifier",
                ));
            }
            let root = std::env::var_os("STARTER_TEST_DATA_DIR")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute() && path.parent().is_some())
                .ok_or_else(|| {
                    NativeError::new(
                        ErrorCode::InvalidArgument,
                        "STARTER_TEST_DATA_DIR must be an absolute test directory",
                    )
                })?;
            let paths = Self {
                config: root.join("config"),
                data: root.join("data"),
                logs: root.join("logs"),
            };
            Ok(paths)
        }
        #[cfg(not(feature = "e2e"))]
        {
            let paths = Self {
                config: app.path().app_config_dir().map_err(|e| {
                    NativeError::operation(
                        ErrorCode::StorageIo,
                        "Cannot locate configuration directory",
                        e,
                    )
                })?,
                data: app.path().app_data_dir().map_err(|e| {
                    NativeError::operation(
                        ErrorCode::StorageIo,
                        "Cannot locate application data directory",
                        e,
                    )
                })?,
                logs: app.path().app_log_dir().map_err(|e| {
                    NativeError::operation(ErrorCode::StorageIo, "Cannot locate log directory", e)
                })?,
            };
            Ok(paths)
        }
    }
}

pub fn atomic_write(path: &Path, contents: &[u8]) -> NativeResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| NativeError::new(ErrorCode::StorageIo, "Invalid storage path"))?;
    fs::create_dir_all(parent).map_err(|e| {
        NativeError::operation(ErrorCode::StorageIo, "Cannot create storage directory", e)
    })?;
    // tempfile 的 Windows persist 直接调用 Win32；临时文件和目标都使用扩展路径，
    // 避免深层缓存目录在 MoveFileExW 阶段触发传统 MAX_PATH 限制。
    #[cfg(windows)]
    let path = {
        let name = path
            .file_name()
            .ok_or_else(|| NativeError::new(ErrorCode::StorageIo, "Invalid storage path"))?;
        fs::canonicalize(if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        })
        .map_err(|e| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot resolve storage directory", e)
        })?
        .join(name)
    };
    #[cfg(windows)]
    let parent = path
        .parent()
        .ok_or_else(|| NativeError::new(ErrorCode::StorageIo, "Invalid storage path"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| {
        NativeError::operation(
            ErrorCode::StorageIo,
            "Cannot create temporary settings file",
            e,
        )
    })?;
    temporary
        .write_all(contents)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|e| NativeError::operation(ErrorCode::StorageIo, "Cannot write settings", e))?;
    temporary.persist(path).map_err(|e| {
        NativeError::operation(ErrorCode::StorageIo, "Cannot replace settings file", e)
    })?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub revision: i32,
    #[specta(type = JsonValue)]
    pub settings: Value,
}

pub struct SettingsStore {
    path: PathBuf,
    writing: Mutex<()>,
    inner: Mutex<SettingsSnapshot>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum WindowPosition {
    #[default]
    Remember,
    Center,
}

pub(crate) fn validate_custom_background(value: &Value) -> NativeResult<()> {
    if value.is_null() {
        return Ok(());
    }
    let invalid = || {
        NativeError::new(
            ErrorCode::InvalidArgument,
            "Invalid custom background image",
        )
    };
    let image = value.as_object().ok_or_else(invalid)?;
    if let Some(video) = image.get("video").filter(|value| !value.is_null()) {
        let video: crate::wallpapers::WallpaperVideo =
            serde_json::from_value(video.clone()).map_err(|_| invalid())?;
        if !video.valid() {
            return Err(invalid());
        }
    }
    let name = image
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if name.trim().is_empty()
        || name.chars().count() > 120
        || name.chars().any(char::is_control)
        || image
            .get("fit")
            .is_some_and(|fit| !matches!(fit.as_str(), Some("cover" | "contain")))
    {
        return Err(invalid());
    }
    let data_url = image
        .get("dataUrl")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if data_url.len() > MAX_BACKGROUND_DATA_LENGTH {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Custom background image exceeds the supported size",
        ));
    }
    let (encoded, webp) = data_url
        .strip_prefix("data:image/webp;base64,")
        .map(|encoded| (encoded, true))
        .or_else(|| {
            data_url
                .strip_prefix("data:image/jpeg;base64,")
                .map(|encoded| (encoded, false))
        })
        .ok_or_else(invalid)?;
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
    let valid_header = if webp {
        bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
    } else {
        bytes.starts_with(&[0xff, 0xd8, 0xff])
    };
    if !valid_header {
        return Err(invalid());
    }
    Ok(())
}

pub(crate) fn future_settings_schema(settings: &Value) -> bool {
    settings
        .get("schemaVersion")
        .and_then(Value::as_f64)
        .is_some_and(|version| version > f64::from(SETTINGS_SCHEMA_VERSION))
}

pub(crate) fn validate_settings(settings: &Value) -> NativeResult<()> {
    let object = settings.as_object().ok_or_else(|| {
        NativeError::new(ErrorCode::InvalidArgument, "Settings must be a JSON object")
    })?;
    if object.len() > 100
        || serde_json::to_vec(settings).map_or(true, |bytes| bytes.len() > MAX_SETTINGS_SIZE)
    {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Settings exceed the supported size",
        ));
    }
    // 未来结构可能改变原生偏好的类型；保留原值供前端执行只读保护。
    let future_schema = future_settings_schema(settings);
    if !future_schema
        && object
            .get("runInBackground")
            .is_some_and(|value| !value.is_boolean())
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "runInBackground must be a boolean",
        ));
    }
    if !future_schema && let Some(image) = object.get("customBackground") {
        validate_custom_background(image)?;
    }
    if !future_schema
        && object
            .get("windowPosition")
            .is_some_and(|value| !matches!(value.as_str(), Some("remember" | "center")))
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "windowPosition must be remember or center",
        ));
    }
    if !future_schema
        && object
            .get("networkMode")
            .is_some_and(|value| !matches!(value.as_str(), Some("system" | "direct")))
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "networkMode must be system or direct",
        ));
    }
    fn depth(value: &Value, current: usize) -> bool {
        current <= 16
            && match value {
                Value::Array(values) => values.iter().all(|value| depth(value, current + 1)),
                Value::Object(values) => values.values().all(|value| depth(value, current + 1)),
                _ => true,
            }
    }
    if !depth(settings, 0) {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Settings are nested too deeply",
        ));
    }
    Ok(())
}

impl SettingsStore {
    pub fn open(path: PathBuf) -> NativeResult<Self> {
        let snapshot = match read_settings_file(&path) {
            Ok(bytes) => {
                if bytes.len() > MAX_SETTINGS_FILE_SIZE {
                    return Err(NativeError::new(
                        ErrorCode::StorageCorrupt,
                        "Settings file exceeds the supported size",
                    ));
                }
                let document = serde_json::from_slice::<Value>(&bytes).ok();
                let future_schema = document
                    .as_ref()
                    .and_then(|value| value.get("settings"))
                    .is_some_and(future_settings_schema);
                let decoded = document
                    .and_then(|value| serde_json::from_value::<SettingsSnapshot>(value).ok())
                    .filter(|snapshot| {
                        snapshot.revision >= 0 && validate_settings(&snapshot.settings).is_ok()
                    });
                if let Some(snapshot) = decoded {
                    snapshot
                } else if future_schema {
                    return Err(NativeError::new(
                        ErrorCode::StorageCorrupt,
                        "Unsupported future settings must not be replaced",
                    ));
                } else {
                    let parent = path.parent().ok_or_else(|| {
                        NativeError::new(ErrorCode::StorageIo, "Invalid settings directory")
                    })?;
                    let mut backup = tempfile::Builder::new()
                        .prefix("settings-corrupt-")
                        .suffix(".json")
                        .tempfile_in(parent)
                        .map_err(|e| {
                            NativeError::operation(
                                ErrorCode::StorageIo,
                                "Cannot preserve invalid settings",
                                e,
                            )
                        })?;
                    backup
                        .write_all(&bytes)
                        .and_then(|()| backup.as_file().sync_all())
                        .map_err(|e| {
                            NativeError::operation(
                                ErrorCode::StorageIo,
                                "Cannot back up invalid settings",
                                e,
                            )
                        })?;
                    let (_, backup_path) = backup.keep().map_err(|e| {
                        NativeError::operation(
                            ErrorCode::StorageIo,
                            "Cannot retain invalid settings backup",
                            e,
                        )
                    })?;
                    let defaults = SettingsSnapshot {
                        revision: 0,
                        settings: json!({}),
                    };
                    let serialized = serde_json::to_vec_pretty(&defaults).map_err(|e| {
                        NativeError::operation(
                            ErrorCode::StorageIo,
                            "Cannot serialize default settings",
                            e,
                        )
                    })?;
                    atomic_write(&path, &serialized)?;
                    log::warn!(
                        "Recovered invalid preferences; original data preserved at {}",
                        backup_path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    );
                    defaults
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => SettingsSnapshot {
                revision: 0,
                settings: json!({}),
            },
            Err(error) => {
                return Err(NativeError::operation(
                    ErrorCode::StorageIo,
                    "Cannot read settings",
                    error,
                ));
            }
        };
        Ok(Self {
            path,
            writing: Mutex::new(()),
            inner: Mutex::new(snapshot),
        })
    }

    pub fn snapshot(&self) -> NativeResult<SettingsSnapshot> {
        self.inner
            .lock()
            .map(|value| value.clone())
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Settings lock is unavailable"))
    }

    /// 清理媒体前核对持久存档；曾被隔离的损坏副本可能仍持有唯一引用。
    pub(crate) fn wallpaper_media_cleanup_settings(&self) -> NativeResult<Value> {
        let snapshot = self.snapshot()?;
        if future_settings_schema(&snapshot.settings) {
            return Err(NativeError::new(
                ErrorCode::StorageCorrupt,
                "Future settings prevent media cleanup",
            ));
        }
        if let Some(parent) = self.path.parent() {
            for entry in fs::read_dir(parent).map_err(|error| {
                NativeError::operation(
                    ErrorCode::StorageIo,
                    "Cannot inspect settings directory",
                    error,
                )
            })? {
                let entry = entry.map_err(|error| {
                    NativeError::operation(
                        ErrorCode::StorageIo,
                        "Cannot inspect settings directory",
                        error,
                    )
                })?;
                if entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings-corrupt-")
                {
                    return Err(NativeError::new(
                        ErrorCode::StorageCorrupt,
                        "Preserved settings prevent media cleanup",
                    ));
                }
            }
        }
        match read_settings_file(&self.path) {
            Ok(bytes) => {
                let saved: SettingsSnapshot = serde_json::from_slice(&bytes).map_err(|_| {
                    NativeError::new(
                        ErrorCode::StorageCorrupt,
                        "Invalid settings prevent media cleanup",
                    )
                })?;
                validate_settings(&saved.settings)?;
                if future_settings_schema(&saved.settings) {
                    return Err(NativeError::new(
                        ErrorCode::StorageCorrupt,
                        "Future settings prevent media cleanup",
                    ));
                }
                Ok(saved.settings)
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && snapshot.revision == 0 =>
            {
                Ok(snapshot.settings)
            }
            Err(error) => Err(NativeError::operation(
                ErrorCode::StorageIo,
                "Cannot read settings for media cleanup",
                error,
            )),
        }
    }

    pub fn save(&self, settings: Value, expected_revision: i32) -> NativeResult<SettingsSnapshot> {
        self.save_and(settings, expected_revision, || ())
            .map(|(snapshot, ())| snapshot)
    }

    /// 仅供用户明确重置使用；允许替换未来结构，仍保留版本冲突与原子写入。
    pub fn reset(&self, settings: Value, expected_revision: i32) -> NativeResult<SettingsSnapshot> {
        self.write_and(settings, expected_revision, true, || ())
            .map(|(snapshot, ())| snapshot)
    }

    /// 成功保存后仍持写锁执行后续存储操作；回调可读上次完成的快照，但不得重入保存。
    /// 回调结果单独返回，失败不能隐藏已经提交、需要广播的新设置快照。
    pub(crate) fn save_and<T>(
        &self,
        settings: Value,
        expected_revision: i32,
        after_save: impl FnOnce() -> T,
    ) -> NativeResult<(SettingsSnapshot, T)> {
        self.write_and(settings, expected_revision, false, after_save)
    }

    fn write_and<T>(
        &self,
        settings: Value,
        expected_revision: i32,
        reset: bool,
        after_save: impl FnOnce() -> T,
    ) -> NativeResult<(SettingsSnapshot, T)> {
        validate_settings(&settings)?;
        // 串行执行持久化写入，但不持有快照锁
        // fsync 期间窗口事件仍可读取最后一次已提交的偏好设置
        let _writing = self
            .writing
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Settings writer is unavailable"))?;
        let revision = {
            let state = self.inner.lock().map_err(|_| {
                NativeError::new(ErrorCode::Internal, "Settings lock is unavailable")
            })?;
            // 原生提交也须保留未来存档，不能只依赖前端的只读状态。
            if !reset && future_settings_schema(&state.settings) {
                return Err(NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "Settings from a newer application must not be overwritten",
                ));
            }
            if state.revision != expected_revision {
                return Err(NativeError {
                    code: ErrorCode::SettingsConflict,
                    message: "Settings changed in another window; reload before saving".into(),
                    retryable: true,
                });
            }
            state.revision.checked_add(1).ok_or_else(|| {
                NativeError::new(ErrorCode::StorageIo, "Settings revision limit reached")
            })?
        };
        let next = SettingsSnapshot { revision, settings };
        // 与 validate_settings 使用相同的紧凑表示
        // 避免合法快照因格式缩进而超过读取大小限制
        let bytes = serde_json::to_vec(&next).map_err(|e| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot serialize settings", e)
        })?;
        atomic_write(&self.path, &bytes)?;
        let result = after_save();
        // 后续存储完成后才发布新 revision，避免读者据此保存仍待删除的图片。
        *self
            .inner
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Settings lock is unavailable"))? =
            next.clone();
        Ok((next, result))
    }

    pub fn run_in_background(&self) -> bool {
        self.snapshot()
            .ok()
            .and_then(|state| {
                state
                    .settings
                    .get("runInBackground")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false)
    }

    pub fn network_mode(&self) -> NativeResult<NetworkMode> {
        let state = self
            .inner
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Settings lock is unavailable"))?;
        Ok(
            match state.settings.get("networkMode").and_then(Value::as_str) {
                Some("direct") => NetworkMode::Direct,
                _ => NetworkMode::System,
            },
        )
    }

    pub fn window_position(&self) -> WindowPosition {
        self.inner
            .lock()
            .map_or(WindowPosition::default(), |state| {
                if state.settings.get("windowPosition").and_then(Value::as_str) == Some("center") {
                    WindowPosition::Center
                } else {
                    WindowPosition::Remember
                }
            })
    }
}

fn read_settings_file(path: &Path) -> std::io::Result<Vec<u8>> {
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take((MAX_SETTINGS_FILE_SIZE + 1) as u64)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn atomic_write_replaces_long_windows_paths_without_changing_system_settings() {
        use std::os::windows::ffi::OsStrExt;

        let directory = tempfile::tempdir().unwrap();
        let raw = directory.path().to_string_lossy();
        let mut parent = PathBuf::from(raw.trim_start_matches(r"\\?\"));
        while parent.as_os_str().encode_wide().count() < 230 {
            parent.push("nested-attachment-cache");
        }
        let path = parent.join("f".repeat(64));
        assert!(!path.to_string_lossy().starts_with(r"\\?\"));
        assert!(path.as_os_str().encode_wide().count() > 260);

        atomic_write(&path, b"original attachment").unwrap();
        atomic_write(&path, b"replacement attachment").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement attachment");
        assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
    }

    #[test]
    fn fractional_future_schema_versions_keep_the_future_version_guard() {
        assert!(!future_settings_schema(&json!({"schemaVersion": 3})));
        assert!(!future_settings_schema(
            &json!({"schemaVersion": SETTINGS_SCHEMA_VERSION})
        ));
        assert!(future_settings_schema(
            &json!({"schemaVersion": f64::from(SETTINGS_SCHEMA_VERSION) + 0.5})
        ));
        assert!(future_settings_schema(
            &json!({"schemaVersion": SETTINGS_SCHEMA_VERSION + 1})
        ));
    }

    #[test]
    fn settings_are_atomic_versioned_and_reloaded() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        let snapshot = store
            .save(json!({"schemaVersion": 2, "runInBackground": true}), 0)
            .unwrap();
        assert_eq!(snapshot.revision, 1);
        assert!(store.run_in_background());
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            snapshot
        );
        assert_eq!(
            store.save(json!({}), 0).unwrap_err().code,
            ErrorCode::SettingsConflict
        );
        assert_eq!(store.snapshot().unwrap(), snapshot);
    }

    #[test]
    fn custom_accent_schema_is_preserved_through_save_and_reload() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        store
            .save(json!({"schemaVersion": 5, "accent": "blue"}), 0)
            .unwrap();
        let settings = json!({
            "schemaVersion": SETTINGS_SCHEMA_VERSION,
            "accent": "custom",
            "customAccent": "#7C3AED",
            "runInBackground": true,
        });
        assert!(!future_settings_schema(&settings));
        let saved = store.save(settings.clone(), 1).unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.settings, settings);
        let reopened = SettingsStore::open(path).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
        assert!(reopened.run_in_background());
    }

    #[test]
    fn network_mode_defaults_migrates_and_reloads_without_losing_settings() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        assert_eq!(store.network_mode().unwrap(), NetworkMode::System);
        store
            .save(json!({"schemaVersion": 3, "language": "en"}), 0)
            .unwrap();
        assert_eq!(store.network_mode().unwrap(), NetworkMode::System);
        let saved = store
            .save(
                json!({"schemaVersion": 3, "language": "en", "networkMode": "direct"}),
                1,
            )
            .unwrap();
        assert_eq!(store.network_mode().unwrap(), NetworkMode::Direct);
        let reopened = SettingsStore::open(path.clone()).unwrap();
        assert_eq!(reopened.network_mode().unwrap(), NetworkMode::Direct);
        assert_eq!(reopened.snapshot().unwrap(), saved);
        let original = fs::read(&path).unwrap();
        for invalid in [json!("proxy"), json!(true), json!(null)] {
            assert_eq!(
                store
                    .save(json!({"schemaVersion": 3, "networkMode": invalid}), 2)
                    .unwrap_err()
                    .code,
                ErrorCode::InvalidArgument
            );
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        store
            .save(json!({"schemaVersion": 3, "networkMode": "system"}), 2)
            .unwrap();
        assert_eq!(store.network_mode().unwrap(), NetworkMode::System);
    }

    #[test]
    fn future_network_mode_is_preserved_without_rewriting_the_archive() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let original = serde_json::to_vec(&json!({
            "revision": 7,
            "settings": {"schemaVersion": 99, "networkMode": "future-proxy"},
        }))
        .unwrap();
        fs::write(&path, &original).unwrap();
        let store = SettingsStore::open(path.clone()).unwrap();
        assert_eq!(store.network_mode().unwrap(), NetworkMode::System);
        assert_eq!(
            store.snapshot().unwrap().settings["networkMode"],
            "future-proxy"
        );
        assert_eq!(fs::read(path).unwrap(), original);
    }

    #[test]
    fn future_settings_reject_native_writes_and_follow_up_effects() {
        for version in [
            f64::from(SETTINGS_SCHEMA_VERSION) + 0.5,
            f64::from(SETTINGS_SCHEMA_VERSION + 1),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("settings.json");
            let original = serde_json::to_vec_pretty(&json!({
                "revision": 7,
                "settings": {"schemaVersion": version, "future": {"keep": true}},
            }))
            .unwrap();
            fs::write(&path, &original).unwrap();
            let store = SettingsStore::open(path.clone()).unwrap();
            let snapshot = store.snapshot().unwrap();
            let followed_up = std::cell::Cell::new(false);

            let result = store.save_and(
                json!({"schemaVersion": SETTINGS_SCHEMA_VERSION, "language": "en"}),
                snapshot.revision,
                || followed_up.set(true),
            );

            assert_eq!(result.unwrap_err().code, ErrorCode::StorageCorrupt);
            assert!(!followed_up.get());
            assert_eq!(store.snapshot().unwrap(), snapshot);
            assert_eq!(fs::read(&path).unwrap(), original);
            assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
        }
    }

    #[test]
    fn explicit_reset_replaces_future_settings_only_at_the_expected_revision() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let original = serde_json::to_vec(&json!({
            "revision": 7,
            "settings": {
                "schemaVersion": SETTINGS_SCHEMA_VERSION + 1,
                "runInBackground": {"mode": "future"},
                "future": {"keep": true},
            },
        }))
        .unwrap();
        fs::write(&path, &original).unwrap();
        let store = SettingsStore::open(path.clone()).unwrap();
        let defaults = json!({"schemaVersion": SETTINGS_SCHEMA_VERSION, "language": "en"});
        assert!(!store.run_in_background());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(
            store.reset(defaults.clone(), 6).unwrap_err().code,
            ErrorCode::SettingsConflict,
        );
        assert_eq!(
            store
                .reset(json!({"runInBackground": "invalid"}), 7)
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument,
        );
        assert_eq!(fs::read(&path).unwrap(), original);

        let reset = store.reset(defaults.clone(), 7).unwrap();
        assert_eq!(reset.revision, 8);
        assert_eq!(reset.settings, defaults);
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            reset
        );
        assert!(store.save(json!({"language": "zh"}), 8).is_ok());
    }

    #[test]
    fn unrecognized_future_snapshots_are_preserved_without_recovery_writes() {
        for revision in [json!(-1), json!(i64::MAX), json!("future-revision")] {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("settings.json");
            let original = serde_json::to_vec(&json!({
                "revision": revision,
                "settings": {"schemaVersion": SETTINGS_SCHEMA_VERSION + 1},
            }))
            .unwrap();
            fs::write(&path, &original).unwrap();

            assert!(matches!(
                SettingsStore::open(path.clone()),
                Err(NativeError {
                    code: ErrorCode::StorageCorrupt,
                    ..
                })
            ));
            assert_eq!(fs::read(&path).unwrap(), original);
            assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
        }
    }

    #[test]
    fn invalid_settings_never_replace_successful_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        store.save(json!({"language":"en"}), 0).unwrap();
        let bytes = fs::read(path).unwrap();
        assert!(store.save(json!({"runInBackground":"yes"}), 1).is_err());
        assert!(
            store
                .save(json!({"huge":"a".repeat(MAX_SETTINGS_SIZE)}), 1)
                .is_err()
        );
        assert_eq!(fs::read(&store.path).unwrap(), bytes);
    }

    #[test]
    fn custom_background_is_bounded_versioned_and_preserved_after_restart() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        let image = json!({
            "name": "sky.webp",
            "dataUrl": format!("data:image/webp;base64,{}", STANDARD.encode(b"RIFF0000WEBP")),
            "fit": "contain",
        });
        let committed = store
            .save(
                json!({"schemaVersion": 3, "background": "custom", "customBackground": image}),
                0,
            )
            .unwrap();
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            committed
        );
        for data_url in [
            "https://example.com/image.webp".to_string(),
            "file:///image.webp".to_string(),
            format!("data:image/svg+xml;base64,{}", STANDARD.encode(b"<svg/>")),
            format!("data:image/webp;base64,{}", STANDARD.encode(b"<svg/>")),
            "data:image/jpeg;base64,not-valid".to_string(),
        ] {
            let invalid = json!({"schemaVersion": 3, "customBackground": {"name": "invalid", "dataUrl": data_url, "fit": "cover"}});
            assert_eq!(
                store.save(invalid, 1).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
            assert_eq!(store.snapshot().unwrap(), committed);
        }
        let mut oversized = image.clone();
        oversized["dataUrl"] = json!("A".repeat(MAX_BACKGROUND_DATA_LENGTH + 1));
        assert_eq!(
            store
                .save(
                    json!({"schemaVersion": 3, "customBackground": oversized}),
                    1
                )
                .unwrap_err()
                .code,
            ErrorCode::InputTooLong
        );
        assert_eq!(store.snapshot().unwrap(), committed);
        assert!(
            store
                .save(
                    json!({"schemaVersion": 3, "background": "plain", "customBackground": null}),
                    1
                )
                .is_ok()
        );
    }

    #[test]
    fn future_image_formats_remain_intact_for_frontend_future_version_protection() {
        let settings = json!({"schemaVersion": SETTINGS_SCHEMA_VERSION + 1, "customBackground": {"futureImage": "new-format"}});
        assert!(validate_settings(&settings).is_ok());
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let snapshot = SettingsStore::open(path.clone())
            .unwrap()
            .save(settings.clone(), 0)
            .unwrap();
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            snapshot
        );
        assert_eq!(snapshot.settings, settings);
    }

    #[test]
    fn window_position_is_backward_compatible_and_persists_the_selected_policy() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        assert_eq!(store.window_position(), WindowPosition::Remember);
        store
            .save(json!({"schemaVersion": 2, "language": "zh"}), 0)
            .unwrap();
        assert_eq!(
            SettingsStore::open(path.clone()).unwrap().window_position(),
            WindowPosition::Remember
        );
        store
            .save(json!({"schemaVersion": 2, "windowPosition": "center"}), 1)
            .unwrap();
        assert_eq!(store.window_position(), WindowPosition::Center);
        assert_eq!(
            SettingsStore::open(path.clone()).unwrap().window_position(),
            WindowPosition::Center
        );
        store
            .save(json!({"schemaVersion": 2, "windowPosition": "remember"}), 2)
            .unwrap();
        assert_eq!(
            SettingsStore::open(path).unwrap().window_position(),
            WindowPosition::Remember
        );
    }

    #[test]
    fn invalid_window_position_cannot_replace_a_committed_policy() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        let committed = store
            .save(json!({"schemaVersion": 2, "windowPosition": "center"}), 0)
            .unwrap();
        let original = fs::read(&path).unwrap();
        for invalid in [
            json!(null),
            json!(true),
            json!(42),
            json!("screen"),
            json!("Center"),
            json!({}),
        ] {
            assert_eq!(
                store
                    .save(json!({"schemaVersion": 2, "windowPosition": invalid}), 1)
                    .unwrap_err()
                    .code,
                ErrorCode::InvalidArgument
            );
            assert_eq!(store.snapshot().unwrap(), committed);
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        assert_eq!(store.window_position(), WindowPosition::Center);
    }

    #[test]
    fn future_window_position_preserves_the_original_snapshot_without_recovery() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let original = br#"{
  "revision": 7,
  "settings": {
    "schemaVersion": 99,
    "windowPosition": "cursor",
    "futureWindowOptions": { "anchor": "cursor" }
  }
}
"#;
        fs::write(&path, original).unwrap();
        let expected = serde_json::from_slice::<SettingsSnapshot>(original).unwrap();

        let store = SettingsStore::open(path.clone()).unwrap();
        assert_eq!(store.snapshot().unwrap(), expected);
        assert_eq!(store.window_position(), WindowPosition::Remember);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(
            SettingsStore::open(path.clone())
                .unwrap()
                .snapshot()
                .unwrap(),
            expected
        );
        assert_eq!(fs::read(path).unwrap(), original);
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn unknown_window_positions_in_known_schemas_still_preserve_a_corrupt_backup() {
        for settings in [
            json!({"windowPosition": "cursor"}),
            json!({"schemaVersion": 1, "windowPosition": "cursor"}),
            json!({"schemaVersion": 2, "windowPosition": "cursor"}),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("settings.json");
            let original =
                serde_json::to_vec(&json!({"revision": 4, "settings": settings})).unwrap();
            fs::write(&path, &original).unwrap();

            let store = SettingsStore::open(path).unwrap();
            assert_eq!(
                store.snapshot().unwrap(),
                SettingsSnapshot {
                    revision: 0,
                    settings: json!({}),
                }
            );
            let backup = fs::read_dir(temp.path())
                .unwrap()
                .map(Result::unwrap)
                .find(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("settings-corrupt-")
                })
                .unwrap();
            assert_eq!(fs::read(backup.path()).unwrap(), original);
        }
    }

    #[test]
    fn future_preference_types_do_not_relax_storage_limits() {
        assert_eq!(
            validate_settings(&json!({
                "schemaVersion": SETTINGS_SCHEMA_VERSION,
                "windowPosition": "remember",
                "runInBackground": "yes",
            }))
            .unwrap_err()
            .code,
            ErrorCode::InvalidArgument
        );
        assert!(
            validate_settings(&json!({
                "schemaVersion": SETTINGS_SCHEMA_VERSION + 1,
                "windowPosition": "cursor",
                "runInBackground": {"mode": "future"},
            }))
            .is_ok()
        );
        assert_eq!(
            validate_settings(&json!({
                "schemaVersion": 99,
                "windowPosition": "cursor",
                "payload": "a".repeat(MAX_SETTINGS_SIZE),
            }))
            .unwrap_err()
            .code,
            ErrorCode::InputTooLong
        );
        let mut nested = json!(null);
        for _ in 0..17 {
            nested = json!({"child": nested});
        }
        assert_eq!(
            validate_settings(&json!({
                "schemaVersion": 99,
                "windowPosition": "cursor",
                "payload": nested,
            }))
            .unwrap_err()
            .code,
            ErrorCode::InvalidArgument
        );
    }

    #[test]
    fn large_valid_settings_remain_readable_after_restart() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let settings = json!({"values": vec![0; 40_000]});
        assert!(serde_json::to_vec_pretty(&settings).unwrap().len() > MAX_SETTINGS_SIZE + 1024);
        let expected = SettingsStore::open(path.clone())
            .unwrap()
            .save(settings, 0)
            .unwrap();
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            expected
        );
    }

    #[test]
    fn concurrent_saves_commit_one_revision_and_failed_io_can_be_retried() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = std::sync::Arc::new(SettingsStore::open(path.clone()).unwrap());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let writers = ["zh", "en"].map(|language| {
            let store = store.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.save(json!({"language": language}), 0)
            })
        });
        barrier.wait();
        let results = writers.map(|writer| writer.join().unwrap());
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .find_map(|result| result.as_ref().err())
                .unwrap()
                .code,
            ErrorCode::SettingsConflict
        );
        let committed = store.snapshot().unwrap();
        assert_eq!(committed.revision, 1);
        assert_eq!(
            SettingsStore::open(path.clone())
                .unwrap()
                .snapshot()
                .unwrap(),
            committed
        );

        let original = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(
            store.save(json!({}), 1).unwrap_err().code,
            ErrorCode::StorageIo
        );
        assert_eq!(store.snapshot().unwrap(), committed);
        fs::remove_dir(&path).unwrap();
        fs::write(&path, original).unwrap();
        assert_eq!(store.save(json!({}), 1).unwrap().revision, 2);
    }

    #[test]
    fn save_and_holds_the_writer_and_keeps_the_last_complete_snapshot_readable() {
        use std::sync::{Arc, Barrier, mpsc};
        use std::time::Duration;

        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = Arc::new(SettingsStore::open(path.clone()).unwrap());
        let previous = store.snapshot().unwrap();
        let (saved_tx, saved_rx) = mpsc::sync_channel(0);
        let resume = Arc::new(Barrier::new(2));
        let saving = {
            let store = store.clone();
            let resume = resume.clone();
            std::thread::spawn(move || {
                store.save_and(json!({"language":"en"}), 0, || {
                    saved_tx.send(()).unwrap();
                    resume.wait();
                })
            })
        };
        saved_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (read_tx, read_rx) = mpsc::sync_channel(1);
        let reading = {
            let store = store.clone();
            std::thread::spawn(move || read_tx.send(store.snapshot()).unwrap())
        };
        let (started_tx, started_rx) = mpsc::sync_channel(0);
        let (written_tx, written_rx) = mpsc::sync_channel(1);
        let stale_writer = {
            let store = store.clone();
            std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                written_tx
                    .send(store.save(json!({"language":"zh"}), 0))
                    .unwrap();
            })
        };
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let readable = read_rx.recv_timeout(Duration::from_secs(2));
        let still_waiting = written_rx.recv_timeout(Duration::from_millis(50));
        resume.wait();
        let (committed, ()) = saving.join().unwrap().unwrap();
        reading.join().unwrap();
        stale_writer.join().unwrap();
        assert_eq!(readable.unwrap().unwrap(), previous);
        assert!(matches!(
            still_waiting,
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        assert_eq!(
            written_rx.recv().unwrap().unwrap_err().code,
            ErrorCode::SettingsConflict,
        );
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            committed,
        );
    }

    #[test]
    fn save_and_skips_followup_on_save_failure_and_preserves_committed_followup_errors() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let store = SettingsStore::open(path.clone()).unwrap();
        let original = store.save(json!({"language":"en"}), 0).unwrap();
        let called = std::cell::Cell::new(false);
        for (settings, revision, code) in [
            (
                json!({"runInBackground":"invalid"}),
                1,
                ErrorCode::InvalidArgument,
            ),
            (json!({"language":"zh"}), 0, ErrorCode::SettingsConflict),
        ] {
            assert_eq!(
                store
                    .save_and(settings, revision, || called.set(true))
                    .unwrap_err()
                    .code,
                code,
            );
            assert!(!called.get());
            assert_eq!(store.snapshot().unwrap(), original);
        }
        let (committed, followup): (_, NativeResult<()>) = store
            .save_and(json!({"language":"zh"}), 1, || {
                Err(NativeError::new(
                    ErrorCode::StorageIo,
                    "Followup write failed",
                ))
            })
            .unwrap();
        assert_eq!(followup.unwrap_err().code, ErrorCode::StorageIo);
        assert_eq!(committed.revision, 2);
        assert_eq!(store.snapshot().unwrap(), committed);
        assert_eq!(
            SettingsStore::open(path).unwrap().snapshot().unwrap(),
            committed
        );
    }

    #[test]
    fn corrupt_settings_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        fs::write(&path, b"invalid").unwrap();
        let store = SettingsStore::open(path.clone()).unwrap();
        assert_eq!(store.snapshot().unwrap().revision, 0);
        let backup = fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings-corrupt-")
            })
            .unwrap();
        assert_eq!(fs::read(backup.path()).unwrap(), b"invalid");
        assert!(SettingsStore::open(path).is_ok());
    }
}
