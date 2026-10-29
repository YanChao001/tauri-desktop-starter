import { enExtensions } from "./en-extensions";
export const enWorkflows = {
  ...enExtensions,
  "samples.original": "Download original text",
  "samples.changed": "Download changed version",
  "samples.csvHint":
    "The sample has 2 valid rows and 1 invalid row. Load it in “Import, validate and export”, review email and budget errors, confirm importing valid rows, then export.",
  "samples.textHint":
    "Save samples in a dedicated test folder, then open and edit the original in the workbench. To test conflicts, copy the changed text into that same file, save in the app and compare. Downloads do not replace files or create notes automatically.",
  "samples.tasksHint":
    "Put both samples in a dedicated test folder, then select it to scan or calculate SHA-256. Results should include both files; downloading does not start tasks or delete data.",
  "search.content": "Notes and recent files",
  "search.open": "Open search result",
  "search.note": "Local note · title or body match",
  "search.file": "Authorized recent file · filename match",
  "search.hint":
    "Type at least 2 characters to search commands, local notes and recent filenames; up to 8 results per type.",
  "search.browser":
    "Search commands here; local notes and recent files require the desktop app.",
  "search.loading": "Searching local content…",
  "search.failed":
    "Some content searches failed. Commands and found results remain available.",
  "search.limit": "Content query limit: 200 UTF-8 bytes. Shorten the query.",
  "diff.title": "Body difference comparison",
  "diff.count": "{count} changes",
  "diff.hint":
    "Local content is selected by default. Choose each block’s version; shortened previews retain full content on merge. Apply only updates the editor; saving still checks the current version.",
  "diff.local": "Local draft",
  "diff.remote": "Other version",
  "diff.blocks": "Differences and block choices",
  "diff.change": "Difference block {number}",
  "diff.empty": "Empty content",
  "diff.omitted": "…{count} more lines not shown",
  "diff.shortened": "…Long line shortened in preview; full content retained",
  "diff.apply": "Apply merge to editor",
  "diff.titleChoice": "Title after merge",
  "diff.keepTitle": "Keep local title",
  "diff.remoteTitle": "Use other version title",
  "csv.title": "Import, validate and export",
  "csv.hint":
    "UTF-8 CSV up to 2 MiB, 10,000 rows and 32 columns. Import replaces this page's temporary records only; it does not write to the notes database. Export anything you want to keep.",
  "csv.file": "Choose a UTF-8 CSV file",
  "csv.source": "CSV source",
  "csv.sample": "Load sample with errors",
  "csv.downloadSample": "Download CSV sample",
  "csv.check": "Check and preview",
  "csv.mapping": "Map columns",
  "csv.none": "Not mapped (use default)",
  "csv.defaults":
    "Name and email are required. Unmapped team, status and budget use operations, active and 0. Teams: design / engineering / operations. Status: active / archived. IDs are generated for imported rows.",
  "csv.summary": "Preview: {valid} valid rows, {invalid} invalid rows.",
  "csv.partial": "Import valid rows only; keep invalid rows in the report",
  "csv.apply": "Import valid records",
  "csv.issues": "Validation issues (first 50; report contains all)",
  "csv.issueHint":
    "Names need 1–120 characters, emails must be valid, team and status must use supported values, and budgets must be non-negative with up to two decimals and at most one billion. Each row must match the header width.",
  "csv.row": "CSV record row",
  "csv.field": "Field",
  "csv.value": "Original value (report: up to 80 characters)",
  "csv.issueExport": "Export issue report",
  "csv.preview": "Raw data preview (up to 20 rows)",
  "csv.exportCsv": "Export all CSV",
  "csv.exportJson": "Export all JSON",
  "csv.exportFiltered": "Export filtered CSV",
  "csv.saved": "Exported; in a browser, check your downloads.",
  "csv.imported": "Loaded {count} temporary records; source file unchanged.",
  "csv.replaceTitle": "Replace records that have not been exported?",
  "csv.replaceHint":
    "Current temporary records have unexported changes. Continuing replaces them; cancel to export first.",
  "csv.replace": "Replace temporary records",
  "csv.work": "Temporary data studio records",
  "csv.error.size":
    "This file exceeds 2 MiB. Reduce its size and choose it again.",
  "csv.error.format":
    "Invalid CSV quoting or encoding. Use UTF-8, comma separators and two double quotes for a quote inside a quoted field.",
  "csv.error.limit":
    "More than 10,000 rows or 32 columns. Split the file before importing.",
  "csv.error.header":
    "Headers must be non-empty, unique and at most 120 characters. Correct the first row.",
  "csv.error.mapping": "Choose valid columns for name and email.",
} as const;
