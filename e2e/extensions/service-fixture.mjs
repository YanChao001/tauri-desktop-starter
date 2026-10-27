// Browser-only boundary substitutes. These do not exercise TCP, network, dialogs or native storage.
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=";
// Only HTTP/native edges are substituted. The real packaged Wasm parses these
// provider payloads and resolves the stable thumbnail/original pairs itself.
const fixtureImageUrls = new Set();
const fixtureSourceUrls = new Set(["https://wp.upx8.com/"]);
function imageUrl(url) {
  fixtureImageUrls.add(url);
  return url;
}
function sourceUrl(url) {
  fixtureSourceUrls.add(url);
  return url;
}
function providerPayload(url, effectId) {
  const serial = effectId.replaceAll(/[^a-zA-Z0-9-]/g, "");
  const title = (index) =>
    index === 0 ? "Fixture landscape" : "Landscape".repeat(24) + index;
  if (url.origin === "https://wp.upx8.com" && url.pathname === "/api.php")
    return {
      code: 200,
      data: Array.from({ length: 10 }, (_, index) => ({
        url: imageUrl(
          `https://cdn-hsyq-static.shanhutech.cn/bizhi/staticwp/fixture-${serial}-${index}.jpg`,
        ),
        width: 1920,
        height: 1080,
        title: title(index),
        source: "birdpaper",
      })),
    };
  if (
    url.origin === "https://wallhaven.cc" &&
    url.pathname === "/api/v1/search"
  )
    return {
      data: Array.from(
        { length: url.searchParams.get("q") === "fixture-no-results" ? 0 : 24 },
        (_, index) => ({
          id: `fixture${serial.replaceAll("-", "")}${index}`,
          purity: "sfw",
          category:
            { 100: "general", "010": "anime", "001": "people" }[
              url.searchParams.get("categories")
            ] ?? "general",
          url: sourceUrl(
            `https://wallhaven.cc/w/fixture${serial.replaceAll("-", "")}${index}`,
          ),
          path: imageUrl(
            `https://w.wallhaven.cc/full/fi/wallhaven-fixture${serial.replaceAll("-", "")}${index}.jpg`,
          ),
          thumbs: {
            large: imageUrl(
              `https://th.wallhaven.cc/lg/fi/fixture${serial.replaceAll("-", "")}${index}.jpg`,
            ),
          },
          dimension_x: 1920,
          dimension_y: 1080,
          resolution: "1920x1080",
        }),
      ),
    };
  if (
    url.origin === "https://commons.wikimedia.org" &&
    url.pathname === "/w/api.php"
  )
    return {
      query: {
        pages: Array.from({ length: 24 }, (_, index) => ({
          title: `File:${title(index)}.jpg`,
          imageinfo: [
            {
              url: imageUrl(
                `https://upload.wikimedia.org/wikipedia/commons/a/ab/fixture-${serial}-${index}.jpg`,
              ),
              thumburl: imageUrl(
                `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/fixture-${serial}-${index}.jpg/640px-fixture-${serial}-${index}.jpg`,
              ),
              descriptionurl: sourceUrl(
                `https://commons.wikimedia.org/wiki/File:fixture-${serial}-${index}.jpg`,
              ),
              width: 1920,
              height: 1080,
              mime: "image/jpeg",
            },
          ],
        })),
      },
    };
  if (
    url.origin === "https://nekos.best" &&
    /^\/api\/v2\/(neko|kitsune|waifu|husbando|search)$/.test(url.pathname)
  ) {
    const category =
      url.pathname === "/api/v2/search"
        ? url.searchParams.get("category")
        : url.pathname.split("/").at(-1);
    return {
      results: Array.from({ length: 20 }, (_, index) => ({
        artist_name: title(index),
        source_url: sourceUrl(
          `https://www.pixiv.net/en/artworks/fixture-${serial}-${index}`,
        ),
        url: imageUrl(
          `https://nekos.best/api/v2/${category}/fixture-${serial}-${index}.png`,
        ),
        dimensions: { width: 1000, height: 1181 },
      })),
    };
  }
  throw Error("Unknown explicit provider fixture URL");
}
function rejected(code, message) {
  return {
    boundaryMock: true,
    boundaryError: { code, message },
  };
}
export function createBoundaryServices() {
  const sessions = new Map();
  const calls = [];
  const httpCalls = [];
  let resourceSerial = 0;
  let httpFailurePending = false;
  let imageFailurePending = false;
  let lanAttachmentCancellationPending = false;
  let lanSaveCancellationPending = false;
  let nextLanAttachmentGate = null;
  function state(session, seedGallery = false) {
    if (!sessions.has(session))
      sessions.set(session, {
        lan: {
          running: false,
          nickname: "Fixture device",
          nodeId: "a".repeat(32),
          port: 0,
          addresses: ["192.168.1.20"],
          peers: [],
          messages: [],
          historyLimit: 500,
          lastError: null,
          encrypted: false,
          mode: "lan",
          loopbackPeerId: null,
          attachmentLimit: 1024 * 1024 * 1024,
          imageAttachmentLimit: 8 * 1024 * 1024,
          fileAttachmentLimit: 1024 * 1024 * 1024,
          attachmentCacheLimit: 2 * 1024 * 1024 * 1024,
        },
        wallpaper: {
          revision: 0,
          items: seedGallery
            ? [
                {
                  id: "f".repeat(64),
                  name: "Fixture local image",
                  dataUrl,
                  active: false,
                },
              ]
            : [],
          limit: 24,
        },
        resources: new Map(),
      });
    return sessions.get(session);
  }
  function http(input, effect) {
    const request = effect.request;
    const url = new URL(request.url);
    const granted = input.boundaryGrantedPermissions ?? [];
    if (
      effect.kind !== "http" ||
      ![
        "https://wp.upx8.com",
        "https://wallhaven.cc",
        "https://commons.wikimedia.org",
        "https://nekos.best",
      ].includes(url.origin) ||
      url.username ||
      url.password ||
      url.hash ||
      request.method !== "GET" ||
      (request.networkMode !== undefined &&
        !["direct", "system"].includes(request.networkMode)) ||
      request.body != null ||
      request.credential != null ||
      Object.keys(request.headers).length !== 2 ||
      request.headers.Accept !== "application/json" ||
      request.headers["User-Agent"] !==
        "TauriDesktopStarterWallpaper/2.0 (https://github.com/YanChao001/tauri-desktop-starter-extensions)"
    )
      throw Error("Unsupported explicit HTTP effect boundary");
    const payload = providerPayload(url, effect.id);
    const failHttp = httpFailurePending;
    httpFailurePending = false;
    const error =
      !granted.includes("network:https") ||
      (request.networkMode === "system" &&
        !granted.includes("network:system-proxy"))
        ? {
            code: "EXTENSION_UNAVAILABLE",
            message: "HTTP permission is not granted",
            retryable: false,
          }
        : failHttp
          ? {
              code: "EXTENSION_RUN_FAILED",
              message: "Explicit offline HTTP boundary failure",
              retryable: false,
            }
          : null;
    const receipt = {
      id: effect.id,
      error,
      value: error
        ? null
        : {
            url: request.url,
            status: 200,
            headers: {},
            body: JSON.stringify(payload),
          },
    };
    httpCalls.push({
      plugin: input.id,
      request: structuredClone(request),
      boundaryMock: true,
      receipt: structuredClone(receipt),
    });
    return receipt;
  }
  function request(input) {
    if (input.boundaryMock !== true || typeof input.fixtureSession !== "string")
      throw Error("Service fixture must be explicitly marked boundaryMock");
    calls.push({
      plugin: input.id,
      service: input.service,
      request: input.request,
      boundaryMock: true,
    });
    if (input.service === "window")
      return rejected(
        "EXTENSION_UNAVAILABLE",
        "Window services require a native extension window",
      );
    const data = state(
        input.fixtureSession,
        input.boundaryGallerySeed === true,
      ),
      operation = input.request;
    const grants = input.boundaryGrantedPermissions ?? [];
    const required = {
      lan: "messaging:lan",
      wallpaper: "wallpapers:manage",
      resources: "network:images",
      links: "links:open",
    }[input.service];
    if (
      !required ||
      !grants.includes(required) ||
      (input.service === "resources" &&
        operation.networkMode === "system" &&
        !grants.includes("network:system-proxy")) ||
      (input.service === "wallpaper" &&
        operation.action === "import-resource" &&
        !grants.includes("network:images"))
    )
      return rejected(
        "EXTENSION_UNAVAILABLE",
        "Desktop service permission is not granted",
      );
    function resource() {
      const item = data.resources.get(operation.resourceId);
      return item?.plugin === input.id ? item : null;
    }
    let result;
    if (input.service === "lan") {
      const lan = data.lan;
      const appendMessage = (peerId, text, kind = "text", attachment) => {
        const peer = lan.peers.find((item) => item.id === peerId);
        if (!lan.running || !peer?.connected)
          throw Error("Connect the explicit boundary fixture peer first");
        const outgoing = {
          id: String(lan.messages.length).padStart(32, "d"),
          peerId,
          sender: lan.nodeId,
          nickname: lan.nickname,
          text,
          kind,
          at: 1761400001000 + lan.messages.length,
          outgoing: true,
          delivery: "delivered",
          ...(attachment ? { attachment } : {}),
        };
        lan.messages.push(outgoing);
        if (lan.mode === "loopback")
          lan.messages.push({
            ...outgoing,
            id: String(lan.messages.length).padStart(32, "d"),
            sender: peer.id,
            nickname: peer.nickname,
            outgoing: false,
            delivery: "received",
          });
      };
      switch (operation.action) {
        case "status":
          break;
        case "start":
          lan.running = true;
          lan.nickname = operation.nickname;
          lan.port = operation.port ?? 45873;
          lan.mode = operation.mode ?? "lan";
          lan.loopbackPeerId = null;
          lan.addresses = ["192.168.1.20"];
          break;
        case "loopback":
          lan.running = true;
          lan.nickname = operation.nickname;
          lan.port = 41234;
          lan.mode = "loopback";
          lan.loopbackPeerId = "e".repeat(32);
          lan.addresses = ["127.0.0.1"];
          lan.peers = [
            ...lan.peers
              .filter((peer) => peer.id !== lan.loopbackPeerId)
              .map((peer) => ({ ...peer, connected: false })),
            {
              id: lan.loopbackPeerId,
              nickname: "Boundary echo peer",
              address: "127.0.0.1",
              port: 41235,
              lastSeen: 1761400000000,
              unread: 0,
              connected: true,
            },
          ];
          break;
        case "stop":
          lan.running = false;
          lan.peers.forEach((peer) => {
            peer.connected = false;
          });
          break;
        case "nickname":
          lan.nickname = operation.nickname;
          break;
        case "connect":
          if (!lan.running) throw Error("Start the fixture listener first");
          lan.peers = [
            {
              id: "b".repeat(32),
              nickname: "Fixture friend",
              address: operation.address,
              port: operation.port,
              lastSeen: 1761400000000,
              unread: 1,
              connected: true,
            },
          ];
          lan.messages = [
            {
              id: "c".repeat(32),
              peerId: "b".repeat(32),
              sender: "b".repeat(32),
              nickname: "Fixture friend",
              text: "Boundary fixture hello",
              kind: "text",
              at: 1761400000000,
              outgoing: false,
              delivery: "received",
            },
          ];
          break;
        case "markRead":
          if (lan.peers.some((peer) => peer.id === operation.peerId))
            lan.peers.find((peer) => peer.id === operation.peerId).unread = 0;
          break;
        case "send":
          if (operation.text === "fixture-failed-send")
            return rejected(
              "EXTENSION_RUN_FAILED",
              "Explicit browser boundary send failure",
            );
          appendMessage(operation.peerId, operation.text, operation.kind);
          break;
        case "sendAttachment": {
          if (!["image", "file"].includes(operation.kind))
            throw Error("Unsupported explicit attachment fixture kind");
          const cancelled = lanAttachmentCancellationPending;
          lanAttachmentCancellationPending = false;
          if (!cancelled)
            appendMessage(operation.peerId, "", operation.kind, {
              name:
                operation.kind === "image"
                  ? "boundary-fixture.png"
                  : "boundary-fixture.txt",
              mime:
                operation.kind === "image"
                  ? "image/png"
                  : "application/octet-stream",
              // Metadata only: the explicit browser boundary never transfers these bytes.
              bytes: operation.kind === "image" ? 68 : 64 * 1024 * 1024,
              sha256: "f".repeat(64),
            });
          result = { ...structuredClone(lan), cancelled };
          if (nextLanAttachmentGate) {
            const gate = nextLanAttachmentGate;
            nextLanAttachmentGate = null;
            gate.started = true;
            const captured = { ...structuredClone(result), boundaryMock: true };
            return new Promise((resolve) => {
              gate.complete = () => resolve(captured);
              if (gate.released) gate.complete();
            });
          }
          break;
        }
        case "previewAttachment": {
          const message = lan.messages.find(
            (item) => item.id === operation.messageId,
          );
          if (!message?.attachment)
            return rejected("NOT_FOUND", "Boundary attachment is unavailable");
          result = { dataUrl: message.kind === "image" ? dataUrl : null };
          break;
        }
        case "saveAttachment": {
          const message = lan.messages.find(
            (item) => item.id === operation.messageId,
          );
          if (!message?.attachment)
            return rejected("NOT_FOUND", "Boundary attachment is unavailable");
          const cancelled = lanSaveCancellationPending;
          lanSaveCancellationPending = false;
          result = {
            cancelled,
            ...(cancelled ? {} : { name: message.attachment.name }),
          };
          break;
        }
        case "clearHistory":
          lan.messages = [];
          break;
        case "forget":
          lan.peers = lan.peers.filter((peer) => peer.id !== operation.peerId);
          lan.messages = lan.messages.filter(
            (message) => message.peerId !== operation.peerId,
          );
          break;
        default:
          throw Error("Unsupported explicit LAN boundary operation");
      }
      result ??= lan;
    } else if (input.service === "wallpaper") {
      const library = data.wallpaper;
      switch (operation.action) {
        case "list":
          result = library;
          break;
        case "import-resource": {
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          const item = {
            id: "f".repeat(64),
            name: operation.name,
            dataUrl,
            active: false,
          };
          if (!library.items.some((existing) => existing.id === item.id))
            library.items.push(item);
          library.revision++;
          result = { item, library };
          break;
        }
        case "apply":
          library.items.forEach((item) => {
            item.active = item.id === operation.id;
          });
          library.revision++;
          result = library;
          break;
        case "rename":
          library.items.find((item) => item.id === operation.id).name =
            operation.name;
          library.revision++;
          result = library;
          break;
        case "remove":
          library.items = library.items.filter(
            (item) => item.id !== operation.id,
          );
          library.revision++;
          result = library;
          break;
        case "import":
          result = { cancelled: true };
          break;
        case "open-settings":
          result = { opened: true };
          break;
        default:
          throw Error("Unsupported explicit wallpaper boundary operation");
      }
    } else if (input.service === "resources") {
      switch (operation.action) {
        case "fetch-image": {
          if (!fixtureImageUrls.has(operation.url))
            return rejected(
              "INVALID_ARGUMENT",
              "Unknown explicit fixture image URL",
            );
          if (imageFailurePending) {
            imageFailurePending = false;
            return rejected(
              "EXTENSION_RUN_FAILED",
              "Explicit transient image boundary failure",
            );
          }
          const metadata = {
            resourceId: (++resourceSerial).toString(16).padStart(48, "0"),
            mime: "image/png",
            bytes: 1024,
            width: 1200,
            height: 800,
            sha256: "e".repeat(64),
          };
          data.resources.set(metadata.resourceId, {
            plugin: input.id,
            metadata,
          });
          result = metadata;
          break;
        }
        case "preview":
        case "save":
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          result =
            operation.action === "preview" ? { dataUrl } : { cancelled: true };
          break;
        case "release":
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          data.resources.delete(operation.resourceId);
          result = null;
          break;
        default:
          throw Error("Unsupported explicit resource boundary operation");
      }
    } else if (input.service === "links") {
      if (!fixtureSourceUrls.has(operation.url))
        return rejected(
          "INVALID_ARGUMENT",
          "Unknown explicit fixture source URL",
        );
      result = null;
    } else throw Error("Unknown service fixture");
    return result === null
      ? null
      : { ...structuredClone(result), boundaryMock: true };
  }
  return {
    request,
    calls,
    http,
    httpCalls,
    failNextHttp: () => {
      httpFailurePending = true;
    },
    failNextImage: () => {
      imageFailurePending = true;
    },
    cancelNextLanAttachment: () => {
      lanAttachmentCancellationPending = true;
    },
    cancelNextLanSave: () => {
      lanSaveCancellationPending = true;
    },
    holdNextLanAttachment: () => {
      if (nextLanAttachmentGate)
        throw Error(
          "An explicit LAN attachment boundary gate is already armed",
        );
      const gate = { started: false, released: false, complete: null };
      nextLanAttachmentGate = gate;
      return {
        started: () => gate.started,
        release: () => {
          gate.released = true;
          if (nextLanAttachmentGate === gate) nextLanAttachmentGate = null;
          gate.complete?.();
        },
      };
    },
    activeResources: () =>
      [...sessions.values()].reduce(
        (count, session) => count + session.resources.size,
        0,
      ),
  };
}
