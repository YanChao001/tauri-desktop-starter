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
  let port, current;
  let sequence = 0;
  const pending = new Map(),
    listeners = new Set();
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
          current = message.value;
          const theme = current.theme;
          document.documentElement.style.colorScheme = theme.mode;
          document.documentElement.style.fontSize =
            theme.tokens["--host-font-size"] || "16px";
          for (const [name, value] of Object.entries(theme.tokens))
            document.documentElement.style.setProperty(name, value);
          document.documentElement.lang = current.locale;
          for (const listener of listeners) listener(structuredClone(current));
          resolve(structuredClone(current));
        } else if (message?.type === "closed") {
          for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(new Error("Extension surface closed"));
          }
          pending.clear();
          port.close();
          port = undefined;
        } else if (Number.isSafeInteger(message?.id)) {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error)
            request.reject(
              Object.assign(new Error(message.error.message), {
                code: message.error.code,
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
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Extension request timed out"));
      }, 65000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage(message);
    });
  }
  Object.defineProperty(window, "starter", {
    value: Object.freeze({
      ready,
      onChange(listener) {
        listeners.add(listener);
        if (current) listener(structuredClone(current));
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
    }),
  });
  parent.postMessage({ type: "starter:ready", version: 1 }, "*");
})();
