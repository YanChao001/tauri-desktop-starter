import { renameSync } from "node:fs";

const RETRY_DELAYS = [100, 200, 400, 600];
const TRANSIENT_ERRORS = new Set(["EACCES", "EPERM", "EBUSY"]);

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Windows 扫描器可能短暂阻止目录改名；有限重试同一个原子操作，每次重新校验路径。 */
export function renameWithRetry(
  source,
  destination,
  {
    validate,
    platform = process.platform,
    rename = renameSync,
    delay = wait,
  } = {},
) {
  if (typeof validate !== "function")
    throw new Error("目录重命名必须提供路径校验");
  for (let attempt = 0; ; attempt += 1) {
    validate(source, destination);
    try {
      return rename(source, destination);
    } catch (error) {
      if (
        platform !== "win32" ||
        !TRANSIENT_ERRORS.has(error.code) ||
        attempt === RETRY_DELAYS.length
      )
        throw error;
      delay(RETRY_DELAYS[attempt]);
    }
  }
}
