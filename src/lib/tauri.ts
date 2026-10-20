import type { Language } from "@/i18n/registry";
import type {
  DesktopStatus,
  DiagnosticsReport,
  NativeError as NativeFailure,
  Note,
  NoteInput,
  NoteUpdate,
  SettingsSnapshot,
  UpdateProgress,
  UpdateStatus,
  WindowGeometry,
} from "./generated/bindings";

export type {
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
} from "./generated/bindings";

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
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, ({ payload }) => handler(payload));
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
