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
  :where(*,*::before,*::after) { box-sizing:border-box; border-color:var(--border,currentColor); }
  :where(html) { box-sizing:border-box; font-family:var(--host-font-family,system-ui,sans-serif); font-size:var(--host-font-size,16px); line-height:1.5; color:var(--foreground,CanvasText); background:var(--background,Canvas); scrollbar-gutter:stable; }
  :where(body) { margin:0; min-width:0; padding:1rem; font:inherit; color:inherit; background:var(--background,Canvas); }
  :where(button,input,select,textarea) { font:inherit; font-size:.875rem; line-height:1.25rem; color:inherit; }
  :where(button) { display:inline-flex; align-items:center; justify-content:center; gap:.375rem; min-height:2rem; flex-shrink:0; white-space:nowrap; padding:.25rem .625rem; border:1px solid transparent; border-radius:var(--radius,.625rem); background:var(--primary,ButtonFace); color:var(--primary-foreground,ButtonText); font-weight:500; cursor:pointer; transition:background-color 140ms,color 140ms,border-color 140ms; }
  :where(button):hover { background:color-mix(in oklab,var(--primary,ButtonFace) 90%,var(--foreground,CanvasText)); }
  :where(button[data-variant="outline"],button[data-variant="secondary"]) { border-color:var(--border); background:var(--background,Canvas); color:var(--foreground,CanvasText); }
  :where(button[data-variant="outline"],button[data-variant="secondary"]):hover { background:var(--muted,ButtonFace); }
  :where(input:not([type="checkbox"],[type="radio"],[type="range"],[type="button"],[type="submit"],[type="reset"]),select,textarea) { width:100%; max-width:100%; min-width:0; min-height:2rem; padding:.25rem .625rem; border:1px solid var(--input,var(--border)); border-radius:var(--radius,.625rem); background:var(--background,Canvas); }
  :where(textarea) { min-height:5rem; resize:vertical; }
  :where([data-starter-listbox]) { position:fixed; inset:auto; margin:0; z-index:2147483647; overflow:auto; padding:.25rem; border:1px solid var(--border); border-radius:var(--radius,.625rem); background:var(--popover,var(--background,Canvas)); color:var(--popover-foreground,var(--foreground,CanvasText)); font:inherit; font-size:.875rem; line-height:1.25rem; box-shadow:0 4px 12px #0002; overscroll-behavior:contain; }
  :where([data-starter-option]) { display:flex; align-items:center; min-height:2rem; padding:.375rem .5rem; border-radius:calc(var(--radius,.625rem) * .6); cursor:default; white-space:nowrap; }
  :where([data-starter-option][data-active]) { background:var(--accent,Highlight); color:var(--accent-foreground,HighlightText); }
  :where([data-starter-option][aria-disabled="true"]) { opacity:.5; }
  :where([data-starter-option][aria-selected="true"])::after { content:"✓"; margin-inline-start:auto; padding-inline-start:1rem; }
  :where([data-starter-option-group]) { padding:.375rem .5rem; font-size:.75rem; color:var(--muted-foreground,GrayText); font-weight:500; }
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
  let port, current, closedError;
  let sequence = 0;
  let reveal, fontSource;
  let paintScheduled = false,
    painted = false;
  function schedulePainted() {
    if (painted || paintScheduled || !current?.view) return;
    paintScheduled = true;
    const render = () => {
      // Keep the frame measurable while hidden. Two rendering opportunities let
      // author subscribers (including React) paint the first real view and theme.
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          paintScheduled = false;
          if (painted || !current?.view || !port) return;
          painted = true;
          parent.postMessage({ type: "starter:painted", version: 1 }, "*");
        }),
      );
    };
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", render, { once: true });
    else render();
  }
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
    selectPicker.refresh();
    for (const listener of listeners) notify(listener);
    schedulePainted();
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
  function installSelectPicker() {
    // Keep the native control itself: labels, form submission/reset, framework
    // change handlers and programmatic value/selectedIndex remain native DOM APIs.
    // Only the single-select picker is enhanced; authors can opt out per control.
    let open,
      nextId = 0,
      typeahead = "",
      typedAt = 0;
    const attributes = [
      "aria-expanded",
      "aria-controls",
      "aria-activedescendant",
      "aria-haspopup",
    ];
    const eligible = (node) =>
      node?.tagName === "SELECT" &&
      !node.multiple &&
      node.size <= 1 &&
      node.dataset.starterSelect !== "native";
    const enabled = (node) => eligible(node) && !node.matches(":disabled");
    const selectable = (option) =>
      !!option &&
      !option.disabled &&
      !(
        option.parentElement?.tagName === "OPTGROUP" &&
        option.parentElement.disabled
      ) &&
      !option.hidden &&
      !option.parentElement?.hidden;
    function syncSelection(refresh = true) {
      if (open && open.selected !== open.select.selectedIndex) {
        open.selected = open.select.selectedIndex;
        open.active = open.selected;
        if (refresh) renderOptions();
      }
    }
    function close(commit = false) {
      if (!open) return;
      if (commit) syncSelection(false);
      const previous = open;
      open = undefined;
      previous.observer.disconnect();
      previous.popup.remove();
      for (const [name, value] of previous.attributes)
        if (value === null) previous.select.removeAttribute(name);
        else previous.select.setAttribute(name, value);
      typeahead = "";
      if (commit && previous.select.isConnected && enabled(previous.select)) {
        const option = previous.select.options[previous.active];
        if (
          option &&
          selectable(option) &&
          previous.select.selectedIndex !== previous.active
        ) {
          previous.select.selectedIndex = previous.active;
          previous.select.dispatchEvent(new Event("input", { bubbles: true }));
          previous.select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }
    function position() {
      if (!open) return;
      const { select, popup } = open;
      if (!select.isConnected || !enabled(select)) return close();
      popup.style.font = getComputedStyle(select).font;
      const rectangle = select.getBoundingClientRect();
      const gap = 4,
        edge = 4;
      const availableBelow = window.innerHeight - rectangle.bottom - gap - edge;
      const availableAbove = rectangle.top - gap - edge;
      const above =
        availableBelow < Math.min(popup.scrollHeight, 160) &&
        availableAbove > availableBelow;
      const available = Math.max(32, above ? availableAbove : availableBelow);
      popup.style.minWidth = `${Math.min(rectangle.width, window.innerWidth - edge * 2)}px`;
      popup.style.maxWidth = `${Math.max(32, window.innerWidth - edge * 2)}px`;
      popup.style.maxHeight = `${Math.min(320, available)}px`;
      popup.style.left = `${Math.max(edge, Math.min(rectangle.left, window.innerWidth - popup.offsetWidth - edge))}px`;
      popup.style.top = `${above ? Math.max(edge, rectangle.top - popup.offsetHeight - gap) : rectangle.bottom + gap}px`;
    }
    function activate(index, scroll = true) {
      if (!open || !selectable(open.select.options[index])) return;
      open.active = index;
      for (const option of open.popup.querySelectorAll("[data-starter-option]"))
        option.toggleAttribute(
          "data-active",
          Number(option.dataset.starterOption) === index,
        );
      const active = open.popup.querySelector(
        `[data-starter-option="${index}"]`,
      );
      if (active) {
        open.select.setAttribute("aria-activedescendant", active.id);
        if (scroll) active.scrollIntoView({ block: "nearest" });
      }
    }
    function renderOptions() {
      if (!open) return;
      const { select, popup } = open;
      popup.replaceChildren();
      let group;
      for (const [index, option] of Array.from(select.options).entries()) {
        if (option.hidden || option.parentElement?.hidden) continue;
        if (
          option.parentElement?.tagName === "OPTGROUP" &&
          group !== option.parentElement
        ) {
          group = option.parentElement;
          const label = document.createElement("div");
          label.dataset.starterOptionGroup = "";
          label.setAttribute("role", "presentation");
          label.textContent = group.label;
          popup.append(label);
        }
        const node = document.createElement("div");
        node.dataset.starterOption = String(index);
        node.id = `${popup.id}-${index}`;
        node.setAttribute("role", "option");
        node.setAttribute(
          "aria-selected",
          String(index === select.selectedIndex),
        );
        node.setAttribute("aria-disabled", String(!selectable(option)));
        node.textContent = option.label;
        popup.append(node);
      }
      if (
        !select.options[open.active] ||
        !selectable(select.options[open.active])
      )
        open.active = Array.from(select.options).findIndex(selectable);
      position();
      if (open) activate(open.active);
    }
    function show(select) {
      if (!enabled(select)) return;
      if (open?.select === select) return;
      close(true);
      const popup = document.createElement("div");
      popup.id = `starter-listbox-${++nextId}`;
      popup.dataset.starterListbox = "";
      popup.setAttribute("role", "listbox");
      popup.addEventListener("pointermove", (event) => {
        const option = event.target.closest?.("[data-starter-option]");
        if (option && popup.contains(option))
          activate(Number(option.dataset.starterOption), false);
      });
      // Popover's top layer escapes author overflow/transform containers. The
      // fixed fallback also works on WebViews without the Popover API.
      if (typeof popup.showPopover === "function")
        popup.setAttribute("popover", "manual");
      const label = select.getAttribute("aria-labelledby");
      if (label) popup.setAttribute("aria-labelledby", label);
      else {
        const name =
          select.getAttribute("aria-label") ||
          Array.from(select.labels || [])
            .map((item) => {
              const copy = item.cloneNode(true);
              copy
                .querySelectorAll("select")
                .forEach((control) => control.remove());
              return copy.textContent.trim();
            })
            .join(" ");
        if (name) popup.setAttribute("aria-label", name);
      }
      const observer = new MutationObserver((mutations) => {
        if (!open || !select.isConnected || !enabled(select)) return close();
        if (
          mutations.some(
            ({ target }) => target === select || select.contains(target),
          )
        )
          renderOptions();
      });
      open = {
        select,
        popup,
        observer,
        active: select.selectedIndex,
        selected: select.selectedIndex,
        attributes: attributes.map((name) => [name, select.getAttribute(name)]),
      };
      select.setAttribute("aria-expanded", "true");
      select.setAttribute("aria-controls", popup.id);
      select.setAttribute("aria-haspopup", "listbox");
      document.body.append(popup);
      try {
        popup.showPopover?.();
      } catch {
        popup.removeAttribute("popover");
      }
      renderOptions();
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "disabled",
          "multiple",
          "size",
          "label",
          "selected",
          "value",
          "hidden",
          "data-starter-select",
        ],
      });
    }
    function move(direction, limit) {
      if (!open) return;
      const options = open.select.options;
      let index = limit ?? open.active + direction;
      while (index >= 0 && index < options.length) {
        if (selectable(options[index])) {
          activate(index);
          return;
        }
        index += direction;
      }
    }
    function pointer(event) {
      const option = event.target.closest?.("[data-starter-option]");
      if (open && option && open.popup.contains(option)) {
        event.preventDefault();
        syncSelection();
        if (
          selectable(open.select.options[Number(option.dataset.starterOption)])
        ) {
          activate(Number(option.dataset.starterOption), false);
          close(true);
        }
        return;
      }
      const select = event.target;
      if (!enabled(select)) {
        if (open && !open.popup.contains(event.target)) close(true);
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      select.focus({ preventScroll: true });
      if (open?.select === select) close();
      else show(select);
    }
    function suppressMouse(event) {
      if (enabled(event.target)) event.preventDefault();
    }
    function keydown(event) {
      const select = event.target;
      if (!enabled(select) || event.ctrlKey || event.metaKey) return;
      syncSelection();
      const { key } = event;
      if (key === "Escape") {
        if (open?.select === select) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      }
      if (key === "Tab") {
        if (open?.select === select) close(true);
        return;
      }
      if (event.altKey && key === "ArrowUp") {
        if (open?.select === select) {
          event.preventDefault();
          close(true);
        }
        return;
      }
      if (
        (key === "Enter" ||
          (key === " " && (!typeahead || performance.now() - typedAt > 700))) &&
        open?.select === select
      ) {
        event.preventDefault();
        close(true);
        return;
      }
      if (key === "F4" && !event.altKey) {
        event.preventDefault();
        if (open?.select === select) close(true);
        else show(select);
        return;
      }
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "Home",
          "End",
          "PageDown",
          "PageUp",
          "Enter",
          " ",
        ].includes(key) &&
        !(
          key === " " &&
          open?.select === select &&
          performance.now() - typedAt <= 700 &&
          typeahead
        )
      ) {
        event.preventDefault();
        const wasOpen = open?.select === select;
        show(select);
        if (key === "ArrowDown") move(1);
        else if (key === "ArrowUp") move(-1);
        else if (key === "Home") move(1, 0);
        else if (key === "End") move(-1, select.options.length - 1);
        else if (wasOpen && (key === "PageDown" || key === "PageUp")) {
          for (let index = 0; index < 10; index++)
            move(key === "PageDown" ? 1 : -1);
        }
        return;
      }
      if (key.length === 1 && !event.altKey) {
        event.preventDefault();
        show(select);
        const now = performance.now();
        const character = key.toLocaleLowerCase();
        typeahead = now - typedAt > 700 ? character : typeahead + character;
        typedAt = now;
        const query = Array.from(typeahead).every(
          (character) => character === typeahead[0],
        )
          ? typeahead[0]
          : typeahead;
        const options = Array.from(select.options);
        for (let offset = 1; offset <= options.length; offset++) {
          const index = (open.active + offset) % options.length;
          if (
            selectable(options[index]) &&
            options[index].label
              .trim()
              .toLocaleLowerCase()
              .startsWith(query.toLocaleLowerCase())
          ) {
            activate(index);
            break;
          }
        }
      }
    }
    function focus(event) {
      if (
        open &&
        event.target !== open.select &&
        !open.popup.contains(event.target)
      )
        close(true);
    }
    function reset(event) {
      if (open?.select.form === event.target) close();
    }
    function change(event) {
      if (open?.select === event.target) {
        open.selected = open.select.selectedIndex;
        open.active = open.select.selectedIndex;
        renderOptions();
      }
    }
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("mousedown", suppressMouse, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("reset", reset, true);
    document.addEventListener("input", change, true);
    document.addEventListener("change", change, true);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return {
      refresh: position,
      dispose() {
        close();
        document.removeEventListener("pointerdown", pointer, true);
        document.removeEventListener("mousedown", suppressMouse, true);
        document.removeEventListener("keydown", keydown, true);
        document.removeEventListener("focusin", focus, true);
        document.removeEventListener("reset", reset, true);
        document.removeEventListener("input", change, true);
        document.removeEventListener("change", change, true);
        window.removeEventListener("resize", position);
        document.removeEventListener("scroll", position, true);
      },
    };
  }
  const selectPicker = installSelectPicker();
  const ready = new Promise((resolve, reject) => {
    const terminate = (message, code = "EXTENSION_UNAVAILABLE") => {
      if (closedError) return;
      closedError = Object.assign(new Error(message), {
        code,
        retryable: false,
      });
      reject(closedError);
      window.removeEventListener("message", connect);
      listeners.clear();
      reveal?.cancel();
      selectPicker.dispose();
      for (const request of pending.values()) request.reject(closedError);
      pending.clear();
      const connection = port;
      port = undefined;
      if (connection) {
        connection.onmessage = null;
        connection.onmessageerror = null;
        connection.close();
      }
    };
    const connect = (event) => {
      if (
        event.source !== parent ||
        event.data?.type !== "starter:connect" ||
        event.data.version !== 1 ||
        event.ports.length !== 1 ||
        port ||
        closedError
      )
        return;
      port = event.ports[0];
      window.removeEventListener("message", connect);
      port.onmessage = (event) => {
        if (closedError) return;
        const message = event.data;
        if (message?.type === "state") {
          resolve(structuredClone(message.value));
          if (reveal && message.value.theme.mode !== reveal.mode)
            reveal.finish(message.value);
          else applySnapshot(message.value);
        } else if (message?.type === "theme-transition") {
          prepareReveal(message.value);
        } else if (message?.type === "closed") {
          terminate("Extension surface closed");
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
      port.onmessageerror = () =>
        terminate(
          "Extension bridge message could not be read",
          "INVALID_ARGUMENT",
        );
      port.start();
    };
    window.addEventListener("message", connect);
  });
  // 作者可能只订阅状态；初始化失败仍需结算，且不让未消费的 ready 产生未处理拒绝。
  void ready.catch(() => {});
  async function request(method, params) {
    await ready;
    if (!port || pending.size >= 4 || sequence >= 2147483647)
      throw Object.assign(new Error("Extension bridge unavailable or busy"), {
        code: "EXTENSION_UNAVAILABLE",
        retryable: false,
      });
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
        if (closedError) return () => {};
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
      notify(message, { tone = "info" } = {}) {
        return request("notify", { message, tone });
      },
      services: Object.freeze({
        request(service, value) {
          if (
            service !== "lan" &&
            service !== "wallpaper" &&
            service !== "resources" &&
            service !== "links"
          )
            return Promise.reject(
              Object.assign(new Error("Unknown extension service"), {
                code: "INVALID_ARGUMENT",
                retryable: false,
              }),
            );
          return request("service", { service, request: value });
        },
      }),
    }),
  });
  parent.postMessage({ type: "starter:ready", version: 1 }, "*");
})();
