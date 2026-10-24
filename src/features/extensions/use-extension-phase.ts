import { useEffect, useState } from "react";
import { getCurrentWindowLabel, type ExtensionSnapshot } from "@/lib/tauri";

export function useExtensionPhase(
  runs: ExtensionSnapshot["runs"],
  extensionId: string,
) {
  const [owner, setOwner] = useState("");
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
  return runs.find((run) => run.id === extensionId && run.owner === owner)
    ?.phase;
}
