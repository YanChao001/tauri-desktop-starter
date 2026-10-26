// @vitest-environment node
import { expect, it } from "vitest";
import {
  CsvError,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  guessMapping,
  parseCsv,
  recordsCsv,
  validateImport,
} from "./csv";

it("解析 BOM、引号、逗号、跨行字段及 CRLF，并保留末尾空字段", () => {
  expect(
    parseCsv('\uFEFFname,email,team\r\n"a,""b""\nc",a@example.test,\r\n').rows,
  ).toEqual([['a,"b"\nc', "a@example.test", ""]]);
  for (const input of [
    'a,b\n"unterminated',
    'a,b\n"x"z,y',
    "a,a\nx,y",
    'a,b\nx"y,z',
  ]) {
    expect(() => parseCsv(input)).toThrow(CsvError);
  }
  expect(() => parseCsv("x".repeat(MAX_CSV_BYTES + 1))).toThrow("size");
});

it("只忽略真正的空白行，带引号的空记录仍参与逐行校验和数量限制", () => {
  const table = parseCsv('name,email\n\n""\nGood,good@example.test\n');
  const result = validateImport(table, guessMapping(table.headers));
  expect(result.records).toHaveLength(1);
  expect(result.rejected).toBe(1);
  expect(result.issues).toEqual([{ row: 2, field: "row", value: "1" }]);
  expect(() => parseCsv('""\nname,email')).toThrow("header");
  expect(() =>
    parseCsv("name,email\n" + '""\n'.repeat(MAX_CSV_ROWS + 1)),
  ).toThrow("limit");
});

it("拒绝引号内或未映射列中的 NUL，避免损坏内容通过格式校验", () => {
  expect(() =>
    parseCsv('name,email,extra\nGood,good@example.test,"a\0b"'),
  ).toThrow("format");
});

it("字段映射校验每一行，不静默丢弃错误或重复分配 ID", () => {
  const table = parseCsv(
    "邮箱,名称,预算\na@example.test,A,1.25\nbad,B,-1\nc@example.test,C,3\nwrong,width",
  );
  const result = validateImport(table, guessMapping(table.headers));
  expect(result.records.map((record) => record.id)).toEqual([1, 3]);
  expect(result.records[0]).toMatchObject({
    name: "A",
    team: "operations",
    status: "active",
    budget: 1.25,
  });
  expect(result.rejected).toBe(2);
  expect(result.issues.map((issue) => [issue.row, issue.field])).toEqual([
    [3, "email"],
    [3, "budget"],
    [5, "row"],
  ]);
  expect(() =>
    validateImport(table, { ...guessMapping(table.headers), email: null }),
  ).toThrow("mapping");
});

it("CSV 导出转义文本并阻止电子表格公式，同时保留正常数据可往返", () => {
  const item = {
    id: 1,
    name: '=HYPERLINK("bad")',
    email: "a@example.test",
    team: "design" as const,
    status: "active" as const,
    budget: 12.5,
  };
  const source = [item];
  const table = parseCsv(recordsCsv(source));
  expect(table.rows[0]?.[0]).toBe("'" + item.name);
  const safe = [{ ...item, name: 'a,"b"\nc' }];
  const roundTrip = parseCsv(recordsCsv(safe));
  expect(
    validateImport(roundTrip, guessMapping(roundTrip.headers)).records,
  ).toEqual(safe);
});
