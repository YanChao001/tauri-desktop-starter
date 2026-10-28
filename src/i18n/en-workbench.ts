import type { WorkbenchMessages } from "./zh-workbench";
export const enWorkbench = {
  "nav.workbench": "File workbench",
  "nav.tasks": "Background tasks",
  "workbench.title": "File workbench",
  "workbench.description":
    "Open, edit and preview local files, including text, JSON, Markdown and images.",
  "workbench.open": "Open files",
  "workbench.new": "New text file",
  "workbench.sample": "Open JSON sample",
  "workbench.sampleTitle": "Sample file",
  "workbench.untitled": "Untitled.txt",
  "workbench.save": "Save file",
  "workbench.saveAs": "Save a copy",
  "workbench.saved": "File saved",
  "workbench.importNote": "Import a note copy",
  "workbench.imported":
    "Saved a note copy. The original file and current edits are preserved.",
  "workbench.openNotes": "Open notes",
  "workbench.noteLimit":
    "Note content is limited to 64 KiB. Reduce the content or save it as a file.",
  "workbench.saveCancelled": "Saving cancelled. Your edits are preserved.",
  "workbench.busy": "A file operation is still running. Wait and try again.",
  "workbench.reveal": "Show in file manager",
  "workbench.reload": "Inspect disk version",
  "workbench.close": "Close file",
  "workbench.clearOpenErrors": "Clear file errors",
  "workbench.drop":
    "Drop text, JSON, Markdown or images here, or choose Open files.",
  "workbench.limits":
    "Up to 2 MiB per text file, 8 MiB per image and 20 files per selection. Images are preview only.",
  "workbench.empty":
    "No files are open. Choose a file or create a new text document.",
  "workbench.documents": "Open files",
  "workbench.recent": "Recent files",
  "workbench.noRecent": "No recently opened files.",
  "workbench.editor": "Text editor",
  "workbench.preview": "Content preview",
  "workbench.dirty": "Unsaved changes",
  "workbench.image": "Image preview",
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
  "tasks.title": "Background tasks",
  "tasks.description":
    "Scan folders or calculate file checksums. Tasks continue when you leave this page.",
  "tasks.pickDirectory": "Choose folder",
  "tasks.directory": "Task folder",
  "tasks.noDirectory": "Choose a local folder first",
  "tasks.kind": "Task type",
  "tasks.scan": "Scan file inventory",
  "tasks.sha256": "Calculate file checksums (SHA-256)",
  "tasks.start": "Start task",
  "tasks.cancel": "Request cancellation",
  "tasks.retry": "Run again",
  "tasks.export": "Export complete results",
  "tasks.exported": "Task results exported",
  "tasks.results": "Show results",
  "tasks.hideResults": "Hide results",
  "tasks.active": "Running {count} / 2",
  "tasks.queued": "Queued {count} / 10",
  "tasks.waiting": "Waiting for earlier tasks to finish",
  "tasks.capacity":
    "Run up to 2 tasks at once, with 10 more waiting in the queue.",
  "tasks.empty":
    "No tasks yet. Choose a folder and start a scan or checksum task.",
  "tasks.loading": "Loading tasks…",
  "tasks.countUnavailable": "Task counts are unavailable",
  "tasks.interruptedHint":
    "The task was interrupted when the app closed. You can run it again.",
  "tasks.unreadableEntries":
    "{count} entries could not be read. View the results for details.",
  "tasks.reportUnavailable":
    "The report could not be saved. Export the complete results before closing the app.",
  "tasks.legacyNotice":
    "This task has a detailed record. Expand the results to view it.",
  "tasks.entryLimit":
    "This file or path exceeds the task limits and was skipped.",
  "tasks.entryFailed":
    "This file could not be processed. Expand the original diagnostic for details.",
  "tasks.diagnostics": "Original diagnostic",
  "tasks.progress": "Processed {processed} / {total} files",
  "tasks.discovering": "Discovering files…",
  "tasks.history": "Recent tasks",
  "tasks.historyHint":
    "The latest 30 tasks are retained. Cancellation keeps completed results.",
  "tasks.limits":
    "Up to 5000 files and 32 folder levels per scan. Links to other locations are not followed. Checksums are calculated only for files up to 512MiB.",
  "tasks.path": "Relative path",
  "tasks.bytes": "Bytes",
  "tasks.hash": "File checksum / result",
  "tasks.noResults": "No completed file results.",
  "tasks.previewLimit":
    "Previewing up to 200 entries. Export to view the complete results.",
  "tasks.truncated":
    "The scan reached its file count or directory depth limit. This is not a complete inventory of the directory.",
  "tasks.retryOf": "Rerun of task: {id}",
  "tasks.status.queued": "Queued",
  "tasks.status.running": "Running",
  "tasks.status.cancelling": "Cancelling",
  "tasks.status.completed": "Completed",
  "tasks.status.cancelled": "Cancelled",
  "tasks.status.failed": "Failed",
  "tasks.status.interrupted": "Interrupted",
} satisfies WorkbenchMessages;
