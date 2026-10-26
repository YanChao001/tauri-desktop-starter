import { StrictMode, useState } from "react";
import { createPortal } from "react-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ExtensionChromeProvider,
  ExtensionChromeSlot,
  useExtensionChromeTarget,
  useExtensionChromeRef,
} from "./extension-chrome-slot";

afterEach(cleanup);

function Tools({
  label = "Run session",
  run = () => {},
}: {
  label?: string;
  run?: () => void;
}) {
  const target = useExtensionChromeTarget();
  const [draft, setDraft] = useState("");
  return target
    ? createPortal(
        <>
          <button onClick={run}>{label}</button>
          <input
            aria-label="Tool draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </>,
        target.node,
      )
    : null;
}

it("keeps portal state and handlers across layout rerenders in StrictMode", () => {
  const run = vi.fn();
  function Layout() {
    const [revision, setRevision] = useState(0);
    return (
      <ExtensionChromeProvider scope="/extensions/app/a/open">
        <button onClick={() => setRevision(revision + 1)}>
          Update theme {revision}
        </button>
        <nav aria-label="Current extension">
          <ExtensionChromeSlot placement="navigation" />
        </nav>
        <main>
          <Tools run={run} />
        </main>
      </ExtensionChromeProvider>
    );
  }
  render(
    <StrictMode>
      <Layout />
    </StrictMode>,
  );
  const nav = screen.getByRole("navigation", { name: "Current extension" });
  const action = within(nav).getByRole("button", { name: "Run session" });
  fireEvent.change(screen.getByRole("textbox", { name: "Tool draft" }), {
    target: { value: "Retain tool draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update theme 0" }));
  expect(screen.getByRole("textbox", { name: "Tool draft" })).toHaveValue(
    "Retain tool draft",
  );
  expect(within(nav).getByRole("button", { name: "Run session" })).toBe(action);
  expect(
    within(screen.getByRole("main")).queryByRole("button"),
  ).not.toBeInTheDocument();
  fireEvent.click(action);
  expect(run).toHaveBeenCalledOnce();
});

it.each(["scope", "placement"] as const)(
  "ignores a late %s ref cleanup from the same slot instance",
  (change) => {
    let latestRef: ((node: HTMLDivElement | null) => void) | undefined;
    function Destination({
      placement,
    }: {
      placement: "navigation" | "titlebar";
    }) {
      const ref = useExtensionChromeRef(placement);
      latestRef = ref;
      return <div ref={ref} />;
    }
    function Layout() {
      const [moved, setMoved] = useState(false);
      return (
        <ExtensionChromeProvider
          scope={moved && change === "scope" ? "second" : "first"}
        >
          <button onClick={() => setMoved(true)}>Move</button>
          <Destination
            placement={
              moved && change === "placement" ? "titlebar" : "navigation"
            }
          />
          <Tools />
        </ExtensionChromeProvider>
      );
    }
    render(
      <StrictMode>
        <Layout />
      </StrictMode>,
    );
    const oldRef = latestRef!;
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(latestRef).not.toBe(oldRef);
    expect(screen.getByRole("button", { name: "Run session" })).toBeVisible();
    act(() => oldRef(null));
    expect(screen.getByRole("button", { name: "Run session" })).toBeVisible();
  },
);

it("does not let an old slot unmount unregister the newer destination", () => {
  function Layout() {
    const [oldVisible, setOldVisible] = useState(true);
    return (
      <ExtensionChromeProvider scope="/extension-window/a/open">
        <button onClick={() => setOldVisible(false)}>
          Remove old location
        </button>
        {oldVisible ? (
          <section aria-label="Old location">
            <ExtensionChromeSlot placement="navigation" />
          </section>
        ) : null}
        <section aria-label="New location">
          <ExtensionChromeSlot placement="titlebar" />
        </section>
        <Tools />
      </ExtensionChromeProvider>
    );
  }
  render(
    <StrictMode>
      <Layout />
    </StrictMode>,
  );
  const location = screen.getByRole("region", { name: "New location" });
  expect(
    within(location).getByRole("button", { name: "Run session" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove old location" }));
  expect(
    within(location).getByRole("button", { name: "Run session" }),
  ).toBeVisible();
});

it("removes the previous session actions when navigation changes and never leaves stale callbacks", () => {
  const first = vi.fn(),
    second = vi.fn();
  function Layout() {
    const [page, setPage] = useState("first");
    return (
      <ExtensionChromeProvider scope={page}>
        <button onClick={() => setPage(page === "first" ? "second" : "none")}>
          Navigate
        </button>
        <ExtensionChromeSlot placement="navigation" />
        {page !== "none" ? (
          <Tools
            key={page}
            label={page}
            run={page === "first" ? first : second}
          />
        ) : null}
      </ExtensionChromeProvider>
    );
  }
  render(
    <StrictMode>
      <Layout />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "first" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(
    screen.queryByRole("button", { name: "first" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "second" }));
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(
    screen.queryByRole("button", { name: "second" }),
  ).not.toBeInTheDocument();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});
