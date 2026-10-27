import {
  NativeBridgeError,
  validateExtensionView,
  type ExtensionInfo,
  type ExtensionView,
  type ExtensionResultFormat,
} from "@/lib/tauri";
import {
  EXTENSION_MAX_FIELDS,
  validateUiCheckpoint,
} from "./extension-ui-bridge";

export const EXTENSION_SESSION_BYTES = 32 * 1024 * 1024;
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
function sessionDraft(
  value: Record<string, unknown>,
  tooLong: () => never = invalid,
) {
  function bounded(value: unknown, limit: number): string {
    if (typeof value !== "string" || value.includes("\0")) invalid();
    if (new TextEncoder().encode(value).length > limit) tooLong();
    return value;
  }
  const inputText = bounded(value.inputText, 1024 * 1024);
  const url = bounded(value.url, 4096);
  if (!Array.isArray(value.files) || !record(value.fields)) invalid();
  if (
    value.files.length > 16 ||
    Object.keys(value.fields).length > EXTENSION_MAX_FIELDS
  )
    tooLong();
  const files = value.files.map((name: unknown) => bounded(name, 1024));
  const entries: [string, string][] = [];
  let bytes = 0;
  for (const [key, field] of Object.entries(value.fields)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) invalid();
    const draft = bounded(field, 256 * 1024);
    bytes += new TextEncoder().encode(draft).length;
    entries.push([key, draft]);
  }
  if (bytes > 1024 * 1024) tooLong();
  return { inputText, url, files, fields: Object.fromEntries(entries) };
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
/** 写出与恢复共用草稿硬额度，JSON 转义后的文件另核对原生保存预算。 */
export function serializeExtensionSession(value: unknown): string {
  if (!record(value)) invalid();
  sessionDraft(value, () => {
    throw new NativeBridgeError({
      code: "INPUT_TOO_LONG",
      message: "Extension session draft exceeds its recovery limits",
      retryable: false,
    });
  });
  const content = JSON.stringify(value, null, 2);
  if (typeof content !== "string") invalid();
  if (new TextEncoder().encode(content).length > EXTENSION_SESSION_BYTES)
    throw new NativeBridgeError({
      code: "INPUT_TOO_LONG",
      message: "Encoded extension session exceeds 32 MiB",
      retryable: false,
    });
  return content;
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
  const draft = sessionDraft(value);
  const { fields } = draft;
  let view: ExtensionView | null = null;
  if (kind === "view") {
    if (value.result !== null) invalid();
    if (value.view === null) {
      if (Object.keys(fields).length) invalid();
    } else {
      if (!record(value.view)) invalid();
      // 原生视图与未提交草稿分别验证；保留有界草稿，供用户恢复后纠正。
      view = await validateExtensionView(JSON.stringify(value.view));
      if (
        view.fields.length !== Object.keys(fields).length ||
        view.fields.some((field) => !Object.hasOwn(fields, field.id))
      )
        invalid();
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
    ...draft,
    view,
    result,
  };
}
