/* Injected only into opaque extension frames. No native API or host DOM is exposed. */
(() => {
  "use strict";
  if (window === window.top) return;
  // WebRTC transports are outside connect-src. This UI surface has no RTC capability.
  // Lock their globals before author code; descendants also inherit opaque sandbox origins.
  for (const name of [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "RTCIceGatherer",
    "RTCIceTransport",
    "RTCDtlsTransport",
    "RTCSctpTransport",
    "RTCQuicTransport",
  ]) {
    let scope = window;
    while (scope) {
      const descriptor = Object.getOwnPropertyDescriptor(scope, name);
      if (descriptor && (descriptor.configurable || descriptor.writable))
        Object.defineProperty(scope, name, {
          value: undefined,
          writable: false,
          configurable: false,
        });
      scope = Object.getPrototypeOf(scope);
    }
    if (!Object.hasOwn(window, name))
      Object.defineProperty(window, name, {
        value: undefined,
        writable: false,
        configurable: false,
      });
    if (window[name] !== undefined) {
      parent.postMessage({ type: "starter:failed", version: 1 }, "*");
      return;
    }
  }
  // Only packaged UI documents receive the host bridge. Descendant realms are
  // hardened above, but cannot acquire their parent's session channel.
  if (
    location.protocol !== "extension-ui:" &&
    location.hostname !== "extension-ui.localhost"
  )
    return;
  const defaults = document.createElement("style");
  defaults.dataset.starterDefaults = "";
  defaults.textContent = `
@layer starter-defaults {
  :where(html) { box-sizing:border-box; font-family:var(--host-font-family,system-ui,sans-serif); font-size:var(--host-font-size,16px); line-height:1.5; color:var(--foreground,CanvasText); background:var(--background,Canvas); scrollbar-gutter:stable; }
  :where(*,*::before,*::after) { box-sizing:inherit; border-color:var(--border,currentColor); }
  :where(body) { margin:0; min-width:0; padding:1rem; font:inherit; color:inherit; background:var(--background,Canvas); }
  :where(button,input,select,textarea) { font:inherit; font-size:.875rem; line-height:1.25rem; color:inherit; }
  :where(button) { display:inline-flex; align-items:center; justify-content:center; gap:.375rem; min-height:2rem; padding:.25rem .625rem; border:1px solid transparent; border-radius:var(--radius,.625rem); background:var(--primary,ButtonFace); color:var(--primary-foreground,ButtonText); font-weight:500; cursor:pointer; transition:background-color 140ms,color 140ms,border-color 140ms; }
  :where(button):hover { background:color-mix(in oklab,var(--primary,ButtonFace) 90%,var(--foreground,CanvasText)); }
  :where(button[data-variant="outline"],button[data-variant="secondary"]) { border-color:var(--border); background:var(--background,Canvas); color:var(--foreground,CanvasText); }
  :where(button[data-variant="outline"],button[data-variant="secondary"]):hover { background:var(--muted,ButtonFace); }
  :where(input:not([type="checkbox"],[type="radio"],[type="range"],[type="button"],[type="submit"],[type="reset"]),select,textarea) { width:100%; max-width:100%; min-width:0; min-height:2rem; padding:.25rem .625rem; border:1px solid var(--input,var(--border)); border-radius:var(--radius,.625rem); background:var(--background,Canvas); }
  :where(textarea) { min-height:5rem; resize:vertical; }
  @media (max-width:767px) { :where(input:not([type="checkbox"],[type="radio"],[type="range"],[type="button"],[type="submit"],[type="reset"]),textarea) { font-size:1rem; } }
  :where(input[type="checkbox"],input[type="radio"],input[type="range"]) { accent-color:var(--primary,Highlight); }
  :where(input,textarea)::placeholder { color:var(--muted-foreground,GrayText); }
  :where(button,input,select,textarea,a,[tabindex]):focus-visible { outline:2px solid var(--ring,Highlight); outline-offset:2px; }
  :where(button,input,select,textarea):disabled,:where([aria-disabled="true"]) { opacity:.5; cursor:not-allowed; }
  :where([aria-invalid="true"]) { border-color:var(--destructive,Mark); }
  :where(label) { display:block; font-size:.875rem; font-weight:500; }
  :where(a) { color:var(--primary,LinkText); text-underline-offset:.2em; }
  :where(h1,h2,h3,p) { overflow-wrap:anywhere; }
  :where(h1) { font-size:1.5rem; line-height:2rem; }
  :where(h2) { font-size:1.125rem; line-height:1.75rem; }
  :where(pre,code) { font-family:ui-monospace,"Cascadia Code",Consolas,monospace; }
  :where(img,canvas,svg,video) { max-width:100%; }
  :where(table) { border-collapse:collapse; font-size:.875rem; }
  :where(th,td) { padding:.5rem .75rem; border-bottom:1px solid var(--border); text-align:start; }
  :where(th) { color:var(--muted-foreground,GrayText); font-weight:500; }
  @supports not selector(::-webkit-scrollbar) { :where(*) { scrollbar-width:thin; scrollbar-color:color-mix(in oklab,var(--foreground,CanvasText) 20%,transparent) transparent; } }
  ::-webkit-scrollbar { width:8px; height:8px; }
  ::-webkit-scrollbar-thumb { border:2px solid transparent; border-radius:999px; background-clip:padding-box; background-color:color-mix(in oklab,var(--foreground,CanvasText) 20%,transparent); }
  ::-webkit-scrollbar-thumb:hover { background-color:color-mix(in oklab,var(--foreground,CanvasText) 28%,transparent); }
  ::-webkit-scrollbar-track,::-webkit-scrollbar-corner { background:transparent; }
  ::-webkit-scrollbar-button { display:none; width:0; height:0; }
  ::view-transition-old(root),::view-transition-new(root) { animation:none; mix-blend-mode:normal; }
  ::view-transition-old(root) { z-index:1; }
  ::view-transition-new(root) { z-index:2; }
  :where(html[data-motion="reduced"]) *,:where(html[data-motion="reduced"]) *::before,:where(html[data-motion="reduced"]) *::after { animation-duration:1ms !important; animation-delay:0ms !important; animation-iteration-count:1 !important; transition-duration:1ms !important; }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:1ms !important; animation-delay:0ms !important; animation-iteration-count:1 !important; transition-duration:1ms !important; } }
  @media (forced-colors:active) { * { scrollbar-color:auto; } }
}`;
  function mountDefaults() {
    const root = document.head || document.documentElement;
    if (!root) return false;
    root.prepend(defaults);
    return true;
  }
  if (!mountDefaults()) {
    const observer = new MutationObserver(() => {
      if (mountDefaults()) {
        observer.disconnect();
        if (current) applySnapshot(current);
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
  let port, current;
  let sequence = 0;
  let reveal, fontSource;
  const pending = new Map(),
    listeners = new Set();
  function notify(listener) {
    try {
      listener(structuredClone(current));
    } catch {
      // An author's failed render must not break the channel or other subscribers.
      console.error("Extension UI subscriber failed");
    }
  }
  function applySnapshot(value) {
    current = value;
    const root = document.documentElement;
    if (root) {
      const theme = current.theme;
      root.style.colorScheme = theme.mode;
      root.classList.toggle("dark", theme.mode === "dark");
      root.classList.toggle("light", theme.mode !== "dark");
      root.dataset.motion = theme.motion || "full";
      for (const [name, token] of Object.entries(theme.tokens))
        root.style.setProperty(name, token);
      root.lang = current.locale;
      if (
        theme.font?.dataUrl &&
        theme.font.dataUrl !== fontSource &&
        typeof FontFace === "function"
      ) {
        fontSource = theme.font.dataUrl;
        try {
          const face = new FontFace(
            "Geist Variable",
            `url(${JSON.stringify(fontSource)})`,
            { weight: "100 900", style: "normal" },
          );
          document.fonts.add(face);
          void face.load().catch(() => {});
        } catch {
          // A platform font fallback must not interrupt state delivery or author rendering.
        }
      }
    }
    for (const listener of listeners) notify(listener);
  }
  function prepareReveal(value) {
    reveal?.cancel();
    if (
      !current ||
      current.theme.motion === "reduced" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      typeof document.startViewTransition !== "function" ||
      typeof document.documentElement?.animate !== "function"
    )
      return;
    let next, release, handle;
    let updating = false,
      applied = false,
      cancelled = false;
    const operation = {
      mode: current.theme.mode,
      finish(snapshot) {
        if (applied) applySnapshot(snapshot);
        else {
          next = snapshot;
          if (updating) commit();
        }
      },
      cancel() {
        cancelled = true;
        commit();
        handle?.skipTransition();
        if (reveal === operation) reveal = undefined;
      },
    };
    function commit() {
      clearTimeout(timer);
      if (next && !applied) {
        applied = true;
        applySnapshot(next);
      }
      release?.();
    }
    reveal = operation;
    try {
      handle = document.startViewTransition(
        () =>
          new Promise((resolve) => {
            release = resolve;
            updating = true;
            if (next || cancelled) commit();
          }),
      );
    } catch {
      reveal = undefined;
      return;
    }
    // A skipped host transition or detached surface must never leave the child update waiting.
    const timer = setTimeout(() => operation.cancel(), 750);
    void handle.ready
      .then(() => {
        if (reveal !== operation || !applied) return;
        const animation = document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${value.x}px ${value.y}px)`,
              `circle(${value.radius}px at ${value.x}px ${value.y}px)`,
            ],
          },
          {
            duration: value.duration,
            easing: value.easing,
            pseudoElement: "::view-transition-new(root)",
          },
        );
        if (animation)
          animation.currentTime = Math.max(
            0,
            performance.timeOrigin + performance.now() - value.startedAt,
          );
      })
      .catch(() => operation.cancel());
    void handle.finished
      .finally(() => {
        clearTimeout(timer);
        if (reveal === operation) reveal = undefined;
      })
      .catch(() => {});
  }
  const ready = new Promise((resolve) => {
    const connect = (event) => {
      if (
        event.source !== parent ||
        event.data?.type !== "starter:connect" ||
        event.data.version !== 1 ||
        event.ports.length !== 1 ||
        port
      )
        return;
      port = event.ports[0];
      window.removeEventListener("message", connect);
      port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "state") {
          resolve(structuredClone(message.value));
          if (reveal && message.value.theme.mode !== reveal.mode)
            reveal.finish(message.value);
          else applySnapshot(message.value);
        } else if (message?.type === "theme-transition") {
          prepareReveal(message.value);
        } else if (message?.type === "closed") {
          reveal?.cancel();
          for (const request of pending.values()) {
            request.reject(new Error("Extension surface closed"));
          }
          pending.clear();
          port.close();
          port = undefined;
        } else if (Number.isSafeInteger(message?.id)) {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.error)
            request.reject(
              Object.assign(new Error(message.error.message), {
                code: message.error.code,
                retryable: message.error.retryable === true,
              }),
            );
          else request.resolve(message.result);
        }
      };
      port.start();
    };
    window.addEventListener("message", connect);
  });
  async function request(method, params) {
    await ready;
    if (!port || pending.size >= 4 || sequence >= 2147483647)
      throw new Error("Extension bridge unavailable or busy");
    const id = ++sequence;
    const message = { version: 1, id, method, params };
    if (
      new TextEncoder().encode(JSON.stringify(message)).length >
      2 * 1024 * 1024
    )
      throw new Error("Extension message too large");
    return new Promise((resolve, reject) => {
      // The host owns operation deadlines; a user may keep a native dialog open indefinitely.
      pending.set(id, { resolve, reject });
      try {
        port.postMessage(message);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }
  Object.defineProperty(window, "starter", {
    value: Object.freeze({
      ready,
      onChange(listener) {
        listeners.add(listener);
        if (current) notify(listener);
        return () => listeners.delete(listener);
      },
      run(action, fields = {}) {
        return request("run", { action, fields });
      },
      setFields(fields) {
        return request("fields", { fields });
      },
      checkpoint(value, dirty) {
        return request("checkpoint", { value: JSON.stringify(value), dirty });
      },
      saveArtifact(index) {
        return request("artifact", { index });
      },
      services: Object.freeze({
        request(service, value) {
          return request("service", { service, request: value });
        },
      }),
    }),
  });
  parent.postMessage({ type: "starter:ready", version: 1 }, "*");
})();
