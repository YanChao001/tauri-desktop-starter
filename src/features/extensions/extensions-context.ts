import { createContext } from "react";
import type { ExtensionSnapshot, ExtensionView } from "@/lib/tauri";

export type ExtensionSession = {
  identity: string;
  /** Last environment locale handled by this session; importing a snapshot does not execute it. */
  locale?: string;
  uiState?: string | null;
  view: ExtensionView | null;
  fields: Record<string, string>;
  dirty: boolean;
  pending: Promise<void> | null;
  exporting: Promise<void> | null;
  selecting: Promise<void> | null;
  error: unknown;
  draft: {
    inputText: string;
    url: string;
    files: { id: string; name: string }[];
  };
};
type ExtensionsContextValue = {
  data: ExtensionSnapshot | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
  sessions: Map<string, ExtensionSession>;
};
export const ExtensionsContext = createContext<ExtensionsContextValue | null>(
  null,
);
