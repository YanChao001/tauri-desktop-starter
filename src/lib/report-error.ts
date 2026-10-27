import { isTauri, recordFrontendError } from "./tauri";
import { errorMessage } from "./native-error";
let intervalStarted = 0;
let count = 0;
function redact(text: string) {
  return text
    .replace(/https?:\/\/[^\s)]+/g, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .replace(
      /(authorization[\s"'=:]+(?:bearer\s+)?|bearer\s+|(?:token|password|secret|api[_-]?key)[\s"'=:]+)[^\s&"']+/gi,
      "$1[redacted]",
    )
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\n)]+/g, "[local path]")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "/[home]");
}
/** 限流且不递归上报日志自身的错误。 */
export function reportClientError(
  error: unknown,
  componentStack?: string,
): void {
  if (!isTauri()) return;
  const now = Date.now();
  if (now - intervalStarted > 60_000) {
    intervalStarted = now;
    count = 0;
  }
  if (count++ >= 20) return;
  const stack = error instanceof Error ? error.stack : undefined;
  void recordFrontendError({
    message: redact(errorMessage(error)),
    stack: stack ? redact(stack) : undefined,
    componentStack: componentStack ? redact(componentStack) : undefined,
  }).catch(() => {});
}
