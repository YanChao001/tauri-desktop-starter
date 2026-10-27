import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CodeBlock } from "./code-block";

const loading = vi.hoisted(() => {
  let reject!: (reason: unknown) => void;
  const pending = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  return { requested: vi.fn(), report: vi.fn(), pending, reject };
});
vi.mock("./typescript-code", async () => {
  loading.requested();
  return loading.pending;
});
vi.mock("@/lib/report-error", () => ({
  reportClientError: loading.report,
}));
afterEach(cleanup);

it("只为 TypeScript 加载高亮，等待或加载失败时始终保留最新原文", async () => {
  const source = '</code><img src=x onerror="run()">';
  const { container, rerender } = render(
    <CodeBlock code={'{"ready":true}'} language="json" />,
  );
  expect(container.querySelector('[data-token="boolean"]')).toHaveTextContent(
    "true",
  );
  rerender(<CodeBlock code="pub fn main() {}" language="rust" />);
  expect(container.querySelector('[data-token="keyword"]')).toHaveTextContent(
    "pub",
  );
  rerender(<CodeBlock code={source} language="text" />);
  expect(container.querySelector("pre")?.textContent).toBe(source);
  expect(loading.requested).not.toHaveBeenCalled();

  rerender(<CodeBlock code={source} language="typescript" />);
  const pre = container.querySelector("pre");
  expect(pre?.textContent).toBe(source);
  expect(pre).toHaveAttribute("tabindex", "0");
  expect(pre?.querySelector("code")).toHaveAttribute(
    "data-language",
    "typescript",
  );
  expect(container.querySelector("img, [data-token]")).toBeNull();
  await waitFor(() => expect(loading.requested).toHaveBeenCalledOnce());

  const updated = `export const markup = ${JSON.stringify(source)};`;
  rerender(<CodeBlock code={updated} language="typescript" />);
  expect(pre?.textContent).toBe(updated);
  const failure = new Error("highlight chunk unavailable");
  await act(async () => loading.reject(failure));
  await waitFor(() => expect(loading.report).toHaveBeenCalledOnce());
  expect(container.querySelector("pre")).toBe(pre);
  expect(pre?.textContent).toBe(updated);
  expect(container.querySelector("img, [data-token]")).toBeNull();
});
