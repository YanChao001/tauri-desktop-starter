import { expect } from "@playwright/test";

/** Serialized into document-start init; observes computed paint state without changing author DOM/styles. */
export function installPaintProbe() {
  const probe = {
    host: [],
    child: [],
    startedAt: performance.timeOrigin + performance.now(),
  };
  window.__extensionPaintProbe = probe;
  const top = window === window.top;
  let frames = 0,
    unsubscribe,
    snapshot;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  function rgba(color) {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  }
  function visibility(node) {
    const rectangle = node.getBoundingClientRect();
    let opacity = 1,
      displayed = true;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      opacity *= Number(style.opacity);
      if (
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility)
      )
        displayed = false;
    }
    return {
      visible:
        displayed &&
        opacity > 0.01 &&
        rectangle.width > 0 &&
        rectangle.height > 0 &&
        rectangle.bottom > 0 &&
        rectangle.top < innerHeight &&
        rectangle.right > 0 &&
        rectangle.left < innerWidth,
      opacity,
      height: rectangle.height,
      top: rectangle.top,
    };
  }
  if (top)
    window.addEventListener("message", (event) => {
      if (event.data?.type === "fixture:paint-probe" && event.origin === "null")
        probe.child.push(event.data.value);
    });
  function sample() {
    const at = performance.timeOrigin + performance.now();
    if (++frames > (top ? 1200 : 240) || at - probe.startedAt > 20000) {
      unsubscribe?.();
      return;
    }
    const root = document.documentElement;
    if (root) {
      if (top) {
        probe.host.push({
          at,
          frames: [...document.querySelectorAll("iframe")].map((node) => ({
            url: node.src,
            ...visibility(node),
          })),
          skeletons: [
            ...document.querySelectorAll(
              '.app-main [data-slot="skeleton"],.app-main [data-extension-loading]',
            ),
          ].filter((node) => visibility(node).visible).length,
        });
      } else {
        if (!unsubscribe && window.starter)
          unsubscribe = window.starter.onChange((value) => {
            snapshot = value;
          });
        const rootStyle = getComputedStyle(root),
          bodyStyle = document.body && getComputedStyle(document.body);
        parent.postMessage(
          {
            type: "fixture:paint-probe",
            value: {
              at,
              url: location.href,
              root: rgba(rootStyle.backgroundColor),
              body: bodyStyle ? rgba(bodyStyle.backgroundColor) : [0, 0, 0, 0],
              dark: root.classList.contains("dark"),
              viewReady:
                snapshot?.view !== null && snapshot?.view !== undefined,
              hasContent: !!document.querySelector("main")?.textContent.trim(),
              colorScheme: rootStyle.colorScheme,
            },
          },
          "*",
        );
      }
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}

export async function checkInitialPaint(page, expectedTheme) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const probe = window.__extensionPaintProbe;
          return probe.child.filter((sample) =>
            probe.host.some(
              (host) =>
                Math.abs(host.at - sample.at) < 34 &&
                host.frames.some(
                  (frame) => frame.url === sample.url && frame.visible,
                ),
            ),
          ).length;
        }),
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(3);
  const evidence = await page.evaluate(() => {
    const probe = window.__extensionPaintProbe;
    const visible = probe.child.filter((sample) =>
      probe.host.some(
        (host) =>
          Math.abs(host.at - sample.at) < 34 &&
          host.frames.some(
            (frame) => frame.url === sample.url && frame.visible,
          ),
      ),
    );
    return {
      host: probe.host,
      child: probe.child,
      visible,
      skeletonObserved: probe.host.some((sample) => sample.skeletons > 0),
    };
  });
  expect(evidence.visible.length).toBeGreaterThanOrEqual(3);
  for (const sample of evidence.visible) {
    expect(sample.viewReady).toBe(true);
    expect(sample.hasContent).toBe(true);
    expect(sample.dark).toBe(expectedTheme === "dark");
    if (expectedTheme === "dark")
      for (const color of [sample.root, sample.body])
        if (color[3] > 250)
          expect(Math.max(...color.slice(0, 3))).toBeLessThan(100);
  }
  return {
    ...evidence,
    method:
      "Document-start rAF samples correlated with host iframe/ancestor opacity, display, visibility and viewport intersection",
    nativeWebViewPaint: false,
  };
}
