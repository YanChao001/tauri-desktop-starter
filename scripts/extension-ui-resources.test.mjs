import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readUiDocuments } from "./extension-ui-resources.mjs";

const manifest = {
  commands: [{ ui: { document: "main" } }, { ui: { document: "main" } }],
};
test("UI reader snapshots a shared document once and refuses paths and missing UI directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "starter-ui-source-"));
  try {
    await writeFile(join(root, "main.html"), "<main>你好</main>");
    assert.deepEqual(await readUiDocuments(manifest, root), {
      main: "<main>你好</main>",
    });
    await assert.rejects(readUiDocuments(manifest));
    await assert.rejects(
      readUiDocuments({ commands: [{ ui: { document: "../outside" } }] }, root),
    );
    assert.deepEqual(await readUiDocuments({ commands: [] }), {});
  } finally {
    await rm(root, { recursive: true });
  }
});
test("UI reader refuses oversized, non-UTF-8 and non-file sources before packaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "starter-ui-source-"));
  try {
    await writeFile(join(root, "main.html"), Buffer.alloc(512 * 1024 + 1));
    await assert.rejects(readUiDocuments(manifest, root));
    await writeFile(join(root, "main.html"), Buffer.from([0xff, 0xfe]));
    await assert.rejects(readUiDocuments(manifest, root));
    await rm(join(root, "main.html"));
    await mkdir(join(root, "main.html"));
    await assert.rejects(readUiDocuments(manifest, root));
  } finally {
    await rm(root, { recursive: true });
  }
});
