import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { applyFileChanges } from "./fs-utils.mjs";

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-file-changes-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function fixture(t) {
  const root = temporary(t);
  mkdirSync(join(root, "nested"));
  const changes = [
    { path: "text.txt", before: "old text", content: "new text" },
    {
      path: "nested/image.bin",
      before: Buffer.from([0x80]),
      content: Buffer.from([0x81]),
    },
    { path: "pending.txt", before: "old pending", content: "new pending" },
  ];
  for (const { path, before } of changes)
    writeFileSync(join(root, path), before);
  return { root, changes };
}

test("a failed commit restores text and binary files and removes staged files", (t) => {
  const plan = fixture(t);
  assert.throws(
    () =>
      applyFileChanges(plan, {
        beforeCommit(index) {
          if (index === 2) throw new Error("simulated write failure");
        },
      }),
    /simulated write failure/,
  );
  for (const { path, before } of plan.changes)
    assert.deepEqual(readFileSync(join(plan.root, path)), Buffer.from(before));
  assert.ok(
    readdirSync(plan.root, { recursive: true }).every(
      (name) => !basename(name).startsWith(".update-"),
    ),
  );
});

test("rollback preserves concurrent user edits and retains the original backup", (t) => {
  const plan = fixture(t);
  assert.throws(
    () =>
      applyFileChanges(plan, {
        beforeCommit(index) {
          if (index === 2) {
            writeFileSync(join(plan.root, "text.txt"), "concurrent user edit");
            throw new Error("simulated write failure");
          }
        },
      }),
    /恢复失败.*备份保留/,
  );
  assert.equal(
    readFileSync(join(plan.root, "text.txt"), "utf8"),
    "concurrent user edit",
  );
  const backups = readdirSync(plan.root).filter((name) =>
    name.endsWith(".bak"),
  );
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(plan.root, backups[0]), "utf8"), "old text");
  for (const { path, before } of plan.changes.slice(1))
    assert.deepEqual(readFileSync(join(plan.root, path)), Buffer.from(before));
});

test("preflight preserves changed text and binary bytes that decode to the same character", (t) => {
  for (const [path, contents] of [
    ["text.txt", "concurrent edit"],
    ["nested/image.bin", Buffer.from([0x81])],
  ]) {
    const plan = fixture(t);
    writeFileSync(join(plan.root, path), contents);
    assert.throws(() => applyFileChanges(plan), /预检后被修改/);
    for (const change of plan.changes)
      assert.deepEqual(
        readFileSync(join(plan.root, change.path)),
        Buffer.from(change.path === path ? contents : change.before),
      );
  }
});

test("transaction cleanup cannot follow a directory replaced after staging", (t) => {
  const plan = fixture(t);
  const outside = temporary(t);
  const warnings = t.mock.method(console, "warn", () => {});
  let outsideTemporary;
  let outsideBackup;
  assert.throws(
    () =>
      applyFileChanges(plan, {
        beforeCommit(index, entry) {
          if (index !== 1) return;
          renameSync(join(plan.root, "nested"), join(plan.root, "original"));
          symlinkSync(
            outside,
            join(plan.root, "nested"),
            process.platform === "win32" ? "junction" : "dir",
          );
          outsideTemporary = join(outside, basename(entry.temporary));
          outsideBackup = join(outside, basename(entry.backup));
          writeFileSync(outsideTemporary, "unrelated temporary file");
          writeFileSync(outsideBackup, "unrelated backup file");
        },
      }),
    /文件目录在预检后被替换/,
  );
  assert.equal(
    readFileSync(outsideTemporary, "utf8"),
    "unrelated temporary file",
  );
  assert.equal(readFileSync(outsideBackup, "utf8"), "unrelated backup file");
  assert.equal(readFileSync(join(plan.root, "text.txt"), "utf8"), "old text");
  assert.ok(warnings.mock.callCount() > 0);
});
