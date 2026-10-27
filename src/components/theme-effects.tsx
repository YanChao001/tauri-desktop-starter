import { useSynchronizedTheme } from "@/hooks/use-theme-switch";

/** Both app shells retain the same theme synchronization and reveal lifecycle. */
export function ThemeEffects() {
  useSynchronizedTheme();
  return null;
}
