import type {
  ExtensionView,
  ExtensionPermission,
  ExtensionWindowRequest,
  ExtensionWindowState,
  ExtensionResourcePreviewSize,
  ExtensionWallpaperApplyResult,
  ExtensionWallpaperPreviewResult,
} from "./generated/protocol";
export type {
  ExtensionWindowRequest,
  ExtensionWindowState,
  ExtensionResourcePreviewSize,
  ExtensionWallpaperApplyResult,
  ExtensionWallpaperPreviewResult,
} from "./generated/protocol";

export interface ExtensionUiSnapshot {
  view: ExtensionView | null;
  fields: Record<string, string>;
  checkpoint: unknown;
  busy: boolean;
  dirty: boolean;
  /** Whether this surface is visible and interactive; omitted by older hosts. */
  active?: boolean;
  locale: "zh-CN" | "en";
  grantedPermissions: ExtensionPermission[];
  theme: {
    mode: "light" | "dark";
    motion: "full" | "reduced";
    tokens: Record<string, string>;
    /** Full host-owned default stylesheet, shared with future controls and registered ShadowRoots. */
    styles: string;
    font?: { family: string; dataUrl: string };
  };
}
export type ExtensionResourceFetchRequest = {
  action: "fetch-image";
  url: string;
  networkMode?: "direct" | "system";
  preview?: ExtensionResourcePreviewSize;
  /** Optional cancellation key: 1-80 ASCII letters, digits, "_" or "-". */
  requestId?: string;
};
export type ExtensionResourceCancelFetchRequest = {
  action: "cancel-fetch";
  /** Cancellation key previously supplied to fetch-image. */
  requestId: string;
};
export type ExtensionResourcePreviewRequest = {
  action: "preview";
  resourceId: string;
  size?: ExtensionResourcePreviewSize;
};
export type ExtensionResourceSaveRequest = {
  action: "save";
  resourceId: string;
  name?: string;
};
export type ExtensionResourceReleaseRequest = {
  action: "release";
  resourceId: string;
};
export type ExtensionResourceRequest =
  | ExtensionResourceFetchRequest
  | ExtensionResourceCancelFetchRequest
  | ExtensionResourcePreviewRequest
  | ExtensionResourceSaveRequest
  | ExtensionResourceReleaseRequest;
export interface ExtensionImageResource {
  resourceId: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}
export interface ExtensionResourcePreview {
  dataUrl: string;
}
export type ExtensionResourceSaveResult =
  { cancelled: true } | { cancelled: false; name: string };
export type ExtensionResourceCancelFetchResult = {
  /** Whether a matching in-flight request was marked for cooperative cancellation. */
  cancelled: boolean;
};
export type ExtensionWallpaperApplyRequest = {
  action: "apply";
  id: string;
  expectedRevision: number;
  fit: "cover" | "contain";
};
export type ExtensionWallpaperPreviewRequest = {
  action: "preview";
  id: string;
  previewKey: string;
};
export interface ExtensionUiServices {
  request(
    service: "resources",
    request: ExtensionResourceFetchRequest & {
      preview: ExtensionResourcePreviewSize;
    },
  ): Promise<ExtensionImageResource & ExtensionResourcePreview>;
  request(
    service: "resources",
    request: ExtensionResourceFetchRequest,
  ): Promise<ExtensionImageResource>;
  request(
    service: "resources",
    request: ExtensionResourceCancelFetchRequest,
  ): Promise<ExtensionResourceCancelFetchResult>;
  request(
    service: "resources",
    request: ExtensionResourcePreviewRequest,
  ): Promise<ExtensionResourcePreview>;
  request(
    service: "resources",
    request: ExtensionResourceSaveRequest,
  ): Promise<ExtensionResourceSaveResult>;
  request(
    service: "resources",
    request: ExtensionResourceReleaseRequest,
  ): Promise<null>;
  request(
    service: "resources",
    request: ExtensionResourceRequest,
  ): Promise<
    | ExtensionImageResource
    | ExtensionResourcePreview
    | ExtensionResourceSaveResult
    | ExtensionResourceCancelFetchResult
    | null
  >;
  request(service: "links", request: { url: string }): Promise<null>;
  request(
    service: "window",
    request: ExtensionWindowRequest,
  ): Promise<ExtensionWindowState>;
  request(
    service: "wallpaper",
    request: ExtensionWallpaperApplyRequest,
  ): Promise<ExtensionWallpaperApplyResult>;
  request(
    service: "wallpaper",
    request: ExtensionWallpaperPreviewRequest,
  ): Promise<ExtensionWallpaperPreviewResult>;
  /** Exclude typed wallpaper actions so malformed requests cannot use this compatibility fallback. */
  request<
    const Service extends "lan" | "wallpaper",
    const Request extends Record<string, unknown>,
  >(
    service: Service,
    request: Request &
      ("wallpaper" extends Service
        ? Extract<Request["action"], "apply" | "preview"> extends never
          ? unknown
          : never
        : unknown),
  ): Promise<unknown>;
}
export interface ExtensionUiApi {
  readonly ready: Promise<ExtensionUiSnapshot>;
  onChange(listener: (snapshot: ExtensionUiSnapshot) => void): () => void;
  applyStyles(root: ShadowRoot): () => void;
  run(action: string, fields?: Record<string, string>): Promise<ExtensionView>;
  setFields(fields: Record<string, string>): Promise<void>;
  checkpoint(value: unknown, dirty: boolean): Promise<void>;
  saveArtifact(index: number): Promise<boolean>;
  notify(
    message: string,
    options?: { tone?: "info" | "success" | "error" },
  ): Promise<void>;
  readonly services: ExtensionUiServices;
}
declare global {
  interface Window {
    readonly starter: ExtensionUiApi;
  }
}
