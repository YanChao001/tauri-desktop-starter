// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/i18n/translate";
import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";
import { errorMessage, nativeErrorText } from "./native-error";

describe("native error presentation", () => {
  it("uses stable codes and keeps useful Error and string messages", () => {
    const t = createTranslator(en);
    expect(
      nativeErrorText({ code: "CONFLICT", message: "internal detail" }, t),
    ).toBe(en["errors.CONFLICT"]);
    expect(nativeErrorText(new Error("offline"), t)).toBe(
      "Operation failed: offline",
    );
    expect(nativeErrorText("offline", t)).toBe("Operation failed: offline");
  });
  it("presents unknown objects without string coercion or exposing their contents", () => {
    const unknown = {
      secret: "private",
      toString() {
        throw new Error("unsafe coercion");
      },
    };
    expect(errorMessage(unknown)).toBe("Unknown error");
    expect(nativeErrorText(unknown, createTranslator(zhCN))).toBe(
      zhCN["errors.INTERNAL"],
    );
    expect(nativeErrorText(null, createTranslator(en))).toBe(
      en["errors.INTERNAL"],
    );
  });
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "未知错误码 %s 不会读取对象原型成员或使翻译崩溃",
    (code) => {
      const t = createTranslator(en);
      expect(nativeErrorText({ code, message: "offline" }, t)).toBe(
        "Operation failed: offline",
      );
      expect(nativeErrorText({ code }, t)).toBe(en["errors.INTERNAL"]);
    },
  );
  it("presents retry guidance for native HTTP timeouts in both languages", () => {
    const error = {
      code: "HTTP_TIMEOUT",
      message: "native details",
      retryable: true,
    };
    expect(nativeErrorText(error, createTranslator(en))).toBe(
      en["nativeError.httpTimeout"],
    );
    expect(nativeErrorText(error, createTranslator(zhCN))).toBe(
      zhCN["nativeError.httpTimeout"],
    );
  });
  it.each([
    ["NATIVE_BUSY", "nativeError.busy"],
    ["MARKET_INCOMPATIBLE", "ext.market.incompatible"],
    ["MARKET_EXPIRED", "ext.market.expired"],
    ["MARKET_INVALID", "ext.market.invalid"],
    ["EXTENSION_NETWORK_BLOCKED", "ext.error.networkBlocked"],
    ["EXTENSION_IMAGE_REDIRECT", "ext.error.imageRedirect"],
    ["EXTENSION_IMAGE_SOURCE_REJECTED", "ext.error.imageSourceRejected"],
    ["EXTENSION_IMAGE_INVALID", "ext.error.imageInvalid"],
    ["EXTENSION_IMAGE_TOO_LARGE", "ext.error.imageTooLarge"],
    ["EXTENSION_ATTACHMENT_TOO_LARGE", "ext.error.attachmentTooLarge"],
    ["EXTENSION_ATTACHMENT_CACHE_FULL", "ext.error.attachmentCacheFull"],
    ["EXTENSION_TRANSFER_INTERRUPTED", "ext.error.transferInterrupted"],
  ] as const)(
    "presents %s without exposing catalog or package contents",
    (code, key) => {
      const error = { code, message: "unverified payload details" };
      expect(nativeErrorText(error, createTranslator(en))).toBe(en[key]);
      expect(nativeErrorText(error, createTranslator(zhCN))).toBe(zhCN[key]);
    },
  );
});
