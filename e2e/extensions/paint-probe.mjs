import { expect } from "@playwright/test";

/** Serialized into document-start init; observes computed paint state without changing author DOM/styles. */
export function installPaintProbe() {
  const probe = {
    host: [],
    child: [],
    visible: [],
    completed: false,
    startedAt: performance.timeOrigin + performance.now(),
  };
  window.__extensionPaintProbe = probe;
  const top = window === window.top;
  let unsubscribe,
    snapshot,
    raf,
    revealedAt,
    stopped = false;
  let revealedFrames = 0;
  const history = [],
    notified = new WeakSet();
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
  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    unsubscribe?.();
    window.removeEventListener("message", message);
    window.removeEventListener("pagehide", stop);
  }
  function message(event) {
    if (top) {
      if (
        event.data?.type !== "fixture:paint-probe" ||
        event.origin !== "null" ||
        ![...document.querySelectorAll("iframe")].some(
          (node) => node.contentWindow === event.source,
        )
      )
        return;
      probe.child.push(...event.data.samples);
      // A later visible host frame must never retroactively make an earlier
      // hidden child frame visible. Use the last observation at or before it.
      probe.visible = probe.child.filter((child) => {
        const host = probe.host.findLast((sample) => sample.at <= child.at);
        return (
          host &&
          host.frames.some((frame) => frame.url === child.url && frame.visible)
        );
      });
      probe.completed = true;
      stop();
    } else if (
      event.source === parent &&
      event.data?.type === "fixture:paint-visible"
    ) {
      revealedAt ??= performance.timeOrigin + performance.now();
    }
  }
  window.addEventListener("message", message);
  window.addEventListener("pagehide", stop);
  function sample() {
    if (stopped) return;
    const at = performance.timeOrigin + performance.now();
    // Wait for up to 60s of initial work, then capture the reveal burst. Child
    // samples stay in a bounded local ring rather than posting every frame.
    if (
      (!revealedAt && at - probe.startedAt > 60000) ||
      (revealedAt && at - revealedAt > 5000)
    )
      return stop();
    const root = document.documentElement;
    if (root) {
      if (top) {
        const nodes = [...document.querySelectorAll("iframe")];
        const host = {
          at,
          frames: nodes.map((node) => ({
            url: node.src,
            ...visibility(node),
          })),
          skeletons: [
            ...document.querySelectorAll(
              '.app-main [data-slot="skeleton"],.app-main [data-extension-loading]',
            ),
          ].filter((node) => visibility(node).visible).length,
        };
        probe.host.push(host);
        for (const [index, node] of nodes.entries()) {
          if (host.frames[index].visible && !notified.has(node)) {
            revealedAt ??= at;
            notified.add(node);
            node.contentWindow?.postMessage(
              { type: "fixture:paint-visible" },
              "*",
            );
          }
        }
      } else {
        if (!unsubscribe && window.starter)
          unsubscribe = window.starter.onChange((value) => {
            snapshot = value;
          });
        const rootStyle = getComputedStyle(root),
          bodyStyle = document.body && getComputedStyle(document.body);
        history.push({
          at,
          url: location.href,
          root: rgba(rootStyle.backgroundColor),
          body: bodyStyle ? rgba(bodyStyle.backgroundColor) : [0, 0, 0, 0],
          dark: root.classList.contains("dark"),
          viewReady: snapshot?.view !== null && snapshot?.view !== undefined,
          hasContent: !!document.querySelector("main")?.textContent.trim(),
          colorScheme: rootStyle.colorScheme,
        });
        if (revealedAt) revealedFrames++;
        else if (history.length > 32) history.shift();
        if (revealedFrames >= 8) {
          parent.postMessage(
            { type: "fixture:paint-probe", samples: history },
            "*",
          );
          return stop();
        }
      }
    }
    raf = requestAnimationFrame(sample);
  }
  raf = requestAnimationFrame(sample);
}

export async function checkInitialPaint(page, expectedTheme) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          return window.__extensionPaintProbe.visible.length;
        }),
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(3);
  const evidence = await page.evaluate(() => {
    const probe = window.__extensionPaintProbe;
    return {
      host: probe.host,
      child: probe.child,
      visible: probe.visible,
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
      "Bounded document-start rAF history and eight reveal frames, correlated only with the preceding host visibility observation; fixture-only reveal notification, not native pixel capture",
    nativeWebViewPaint: false,
  };
}
