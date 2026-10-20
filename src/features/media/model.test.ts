// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mediaKind, safeMarkdownUrl, validWorkerInput } from "./model";

describe("media and process input boundaries", () => {
  it("allows explicit HTTPS/mail links and rejects executable URL schemes", () => {
    expect(safeMarkdownUrl("https://example.test/path")).toBe(
      "https://example.test/path",
    );
    expect(safeMarkdownUrl("#section")).toBe("#section");
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///etc/passwd",
      "//example.test/x",
      "http://example.test",
    ])
      expect(safeMarkdownUrl(value)).toBe("");
  });
  it("limits local media size/types without treating arbitrary files as media", () => {
    expect(mediaKind({ type: "video/mp4", size: 1024 })).toBe("video");
    expect(mediaKind({ type: "application/javascript", size: 100 })).toBeNull();
    expect(mediaKind({ type: "image/png", size: 21 * 1024 * 1024 })).toBeNull();
  });
  it("bounds worker input by UTF-8 bytes rather than JS string length", () => {
    expect(validWorkerInput("hello")).toBe(true);
    expect(validWorkerInput(" ")).toBe(false);
    expect(validWorkerInput("中".repeat(334))).toBe(false);
    expect(validWorkerInput("中".repeat(333))).toBe(true);
  });
});
