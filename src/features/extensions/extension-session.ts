import {
  NativeBridgeError,
  validateExtensionView,
  type ExtensionInfo,
  type ExtensionView,
  type ExtensionResultFormat,
} from "@/lib/tauri";
import { validateUiCheckpoint } from "./extension-ui-bridge";

export const EXTENSION_SESSION_BYTES = 8 * 1024 * 1024;
export type ExtensionSessionExport = {
  formatVersion: 1;
  kind: "view" | "tool";
  extensionId: string;
  commandId: string;
  extensionVersion: string;
  sha256: string;
  ui?: { sha256: string; state: string | null };
  inputText: string;
  url: string;
  files: string[];
  fields: Record<string, string>;
  view: ExtensionView | null;
  result: { format: ExtensionResultFormat; text: string } | null;
};
function invalid(): never {
  throw new NativeBridgeError({
    code: "INVALID_ARGUMENT",
    message: "Invalid or incompatible extension session",
    retryable: false,
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    new TextEncoder().encode(value).length <= limit
  );
}
export function extensionSessionIdentity(
  item: ExtensionInfo,
  commandId: string,
) {
  return {
    extensionId: item.package.manifest.id,
    commandId,
    extensionVersion: item.package.manifest.version,
    sha256: item.package.sha256,
  };
}
/** Native parsing reuses the authoritative view schema, including artifacts and budgets. */
export async function parseExtensionSession(
  content: string,
  item: ExtensionInfo,
  commandId: string,
  kind: "view" | "tool",
): Promise<ExtensionSessionExport> {
  if (!text(content, EXTENSION_SESSION_BYTES)) invalid();
  const documentId = item.package.manifest.commands.find(
    (command) => command.id === commandId,
  )?.ui?.document;
  const document = item.package.uiDocuments?.find(
    (document) => document.id === documentId,
  );
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    invalid();
  }
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !==
      [
        "commandId",
        "extensionId",
        "extensionVersion",
        "fields",
        "files",
        "formatVersion",
        "inputText",
        "kind",
        "result",
        "sha256",
        "url",
        "view",
        ...(document ? ["ui"] : []),
      ]
        .sort()
        .join(",")
  )
    invalid();
  let ui: ExtensionSessionExport["ui"];
  if (document) {
    if (
      kind !== "view" ||
      !record(value.ui) ||
      Object.keys(value.ui).sort().join(",") !== "sha256,state" ||
      value.ui.sha256 !== document.sha256 ||
      (value.ui.state !== null && !validateUiCheckpoint(value.ui.state))
    )
      invalid();
    ui = { sha256: document.sha256, state: value.ui.state };
  }
  const identity = extensionSessionIdentity(item, commandId);
  if (
    value.formatVersion !== 1 ||
    value.kind !== kind ||
    Object.entries(identity).some(([key, expected]) => value[key] !== expected)
  )
    invalid();
  if (
    !text(value.inputText, 1024 * 1024) ||
    !text(value.url, 4096) ||
    !Array.isArray(value.files) ||
    value.files.length > 16 ||
    value.files.some((name: unknown) => !text(name, 1024)) ||
    !record(value.fields) ||
    Object.keys(value.fields).length > 24
  )
    invalid();
  const entries: [string, string][] = [];
  let bytes = 0;
  for (const [key, field] of Object.entries(value.fields)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key) || !text(field, 256 * 1024))
      invalid();
    bytes += new TextEncoder().encode(field).length;
    entries.push([key, field]);
  }
  if (bytes > 1024 * 1024) invalid();
  const fields: Record<string, string> = Object.fromEntries(entries);
  let view: ExtensionView | null = null;
  if (kind === "view") {
    if (value.result !== null) invalid();
    if (value.view === null) {
      if (Object.keys(fields).length) invalid();
    } else {
      if (!record(value.view)) invalid();
      const rawFields = value.view.fields;
      if (
        !Array.isArray(rawFields) ||
        rawFields.length !== Object.keys(fields).length
      )
        invalid();
      const restoredFields = rawFields.map((field: unknown) => {
        if (
          !record(field) ||
          typeof field.id !== "string" ||
          !Object.hasOwn(fields, field.id)
        )
          invalid();
        return { ...field, value: fields[field.id] };
      });
      // Validate the values that will actually be rendered and sent, including
      // number/date semantics, through the same Rust schema as live responses.
      view = await validateExtensionView(
        JSON.stringify({ ...value.view, fields: restoredFields }),
      );
      if (
        view.fields.length !== Object.keys(fields).length ||
        view.fields.some(
          (field) =>
            !Object.hasOwn(fields, field.id) ||
            new TextEncoder().encode(fields[field.id] ?? "").length >
              (field.maxBytes ?? 64 * 1024),
        )
      )
        invalid();
      for (const field of view.fields) {
        const value = fields[field.id];
        if (field.kind === "checkbox" && value !== "true" && value !== "false")
          invalid();
        if (
          field.kind === "select" &&
          !(field.options ?? []).some((option) => option.value === value)
        )
          invalid();
      }
    }
  } else if (value.view !== null || Object.keys(fields).length) invalid();
  let result: ExtensionSessionExport["result"] = null;
  if (value.result !== null) {
    const command = item.package.manifest.commands.find(
      (candidate) => candidate.id === commandId,
    );
    if (
      !record(value.result) ||
      Object.keys(value.result).sort().join(",") !== "format,text" ||
      value.result.format !== command?.resultFormat ||
      !text(value.result.text, 4 * 1024 * 1024)
    )
      invalid();
    if (value.result.format === "view") invalid();
    if (
      value.result.format !== "text" &&
      value.result.format !== "json" &&
      value.result.format !== "markdown"
    )
      invalid();
    result = { format: value.result.format, text: value.result.text };
    if (result.format === "json") {
      try {
        JSON.parse(result.text);
      } catch {
        invalid();
      }
    }
  }
  return {
    formatVersion: 1,
    kind,
    ...identity,
    ...(ui ? { ui } : {}),
    inputText: value.inputText,
    url: value.url,
    files: value.files as string[],
    fields,
    view,
    result,
  };
}
