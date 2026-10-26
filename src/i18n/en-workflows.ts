import { enExtensions } from "./en-extensions";
export const enWorkflows = {
  ...enExtensions,
  "samples.original": "Download original text",
  "samples.changed": "Download changed version",
  "samples.csvHint":
    "The sample has 2 valid rows and 1 invalid row. Open Import, validate and export, then load or choose the sample. Find the email and budget issues, explicitly import the valid rows, and export the result.",
  "samples.textHint":
    "Save samples in a dedicated test folder. Open and edit the original in the workbench. To create a conflict, copy the changed version's content into that same test file, then save in the app and compare. Downloading does not replace files or create notes automatically.",
  "samples.tasksHint":
    "Place both samples in a dedicated test folder, then choose it here for scanning or SHA-256. Results should include the files. Downloading samples does not start tasks or delete data.",
  "search.content": "Notes and recent files",
  "search.open": "Open search result",
  "search.note": "Local note · title or body match",
  "search.file": "Authorized recent file · filename match",
  "search.hint":
    "Type at least 2 characters to search commands, local notes and recent filenames; up to 8 results per type.",
  "search.browser":
    "Search commands in a browser. Local notes and recent file search require the desktop app.",
  "search.loading": "Searching local content…",
  "search.failed":
    "Some content could not be searched. Commands and successful results remain available.",
  "search.limit":
    "Content search allows up to 200 UTF-8 bytes. Shorten the query.",
  "diff.title": "Body difference comparison",
  "diff.count": "{count} changes",
  "diff.hint":
    "Local content is kept by default. Choose each block. Long previews are shortened; the full content is retained when merging. Apply updates the editor only; saving still checks the current version.",
  "diff.local": "Local draft",
  "diff.remote": "Other version",
  "diff.blocks": "Differences and per-block choices",
  "diff.change": "Difference block {number}",
  "diff.empty": "Empty content",
  "diff.omitted": "…{count} more lines not shown",
  "diff.shortened": "…Long-line preview shortened; full content is retained",
  "diff.apply": "Apply merged result to editor",
  "diff.titleChoice": "Title after merge",
  "diff.keepTitle": "Keep local title",
  "diff.remoteTitle": "Use other version title",
  "csv.title": "Import, validate and export",
  "csv.hint":
    "UTF-8 CSV up to 2 MiB, 10,000 rows and 32 columns. Import replaces this page's temporary records only; it does not write to the notes database. Export anything you want to keep.",
  "csv.file": "Choose a UTF-8 CSV file",
  "csv.source": "CSV source (edit and check again)",
  "csv.sample": "Load sample with errors",
  "csv.downloadSample": "Download CSV sample",
  "csv.check": "Check and preview",
  "csv.mapping": "Map columns",
  "csv.none": "Not mapped (use default)",
  "csv.defaults":
    "Name and email are required. Unmapped team, status and budget default to operations, active and 0. Teams: design / engineering / operations. Status: active / archived. IDs are generated from imported rows.",
  "csv.summary":
    "Validation preview: {valid} valid rows, {invalid} invalid rows.",
  "csv.partial": "Import valid rows only and retain invalid rows in the report",
  "csv.apply": "Import valid records",
  "csv.issues": "Validation issues (first 50 shown; report includes all)",
  "csv.issueHint":
    "Names need 1–120 characters, emails must be valid, team and status must use supported values, and budgets must be non-negative with up to two decimals and at most one billion. Each row must match the header width.",
  "csv.row": "CSV record row",
  "csv.field": "Field",
  "csv.value": "Original value (up to 80 characters in report)",
  "csv.issueExport": "Export issue report",
  "csv.preview": "Raw data preview (up to 20 rows)",
  "csv.exportCsv": "Export all CSV",
  "csv.exportJson": "Export all JSON",
  "csv.exportFiltered": "Export filtered CSV",
  "csv.saved": "Export completed; check your downloads in a browser.",
  "csv.imported":
    "Loaded {count} temporary records. The original file was not changed.",
  "csv.replaceTitle": "Replace records that have not been exported?",
  "csv.replaceHint":
    "The current temporary data has unexported changes. Continue to replace it, or cancel and export first.",
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
