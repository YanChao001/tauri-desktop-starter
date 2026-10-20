import type { RecoveryMessages } from "./zh-recovery";
export const enRecovery: RecoveryMessages = {
  "recovery.title": "Startup recovery",
  "recovery.description":
    "Inspect and restore a backup in isolation, then schedule a verified replacement for the next launch.",
  "recovery.isolated": "Isolated recovery mode",
  "recovery.healthy": "Storage is healthy",
  "recovery.noAction":
    "Startup recovery is not needed. Manage regular backups on the local database page.",
  "recovery.preserved":
    "Original settings and database have not been discarded. Edits and trial restores affect only an isolated workspace. Do not manually delete the database or WAL files.",
  "recovery.archive": "Original files from the last recovery: {id}",
  "recovery.diagnostics": "Copy redacted diagnostics",
  "recovery.copied":
    "Diagnostics copied. Check for sensitive information before sharing.",
  "recovery.choose": "1. Choose and inspect a backup",
  "recovery.chooseHint":
    "Choose a local backup or import a previously exported JSON file. Invalid, oversized and unsupported backups are rejected while originals are preserved.",
  "recovery.import": "Import backup file",
  "recovery.preview": "Preview contents",
  "recovery.testRestore": "Test restore in isolation",
  "recovery.validated":
    "Isolated restore completed. Review the record count before scheduling replacement.",
  "recovery.schedule": "2. Schedule recovery for next launch",
  "recovery.scheduleHint":
    "A complete candidate database is verified. On the next launch, the original database and WAL / SHM files are archived before replacement. Interrupted or failed replacement restores originals. Newer schemas are never downgraded.",
  "recovery.recordCount": "{count} records restored in the isolated workspace",
  "recovery.resetSettings":
    "Also restore default preferences (archive originals; never overwrite a newer settings schema)",
  "recovery.pending":
    "Recovery is queued. Originals remain unchanged until validation and replacement on the next launch.",
  "recovery.restart": "Restart and apply recovery",
  "recovery.confirmTitle": "Schedule recovery?",
  "recovery.confirmDatabase":
    "Replace the original database with the verified isolated database. The original database and sidecar files are archived first.",
  "recovery.confirmWithSettings":
    "Use the verified isolated database and reset preferences. Original settings, database and sidecar files are archived first.",
  "recovery.confirm": "Schedule without restarting",
};
