/* Injected only into opaque extension frames. No native API or host DOM is exposed. */
(() => {
  "use strict";
  if (window === window.top) return;
  // Replaced only by the native all-frame initializer. It controls document UI
  // policy, never bridge access; browser fixtures keep the unreplaced source.
  const nativeContextMenu = "__STARTER_NATIVE_CONTEXT_MENU__" === "true";
  function installDesktopContextMenu() {
    const packagedDocument =
      location.protocol === "extension-ui:" ||
      location.hostname === "extension-ui.localhost";
    if (!nativeContextMenu && !packagedDocument) return;
    const textInputTypes = new Set([
      "text",
      "search",
      "email",
      "url",
      "tel",
      "password",
      "number",
    ]);
    const contextMenu = (event) => {
      if (event.defaultPrevented) return;
      const selection = window.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        selection.toString() &&
        event.target instanceof Node &&
        Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index),
        ).some((range) => range.intersectsNode(event.target))
      )
        return;
      for (const node of event.composedPath()) {
        if (!(node instanceof Element)) continue;
        if (node.matches("input,textarea")) {
          // Keep WebView editing, including password paste, without exposing
          // clipboard access through the extension capability bridge.
          if (
            !node.matches(":disabled") &&
            (node.localName === "textarea" || textInputTypes.has(node.type))
          )
            return;
          break;
        }
        const editable = node.getAttribute("contenteditable")?.toLowerCase();
        if (["", "true", "plaintext-only"].includes(editable)) return;
        if (editable === "false") break;
      }
      event.preventDefault();
    };
    // Bubble after author controls so their existing business menus still work.
    // This policy belongs to the document, including initial about:blank/srcdoc
    // descendants, and remains in place when its business channel closes.
    window.addEventListener("contextmenu", contextMenu);
  }
  installDesktopContextMenu();
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
  const initialPaint = document.createElement("style");
  initialPaint.dataset.starterInitialPaint = "";
  // Before the first host theme arrives, controls may have computed UA colors.
  // Commit the real theme while the host still hides the frame, without fading
  // from those fallback colors. Normal author and hover transitions resume below.
  initialPaint.textContent =
    "*,*::before,*::after{transition:none !important;}";
  // Full shared CSS arrives with the first host theme, before the frame is revealed.
  defaults.textContent = "@layer starter-defaults {}";
  function mountDefaults() {
    const root = document.head || document.documentElement;
    if (!root) return false;
    root.prepend(defaults, initialPaint);
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
  let port, current, received, closedError;
  let hostTokens = new Set();
  let sequence = 0;
  let reveal, fontSource;
  const shadowStyles = new Map(),
    selectPickers = new Set();
  function shadowCss() {
    // Application motion preferences must also reach explicitly registered shadow trees.
    return (
      defaults.textContent +
      (current?.theme.motion === "reduced"
        ? "\n@layer starter-defaults { *,*::before,*::after { animation-duration:1ms !important; animation-delay:0ms !important; animation-iteration-count:1 !important; transition-duration:1ms !important; } }"
        : "") +
      (current?.active === false
        ? "\n@layer starter-defaults { *,*::before,*::after { animation-play-state:paused !important; } }"
        : "")
    );
  }
  function applyStyles(root) {
    if (!(root instanceof ShadowRoot) || root.ownerDocument !== document)
      throw new TypeError("Expected a ShadowRoot from this extension document");
    if (closedError)
      throw Object.assign(new Error("Extension surface closed"), {
        code: "EXTENSION_UNAVAILABLE",
        retryable: false,
      });
    let entry = shadowStyles.get(root);
    if (!entry) {
      const style = document.createElement("style");
      style.dataset.starterDefaults = "";
      style.textContent = shadowCss();
      const firstPaint = painted ? null : initialPaint.cloneNode(true);
      root.prepend(style);
      if (firstPaint) root.prepend(firstPaint);
      const picker = installSelectPicker(root);
      selectPickers.add(picker);
      entry = {
        style,
        firstPaint,
        picker,
        motion: current?.theme.motion || "full",
        active: current?.active !== false,
        references: 0,
      };
      shadowStyles.set(root, entry);
    }
    entry.references++;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (--entry.references || shadowStyles.get(root) !== entry) return;
      entry.picker.dispose();
      selectPickers.delete(entry.picker);
      entry.style.remove();
      entry.firstPaint?.remove();
      shadowStyles.delete(root);
    };
  }
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
          // Flush author rendering and theme styles with transitions suppressed.
          // Removing the rule after this commit must not animate initial colors.
          void document.documentElement?.offsetWidth;
          initialPaint.remove();
          for (const entry of shadowStyles.values()) entry.firstPaint?.remove();
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
    const stylesChanged =
      typeof current.theme.styles === "string" &&
      defaults.textContent !== current.theme.styles;
    if (stylesChanged) defaults.textContent = current.theme.styles;
    const root = document.documentElement;
    if (root) {
      const theme = current.theme;
      root.dataset.starterUi = "";
      root.style.colorScheme = theme.mode;
      root.classList.toggle("dark", theme.mode === "dark");
      root.classList.toggle("light", theme.mode !== "dark");
      root.dataset.motion = theme.motion || "full";
      root.dataset.active = String(current.active !== false);
      for (const name of hostTokens)
        if (!Object.hasOwn(theme.tokens, name)) root.style.removeProperty(name);
      for (const [name, token] of Object.entries(theme.tokens))
        root.style.setProperty(name, token);
      hostTokens = new Set(Object.keys(theme.tokens));
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
    for (const entry of shadowStyles.values()) {
      const motion = current.theme.motion || "full";
      const active = current.active !== false;
      if (stylesChanged || entry.motion !== motion || entry.active !== active) {
        entry.motion = motion;
        entry.active = active;
        entry.style.textContent = shadowCss();
      }
    }
    for (const picker of selectPickers)
      if (current.active === false) picker.close();
      else picker.refresh();
    for (const listener of listeners) notify(listener);
    schedulePainted();
  }
  function prepareReveal(value) {
    reveal?.cancel();
    if (
      !current ||
      current.active === false ||
      document.visibilityState === "hidden" ||
      current.theme.motion === "reduced" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      typeof document.startViewTransition !== "function" ||
      typeof document.documentElement?.animate !== "function"
    )
      return;
    let next, release, handle, animation;
    let updating = false,
      applied = false,
      cancelled = false;
    const operation = {
      mode: current.theme.mode,
      finish(snapshot) {
        if (snapshot.active === false) {
          next = snapshot;
          if (applied) applySnapshot(snapshot);
          operation.cancel();
        } else if (applied || (!next && snapshot.theme.mode === operation.mode))
          applySnapshot(snapshot);
        else {
          // 显式主题选择可能直接回到原模式；待提交过渡仍须使用最新草稿和环境。
          next = snapshot;
          if (updating) commit();
        }
      },
      cancel() {
        cancelled = true;
        commit();
        handle?.skipTransition();
        animation?.cancel?.();
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
        animation = document.documentElement.animate(
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
  function installSelectPicker(scope = document) {
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
    const enabled = (node) =>
      current?.active !== false && eligible(node) && !node.matches(":disabled");
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
      for (const picker of selectPickers) picker.close(true);
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
      (scope === document ? document.body : scope).append(popup);
      try {
        popup.showPopover?.();
      } catch {
        popup.removeAttribute("popover");
      }
      renderOptions();
      observer.observe(scope === document ? document.body : scope, {
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
        if (event.button !== 0) return;
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
    function outside(event) {
      if (open && !event.composedPath().includes(scope.host)) close(true);
    }
    scope.addEventListener("pointerdown", pointer, true);
    scope.addEventListener("mousedown", suppressMouse, true);
    scope.addEventListener("keydown", keydown, true);
    scope.addEventListener("focusin", focus, true);
    scope.addEventListener("reset", reset, true);
    scope.addEventListener("input", change, true);
    scope.addEventListener("change", change, true);
    if (scope !== document) {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("focusin", outside, true);
    }
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return {
      close,
      refresh: position,
      dispose() {
        close();
        scope.removeEventListener("pointerdown", pointer, true);
        scope.removeEventListener("mousedown", suppressMouse, true);
        scope.removeEventListener("keydown", keydown, true);
        scope.removeEventListener("focusin", focus, true);
        scope.removeEventListener("reset", reset, true);
        scope.removeEventListener("input", change, true);
        scope.removeEventListener("change", change, true);
        if (scope !== document) {
          document.removeEventListener("pointerdown", outside, true);
          document.removeEventListener("focusin", outside, true);
        }
        window.removeEventListener("resize", position);
        document.removeEventListener("scroll", position, true);
      },
    };
  }
  const selectPicker = installSelectPicker();
  selectPickers.add(selectPicker);
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
      for (const picker of selectPickers) picker.dispose();
      selectPickers.clear();
      for (const entry of shadowStyles.values()) {
        entry.style.remove();
        entry.firstPaint?.remove();
      }
      shadowStyles.clear();
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
          // 首次快照完整，后续消息只替换变化的顶层字段；作者仍收到完整快照。
          const first = received === undefined;
          const value = { active: true, ...received, ...message.value };
          received = value;
          if (first) resolve(structuredClone(value));
          if (reveal) reveal.finish(value);
          else applySnapshot(value);
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
    if (!port || received?.active === false || sequence >= 2147483647)
      throw Object.assign(new Error("Extension bridge unavailable or busy"), {
        code: "EXTENSION_UNAVAILABLE",
        retryable: false,
      });
    if (pending.size >= 4)
      throw Object.assign(new Error("Extension bridge is busy"), {
        code: "EXTENSION_BUSY",
        retryable: true,
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
      applyStyles,
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
      async checkpoint(value, dirty) {
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
            service !== "links" &&
            service !== "window"
          )
            return Promise.reject(
              Object.assign(new Error("Unknown extension service"), {
                code: "INVALID_ARGUMENT",
                retryable: false,
              }),
            );
          if (
            service === "window" &&
            (!value ||
              typeof value !== "object" ||
              Array.isArray(value) ||
              !(
                (value.action === "get-state" &&
                  Object.keys(value).sort().join(",") === "action") ||
                (value.action === "set-always-on-top" &&
                  typeof value.enabled === "boolean" &&
                  Object.keys(value).sort().join(",") === "action,enabled")
              ))
          )
            return Promise.reject(
              Object.assign(new Error("Invalid extension window request"), {
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
