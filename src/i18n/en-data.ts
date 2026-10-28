import type { DataMessages } from "./zh-data";

export const enData: DataMessages = {
  "data.active": "All notes",
  "data.bodyLimit":
    "Note content is limited to 64 KiB (65536 UTF-8 bytes). Shorten it before saving.",
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
  "data.conflict": "Note changed in another window",
  "data.conflictHint":
    "Your edits are retained. Review the latest saved content before continuing and saving, or save a separate copy. Changes from other windows are never overwritten automatically.",
  "data.viewRemote": "View saved content",
  "data.remoteUnavailable":
    "The saved content is unavailable or the note was removed. Your edits are retained and can be saved as a copy.",
  "data.keepLocal": "Keep current edits",
  "data.saveCopy": "Save as a copy",
  "data.discardEdits": "Discard current edits",
  "data.draftRecovered":
    "Recovered this window's unsaved draft. Save it to update the note.",
  "data.draftSaved":
    "Draft saved on this device for this window's next launch.",
  "data.backups": "Backup and restore",
  "data.backupHint":
    "Backups include all notes, recycled items and per-window drafts and can be restored locally or exported. External imports are limited to 16 MiB; larger local backups remain restorable from their original backup directory.",
  "data.createBackup": "Create full backup",
  "data.backupAction": "Back up",
  "data.importBackup": "Import backup from file",
  "data.importBackupAction": "Import backup",
  "data.backupHistory": "Backup history",
  "data.previewBackup": "Preview backup",
  "data.exportBackup": "Export file",
  "data.restoreBackup": "Restore this backup",
  "data.backupCreated": "Backed up {count} notes",
  "data.backupCount": "{notes} notes · {trashed} recycled · {drafts} drafts",
  "data.restoreHint":
    "Restoring replaces all notes, recycled items and saved drafts. Current data is backed up first. A failed restore preserves current data.",
  "data.saveBeforeRestore":
    "Save or discard your current edits first. Unsaved edits in other windows remain protected by version conflict checks.",
  "data.restored":
    "Restored {count} records. Previous data is retained in a new safety backup.",
  "data.exported": "Backup exported",
};
