//! 用户明确选择的文件与目录工作台；路径授权、原子保存和后台任务由 Rust 持有。

use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;

use crate::{
    app_config::INTEGRATION,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    storage::atomic_write,
};

const TEXT_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 8 * 1024 * 1024;
const DIALOG_LIMIT: usize = 16 * 1024 * 1024;
const TASK_REPORT_LIMIT: usize = 64 * 1024 * 1024;
const TASK_PREVIEW_ENTRIES: usize = 200;
const MAX_TASK_FILES: usize = 5_000;
const MAX_TASK_DEPTH: usize = 32;
const MAX_HASH_FILE: u64 = 512 * 1024 * 1024;
const MAX_HISTORY: usize = 30;
const MAX_ACTIVE: usize = 2;
const MAX_QUEUED: usize = 10;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
pub const DROP_EVENT: &str = "app://workbench-drop";
pub const TASK_EVENT: &str = "app://workbench-tasks";

fn token(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        now(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}
fn now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
fn io_error(error: impl std::fmt::Display) -> NativeError {
    NativeError::operation(
        ErrorCode::StorageIo,
        "Cannot access the selected workbench resource",
        error,
    )
}
fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn name(path: &Path) -> String {
    path.file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .into_owned()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkbenchFileKind {
    Text,
    Json,
    Markdown,
    Image,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchDocument {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: WorkbenchFileKind,
    pub content: Option<String>,
    pub preview_url: Option<String>,
    pub revision: String,
    pub bytes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchDirectory {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkbenchFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub directory: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchDrop {
    pub files: Vec<WorkbenchDocument>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkbenchTaskKind {
    Scan,
    Sha256,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkbenchTaskStatus {
    Queued,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Failed,
    Interrupted,
}
impl WorkbenchTaskStatus {
    fn active(&self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Cancelling)
    }
    fn running(&self) -> bool {
        matches!(self, Self::Running | Self::Cancelling)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchTaskEntry {
    pub path: String,
    pub bytes: f64,
    pub sha256: Option<String>,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub failure: Option<NativeError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchTask {
    pub id: String,
    pub directory_id: String,
    pub directory_name: String,
    pub kind: WorkbenchTaskKind,
    pub status: WorkbenchTaskStatus,
    pub processed: i32,
    pub total: i32,
    pub bytes: f64,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub failure: Option<NativeError>,
    #[serde(default)]
    #[specta(optional)]
    pub unreadable_entries: i32,
    #[serde(default)]
    #[specta(optional)]
    pub report_unavailable: bool,
    pub results: Vec<WorkbenchTaskEntry>,
    pub truncated: bool,
    pub attempt_of: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchTaskSnapshot {
    pub revision: i32,
    pub tasks: Vec<WorkbenchTask>,
    pub active: i32,
    pub queued: i32,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct History {
    recent: Vec<RecentWorkbenchFile>,
    tasks: Vec<WorkbenchTask>,
}
struct WorkbenchInner {
    history: History,
    revision: i32,
    cancellations: HashMap<String, Arc<AtomicBool>>,
}
impl WorkbenchInner {
    fn running_count(&self) -> usize {
        self.history
            .tasks
            .iter()
            .filter(|task| task.status.running())
            .count()
    }
    fn queued_count(&self) -> usize {
        self.history
            .tasks
            .iter()
            .filter(|task| task.status == WorkbenchTaskStatus::Queued)
            .count()
    }
    fn admission_status(&self) -> NativeResult<WorkbenchTaskStatus> {
        if self.queued_count() >= MAX_QUEUED {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "The background queue is full (two running and ten waiting); wait or cancel a task",
            ));
        }
        Ok(
            if self.running_count() < MAX_ACTIVE && self.queued_count() == 0 {
                WorkbenchTaskStatus::Running
            } else {
                WorkbenchTaskStatus::Queued
            },
        )
    }
    fn reserve_next(&mut self) -> Option<WorkbenchTask> {
        if self.running_count() >= MAX_ACTIVE {
            return None;
        }
        // New tasks are inserted at the front, so the last queued entry is the oldest.
        let task = self
            .history
            .tasks
            .iter_mut()
            .rev()
            .find(|task| task.status == WorkbenchTaskStatus::Queued)?;
        task.status = WorkbenchTaskStatus::Running;
        task.started_at = now();
        let task = task.clone();
        self.revision = self.revision.saturating_add(1);
        Some(task)
    }
    fn cancel_task(&mut self, id: &str) -> NativeResult<()> {
        let task = self
            .history
            .tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Task not found"))?;
        if !task.status.active() {
            return Ok(());
        }
        if let Some(cancel) = self.cancellations.get(id) {
            cancel.store(true, Ordering::Relaxed);
        }
        if task.status == WorkbenchTaskStatus::Queued {
            task.status = WorkbenchTaskStatus::Cancelled;
            task.finished_at = Some(now());
            self.cancellations.remove(id);
        } else {
            task.status = WorkbenchTaskStatus::Cancelling;
        }
        self.revision = self.revision.saturating_add(1);
        Ok(())
    }
}
pub struct WorkbenchState {
    root: PathBuf,
    inner: Mutex<WorkbenchInner>,
    writing: Mutex<()>,
    history_writable: bool,
}

impl WorkbenchState {
    pub fn open(root: PathBuf) -> NativeResult<Self> {
        let mut history_writable = match fs::create_dir_all(&root) {
            Ok(()) => true,
            Err(error) => {
                log::warn!("Workbench history is unavailable; continuing in memory: {error}");
                false
            }
        };
        let history_path = root.join("history.json");
        let mut history: History = if history_writable && history_path.exists() {
            match read_bounded(&history_path, DIALOG_LIMIT).and_then(|bytes| {
                serde_json::from_slice(&bytes)
                    .map_err(|_| invalid("Invalid workbench history document"))
            }) {
                Ok(history) => history,
                Err(error) => {
                    if let Err(archive_error) = fs::rename(
                        &history_path,
                        root.join(format!("{}.json", token("history-invalid"))),
                    ) {
                        history_writable = false;
                        log::warn!(
                            "Workbench history retained in place; continuing in memory: {archive_error}"
                        );
                    }
                    log::warn!("Invalid workbench history preserved: {error}");
                    History::default()
                }
            }
        } else {
            History::default()
        };
        history
            .recent
            .retain(|entry| valid_id(&entry.id) && Path::new(&entry.path).is_absolute());
        history.recent.truncate(100);
        history
            .tasks
            .retain(|task| valid_id(&task.id) && valid_id(&task.directory_id));
        history.tasks.truncate(MAX_HISTORY);
        for task in &mut history.tasks {
            if task.status.active() {
                task.status = WorkbenchTaskStatus::Interrupted;
                task.finished_at = Some(now());
                task.message = Some(
                    "Application stopped before this task finished; retry starts a new task".into(),
                );
                task.failure = None;
            }
        }
        let mut state = Self {
            root,
            inner: Mutex::new(WorkbenchInner {
                history,
                revision: 1,
                cancellations: HashMap::new(),
            }),
            writing: Mutex::new(()),
            history_writable,
        };
        if let Err(error) = state.persist() {
            state.history_writable = false;
            log::warn!("Cannot checkpoint workbench history; original retained: {error}");
        }
        Ok(state)
    }
    fn lock(&self) -> NativeResult<std::sync::MutexGuard<'_, WorkbenchInner>> {
        self.inner
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Workbench state is unavailable"))
    }
    fn persist(&self) -> NativeResult<()> {
        if !self.history_writable {
            return Ok(());
        }
        let _write = self
            .writing
            .lock()
            .map_err(|_| invalid("Workbench writer is unavailable"))?;
        let contents = encode_history(&self.lock()?.history)?;
        atomic_write(&self.root.join("history.json"), &contents)
    }
    fn grant(&self, path: &Path, directory: bool) -> NativeResult<RecentWorkbenchFile> {
        let path = checked_resource(path, directory)?;
        let display = path.to_string_lossy().into_owned();
        let mut inner = self.lock()?;
        let id = inner
            .history
            .recent
            .iter()
            .find(|entry| entry.path == display && entry.directory == directory)
            .map(|entry| entry.id.clone())
            .unwrap_or_else(|| token("resource"));
        inner.history.recent.retain(|entry| entry.path != display);
        let entry = RecentWorkbenchFile {
            id,
            name: name(&path),
            path: display,
            directory,
        };
        inner.history.recent.insert(0, entry.clone());
        if inner.history.recent.len() > 100 {
            inner.history.recent.truncate(100);
        }
        drop(inner);
        self.persist()?;
        Ok(entry)
    }
    fn resource(&self, id: &str, directory: bool) -> NativeResult<PathBuf> {
        bounded_text(id, 160, "Resource ID")?;
        let selected = self
            .lock()?
            .history
            .recent
            .iter()
            .find(|entry| entry.id == id && entry.directory == directory)
            .cloned()
            .ok_or_else(|| {
                NativeError::new(ErrorCode::NotFound, "Select this file or directory again")
            })?;
        let selected_path = PathBuf::from(selected.path);
        let canonical = checked_resource(&selected_path, directory)?;
        if canonical != selected_path {
            return Err(invalid("The resource path changed; select it again"));
        }
        Ok(canonical)
    }
    pub fn recent(&self) -> NativeResult<Vec<RecentWorkbenchFile>> {
        Ok(self
            .lock()?
            .history
            .recent
            .iter()
            .take(20)
            .cloned()
            .collect())
    }
    pub(crate) fn document(&self, path: &Path) -> NativeResult<WorkbenchDocument> {
        let entry = self.grant(path, false)?;
        self.load(&entry.id)
    }
    pub fn load(&self, id: &str) -> NativeResult<WorkbenchDocument> {
        let path = self.resource(id, false)?;
        let kind = file_kind(&path)?;
        let bytes = read_bounded(
            &path,
            if kind == WorkbenchFileKind::Image {
                IMAGE_LIMIT
            } else {
                TEXT_LIMIT
            },
        )?;
        let revision = hash(&bytes);
        let size = bytes.len() as f64;
        let (content, preview_url) = if kind == WorkbenchFileKind::Image {
            let mime = image_mime(&bytes)
                .ok_or_else(|| invalid("Image contents do not match a supported image format"))?;
            (
                None,
                Some(format!("data:{mime};base64,{}", STANDARD.encode(&bytes))),
            )
        } else {
            (
                Some(
                    String::from_utf8(bytes)
                        .map_err(|_| invalid("The selected file is not UTF-8 text"))?,
                ),
                None,
            )
        };
        Ok(WorkbenchDocument {
            id: id.into(),
            name: name(&path),
            path: path.to_string_lossy().into_owned(),
            kind,
            content,
            preview_url,
            revision,
            bytes: size,
        })
    }
    /// 扩展只读取用户已授权资源的有界字节，不获得磁盘路径或目录能力。
    pub fn read_extension_resource(&self, id: &str) -> NativeResult<(String, Vec<u8>)> {
        let path = self.resource(id, false)?;
        Ok((name(&path), read_bounded(&path, 2 * 1024 * 1024)?))
    }
    pub fn save(
        &self,
        id: &str,
        content: &str,
        expected_revision: &str,
    ) -> NativeResult<WorkbenchDocument> {
        bounded_text(content, TEXT_LIMIT, "Document")?;
        let path = self.resource(id, false)?;
        let kind = file_kind(&path)?;
        if kind == WorkbenchFileKind::Image {
            return Err(invalid("Image attachments are read-only"));
        }
        if kind == WorkbenchFileKind::Json {
            serde_json::from_str::<serde_json::Value>(content)
                .map_err(|_| invalid("Fix invalid JSON before saving"))?;
        }
        let _write = self
            .writing
            .lock()
            .map_err(|_| invalid("Workbench writer is unavailable"))?;
        atomic_save(&path, content.as_bytes(), Some(expected_revision))?;
        self.load(id)
    }
    pub fn snapshot(&self) -> NativeResult<WorkbenchTaskSnapshot> {
        let inner = self.lock()?;
        Ok(WorkbenchTaskSnapshot {
            revision: inner.revision,
            active: inner.running_count() as i32,
            queued: inner.queued_count() as i32,
            tasks: inner.history.tasks.clone(),
        })
    }
    fn announce(&self, app: &tauri::AppHandle) {
        if let Ok(snapshot) = self.snapshot() {
            let _ = app.emit(TASK_EVENT, snapshot);
        }
    }
    pub fn cancel(&self, id: &str, app: &tauri::AppHandle) -> NativeResult<()> {
        bounded_text(id, 160, "Task ID")?;
        self.lock()?.cancel_task(id)?;
        self.persist()?;
        self.announce(app);
        self.launch_queued(app);
        Ok(())
    }
    pub fn start(
        &self,
        kind: WorkbenchTaskKind,
        directory_id: &str,
        attempt_of: Option<String>,
        app: &tauri::AppHandle,
    ) -> NativeResult<WorkbenchTask> {
        let (task, cancel) = self.enqueue(kind, directory_id, attempt_of)?;
        self.announce(app);
        if task.status == WorkbenchTaskStatus::Running {
            self.spawn_task(task.clone(), cancel, app);
        }
        self.launch_queued(app);
        Ok(task)
    }
    fn enqueue(
        &self,
        kind: WorkbenchTaskKind,
        directory_id: &str,
        attempt_of: Option<String>,
    ) -> NativeResult<(WorkbenchTask, Arc<AtomicBool>)> {
        let root = self.resource(directory_id, true)?;
        let cancel = Arc::new(AtomicBool::new(false));
        // 与 persist 保持相同锁顺序；持久化成功前不让 worker 看见候选任务。
        let _write = self
            .writing
            .lock()
            .map_err(|_| invalid("Workbench writer is unavailable"))?;
        let mut inner = self.lock()?;
        let status = inner.admission_status()?;
        let task = WorkbenchTask {
            id: token("task"),
            directory_id: directory_id.into(),
            directory_name: name(&root),
            kind,
            status,
            processed: 0,
            total: 0,
            bytes: 0.,
            started_at: now(),
            finished_at: None,
            message: None,
            failure: None,
            unreadable_entries: 0,
            report_unavailable: false,
            results: vec![],
            truncated: false,
            attempt_of,
        };
        let mut history = inner.history.clone();
        let mut removed_ids = vec![];
        history.tasks.insert(0, task.clone());
        while history.tasks.len() > MAX_HISTORY {
            if let Some(index) = history.tasks.iter().rposition(|task| !task.status.active()) {
                removed_ids.push(history.tasks.remove(index).id);
            } else {
                break;
            }
        }
        if self.history_writable {
            let contents = encode_history(&history)?;
            atomic_write(&self.root.join("history.json"), &contents)?;
        }
        inner.history = history;
        inner.cancellations.insert(task.id.clone(), cancel.clone());
        inner.revision = inner.revision.saturating_add(1);
        drop(inner);
        // 仅在新历史已保存后清理过期报告，写入失败须保留原来的完整导出。
        if self.history_writable {
            for id in removed_ids {
                if valid_id(&id) {
                    let _ = fs::remove_file(self.root.join(format!("{id}.json")));
                }
            }
        }
        Ok((task, cancel))
    }
    fn launch_queued(&self, app: &tauri::AppHandle) {
        loop {
            let next = self.lock().ok().and_then(|mut inner| {
                let task = inner.reserve_next()?;
                let cancel = inner.cancellations.get(&task.id)?.clone();
                Some((task, cancel))
            });
            let Some((task, cancel)) = next else {
                break;
            };
            if let Err(error) = self.persist() {
                log::warn!("Cannot persist workbench queue transition: {error}");
            }
            self.announce(app);
            self.spawn_task(task, cancel, app);
        }
    }
    fn spawn_task(&self, started: WorkbenchTask, cancel: Arc<AtomicBool>, app: &tauri::AppHandle) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<WorkbenchState>();
            let result = state
                .resource(&started.directory_id, true)
                .and_then(|root| {
                    run_directory_task(&root, &started.kind, &cancel, |processed, total, bytes| {
                        if let Ok(mut inner) = state.lock()
                            && let Some(task) = inner
                                .history
                                .tasks
                                .iter_mut()
                                .find(|task| task.id == started.id)
                        {
                            task.processed = processed;
                            task.total = total;
                            task.bytes = bytes;
                            inner.revision = inner.revision.saturating_add(1);
                        }
                        state.announce(&app);
                    })
                });
            state.finish(&started.id, result, cancel.load(Ordering::Relaxed), &app);
        });
    }
    fn finish(
        &self,
        id: &str,
        result: NativeResult<TaskReport>,
        cancelled: bool,
        app: &tauri::AppHandle,
    ) {
        let mut report_path = None;
        if let Ok(report) = &result {
            match self.persist_report(id, report) {
                Ok(()) => report_path = Some(()),
                Err(error) => log::warn!("Cannot persist workbench report: {error}"),
            }
        }
        if let Ok(mut inner) = self.lock() {
            inner.cancellations.remove(id);
            if let Some(task) = inner.history.tasks.iter_mut().find(|task| task.id == id) {
                task.finished_at = Some(now());
                match result {
                    Ok(report) => {
                        task.status = if cancelled {
                            WorkbenchTaskStatus::Cancelled
                        } else {
                            WorkbenchTaskStatus::Completed
                        };
                        task.processed = report.entries.len() as i32;
                        task.total = report.total;
                        task.bytes = report.entries.iter().map(|entry| entry.bytes).sum();
                        task.truncated = report.truncated;
                        task.unreadable_entries = report.unreadable_entries;
                        task.report_unavailable = report_path.is_none();
                        task.failure = None;
                        task.message = match (report.message, report_path.is_some()) {
                            (message, true) => message,
                            (message, false) => Some(format!(
                                "{}Report could not be persisted; export the complete in-memory results before closing the application",
                                message
                                    .map(|value| format!("{value}. "))
                                    .unwrap_or_default()
                            )),
                        };
                        task.results = report.entries;
                        if report_path.is_some() {
                            task.results.truncate(TASK_PREVIEW_ENTRIES);
                        }
                    }
                    Err(error) => {
                        task.status = WorkbenchTaskStatus::Failed;
                        task.message = Some(error.message.clone());
                        task.failure = Some(error);
                    }
                }
            }
            inner.revision = inner.revision.saturating_add(1);
        }
        if let Err(error) = self.persist() {
            log::warn!("Cannot persist workbench task history: {error}");
        }
        self.announce(app);
        self.launch_queued(app);
    }
    pub fn retry(&self, id: &str, app: &tauri::AppHandle) -> NativeResult<WorkbenchTask> {
        bounded_text(id, 160, "Task ID")?;
        let task = self
            .lock()?
            .history
            .tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Task not found"))?;
        if task.status.active() {
            return Err(invalid("Wait for this task to finish before retrying"));
        }
        self.start(task.kind, &task.directory_id, Some(task.id), app)
    }
    fn persist_report(&self, id: &str, report: &TaskReport) -> NativeResult<()> {
        if !valid_id(id) {
            return Err(invalid("Invalid task ID"));
        }
        if !self.history_writable {
            return Err(NativeError::new(
                ErrorCode::StorageIo,
                "Workbench history is unavailable; the complete report remains in memory",
            ));
        }
        let bytes = serde_json::to_vec_pretty(report).map_err(io_error)?;
        bounded_text_size(bytes.len(), TASK_REPORT_LIMIT)?;
        atomic_write(&self.root.join(format!("{id}.json")), &bytes)
    }
    fn export_content(&self, id: &str) -> NativeResult<String> {
        bounded_text(id, 160, "Task ID")?;
        let task = self
            .lock()?
            .history
            .tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Task not found"))?;
        if task.status.active() {
            return Err(invalid("Wait for this task to finish before exporting"));
        }
        let report = self.root.join(format!("{}.json", task.id));
        let content = if report.exists() {
            String::from_utf8(read_bounded(&report, TASK_REPORT_LIMIT)?)
                .map_err(|_| invalid("Task report is invalid"))?
        } else {
            if task.results.len() < task.processed as usize {
                return Err(NativeError::new(
                    ErrorCode::StorageIo,
                    "The complete task report is unavailable; the saved preview cannot replace it. Retry this task to regenerate the report.",
                ));
            }
            serde_json::to_string_pretty(&task).map_err(io_error)?
        };
        bounded_text_size(content.len(), TASK_REPORT_LIMIT)?;
        Ok(content)
    }
    pub fn export(&self, id: &str, app: &tauri::AppHandle) -> NativeResult<Option<String>> {
        let content = self.export_content(id)?;
        let Some(path) = pick_save_path(app, "task-report.json")? else {
            return Ok(None);
        };
        atomic_save(&path, content.as_bytes(), None)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
}

fn bounded_text_size(bytes: usize, limit: usize) -> NativeResult<()> {
    if bytes > limit {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Workbench storage exceeds its supported size; previous data is preserved",
        ));
    }
    Ok(())
}

fn encode_history(history: &History) -> NativeResult<Vec<u8>> {
    let mut checkpoint = History {
        recent: history.recent.clone(),
        tasks: history
            .tasks
            .iter()
            .map(|task| {
                let mut preview = task.clone();
                preview.results.truncate(TASK_PREVIEW_ENTRIES);
                preview
            })
            .collect(),
    };
    let mut bytes = serde_json::to_vec(&checkpoint).map_err(io_error)?;
    if bytes.len() > DIALOG_LIMIT {
        for task in &mut checkpoint.tasks {
            task.results.clear();
        }
        bytes = serde_json::to_vec(&checkpoint).map_err(io_error)?;
    }
    bounded_text_size(bytes.len(), DIALOG_LIMIT)?;
    Ok(bytes)
}

fn file_kind(path: &Path) -> NativeResult<WorkbenchFileKind> {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        extension if extension == INTEGRATION.file_extension => Ok(WorkbenchFileKind::Json),
        "json" => Ok(WorkbenchFileKind::Json),
        "md" | "markdown" => Ok(WorkbenchFileKind::Markdown),
        "png" | "jpg" | "jpeg" | "gif" | "webp" => Ok(WorkbenchFileKind::Image),
        "txt" | "log" | "csv" | "tsv" | "rs" | "ts" | "js" | "css" | "toml" | "yaml" | "yml"
        | "" => Ok(WorkbenchFileKind::Text),
        _ => Err(invalid(
            "Only text, JSON, Markdown and PNG/JPEG/GIF/WebP files can be previewed",
        )),
    }
}
fn save_editor_content(path: &Path, content: &str) -> NativeResult<()> {
    bounded_text(content, TEXT_LIMIT, "Document")?;
    match file_kind(path)? {
        WorkbenchFileKind::Image => {
            return Err(invalid(
                "Save edited text with a text, JSON or Markdown extension",
            ));
        }
        WorkbenchFileKind::Json => {
            serde_json::from_str::<serde_json::Value>(content)
                .map_err(|_| invalid("Fix invalid JSON before saving"))?;
        }
        _ => {}
    }
    atomic_save(path, content.as_bytes(), None)
}
fn checked_resource(path: &Path, directory: bool) -> NativeResult<PathBuf> {
    let info = fs::symlink_metadata(path).map_err(io_error)?;
    if info.file_type().is_symlink()
        || (directory && !info.is_dir())
        || (!directory && !info.is_file())
    {
        return Err(invalid(
            "Select a regular file or directory; links and special files are not followed",
        ));
    }
    fs::canonicalize(path).map_err(io_error)
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}
fn read_bounded(path: &Path, limit: usize) -> NativeResult<Vec<u8>> {
    checked_resource(path, false)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(io_error)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > limit {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "The selected file exceeds the supported size",
        ));
    }
    Ok(bytes)
}
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

fn atomic_save(path: &Path, bytes: &[u8], expected: Option<&str>) -> NativeResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Invalid save destination"))?;
    let canonical_parent = fs::canonicalize(parent).map_err(io_error)?;
    let mut temporary = tempfile::NamedTempFile::new_in(&canonical_parent).map_err(io_error)?;
    temporary.write_all(bytes).map_err(io_error)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            checked_resource(path, false)?;
            temporary
                .as_file()
                .set_permissions(metadata.permissions())
                .map_err(io_error)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
    }
    temporary.as_file().sync_all().map_err(io_error)?;
    if fs::canonicalize(parent).map_err(io_error)? != canonical_parent {
        return Err(invalid("Save directory changed; select it again"));
    }
    if let Some(revision) = expected
        && hash(&read_bounded(path, TEXT_LIMIT)?) != revision
    {
        return Err(NativeError::new(
            ErrorCode::Conflict,
            "The file changed outside the editor; reload or save a copy",
        ));
    }
    // Windows 的 persist 直接调用 Win32；最终目标也沿用已核验目录的扩展路径。
    let destination = canonical_parent.join(
        path.file_name()
            .ok_or_else(|| invalid("Invalid save destination"))?,
    );
    temporary.persist(destination).map_err(io_error)?;
    Ok(())
}

pub fn pick_files(app: &tauri::AppHandle) -> NativeResult<Vec<WorkbenchDocument>> {
    let paths = app
        .dialog()
        .file()
        .add_filter(
            "Text / JSON / Markdown / Images",
            &[
                "txt",
                "json",
                &INTEGRATION.file_extension,
                "md",
                "markdown",
                "log",
                "csv",
                "png",
                "jpg",
                "jpeg",
                "gif",
                "webp",
            ],
        )
        .blocking_pick_files();
    let state = app.state::<WorkbenchState>();
    let Some(paths) = paths else {
        return Ok(vec![]);
    };
    if paths.len() > 20 {
        return Err(invalid("Open at most 20 files at a time"));
    }
    paths
        .into_iter()
        .map(|path| state.document(&path.into_path().map_err(io_error)?))
        .collect()
}
pub fn pick_directory(app: &tauri::AppHandle) -> NativeResult<Option<WorkbenchDirectory>> {
    let Some(path) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let entry = app
        .state::<WorkbenchState>()
        .grant(&path.into_path().map_err(io_error)?, true)?;
    Ok(Some(WorkbenchDirectory {
        id: entry.id,
        name: entry.name,
        path: entry.path,
    }))
}
pub fn save_as(
    app: &tauri::AppHandle,
    default_name: &str,
    content: &str,
) -> NativeResult<Option<WorkbenchDocument>> {
    bounded_text(content, TEXT_LIMIT, "Document")?;
    let Some(path) = pick_save_path(app, default_name)? else {
        return Ok(None);
    };
    save_editor_content(&path, content)?;
    Ok(Some(app.state::<WorkbenchState>().document(&path)?))
}
pub fn reveal(app: &tauri::AppHandle, id: &str) -> NativeResult<()> {
    let state = app.state::<WorkbenchState>();
    let entry = state
        .lock()?
        .history
        .recent
        .iter()
        .find(|entry| entry.id == id)
        .cloned()
        .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Select the resource again"))?;
    let path = state.resource(id, entry.directory)?;
    app.opener().reveal_item_in_dir(path).map_err(io_error)
}

/// 仅从原生 WindowEvent 的 Drop 调用；渲染进程不能提交任意待打开路径。
pub fn handle_drop(app: &tauri::AppHandle, window_label: &str, paths: Vec<PathBuf>) {
    let app = app.clone();
    let window_label = window_label.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkbenchState>();
        let mut batch = WorkbenchDrop {
            files: vec![],
            errors: vec![],
        };
        for path in paths.iter().take(20) {
            match state.document(path) {
                Ok(document) => batch.files.push(document),
                Err(error) => batch
                    .errors
                    .push(format!("{}: {}", name(path), error.message)),
            }
        }
        if paths.len() > 20 {
            batch
                .errors
                .push("Only the first 20 dropped files were opened".into());
        }
        let _ = app.emit_to(window_label, DROP_EVENT, batch);
    });
}

/// 原生文件选择与有界 UTF-8 读取，可被备份等领域服务复用。
pub fn pick_text_content(app: &tauri::AppHandle, max_bytes: usize) -> NativeResult<Option<String>> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("JSON / Text", &["json", "txt", "md"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let bytes = read_bounded(
        &path.into_path().map_err(io_error)?,
        max_bytes.min(DIALOG_LIMIT),
    )?;
    Ok(Some(
        String::from_utf8(bytes).map_err(|_| invalid("Select a UTF-8 text file"))?,
    ))
}
/// 另存路径来自系统对话框；取消不写文件，写入使用同目录临时文件替换。
pub fn save_text_content(
    app: &tauri::AppHandle,
    default_name: &str,
    content: &str,
    max_bytes: usize,
) -> NativeResult<Option<String>> {
    save_text_content_with_picker(content, max_bytes, || pick_save_path(app, default_name))
}

pub(crate) fn save_text_content_with_picker(
    content: &str,
    max_bytes: usize,
    pick_path: impl FnOnce() -> NativeResult<Option<PathBuf>>,
) -> NativeResult<Option<String>> {
    // 保存额度由调用领域明确提供，不复用文件选择读取的 16 MiB 上限。
    bounded_text(content, max_bytes, "Export")?;
    let Some(path) = pick_path()? else {
        return Ok(None);
    };
    atomic_save(&path, content.as_bytes(), None)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
pub fn save_binary_content(
    app: &tauri::AppHandle,
    default_name: &str,
    content: &[u8],
) -> NativeResult<Option<String>> {
    if content.len() > 2 * 1024 * 1024 {
        return Err(invalid("Extension artifact exceeds 2 MiB"));
    }
    let Some(path) = pick_save_path(app, default_name)? else {
        return Ok(None);
    };
    atomic_save(&path, content, None)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

pub fn pick_extension_resources(
    app: &tauri::AppHandle,
) -> NativeResult<Vec<crate::extensions::ExtensionFileChoice>> {
    use tauri::Manager;
    let Some(paths) = app.dialog().file().blocking_pick_files() else {
        return Ok(Vec::new());
    };
    if paths.len() > 16 {
        return Err(invalid("Select at most 16 extension input files"));
    }
    let mut selected = Vec::new();
    let mut total = 0_u64;
    for path in paths {
        let path = checked_resource(&path.into_path().map_err(io_error)?, false)?;
        let bytes = fs::metadata(&path).map_err(io_error)?.len();
        total = total
            .checked_add(bytes)
            .ok_or_else(|| invalid("Selected files exceed 2 MiB"))?;
        if total > 2 * 1024 * 1024 {
            return Err(invalid("Selected files exceed 2 MiB in total"));
        }
        selected.push((path, bytes));
    }
    let state = app.state::<WorkbenchState>();
    selected
        .into_iter()
        .map(|(path, bytes)| {
            let entry = state.grant(&path, false)?;
            Ok(crate::extensions::ExtensionFileChoice {
                id: entry.id,
                name: entry.name,
                bytes: bytes as f64,
                media_type: "application/octet-stream".into(),
            })
        })
        .collect()
}
fn pick_save_path(app: &tauri::AppHandle, default_name: &str) -> NativeResult<Option<PathBuf>> {
    bounded_text(default_name, 200, "File name")?;
    if default_name.contains(['/', '\\']) {
        return Err(invalid("Use a file name, not a path"));
    }
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    Ok(Some(path.into_path().map_err(io_error)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskReport {
    total: i32,
    entries: Vec<WorkbenchTaskEntry>,
    truncated: bool,
    message: Option<String>,
    unreadable_entries: i32,
}
fn run_directory_task(
    root: &Path,
    kind: &WorkbenchTaskKind,
    cancel: &AtomicBool,
    mut progress: impl FnMut(i32, i32, f64),
) -> NativeResult<TaskReport> {
    let root = checked_resource(root, true)?;
    let mut paths = vec![];
    let mut errors = 0;
    let mut truncated = false;
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .max_depth(MAX_TASK_DEPTH)
    {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match entry {
            Ok(entry) if entry.file_type().is_dir() && entry.depth() == MAX_TASK_DEPTH => {
                truncated = true;
            }
            Ok(entry) if entry.file_type().is_file() => {
                if paths.len() == MAX_TASK_FILES {
                    truncated = true;
                    break;
                }
                let path = entry.path().to_path_buf();
                let canonical = fs::canonicalize(&path).map_err(io_error)?;
                if !canonical.starts_with(&root) {
                    return Err(invalid("A scanned path escaped the selected directory"));
                }
                paths.push(path);
            }
            Err(_) => errors += 1,
            _ => {}
        }
    }
    let total = paths.len() as i32;
    let mut entries = vec![];
    let mut bytes = 0.;
    let mut last = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or_else(Instant::now);
    progress(0, total, bytes);
    for path in paths {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let relative = path
            .strip_prefix(&root)
            .map_err(io_error)?
            .to_string_lossy()
            .replace('\\', "/");
        if relative.len() > 1024 {
            errors += 1;
            entries.push(WorkbenchTaskEntry {
                path: relative.chars().take(256).collect(),
                bytes: 0.,
                sha256: None,
                error: Some("Path exceeds the 1024-byte report limit; file was skipped".into()),
                failure: Some(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Path exceeds the 1024-byte report limit; file was skipped",
                )),
            });
            continue;
        }
        let result = (|| -> NativeResult<(f64, Option<String>)> {
            let canonical = checked_resource(&path, false)?;
            if !canonical.starts_with(&root) {
                return Err(invalid("The file moved outside the selected directory"));
            }
            let original = fs::metadata(&canonical).map_err(io_error)?;
            let size = original.len();
            if *kind == WorkbenchTaskKind::Scan {
                return Ok((size as f64, None));
            }
            if size > MAX_HASH_FILE {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "File exceeds the 512MiB hashing limit",
                ));
            }
            let mut file = File::open(&canonical).map_err(io_error)?;
            let mut hasher = Sha256::new();
            let mut buffer = [0u8; 64 * 1024];
            let mut read_bytes = 0u64;
            loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err(NativeError::new(ErrorCode::UserCancelled, "Task cancelled"));
                }
                let length = file.read(&mut buffer).map_err(io_error)?;
                if length == 0 {
                    break;
                }
                read_bytes += length as u64;
                if read_bytes > MAX_HASH_FILE {
                    return Err(NativeError::new(
                        ErrorCode::InputTooLong,
                        "File grew beyond the 512MiB hashing limit",
                    ));
                }
                hasher.update(&buffer[..length]);
            }
            let after = file.metadata().map_err(io_error)?;
            if read_bytes != size
                || after.len() != size
                || after.modified().ok() != original.modified().ok()
            {
                return Err(NativeError::new(
                    ErrorCode::Conflict,
                    "File changed during hashing; retry when it is stable",
                ));
            }
            Ok((size as f64, Some(format!("{:x}", hasher.finalize()))))
        })();
        match result {
            Ok((size, sha256)) => {
                bytes += size;
                entries.push(WorkbenchTaskEntry {
                    path: relative,
                    bytes: size,
                    sha256,
                    error: None,
                    failure: None,
                });
            }
            Err(error) => {
                errors += 1;
                entries.push(WorkbenchTaskEntry {
                    path: relative,
                    bytes: 0.,
                    sha256: None,
                    error: Some(error.message.clone()),
                    failure: Some(error),
                });
            }
        }
        if last.elapsed() >= Duration::from_millis(150) {
            progress(entries.len() as i32, total, bytes);
            last = Instant::now();
        }
    }
    progress(entries.len() as i32, total, bytes);
    Ok(TaskReport {
        total,
        entries,
        truncated,
        message: (errors > 0)
            .then(|| format!("{errors} entries could not be read; see exported results")),
        unreadable_entries: errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn atomic_save_rejects_existing_and_dangling_symbolic_links() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.txt");
        let link = directory.path().join("link.txt");
        fs::write(&target, b"original").unwrap();
        symlink(&target, &link).unwrap();
        assert_eq!(
            atomic_save(&link, b"replacement", None).unwrap_err().code,
            ErrorCode::InvalidArgument,
        );
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_file(&target).unwrap();
        assert_eq!(
            atomic_save(&link, b"replacement", None).unwrap_err().code,
            ErrorCode::InvalidArgument,
        );
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert!(!target.exists());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn atomic_save_supports_long_windows_paths_and_preserves_revision_conflicts() {
        use std::os::windows::ffi::OsStrExt;

        let directory = tempfile::tempdir().unwrap();
        let raw = directory.path().to_string_lossy();
        let mut parent = PathBuf::from(raw.trim_start_matches(r"\\?\"));
        while parent.as_os_str().encode_wide().count() < 230 {
            parent.push("nested-export-directory");
        }
        fs::create_dir_all(&parent).unwrap();
        let path = parent.join(format!("{}.txt", "report".repeat(12)));
        assert!(!path.to_string_lossy().starts_with(r"\\?\"));
        assert!(path.as_os_str().encode_wide().count() > 260);

        atomic_save(&path, b"original", None).unwrap();
        let revision = hash(b"original");
        atomic_save(&path, b"replacement", Some(&revision)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(
            atomic_save(&path, b"stale", Some(&revision))
                .unwrap_err()
                .code,
            ErrorCode::Conflict,
        );
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
    }

    #[test]
    fn larger_export_limits_do_not_expand_text_imports_and_cancel_without_writes() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("large-session.json");
        let content = "x".repeat(DIALOG_LIMIT + 1);
        fs::write(&path, &content).unwrap();
        assert!(read_bounded(&path, DIALOG_LIMIT).is_err());
        let saved = save_text_content_with_picker(&content, 32 * 1024 * 1024, || Ok(None)).unwrap();
        assert_eq!(saved, None);
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }

    fn task(id: &str, status: WorkbenchTaskStatus) -> WorkbenchTask {
        WorkbenchTask {
            id: id.into(),
            directory_id: "resource-directory".into(),
            directory_name: "Directory".into(),
            kind: WorkbenchTaskKind::Scan,
            status,
            processed: 0,
            total: 0,
            bytes: 0.,
            started_at: now(),
            finished_at: None,
            message: None,
            failure: None,
            unreadable_entries: 0,
            report_unavailable: false,
            results: vec![],
            truncated: false,
            attempt_of: None,
        }
    }

    #[test]
    fn legacy_task_history_retains_diagnostics_and_defaults_new_notice_fields() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("workbench");
        fs::create_dir(&root).unwrap();
        let mut legacy =
            serde_json::to_value(task("task-legacy", WorkbenchTaskStatus::Failed)).unwrap();
        let fields = legacy.as_object_mut().unwrap();
        fields.remove("failure");
        fields.remove("unreadableEntries");
        fields.remove("reportUnavailable");
        fields.insert("message".into(), "Historical task diagnostic".into());
        fields.insert(
            "results".into(),
            serde_json::json!([{
                "path": "old.txt", "bytes": 0, "sha256": null,
                "error": "Historical file diagnostic"
            }]),
        );
        fs::write(
            root.join("history.json"),
            serde_json::to_vec(&serde_json::json!({
                "recent": [], "tasks": [legacy]
            }))
            .unwrap(),
        )
        .unwrap();

        let state = WorkbenchState::open(root).unwrap();
        let snapshot = state.snapshot().unwrap();
        let restored = &snapshot.tasks[0];
        assert_eq!(
            restored.message.as_deref(),
            Some("Historical task diagnostic")
        );
        assert_eq!(
            restored.results[0].error.as_deref(),
            Some("Historical file diagnostic")
        );
        assert!(restored.failure.is_none());
        assert!(restored.results[0].failure.is_none());
        assert_eq!(restored.unreadable_entries, 0);
        assert!(!restored.report_unavailable);
    }

    #[test]
    fn task_reports_keep_structured_file_errors_and_total_unreadable_count() {
        let temporary = tempfile::tempdir().unwrap();
        File::create(temporary.path().join("oversized.bin"))
            .unwrap()
            .set_len(MAX_HASH_FILE + 1)
            .unwrap();
        let report = run_directory_task(
            temporary.path(),
            &WorkbenchTaskKind::Sha256,
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(report.unreadable_entries, 1);
        let failure = report.entries[0].failure.as_ref().unwrap();
        assert_eq!(failure.code, ErrorCode::InputTooLong);
        assert_eq!(
            report.entries[0].error.as_deref(),
            Some(failure.message.as_str())
        );
        let persisted = serde_json::to_vec(&report.entries[0]).unwrap();
        let restored: WorkbenchTaskEntry = serde_json::from_slice(&persisted).unwrap();
        assert_eq!(restored.failure, report.entries[0].failure);
    }
    #[test]
    fn bounded_queue_preserves_fifo_slots_and_cancels_waiting_work() {
        let mut inner = WorkbenchInner {
            history: History::default(),
            revision: 1,
            cancellations: HashMap::new(),
        };
        for index in 0..MAX_ACTIVE + MAX_QUEUED {
            let status = inner.admission_status().unwrap();
            let id = format!("task-{index}");
            inner
                .cancellations
                .insert(id.clone(), Arc::new(AtomicBool::new(false)));
            inner.history.tasks.insert(0, task(&id, status));
        }
        assert_eq!(inner.running_count(), 2);
        assert_eq!(inner.queued_count(), 10);
        assert_eq!(
            inner.admission_status().unwrap_err().code,
            ErrorCode::Conflict
        );
        assert!(inner.reserve_next().is_none());
        let waiting_flag = inner.cancellations["task-2"].clone();
        inner.cancel_task("task-2").unwrap();
        assert!(waiting_flag.load(Ordering::Relaxed));
        assert_eq!(inner.queued_count(), 9);
        assert_eq!(
            inner
                .history
                .tasks
                .iter()
                .find(|task| task.id == "task-2")
                .unwrap()
                .status,
            WorkbenchTaskStatus::Cancelled
        );
        inner.cancel_task("task-0").unwrap();
        assert_eq!(
            inner.running_count(),
            2,
            "cancellation retains the slot until the worker exits"
        );
        inner
            .history
            .tasks
            .iter_mut()
            .find(|task| task.id == "task-0")
            .unwrap()
            .status = WorkbenchTaskStatus::Cancelled;
        assert_eq!(inner.reserve_next().unwrap().id, "task-3");
        assert_eq!(inner.running_count(), 2);
        assert!(inner.reserve_next().is_none());
    }
    #[test]
    fn restart_marks_queued_and_running_jobs_interrupted_without_resuming() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("state");
        let state = WorkbenchState::open(root.clone()).unwrap();
        state.lock().unwrap().history.tasks = vec![
            task("task-running", WorkbenchTaskStatus::Running),
            task("task-queued", WorkbenchTaskStatus::Queued),
        ];
        state.persist().unwrap();
        drop(state);
        let reopened = WorkbenchState::open(root).unwrap().snapshot().unwrap();
        assert_eq!(reopened.active, 0);
        assert_eq!(reopened.queued, 0);
        assert_eq!(reopened.tasks.len(), 2);
        assert!(
            reopened
                .tasks
                .iter()
                .all(|task| task.status == WorkbenchTaskStatus::Interrupted
                    && task.finished_at.is_some())
        );
    }

    #[test]
    fn failed_task_admission_preserves_history_and_complete_reports() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("workbench");
        let mut state = WorkbenchState::open(root.clone()).unwrap();
        let directory = state.grant(temporary.path(), true).unwrap();
        state.lock().unwrap().history.tasks = (0..MAX_HISTORY)
            .map(|index| task(&format!("task-{index}"), WorkbenchTaskStatus::Completed))
            .collect();
        state.persist().unwrap();
        let oldest_report = root.join(format!("task-{}.json", MAX_HISTORY - 1));
        fs::write(&oldest_report, b"complete report").unwrap();
        let before = serde_json::to_value(state.snapshot().unwrap()).unwrap();

        // 用同名目录阻止原子替换，稳定模拟历史写入失败。
        let history_path = root.join("history.json");
        fs::remove_file(&history_path).unwrap();
        fs::create_dir(&history_path).unwrap();
        assert!(
            state
                .enqueue(WorkbenchTaskKind::Scan, &directory.id, None)
                .is_err()
        );
        assert_eq!(
            serde_json::to_value(state.snapshot().unwrap()).unwrap(),
            before
        );
        assert!(state.lock().unwrap().cancellations.is_empty());
        assert_eq!(fs::read(&oldest_report).unwrap(), b"complete report");

        fs::remove_dir(&history_path).unwrap();
        let (admitted, _) = state
            .enqueue(WorkbenchTaskKind::Scan, &directory.id, None)
            .unwrap();
        assert_eq!(state.snapshot().unwrap().tasks.len(), MAX_HISTORY);
        assert!(!oldest_report.exists());
        let persisted: History = serde_json::from_slice(&fs::read(&history_path).unwrap()).unwrap();
        assert_eq!(persisted.tasks[0].id, admitted.id);

        let retained_id = format!("task-{}", MAX_HISTORY - 2);
        let retained_report = root.join(format!("{retained_id}.json"));
        fs::write(&retained_report, b"retained report").unwrap();
        let checkpoint = fs::read(&history_path).unwrap();
        state.history_writable = false;
        state
            .enqueue(WorkbenchTaskKind::Scan, &directory.id, None)
            .unwrap();
        assert!(
            state
                .persist_report(
                    &retained_id,
                    &TaskReport {
                        total: 0,
                        entries: vec![],
                        truncated: false,
                        message: None,
                        unreadable_entries: 0,
                    },
                )
                .is_err()
        );
        assert_eq!(fs::read(history_path).unwrap(), checkpoint);
        assert_eq!(fs::read(retained_report).unwrap(), b"retained report");
    }

    #[test]
    fn bounded_history_keeps_complete_large_reports_exportable_after_restart() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("workbench");
        let state = WorkbenchState::open(root.clone()).unwrap();
        let entry = WorkbenchTaskEntry {
            path: "\u{1}".repeat(1024),
            bytes: 1.,
            sha256: None,
            error: None,
            failure: None,
        };
        let report = TaskReport {
            total: MAX_TASK_FILES as i32,
            entries: vec![entry.clone(); MAX_TASK_FILES],
            truncated: false,
            message: None,
            unreadable_entries: 0,
        };
        state.persist_report("task-large", &report).unwrap();
        assert!(fs::metadata(root.join("task-large.json")).unwrap().len() > DIALOG_LIMIT as u64);
        let mut tasks: Vec<_> = (0..MAX_HISTORY)
            .map(|index| {
                let mut value = task(&format!("task-{index}"), WorkbenchTaskStatus::Completed);
                value.results = vec![entry.clone(); TASK_PREVIEW_ENTRIES];
                value.processed = MAX_TASK_FILES as i32;
                value.total = MAX_TASK_FILES as i32;
                value
            })
            .collect();
        tasks[0].id = "task-large".into();
        state.lock().unwrap().history.tasks = tasks;
        state.persist().unwrap();
        assert!(fs::metadata(root.join("history.json")).unwrap().len() <= DIALOG_LIMIT as u64);
        drop(state);
        let reopened = WorkbenchState::open(root).unwrap();
        let snapshot = reopened.snapshot().unwrap();
        assert_eq!(snapshot.tasks.len(), MAX_HISTORY);
        assert!(snapshot.tasks.iter().all(|task| task.results.is_empty()));
        let exported: serde_json::Value =
            serde_json::from_str(&reopened.export_content("task-large").unwrap()).unwrap();
        assert_eq!(
            exported["entries"].as_array().unwrap().len(),
            MAX_TASK_FILES
        );
    }

    #[test]
    fn oversized_history_is_preserved_without_blocking_startup_or_overwriting_it_on_failed_persist()
    {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("workbench");
        fs::create_dir(&root).unwrap();
        let original = vec![b'x'; DIALOG_LIMIT + 1];
        fs::write(root.join("history.json"), &original).unwrap();
        let state = WorkbenchState::open(root.clone()).unwrap();
        let saved = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| name(path).starts_with("history-invalid-"))
            .unwrap();
        assert_eq!(fs::read(saved).unwrap(), original);
        assert!(state.snapshot().unwrap().tasks.is_empty());
        let checkpoint = fs::read(root.join("history.json")).unwrap();
        let mut enormous = task("task-enormous", WorkbenchTaskStatus::Completed);
        enormous.directory_name = "x".repeat(DIALOG_LIMIT);
        state.lock().unwrap().history.tasks.push(enormous);
        assert_eq!(state.persist().unwrap_err().code, ErrorCode::InputTooLong);
        assert_eq!(fs::read(root.join("history.json")).unwrap(), checkpoint);

        let unavailable = temporary.path().join("unavailable");
        fs::write(&unavailable, b"preserve this original file").unwrap();
        let ephemeral = WorkbenchState::open(unavailable.clone()).unwrap();
        assert!(!ephemeral.history_writable);
        assert!(ephemeral.snapshot().unwrap().tasks.is_empty());
        assert_eq!(
            fs::read(unavailable).unwrap(),
            b"preserve this original file"
        );
    }

    #[test]
    fn missing_complete_report_never_exports_a_saved_preview_as_full_results() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("workbench");
        let state = WorkbenchState::open(root.clone()).unwrap();
        let mut value = task("task-report-failed", WorkbenchTaskStatus::Completed);
        value.processed = 251;
        value.total = 251;
        value.results = vec![
            WorkbenchTaskEntry {
                path: "file.txt".into(),
                bytes: 1.,
                sha256: None,
                error: None,
                failure: None,
            };
            251
        ];
        state.lock().unwrap().history.tasks.push(value);
        let exported: serde_json::Value =
            serde_json::from_str(&state.export_content("task-report-failed").unwrap()).unwrap();
        assert_eq!(exported["results"].as_array().unwrap().len(), 251);
        state.persist().unwrap();
        drop(state);
        let reopened = WorkbenchState::open(root).unwrap();
        assert_eq!(
            reopened.snapshot().unwrap().tasks[0].results.len(),
            TASK_PREVIEW_ENTRIES
        );
        assert_eq!(
            reopened
                .export_content("task-report-failed")
                .unwrap_err()
                .code,
            ErrorCode::StorageIo
        );
    }
    #[test]
    fn selected_documents_detect_external_changes_and_save_atomically() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("note.md");
        fs::write(&file, "first").unwrap();
        let state = WorkbenchState::open(temp.path().join("state")).unwrap();
        let document = state.document(&file).unwrap();
        fs::write(&file, "external").unwrap();
        assert_eq!(
            state
                .save(&document.id, "mine", &document.revision)
                .unwrap_err()
                .code,
            ErrorCode::Conflict
        );
        assert_eq!(fs::read_to_string(&file).unwrap(), "external");
        let latest = state.load(&document.id).unwrap();
        let saved = state.save(&latest.id, "mine", &latest.revision).unwrap();
        assert_eq!(saved.content.as_deref(), Some("mine"));
        assert_ne!(saved.revision, latest.revision);
        assert!(state.load("ungranted").is_err());
    }
    #[test]
    fn associated_demo_documents_use_the_same_native_grant_and_json_save_contract() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp
            .path()
            .join(format!("associated.{}", INTEGRATION.file_extension));
        fs::write(&file, r#"{"title":"Native association"}"#).unwrap();
        let state = WorkbenchState::open(temp.path().join("state")).unwrap();
        let document = state.document(&file).unwrap();
        assert_eq!(document.kind, WorkbenchFileKind::Json);
        assert_eq!(
            state.load(&document.id).unwrap().revision,
            document.revision
        );
        assert!(
            state
                .save(&document.id, "invalid", &document.revision)
                .is_err()
        );
        let saved = state
            .save(&document.id, r#"{"title":"Saved"}"#, &document.revision)
            .unwrap();
        assert_eq!(saved.content.as_deref(), Some(r#"{"title":"Saved"}"#));
        assert_eq!(state.recent().unwrap()[0].id, saved.id);
        let invalid = temp
            .path()
            .join(format!("invalid.{}", INTEGRATION.file_extension));
        fs::write(&invalid, [0xff, 0xfe]).unwrap();
        assert!(state.document(&invalid).is_err());
    }
    #[test]
    fn json_size_and_image_boundaries_reject_unsafe_content() {
        let temp = tempfile::tempdir().unwrap();
        let state = WorkbenchState::open(temp.path().join("state")).unwrap();
        let file = temp.path().join("document.json");
        fs::write(&file, "{}").unwrap();
        let document = state.document(&file).unwrap();
        assert!(
            state
                .save(&document.id, "{broken", &document.revision)
                .is_err()
        );
        assert_eq!(fs::read_to_string(&file).unwrap(), "{}");
        assert!(save_editor_content(&file, "{invalid").is_err());
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "{}",
            "invalid save-as must not touch the destination"
        );
        let unsupported = temp.path().join("keep.exe");
        fs::write(&unsupported, "keep").unwrap();
        assert!(save_editor_content(&unsupported, "edited").is_err());
        assert_eq!(fs::read_to_string(&unsupported).unwrap(), "keep");
        let image = temp.path().join("keep.png");
        fs::write(&image, b"\x89PNG\r\n\x1a\n").unwrap();
        assert!(save_editor_content(&image, "edited").is_err());
        assert_eq!(fs::read(&image).unwrap(), b"\x89PNG\r\n\x1a\n");
        fs::write(temp.path().join("fake.png"), "<script>unsafe</script>").unwrap();
        assert!(state.document(&temp.path().join("fake.png")).is_err());
        assert!(image_mime(b"RIFF0000WEBP").is_some());
        fs::write(temp.path().join("large.txt"), vec![b'x'; TEXT_LIMIT + 1]).unwrap();
        assert_eq!(
            state
                .document(&temp.path().join("large.txt"))
                .unwrap_err()
                .code,
            ErrorCode::InputTooLong
        );
    }
    #[test]
    fn real_hashing_reports_results_and_cooperative_cancellation() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("a.txt"), "abc").unwrap();
        let report = run_directory_task(
            temp.path(),
            &WorkbenchTaskKind::Sha256,
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(report.total, 1);
        assert_eq!(
            report.entries[0].sha256.as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        let cancelled = run_directory_task(
            temp.path(),
            &WorkbenchTaskKind::Scan,
            &AtomicBool::new(true),
            |_, _, _| {},
        )
        .unwrap();
        assert!(cancelled.entries.is_empty());

        let mut boundary = temp.path().to_path_buf();
        for _ in 0..MAX_TASK_DEPTH - 1 {
            boundary.push("d");
        }
        fs::create_dir_all(&boundary).unwrap();
        fs::write(boundary.join("included.txt"), "included").unwrap();
        let complete = run_directory_task(
            temp.path(),
            &WorkbenchTaskKind::Scan,
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(complete.total, 2);
        assert!(!complete.truncated);

        let beyond = boundary.join("d");
        fs::create_dir(&beyond).unwrap();
        fs::write(beyond.join("excluded.txt"), "excluded").unwrap();
        let limited = run_directory_task(
            temp.path(),
            &WorkbenchTaskKind::Scan,
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(limited.total, complete.total);
        assert!(limited.truncated);
    }
}
