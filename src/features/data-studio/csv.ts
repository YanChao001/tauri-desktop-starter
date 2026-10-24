import { z } from "zod";
import type { DemoRecord } from "./model";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 10000;
const emailSchema = z.email();
export const RECORD_FIELDS = [
  "name",
  "email",
  "team",
  "status",
  "budget",
] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];
export type CsvTable = { headers: string[]; rows: string[][] };
export type FieldMapping = Record<RecordField, number | null>;
export type ImportIssue = {
  row: number;
  field: RecordField | "row";
  value: string;
};

export class CsvError extends Error {
  constructor(
    readonly code: "size" | "format" | "limit" | "header" | "mapping",
  ) {
    super(code);
    this.name = "CsvError";
  }
}

/** 有界 RFC 4180 解析；引号内的换行属于字段，空白行不作为数据行。 */
export function parseCsv(source: string): CsvTable {
  if (
    source.length > MAX_CSV_BYTES ||
    new TextEncoder().encode(source).length > MAX_CSV_BYTES
  )
    throw new CsvError("size");
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const pushField = () => {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > 32) throw new CsvError("limit");
  };
  const pushRow = () => {
    const emptyLine = row.length === 0 && field === "" && !closed;
    pushField();
    if (!emptyLine) rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS + 1) throw new CsvError("limit");
  };
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "\0") throw new CsvError("format");
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === ",") pushField();
    else if (char === "\r" || char === "\n") {
      pushRow();
      if (char === "\r" && text[at + 1] === "\n") at++;
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new CsvError("format");
      field += char;
    }
  }
  if (quoted) throw new CsvError("format");
  if (field || row.length || closed) pushRow();
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  if (
    !headers.length ||
    headers.some(
      (value) => !value || value.length > 120 || value.includes("\0"),
    ) ||
    new Set(headers.map((value) => value.toLowerCase())).size !== headers.length
  )
    throw new CsvError("header");
  return { headers, rows };
}

export function guessMapping(headers: string[]): FieldMapping {
  const names: Record<RecordField, string[]> = {
    name: ["name", "名称", "姓名"],
    email: ["email", "邮箱"],
    team: ["team", "团队"],
    status: ["status", "状态"],
    budget: ["budget", "预算"],
  };
  return Object.fromEntries(
    RECORD_FIELDS.map((key) => {
      const index = headers.findIndex((header) =>
        names[key].includes(header.toLowerCase()),
      );
      return [key, index < 0 ? null : index];
    }),
  ) as FieldMapping;
}

export function validateImport(table: CsvTable, mapping: FieldMapping) {
  if (
    mapping.name === null ||
    mapping.email === null ||
    RECORD_FIELDS.some((key) => {
      const index = mapping[key];
      return (
        index !== null &&
        (!Number.isInteger(index) || index < 0 || index >= table.headers.length)
      );
    })
  )
    throw new CsvError("mapping");
  const records: DemoRecord[] = [];
  const issues: ImportIssue[] = [];
  let rejected = 0;
  table.rows.forEach((row, index) => {
    const number = index + 2;
    if (row.length !== table.headers.length) {
      issues.push({ row: number, field: "row", value: String(row.length) });
      rejected++;
      return;
    }
    const value = (key: RecordField, fallback = "") =>
      mapping[key] === null ? fallback : (row[mapping[key]] ?? "").trim();
    const name = value("name");
    const email = value("email");
    const team = value("team", "operations");
    const status = value("status", "active");
    const budget = value("budget", "0");
    const bad: RecordField[] = [];
    if (!name || name.length > 120 || name.includes("\0")) bad.push("name");
    if (email.length > 254 || !emailSchema.safeParse(email).success)
      bad.push("email");
    if (team !== "design" && team !== "engineering" && team !== "operations")
      bad.push("team");
    if (status !== "active" && status !== "archived") bad.push("status");
    if (
      !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(budget) ||
      Number(budget) > 1_000_000_000
    )
      bad.push("budget");
    if (bad.length) {
      rejected++;
      bad.forEach((key) =>
        issues.push({
          row: number,
          field: key,
          value: value(key).slice(0, 80),
        }),
      );
      return;
    }
    records.push({
      id: index + 1,
      name,
      email,
      team: team as DemoRecord["team"],
      status: status as DemoRecord["status"],
      budget: Number(budget),
    });
  });
  return { records, issues, rejected };
}

/** 导出到电子表格的文本加前缀，避免用户内容被当作公式执行。 */
export function csvCell(value: string | number): string {
  let text = String(value);
  const start = [...text].find((character) => character.charCodeAt(0) > 32);
  if ((start !== undefined && "=+-@".includes(start)) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function recordsCsv(records: readonly DemoRecord[]): string {
  return (
    [
      RECORD_FIELDS.join(","),
      ...records.map((record) =>
        RECORD_FIELDS.map((key) => csvCell(record[key])).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export function issuesCsv(issues: readonly ImportIssue[]): string {
  return (
    [
      "row,field,value",
      ...issues.map((issue) =>
        [issue.row, issue.field, issue.value].map(csvCell).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export const SAMPLE_CSV =
  'name,email,team,status,budget\r\n"Lin, Mei",mei@example.test,design,active,1200.50\r\nAlex,alex@example.test,engineering,active,800\r\nNeeds correction,not-an-email,operations,active,-2\r\n';
