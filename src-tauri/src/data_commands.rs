//! 数据管理的 IPC 边界；文件路径由原生对话框或应用数据目录决定。

use tauri::{Emitter, Manager};

use crate::{
    blocking,
    database::{
        BACKUP_LIMIT, BackupInfo, BackupPreview, Database, Note, NoteDraft, NotePage, NoteQuery,
        NoteVersion, RestoreResult,
    },
    error::NativeResult,
    storage::DataPaths,
};

fn backups(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.state::<DataPaths>().data.join("backups")
}

#[tauri::command]
#[specta::specta]
pub async fn query_notes(app: tauri::AppHandle, query: NoteQuery) -> NativeResult<NotePage> {
    blocking::run(move || app.state::<Database>().query(query)).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_note(app: tauri::AppHandle, id: i32) -> NativeResult<Note> {
    blocking::run(move || app.state::<Database>().get(id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn change_notes(
    app: tauri::AppHandle,
    items: Vec<NoteVersion>,
    action: String,
) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<Database>().change_notes(items, &action)?;
        let _ = app.emit("app://notes-changed", ());
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn load_note_draft(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NativeResult<Option<NoteDraft>> {
    let label = window.label().to_owned();
    blocking::run(move || app.state::<Database>().load_draft(&label)).await
}

#[tauri::command]
#[specta::specta]
pub async fn save_note_draft(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    draft: Option<NoteDraft>,
) -> NativeResult<()> {
    let label = window.label().to_owned();
    blocking::run(move || app.state::<Database>().save_draft(&label, draft)).await
}

#[tauri::command]
#[specta::specta]
pub async fn create_data_backup(app: tauri::AppHandle) -> NativeResult<BackupInfo> {
    blocking::run(move || app.state::<Database>().create_backup(&backups(&app))).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_data_backups(app: tauri::AppHandle) -> NativeResult<Vec<BackupInfo>> {
    blocking::run(move || app.state::<Database>().list_backups(&backups(&app))).await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_data_backup(app: tauri::AppHandle, id: String) -> NativeResult<BackupPreview> {
    blocking::run(move || app.state::<Database>().preview_backup(&backups(&app), &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn restore_data_backup(app: tauri::AppHandle, id: String) -> NativeResult<RestoreResult> {
    blocking::run(move || {
        let result = app
            .state::<Database>()
            .restore_backup(&backups(&app), &id)?;
        let _ = app.emit("app://notes-changed", ());
        Ok(result)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn export_data_backup(app: tauri::AppHandle, id: String) -> NativeResult<String> {
    blocking::run(move || app.state::<Database>().export_backup(&backups(&app), &id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn import_data_backup(
    app: tauri::AppHandle,
    contents: String,
) -> NativeResult<BackupPreview> {
    blocking::run(move || {
        app.state::<Database>()
            .import_backup(&backups(&app), &contents)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn pick_data_backup(app: tauri::AppHandle) -> NativeResult<Option<BackupPreview>> {
    blocking::run(move || {
        let Some(contents) = crate::workbench::pick_text_content(&app, BACKUP_LIMIT)? else {
            return Ok(None);
        };
        app.state::<Database>()
            .import_backup(&backups(&app), &contents)
            .map(Some)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn save_data_backup(app: tauri::AppHandle, id: String) -> NativeResult<bool> {
    blocking::run(move || {
        let contents = app.state::<Database>().export_backup(&backups(&app), &id)?;
        crate::workbench::save_text_content(&app, &id, &contents, contents.len())
            .map(|path| path.is_some())
    })
    .await
}
