use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;
#[cfg(not(feature = "e2e"))]
use tauri::Manager;

use crate::error::{ErrorCode, NativeError, NativeResult};

pub const SETTINGS_EVENT: &str = "app://settings-changed";
const MAX_SETTINGS_SIZE: usize = 128 * 1024;

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
            paths.create()?;
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
            paths.create()?;
            Ok(paths)
        }
    }

    fn create(&self) -> NativeResult<()> {
        for path in [&self.config, &self.data, &self.logs] {
            fs::create_dir_all(path).map_err(|e| {
                NativeError::operation(
                    ErrorCode::StorageIo,
                    "Cannot create application directory",
                    e,
                )
            })?;
        }
        Ok(())
    }
}

pub fn atomic_write(path: &Path, contents: &[u8]) -> NativeResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| NativeError::new(ErrorCode::StorageIo, "Invalid storage path"))?;
    fs::create_dir_all(parent).map_err(|e| {
        NativeError::operation(ErrorCode::StorageIo, "Cannot create storage directory", e)
    })?;
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

fn validate_settings(settings: &Value) -> NativeResult<()> {
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
    if object
        .get("runInBackground")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "runInBackground must be a boolean",
        ));
    }
    // 未来结构可能扩展位置策略；保留原值供前端执行未来版本只读保护。
    let future_schema = object
        .get("schemaVersion")
        .and_then(Value::as_f64)
        .is_some_and(|version| version > 2.0);
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
                if bytes.len() > MAX_SETTINGS_SIZE + 1024 {
                    return Err(NativeError::new(
                        ErrorCode::StorageCorrupt,
                        "Settings file exceeds the supported size",
                    ));
                }
                let decoded = serde_json::from_slice::<SettingsSnapshot>(&bytes)
                    .ok()
                    .filter(|snapshot| {
                        snapshot.revision >= 0 && validate_settings(&snapshot.settings).is_ok()
                    });
                if let Some(snapshot) = decoded {
                    snapshot
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

    pub fn save(&self, settings: Value, expected_revision: i32) -> NativeResult<SettingsSnapshot> {
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
        *self
            .inner
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Settings lock is unavailable"))? =
            next.clone();
        Ok(next)
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
    file.take((MAX_SETTINGS_SIZE + 1025) as u64)
        .read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn future_window_positions_do_not_relax_other_storage_limits() {
        assert_eq!(
            validate_settings(&json!({
                "schemaVersion": 99,
                "windowPosition": "cursor",
                "runInBackground": "yes",
            }))
            .unwrap_err()
            .code,
            ErrorCode::InvalidArgument
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
