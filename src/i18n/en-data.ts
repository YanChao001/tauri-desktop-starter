import type { DataMessages } from "./zh-data";

export const enData: DataMessages = {
  "data.active": "All notes",
  "data.trash": "Recycle bin",
  "data.sort": "Sort",
  "data.newest": "Recently updated",
  "data.oldest": "Oldest updated",
  "data.byTitle": "Title",
  "data.selectNote": "Select {title}",
  "data.selected": "{count} selected",
  "data.trashSelected": "Move to recycle bin",
  "data.restoreSelected": "Restore selected notes",
  "data.purge": "Delete permanently",
  "data.previous": "Previous",
  "data.next": "Next",
  "data.pageCount": "{from}–{to} of {total}",
  "data.trashDescription":
    "The note will move to the recycle bin, where it can be restored.",
  "data.batchHint":
    "Process {count} notes. If any version changed in another window, the entire operation is cancelled. Refresh before retrying.",
  "data.purgeHint":
    "Permanently delete {count} notes. This cannot be undone. Create a backup first if needed.",
  "data.confirm": "Confirm operation",
  "data.conflict": "Note version conflict",
  "data.conflictHint":
    "Your local text is retained. Review the remote content, then keep editing locally and save again, or save a separate copy. Remote changes are never overwritten automatically.",
  "data.viewRemote": "View remote content",
  "data.remoteUnavailable":
    "The remote content is unavailable or the note was removed. Your local text is retained and can be saved as a copy.",
  "data.keepLocal": "Keep local and continue editing",
  "data.saveCopy": "Save as a copy",
  "data.discardEdits": "Discard current edits",
  "data.draftRecovered":
    "Recovered this window's unsaved draft. Save it to update the note.",
  "data.draftSaved":
    "Draft saved on this device for this window's next launch.",
  "data.backups": "Backup and restore",
  "data.backupHint":
    "Backups include all notes, recycled items and per-window drafts. Each backup is limited to 16 MiB; oversized data is rejected, never truncated. Keep a local backup or export it to a file.",
  "data.createBackup": "Create full backup",
  "data.importBackup": "Import backup from file",
  "data.previewBackup": "Preview backup",
  "data.exportBackup": "Export file",
  "data.restoreBackup": "Restore this backup",
  "data.backupCreated": "Backed up {count} notes",
  "data.backupCount": "{notes} notes · {trashed} recycled · {drafts} drafts",
  "data.restoreHint":
    "Restoring replaces all notes, recycled items and persisted drafts. Current data is backed up first, then restored in a transaction. A failed restore preserves current data.",
  "data.saveBeforeRestore":
    "Save or discard your current edits first. Unsaved edits in other windows remain protected by version conflict checks.",
  "data.restored":
    "Restored {count} records. Previous data is retained in a new safety backup.",
  "data.exported": "Backup exported",
};
