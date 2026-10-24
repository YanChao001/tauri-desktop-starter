// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import {
  extensionSessionIdentity,
  parseExtensionSession,
} from "./extension-session";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  validateExtensionView: vi.fn(),
}));
const item: native.ExtensionInfo = {
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
it("restores the exact package session with native view validation and keeps only file names", async () => {
  const restored = await parseExtensionSession(
    JSON.stringify(session()),
    item,
    "open",
    "view",
  );
  expect(native.validateExtensionView).toHaveBeenCalledWith(
    JSON.stringify({
      ...view,
      fields: view.fields.map((field) => ({ ...field, value: "edited" })),
    }),
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
it("rejects invalid controls and per-field budgets after native schema validation", async () => {
  await expect(
    parseExtensionSession(
      JSON.stringify({ ...session(), fields: { query: "x".repeat(2049) } }),
      item,
      "open",
      "view",
    ),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  vi.mocked(native.validateExtensionView).mockResolvedValueOnce({
    ...view,
    fields: [
      { id: "query", label: "Enabled", kind: "checkbox", value: "false" },
    ],
  });
  await expect(
    parseExtensionSession(JSON.stringify(session()), item, "open", "view"),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  vi.mocked(native.validateExtensionView).mockResolvedValueOnce({
    ...view,
    fields: [
      {
        id: "query",
        label: "Mode",
        kind: "select",
        value: "one",
        options: [{ label: "One", value: "one" }],
      },
    ],
  });
  await expect(
    parseExtensionSession(JSON.stringify(session()), item, "open", "view"),
  ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});
it("passes edited number and date values through native semantic validation", async () => {
  for (const kind of ["number", "date"] as const) {
    const original = {
      ...view,
      fields: [
        {
          id: "query",
          label: "Value",
          kind,
          value: kind === "date" ? "2026-10-25" : "1",
        },
      ],
    };
    vi.mocked(native.validateExtensionView).mockRejectedValueOnce({
      code: "EXTENSION_RUN_FAILED",
    });
    await expect(
      parseExtensionSession(
        JSON.stringify({
          ...session(),
          view: original,
          fields: { query: "invalid draft" },
        }),
        item,
        "open",
        "view",
      ),
    ).rejects.toMatchObject({ code: "EXTENSION_RUN_FAILED" });
    expect(native.validateExtensionView).toHaveBeenLastCalledWith(
      JSON.stringify({
        ...original,
        fields: [{ ...original.fields[0], value: "invalid draft" }],
      }),
    );
  }
});
it("retains native validation failures and rejects a mismatched tool output format", async () => {
  vi.mocked(native.validateExtensionView).mockRejectedValueOnce({
    code: "EXTENSION_RUN_FAILED",
  });
  await expect(
    parseExtensionSession(JSON.stringify(session()), item, "open", "view"),
  ).rejects.toMatchObject({ code: "EXTENSION_RUN_FAILED" });
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
