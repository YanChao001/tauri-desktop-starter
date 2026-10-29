import type {
  ExtensionView,
  ExtensionPermission,
  ExtensionWindowRequest,
  ExtensionWindowState,
} from "./generated/protocol";
export type {
  ExtensionWindowRequest,
  ExtensionWindowState,
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
};
export type ExtensionResourcePreviewRequest = {
  action: "preview";
  resourceId: string;
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
export interface ExtensionUiServices {
  request(
    service: "resources",
    request: ExtensionResourceFetchRequest,
  ): Promise<ExtensionImageResource>;
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
    | null
  >;
  request(service: "links", request: { url: string }): Promise<null>;
  request(
    service: "window",
    request: ExtensionWindowRequest,
  ): Promise<ExtensionWindowState>;
  request(
    service: "lan" | "wallpaper",
    request: Record<string, unknown>,
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
