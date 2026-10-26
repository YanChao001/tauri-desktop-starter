// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import {
  EXTENSION_SESSION_BYTES,
  extensionSessionIdentity,
  parseExtensionSession,
  serializeExtensionSession,
} from "./extension-session";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  validateExtensionView: vi.fn(),
}));
const item: native.ExtensionInfo = {
  generation: 1,
  origin: { kind: "local" },
  enabled: true,
  grantedPermissions: [],
  package: {
    sha256: "a".repeat(64),
    bytes: 100,
    manifest: {
      formatVersion: 3,
      apiVersion: 2,
      minHostVersion: "0.1.0",
      id: "example.tool",
      name: "Tool",
      version: "1.0.0",
      description: "Example",
      author: "Example",
      commands: [
        {
          id: "open",
          title: "Open",
          function: "open",
          inputFormat: "json",
          resultFormat: "view",
          permissions: [],
        },
        {
          id: "run",
          title: "Run",
          function: "run",
          inputFormat: "text",
          resultFormat: "text",
          permissions: [],
        },
      ],
      permissions: [],
      optionalPermissions: [],
      network: [],
    },
  },
};
const view: native.ExtensionView = {
  version: 2,
  state: "saved state",
  display: "Saved view",
  description: "",
  fields: [{ id: "query", label: "Query", value: "original", maxBytes: 2048 }],
  groups: [],
};
function session(kind: "view" | "tool" = "view") {
  return {
    formatVersion: 1,
    kind,
    ...extensionSessionIdentity(item, kind === "view" ? "open" : "run"),
    inputText: "input",
    files: ["sample.txt"],
    url: "",
    fields: kind === "view" ? { query: "edited" } : {},
    view: kind === "view" ? view : null,
    result: kind === "view" ? null : { format: "text", text: "saved result" },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.validateExtensionView).mockResolvedValue(view);
});

it("binds custom UI checkpoints to the exact document hash and preserves valid drafts", async () => {
  const uiItem: native.ExtensionInfo = {
    ...item,
    package: {
      ...item.package,
      uiDocuments: [{ id: "main", sha256: "b".repeat(64), bytes: 20 }],
      manifest: {
        ...item.package.manifest,
        commands: item.package.manifest.commands.map((command) =>
          command.id === "open"
            ? {
                ...command,
                ui: { sidebar: true, window: true, document: "main" },
              }
            : command,
        ),
      },
    },
  };
  const ui = {
    sha256: "b".repeat(64),
    state: JSON.stringify({ draft: "保留这段草稿" }),
  };
  const saved = { ...session(), ui };
  const restored = await parseExtensionSession(
    JSON.stringify(saved),
    uiItem,
    "open",
    "view",
  );
  expect(restored.ui).toEqual(ui);
  await expect(
    parseExtensionSession(
      JSON.stringify({ ...saved, ui: { ...ui, sha256: "c".repeat(64) } }),
      uiItem,
      "open",
      "view",
    ),
  ).rejects.toThrow();
  await expect(
    parseExtensionSession(
      JSON.stringify({ ...saved, ui: { ...ui, state: "broken" } }),
      uiItem,
      "open",
      "view",
    ),
  ).rejects.toThrow();
});
it("restores an exported empty view session without initializing the plugin", async () => {
  const restored = await parseExtensionSession(
    JSON.stringify({ ...session(), view: null, fields: {} }),
    item,
    "open",
    "view",
  );
  expect(restored.view).toBeNull();
  expect(native.validateExtensionView).not.toHaveBeenCalled();
});
it("allows a user-confirmed export to move between installations of the exact same package", async () => {
  await expect(
    parseExtensionSession(
      JSON.stringify(session()),
      { ...item, generation: 2 },
      "open",
      "view",
    ),
  ).resolves.toMatchObject({
    extensionId: item.package.manifest.id,
    sha256: item.package.sha256,
  });
});
it("restores the exact package session with native view validation and keeps only file names", async () => {
  const restored = await parseExtensionSession(
    JSON.stringify(session()),
    item,
    "open",
    "view",
  );
  expect(native.validateExtensionView).toHaveBeenCalledWith(
    JSON.stringify(view),
  );
  expect(restored).toMatchObject({
    fields: { query: "edited" },
    files: ["sample.txt"],
    view,
  });
  expect(
    await parseExtensionSession(
      JSON.stringify(session("tool")),
      item,
      "run",
      "tool",
    ),
  ).toMatchObject({ result: { format: "text", text: "saved result" } });
});
it("rejects mismatched identities, unexpected data, non-string fields and oversized UTF-8 before native validation", async () => {
  for (const patch of [
    { extensionId: "other.plugin" },
    { commandId: "other" },
    { extensionVersion: "2.0.0" },
    { sha256: "b".repeat(64) },
    { formatVersion: 2 },
    { fields: { query: false } },
    { fields: { query: "中".repeat(90_000) } },
    { secret: "must-not-import" },
    { files: [{ id: "forged-resource" }] },
  ]) {
    await expect(
      parseExtensionSession(
        JSON.stringify({ ...session(), ...patch }),
        item,
        "open",
        "view",
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  }
  expect(native.validateExtensionView).not.toHaveBeenCalled();
});
it("preserves bounded unsubmitted drafts without changing the valid native view", async () => {
  for (const kind of ["number", "date", "select", "checkbox"] as const) {
    const original = {
      ...view,
      fields: [
        {
          id: "query",
          label: "Value",
          kind,
          value:
            kind === "date"
              ? "2026-10-25"
              : kind === "checkbox"
                ? "false"
                : "1",
          ...(kind === "select"
            ? { options: [{ label: "One", value: "1" }] }
            : {}),
        },
      ],
    };
    vi.mocked(native.validateExtensionView).mockResolvedValueOnce(original);
    const restored = await parseExtensionSession(
      serializeExtensionSession({
        ...session(),
        view: original,
        fields: { query: "invalid draft" },
      }),
      item,
      "open",
      "view",
    );
    expect(restored.fields).toEqual({ query: "invalid draft" });
    expect(restored.view).toEqual(original);
    expect(native.validateExtensionView).toHaveBeenLastCalledWith(
      JSON.stringify(original),
    );
  }
  const draft = "x".repeat(2049);
  await expect(
    parseExtensionSession(
      serializeExtensionSession({ ...session(), fields: { query: draft } }),
      item,
      "open",
      "view",
    ),
  ).resolves.toMatchObject({ fields: { query: draft }, view });
});
it("rejects drafts with missing or unknown field identities", async () => {
  for (const fields of [
    {},
    { other: "draft" },
    { query: "draft", other: "extra" },
  ])
    await expect(
      parseExtensionSession(
        serializeExtensionSession({ ...session(), fields }),
        item,
        "open",
        "view",
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});
it("round trips the largest legal tool strings after worst-case JSON escaping", async () => {
  const inputText = "\u0001".repeat(1024 * 1024);
  const resultText = "\u001f".repeat(4 * 1024 * 1024);
  const content = serializeExtensionSession({
    ...session("tool"),
    inputText,
    result: { format: "text", text: resultText },
  });
  const bytes = new TextEncoder().encode(content).length;
  expect(bytes).toBeGreaterThan(8 * 1024 * 1024);
  expect(bytes).toBeLessThanOrEqual(EXTENSION_SESSION_BYTES);
  const restored = await parseExtensionSession(content, item, "run", "tool");
  expect(restored.inputText === inputText).toBe(true);
  expect(restored.result?.text === resultText).toBe(true);
  expect(native.validateExtensionView).not.toHaveBeenCalled();
});
it("rejects encoded sessions above 32 MiB before native validation or saving", async () => {
  const content = " ".repeat(EXTENSION_SESSION_BYTES + 1);
  expect(() =>
    serializeExtensionSession({ ...session(), padding: content }),
  ).toThrowError(expect.objectContaining({ code: "INPUT_TOO_LONG" }));
  await expect(
    parseExtensionSession(content, item, "open", "view"),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(native.validateExtensionView).not.toHaveBeenCalled();
});
it("uses the same hard draft limits before writing and while restoring", async () => {
  for (const patch of [
    { inputText: "x".repeat(1024 * 1024 + 1) },
    { url: "x".repeat(4097) },
    { files: ["x".repeat(1025)] },
    { files: Array.from({ length: 17 }, () => "sample.txt") },
    { fields: { query: "x".repeat(256 * 1024 + 1) } },
    {
      fields: Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [
          `field${index}`,
          "x".repeat(256 * 1024),
        ]),
      ),
    },
  ]) {
    const value = { ...session(), ...patch };
    expect(() => serializeExtensionSession(value)).toThrowError(
      expect.objectContaining({ code: "INPUT_TOO_LONG" }),
    );
    await expect(
      parseExtensionSession(JSON.stringify(value), item, "open", "view"),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  }
  expect(native.validateExtensionView).not.toHaveBeenCalled();
});
it("retains native validation failures and rejects a mismatched tool output format", async () => {
  vi.mocked(native.validateExtensionView).mockRejectedValueOnce({
    code: "EXTENSION_RUN_FAILED",
  });
  await expect(
    parseExtensionSession(
      serializeExtensionSession({
        ...session(),
        view: { ...view, version: 999 },
      }),
      item,
      "open",
      "view",
    ),
  ).rejects.toMatchObject({ code: "EXTENSION_RUN_FAILED" });
  expect(native.validateExtensionView).toHaveBeenLastCalledWith(
    JSON.stringify({ ...view, version: 999 }),
  );
  await expect(
    parseExtensionSession(
      JSON.stringify({
        ...session("tool"),
        result: { format: "markdown", text: "different command format" },
      }),
      item,
      "run",
      "tool",
    ),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});
