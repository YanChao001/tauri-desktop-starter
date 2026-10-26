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
      serviceCalls: {
        service: string;
        request: Record<string, unknown>;
        boundaryMock: true;
        completed: boolean;
        response?: unknown;
      }[];
      serviceTiming: { lanStatusMs: number; lanNicknameMs: number };
      lifecycle: { event: string; at: number; detail?: unknown }[];
      viewDelayMs: number;
      sessionViewValidationBoundaryMockCalls: number;
    };
  }
}
window.__extensionUiTest = {
  commands: [],
  exports: [],
  exportPath: null,
  artifacts: [],
  work: null,
  serviceCalls: [],
  serviceTiming: { lanStatusMs: 0, lanNicknameMs: 0 },
  lifecycle: [],
  viewDelayMs: 0,
  sessionViewValidationBoundaryMockCalls: 0,
};
const configuration = (await fetch("/fixture/config").then((response) =>
  response.json(),
)) as { snapshot: ExtensionSnapshot };
const fixtureSession = crypto.randomUUID();
const snapshotDelayUntil =
  performance.now() +
  Math.max(
    0,
    Math.min(
      1000,
      Number(new URLSearchParams(location.search).get("snapshotDelayMs") || 0),
    ),
  );
export const isTauri = () => true;
export const extensionSnapshot = async () => {
  const latency = snapshotDelayUntil - performance.now();
  if (latency > 0)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(latency, 1000)),
    );
  return structuredClone(configuration.snapshot);
};
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
    body: JSON.stringify({ ...(body as object), fixtureSession }),
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
  request<ExtensionView>("view", {
    ...input,
    boundaryViewDelayMs: window.__extensionUiTest.viewDelayMs,
  });
// This UI-only import test reuses an unchanged export from real Wasm. It does not test Rust parsing.
export const validateExtensionView = async (
  content: string,
): Promise<ExtensionView> => {
  window.__extensionUiTest.sessionViewValidationBoundaryMockCalls++;
  window.__extensionUiTest.lifecycle.push({
    event: "validate-view",
    at: performance.now(),
  });
  return JSON.parse(content) as ExtensionView;
};
export const openExtensionUi = (
  id: string,
  commandId: string,
  expectedSha256: string,
  expectedGeneration: number,
) => {
  window.__extensionUiTest.lifecycle.push({
    event: "open-lease",
    at: performance.now(),
  });
  return request<{ url: string; token: string }>("open", {
    id,
    commandId,
    expectedSha256,
    expectedGeneration,
  });
};
export const closeExtensionUi = (token: string) => {
  window.__extensionUiTest.lifecycle.push({
    event: "close-lease",
    at: performance.now(),
  });
  return request<void>("close", { token });
};
/** Explicit browser boundary substitute; native LAN/gallery services have separate tests. */
export const requestExtensionService = (
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
  service: "lan" | "wallpaper",
  serviceRequest: Record<string, unknown>,
) => {
  const call = {
    service,
    request: serviceRequest,
    boundaryMock: true as const,
    completed: false,
    response: undefined as unknown,
  };
  window.__extensionUiTest.serviceCalls.push(call);
  return request<unknown>("service", {
    id,
    expectedSha256,
    expectedGeneration,
    service,
    request: serviceRequest,
    boundaryMock: true,
    boundaryTiming: window.__extensionUiTest.serviceTiming,
  }).then(
    (result) => {
      call.completed = true;
      call.response = result;
      return result;
    },
    (error) => {
      call.completed = true;
      throw error;
    },
  );
};
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
