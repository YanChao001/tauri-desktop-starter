import type { RecoveryMessages } from "./zh-recovery";
export const enRecovery: RecoveryMessages = {
  "recovery.title": "Startup recovery",
  "recovery.description":
    "Try restoring a backup in a separate space, then confirm replacement of your original data on the next launch.",
  "recovery.isolated": "Working in a separate recovery space",
  "recovery.healthy": "Storage is healthy",
  "recovery.noAction":
    "Startup recovery is not needed. Manage regular backups in local notes.",
  "recovery.preserved":
    "Your original settings and notes are preserved. Edits and trial restores affect only a separate recovery space. Do not manually delete app data or related files.",
  "recovery.archive": "Original files from the last recovery: {id}",
  "recovery.diagnostics": "Copy problem report",
  "recovery.copied":
    "Report copied. Check for sensitive information before sharing.",
  "recovery.choose": "1. Choose and inspect a backup",
  "recovery.chooseHint":
    "Choose a local backup or import an exported JSON file; invalid, oversized or newer-version backups are rejected without changing originals.",
  "recovery.import": "Import backup file",
  "recovery.backups": "Local recovery backups",
  "recovery.backupsLoading": "Loading local backups…",
  "recovery.backupsEmpty":
    "No local backups were found. Import a previously exported backup file.",
  "recovery.preview": "Preview contents",
  "recovery.testRestore": "Try restoring in a separate space",
  "recovery.validated":
    "Trial restore completed. Check the record count before scheduling replacement of your original data.",
  "recovery.schedule": "2. Schedule recovery for next launch",
  "recovery.scheduleHint":
    "The app checks the recovered data for completeness. On the next launch, original data and related files are archived before replacement. Interrupted or failed replacement restores originals. Data from newer versions is never overwritten by an older version.",
  "recovery.recordCount": "{count} records recovered in the trial restore",
  "recovery.resetSettings":
    "Also restore default preferences (archive originals; never overwrite newer-version settings)",
  "recovery.pending":
    "Recovery is queued. Originals remain unchanged until validation and replacement on the next launch.",
  "recovery.restart": "Restart and apply recovery",
  "recovery.confirmTitle": "Schedule recovery?",
  "recovery.confirmDatabase":
    "Replace your current notes data with the checked recovery data. Original data and related files are saved in the recovery archive first.",
  "recovery.confirmWithSettings":
    "Replace your current notes data with the checked recovery data and reset preferences. Original settings, data and related files are archived first.",
  "recovery.confirm": "Schedule without restarting",
};
