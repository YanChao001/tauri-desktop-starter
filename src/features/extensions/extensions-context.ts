import { createContext } from "react";
import type { ExtensionSnapshot } from "@/lib/tauri";
import type {
  ExtensionSession,
  ExtensionSessionCache,
} from "./extension-session-cache";
type ExtensionsContextValue = {
  data: ExtensionSnapshot | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
  sessions: Map<string, ExtensionSession>;
  sessionCache: ExtensionSessionCache;
};
export const ExtensionsContext = createContext<ExtensionsContextValue | null>(
  null,
);
