// Browser fixture only: real Wasm runs in the CLI; system dialogs and IPC are not simulated as production success.
export * from "../../src/lib/tauri";
import {
  NativeBridgeError,
  type ExtensionSnapshot,
  type ExtensionViewInput,
  type ExtensionView,
  type ExtensionArtifact,
} from "../../src/lib/tauri";
import type { UnsavedWork } from "../../src/providers/unsaved-work";

declare global {
  interface Window {
    __extensionUiTest: {
      commands: string[];
      exports: { name: string; content: string }[];
      exportPath: string | null;
      artifacts: ExtensionArtifact[];
      work: UnsavedWork | null;
    };
  }
}
window.__extensionUiTest = {
  commands: [],
  exports: [],
  exportPath: null,
  artifacts: [],
  work: null,
};
const configuration = (await fetch("/fixture/config").then((response) =>
  response.json(),
)) as { snapshot: ExtensionSnapshot };
export const isTauri = () => true;
export const extensionSnapshot = async () =>
  structuredClone(configuration.snapshot);
export const onExtensionsChanged = async () => () => {};
export const getCurrentWindowLabel = async () => "fixture";
export const isWindowMaximized = async () => false;
export const onWindowResized = async () => () => {};
export const cancelExtension = async () => {};
export const closeWindow = async () => {
  window.__extensionUiTest.commands.push("close-window");
};
export const openExtensionWindow = async () => {
  window.__extensionUiTest.commands.push("open-extension-window");
};
export const openExtensionCenter = async () => {
  window.__extensionUiTest.commands.push("open-extension-center");
};
export const extensionMarketSnapshot = async () => ({
  catalog: {
    schemaVersion: 2,
    revision: 1,
    issuedAt: 1,
    expiresAt: 9999999999,
    repository: "fixture/offline",
    entries: [],
  },
  stale: false,
  fetchedAt: Date.now(),
});
async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/fixture/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {
    code?: "EXTENSION_RUN_FAILED";
    message?: string;
  };
  if (!response.ok)
    throw new NativeBridgeError({
      code: result.code ?? "EXTENSION_RUN_FAILED",
      message: result.message ?? "Fixture operation failed",
      retryable: false,
    });
  return result as T;
}
export const viewExtension = (input: ExtensionViewInput) =>
  request<ExtensionView>("view", input);
export const openExtensionUi = (
  id: string,
  commandId: string,
  expectedSha256: string,
  expectedGeneration: number,
) =>
  request<{ url: string; token: string }>("open", {
    id,
    commandId,
    expectedSha256,
    expectedGeneration,
  });
export const closeExtensionUi = (token: string) =>
  request<void>("close", { token });
export async function saveTextExport(name: string, content: string) {
  window.__extensionUiTest.exports.push({ name, content });
  return window.__extensionUiTest.exportPath;
}
export async function saveExtensionArtifact(
  _id: string,
  _hash: string,
  _generation: number,
  artifact: ExtensionArtifact,
) {
  window.__extensionUiTest.artifacts.push(artifact);
  return window.__extensionUiTest.exportPath;
}
