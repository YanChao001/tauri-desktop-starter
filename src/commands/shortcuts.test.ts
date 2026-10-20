import { describe, expect, it } from "vitest";
import { formatShortcut, matchesShortcut } from "./shortcuts";

describe("application shortcuts", () => {
  it("uses the platform primary modifier and rejects unrelated modifiers", () => {
    const shortcut = { key: "k", primary: true };
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "K", ctrlKey: true }),
        shortcut,
        false,
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
        shortcut,
        true,
      ),
    ).toBe(true);
    for (const extra of [
      { shiftKey: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      expect(
        matchesShortcut(
          new KeyboardEvent("keydown", { key: "k", ctrlKey: true, ...extra }),
          shortcut,
          false,
        ),
      ).toBe(false);
    }
    expect(formatShortcut(shortcut, false)).toBe("Ctrl+K");
    expect(formatShortcut(shortcut, true)).toBe("⌘K");
  });

  it("leaves handled, repeated and IME events alone", () => {
    const shortcut = { key: "b", primary: true };
    for (const extra of [
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      expect(
        matchesShortcut(
          new KeyboardEvent("keydown", { key: "b", ctrlKey: true, ...extra }),
          shortcut,
          false,
        ),
      ).toBe(false);
    }
    const handled = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      cancelable: true,
    });
    handled.preventDefault();
    expect(matchesShortcut(handled, shortcut, false)).toBe(false);
  });

  it("protects editable controls unless an action explicitly permits them", () => {
    for (const tag of ["input", "textarea", "select", "div"]) {
      const element = document.createElement(tag);
      if (tag === "div") element.contentEditable = "true";
      if (tag === "div") element.setAttribute("contenteditable", "true");
      const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
      element.dispatchEvent(event);
      expect(matchesShortcut(event, { key: "k", primary: true }, false)).toBe(
        false,
      );
      expect(
        matchesShortcut(
          event,
          { key: "k", primary: true, allowInEditable: true },
          false,
        ),
      ).toBe(true);
    }
  });
});
