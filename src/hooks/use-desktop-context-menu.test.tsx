import { StrictMode, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDesktopContextMenu } from "./use-desktop-context-menu";

const native = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/tauri", () => ({ isTauri: () => native.enabled }));

function Harness({ children }: { children?: ReactNode }) {
  useDesktopContextMenu();
  return <>{children}</>;
}

function openContextMenu(target: Element | Document) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  fireEvent(target, event);
  return event;
}

describe("desktop document context menus", () => {
  beforeEach(() => {
    native.enabled = true;
  });

  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  it("suppresses the desktop browser menu throughout the document, including portals", () => {
    render(
      <Harness>
        <button>Action</button>
        {createPortal(
          <div data-testid="portal">Dialog content</div>,
          document.body,
        )}
      </Harness>,
    );
    for (const target of [
      document,
      document.body,
      screen.getByRole("button", { name: "Action" }),
      screen.getByTestId("portal"),
    ]) {
      expect(openContextMenu(target).defaultPrevented).toBe(true);
    }
  });

  it("leaves browser demo menus unchanged", () => {
    native.enabled = false;
    render(
      <Harness>
        <div data-testid="page">Preview</div>
      </Harness>,
    );
    expect(openContextMenu(screen.getByTestId("page")).defaultPrevented).toBe(
      false,
    );
    expect(openContextMenu(document.body).defaultPrevented).toBe(false);
  });

  it.each(["text", "search", "email", "url", "tel", "number", "password"])(
    "preserves native editing and password restrictions for %s inputs",
    (type) => {
      render(
        <Harness>
          <input aria-label="Editor" type={type} defaultValue="secret" />
        </Harness>,
      );
      expect(
        openContextMenu(screen.getByLabelText("Editor")).defaultPrevented,
      ).toBe(false);
    },
  );

  it("preserves native copy/select and undo behavior for readonly controls and textareas", () => {
    render(
      <Harness>
        <input aria-label="Readonly" readOnly defaultValue="Copy me" />
        <textarea aria-label="Editor" defaultValue="Draft" />
        <textarea aria-label="Readonly area" readOnly defaultValue="Copy me" />
      </Harness>,
    );
    for (const label of ["Readonly", "Editor", "Readonly area"]) {
      expect(
        openContextMenu(screen.getByLabelText(label)).defaultPrevented,
      ).toBe(false);
    }
  });

  it("suppresses menus on disabled and non-text controls", () => {
    render(
      <Harness>
        <input aria-label="Disabled" disabled defaultValue="Unavailable" />
        <textarea aria-label="Disabled area" disabled />
        <fieldset disabled>
          <input aria-label="Disabled by fieldset" />
        </fieldset>
        <input aria-label="Checkbox" type="checkbox" />
        <input aria-label="Slider" type="range" />
      </Harness>,
    );
    for (const label of [
      "Disabled",
      "Disabled area",
      "Disabled by fieldset",
      "Checkbox",
      "Slider",
    ]) {
      expect(
        openContextMenu(screen.getByLabelText(label)).defaultPrevented,
      ).toBe(true);
    }
  });

  it("respects inherited contenteditable and its explicit false boundary", () => {
    render(
      <Harness>
        <div contentEditable suppressContentEditableWarning>
          <span data-testid="editable">Editable text</span>
          <span contentEditable={false} data-testid="locked">
            Locked text
          </span>
        </div>
        <div contentEditable="plaintext-only" data-testid="plain" />
      </Harness>,
    );
    expect(
      openContextMenu(screen.getByTestId("editable")).defaultPrevented,
    ).toBe(false);
    expect(openContextMenu(screen.getByTestId("plain")).defaultPrevented).toBe(
      false,
    );
    expect(openContextMenu(screen.getByTestId("locked")).defaultPrevented).toBe(
      true,
    );
  });

  it("preserves a real text selection without allowing unrelated controls or collapsed ranges", () => {
    render(
      <Harness>
        <p data-testid="text">
          Selected <span>text</span>
        </p>
        <button>Unrelated action</button>
      </Harness>,
    );
    const text = screen.getByTestId("text");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.addRange(range);
    expect(openContextMenu(text).defaultPrevented).toBe(false);
    expect(openContextMenu(screen.getByText("text")).defaultPrevented).toBe(
      false,
    );
    expect(openContextMenu(screen.getByRole("button")).defaultPrevented).toBe(
      true,
    );
    selection?.collapseToStart();
    expect(openContextMenu(text).defaultPrevented).toBe(true);
  });

  it("lets existing business ContextMenu handle the event first", async () => {
    render(
      <Harness>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button>Asset</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Duplicate asset</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Harness>,
    );
    const event = openContextMenu(
      screen.getByRole("button", { name: "Asset" }),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole("menuitem", { name: "Duplicate asset" }),
    ).toBeVisible();
  });

  it("cleans up its document listener across StrictMode remounts and unmount", () => {
    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(openContextMenu(document.body).defaultPrevented).toBe(true);
    view.unmount();
    expect(openContextMenu(document.body).defaultPrevented).toBe(false);
  });
});
