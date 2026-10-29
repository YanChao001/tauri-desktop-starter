import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

test("upstream UI components still enforce the native facade boundary", async () => {
  for (const source of [
    'import { invoke } from "@tauri-apps/api/core";\nexport const Probe = () => <button onClick={() => invoke("unsafe")}>Run</button>;',
    'export async function probe() { return import("@tauri-apps/api/core"); }',
  ]) {
    const [result] = await eslint.lintText(source, {
      filePath: "src/components/ui/boundary-probe.tsx",
    });
    assert.equal(result.fatalErrorCount, 0);
    assert.ok(
      result.messages.some((message) =>
        ["no-restricted-imports", "no-restricted-syntax"].includes(
          message.ruleId,
        ),
      ),
    );
  }
});

test("application modules reject imports after executable declarations", async () => {
  const [result] = await eslint.lintText(
    'export const ready = true;\nimport { cn } from "@/lib/utils";\nexport const classes = cn("flex");',
    { filePath: "src/pages/import-probe.tsx" },
  );
  assert.equal(result.fatalErrorCount, 0);
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === "no-restricted-syntax",
    ),
  );
});
