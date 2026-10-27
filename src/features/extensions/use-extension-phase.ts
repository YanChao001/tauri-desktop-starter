import { useEffect, useState } from "react";
import {
  extensionRunStatus,
  getCurrentWindowLabel,
  isTauri,
  type ExtensionSnapshot,
} from "@/lib/tauri";

export function useExtensionPhase(
  runs: ExtensionSnapshot["runs"],
  extensionId: string,
  active = false,
) {
  const [owner, setOwner] = useState("");
  const [currentRuns, setCurrentRuns] = useState<
    ExtensionSnapshot["runs"] | null
  >(null);
  useEffect(() => {
    let stopped = false;
    void getCurrentWindowLabel()
      .then((label) => {
        if (!stopped) setOwner(label);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    setCurrentRuns(null);
    if (!active || !isTauri()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await extensionRunStatus();
        if (!stopped) setCurrentRuns(next);
      } catch {
        // 阶段提示失败不影响正在执行的命令及其最终回执。
      } finally {
        if (!stopped) timer = setTimeout(() => void refresh(), 750);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, extensionId]);
  return (active ? (currentRuns ?? runs) : runs).find(
    (run) => run.id === extensionId && run.owner === owner,
  )?.phase;
}
