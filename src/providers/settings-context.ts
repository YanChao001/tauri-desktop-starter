import { createContext } from "react";
import type { AppSettings } from "@/lib/settings-model";
import type { PersistenceStatus } from "@/lib/settings-sync";

export type SettingsContextValue = {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => Promise<void>;
  persistence: PersistenceStatus;
  persistenceError: string | null;
  retrySave: () => void;
};
export const SettingsContext = createContext<SettingsContextValue | null>(null);
