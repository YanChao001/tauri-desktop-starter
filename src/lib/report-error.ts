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
// UTF-8 may need four bytes per character. Respect the native wire limits exactly.
function bounded(text: string, bytes: number) {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= bytes) return text;
  let end = bytes;
  while ((encoded[end]! & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.subarray(0, end));
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
    message: bounded(redact(errorMessage(error)), 4000),
    stack: stack ? bounded(redact(stack), 8000) : undefined,
    componentStack: componentStack
      ? bounded(redact(componentStack), 8000)
      : undefined,
  }).catch(() => {});
}
