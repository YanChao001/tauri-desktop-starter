import { createContext } from "react";
import type { ExtensionSnapshot } from "@/lib/tauri";
import type { ExtensionSessionCache } from "./extension-session-cache";
type ExtensionsContextValue = {
  data: ExtensionSnapshot | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
  sessionCache: ExtensionSessionCache;
};
export const ExtensionsContext = createContext<ExtensionsContextValue | null>(
  null,
);
