use super::*;
use serde_json::{Value, json};

fn legacy(schema: u32) -> Value {
    json!({
        "schemaVersion": schema,
        "revision": 16,
        "bundledInitialized": true,
        "extensions": [{
            "package": {
                "manifest": {
                    "formatVersion": schema,
                    "apiVersion": 1,
                    "id": "starter.extension-lab",
                    "version": "1.0.0",
                    "name": "Legacy lab",
                    "author": "Starter",
                    "description": "A preserved development package",
                    "inputFormat": "json",
                    "resultFormat": "view",
                    "icon": "puzzle",
                    "ui": { "sidebar": true, "window": true },
                    "commands": [{ "id": "open", "title": "Open", "function": "lab" }],
                    "permissions": ["text:read"],
                    "allowedHosts": []
                },
                "sha256": digest(b"legacy module"),
                "bytes": 13
            },
            "enabled": true,
            "grantedPermissions": ["text:read"]
        }]
    })
}

fn fixture(value: &Value) -> (tempfile::TempDir, ExtensionStore, Vec<u8>) {
    let directory = crate::extension_paths::temporary_directory();
    let store = ExtensionStore::new(directory.path().join("extensions"), false);
    fs::create_dir(&store.0.root).unwrap();
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    fs::write(store.0.root.join("registry.json"), &bytes).unwrap();
    (directory, store, bytes)
}

#[test]
fn exact_legacy_formats_are_eligible_without_reading_or_running_modules() {
    for schema in [1, 2] {
        let (_directory, store, bytes) = fixture(&legacy(schema));
        let preview = store.preview_archive().unwrap();
        assert_eq!(preview.status, ExtensionArchiveStatus::Legacy);
        assert_eq!(preview.schema_version, Some(schema));
        assert_eq!(preview.installed_count, 1);
        assert_eq!(preview.fingerprint, Some(digest(&bytes)));
        assert_eq!(fs::read(store.0.root.join("registry.json")).unwrap(), bytes);
    }
}

#[test]
fn archiving_preserves_the_complete_original_and_rebuilds_disabled_defaults() {
    let (directory, store, bytes) = fixture(&legacy(2));
    let package = store.0.root.join("packages").join(digest(b"legacy module"));
    fs::create_dir_all(&package).unwrap();
    fs::write(package.join("module.wasm"), b"legacy module").unwrap();
    fs::write(store.0.root.join("preserved-extra.bin"), b"extra").unwrap();
    let private_data = directory.path().join("extension-data");
    fs::create_dir(&private_data).unwrap();
    fs::write(private_data.join("keep.json"), b"private data").unwrap();
    let preview = store.preview_archive().unwrap();
    let result = store.archive_legacy(&preview.fingerprint.unwrap()).unwrap();
    let archive = PathBuf::from(result.archive_path);
    assert!(archive.starts_with(directory.path()));
    assert_ne!(archive, store.0.root);
    assert!(!store.0.root.exists());
    assert_eq!(fs::read(archive.join("registry.json")).unwrap(), bytes);
    assert_eq!(
        fs::read(archive.join("preserved-extra.bin")).unwrap(),
        b"extra"
    );
    assert_eq!(
        fs::read(
            archive
                .join("packages")
                .join(digest(b"legacy module"))
                .join("module.wasm")
        )
        .unwrap(),
        b"legacy module"
    );
    assert_eq!(
        fs::read(private_data.join("keep.json")).unwrap(),
        b"private data"
    );
    assert_eq!(store.snapshot().unwrap().revision, 0);
    store.initialize_bundled().unwrap();
    let snapshot = store.snapshot().unwrap();
    assert!(!snapshot.items.is_empty());
    for item in snapshot.items {
        assert!(!item.enabled);
        assert!(item.granted_permissions.is_empty());
        assert_eq!(item.package.manifest.format_version, 3);
        assert_eq!(item.package.manifest.api_version, 2);
        assert!(item.generation > 0);
    }
    assert_eq!(fs::read(archive.join("registry.json")).unwrap(), bytes);
}

#[test]
fn current_future_and_unknown_registries_cannot_be_archived() {
    let cases = [
        (
            serde_json::to_value(Registry::default()).unwrap(),
            ExtensionArchiveStatus::Current,
        ),
        (
            json!({ "schemaVersion": 99, "future": "preserve" }),
            ExtensionArchiveStatus::Future,
        ),
        (
            json!({ "schemaVersion": 0 }),
            ExtensionArchiveStatus::Invalid,
        ),
        (
            json!({ "schemaVersion": "2" }),
            ExtensionArchiveStatus::Invalid,
        ),
        (
            json!({ "schemaVersion": 3, "revision": 16, "extensions": [legacy(2)["extensions"][0].clone()] }),
            ExtensionArchiveStatus::Invalid,
        ),
    ];
    for (value, status) in cases {
        let (directory, store, bytes) = fixture(&value);
        let preview = store.preview_archive().unwrap();
        assert_eq!(preview.status, status);
        assert!(preview.fingerprint.is_none());
        assert_eq!(
            store.archive_legacy(&digest(&bytes)).unwrap_err().code,
            ErrorCode::ExtensionIncompatible
        );
        assert_eq!(fs::read(store.0.root.join("registry.json")).unwrap(), bytes);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}

#[test]
fn damaged_and_mixed_protocol_legacy_shapes_are_rejected_and_preserved() {
    let mut cases = vec![];
    for path in [
        "/extensions/0/package/manifest/commands",
        "/extensions/0/package/sha256",
    ] {
        let mut value = legacy(2);
        *value.pointer_mut(path).unwrap() = Value::Null;
        cases.push(value);
    }
    let mut value = legacy(2);
    value["unknown"] = true.into();
    cases.push(value);
    let mut value = legacy(2);
    value["extensions"][0]["package"]["manifest"]["formatVersion"] = 3.into();
    cases.push(value);
    let mut value = legacy(2);
    value["extensions"][0]["package"]["manifest"]["permissions"] = json!(["storage"]);
    cases.push(value);
    for value in cases {
        let (_directory, store, bytes) = fixture(&value);
        assert_eq!(
            store.preview_archive().unwrap().status,
            ExtensionArchiveStatus::Invalid
        );
        assert!(store.archive_legacy(&digest(&bytes)).is_err());
        assert_eq!(fs::read(store.0.root.join("registry.json")).unwrap(), bytes);
    }
    let (_directory, store, _) = fixture(&legacy(2));
    for bytes in [
        b"{truncated".as_slice(),
        b"{\"schemaVersion\":99,\"schemaVersion\":2,\"revision\":0,\"extensions\":[]}",
    ] {
        fs::write(store.0.root.join("registry.json"), bytes).unwrap();
        assert_eq!(
            store.preview_archive().unwrap().status,
            ExtensionArchiveStatus::Invalid
        );
        assert!(store.archive_legacy(&digest(bytes)).is_err());
        assert_eq!(fs::read(store.0.root.join("registry.json")).unwrap(), bytes);
    }
}

#[test]
fn archive_confirmation_is_bound_to_the_exact_original_bytes() {
    let (directory, store, original) = fixture(&legacy(2));
    let fingerprint = store.preview_archive().unwrap().fingerprint.unwrap();
    let mut changed = original.clone();
    changed.push(b'\n');
    fs::write(store.0.root.join("registry.json"), &changed).unwrap();
    assert_eq!(
        store.archive_legacy(&fingerprint).unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        fs::read(store.0.root.join("registry.json")).unwrap(),
        changed
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn failed_atomic_rename_keeps_the_source_and_leaves_no_archive() {
    use std::os::windows::fs::OpenOptionsExt;
    let (directory, store, original) = fixture(&legacy(2));
    let fingerprint = store.preview_archive().unwrap().fingerprint.unwrap();
    // A directory handle without FILE_SHARE_DELETE makes Windows reject its rename.
    let handle = fs::OpenOptions::new()
        .read(true)
        .share_mode(0x1 | 0x2)
        .custom_flags(0x02000000)
        .open(&store.0.root)
        .unwrap();
    assert_eq!(
        store.archive_legacy(&fingerprint).unwrap_err().code,
        ErrorCode::StorageIo
    );
    assert_eq!(
        fs::read(store.0.root.join("registry.json")).unwrap(),
        original
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    drop(handle);
}

#[test]
fn execution_pause_shutdown_and_startup_isolation_prevent_archive_mutation() {
    let (_directory, store, original) = fixture(&legacy(2));
    let fingerprint = digest(&original);
    let stop = Arc::new(AtomicBool::new(false));
    store.0.runs.lock().unwrap().push_back(ActiveRun {
        id: "starter.extension-lab".into(),
        owner: "main".into(),
        digest: digest(b"legacy module"),
        stop: stop.clone(),
        phase: ExtensionRunPhase::Running,
        preparation: false,
        background: false,
    });
    assert_eq!(
        store.archive_legacy(&fingerprint).unwrap_err().code,
        ErrorCode::ExtensionBusy
    );
    assert!(!stop.load(Ordering::Relaxed));
    store.0.runs.lock().unwrap().clear();
    let pause = store.pause();
    assert_eq!(
        store.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Unavailable
    );
    assert_eq!(
        store.archive_legacy(&fingerprint).unwrap_err().code,
        ErrorCode::ExtensionUnavailable
    );
    drop(pause);
    let isolated = ExtensionStore::new(store.0.root.clone(), true);
    assert_eq!(
        isolated.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Unavailable
    );
    assert_eq!(
        isolated.archive_legacy(&fingerprint).unwrap_err().code,
        ErrorCode::ExtensionUnavailable
    );
    store.begin_shutdown();
    assert_eq!(
        store.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Unavailable
    );
    assert_eq!(
        store.archive_legacy(&fingerprint).unwrap_err().code,
        ErrorCode::ExtensionUnavailable
    );
    assert_eq!(
        fs::read(store.0.root.join("registry.json")).unwrap(),
        original
    );
}

#[test]
fn missing_registry_is_current_and_does_not_create_files() {
    let directory = crate::extension_paths::temporary_directory();
    let store = ExtensionStore::new(directory.path().join("missing/extensions"), false);
    assert_eq!(
        store.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Current
    );
    assert!(store.archive_legacy(&"a".repeat(64)).is_err());
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[cfg(any(unix, windows))]
fn directory_link(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Cannot create recovery test junction"
        );
    }
}

#[cfg(any(unix, windows))]
#[test]
fn linked_root_ancestor_and_package_directories_are_never_archived() {
    let (directory, store, original) = fixture(&legacy(2));
    let linked = directory.path().join("linked");
    directory_link(&store.0.root, &linked);
    let through_link = ExtensionStore::new(linked.clone(), false);
    assert_eq!(
        through_link.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Invalid
    );
    assert!(through_link.archive_legacy(&digest(&original)).is_err());
    let missing_below_link = ExtensionStore::new(linked.join("missing"), false);
    assert_eq!(
        missing_below_link.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Invalid
    );
    let packages = store.0.root.join("packages");
    let target = directory.path().join("outside");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep"), b"outside data").unwrap();
    directory_link(&target, &packages);
    assert_eq!(
        store.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Invalid
    );
    assert!(store.archive_legacy(&digest(&original)).is_err());
    assert_eq!(
        fs::read(store.0.root.join("registry.json")).unwrap(),
        original
    );
    assert_eq!(fs::read(target.join("keep")).unwrap(), b"outside data");
    #[cfg(windows)]
    {
        fs::remove_dir(packages).unwrap();
        fs::remove_dir(linked).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn linked_registry_file_is_never_read_or_archived() {
    let (directory, store, original) = fixture(&legacy(2));
    let target = directory.path().join("outside.json");
    fs::write(&target, &original).unwrap();
    let path = store.0.root.join("registry.json");
    fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(&target, &path).unwrap();
    assert_eq!(
        store.preview_archive().unwrap().status,
        ExtensionArchiveStatus::Invalid
    );
    assert!(store.archive_legacy(&digest(&original)).is_err());
    assert_eq!(fs::read(target).unwrap(), original);
}
