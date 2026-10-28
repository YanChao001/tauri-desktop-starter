//! 启动故障隔离与下次启动时的存储替换；原件先归档，未提交的替换可恢复。

use crate::{
    blocking,
    database::{BACKUP_LIMIT, BackupInfo, BackupPreview, DATABASE_SCHEMA_VERSION, Database},
    error::{ErrorCode, NativeError, NativeResult},
    storage::{
        DataPaths, MAX_SETTINGS_FILE_SIZE, SettingsStore, atomic_write, future_settings_schema,
        validate_settings,
    },
};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, TryLockError},
};
use tauri::Manager;

const PENDING: &str = ".recovery-pending.json";
const JOURNAL: &str = ".recovery-transaction.json";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub active: bool,
    pub reason: Option<String>,
    pub restored: bool,
    pub pending: bool,
    pub notes: u32,
    pub archive_id: Option<String>,
}

pub struct RecoveryState {
    paths: DataPaths,
    temporary: Option<tempfile::TempDir>,
    status: Mutex<RecoveryStatus>,
    operation: Mutex<()>,
}

pub struct InitializedStorage {
    pub settings: SettingsStore,
    pub database: Database,
    pub recovery: RecoveryState,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    token: String,
    reset_settings: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    request: Pending,
    originals: Vec<String>,
    installed: bool,
}

fn failure(message: &str, error: impl std::fmt::Display) -> NativeError {
    NativeError::operation(ErrorCode::StorageIo, message, error)
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::StorageCorrupt, message)
}
fn json<T: serde::de::DeserializeOwned>(path: &Path) -> NativeResult<T> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|e| failure("Cannot read recovery metadata", e))?;
    if bytes.len() > 1024 * 1024 {
        return Err(invalid("Recovery metadata exceeds the supported size"));
    }
    serde_json::from_slice(&bytes).map_err(|e| failure("Invalid recovery metadata", e))
}
fn write_json(path: &Path, value: &impl Serialize) -> NativeResult<()> {
    let bytes =
        serde_json::to_vec(value).map_err(|e| failure("Cannot encode recovery metadata", e))?;
    atomic_write(path, &bytes)
}
fn validate_token(token: &str) -> NativeResult<()> {
    if token.is_empty()
        || token.len() > 80
        || !token.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err(invalid("Invalid recovery identity"));
    }
    Ok(())
}
fn candidate(paths: &DataPaths, token: &str, settings: bool) -> PathBuf {
    if settings {
        paths.config.join(format!(".recovery-next-{token}.json"))
    } else {
        paths.data.join(format!(".recovery-next-{token}.sqlite3"))
    }
}
fn regular(path: &Path) -> NativeResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.is_file() && !info.is_symlink() => Ok(true),
        Ok(_) => Err(invalid("Recovery refuses a storage file link or directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(failure("Cannot inspect recovery storage", error)),
    }
}
fn root_dir(path: &Path) -> NativeResult<()> {
    let info =
        fs::symlink_metadata(path).map_err(|e| failure("Cannot inspect storage directory", e))?;
    if !info.is_dir() || info.is_symlink() {
        return Err(invalid("Recovery requires a real storage directory"));
    }
    Ok(())
}
fn location(paths: &DataPaths, name: &str) -> NativeResult<PathBuf> {
    match name {
        "starter.sqlite3" | "starter.sqlite3-wal" | "starter.sqlite3-shm" => {
            Ok(paths.data.join(name))
        }
        "settings.json" => Ok(paths.config.join(name)),
        _ => Err(invalid("Invalid recovery archive entry")),
    }
}
fn archive(paths: &DataPaths, token: &str, name: &str) -> NativeResult<PathBuf> {
    Ok(location(paths, name)?
        .parent()
        .ok_or_else(|| invalid("Invalid storage parent"))?
        .join(format!("recovery-archive-{token}"))
        .join(name))
}
fn remove_metadata(path: &Path) -> NativeResult<()> {
    if regular(path)? {
        fs::remove_file(path).map_err(|e| failure("Cannot finish recovery metadata", e))?;
    }
    Ok(())
}

fn verify_database(path: &Path) -> NativeResult<u32> {
    if !regular(path)? {
        return Err(invalid("Recovery database is missing"));
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| failure("Cannot verify recovery database", e))?;
    let schema: i32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| failure("Cannot verify database schema", e))?;
    if schema != DATABASE_SCHEMA_VERSION {
        return Err(invalid(&format!(
            "Recovery requires a supported schema {DATABASE_SCHEMA_VERSION} database"
        )));
    }
    let result: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| failure("Cannot check database integrity", e))?;
    if result != "ok" {
        return Err(invalid("Recovery database integrity check failed"));
    }
    connection
        .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
        .map_err(|e| failure("Cannot count recovered notes", e))
}

fn protect_future(paths: &DataPaths, reset_settings: bool) -> NativeResult<()> {
    let database = paths.data.join("starter.sqlite3");
    let mut header = [0_u8; 16];
    let recognizable = if regular(&database)? {
        match File::open(&database).and_then(|mut file| file.read_exact(&mut header)) {
            Ok(()) => &header == b"SQLite format 3\0",
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => false,
            Err(error) => {
                return Err(failure(
                    "Cannot inspect the original database safely",
                    error,
                ));
            }
        }
    } else {
        false
    };
    if recognizable {
        match Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY).and_then(
            |connection| {
                connection.pragma_query_value::<i32, _>(None, "user_version", |row| row.get(0))
            },
        ) {
            Ok(version) if version > DATABASE_SCHEMA_VERSION => {
                return Err(invalid(
                    "A newer database must not be downgraded; use the newer application",
                ));
            }
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(error, _))
                if matches!(
                    error.code,
                    rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt
                ) => {}
            Err(error) => {
                return Err(failure(
                    "Cannot inspect the original database safely",
                    error,
                ));
            }
        }
    }
    let settings = paths.config.join("settings.json");
    if reset_settings && regular(&settings)? {
        let mut contents = Vec::new();
        File::open(settings)
            .and_then(|file| file.take(1024 * 1024 + 1).read_to_end(&mut contents))
            .map_err(|e| failure("Cannot inspect original settings", e))?;
        if contents.len() > 1024 * 1024 {
            return Err(invalid(
                "Original settings are too large to validate safely",
            ));
        }
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&contents)
            && future_settings_schema(value.get("settings").unwrap_or(&value))
        {
            return Err(invalid(
                "Settings from a newer application must not be overwritten",
            ));
        }
    }
    Ok(())
}

fn rollback(paths: &DataPaths, journal: &Journal) -> NativeResult<()> {
    validate_token(&journal.request.token)?;
    for name in &journal.originals {
        location(paths, name)?;
    }
    for (name, settings) in [("starter.sqlite3", false), ("settings.json", true)] {
        if settings && !journal.request.reset_settings {
            continue;
        }
        let staged = candidate(paths, &journal.request.token, settings);
        let destination = location(paths, name)?;
        if !regular(&staged)?
            && regular(&destination)?
            && (regular(&archive(paths, &journal.request.token, name)?)?
                || !journal.originals.iter().any(|entry| entry == name))
        {
            fs::rename(&destination, &staged)
                .map_err(|e| failure("Cannot preserve uncommitted recovered storage", e))?;
        }
    }
    for name in &journal.originals {
        let saved = archive(paths, &journal.request.token, name)?;
        if regular(&saved)? {
            let destination = location(paths, name)?;
            if regular(&destination)? {
                return Err(invalid(
                    "Storage changed during recovery; originals remain archived for manual review",
                ));
            }
            fs::rename(saved, destination)
                .map_err(|e| failure("Cannot restore the original storage", e))?;
        }
    }
    remove_metadata(&paths.data.join(JOURNAL))
}

fn apply_pending(paths: &DataPaths) -> NativeResult<Option<String>> {
    apply_pending_with(paths, || Ok(()))
}

fn apply_pending_with(
    paths: &DataPaths,
    mut before_install: impl FnMut() -> NativeResult<()>,
) -> NativeResult<Option<String>> {
    root_dir(&paths.data)?;
    root_dir(&paths.config)?;
    if regular(&paths.data.join(JOURNAL))? {
        let journal: Journal = json(&paths.data.join(JOURNAL))?;
        validate_token(&journal.request.token)?;
        if journal.installed {
            verify_database(&paths.data.join("starter.sqlite3"))?;
            remove_metadata(&paths.data.join(PENDING))?;
            remove_metadata(&paths.data.join(JOURNAL))?;
            return Ok(Some(format!("recovery-archive-{}", journal.request.token)));
        }
        rollback(paths, &journal)?;
    }
    if !regular(&paths.data.join(PENDING))? {
        return Ok(None);
    }
    let request: Pending = json(&paths.data.join(PENDING))?;
    validate_token(&request.token)?;
    protect_future(paths, request.reset_settings)?;
    verify_database(&candidate(paths, &request.token, false))?;
    if request.reset_settings {
        let path = candidate(paths, &request.token, true);
        if !regular(&path)? {
            return Err(invalid("Recovery settings candidate is missing"));
        }
        if fs::metadata(&path)
            .map_err(|e| failure("Cannot inspect recovery settings candidate", e))?
            .len()
            > MAX_SETTINGS_FILE_SIZE as u64
        {
            return Err(invalid(
                "Recovery settings candidate exceeds the supported size",
            ));
        }
        let settings: crate::storage::SettingsSnapshot = json(&path)?;
        if settings.revision < 0
            || future_settings_schema(&settings.settings)
            || validate_settings(&settings.settings).is_err()
        {
            return Err(invalid("Invalid or newer recovery settings candidate"));
        }
    }
    let mut originals = Vec::new();
    for name in [
        "starter.sqlite3",
        "starter.sqlite3-wal",
        "starter.sqlite3-shm",
        "settings.json",
    ] {
        if name == "settings.json" && !request.reset_settings {
            continue;
        }
        if regular(&location(paths, name)?)? {
            originals.push(name.to_owned());
        }
    }
    let mut journal = Journal {
        request,
        originals,
        installed: false,
    };
    write_json(&paths.data.join(JOURNAL), &journal)?;
    let install = (|| {
        for name in &journal.originals {
            let saved = archive(paths, &journal.request.token, name)?;
            let parent = saved
                .parent()
                .ok_or_else(|| invalid("Invalid archive directory"))?;
            if !parent.exists() {
                fs::create_dir(parent)
                    .map_err(|e| failure("Cannot create original storage archive", e))?;
            }
            root_dir(parent)?;
            if saved.exists() {
                return Err(invalid(
                    "Recovery archive already exists; original files were not overwritten",
                ));
            }
            fs::rename(location(paths, name)?, saved)
                .map_err(|e| failure("Cannot archive original storage", e))?;
        }
        before_install()?;
        fs::rename(
            candidate(paths, &journal.request.token, false),
            paths.data.join("starter.sqlite3"),
        )
        .map_err(|e| failure("Cannot install verified recovery database", e))?;
        if journal.request.reset_settings {
            fs::rename(
                candidate(paths, &journal.request.token, true),
                paths.config.join("settings.json"),
            )
            .map_err(|e| failure("Cannot install recovered settings", e))?;
        }
        journal.installed = true;
        write_json(&paths.data.join(JOURNAL), &journal)
    })();
    if let Err(error) = install {
        rollback(paths, &journal).map_err(|rollback_error| {
            failure(
                "Recovery could not finish restoring originals; archive and journal retained",
                rollback_error,
            )
        })?;
        return Err(error);
    }
    remove_metadata(&paths.data.join(PENDING))?;
    remove_metadata(&paths.data.join(JOURNAL))?;
    Ok(Some(format!("recovery-archive-{}", journal.request.token)))
}

pub fn initialize(paths: &DataPaths) -> NativeResult<InitializedStorage> {
    let preparation = [&paths.config, &paths.data]
        .into_iter()
        .try_for_each(|path| {
            fs::create_dir_all(path)
                .map_err(|error| failure("Cannot create application storage directory", error))
        });
    let applied = preparation.and_then(|()| apply_pending(paths));
    let settings = if applied.is_ok() {
        SettingsStore::open(paths.config.join("settings.json"))
    } else {
        Err(invalid(
            "Original settings remain unopened after recovery preparation failed",
        ))
    };
    let database = if applied.is_ok() {
        Database::open(&paths.data.join("starter.sqlite3"))
    } else {
        Err(invalid(
            "Original database remains unopened after recovery preparation failed",
        ))
    };
    let reason = applied
        .as_ref()
        .err()
        .map(|error| error.message.clone())
        .or_else(|| settings.as_ref().err().map(|error| error.message.clone()))
        .or_else(|| database.as_ref().err().map(|error| error.message.clone()));
    if reason.is_none() {
        return Ok(InitializedStorage {
            settings: settings?,
            database: database?,
            recovery: RecoveryState {
                paths: paths.clone(),
                temporary: None,
                operation: Mutex::new(()),
                status: Mutex::new(RecoveryStatus {
                    active: false,
                    reason: None,
                    restored: false,
                    pending: false,
                    notes: 0,
                    archive_id: applied?,
                }),
            },
        });
    }
    let temporary = tempfile::Builder::new()
        .prefix("starter-recovery-")
        .tempdir()
        .map_err(|e| failure("Cannot create isolated recovery workspace", e))?;
    let isolated = Database::open(&temporary.path().join("recovery.sqlite3"))?;
    let mut restored = false;
    let mut notes = 0;
    if let Ok(database) = database {
        let directory = temporary.path().join("backups");
        if let Ok(info) = database.create_backup(&directory)
            && let Ok(result) = isolated.restore_backup(&directory, &info.id)
        {
            restored = true;
            notes = result.restored;
        }
    }
    Ok(InitializedStorage {
        settings: SettingsStore::open(temporary.path().join("settings.json"))?,
        database: isolated,
        recovery: RecoveryState {
            paths: paths.clone(),
            temporary: Some(temporary),
            operation: Mutex::new(()),
            status: Mutex::new(RecoveryStatus {
                active: true,
                reason,
                restored,
                pending: false,
                notes,
                archive_id: None,
            }),
        },
    })
}

impl RecoveryState {
    fn enter(&self) -> NativeResult<MutexGuard<'_, ()>> {
        self.operation.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => NativeError::new(
                ErrorCode::NativeBusy,
                "Another recovery operation is in progress",
            ),
            TryLockError::Poisoned(_) => invalid("Recovery operation is unavailable"),
        })
    }
    pub fn is_isolated(&self) -> bool {
        self.temporary.is_some()
    }
    pub fn wallpaper_path(&self) -> PathBuf {
        self.temporary.as_ref().map_or_else(
            || self.paths.data.join("wallpapers.json"),
            |directory| directory.path().join("wallpapers.json"),
        )
    }
    pub fn workbench_root(&self) -> PathBuf {
        self.temporary.as_ref().map_or_else(
            || self.paths.data.join("workbench"),
            |directory| directory.path().join("workbench"),
        )
    }
    fn report(&self) -> NativeResult<RecoveryStatus> {
        self.status
            .lock()
            .map(|value| value.clone())
            .map_err(|_| invalid("Recovery status is unavailable"))
    }
    fn temporary_backups(&self) -> NativeResult<PathBuf> {
        self.temporary
            .as_ref()
            .map(|directory| directory.path().join("backups"))
            .ok_or_else(|| invalid("Recovery workspace is not active"))
    }
    fn backup_location(&self, id: &str) -> NativeResult<(PathBuf, String)> {
        if let Some(id) = id.strip_prefix("existing:") {
            Ok((self.paths.data.join("backups"), id.into()))
        } else {
            Ok((self.temporary_backups()?, id.into()))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn recovery_status(state: tauri::State<'_, RecoveryState>) -> NativeResult<RecoveryStatus> {
    state.report()
}

#[tauri::command]
#[specta::specta]
pub async fn list_recovery_backups(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NativeResult<Vec<BackupInfo>> {
    crate::commands::require_host_window(window.label())?;
    blocking::run(move || {
        let state = app.state::<RecoveryState>();
        state.temporary_backups()?;
        let directory = state.paths.data.join("backups");
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut items = app.state::<Database>().list_backups(&directory)?;
        for item in &mut items {
            item.id = format!("existing:{}", item.id);
        }
        Ok(items)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn pick_recovery_backup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NativeResult<Option<BackupPreview>> {
    crate::commands::require_host_window(window.label())?;
    blocking::run(move || {
        let state = app.state::<RecoveryState>();
        let directory = state.temporary_backups()?;
        let Some(contents) = crate::workbench::pick_text_content(&app, BACKUP_LIMIT)? else {
            return Ok(None);
        };
        app.state::<Database>()
            .import_backup(&directory, &contents)
            .map(Some)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_recovery_backup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> NativeResult<BackupPreview> {
    crate::commands::require_host_window(window.label())?;
    blocking::run(move || {
        let state = app.state::<RecoveryState>();
        let database = app.state::<Database>();
        state.temporary_backups()?;
        let (directory, backup_id) = state.backup_location(&id)?;
        let mut preview = database.preview_backup(&directory, &backup_id)?;
        preview.info.id = id;
        Ok(preview)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn restore_recovery_backup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> NativeResult<RecoveryStatus> {
    crate::commands::require_host_window(window.label())?;
    blocking::run(move || {
        let state = app.state::<RecoveryState>();
        let _operation = state.enter()?;
        let status = state.report()?;
        if !status.active || status.pending {
            return Err(invalid(
                "Recovery workspace is not available for another trial restore",
            ));
        }
        let database = app.state::<Database>();
        let directory = state.temporary_backups()?;
        let (source, id) = state.backup_location(&id)?;
        let imported = database.copy_backup(&source, &directory, &id)?;
        let result = database.restore_backup(&directory, &imported.info.id)?;
        let mut status = state
            .status
            .lock()
            .map_err(|_| invalid("Recovery status is unavailable"))?;
        status.restored = true;
        status.notes = result.restored;
        Ok(status.clone())
    })
    .await
}

fn stage(
    state: &RecoveryState,
    database: &Database,
    settings: &SettingsStore,
    reset_settings: bool,
) -> NativeResult<RecoveryStatus> {
    let _operation = state.enter()?;
    let status = state.report()?;
    if !status.active || !status.restored {
        return Err(invalid(
            "Preview and restore a backup in the isolated workspace first",
        ));
    }
    if status.pending {
        return Err(invalid(
            "Recovery is already scheduled; restart before making another replacement",
        ));
    }
    if state.paths.data.join(JOURNAL).exists() {
        return Err(invalid(
            "An interrupted recovery must be reviewed before scheduling another replacement",
        ));
    }
    protect_future(&state.paths, reset_settings)?;
    let temporary = tempfile::Builder::new()
        .prefix(".recovery-token-")
        .tempfile_in(&state.paths.data)
        .map_err(|e| failure("Cannot stage recovery in the original data directory", e))?;
    let token = temporary
        .path()
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(".recovery-token-"))
        .ok_or_else(|| invalid("Invalid recovery token"))?
        .to_owned();
    validate_token(&token)?;
    let directory = state.temporary_backups()?;
    let backup = database.create_backup(&directory)?;
    let path = candidate(&state.paths, &token, false);
    let staged = Database::open(&path)?;
    staged.restore_backup(&directory, &backup.id)?;
    drop(staged);
    let connection =
        Connection::open(&path).map_err(|e| failure("Cannot finalize recovery database", e))?;
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
        .map_err(|e| failure("Cannot finalize recovery journal", e))?;
    drop(connection);
    verify_database(&path)?;
    if reset_settings {
        let snapshot = settings.snapshot()?;
        write_json(&candidate(&state.paths, &token, true), &snapshot)?;
    }
    write_json(
        &state.paths.data.join(PENDING),
        &Pending {
            token,
            reset_settings,
        },
    )?;
    let mut status = state
        .status
        .lock()
        .map_err(|_| invalid("Recovery status is unavailable"))?;
    status.pending = true;
    Ok(status.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn stage_recovery(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    reset_settings: bool,
) -> NativeResult<RecoveryStatus> {
    crate::commands::require_host_window(window.label())?;
    blocking::run(move || {
        stage(
            &app.state::<RecoveryState>(),
            &app.state::<Database>(),
            &app.state::<SettingsStore>(),
            reset_settings,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::NoteInput;

    fn fixture() -> (tempfile::TempDir, DataPaths) {
        let root = tempfile::tempdir().unwrap();
        let paths = DataPaths {
            config: root.path().join("config"),
            data: root.path().join("data"),
            logs: root.path().join("logs"),
        };
        for path in [&paths.config, &paths.data, &paths.logs] {
            fs::create_dir(path).unwrap();
        }
        (root, paths)
    }

    fn recovered(paths: &DataPaths) -> InitializedStorage {
        fs::write(
            paths.data.join("starter.sqlite3"),
            b"original corrupt database",
        )
        .unwrap();
        let initialized = initialize(paths).unwrap();
        initialized
            .database
            .create(NoteInput {
                title: "Recovered".into(),
                body: "content from backup".into(),
            })
            .unwrap();
        initialized.recovery.status.lock().unwrap().restored = true;
        initialized
    }

    #[test]
    fn long_recovery_operations_do_not_lock_the_status_and_reject_overlapping_changes() {
        let (_root, paths) = fixture();
        let initialized = recovered(&paths);
        let state = &initialized.recovery;
        let operation = state.enter().unwrap();
        assert!(state.report().unwrap().restored);
        assert_eq!(
            stage(state, &initialized.database, &initialized.settings, false)
                .unwrap_err()
                .code,
            ErrorCode::NativeBusy
        );
        assert!(!state.report().unwrap().pending);
        assert!(!paths.data.join(PENDING).exists());
        drop(operation);
        assert!(
            stage(state, &initialized.database, &initialized.settings, false)
                .unwrap()
                .pending
        );
    }

    #[test]
    fn corrupt_storage_uses_an_isolated_database_and_only_replaces_after_restart() {
        let (_root, paths) = fixture();
        let initialized = recovered(&paths);
        assert!(initialized.recovery.report().unwrap().active);
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            b"original corrupt database"
        );
        stage(
            &initialized.recovery,
            &initialized.database,
            &initialized.settings,
            false,
        )
        .unwrap();
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            b"original corrupt database"
        );
        drop(initialized);
        let restarted = initialize(&paths).unwrap();
        let status = restarted.recovery.report().unwrap();
        assert!(!status.active);
        assert_eq!(
            restarted.database.get(1).unwrap().body,
            "content from backup"
        );
        assert_eq!(
            fs::read(
                paths
                    .data
                    .join(status.archive_id.unwrap())
                    .join("starter.sqlite3")
            )
            .unwrap(),
            b"original corrupt database"
        );
        assert!(!paths.data.join(PENDING).exists());
        assert!(!paths.data.join(JOURNAL).exists());
    }

    #[test]
    fn failed_replacement_restores_original_database_and_wal_sidecars() {
        let (_root, paths) = fixture();
        let initialized = recovered(&paths);
        stage(
            &initialized.recovery,
            &initialized.database,
            &initialized.settings,
            false,
        )
        .unwrap();
        drop(initialized);
        fs::write(paths.data.join("starter.sqlite3-wal"), b"original wal").unwrap();
        fs::write(paths.data.join("starter.sqlite3-shm"), b"original shm").unwrap();
        assert!(
            apply_pending_with(&paths, || Err(invalid("simulated installation failure"))).is_err()
        );
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            b"original corrupt database"
        );
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3-wal")).unwrap(),
            b"original wal"
        );
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3-shm")).unwrap(),
            b"original shm"
        );
        assert!(paths.data.join(PENDING).exists());
        assert!(!paths.data.join(JOURNAL).exists());
    }

    #[test]
    fn interrupted_installation_rolls_back_before_retrying() {
        let (_root, paths) = fixture();
        let initialized = recovered(&paths);
        stage(
            &initialized.recovery,
            &initialized.database,
            &initialized.settings,
            false,
        )
        .unwrap();
        drop(initialized);
        let request: Pending = json(&paths.data.join(PENDING)).unwrap();
        let journal = Journal {
            request,
            originals: vec!["starter.sqlite3".into()],
            installed: false,
        };
        let saved = archive(&paths, &journal.request.token, "starter.sqlite3").unwrap();
        fs::create_dir(saved.parent().unwrap()).unwrap();
        write_json(&paths.data.join(JOURNAL), &journal).unwrap();
        fs::rename(paths.data.join("starter.sqlite3"), &saved).unwrap();
        fs::rename(
            candidate(&paths, &journal.request.token, false),
            paths.data.join("starter.sqlite3"),
        )
        .unwrap();
        rollback(&paths, &journal).unwrap();
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            b"original corrupt database"
        );
        assert!(candidate(&paths, &journal.request.token, false).exists());
        assert!(!paths.data.join(JOURNAL).exists());
    }

    #[test]
    fn future_database_and_settings_are_never_downgraded() {
        let (_root, paths) = fixture();
        let database = Database::open(&paths.data.join("starter.sqlite3")).unwrap();
        drop(database);
        let connection = Connection::open(paths.data.join("starter.sqlite3")).unwrap();
        connection.pragma_update(None, "user_version", 99).unwrap();
        drop(connection);
        let original = fs::read(paths.data.join("starter.sqlite3")).unwrap();
        let initialized = initialize(&paths).unwrap();
        initialized.recovery.status.lock().unwrap().restored = true;
        assert!(
            stage(
                &initialized.recovery,
                &initialized.database,
                &initialized.settings,
                false
            )
            .is_err()
        );
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            original
        );
        assert!(!paths.data.join(PENDING).exists());
        fs::write(
            paths.config.join("settings.json"),
            r#"{"revision":1,"settings":{"schemaVersion":99}}"#,
        )
        .unwrap();
        assert!(protect_future(&paths, true).is_err());
    }

    #[test]
    fn malformed_pending_request_cannot_escape_the_storage_directory() {
        let (_root, paths) = fixture();
        fs::write(paths.data.join("starter.sqlite3"), b"keep").unwrap();
        write_json(
            &paths.data.join(PENDING),
            &Pending {
                token: "../../outside".into(),
                reset_settings: false,
            },
        )
        .unwrap();
        assert!(apply_pending(&paths).is_err());
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn explicit_settings_reset_archives_the_unreadable_original_before_replacement() {
        let (_root, paths) = fixture();
        let initialized = recovered(&paths);
        let original = vec![b'x'; 140 * 1024];
        fs::write(paths.config.join("settings.json"), &original).unwrap();
        stage(
            &initialized.recovery,
            &initialized.database,
            &initialized.settings,
            true,
        )
        .unwrap();
        assert_eq!(
            fs::read(paths.config.join("settings.json")).unwrap(),
            original
        );
        drop(initialized);
        let restarted = initialize(&paths).unwrap();
        let status = restarted.recovery.report().unwrap();
        assert!(!status.active);
        assert_eq!(
            fs::read(
                paths
                    .config
                    .join(status.archive_id.unwrap())
                    .join("settings.json")
            )
            .unwrap(),
            original
        );
        assert_eq!(
            restarted.settings.snapshot().unwrap().settings,
            serde_json::json!({})
        );
    }

    #[test]
    fn current_settings_schema_can_be_staged_and_recovered_without_losing_the_archive() {
        let (_root, paths) = fixture();
        let original = serde_json::json!({
            "revision": 7,
            "settings": {"schemaVersion": 3, "windowPosition": "center"},
        });
        let original_bytes = serde_json::to_vec(&original).unwrap();
        fs::write(paths.config.join("settings.json"), &original_bytes).unwrap();
        let initialized = recovered(&paths);
        let replacement = initialized
            .settings
            .save(
                serde_json::json!({"schemaVersion": 3, "windowPosition": "remember"}),
                initialized.settings.snapshot().unwrap().revision,
            )
            .unwrap();
        stage(
            &initialized.recovery,
            &initialized.database,
            &initialized.settings,
            true,
        )
        .unwrap();
        drop(initialized);

        let restarted = initialize(&paths).unwrap();
        let status = restarted.recovery.report().unwrap();
        assert!(!status.active);
        assert_eq!(restarted.settings.snapshot().unwrap(), replacement);
        assert_eq!(
            fs::read(
                paths
                    .config
                    .join(status.archive_id.unwrap())
                    .join("settings.json")
            )
            .unwrap(),
            original_bytes,
        );
    }

    #[test]
    fn next_settings_schema_is_rejected_in_originals_and_staged_candidates() {
        let (_root, paths) = fixture();
        let initialized = recovered(&paths);
        let future = serde_json::json!({"revision": 1, "settings": {"schemaVersion": 4}});
        write_json(&paths.config.join("settings.json"), &future).unwrap();
        assert!(protect_future(&paths, true).is_err());
        assert!(!paths.data.join(PENDING).exists());
        fs::remove_file(paths.config.join("settings.json")).unwrap();

        stage(
            &initialized.recovery,
            &initialized.database,
            &initialized.settings,
            true,
        )
        .unwrap();
        let pending: Pending = json(&paths.data.join(PENDING)).unwrap();
        write_json(&candidate(&paths, &pending.token, true), &future).unwrap();
        assert!(apply_pending(&paths).is_err());
        assert_eq!(
            fs::read(paths.data.join("starter.sqlite3")).unwrap(),
            b"original corrupt database"
        );
        assert!(paths.data.join(PENDING).exists());
        assert!(!paths.data.join(JOURNAL).exists());
    }

    #[test]
    fn invalid_settings_candidates_leave_originals_and_recovery_evidence_untouched() {
        for contents in [
            r#"{"revision":1,"settings":{"runInBackground":"yes"}}"#.to_owned(),
            format!(
                "{}{}",
                r#"{"revision":1,"settings":{}}"#,
                " ".repeat(MAX_SETTINGS_FILE_SIZE)
            ),
        ] {
            let (_root, paths) = fixture();
            let original_settings = br#"{"revision":7,"settings":{"windowPosition":"center"}}"#;
            fs::write(paths.config.join("settings.json"), original_settings).unwrap();
            let initialized = recovered(&paths);
            stage(
                &initialized.recovery,
                &initialized.database,
                &initialized.settings,
                true,
            )
            .unwrap();
            drop(initialized);
            let pending_bytes = fs::read(paths.data.join(PENDING)).unwrap();
            let pending: Pending = serde_json::from_slice(&pending_bytes).unwrap();
            let settings_path = candidate(&paths, &pending.token, true);
            fs::write(&settings_path, &contents).unwrap();

            assert_eq!(
                apply_pending(&paths).unwrap_err().code,
                ErrorCode::StorageCorrupt
            );
            assert_eq!(fs::read_to_string(&settings_path).unwrap(), contents);
            assert_eq!(
                fs::read(paths.config.join("settings.json")).unwrap(),
                original_settings
            );
            assert_eq!(
                fs::read(paths.data.join("starter.sqlite3")).unwrap(),
                b"original corrupt database"
            );
            assert_eq!(fs::read(paths.data.join(PENDING)).unwrap(), pending_bytes);
            assert!(!paths.data.join(JOURNAL).exists());
            assert_eq!(fs::read_dir(&paths.config).unwrap().count(), 2);
        }
    }

    #[test]
    fn unwritable_log_destination_does_not_isolate_valid_application_data() {
        let (_root, paths) = fixture();
        let database = Database::open(&paths.data.join("starter.sqlite3")).unwrap();
        database
            .create(NoteInput {
                title: "Retained".into(),
                body: "Original database".into(),
            })
            .unwrap();
        drop(database);
        fs::remove_dir(&paths.logs).unwrap();
        fs::write(&paths.logs, b"a file blocks the log directory").unwrap();
        let initialized = initialize(&paths).unwrap();
        assert!(!initialized.recovery.report().unwrap().active);
        assert_eq!(
            initialized.database.get(1).unwrap().body,
            "Original database"
        );
        assert_eq!(
            fs::read(&paths.logs).unwrap(),
            b"a file blocks the log directory"
        );
    }
}
