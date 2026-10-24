import type { Language } from "@/i18n/registry";
import type {
  DesktopStatus,
  DiagnosticsReport,
  ExtensionPermission,
  ExtensionArtifact,
  ExtensionCredentialSlot,
  ExtensionFileChoice,
  ExtensionStorageInfo,
  ExtensionArchivePreview,
  ExtensionArchiveResult,
  ExtensionPreview,
  ExtensionRunInput,
  ExtensionSnapshot,
  ExtensionView,
  ExtensionViewInput,
  MarketDownload,
  MarketSnapshot,
  MarketSource,
  NativeError as NativeFailure,
  Note,
  NoteInput,
  NoteUpdate,
  SettingsSnapshot,
  UpdateProgress,
  UpdateStatus,
  WindowGeometry,
  Wallpaper,
  WallpaperInput,
} from "./generated/bindings";

export type {
  ExtensionArchivePreview,
  ExtensionArchiveResult,
  ExtensionArchiveStatus,
  ExtensionArtifact,
  ExtensionCredentialSlot,
  ExtensionFileChoice,
  ExtensionStorageInfo,
  ExtensionRunStatus,
  ExtensionViewRequest,
  ExtensionHostContext,
  ExtensionEffect,
  ExtensionEffectResult,
  MarketSource,
  MarketCatalog,
  MarketEntry,
  MarketSnapshot,
  MarketDownload,
  ExtensionCommand,
  ExtensionResultFormat,
  ExtensionPermission,
  ExtensionPreview,
  ExtensionInfo,
  ExtensionSnapshot,
  ExtensionRunInput,
  ExtensionIcon,
  ExtensionView,
  ExtensionViewDataInput,
  ExtensionViewField,
  ExtensionViewBlock,
  DesktopStatus,
  DiagnosticsReport,
  FrontendError,
  Note,
  NoteInput,
  NoteUpdate,
  SettingsSnapshot,
  UpdateProgress,
  UpdateStatus,
  WindowGeometry,
  Wallpaper,
  WallpaperInput,
} from "./generated/bindings";

export function extensionSnapshot(): Promise<ExtensionSnapshot> {
  return callNative((commands) => commands.extensionSnapshot());
}
export function previewExtensionArchive(): Promise<ExtensionArchivePreview> {
  return callNative((commands) => commands.previewExtensionArchive());
}
export function archiveLegacyExtensions(
  expectedSha256: string,
): Promise<ExtensionArchiveResult> {
  return callNative((commands) =>
    commands.archiveLegacyExtensions(expectedSha256),
  );
}
export function extensionMarketSnapshot(
  refresh = false,
): Promise<MarketSnapshot> {
  return callNative((commands) => commands.extensionMarketSnapshot(refresh));
}
export function downloadMarketExtension(
  id: string,
  expectedPackageSha256: string,
): Promise<MarketDownload> {
  return callNative((commands) =>
    commands.downloadMarketExtension(id, expectedPackageSha256),
  );
}
export function previewExtension(content: string): Promise<ExtensionPreview> {
  return callNative((commands) => commands.previewExtension(content));
}
export function extensionDemo(id = "starter.text-tools"): Promise<string> {
  return callNative((commands) => commands.extensionDemo(id));
}
export function viewExtension(
  input: ExtensionViewInput,
): Promise<ExtensionView> {
  return callNative((commands) => commands.viewExtension(input));
}
export async function openExtensionWindow(
  id: string,
  commandId: string,
  expectedSha256: string,
  expectedGeneration: number,
): Promise<void> {
  await callNative((commands) =>
    commands.openExtensionWindow(
      id,
      commandId,
      expectedSha256,
      expectedGeneration,
    ),
  );
}
export function installExtension(
  content: string,
  expectedRevision: number,
  replaceExisting: boolean,
  expectedSha256: string,
): Promise<ExtensionSnapshot> {
  return callNative((commands) =>
    commands.installExtension(
      content,
      expectedRevision,
      replaceExisting,
      expectedSha256,
    ),
  );
}
export function setExtensionEnabled(
  id: string,
  enabled: boolean,
  grants: ExtensionPermission[],
  expectedRevision: number,
  trusted: boolean,
): Promise<ExtensionSnapshot> {
  return callNative((commands) =>
    commands.setExtensionEnabled(
      id,
      enabled,
      grants,
      expectedRevision,
      trusted,
    ),
  );
}
export function installMarketExtension(
  content: string,
  expectedRevision: number,
  replaceExisting: boolean,
  expectedSha256: string,
  source: MarketSource,
): Promise<ExtensionSnapshot> {
  return callNative((commands) =>
    commands.installMarketExtension(
      content,
      expectedRevision,
      replaceExisting,
      expectedSha256,
      source,
    ),
  );
}
export function rollbackExtension(
  id: string,
  expectedRevision: number,
): Promise<ExtensionSnapshot> {
  return callNative((commands) =>
    commands.rollbackExtension(id, expectedRevision),
  );
}
export function pickExtensionFiles(): Promise<ExtensionFileChoice[]> {
  return callNative((commands) => commands.pickExtensionFiles());
}
export function validateExtensionView(content: string): Promise<ExtensionView> {
  return callNative((commands) => commands.validateExtensionView(content));
}
export function saveExtensionArtifact(
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
  artifact: ExtensionArtifact,
): Promise<string | null> {
  return callNative((commands) =>
    commands.saveExtensionArtifact(
      id,
      expectedSha256,
      expectedGeneration,
      artifact,
    ),
  );
}
export function extensionStorageInfo(
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
): Promise<ExtensionStorageInfo> {
  return callNative((commands) =>
    commands.extensionStorageInfo(id, expectedSha256, expectedGeneration),
  );
}
export function clearExtensionStorage(
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
  expectedRevision: number,
): Promise<void> {
  return callNative((commands) =>
    commands.clearExtensionStorage(
      id,
      expectedSha256,
      expectedGeneration,
      expectedRevision,
    ),
  ).then(() => undefined);
}
export function extensionCredentialSlots(
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
): Promise<ExtensionCredentialSlot[]> {
  return callNative((commands) =>
    commands.extensionCredentialSlots(id, expectedSha256, expectedGeneration),
  );
}
export function setExtensionCredential(
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
  origin: string,
  alias: string,
  secret: string,
): Promise<void> {
  return callNative((commands) =>
    commands.setExtensionCredential(
      id,
      expectedSha256,
      expectedGeneration,
      origin,
      alias,
      secret,
    ),
  ).then(() => undefined);
}
export function deleteExtensionCredential(
  id: string,
  expectedSha256: string,
  expectedGeneration: number,
  origin: string,
  alias: string,
): Promise<void> {
  return callNative((commands) =>
    commands.deleteExtensionCredential(
      id,
      expectedSha256,
      expectedGeneration,
      origin,
      alias,
    ),
  ).then(() => undefined);
}
export function uninstallExtension(
  id: string,
  expectedRevision: number,
): Promise<ExtensionSnapshot> {
  return callNative((commands) =>
    commands.uninstallExtension(id, expectedRevision),
  );
}
export function runExtension(input: ExtensionRunInput): Promise<string> {
  return callNative((commands) => commands.runExtension(input));
}
export async function cancelExtension(
  id: string,
  expectedGeneration: number,
): Promise<void> {
  await callNative((commands) =>
    commands.cancelExtension(id, expectedGeneration),
  );
}
export function onExtensionsChanged(handler: () => void): Promise<() => void> {
  return onNativeEvent("app://extensions-changed", handler);
}

export function listWallpapers(
  legacy: WallpaperInput | null = null,
): Promise<Wallpaper[]> {
  return callNative((commands) => commands.listWallpapers(legacy));
}
export function addWallpaper(input: WallpaperInput): Promise<Wallpaper> {
  return callNative((commands) => commands.addWallpaper(input));
}
export function renameWallpaper(id: string, name: string): Promise<Wallpaper> {
  return callNative((commands) => commands.renameWallpaper(id, name));
}
export async function removeWallpaper(id: string): Promise<void> {
  await callNative((commands) => commands.removeWallpaper(id));
}
export function onWallpapersChanged(handler: () => void): Promise<() => void> {
  return onNativeEvent("app://wallpapers-changed", handler);
}

export class NativeBridgeError extends Error {
  readonly code: NativeFailure["code"];
  readonly retryable: boolean;

  constructor(failure: NativeFailure) {
    super(failure.message);
    this.name = "NativeBridgeError";
    this.code = failure.code;
    this.retryable = failure.retryable;
  }
}

type NativeCommands = (typeof import("./generated/bindings"))["commands"];

async function callNative<T>(
  call: (
    commands: NativeCommands,
  ) => Promise<
    { status: "ok"; data: T } | { status: "error"; error: NativeFailure }
  >,
): Promise<T> {
  if (!isTauri())
    throw new NativeBridgeError({
      code: "PLATFORM_UNAVAILABLE",
      message: "Start the desktop app with pnpm app:dev to use this feature.",
      retryable: false,
    });
  const { commands } = await import("./generated/bindings");
  const result = await call(commands);
  if (result.status === "error") throw new NativeBridgeError(result.error);
  return result.data;
}

/**
 * 系统能力的唯一出口。
 *
 * 手写应用代码只在此文件 import `@tauri-apps/*`；生成绑定是底层例外。
 * ESLint 同时检查静态与动态导入。
 * 页面、组件、hooks 只调用这里导出的函数，不直接碰 Tauri API。
 */

/** 判断当前是否运行在 Tauri 窗口里（而非普通浏览器预览）。 */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** 原生通过系统对话框保存；浏览器仅发起本地文件下载。取消保存不算成功。 */
export async function saveTextExport(
  name: string,
  content: string,
): Promise<string | null> {
  if (isTauri())
    return callNative((commands) => commands.saveTextExport(name, content));
  const url = URL.createObjectURL(
    new Blob([content], {
      type: name.endsWith(".json")
        ? "application/json;charset=utf-8"
        : "text/plain;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 下载导航异步消费 URL；延后释放，避免点击后立刻撤销导致空下载。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** 用系统默认浏览器打开外链；在浏览器预览时退化为新标签页。 */
export async function openExternal(url: string): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error("只允许打开 http(s) 外链");
  }
  if (!isTauri()) {
    // noopener 即使成功打开也会返回 null，不能用返回值判断弹窗是否被拦截
    window.open(target.href, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(target.href);
}

/** 通知 Rust 当前窗口首帧已完成，再显示并聚焦该窗口。 */
export async function revealWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    await callNative((commands) => commands.completeFrontendStartup());
  } catch (error) {
    // 这里不抛：窗口没能显示时 Rust 侧的 3 秒兜底仍会生效
    console.error("显示窗口失败", error);
  }
}

/** 最小化主窗口。 */
export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

/** 在最大化与还原之间切换，返回切换后的状态。 */
export async function toggleMaximizeWindow(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window_ = getCurrentWindow();
  await window_.toggleMaximize();
  return window_.isMaximized();
}

/** 关闭主窗口。 */
export async function closeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

/** 读取主窗口是否最大化。 */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isMaximized();
}

export async function isWindowFullscreen(): Promise<boolean> {
  if (!isTauri()) return !!document.fullscreenElement;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isFullscreen();
}

/** 浏览器采用真实 Fullscreen API；拒绝或不支持时由调用方显示错误。 */
export async function setWindowFullscreen(fullscreen: boolean): Promise<void> {
  if (!isTauri()) {
    if (fullscreen) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFullscreen(fullscreen);
}

/** 订阅窗口尺寸变化，返回取消订阅函数。 */
export async function onWindowResized(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onResized(handler);
}

/** 订阅窗口移动，用于刷新当前显示器的尺寸约束。 */
export async function onWindowMoved(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onMoved(handler);
}

/** 读取当前窗口的正常尺寸和当前显示器允许的逻辑像素范围。 */
export function getWindowGeometry(): Promise<WindowGeometry> {
  return callNative((commands) => commands.getWindowGeometry());
}

/** 应用并持久化当前窗口尺寸，最大化或全屏时先还原。 */
export function setWindowSize(
  width: number,
  height: number,
): Promise<WindowGeometry> {
  return callNative((commands) => commands.setWindowSize(width, height));
}

/** 恢复所有窗口的配置默认尺寸，可同时将窗口移至各自显示器中央。 */
export function resetWindowGeometry(center = false): Promise<WindowGeometry> {
  return callNative((commands) => commands.resetWindowGeometry(center));
}

/**
 * 调用 Rust 侧的 greet 命令。
 *
 * 空名称由 Rust 侧返回 Err，前端拿到的就是一个 reject——
 * 这是模板刻意示范的错误链路：校验放在边界，错误由调用方展示。
 */
export async function invokeGreet(
  name: string,
  language: Language = "zh",
): Promise<string> {
  if (!isTauri()) {
    throw new Error(
      language === "en"
        ? "Unavailable in browser preview. Start the desktop app with pnpm app:dev."
        : "浏览器预览模式下无法调用，请用 pnpm app:dev 启动",
    );
  }
  return callNative((commands) => commands.greet(name, language));
}

export type AppInfo = {
  /** 应用版本，来源是 tauri.conf.json */
  version: string;
  /** Tauri 运行时版本 */
  tauriVersion: string;
};

/** 读取应用与运行时版本，浏览器预览下不可用。 */
export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    throw new Error("浏览器预览模式下无法读取运行时信息");
  }
  const app = await import("@tauri-apps/api/app");
  const [version, tauriVersion] = await Promise.all([
    app.getVersion(),
    app.getTauriVersion(),
  ]);
  return { version, tauriVersion };
}

export function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  return callNative((commands) => commands.loadSettingsSnapshot());
}

export function saveSettingsSnapshot(
  settings: object,
  expectedRevision: number,
): Promise<SettingsSnapshot> {
  const document = JSON.parse(JSON.stringify(settings));
  return callNative((commands) =>
    commands.saveSettingsSnapshot(document, expectedRevision),
  );
}

async function onNativeEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const [{ listen }, { getCurrentWindow }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  // 默认 Any 会接收发给其他窗口的事件；广播仍会匹配此窗口目标。
  return listen<T>(event, ({ payload }) => handler(payload), {
    target: { kind: "WebviewWindow", label: getCurrentWindow().label },
  });
}

export function onSettingsChanged(
  handler: (snapshot: SettingsSnapshot) => void,
): Promise<() => void> {
  return onNativeEvent("app://settings-changed", handler);
}

export function onNotesChanged(handler: () => void): Promise<() => void> {
  return onNativeEvent("app://notes-changed", handler);
}

export function onUpdateProgress(
  handler: (progress: UpdateProgress) => void,
): Promise<() => void> {
  return onNativeEvent("app://update-progress", handler);
}

export function listNotes(search = ""): Promise<Note[]> {
  return callNative((commands) => commands.listNotes(search));
}

export function createNote(input: NoteInput): Promise<Note> {
  return callNative((commands) => commands.createNote(input));
}

export function updateNote(input: NoteUpdate): Promise<Note> {
  return callNative((commands) => commands.updateNote(input));
}

export async function deleteNote(id: number): Promise<void> {
  await callNative((commands) => commands.deleteNote(id));
}

export async function openSecondaryWindow(): Promise<void> {
  await callNative((commands) => commands.openSecondaryWindow());
}

export function getDesktopStatus(): Promise<DesktopStatus> {
  return callNative((commands) => commands.getDesktopStatus());
}

export function getAutostartEnabled(): Promise<boolean> {
  return callNative((commands) => commands.getAutostartEnabled());
}

export function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  return callNative((commands) => commands.setAutostartEnabled(enabled));
}

export async function recordFrontendError(error: {
  message: string;
  stack?: string;
  componentStack?: string;
}): Promise<void> {
  if (!isTauri()) return;
  await callNative((commands) =>
    commands.recordFrontendError({
      message: Array.from(error.message).slice(0, 1000).join(""),
      stack: error.stack
        ? Array.from(error.stack).slice(0, 2000).join("")
        : null,
      componentStack: error.componentStack
        ? Array.from(error.componentStack).slice(0, 2000).join("")
        : null,
    }),
  );
}

export function getDiagnosticsReport(): Promise<DiagnosticsReport> {
  return callNative((commands) => commands.getDiagnosticsReport());
}

export function checkForUpdate(): Promise<UpdateStatus> {
  return callNative((commands) => commands.checkForUpdate());
}

export function getUpdateSnapshot(): Promise<UpdateProgress | null> {
  return callNative((commands) => commands.getUpdateSnapshot());
}

export async function downloadAndInstallUpdate(): Promise<void> {
  await callNative((commands) => commands.downloadAndInstallUpdate());
}

export async function relaunchApp(): Promise<void> {
  await callNative((commands) => commands.relaunchApp());
}

export async function quitApp(): Promise<void> {
  await callNative((commands) => commands.quitApp());
}

export async function getCurrentWindowLabel(): Promise<string> {
  if (!isTauri()) return "browser";
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

export type {
  LifecycleAction,
  LifecycleRequest,
  Activation,
  Workspace,
  DemoWorkerOutput,
  NoteQuery,
  NotePage,
  NoteVersion,
  NoteDraft,
  BackupInfo,
  BackupPreview,
  RestoreResult,
  WorkbenchDocument,
  WorkbenchDirectory,
  WorkbenchTask,
  WorkbenchTaskKind,
  WorkbenchTaskStatus,
  WorkbenchTaskSnapshot,
  WorkbenchDrop,
  RecentWorkbenchFile,
} from "./generated/bindings";

export async function setWindowWorkState(names: string[]): Promise<void> {
  await callNative((c) => c.setWindowWorkState(names));
}
export async function respondLifecycle(
  id: number,
  approved: boolean,
): Promise<void> {
  await callNative((c) => c.respondLifecycle(id, approved));
}
export function onLifecycleRequest(
  handler: (request: import("./generated/bindings").LifecycleRequest) => void,
): Promise<() => void> {
  return onNativeEvent("app://lifecycle-request", handler);
}
export function onLifecycleFinished(
  handler: (id: number) => void,
): Promise<() => void> {
  return onNativeEvent("app://lifecycle-finished", handler);
}
export function onLifecycleExecuting(
  handler: (id: number) => void,
): Promise<() => void> {
  return onNativeEvent("app://lifecycle-executing", handler);
}
export function queryNotes(
  query: import("./generated/bindings").NoteQuery,
): Promise<import("./generated/bindings").NotePage> {
  return callNative((c) => c.queryNotes(query));
}
export function getNote(id: number): Promise<Note> {
  return callNative((c) => c.getNote(id));
}
export async function changeNotes(
  items: import("./generated/bindings").NoteVersion[],
  action: "trash" | "restore" | "purge",
): Promise<void> {
  await callNative((c) => c.changeNotes(items, action));
}
export function loadNoteDraft(): Promise<
  import("./generated/bindings").NoteDraft | null
> {
  return callNative((c) => c.loadNoteDraft());
}
export async function saveNoteDraft(
  draft: import("./generated/bindings").NoteDraft | null,
): Promise<void> {
  await callNative((c) => c.saveNoteDraft(draft));
}
export function createDataBackup(): Promise<
  import("./generated/bindings").BackupInfo
> {
  return callNative((c) => c.createDataBackup());
}
export function listDataBackups(): Promise<
  import("./generated/bindings").BackupInfo[]
> {
  return callNative((c) => c.listDataBackups());
}
export function previewDataBackup(
  id: string,
): Promise<import("./generated/bindings").BackupPreview> {
  return callNative((c) => c.previewDataBackup(id));
}
export function restoreDataBackup(
  id: string,
): Promise<import("./generated/bindings").RestoreResult> {
  return callNative((c) => c.restoreDataBackup(id));
}
export function exportDataBackup(id: string): Promise<string> {
  return callNative((c) => c.exportDataBackup(id));
}
export function importDataBackup(
  contents: string,
): Promise<import("./generated/bindings").BackupPreview> {
  return callNative((c) => c.importDataBackup(contents));
}
export function pickDataBackup(): Promise<
  import("./generated/bindings").BackupPreview | null
> {
  return callNative((c) => c.pickDataBackup());
}
export function saveDataBackup(id: string): Promise<boolean> {
  return callNative((c) => c.saveDataBackup(id));
}

export function pickWorkbenchFiles(): Promise<
  import("./generated/bindings").WorkbenchDocument[]
> {
  return callNative((c) => c.pickWorkbenchFiles());
}
export function pickWorkbenchDirectory(): Promise<
  import("./generated/bindings").WorkbenchDirectory | null
> {
  return callNative((c) => c.pickWorkbenchDirectory());
}
export function loadWorkbenchDocument(
  id: string,
): Promise<import("./generated/bindings").WorkbenchDocument> {
  return callNative((c) => c.loadWorkbenchDocument(id));
}
export function saveWorkbenchDocument(
  id: string,
  content: string,
  expectedRevision: string,
): Promise<import("./generated/bindings").WorkbenchDocument> {
  return callNative((c) =>
    c.saveWorkbenchDocument(id, content, expectedRevision),
  );
}
export function saveWorkbenchAs(
  name: string,
  content: string,
): Promise<import("./generated/bindings").WorkbenchDocument | null> {
  return callNative((c) => c.saveWorkbenchAs(name, content));
}
export function recentWorkbenchFiles(): Promise<
  import("./generated/bindings").RecentWorkbenchFile[]
> {
  return callNative((c) => c.recentWorkbenchFiles());
}
export async function revealWorkbenchFile(id: string): Promise<void> {
  await callNative((c) => c.revealWorkbenchFile(id));
}
export function startWorkbenchTask(
  kind: import("./generated/bindings").WorkbenchTaskKind,
  directoryId: string,
): Promise<import("./generated/bindings").WorkbenchTask> {
  return callNative((c) => c.startWorkbenchTask(kind, directoryId));
}
export function getWorkbenchTaskSnapshot(): Promise<
  import("./generated/bindings").WorkbenchTaskSnapshot
> {
  return callNative((c) => c.workbenchTaskSnapshot());
}
export async function cancelWorkbenchTask(taskId: string): Promise<void> {
  await callNative((c) => c.cancelWorkbenchTask(taskId));
}
export function retryWorkbenchTask(
  taskId: string,
): Promise<import("./generated/bindings").WorkbenchTask> {
  return callNative((c) => c.retryWorkbenchTask(taskId));
}
export function exportWorkbenchTask(taskId: string): Promise<string | null> {
  return callNative((c) => c.exportWorkbenchTask(taskId));
}
export function onWorkbenchDrop(
  handler: (drop: import("./generated/bindings").WorkbenchDrop) => void,
): Promise<() => void> {
  return onNativeEvent("app://workbench-drop", handler);
}
export function onWorkbenchTasksChanged(
  handler: (
    snapshot: import("./generated/bindings").WorkbenchTaskSnapshot,
  ) => void,
): Promise<() => void> {
  return onNativeEvent("app://workbench-tasks", handler);
}

export function getActivationSnapshot(): Promise<
  import("./generated/bindings").Activation[]
> {
  return callNative((c) => c.activationSnapshot());
}
export function onActivation(
  handler: (value: import("./generated/bindings").Activation) => void,
): Promise<() => void> {
  return onNativeEvent("app://activation", handler);
}
export function onWorkspaceRoute(
  handler: (route: string) => void,
): Promise<() => void> {
  return onNativeEvent("app://workspace-route", handler);
}
export function getWorkspace(): Promise<
  import("./generated/bindings").Workspace
> {
  return callNative((c) => c.getWorkspace());
}
export async function saveWorkspaceRoute(route: string): Promise<void> {
  await callNative((c) => c.saveWorkspaceRoute(route));
}
export async function restoreWorkspace(): Promise<void> {
  await callNative((c) => c.restoreWorkspace());
}
export async function openNotesWindow(): Promise<void> {
  await callNative((c) => c.openNotesWindow());
}
export async function setDemoCredential(value: string): Promise<void> {
  await callNative((c) => c.setDemoCredential(value));
}
export function getDemoCredential(): Promise<string | null> {
  return callNative((c) => c.getDemoCredential());
}
export async function deleteDemoCredential(): Promise<void> {
  await callNative((c) => c.deleteDemoCredential());
}
export function runDemoSidecar(
  input: string,
): Promise<import("./generated/bindings").DemoWorkerOutput> {
  return callNative((c) => c.runDemoSidecar(input));
}

function requireDesktop(): void {
  if (!isTauri())
    throw new NativeBridgeError({
      code: "PLATFORM_UNAVAILABLE",
      message: "This action requires the desktop application.",
      retryable: false,
    });
}

export type { RecoveryStatus } from "./generated/bindings";
export function recoveryStatus(): Promise<
  import("./generated/bindings").RecoveryStatus
> {
  return callNative((c) => c.recoveryStatus());
}
export function listRecoveryBackups(): Promise<
  import("./generated/bindings").BackupInfo[]
> {
  return callNative((c) => c.listRecoveryBackups());
}
export function pickRecoveryBackup(): Promise<
  import("./generated/bindings").BackupPreview | null
> {
  return callNative((c) => c.pickRecoveryBackup());
}
export function previewRecoveryBackup(
  id: string,
): Promise<import("./generated/bindings").BackupPreview> {
  return callNative((c) => c.previewRecoveryBackup(id));
}
export function restoreRecoveryBackup(
  id: string,
): Promise<import("./generated/bindings").RecoveryStatus> {
  return callNative((c) => c.restoreRecoveryBackup(id));
}
export function stageRecovery(
  resetSettings: boolean,
): Promise<import("./generated/bindings").RecoveryStatus> {
  return callNative((c) => c.stageRecovery(resetSettings));
}
export async function writeSystemClipboard(text: string): Promise<void> {
  requireDesktop();
  const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
  await clipboard.writeText(text);
}
export async function readSystemClipboard(): Promise<string> {
  requireDesktop();
  const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
  return clipboard.readText();
}
export async function sendSystemNotification(
  title: string,
  body: string,
  requestPermission = true,
): Promise<boolean> {
  requireDesktop();
  const notification = await import("@tauri-apps/plugin-notification");
  let granted = await notification.isPermissionGranted();
  if (!granted && requestPermission)
    granted = (await notification.requestPermission()) === "granted";
  if (granted) notification.sendNotification({ title, body });
  return granted;
}
export async function onSystemNotification(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const notification = await import("@tauri-apps/plugin-notification");
  const listener = await notification.onAction(handler);
  return () => {
    void listener.unregister();
  };
}
export async function registerGlobalShortcut(
  shortcut: string,
): Promise<() => Promise<void>> {
  requireDesktop();
  if (
    ![
      "CommandOrControl+Shift+Space",
      "CommandOrControl+Shift+Y",
      "Alt+Shift+Y",
    ].includes(shortcut)
  )
    throw new Error("Unsupported demo shortcut");
  const plugin = await import("@tauri-apps/plugin-global-shortcut");
  if (await plugin.isRegistered(shortcut))
    throw new Error("Shortcut is already registered");
  await plugin.register(shortcut, (event) => {
    if (event.state === "Pressed")
      void callNative((c) => c.activateMain()).catch(console.error);
  });
  return () => plugin.unregister(shortcut);
}

export type HttpDemoRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};
export type HttpDemoResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
export async function nativeHttpRequest(
  input: HttpDemoRequest,
  signal?: AbortSignal,
): Promise<HttpDemoResponse> {
  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    !["httpbin.org", "jsonplaceholder.typicode.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Choose one of the allowed HTTPS demo endpoints");
  if (
    !["GET", "POST"].includes(input.method) ||
    (input.body?.length ?? 0) > 65536
  )
    throw new Error("Unsupported request method or body size");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    Math.min(30000, Math.max(100, input.timeoutMs ?? 10000)),
  );
  try {
    const fetcher = isTauri()
      ? (await import("@tauri-apps/plugin-http")).fetch
      : window.fetch.bind(window);
    const response = await fetcher(url.href, {
      method: input.method,
      headers: input.headers,
      body: input.method === "POST" ? input.body : undefined,
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            controller.abort();
            throw new Error("Response exceeds 2 MiB");
          }
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** WSS 使用标准 WebSocket，并由 CSP 限制端点；浏览器与桌面共享同一行为。 */
export async function websocketConnect(
  url: string,
  onMessage: (text: string) => void,
  onClose?: () => void,
): Promise<{
  send: (text: string) => Promise<void>;
  close: () => Promise<void>;
}> {
  const target = new URL(url);
  if (
    target.protocol !== "wss:" ||
    target.hostname !== "echo.websocket.events" ||
    target.port ||
    target.username ||
    target.password
  )
    throw new Error("Choose the allowed WSS demo endpoint");
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.href);
    let opened = false;
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket connection timed out"));
    }, 10000);
    socket.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.length <= 65536)
        onMessage(event.data);
      else socket.close(1009, "Demo message limit");
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error("WebSocket connection failed. Retry or use the local demo."),
      );
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (!opened)
        reject(
          new Error("WebSocket closed before the connection was established"),
        );
      onClose?.();
    };
    socket.onopen = () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        send: async (text) => {
          if (socket.readyState !== WebSocket.OPEN || text.length > 65536)
            throw new Error("Socket closed or message exceeds the demo limit");
          socket.send(text);
        },
        close: async () => {
          socket.close(1000);
        },
      });
    };
  });
}
