import type { WorkbenchMessages } from "./zh-workbench";
export const enWorkbench = {
  "nav.workbench": "File workbench",
  "nav.tasks": "Background tasks",
  "workbench.title": "File workbench",
  "workbench.description":
    "Open local text, JSON, Markdown or images, preview and save safely. Files stay on your device.",
  "workbench.open": "Open files",
  "workbench.new": "New text file",
  "workbench.sample": "Open JSON sample",
  "workbench.sampleTitle": "Desktop file workflow example",
  "workbench.untitled": "Untitled.txt",
  "workbench.save": "Save file",
  "workbench.saveAs": "Save a copy",
  "workbench.saved": "File saved",
  "workbench.importNote": "Import a note copy",
  "workbench.imported":
    "Saved the current content as a SQLite note. The original file and unsaved edits are preserved.",
  "workbench.openNotes": "Open notes",
  "workbench.noteLimit":
    "Note content is limited to 64 KiB. Reduce the content or save it as a file.",
  "workbench.saveCancelled":
    "Saving was cancelled. Unsaved edits are still preserved.",
  "workbench.busy": "A file operation is still running. Wait and try again.",
  "workbench.reveal": "Show in file manager",
  "workbench.reload": "Inspect disk version",
  "workbench.close": "Close file",
  "workbench.drop":
    "Drop text, JSON, Markdown or PNG / JPEG / GIF / WebP images into the window, or use the open button.",
  "workbench.limits":
    "Text limit: 2MiB; image limit: 8MiB; up to 20 files per selection. Images are read-only. Embedded Markdown HTML is never executed.",
  "workbench.empty":
    "No files are open. Choose a file or create a new text document.",
  "workbench.documents": "Open files",
  "workbench.recent": "Recent files",
  "workbench.noRecent": "Open or drop files to add recent entries.",
  "workbench.editor": "Text editor",
  "workbench.preview": "Content preview",
  "workbench.dirty": "Unsaved changes",
  "workbench.image": "Read-only image attachment",
  "workbench.invalidJson":
    "JSON is incomplete. Fix it before saving; the original file has not changed.",
  "workbench.conflict":
    "Another application changed the disk file. Your edits are preserved. Inspect the disk version or save a copy.",
  "workbench.diskVersion": "Latest version on disk",
  "workbench.diskDescription":
    "Loading this version replaces your current edits. Save a copy first to keep your changes.",
  "workbench.useDisk": "Load disk version",
  "workbench.discardTitle": "Close and discard unsaved changes?",
  "workbench.discardDescription":
    "These edits exist only in this window. Save the file or a copy before closing to keep them.",
  "workbench.discard": "Discard and close",
  "workbench.localDraft": "New unsaved file",
  "tasks.title": "Background task center",
  "tasks.description":
    "Scan a selected directory or calculate SHA-256 hashes in Rust. Tasks continue when you navigate away or hide the window.",
  "tasks.pickDirectory": "Choose directory",
  "tasks.directory": "Task directory",
  "tasks.noDirectory": "Choose a local directory first",
  "tasks.kind": "Task type",
  "tasks.scan": "Scan file inventory",
  "tasks.sha256": "Calculate SHA-256",
  "tasks.start": "Start task",
  "tasks.cancel": "Request cancellation",
  "tasks.retry": "Run again",
  "tasks.export": "Export complete results",
  "tasks.exported": "Task results exported",
  "tasks.results": "Show results",
  "tasks.hideResults": "Hide results",
  "tasks.active": "Running {count} / 2 tasks",
  "tasks.queued": "Waiting {count} / 10 tasks",
  "tasks.waiting": "Waiting for an execution slot",
  "tasks.capacity":
    "Two tasks run at once; up to ten more wait in submission order. Waiting tasks can be cancelled.",
  "tasks.empty":
    "No tasks yet. Choose a directory, then scan it or calculate hashes.",
  "tasks.progress": "Processed {processed} / {total} files",
  "tasks.discovering": "Discovering files…",
  "tasks.history": "Recent tasks",
  "tasks.historyHint":
    "The latest 30 tasks are retained. Unfinished tasks become interrupted after restart and can be run again. Cancellation keeps completed results.",
  "tasks.limits":
    "Up to 5000 files and 32 directory levels per scan; symbolic links are not followed. Hashing is limited to 512MiB per file.",
  "tasks.path": "Relative path",
  "tasks.bytes": "Bytes",
  "tasks.hash": "SHA-256 / result",
  "tasks.noResults": "No completed file results.",
  "tasks.previewLimit":
    "The page previews up to 200 entries. Export includes all files processed by this task.",
  "tasks.truncated":
    "The scan reached its file limit. This is not a complete inventory of the directory.",
  "tasks.retryOf": "Rerun of task: {id}",
  "tasks.status.queued": "Queued",
  "tasks.status.running": "Running",
  "tasks.status.cancelling": "Cancelling",
  "tasks.status.completed": "Completed",
  "tasks.status.cancelled": "Cancelled",
  "tasks.status.failed": "Failed",
  "tasks.status.interrupted": "Interrupted",
} satisfies WorkbenchMessages;
