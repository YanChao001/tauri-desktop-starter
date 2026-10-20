//! 文件工作台与任务中心的 IPC 参数边界，所有文件路径授权保留在 Rust。
use crate::{
    blocking,
    error::NativeResult,
    workbench::{
        self, RecentWorkbenchFile, WorkbenchDirectory, WorkbenchDocument, WorkbenchState,
        WorkbenchTask, WorkbenchTaskKind, WorkbenchTaskSnapshot,
    },
};
use tauri::Manager;

#[tauri::command]
#[specta::specta]
pub async fn pick_workbench_files(app: tauri::AppHandle) -> NativeResult<Vec<WorkbenchDocument>> {
    blocking::run(move || workbench::pick_files(&app)).await
}
#[tauri::command]
#[specta::specta]
pub async fn pick_workbench_directory(
    app: tauri::AppHandle,
) -> NativeResult<Option<WorkbenchDirectory>> {
    blocking::run(move || workbench::pick_directory(&app)).await
}
#[tauri::command]
#[specta::specta]
pub async fn load_workbench_document(
    app: tauri::AppHandle,
    id: String,
) -> NativeResult<WorkbenchDocument> {
    blocking::run(move || app.state::<WorkbenchState>().load(&id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn save_workbench_document(
    app: tauri::AppHandle,
    id: String,
    content: String,
    expected_revision: String,
) -> NativeResult<WorkbenchDocument> {
    blocking::run(move || {
        app.state::<WorkbenchState>()
            .save(&id, &content, &expected_revision)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn save_workbench_as(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> NativeResult<Option<WorkbenchDocument>> {
    blocking::run(move || workbench::save_as(&app, &name, &content)).await
}
#[tauri::command]
#[specta::specta]
pub fn recent_workbench_files(
    state: tauri::State<'_, WorkbenchState>,
) -> NativeResult<Vec<RecentWorkbenchFile>> {
    state.recent()
}
#[tauri::command]
#[specta::specta]
pub async fn reveal_workbench_file(app: tauri::AppHandle, id: String) -> NativeResult<()> {
    blocking::run(move || workbench::reveal(&app, &id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn start_workbench_task(
    app: tauri::AppHandle,
    kind: WorkbenchTaskKind,
    directory_id: String,
) -> NativeResult<WorkbenchTask> {
    blocking::run(move || {
        app.state::<WorkbenchState>()
            .start(kind, &directory_id, None, &app)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub fn workbench_task_snapshot(
    state: tauri::State<'_, WorkbenchState>,
) -> NativeResult<WorkbenchTaskSnapshot> {
    state.snapshot()
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_workbench_task(app: tauri::AppHandle, task_id: String) -> NativeResult<()> {
    blocking::run(move || app.state::<WorkbenchState>().cancel(&task_id, &app)).await
}
#[tauri::command]
#[specta::specta]
pub async fn retry_workbench_task(
    app: tauri::AppHandle,
    task_id: String,
) -> NativeResult<WorkbenchTask> {
    blocking::run(move || app.state::<WorkbenchState>().retry(&task_id, &app)).await
}
#[tauri::command]
#[specta::specta]
pub async fn export_workbench_task(
    app: tauri::AppHandle,
    task_id: String,
) -> NativeResult<Option<String>> {
    blocking::run(move || app.state::<WorkbenchState>().export(&task_id, &app)).await
}
