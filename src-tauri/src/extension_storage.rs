use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use specta::Type;

use crate::{
    error::{ErrorCode, NativeError, NativeResult},
    extension_paths::{directory, regular},
    extensions::valid_id,
    storage::atomic_write,
};

const SCHEMA_VERSION: u32 = 1;
const MAX_STORAGE_BYTES: usize = 1024 * 1024;
const MAX_KEYS: usize = 128;
const MAX_KEY_BYTES: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStorageSnapshot {
    pub revision: i32,
    #[specta(type = BTreeMap<String, crate::storage::JsonValue>)]
    pub values: BTreeMap<String, Value>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StorageDocument {
    schema_version: u32,
    extension_id: String,
    revision: i32,
    values: BTreeMap<String, Value>,
}

pub struct ExtensionStorageStore {
    root: PathBuf,
    isolated: bool,
    writing: Mutex<()>,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn corrupt() -> NativeError {
    NativeError::new(
        ErrorCode::StorageCorrupt,
        "Extension storage is invalid; preserve the file before recovering it",
    )
}

fn io(message: &str, error: impl std::fmt::Display) -> NativeError {
    NativeError::operation(ErrorCode::StorageIo, message, error)
}

fn check_stopped(stop: Option<&AtomicBool>) -> NativeResult<()> {
    if stop.is_some_and(|stop| stop.load(Ordering::Acquire)) {
        return Err(NativeError::new(
            ErrorCode::UserCancelled,
            "Extension storage write was stopped before committing",
        ));
    }
    Ok(())
}

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY_BYTES && !key.chars().any(char::is_control)
}

impl ExtensionStorageStore {
    pub fn new(root: PathBuf, isolated: bool) -> Self {
        Self {
            root,
            isolated,
            writing: Mutex::new(()),
        }
    }

    fn path(&self, id: &str) -> NativeResult<PathBuf> {
        if !valid_id(id) {
            return Err(invalid("Use a reverse-domain extension ID"));
        }
        // 哈希文件名避免 Windows 设备名；文档内仍核对 ID，防止文件被交换。
        Ok(self
            .root
            .join(format!("{:x}.json", Sha256::digest(id.as_bytes()))))
    }

    pub fn snapshot(&self, id: &str) -> NativeResult<ExtensionStorageSnapshot> {
        let path = self.path(id)?;
        self.read(id, &path)
    }

    fn read(&self, id: &str, path: &Path) -> NativeResult<ExtensionStorageSnapshot> {
        if !directory(&self.root, false)? || !regular(path)? {
            return Ok(ExtensionStorageSnapshot {
                revision: 0,
                values: BTreeMap::new(),
            });
        }
        let file = crate::extension_paths::open_regular(path)?;
        if file
            .metadata()
            .map_err(|error| io("Cannot inspect extension storage", error))?
            .len()
            > MAX_STORAGE_BYTES as u64
        {
            return Err(corrupt());
        }
        let mut contents = Vec::new();
        file.take(MAX_STORAGE_BYTES as u64 + 1)
            .read_to_end(&mut contents)
            .map_err(|error| io("Cannot read extension storage", error))?;
        if contents.len() > MAX_STORAGE_BYTES {
            return Err(corrupt());
        }
        let value: Value = serde_json::from_slice(&contents).map_err(|_| corrupt())?;
        if value
            .get("schemaVersion")
            .and_then(Value::as_f64)
            .is_some_and(|version| version > f64::from(SCHEMA_VERSION))
        {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "Extension storage was created by a newer host; update before writing",
            ));
        }
        // 从原文解码结构体，重复信封字段不能被 Value 的 map 折叠后悄悄接受。
        let document: StorageDocument = serde_json::from_slice(&contents).map_err(|_| corrupt())?;
        if document.schema_version != SCHEMA_VERSION
            || document.extension_id != id
            || document.revision < 0
            || document.values.len() > MAX_KEYS
            || document.values.keys().any(|key| !valid_key(key))
        {
            return Err(corrupt());
        }
        // 外部 JSON 的短指数数字在重新编码后可能显著展开；宿主上下文按规范化体积预留额度。
        if serde_json::to_vec(&document).map_err(|_| corrupt())?.len() > MAX_STORAGE_BYTES {
            return Err(corrupt());
        }
        Ok(ExtensionStorageSnapshot {
            revision: document.revision,
            values: document.values,
        })
    }

    pub fn patch(
        &self,
        id: &str,
        expected_revision: i32,
        changes: BTreeMap<String, Option<Value>>,
    ) -> NativeResult<ExtensionStorageSnapshot> {
        self.update(id, expected_revision, Some(changes), None)
    }

    /// 排队和准备数据期间可合作取消；进入原子提交后保留实际提交结果。
    pub fn patch_with_stop(
        &self,
        id: &str,
        expected_revision: i32,
        changes: BTreeMap<String, Option<Value>>,
        stop: &AtomicBool,
    ) -> NativeResult<ExtensionStorageSnapshot> {
        self.update(id, expected_revision, Some(changes), Some(stop))
    }

    /// 显式清空仍保留递增版本，旧窗口不能用清空前的 revision 覆盖新数据。
    pub fn clear(
        &self,
        id: &str,
        expected_revision: i32,
    ) -> NativeResult<ExtensionStorageSnapshot> {
        self.update(id, expected_revision, None, None)
    }

    fn update(
        &self,
        id: &str,
        expected_revision: i32,
        changes: Option<BTreeMap<String, Option<Value>>>,
        stop: Option<&AtomicBool>,
    ) -> NativeResult<ExtensionStorageSnapshot> {
        let path = self.path(id)?;
        if expected_revision < 0 {
            return Err(invalid("Extension storage revision must not be negative"));
        }
        if self.isolated {
            return Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Extension storage is read-only in recovery isolation",
            ));
        }
        let _writing = self
            .writing
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Extension storage lock failed"))?;
        check_stopped(stop)?;
        // 不缓存快照；其他窗口及磁盘外部修改都必须重新参与条件写入。
        let mut snapshot = self.read(id, &path)?;
        if snapshot.revision != expected_revision {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "Extension storage changed; reload before retrying",
            ));
        }
        snapshot.revision = snapshot.revision.checked_add(1).ok_or_else(|| {
            NativeError::new(
                ErrorCode::Conflict,
                "Extension storage revision is exhausted",
            )
        })?;
        match changes {
            Some(changes) => {
                for (key, value) in changes {
                    if !valid_key(&key) {
                        return Err(invalid(
                            "Storage keys require 1 to 128 bytes without control characters",
                        ));
                    }
                    if let Some(value) = value {
                        snapshot.values.insert(key, value);
                    } else {
                        snapshot.values.remove(&key);
                    }
                }
            }
            None => snapshot.values.clear(),
        }
        if snapshot.values.len() > MAX_KEYS {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Extension storage supports at most 128 keys",
            ));
        }
        let document = StorageDocument {
            schema_version: SCHEMA_VERSION,
            extension_id: id.to_owned(),
            revision: snapshot.revision,
            values: snapshot.values,
        };
        let bytes = serde_json::to_vec(&document)
            .map_err(|error| io("Cannot encode extension storage", error))?;
        if bytes.len() > MAX_STORAGE_BYTES {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Extension storage exceeds its 1 MiB quota",
            ));
        }
        // 外部调用者也可直接构造 Value；写入前确保同一有界解码器能再次读取。
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| invalid("Extension storage JSON nesting is too deep"))?;
        check_stopped(stop)?;
        directory(&self.root, true)?;
        regular(&path)?;
        check_stopped(stop)?;
        atomic_write(&path, &bytes)?;
        Ok(ExtensionStorageSnapshot {
            revision: document.revision,
            values: document.values,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    const ID: &str = "org.example.notes";

    fn changes(key: &str, value: Option<Value>) -> BTreeMap<String, Option<Value>> {
        BTreeMap::from([(key.to_owned(), value)])
    }

    fn write_document(store: &ExtensionStorageStore, id: &str, document: &Value) {
        fs::create_dir_all(&store.root).unwrap();
        fs::write(
            store.path(id).unwrap(),
            serde_json::to_vec(document).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn snapshots_are_lazy_namespaced_and_read_disk_changes() {
        let temporary = crate::extension_paths::temporary_directory();
        let root = temporary.path().join("missing").join("storage");
        let store = ExtensionStorageStore::new(root.clone(), false);
        assert_eq!(store.snapshot(ID).unwrap().revision, 0);
        assert!(!root.exists());
        let first = store
            .patch(ID, 0, changes("note", Some(json!({"body": "saved"}))))
            .unwrap();
        assert_eq!(first.revision, 1);
        assert!(
            store
                .snapshot("org.example.other")
                .unwrap()
                .values
                .is_empty()
        );
        let reopened = ExtensionStorageStore::new(root, false);
        reopened
            .patch(ID, 1, changes("note", Some(Value::Null)))
            .unwrap();
        assert_eq!(store.snapshot(ID).unwrap().values["note"], Value::Null);
        assert_eq!(
            store.patch(ID, 1, BTreeMap::new()).unwrap_err().code,
            ErrorCode::Conflict
        );
        let removed = store.patch(ID, 2, changes("note", None)).unwrap();
        assert!(removed.values.is_empty());
        assert_eq!(removed.revision, 3);
    }

    #[test]
    fn compare_and_swap_and_clear_preserve_monotonic_revisions() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        store
            .patch(ID, 0, changes("value", Some(json!(42))))
            .unwrap();
        assert_eq!(store.clear(ID, 0).unwrap_err().code, ErrorCode::Conflict);
        let cleared = store.clear(ID, 1).unwrap();
        assert_eq!(cleared.revision, 2);
        assert!(cleared.values.is_empty());
        assert_eq!(store.snapshot(ID).unwrap(), cleared);
        write_document(
            &store,
            ID,
            &json!({
                "schemaVersion": 1, "extensionId": ID, "revision": i32::MAX, "values": {}
            }),
        );
        assert_eq!(
            store.clear(ID, i32::MAX).unwrap_err().code,
            ErrorCode::Conflict
        );
        assert_eq!(store.snapshot(ID).unwrap().revision, i32::MAX);
    }

    #[test]
    fn simultaneous_writers_cannot_apply_the_same_revision_twice() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        let outcomes = std::thread::scope(|scope| {
            let first = scope.spawn(|| store.patch(ID, 0, changes("first", Some(json!(true)))));
            let second = scope.spawn(|| store.patch(ID, 0, changes("second", Some(json!(true)))));
            [first.join().unwrap(), second.join().unwrap()]
        });
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| result
                    .as_ref()
                    .is_err_and(|error| error.code == ErrorCode::Conflict))
                .count(),
            1
        );
        let saved = store.snapshot(ID).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.values.len(), 1);
    }

    #[test]
    fn cancellation_while_waiting_for_the_write_lock_preserves_the_saved_revision() {
        use std::{
            sync::{Arc, mpsc},
            time::Duration,
        };

        let temporary = crate::extension_paths::temporary_directory();
        let store = Arc::new(ExtensionStorageStore::new(
            temporary.path().join("storage"),
            false,
        ));
        let saved = store
            .patch(ID, 0, changes("note", Some(json!("saved"))))
            .unwrap();
        let original = fs::read(store.path(ID).unwrap()).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let writing = store.writing.lock().unwrap();
        let (started_sender, started_receiver) = mpsc::sync_channel(0);
        let (result_sender, result_receiver) = mpsc::channel();
        let writer = {
            let store = store.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                started_sender.send(()).unwrap();
                let result =
                    store.patch_with_stop(ID, 1, changes("note", Some(json!("changed"))), &stop);
                result_sender.send(result).unwrap();
            })
        };
        started_receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        // 写锁仍由本线程持有，后台修改确实没有完成后才发出取消。
        assert!(matches!(
            result_receiver.recv_timeout(Duration::from_millis(25)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        stop.store(true, Ordering::Release);
        drop(writing);
        let result = result_receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        writer.join().unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::UserCancelled);
        assert_eq!(store.snapshot(ID).unwrap(), saved);
        assert_eq!(fs::read(store.path(ID).unwrap()).unwrap(), original);
    }

    #[test]
    fn guarded_patch_returns_the_committed_revision_and_stopped_work_creates_nothing() {
        let temporary = crate::extension_paths::temporary_directory();
        let root = temporary.path().join("storage");
        let store = ExtensionStorageStore::new(root.clone(), false);
        let stop = AtomicBool::new(true);
        assert_eq!(
            store
                .patch_with_stop(ID, 0, changes("note", Some(json!("changed"))), &stop)
                .unwrap_err()
                .code,
            ErrorCode::UserCancelled
        );
        assert!(!root.exists());
        stop.store(false, Ordering::Release);
        let committed = store
            .patch_with_stop(ID, 0, changes("note", Some(json!("saved"))), &stop)
            .unwrap();
        stop.store(true, Ordering::Release);
        assert_eq!(committed.revision, 1);
        assert_eq!(store.snapshot(ID).unwrap(), committed);
    }

    #[test]
    fn bounded_unicode_and_namespaced_keys_stay_inside_the_plugin_document() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        let keys = [
            "上次搜索",
            "user/preferences",
            "_draft",
            "field name",
            "../literal",
        ];
        let changes = keys
            .iter()
            .map(|key| ((*key).to_owned(), Some(json!(true))))
            .collect();
        let saved = store.patch(ID, 0, changes).unwrap();
        assert_eq!(store.snapshot(ID).unwrap(), saved);
        assert!(keys.iter().all(|key| saved.values.contains_key(*key)));
        assert_eq!(std::fs::read_dir(&store.root).unwrap().count(), 1);
    }

    #[test]
    fn quotas_and_keys_fail_without_changing_existing_data() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        let initial: BTreeMap<_, _> = (0..MAX_KEYS)
            .map(|index| (format!("key-{index}"), Some(json!(index))))
            .collect();
        let saved = store.patch(ID, 0, initial).unwrap();
        assert_eq!(
            store
                .patch(ID, 1, changes("extra", Some(json!(true))))
                .unwrap_err()
                .code,
            ErrorCode::InputTooLong
        );
        for key in ["", "a\0b", "line\nbreak"] {
            assert_eq!(
                store.patch(ID, 1, changes(key, None)).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
        }
        assert!(
            store
                .patch(ID, 1, changes(&"a".repeat(MAX_KEY_BYTES + 1), None))
                .is_err()
        );
        assert_eq!(store.snapshot(ID).unwrap(), saved);
        let large = "x".repeat(MAX_STORAGE_BYTES);
        assert_eq!(
            store
                .patch("org.example.large", 0, changes("value", Some(json!(large))))
                .unwrap_err()
                .code,
            ErrorCode::InputTooLong
        );
        assert_eq!(store.snapshot("org.example.large").unwrap().revision, 0);
        let replaced = BTreeMap::from([
            ("key-0".to_owned(), None),
            ("new.value-1".to_owned(), Some(json!(true))),
        ]);
        assert_eq!(store.patch(ID, 1, replaced).unwrap().values.len(), MAX_KEYS);
        let mut nested = Value::Null;
        for _ in 0..128 {
            nested = Value::Array(vec![nested]);
        }
        assert_eq!(
            store
                .patch("org.example.nested", 0, changes("value", Some(nested)))
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(store.snapshot("org.example.nested").unwrap().revision, 0);
    }

    #[test]
    fn external_short_exponents_cannot_exceed_the_canonical_storage_quota() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        let numbers = std::iter::repeat_n("1e15", 80_000)
            .collect::<Vec<_>>()
            .join(",");
        let contents = format!(
            r#"{{"schemaVersion":1,"extensionId":"{ID}","revision":1,"values":{{"numbers":[{numbers}]}}}}"#
        )
        .into_bytes();
        assert!(contents.len() < MAX_STORAGE_BYTES);
        let document: StorageDocument = serde_json::from_slice(&contents).unwrap();
        assert!(serde_json::to_vec(&document).unwrap().len() > MAX_STORAGE_BYTES);
        fs::create_dir_all(&store.root).unwrap();
        let path = store.path(ID).unwrap();
        fs::write(&path, &contents).unwrap();

        assert_eq!(
            store.snapshot(ID).unwrap_err().code,
            ErrorCode::StorageCorrupt
        );
        assert_eq!(fs::read(&path).unwrap(), contents);
        assert_eq!(
            store.clear(ID, 1).unwrap_err().code,
            ErrorCode::StorageCorrupt
        );
        assert_eq!(fs::read(&path).unwrap(), contents);
    }

    #[test]
    fn unsupported_corrupt_or_misplaced_storage_is_never_overwritten() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        for (document, code) in [
            (
                json!({"schemaVersion": 2, "future": true}),
                ErrorCode::ExtensionIncompatible,
            ),
            (
                json!({"schemaVersion": 1, "extensionId": ID, "revision": -1, "values": {}}),
                ErrorCode::StorageCorrupt,
            ),
            (
                json!({"schemaVersion": 1, "extensionId": "org.example.other", "revision": 1, "values": {}}),
                ErrorCode::StorageCorrupt,
            ),
            (
                json!({"schemaVersion": 1, "extensionId": ID, "revision": 1, "values": {"invalid\u{0}key": true}}),
                ErrorCode::StorageCorrupt,
            ),
            (
                json!({"schemaVersion": 1, "extensionId": ID, "revision": 1, "values": {}, "unknown": true}),
                ErrorCode::StorageCorrupt,
            ),
        ] {
            write_document(&store, ID, &document);
            let original = fs::read(store.path(ID).unwrap()).unwrap();
            assert_eq!(store.snapshot(ID).unwrap_err().code, code);
            assert_eq!(store.clear(ID, 1).unwrap_err().code, code);
            assert_eq!(fs::read(store.path(ID).unwrap()).unwrap(), original);
        }
        for contents in [b"{".as_slice(), &vec![b' '; MAX_STORAGE_BYTES + 1]] {
            fs::write(store.path(ID).unwrap(), contents).unwrap();
            assert_eq!(
                store.patch(ID, 0, BTreeMap::new()).unwrap_err().code,
                ErrorCode::StorageCorrupt
            );
            assert_eq!(fs::read(store.path(ID).unwrap()).unwrap(), contents);
        }
        let duplicate = format!(
            r#"{{"schemaVersion":2,"schemaVersion":1,"extensionId":"{ID}","revision":0,"values":{{}}}}"#
        );
        fs::write(store.path(ID).unwrap(), duplicate.as_bytes()).unwrap();
        assert_eq!(
            store.clear(ID, 0).unwrap_err().code,
            ErrorCode::StorageCorrupt
        );
        assert_eq!(
            fs::read(store.path(ID).unwrap()).unwrap(),
            duplicate.as_bytes()
        );
    }

    #[test]
    fn isolation_reads_but_never_creates_or_changes_storage() {
        let temporary = crate::extension_paths::temporary_directory();
        let root = temporary.path().join("storage");
        let isolated = ExtensionStorageStore::new(root.clone(), true);
        assert_eq!(isolated.snapshot(ID).unwrap().revision, 0);
        assert_eq!(
            isolated.clear(ID, 0).unwrap_err().code,
            ErrorCode::ExtensionUnavailable
        );
        assert!(!root.exists());
        let store = ExtensionStorageStore::new(root, false);
        let saved = store
            .patch(ID, 0, changes("value", Some(json!(42))))
            .unwrap();
        assert_eq!(isolated.snapshot(ID).unwrap(), saved);
        assert_eq!(
            isolated
                .patch(ID, 1, changes("value", None))
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(store.snapshot(ID).unwrap(), saved);
    }

    #[test]
    fn invalid_ids_paths_and_storage_directories_are_rejected() {
        let temporary = crate::extension_paths::temporary_directory();
        let store = ExtensionStorageStore::new(temporary.path().join("storage"), false);
        for id in [
            "",
            "single",
            "../org.example",
            "org..example",
            "Org.example",
            "org.1example",
            "org.example-",
            "org.example/x",
            "org.example\0x",
        ] {
            assert_eq!(
                store.snapshot(id).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
        }
        assert!(store.snapshot(&format!("org.{}", "a".repeat(80))).is_err());
        assert!(
            ExtensionStorageStore::new(PathBuf::from("relative"), false)
                .snapshot(ID)
                .is_err()
        );
        // Windows 的 verbatim 根会在 PathBuf::join 中折叠 ..；保留真实待校验入参。
        let mut traversal = temporary.path().as_os_str().to_os_string();
        traversal.push(std::path::MAIN_SEPARATOR_STR);
        traversal.push("..");
        traversal.push(std::path::MAIN_SEPARATOR_STR);
        traversal.push("storage");
        let traversal = PathBuf::from(traversal);
        assert!(
            traversal
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        );
        assert!(
            ExtensionStorageStore::new(traversal, false)
                .snapshot(ID)
                .is_err()
        );
        fs::create_dir_all(store.path(ID).unwrap()).unwrap();
        assert_eq!(
            store.snapshot(ID).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        // Windows 的设备名只出现在信封中，磁盘路径始终使用安全哈希。
        store.patch("com1.example", 0, BTreeMap::new()).unwrap();
    }

    #[test]
    fn linked_files_and_linked_ancestors_are_rejected() {
        let temporary = crate::extension_paths::temporary_directory();
        let real = temporary.path().join("real");
        let linked_root = temporary.path().join("linked");
        fs::create_dir_all(real.join("nested")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &linked_root).unwrap();
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_dir(&real, &linked_root) {
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                return;
            }
            panic!("Cannot create storage test symlink: {error}");
        }
        let store = ExtensionStorageStore::new(linked_root.join("nested"), false);
        assert_eq!(
            store.snapshot(ID).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            store.patch(ID, 0, BTreeMap::new()).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        let store = ExtensionStorageStore::new(real, false);
        let target = temporary.path().join("target.json");
        fs::write(&target, b"{}").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, store.path(ID).unwrap()).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, store.path(ID).unwrap()).unwrap();
        assert_eq!(
            store.snapshot(ID).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            store.clear(ID, 0).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(fs::read(target).unwrap(), b"{}");
    }
}
