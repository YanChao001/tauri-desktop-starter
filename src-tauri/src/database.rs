use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::Mutex,
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{ErrorCode, NativeError, NativeResult, bounded_text};

#[derive(Debug, Clone, Deserialize, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i32,
    pub title: String,
    pub body: String,
    pub updated_at: String,
    pub version: i32,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdate {
    pub id: i32,
    pub title: String,
    pub body: String,
    pub expected_version: i32,
}

pub struct Database(Mutex<Connection>);

/// 外部导入限额；应用自身的完整快照随已接受的数据增长。
pub const BACKUP_LIMIT: usize = 16 * 1024 * 1024;
pub const DATABASE_SCHEMA_VERSION: i32 = 2;

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteQuery {
    pub search: String,
    pub offset: u32,
    pub limit: u32,
    pub sort: String,
    pub trash: bool,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotePage {
    pub items: Vec<Note>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    pub id: i32,
    pub expected_version: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub note_id: Option<i32>,
    pub title: String,
    pub body: String,
    pub expected_version: Option<i32>,
    pub original_title: String,
    pub original_body: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub created_at: String,
    pub notes: u32,
    pub trashed: u32,
    pub drafts: u32,
    pub bytes: f64,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub info: BackupInfo,
    pub schema_version: i32,
    pub sample_titles: Vec<String>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: u32,
    pub safety_backup: BackupInfo,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchivedNote {
    note: Note,
    deleted_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchivedDraft {
    window_label: String,
    draft: NoteDraft,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupDocument {
    format: String,
    schema_version: i32,
    created_at: String,
    notes: Vec<ArchivedNote>,
    drafts: Vec<ArchivedDraft>,
}

fn database_error(error: rusqlite::Error) -> NativeError {
    NativeError::operation(ErrorCode::DatabaseError, "Database operation failed", error)
}

fn validate_note(title: &str, body: &str) -> NativeResult<()> {
    bounded_text(title, 800, "Title")?;
    if title.chars().count() > 200 {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Title exceeds 200 characters",
        ));
    }
    bounded_text(body, 64 * 1024, "Body")?;
    if title.trim().is_empty() {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Title cannot be empty",
        ));
    }
    Ok(())
}

fn validate_identity(id: i32, expected_version: Option<i32>) -> NativeResult<()> {
    if id <= 0 || expected_version.is_some_and(|version| version <= 0) {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Note ID and version must be positive integers",
        ));
    }
    Ok(())
}

fn row_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        updated_at: row.get(3)?,
        version: row.get(4)?,
    })
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn corrupt_json(message: &str, error: serde_json::Error) -> NativeError {
    // 解析错误可能包含原始字段值；诊断仅保留位置，不记录笔记或草稿正文。
    NativeError::operation(
        ErrorCode::StorageCorrupt,
        message,
        format!("line {}, column {}", error.line(), error.column()),
    )
}

fn validate_draft(draft: &NoteDraft) -> NativeResult<()> {
    if draft.note_id.is_some() != draft.expected_version.is_some() {
        return Err(invalid(
            "Draft identity and version must be provided together",
        ));
    }
    if let Some(id) = draft.note_id {
        validate_identity(id, draft.expected_version)?;
    }
    for title in [&draft.title, &draft.original_title] {
        bounded_text(title, 800, "Draft title")?;
        if title.chars().count() > 200 {
            return Err(invalid("Draft title exceeds 200 characters"));
        }
    }
    bounded_text(&draft.body, 64 * 1024, "Draft body")?;
    bounded_text(&draft.original_body, 64 * 1024, "Original draft body")?;
    Ok(())
}

fn validate_label(label: &str) -> NativeResult<()> {
    if label.is_empty()
        || label.len() > 64
        || !label
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid("Invalid draft window label"));
    }
    Ok(())
}

fn decode_backup(contents: &str) -> NativeResult<BackupDocument> {
    let document: BackupDocument = serde_json::from_str(contents)
        .map_err(|error| corrupt_json("Invalid notes backup", error))?;
    validate_backup(&document)?;
    Ok(document)
}

fn validate_backup(document: &BackupDocument) -> NativeResult<()> {
    if document.format != "tauri-desktop-notes"
        || document.schema_version != DATABASE_SCHEMA_VERSION
    {
        return Err(invalid("Unsupported notes backup format or schema version"));
    }
    bounded_text(&document.created_at, 64, "Backup date")?;
    let mut ids = HashSet::new();
    for archived in &document.notes {
        let note = &archived.note;
        validate_identity(note.id, Some(note.version))?;
        validate_note(&note.title, &note.body)?;
        bounded_text(&note.updated_at, 64, "Note date")?;
        if let Some(date) = &archived.deleted_at {
            bounded_text(date, 64, "Deletion date")?;
        }
        if !ids.insert(note.id) {
            return Err(invalid("Backup contains duplicate note IDs"));
        }
    }
    let mut labels = HashSet::new();
    for archived in &document.drafts {
        validate_label(&archived.window_label)?;
        validate_draft(&archived.draft)?;
        if !labels.insert(&archived.window_label) {
            return Err(invalid("Backup contains duplicate draft windows"));
        }
    }
    Ok(())
}

fn snapshot(connection: &Connection) -> NativeResult<BackupDocument> {
    let mut statement = connection
        .prepare("SELECT id,title,body,updated_at,version,deleted_at FROM notes ORDER BY id")
        .map_err(database_error)?;
    let notes = statement
        .query_map([], |row| {
            Ok(ArchivedNote {
                note: row_note(row)?,
                deleted_at: row.get(5)?,
            })
        })
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    let mut statement = connection
        .prepare("SELECT window_label,document FROM note_drafts ORDER BY window_label")
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    let drafts = rows
        .into_iter()
        .map(|(window_label, document)| {
            serde_json::from_str(&document)
                .map(|draft| ArchivedDraft {
                    window_label,
                    draft,
                })
                .map_err(|error| corrupt_json("Cannot read saved draft", error))
        })
        .collect::<NativeResult<Vec<_>>>()?;
    let created_at = connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })
        .map_err(database_error)?;
    Ok(BackupDocument {
        format: "tauri-desktop-notes".into(),
        schema_version: DATABASE_SCHEMA_VERSION,
        created_at,
        notes,
        drafts,
    })
}

fn backup_info(id: &str, document: &BackupDocument, bytes: usize) -> BackupInfo {
    let trashed = document
        .notes
        .iter()
        .filter(|note| note.deleted_at.is_some())
        .count() as u32;
    BackupInfo {
        id: id.into(),
        created_at: document.created_at.clone(),
        notes: document.notes.len() as u32 - trashed,
        trashed,
        drafts: document.drafts.len() as u32,
        bytes: bytes as f64,
    }
}

fn backup_id(id: &str) -> NativeResult<()> {
    let stem = id
        .strip_prefix("notes-backup-")
        .and_then(|value| value.strip_suffix(".json"));
    if !stem.is_some_and(|value| {
        !value.is_empty()
            && value.len() < 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }) {
        return Err(invalid("Invalid backup ID"));
    }
    Ok(())
}

fn backup_directory(directory: &Path) -> NativeResult<()> {
    fs::create_dir_all(directory).map_err(|error| {
        NativeError::operation(
            ErrorCode::StorageIo,
            "Cannot create backup directory",
            error,
        )
    })?;
    let metadata = fs::symlink_metadata(directory).map_err(|error| {
        NativeError::operation(
            ErrorCode::StorageIo,
            "Cannot inspect backup directory",
            error,
        )
    })?;
    if !metadata.is_dir() || metadata.is_symlink() {
        return Err(invalid("Backup directory must be a real directory"));
    }
    Ok(())
}

fn persist_backup(directory: &Path, document: &BackupDocument) -> NativeResult<BackupInfo> {
    validate_backup(document)?;
    let contents = serde_json::to_string_pretty(document).map_err(|error| {
        NativeError::operation(ErrorCode::Internal, "Cannot encode notes backup", error)
    })?;
    backup_directory(directory)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".notes-pending-")
        .tempfile_in(directory)
        .map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot create notes backup", error)
        })?;
    temporary
        .write_all(contents.as_bytes())
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot write notes backup", error)
        })?;
    let token = temporary
        .path()
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(".notes-pending-"))
        .ok_or_else(|| invalid("Invalid temporary backup name"))?;
    let id = format!("notes-backup-{token}.json");
    temporary
        .persist_noclobber(directory.join(&id))
        .map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot commit notes backup", error)
        })?;
    Ok(backup_info(&id, document, contents.len()))
}

fn read_backup(directory: &Path, id: &str) -> NativeResult<String> {
    backup_id(id)?;
    backup_directory(directory)?;
    let path = directory.join(id);
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        NativeError::operation(ErrorCode::StorageIo, "Cannot inspect notes backup", error)
    })?;
    if !metadata.is_file() || metadata.is_symlink() {
        return Err(invalid("Backup must be a regular file"));
    }
    // 此目录中的受控 ID 来自已生成 / 导入的备份，不套用外部导入额度。
    let mut contents = String::new();
    File::open(path)
        .and_then(|mut file| file.read_to_string(&mut contents))
        .map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot read notes backup", error)
        })?;
    Ok(contents)
}

impl Database {
    pub fn open(path: &Path) -> NativeResult<Self> {
        let mut connection = Connection::open(path).map_err(database_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(database_error)?;
        let version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(database_error)?;
        if version > DATABASE_SCHEMA_VERSION {
            return Err(NativeError::new(
                ErrorCode::StorageCorrupt,
                "Database was created by a newer application version",
            ));
        }
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(database_error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(database_error)?;
        if version == 0 {
            let transaction = connection.transaction().map_err(database_error)?;
            transaction
                .execute_batch(
                    "CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id <= 2147483647),
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0 AND version <= 2147483647)
            ); PRAGMA user_version = 1;",
                )
                .map_err(database_error)?;
            transaction.commit().map_err(database_error)?;
        }
        if version < 2 {
            let transaction = connection.transaction().map_err(database_error)?;
            transaction.execute_batch(
                "ALTER TABLE notes ADD COLUMN deleted_at TEXT;
                 CREATE TABLE note_drafts (window_label TEXT PRIMARY KEY NOT NULL, document TEXT NOT NULL);
                 CREATE INDEX notes_active_updated ON notes(deleted_at,updated_at DESC,id DESC);
                 PRAGMA user_version = 2;",
            ).map_err(database_error)?;
            transaction.commit().map_err(database_error)?;
        }
        Ok(Self(Mutex::new(connection)))
    }

    fn lock(&self) -> NativeResult<std::sync::MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Database lock is unavailable"))
    }

    pub fn version(&self) -> NativeResult<i32> {
        self.lock()?
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(database_error)
    }

    pub fn create(&self, input: NoteInput) -> NativeResult<Note> {
        validate_note(&input.title, &input.body)?;
        let connection = self.lock()?;
        connection.query_row("INSERT INTO notes(title,body) VALUES(?1,?2) RETURNING id,title,body,updated_at,version", params![input.title.trim(), input.body], row_note).map_err(database_error)
    }

    pub fn update(&self, input: NoteUpdate) -> NativeResult<Note> {
        validate_identity(input.id, Some(input.expected_version))?;
        validate_note(&input.title, &input.body)?;
        let connection = self.lock()?;
        let note = connection.query_row("UPDATE notes SET title=?1,body=?2,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?3 AND version=?4 AND deleted_at IS NULL RETURNING id,title,body,updated_at,version", params![input.title.trim(), input.body, input.id, input.expected_version], row_note).optional().map_err(database_error)?;
        match note {
            Some(note) => Ok(note),
            None => {
                let exists: bool = connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM notes WHERE id=?1 AND deleted_at IS NULL)",
                        params![input.id],
                        |row| row.get(0),
                    )
                    .map_err(database_error)?;
                Err(NativeError::new(
                    if exists {
                        ErrorCode::Conflict
                    } else {
                        ErrorCode::NotFound
                    },
                    if exists {
                        "Note changed in another window; reload before saving"
                    } else {
                        "Note not found"
                    },
                ))
            }
        }
    }

    pub fn get(&self, id: i32) -> NativeResult<Note> {
        validate_identity(id, None)?;
        self.lock()?.query_row("SELECT id,title,body,updated_at,version FROM notes WHERE id=?1 AND deleted_at IS NULL", [id], row_note).optional().map_err(database_error)?.ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Note not found"))
    }

    pub fn query(&self, query: NoteQuery) -> NativeResult<NotePage> {
        bounded_text(&query.search, 200, "Search")?;
        if query.limit == 0 || query.limit > 100 {
            return Err(invalid("Page size must be between 1 and 100"));
        }
        let order = match query.sort.as_str() {
            "updated-desc" => "updated_at DESC,id DESC",
            "updated-asc" => "updated_at ASC,id ASC",
            "title-asc" => "title COLLATE NOCASE ASC,id ASC",
            _ => return Err(invalid("Unsupported note sort")),
        };
        let connection = self.lock()?;
        let total = connection.query_row("SELECT COUNT(*) FROM notes WHERE (deleted_at IS NOT NULL)=?1 AND (instr(lower(title),lower(?2))>0 OR instr(lower(body),lower(?2))>0)", params![query.trash, query.search], |row| row.get(0)).map_err(database_error)?;
        let mut statement = connection.prepare(&format!("SELECT id,title,body,updated_at,version FROM notes WHERE (deleted_at IS NOT NULL)=?1 AND (instr(lower(title),lower(?2))>0 OR instr(lower(body),lower(?2))>0) ORDER BY {order} LIMIT ?3 OFFSET ?4")).map_err(database_error)?;
        let items = statement
            .query_map(
                params![query.trash, query.search, query.limit, query.offset],
                row_note,
            )
            .map_err(database_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(database_error)?;
        Ok(NotePage {
            items,
            total,
            offset: query.offset,
            limit: query.limit,
        })
    }

    /// 整批校验与写入处于同一事务；任意版本冲突都不修改其中任何记录。
    pub fn change_notes(&self, items: Vec<NoteVersion>, action: &str) -> NativeResult<()> {
        if items.is_empty() || items.len() > 100 {
            return Err(invalid("Select between 1 and 100 notes"));
        }
        let sql = match action {
            "trash" => {
                "UPDATE notes SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id=?1 AND version=?2 AND deleted_at IS NULL"
            }
            "restore" => {
                "UPDATE notes SET deleted_at=NULL,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND version=?2 AND deleted_at IS NOT NULL"
            }
            "purge" => "DELETE FROM notes WHERE id=?1 AND version=?2 AND deleted_at IS NOT NULL",
            _ => return Err(invalid("Unsupported note action")),
        };
        let mut ids = HashSet::new();
        for item in &items {
            validate_identity(item.id, Some(item.expected_version))?;
            if !ids.insert(item.id) {
                return Err(invalid("Duplicate note IDs"));
            }
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(database_error)?;
        for item in items {
            if transaction
                .execute(sql, params![item.id, item.expected_version])
                .map_err(database_error)?
                != 1
            {
                return Err(NativeError::new(
                    ErrorCode::Conflict,
                    "A selected note changed; refresh before retrying",
                ));
            }
        }
        transaction.commit().map_err(database_error)
    }

    pub fn load_draft(&self, label: &str) -> NativeResult<Option<NoteDraft>> {
        validate_label(label)?;
        let contents: Option<String> = self
            .lock()?
            .query_row(
                "SELECT document FROM note_drafts WHERE window_label=?1",
                [label],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)?;
        contents
            .map(|contents| {
                serde_json::from_str(&contents)
                    .map_err(|error| corrupt_json("Cannot read saved draft", error))
            })
            .transpose()
    }

    pub fn save_draft(&self, label: &str, draft: Option<NoteDraft>) -> NativeResult<()> {
        validate_label(label)?;
        let connection = self.lock()?;
        if let Some(draft) = draft {
            validate_draft(&draft)?;
            let contents = serde_json::to_string(&draft).map_err(|error| {
                NativeError::operation(ErrorCode::Internal, "Cannot encode draft", error)
            })?;
            connection.execute("INSERT INTO note_drafts(window_label,document) VALUES(?1,?2) ON CONFLICT(window_label) DO UPDATE SET document=excluded.document", params![label, contents]).map_err(database_error)?;
        } else {
            connection
                .execute("DELETE FROM note_drafts WHERE window_label=?1", [label])
                .map_err(database_error)?;
        }
        Ok(())
    }

    pub fn create_backup(&self, directory: &Path) -> NativeResult<BackupInfo> {
        let document = {
            let mut connection = self.lock()?;
            let transaction = connection.transaction().map_err(database_error)?;
            let document = snapshot(&transaction)?;
            transaction.commit().map_err(database_error)?;
            document
        };
        persist_backup(directory, &document)
    }

    pub fn export_backup(&self, directory: &Path, id: &str) -> NativeResult<String> {
        let contents = read_backup(directory, id)?;
        decode_backup(&contents)?;
        Ok(contents)
    }

    pub fn preview_backup(&self, directory: &Path, id: &str) -> NativeResult<BackupPreview> {
        let contents = read_backup(directory, id)?;
        let document = decode_backup(&contents)?;
        Ok(BackupPreview {
            info: backup_info(id, &document, contents.len()),
            schema_version: document.schema_version,
            sample_titles: document
                .notes
                .iter()
                .take(5)
                .map(|entry| entry.note.title.clone())
                .collect(),
        })
    }

    pub fn import_backup(&self, directory: &Path, contents: &str) -> NativeResult<BackupPreview> {
        if contents.len() > BACKUP_LIMIT {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Imported backup exceeds 16 MiB",
            ));
        }
        let document = decode_backup(contents)?;
        if document.notes.len() > 50_000 || document.drafts.len() > 128 {
            return Err(invalid("Imported backup contains too many records"));
        }
        self.persist_preview(directory, &document)
    }

    /// 仅复制应用备份目录中的受控备份；外部文本须经过 import_backup 限额。
    pub fn copy_backup(
        &self,
        source: &Path,
        destination: &Path,
        id: &str,
    ) -> NativeResult<BackupPreview> {
        let document = decode_backup(&read_backup(source, id)?)?;
        self.persist_preview(destination, &document)
    }

    fn persist_preview(
        &self,
        directory: &Path,
        document: &BackupDocument,
    ) -> NativeResult<BackupPreview> {
        let info = persist_backup(directory, document)?;
        Ok(BackupPreview {
            info,
            schema_version: document.schema_version,
            sample_titles: document
                .notes
                .iter()
                .take(5)
                .map(|entry| entry.note.title.clone())
                .collect(),
        })
    }

    pub fn list_backups(&self, directory: &Path) -> NativeResult<Vec<BackupInfo>> {
        backup_directory(directory)?;
        let mut result = Vec::new();
        for entry in fs::read_dir(directory).map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot list notes backups", error)
        })? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    log::warn!(
                        "Skipping unreadable notes backup entry: {}",
                        crate::redaction::redact(&error.to_string())
                    );
                    continue;
                }
            };
            let id = entry.file_name().to_string_lossy().into_owned();
            if backup_id(&id).is_ok() {
                match self.preview_backup(directory, &id) {
                    Ok(preview) => result.push(preview.info),
                    Err(error) => log::warn!("Skipping unavailable notes backup {id}: {error}"),
                }
            }
        }
        result.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(result)
    }

    pub fn restore_backup(&self, directory: &Path, id: &str) -> NativeResult<RestoreResult> {
        let document = decode_backup(&read_backup(directory, id)?)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(database_error)?;
        let current = snapshot(&transaction)?;
        let ceiling = current
            .notes
            .iter()
            .chain(&document.notes)
            .map(|entry| entry.note.version)
            .max()
            .unwrap_or(0);
        let version = ceiling
            .checked_add(1)
            .ok_or_else(|| invalid("Note version limit reached; restore was not started"))?;
        let safety_backup = persist_backup(directory, &current)?;
        transaction
            .execute_batch("DELETE FROM note_drafts; DELETE FROM notes;")
            .map_err(database_error)?;
        for entry in &document.notes {
            let note = &entry.note;
            transaction.execute("INSERT INTO notes(id,title,body,updated_at,version,deleted_at) VALUES(?1,?2,?3,?4,?5,?6)", params![note.id, note.title, note.body, note.updated_at, version, entry.deleted_at]).map_err(database_error)?;
        }
        for entry in &document.drafts {
            let mut draft = entry.draft.clone();
            if document.notes.iter().any(|entry| {
                Some(entry.note.id) == draft.note_id
                    && Some(entry.note.version) == draft.expected_version
                    && entry.note.title == draft.original_title
                    && entry.note.body == draft.original_body
            }) {
                draft.expected_version = Some(version);
            }
            let contents = serde_json::to_string(&draft).map_err(|error| {
                NativeError::operation(ErrorCode::Internal, "Cannot encode restored draft", error)
            })?;
            transaction
                .execute(
                    "INSERT INTO note_drafts(window_label,document) VALUES(?1,?2)",
                    params![entry.window_label, contents],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(RestoreResult {
            restored: document.notes.len() as u32,
            safety_backup,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search(db: &Database, text: &str) -> NotePage {
        db.query(NoteQuery {
            search: text.into(),
            ..query(0, false)
        })
        .unwrap()
    }

    #[test]
    fn migration_crud_and_reopen_preserve_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("notes.db");
        let db = Database::open(&path).unwrap();
        assert_eq!(db.version().unwrap(), 2);
        let note = db
            .create(NoteInput {
                title: "  Test  ".into(),
                body: "body".into(),
            })
            .unwrap();
        assert_eq!(note.title, "Test");
        assert_eq!(search(&db, "body").items, vec![note.clone()]);
        let next = db
            .update(NoteUpdate {
                id: note.id,
                title: "Changed".into(),
                body: "new".into(),
                expected_version: note.version,
            })
            .unwrap();
        assert_eq!(next.version, 2);
        assert_eq!(
            db.update(NoteUpdate {
                id: note.id,
                title: "lost".into(),
                body: "".into(),
                expected_version: 1
            })
            .unwrap_err()
            .code,
            ErrorCode::Conflict
        );
        drop(db);
        let reopened = Database::open(&path).unwrap();
        assert_eq!(search(&reopened, "").items, vec![next.clone()]);
        let selected = || {
            vec![NoteVersion {
                id: note.id,
                expected_version: next.version,
            }]
        };
        reopened.change_notes(selected(), "trash").unwrap();
        assert!(search(&reopened, "").items.is_empty());
        assert_eq!(
            reopened.change_notes(selected(), "trash").unwrap_err().code,
            ErrorCode::Conflict
        );
    }

    #[test]
    fn user_text_is_data_and_limits_are_enforced() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let injected = "'; DROP TABLE notes;--";
        db.create(NoteInput {
            title: injected.into(),
            body: injected.into(),
        })
        .unwrap();
        assert_eq!(search(&db, injected).total, 1);
        assert_eq!(search(&db, "%").total, 0);
        assert!(
            db.create(NoteInput {
                title: " ".into(),
                body: "".into()
            })
            .is_err()
        );
        assert!(
            db.create(NoteInput {
                title: "a".repeat(201),
                body: "".into()
            })
            .is_err()
        );
        assert_eq!(search(&db, "").total, 1);
        assert!(
            db.create(NoteInput {
                title: "中".repeat(200),
                body: String::new()
            })
            .is_ok()
        );
    }

    #[test]
    fn newer_database_is_rejected_without_changing_its_contents() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("future.db");
        let connection = Connection::open(&path).unwrap();
        connection.pragma_update(None, "user_version", 3).unwrap();
        drop(connection);
        let original = std::fs::read(&path).unwrap();
        assert!(matches!(
            Database::open(&path),
            Err(NativeError {
                code: ErrorCode::StorageCorrupt,
                ..
            })
        ));
        assert_eq!(std::fs::read(path).unwrap(), original);
    }

    #[test]
    fn invalid_note_ids_and_versions_are_rejected_before_mutation() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let note = db
            .create(NoteInput {
                title: "Keep".into(),
                body: "".into(),
            })
            .unwrap();
        for (id, expected_version) in [(0, 1), (-1, 1), (note.id, 0), (note.id, -1)] {
            assert_eq!(
                db.update(NoteUpdate {
                    id,
                    title: "Invalid".into(),
                    body: "".into(),
                    expected_version,
                })
                .unwrap_err()
                .code,
                ErrorCode::InvalidArgument
            );
        }
        for id in [0, -1] {
            assert_eq!(
                db.change_notes(
                    vec![NoteVersion {
                        id,
                        expected_version: 1
                    }],
                    "trash"
                )
                .unwrap_err()
                .code,
                ErrorCode::InvalidArgument
            );
        }
        assert_eq!(search(&db, "").items, vec![note]);
    }

    fn query(offset: u32, trash: bool) -> NoteQuery {
        NoteQuery {
            search: String::new(),
            offset,
            limit: 50,
            sort: "title-asc".into(),
            trash,
        }
    }

    #[test]
    fn version_one_migrates_without_losing_notes_and_preserves_future_protection() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("old.db");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE notes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL); INSERT INTO notes VALUES(1,'Existing','Keep','2026-01-01T00:00:00Z',7); PRAGMA user_version=1;").unwrap();
        drop(connection);
        let db = Database::open(&path).unwrap();
        assert_eq!(db.version().unwrap(), 2);
        assert_eq!(db.get(1).unwrap().body, "Keep");
        assert_eq!(db.get(1).unwrap().version, 7);
        assert_eq!(db.query(query(0, true)).unwrap().total, 0);
    }

    #[test]
    fn pagination_and_full_backup_include_every_record_past_two_hundred() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        for index in 0..251 {
            db.create(NoteInput {
                title: format!("Note {index:03}"),
                body: index.to_string(),
            })
            .unwrap();
        }
        assert_eq!(search(&db, "").total, 251);
        let mut ids = HashSet::new();
        for offset in [0, 50, 100, 150, 200, 250] {
            let page = db.query(query(offset, false)).unwrap();
            assert_eq!(page.total, 251);
            for note in page.items {
                assert!(ids.insert(note.id));
            }
        }
        assert_eq!(ids.len(), 251);
        let backups = temp.path().join("backups");
        let info = db.create_backup(&backups).unwrap();
        assert_eq!(info.notes, 251);
        let document = decode_backup(&db.export_backup(&backups, &info.id).unwrap()).unwrap();
        assert_eq!(document.notes.len(), 251);
        let restore = db.restore_backup(&backups, &info.id).unwrap();
        assert_eq!(restore.restored, 251);
        assert_eq!(search(&db, "").total, 251);
    }

    #[test]
    fn internal_backups_past_import_limit_remain_exportable_copyable_and_restorable() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("notes.db");
        let db = Database::open(&path).unwrap();
        let directory = temp.path().join("backups");
        let empty = db.create_backup(&directory).unwrap();
        let body = "x".repeat(64 * 1024);
        let count = BACKUP_LIMIT / body.len() + 1;
        for index in 0..count {
            db.create(NoteInput {
                title: format!("Note {index:03}"),
                body: body.clone(),
            })
            .unwrap();
        }
        let complete = db.create_backup(&directory).unwrap();
        assert!(complete.bytes > BACKUP_LIMIT as f64);
        assert_eq!(complete.notes, count as u32);
        let contents = db.export_backup(&directory, &complete.id).unwrap();
        let exported = temp.path().join("exported.json");
        crate::workbench::save_text_content_with_picker(&contents, contents.len(), || {
            Ok(Some(exported.clone()))
        })
        .unwrap();
        assert_eq!(fs::metadata(exported).unwrap().len(), contents.len() as u64);
        assert_eq!(
            db.import_backup(&directory, &contents).unwrap_err().code,
            ErrorCode::InputTooLong
        );
        drop(contents);
        drop(db);

        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.preview_backup(&directory, &complete.id)
                .unwrap()
                .info
                .notes,
            count as u32
        );
        let copied_directory = temp.path().join("isolated-backups");
        let copied = db
            .copy_backup(&directory, &copied_directory, &complete.id)
            .unwrap();
        assert_eq!(copied.info.notes, count as u32);
        let restored = db.restore_backup(&directory, &empty.id).unwrap();
        assert_eq!(search(&db, "").total, 0);
        assert_eq!(restored.safety_backup.notes, count as u32);
        assert!(restored.safety_backup.bytes > BACKUP_LIMIT as f64);
        db.restore_backup(&copied_directory, &copied.info.id)
            .unwrap();
        assert_eq!(search(&db, "").total, count as u32);
        assert_eq!(db.get(1).unwrap().body, body);
    }

    #[test]
    fn unavailable_backup_entries_do_not_hide_healthy_backups() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let directory = temp.path().join("backups");
        let healthy = db.create_backup(&directory).unwrap();
        let broken = directory.join("notes-backup-broken.json");
        fs::write(&broken, b"{incomplete").unwrap();
        fs::create_dir(directory.join("notes-backup-directory.json")).unwrap();
        let listed = db.list_backups(&directory).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, healthy.id);
        assert_eq!(fs::read(broken).unwrap(), b"{incomplete");
        assert!(
            db.preview_backup(&directory, "notes-backup-broken.json")
                .is_err()
        );
    }

    #[test]
    fn batch_conflict_rolls_back_all_deletes_and_trash_restores_with_new_versions() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let first = db
            .create(NoteInput {
                title: "First".into(),
                body: "a".into(),
            })
            .unwrap();
        let second = db
            .create(NoteInput {
                title: "Second".into(),
                body: "b".into(),
            })
            .unwrap();
        assert_eq!(
            db.change_notes(
                vec![
                    NoteVersion {
                        id: first.id,
                        expected_version: first.version
                    },
                    NoteVersion {
                        id: second.id,
                        expected_version: 99
                    }
                ],
                "trash"
            )
            .unwrap_err()
            .code,
            ErrorCode::Conflict
        );
        assert_eq!(search(&db, "").total, 2);
        db.change_notes(
            vec![NoteVersion {
                id: first.id,
                expected_version: first.version,
            }],
            "trash",
        )
        .unwrap();
        assert_eq!(db.query(query(0, true)).unwrap().total, 1);
        assert_eq!(db.get(first.id).unwrap_err().code, ErrorCode::NotFound);
        db.change_notes(
            vec![NoteVersion {
                id: first.id,
                expected_version: 2,
            }],
            "restore",
        )
        .unwrap();
        assert_eq!(db.get(first.id).unwrap().version, 3);
        assert_eq!(search(&db, "").total, 2);
    }

    #[test]
    fn restore_saves_current_data_first_and_invalid_import_never_mutates_it() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let old = db
            .create(NoteInput {
                title: "Old".into(),
                body: "snapshot".into(),
            })
            .unwrap();
        let backups = temp.path().join("backups");
        let archived = db.create_backup(&backups).unwrap();
        let newer = db
            .update(NoteUpdate {
                id: old.id,
                title: "Newer".into(),
                body: "must survive".into(),
                expected_version: old.version,
            })
            .unwrap();
        assert!(db.import_backup(&backups, "not json").is_err());
        let mut unsupported =
            decode_backup(&db.export_backup(&backups, &archived.id).unwrap()).unwrap();
        unsupported.schema_version = 99;
        assert!(
            db.import_backup(&backups, &serde_json::to_string(&unsupported).unwrap())
                .is_err()
        );
        assert_eq!(db.get(old.id).unwrap(), newer);
        let result = db.restore_backup(&backups, &archived.id).unwrap();
        assert_eq!(db.get(old.id).unwrap().title, "Old");
        assert!(db.get(old.id).unwrap().version > newer.version);
        let safety = decode_backup(
            &db.export_backup(&backups, &result.safety_backup.id)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(safety.notes[0].note.body, "must survive");
        db.restore_backup(&backups, &result.safety_backup.id)
            .unwrap();
        assert_eq!(db.get(old.id).unwrap().body, "must survive");
        assert_eq!(
            db.update(NoteUpdate {
                id: old.id,
                title: "Stale".into(),
                body: String::new(),
                expected_version: newer.version
            })
            .unwrap_err()
            .code,
            ErrorCode::Conflict
        );
    }

    #[test]
    fn drafts_are_isolated_per_window_persisted_and_included_in_backups() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("notes.db");
        let draft = NoteDraft {
            note_id: None,
            title: "Draft".into(),
            body: "not saved yet".into(),
            expected_version: None,
            original_title: String::new(),
            original_body: String::new(),
        };
        let db = Database::open(&path).unwrap();
        db.save_draft("main", Some(draft.clone())).unwrap();
        assert_eq!(db.load_draft("secondary").unwrap(), None);
        drop(db);
        let db = Database::open(&path).unwrap();
        assert_eq!(db.load_draft("main").unwrap(), Some(draft));
        let backup = db.create_backup(&temp.path().join("backups")).unwrap();
        assert_eq!(backup.drafts, 1);
        db.save_draft("main", None).unwrap();
        db.restore_backup(&temp.path().join("backups"), &backup.id)
            .unwrap();
        assert_eq!(
            db.load_draft("main").unwrap().unwrap().body,
            "not saved yet"
        );
    }

    #[test]
    fn restore_insert_failure_rolls_back_deletes_and_keeps_the_safety_backup() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let note = db
            .create(NoteInput {
                title: "Archived".into(),
                body: "old".into(),
            })
            .unwrap();
        let directory = temp.path().join("backups");
        let backup = db.create_backup(&directory).unwrap();
        let current = db
            .update(NoteUpdate {
                id: note.id,
                title: "Current".into(),
                body: "keep all of this".into(),
                expected_version: note.version,
            })
            .unwrap();
        db.lock().unwrap().execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON notes WHEN NEW.title='Archived' BEGIN SELECT RAISE(ABORT,'fixture restore failure'); END;").unwrap();
        assert!(db.restore_backup(&directory, &backup.id).is_err());
        assert_eq!(db.get(note.id).unwrap(), current);
        let backups = db.list_backups(&directory).unwrap();
        assert_eq!(backups.len(), 2);
        assert!(
            backups
                .iter()
                .filter(|info| info.id != backup.id)
                .any(|info| db
                    .export_backup(&directory, &info.id)
                    .unwrap()
                    .contains("keep all of this"))
        );
    }

    #[test]
    fn invalid_backup_ids_and_failed_safety_backups_leave_live_data_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("notes.db")).unwrap();
        let note = db
            .create(NoteInput {
                title: "Keep".into(),
                body: "unchanged".into(),
            })
            .unwrap();
        assert!(db.preview_backup(temp.path(), "../notes.db").is_err());
        let occupied = temp.path().join("not-a-directory");
        fs::write(&occupied, b"reserved").unwrap();
        assert!(db.create_backup(&occupied).is_err());
        assert_eq!(db.get(note.id).unwrap(), note);
        assert_eq!(fs::read(occupied).unwrap(), b"reserved");
    }
}
