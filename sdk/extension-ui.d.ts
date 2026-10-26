import type {
  ExtensionView,
  ExtensionPermission,
} from "../src/lib/generated/bindings";

export interface ExtensionUiSnapshot {
  view: ExtensionView | null;
  fields: Record<string, string>;
  checkpoint: unknown;
  busy: boolean;
  dirty: boolean;
  locale: "zh-CN" | "en";
  grantedPermissions: ExtensionPermission[];
  theme: {
    mode: "light" | "dark";
    motion: "full" | "reduced";
    tokens: Record<string, string>;
    font?: { family: string; dataUrl: string };
  };
}
export interface ExtensionUiApi {
  readonly ready: Promise<ExtensionUiSnapshot>;
  onChange(listener: (snapshot: ExtensionUiSnapshot) => void): () => void;
  run(action: string, fields?: Record<string, string>): Promise<ExtensionView>;
  setFields(fields: Record<string, string>): Promise<void>;
  checkpoint(value: unknown, dirty: boolean): Promise<void>;
  saveArtifact(index: number): Promise<boolean>;
  readonly services: {
    request(
      service: "lan" | "wallpaper",
      request: Record<string, unknown>,
    ): Promise<unknown>;
  };
}
declare global {
  interface Window {
    readonly starter: ExtensionUiApi;
  }
}
