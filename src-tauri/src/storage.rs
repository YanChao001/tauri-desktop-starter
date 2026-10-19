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

/// Explicit named recursion keeps the Rust/TypeScript JSON contract finite.
/// serde_json::Number preserves integer values on the wire.
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
    inner: Mutex<SettingsSnapshot>,
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
                        backup_path.display()
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
        let mut state = self
            .inner
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Settings lock is unavailable"))?;
        if state.revision != expected_revision {
            return Err(NativeError {
                code: ErrorCode::SettingsConflict,
                message: "Settings changed in another window; reload before saving".into(),
                retryable: true,
            });
        }
        let revision = state.revision.checked_add(1).ok_or_else(|| {
            NativeError::new(ErrorCode::StorageIo, "Settings revision limit reached")
        })?;
        let next = SettingsSnapshot { revision, settings };
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot serialize settings", e)
        })?;
        atomic_write(&self.path, &bytes)?;
        *state = next.clone();
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
