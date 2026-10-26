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
  it.each([
    ["MARKET_INCOMPATIBLE", "ext.market.incompatible"],
    ["MARKET_EXPIRED", "ext.market.expired"],
    ["MARKET_INVALID", "ext.market.invalid"],
  ] as const)(
    "presents %s without exposing catalog or package contents",
    (code, key) => {
      const error = { code, message: "unverified payload details" };
      expect(nativeErrorText(error, createTranslator(en))).toBe(en[key]);
      expect(nativeErrorText(error, createTranslator(zhCN))).toBe(zhCN[key]);
    },
  );
});
