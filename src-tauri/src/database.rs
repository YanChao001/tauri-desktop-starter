use std::{path::Path, sync::Mutex, time::Duration};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{ErrorCode, NativeError, NativeResult, bounded_text};

#[derive(Debug, Clone, Serialize, Type, PartialEq, Eq)]
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

fn row_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        updated_at: row.get(3)?,
        version: row.get(4)?,
    })
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
        if version > 1 {
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

    pub fn list(&self, search: &str) -> NativeResult<Vec<Note>> {
        bounded_text(search, 200, "Search")?;
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT id,title,body,updated_at,version FROM notes WHERE instr(lower(title),lower(?1)) > 0 OR instr(lower(body),lower(?1)) > 0 ORDER BY updated_at DESC,id DESC LIMIT 200").map_err(database_error)?;
        statement
            .query_map(params![search], row_note)
            .map_err(database_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(database_error)
    }

    pub fn create(&self, input: NoteInput) -> NativeResult<Note> {
        validate_note(&input.title, &input.body)?;
        let connection = self.lock()?;
        connection.query_row("INSERT INTO notes(title,body) VALUES(?1,?2) RETURNING id,title,body,updated_at,version", params![input.title.trim(), input.body], row_note).map_err(database_error)
    }

    pub fn update(&self, input: NoteUpdate) -> NativeResult<Note> {
        validate_note(&input.title, &input.body)?;
        let connection = self.lock()?;
        let note = connection.query_row("UPDATE notes SET title=?1,body=?2,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?3 AND version=?4 RETURNING id,title,body,updated_at,version", params![input.title.trim(), input.body, input.id, input.expected_version], row_note).optional().map_err(database_error)?;
        match note {
            Some(note) => Ok(note),
            None => {
                let exists: bool = connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM notes WHERE id=?1)",
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

    pub fn delete(&self, id: i32) -> NativeResult<()> {
        if self
            .lock()?
            .execute("DELETE FROM notes WHERE id=?1", params![id])
            .map_err(database_error)?
            == 0
        {
            return Err(NativeError::new(ErrorCode::NotFound, "Note not found"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_crud_and_reopen_preserve_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("notes.db");
        let db = Database::open(&path).unwrap();
        assert_eq!(db.version().unwrap(), 1);
        let note = db
            .create(NoteInput {
                title: "  Test  ".into(),
                body: "body".into(),
            })
            .unwrap();
        assert_eq!(note.title, "Test");
        assert_eq!(db.list("body").unwrap(), vec![note.clone()]);
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
        assert_eq!(reopened.list("").unwrap(), vec![next]);
        reopened.delete(note.id).unwrap();
        assert!(reopened.list("").unwrap().is_empty());
        assert_eq!(
            reopened.delete(note.id).unwrap_err().code,
            ErrorCode::NotFound
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
        assert_eq!(db.list(injected).unwrap().len(), 1);
        assert_eq!(db.list("%").unwrap().len(), 0);
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
        assert_eq!(db.list("").unwrap().len(), 1);
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
        connection.pragma_update(None, "user_version", 2).unwrap();
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
}
