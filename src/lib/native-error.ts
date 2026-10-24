import type { Translate } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/zh-CN";
import { isRecord } from "./settings-model";
const ERROR_KEYS: Record<string, MessageKey> = {
  MARKET_NOT_CONFIGURED: "ext.market.notConfigured",
  MARKET_UNAVAILABLE: "ext.market.unavailable",
  MARKET_INVALID: "ext.market.invalid",
  MARKET_CHANGED: "ext.market.changed",
  EXTENSION_INCOMPATIBLE: "ext.error.incompatible",
  EXTENSION_RUN_FAILED: "ext.error.failed",
  EXTENSION_TIMEOUT: "ext.error.timeout",
  EXTENSION_BUSY: "ext.error.busy",
  EXTENSION_UNAVAILABLE: "ext.error.unavailable",
  INVALID_ARGUMENT: "errors.VALIDATION",
  USER_CANCELLED: "nativeError.userCancelled",
  CREDENTIAL_ERROR: "nativeError.credentialError",
  WORKBENCH_BUSY: "workbench.busy",
  NAME_REQUIRED: "errors.VALIDATION",
  INPUT_TOO_LONG: "errors.INPUT_TOO_LONG",
  STORAGE_IO: "errors.IO",
  STORAGE_CORRUPT: "errors.IO",
  DATABASE_ERROR: "errors.DATABASE",
  PLATFORM_UNAVAILABLE: "errors.UNSUPPORTED",
  AUTOSTART_ERROR: "errors.AUTOSTART_ERROR",
  UPDATE_BUSY: "errors.UPDATE_BUSY",
  UPDATE_CHECK_FAILED: "errors.UPDATE",
  UPDATE_CHECK_TIMEOUT: "updates.checkTimeout",
  UPDATE_FEED_UNAVAILABLE: "updates.feedUnavailable",
  UPDATE_PLATFORM_UNAVAILABLE: "updates.platformUnavailable",
  UPDATE_DOWNLOAD_FAILED: "errors.UPDATE",
  UPDATE_INSTALL_FAILED: "errors.UPDATE",
  WINDOW_ERROR: "errors.WINDOW_ERROR",
  VALIDATION: "errors.VALIDATION",
  CONFLICT: "errors.CONFLICT",
  SETTINGS_CONFLICT: "errors.SETTINGS_CONFLICT",
  NOT_FOUND: "errors.NOT_FOUND",
  DATABASE: "errors.DATABASE",
  IO: "errors.IO",
  UPDATE_NOT_CONFIGURED: "errors.UPDATE_NOT_CONFIGURED",
  UPDATE: "errors.UPDATE",
  UNSUPPORTED: "errors.UNSUPPORTED",
  INTERNAL: "errors.INTERNAL",
};
export function errorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string")
    return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}
export function nativeErrorText(error: unknown, t: Translate): string {
  const key =
    isRecord(error) && typeof error.code === "string"
      ? ERROR_KEYS[error.code]
      : undefined;
  if (key) return t(key);
  if (
    typeof error === "string" ||
    (isRecord(error) && typeof error.message === "string")
  )
    return t("common.operationFailed", { error: errorMessage(error) });
  return t("errors.INTERNAL");
}
