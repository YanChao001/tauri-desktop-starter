import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as native from "@/lib/tauri";
import { ExtensionRecovery } from "./extension-recovery";

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof native>()),
  previewExtensionArchive: vi.fn(),
  archiveLegacyExtensions: vi.fn(),
}));
vi.mock("@/providers/i18n", async () => {
  const { createTranslator } = await import("@/i18n/translate");
  const { en } = await import("@/i18n/en");
  return { useI18n: () => ({ t: createTranslator(en), language: "en" }) };
});

type Preview = Awaited<ReturnType<typeof native.previewExtensionArchive>>;
const legacy: Preview = {
  status: "legacy",
  schemaVersion: 2,
  fingerprint: "a".repeat(64),
  installedCount: 3,
};
const incompatible = { code: "EXTENSION_INCOMPATIBLE", message: "old" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

async function confirmArchive() {
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Archive old extensions and rebuild",
    }),
  );
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Confirm archive and rebuild",
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(native.previewExtensionArchive).mockResolvedValue(legacy);
  vi.mocked(native.archiveLegacyExtensions).mockResolvedValue({
    archivePath: "C:/app-data/extensions.archive-20261025",
  });
});
afterEach(cleanup);

it("does not inspect or mutate archives for unrelated errors", () => {
  const reload = vi.fn().mockResolvedValue(undefined);
  const view = render(<ExtensionRecovery error={null} reload={reload} />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(
    <ExtensionRecovery
      error={{ code: "EXTENSION_RUN_FAILED" }}
      reload={reload}
    />,
  );
  expect(view.container).toBeEmptyDOMElement();
  expect(native.previewExtensionArchive).not.toHaveBeenCalled();
  expect(native.archiveLegacyExtensions).not.toHaveBeenCalled();
});

it.each([
  ["current", "The archive already uses a supported version."],
  ["future", "This archive was created by a newer version."],
  ["invalid", "This archive could not be recognized safely."],
  ["unavailable", "Extension archives cannot be changed during startup"],
] as const)(
  "explains %s archives without offering a mutation",
  async (status, text) => {
    vi.mocked(native.previewExtensionArchive).mockResolvedValue({
      ...legacy,
      status,
      fingerprint: null,
    });
    render(
      <ExtensionRecovery
        error={{ code: "STORAGE_CORRUPT" }}
        reload={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(
      await screen.findByText((content) => content.startsWith(text)),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Archive old extensions and rebuild",
      }),
    ).not.toBeInTheDocument();
    expect(native.archiveLegacyExtensions).not.toHaveBeenCalled();
  },
);

it("requires explicit confirmation, restores cancellation focus, and retains the archive receipt after reload clears the error", async () => {
  const loading = deferred<void>();
  const reload = vi.fn().mockReturnValue(loading.promise);
  const view = render(
    <ExtensionRecovery error={incompatible} reload={reload} />,
  );
  const trigger = await screen.findByRole("button", {
    name: "Archive old extensions and rebuild",
  });
  expect(native.archiveLegacyExtensions).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveAccessibleDescription(
    expect.stringContaining(
      "App settings, notes, and plugin private data are retained",
    ),
  );
  expect(native.archiveLegacyExtensions).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  await confirmArchive();
  await waitFor(() =>
    expect(native.archiveLegacyExtensions).toHaveBeenCalledExactlyOnceWith(
      legacy.fingerprint,
    ),
  );
  expect(
    await screen.findByText("C:/app-data/extensions.archive-20261025"),
  ).toBeVisible();
  expect(reload).toHaveBeenCalledOnce();
  view.rerender(<ExtensionRecovery error={null} reload={reload} />);
  expect(
    screen.getByText("The old extension directory was archived."),
  ).toBeVisible();
  await act(async () => loading.resolve());
  expect(
    screen.getByText("C:/app-data/extensions.archive-20261025"),
  ).toBeVisible();
});

it("retains a successful archive receipt when initialization rejects", async () => {
  const reload = vi.fn().mockRejectedValue(new Error("Initialization failed"));
  render(<ExtensionRecovery error={incompatible} reload={reload} />);
  await confirmArchive();
  expect(
    await screen.findByText("The old extension directory was archived."),
  ).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Initialization failed",
  );
  expect(
    screen.getByText("C:/app-data/extensions.archive-20261025"),
  ).toBeVisible();
});

it("invalidates a rejected fingerprint and requires another inspection before retrying", async () => {
  const next = { ...legacy, fingerprint: "b".repeat(64) };
  vi.mocked(native.previewExtensionArchive)
    .mockResolvedValueOnce(legacy)
    .mockResolvedValueOnce(next);
  vi.mocked(native.archiveLegacyExtensions).mockRejectedValueOnce({
    code: "CONFLICT",
    message: "Archive changed",
  });
  render(
    <ExtensionRecovery
      error={incompatible}
      reload={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await confirmArchive();
  await screen.findByRole("alert");
  expect(native.previewExtensionArchive).toHaveBeenCalledOnce();
  expect(native.archiveLegacyExtensions).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", {
      name: "Archive old extensions and rebuild",
    }),
  ).not.toBeInTheDocument();
  const check = screen.getByRole("button", { name: "Check archive again" });
  await waitFor(() => expect(check).toHaveFocus());
  fireEvent.click(check);
  await confirmArchive();
  await waitFor(() =>
    expect(native.archiveLegacyExtensions).toHaveBeenNthCalledWith(
      2,
      next.fingerprint,
    ),
  );
});

it("ignores a late preview from the StrictMode cleanup lifetime", async () => {
  const old = deferred<Preview>();
  const current = deferred<Preview>();
  vi.mocked(native.previewExtensionArchive)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  render(
    <StrictMode>
      <ExtensionRecovery
        error={incompatible}
        reload={vi.fn().mockResolvedValue(undefined)}
      />
    </StrictMode>,
  );
  await waitFor(() =>
    expect(native.previewExtensionArchive).toHaveBeenCalledTimes(2),
  );
  await act(async () => old.resolve(legacy));
  expect(
    screen.queryByRole("button", {
      name: "Archive old extensions and rebuild",
    }),
  ).not.toBeInTheDocument();
  await act(async () =>
    current.resolve({ ...legacy, status: "future", fingerprint: null }),
  );
  expect(
    screen.getByText((content) =>
      content.startsWith("This archive was created by a newer version."),
    ),
  ).toBeVisible();
  expect(native.archiveLegacyExtensions).not.toHaveBeenCalled();
});

it("does not reload or write into a new screen after an archive completes following unmount", async () => {
  const archived =
    deferred<Awaited<ReturnType<typeof native.archiveLegacyExtensions>>>();
  vi.mocked(native.archiveLegacyExtensions).mockReturnValue(archived.promise);
  const reload = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ExtensionRecovery error={incompatible} reload={reload} />,
  );
  await confirmArchive();
  expect(native.archiveLegacyExtensions).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => archived.resolve({ archivePath: "C:/archive" }));
  expect(reload).not.toHaveBeenCalled();
});
