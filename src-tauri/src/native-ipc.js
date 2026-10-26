// Adapted from Tauri 2.12.4 scripts/ipc-protocol.js and process-ipc-message-fn.js.
// Keep the upstream transport/serialization behavior; the only policy change is the frame guard.
// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

(function () {
  // WebView2 injects initialization scripts into child frames too. Never install
  // the keyed native transport there, including opaque plugin documents.
  if (window !== window.top) return;

  /**
   * A runtime generated key to ensure an IPC call comes from an initialized frame.
   *
   * This is declared outside the `window.__TAURI_INVOKE__` definition to prevent
   * the key from being leaked by `window.__TAURI_INVOKE__.toString()`.
   */
  const __TAURI_INVOKE_KEY__ = __INVOKE_KEY__;

  const processIpcMessage = // Copyright 2019-2024 Tauri Programme within The Commons Conservancy
    // SPDX-License-Identifier: Apache-2.0
    // SPDX-License-Identifier: MIT

    // this is a function and not an iife so use it carefully

    function (message) {
      if (
        message instanceof ArrayBuffer ||
        ArrayBuffer.isView(message) ||
        Array.isArray(message)
      ) {
        return {
          contentType: "application/octet-stream",
          data: message,
        };
      } else {
        const data = JSON.stringify(message, (_k, val) => {
          // if this value changes, make sure to update it in:
          // 1. ipc.js
          // 2. core.ts
          const SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";

          if (val instanceof Map) {
            return Object.fromEntries(val.entries());
          } else if (val instanceof Uint8Array) {
            return Array.from(val);
          } else if (val instanceof ArrayBuffer) {
            return Array.from(new Uint8Array(val));
          } else if (
            typeof val === "object" &&
            val !== null &&
            SERIALIZE_TO_IPC_FN in val
          ) {
            return val[SERIALIZE_TO_IPC_FN]();
          } else {
            return val;
          }
        });

        return {
          contentType: "application/json",
          data,
        };
      }
    };
  const osName = __STARTER_OS_NAME__;
  const fetchChannelDataCommand = "plugin:__TAURI_CHANNEL__|fetch";
  let customProtocolIpcFailed = false;

  // on Android we never use it because Android does not have support to reading the request body
  const canUseCustomProtocol = osName !== "android";

  function sendIpcMessage(message) {
    const { cmd, callback, error, payload, options } = message;

    if (
      !customProtocolIpcFailed &&
      (canUseCustomProtocol || cmd === fetchChannelDataCommand)
    ) {
      const { contentType, data } = processIpcMessage(payload);

      const headers = new Headers((options && options.headers) || {});
      headers.set("Content-Type", contentType);
      headers.set("Tauri-Callback", callback);
      headers.set("Tauri-Error", error);
      headers.set("Tauri-Invoke-Key", __TAURI_INVOKE_KEY__);

      fetch(window.__TAURI_INTERNALS__.convertFileSrc(cmd, "ipc"), {
        method: "POST",
        body: data,
        headers,
      })
        .then((response) => {
          const callbackId =
            response.headers.get("Tauri-Response") === "ok" ? callback : error;
          // we need to split here because on Android the content-type gets duplicated
          switch ((response.headers.get("content-type") || "").split(",")[0]) {
            case "application/json":
              return response.json().then((r) => [callbackId, r]);
            case "text/plain":
              return response.text().then((r) => [callbackId, r]);
            default:
              return response.arrayBuffer().then((r) => [callbackId, r]);
          }
        })
        .then(
          ([callbackId, data]) => {
            window.__TAURI_INTERNALS__.runCallback(callbackId, data);
          },
          (e) => {
            console.warn(
              "IPC custom protocol failed, Tauri will now use the postMessage interface instead",
              e,
            );
            // failed to use the custom protocol IPC (either the webview blocked a custom protocol or it was a CSP error)
            // so we need to fallback to the postMessage interface
            customProtocolIpcFailed = true;
            sendIpcMessage(message);
          },
        );
    } else {
      // otherwise use the postMessage interface
      const { data } = processIpcMessage({
        cmd,
        callback,
        error,
        options: {
          ...options,
          customProtocolIpcBlocked: customProtocolIpcFailed,
        },
        payload,
        __TAURI_INVOKE_KEY__,
      });
      // `window.ipc.postMessage` came from `tauri-runtime-wry` > `wry` [`with_ipc_handler`](https://github.com/tauri-apps/wry/blob/a0403b9e2f1ff9d73be7dce1184f058afcaa1d82/src/lib.rs#L1130)
      window.ipc.postMessage(data);
    }
  }

  Object.defineProperty(window.__TAURI_INTERNALS__, "postMessage", {
    value: sendIpcMessage,
  });
})();
