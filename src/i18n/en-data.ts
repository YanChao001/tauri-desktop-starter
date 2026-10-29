import type { DataMessages } from "./zh-data";

export const enData: DataMessages = {
  "data.active": "All notes",
  "data.bodyLimit":
    "Note content limit: 64 KiB (65536 UTF-8 bytes). Shorten it before saving.",
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
    "The note moves to the recycle bin and can be restored.",
  "data.batchHint":
    "Process {count} notes. If another window changed any note, the whole operation is cancelled. Refresh and retry.",
  "data.purgeHint":
    "Permanently delete {count} notes. This cannot be undone. Back up first if needed.",
  "data.confirm": "Confirm operation",
  "data.conflict": "Note changed in another window",
  "data.conflictHint":
    "Your edits are kept. Review the latest saved content or save a copy. Other windows' changes are not overwritten automatically.",
  "data.viewRemote": "View saved content",
  "data.remoteUnavailable":
    "Saved content is unavailable or the note was removed. Your edits are kept; save a copy if needed.",
  "data.keepLocal": "Keep current edits",
  "data.saveCopy": "Save as a copy",
  "data.discardEdits": "Discard current edits",
  "data.draftRecovered":
    "This window's draft was recovered. Save it to update the note.",
  "data.draftSaved": "Draft saved locally for this window's next launch.",
  "data.backups": "Backup and restore",
  "data.backupHint":
    "Back up all notes, recycled items and window drafts for local restore or export. File imports allow up to 16 MiB; larger local backups can be restored from their original backup directory.",
  "data.createBackup": "Full backup",
  "data.backupAction": "Back up",
  "data.importBackup": "Import backup file",
  "data.importBackupAction": "Import backup",
  "data.backupHistory": "Backup history",
  "data.previewBackup": "Preview backup",
  "data.exportBackup": "Export backup",
  "data.restoreBackup": "Restore backup",
  "data.backupCreated": "Backed up {count} notes",
  "data.backupCount": "{notes} notes · {trashed} recycled · {drafts} drafts",
  "data.restoreHint":
    "Restoring replaces all notes, recycled items and saved drafts. Current data is backed up first and preserved if restoration fails.",
  "data.saveBeforeRestore":
    "Save or discard current edits first. Version checks still protect unsaved edits in other windows.",
  "data.restored":
    "Restored {count} records. Previous data is kept in a new safety backup.",
  "data.exported": "Backup exported",
};
