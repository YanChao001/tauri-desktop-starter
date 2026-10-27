import { useState, type ComponentProps } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { I18nContext } from "@/providers/i18n-context";
import { createTranslator } from "@/i18n/translate";
import { zhCN } from "@/i18n/zh-CN";

afterEach(cleanup);

function Example({
  trigger = false,
  modal = true,
  onCloseAutoFocus,
}: {
  trigger?: boolean;
  modal?: boolean;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}) {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const opener = <button onClick={() => setOpen(true)}>Open editor</button>;
  return (
    <main tabIndex={0} aria-label="Workspace">
      <button id="other-target">Other action</button>
      <Dialog open={open} onOpenChange={setOpen} modal={modal}>
        {showOpener &&
          (trigger ? <DialogTrigger asChild>{opener}</DialogTrigger> : opener)}
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>Change the selected item.</DialogDescription>
          <input aria-label="Item name" />
          <button
            onClick={() => {
              setShowOpener(false);
              setOpen(false);
            }}
          >
            Delete item
          </button>
        </DialogContent>
      </Dialog>
    </main>
  );
}

describe("dialog focus recovery", () => {
  it.each([false, true])(
    "returns to the opener on repeated controlled opens (DialogTrigger: %s)",
    async (trigger) => {
      const user = userEvent.setup();
      render(<Example trigger={trigger} />);
      const opener = screen.getByRole("button", { name: "Open editor" });
      for (let index = 0; index < 2; index += 1) {
        await user.click(opener);
        expect(
          screen.getByRole("textbox", { name: "Item name" }),
        ).toHaveFocus();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(opener).toHaveFocus());
      }
    },
  );

  it("returns to the workspace when the triggering item was removed", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("button", { name: "Delete item" }));
    await waitFor(() =>
      expect(screen.getByRole("main", { name: "Workspace" })).toHaveFocus(),
    );
  });

  it("preserves an explicit close-focus destination", async () => {
    const user = userEvent.setup();
    render(
      <Example
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("other-target")?.focus();
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Other action" }),
      ).toHaveFocus(),
    );
  });

  it("keeps the outside click destination for a nonmodal dialog", async () => {
    const user = userEvent.setup();
    render(<Example modal={false} />);
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    await user.click(screen.getByRole("button", { name: "Other action" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Other action" })).toHaveFocus();
  });

  it("returns to the controlled nonmodal opener when Escape closes it", async () => {
    const user = userEvent.setup();
    render(<Example modal={false} />);
    const opener = screen.getByRole("button", { name: "Open editor" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps the outer opener when nested dialogs close together", async () => {
    function Nested() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return (
        <main tabIndex={0}>
          <button onClick={() => setOuter(true)}>Outer opener</button>
          <Dialog open={outer} onOpenChange={setOuter}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Outer dialog</DialogTitle>
              <button onClick={() => setInner(true)}>Inner opener</button>
              <Dialog open={inner} onOpenChange={setInner}>
                <DialogContent aria-describedby={undefined}>
                  <DialogTitle>Inner dialog</DialogTitle>
                  <button
                    onClick={() => {
                      setInner(false);
                      setOuter(false);
                    }}
                  >
                    Close both
                  </button>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        </main>
      );
    }
    const user = userEvent.setup();
    render(<Nested />);
    const opener = screen.getByRole("button", { name: "Outer opener" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Inner opener" }));
    await user.click(screen.getByRole("button", { name: "Close both" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("uses the active application language for the default close button", async () => {
    const user = userEvent.setup();
    render(
      <I18nContext.Provider
        value={{ language: "zh", t: createTranslator(zhCN) }}
      >
        <Example />
      </I18nContext.Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Open editor" }));
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
});
