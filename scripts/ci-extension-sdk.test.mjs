import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import {
  assertColdHeadroom,
  prepareSdkTool,
  verifySdkTool,
} from "./ci-extension-sdk.mjs";

const sourceSha = "a".repeat(40);

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "starter-sdk-receipt-"));
  try {
    const executable = join(root, "extension-tool");
    const expectedSource = join(root, "extension-tool.rs");
    const messages = join(root, "cargo.jsonl");
    const directory = join(root, "artifact");
    await writeFile(executable, "optimized host fixture");
    const artifact = {
      reason: "compiler-artifact",
      target: {
        name: "extension-tool",
        kind: ["bin"],
        src_path: expectedSource,
      },
      executable,
      profile: { opt_level: "s", debug_assertions: false, test: false },
      fresh: true,
    };
    const save = () => writeFile(messages, `${JSON.stringify(artifact)}\n`);
    await save();
    await run({ artifact, save, messages, directory, expectedSource });
  } finally {
    assert.ok(
      resolve(root).startsWith(
        `${resolve(tmpdir())}${sep}starter-sdk-receipt-`,
      ),
    );
    await rm(root, { recursive: true });
  }
}

test("a Cargo cache hit still proves the optimized host and exact byte snapshot", async () => {
  await fixture(async ({ messages, directory, expectedSource }) => {
    const receipt = await prepareSdkTool(messages, directory, {
      sourceSha,
      expectedSource,
    });
    assert.equal(receipt.profile.optLevel, "s");
    const tool = await verifySdkTool(directory, sourceSha);
    assert.equal(
      await readFile(tool.executable, "utf8"),
      "optimized host fixture",
    );
    assert.equal(tool.receipt.sourceSha, sourceSha);
  });
});

test("a debug or unoptimized Cargo artifact is rejected before publication", async () => {
  await fixture(
    async ({ artifact, save, messages, directory, expectedSource }) => {
      for (const profile of [
        { opt_level: "0", debug_assertions: false, test: false },
        { opt_level: "3", debug_assertions: true, test: false },
        { opt_level: "s", debug_assertions: false, test: true },
      ]) {
        artifact.profile = profile;
        await save();
        await assert.rejects(
          prepareSdkTool(messages, directory, { sourceSha, expectedSource }),
          /optimized.*host/i,
        );
      }
    },
  );
});

test("an unrelated executable cannot supply the SDK validation tool", async () => {
  await fixture(
    async ({ artifact, save, messages, directory, expectedSource }) => {
      artifact.target.src_path = join(expectedSource, "other.rs");
      await save();
      await assert.rejects(
        prepareSdkTool(messages, directory, { sourceSha, expectedSource }),
        /extension-tool.*artifact/i,
      );
    },
  );
});

test("receipt verification rejects another commit, changed bytes and path traversal", async () => {
  await fixture(async ({ messages, directory, expectedSource }) => {
    await prepareSdkTool(messages, directory, { sourceSha, expectedSource });
    await assert.rejects(verifySdkTool(directory, "b".repeat(40)), /source/i);
    const tool = await verifySdkTool(directory, sourceSha);
    await writeFile(tool.executable, "replaced binary");
    await assert.rejects(verifySdkTool(directory, sourceSha), /hash/i);
    const receipt = tool.receipt;
    receipt.executable = "../extension-tool";
    await writeFile(join(directory, "receipt.json"), JSON.stringify(receipt));
    await assert.rejects(verifySdkTool(directory, sourceSha), /receipt/i);
  });
});

test("cold checks reserve at least half of the 15-second worker budget", () => {
  assert.doesNotThrow(() =>
    assertColdHeadroom({ name: "javascript", elapsedMs: 7500, status: 0 }),
  );
  assert.throws(
    () =>
      assertColdHeadroom({ name: "javascript", elapsedMs: 7501, status: 0 }),
    /headroom/i,
  );
  assert.throws(
    () => assertColdHeadroom({ name: "javascript", elapsedMs: 100, status: 1 }),
    /failed/i,
  );
});
