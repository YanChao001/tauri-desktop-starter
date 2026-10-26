import { useEffect, useState } from "react";

/** 锁定立即生效；只有持续操作才展示进度，避免短 Wasm 调用闪烁。 */
export function useDelayedBusy(active: boolean, delay = 300) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);
  return active && visible;
}
