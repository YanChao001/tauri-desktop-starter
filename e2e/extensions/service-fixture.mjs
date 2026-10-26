// Browser-only boundary substitutes. These do not exercise TCP, network, dialogs or native storage.
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=";
// Only the HTTP/native edges are substituted. Search results must be parsed by
// the packaged Wasm from this HTML, rather than returned by a wallpaper service.
function bingHtml(query) {
  const escape = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("'", "&#39;")
      .replaceAll('"', "&quot;");
  const items = [
    { title: "Fixture landscape", file: "one", width: 1200, height: 800 },
    {
      title: "Landscape".repeat(24) + ".jpg",
      file: "two",
      width: 0,
      height: 0,
    },
  ];
  return `<input id='sb_form_q' value='${escape(query)}'>${items
    .map((item) => {
      const metadata = {
        murl: `https://images.wikipedia.org/${item.file}.jpg`,
        purl: `https://www.wikipedia.org/${item.file}`,
        turl: `https://ts2.mm.bing.net/th?id=OIP.fixture-${item.file}`,
        t: item.title,
        w: item.width,
        h: item.height,
      };
      return `<a class='iusc' href='/images/search?q=${escape(encodeURIComponent(query))}&amp;expw=${item.width}&amp;exph=${item.height}' m='${escape(JSON.stringify(metadata))}'>image</a>`;
    })
    .join("")}`;
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
      url.origin !== "https://cn.bing.com" ||
      url.pathname !== "/images/search" ||
      url.username ||
      url.password ||
      url.hash ||
      request.method !== "GET" ||
      !["direct", "system"].includes(request.networkMode) ||
      request.body != null ||
      request.credential != null ||
      Object.keys(request.headers).length !== 2 ||
      request.headers.Accept !== "text/html" ||
      request.headers["User-Agent"] !==
        "TauriDesktopStarterWallpaper/1.0 (https://github.com/YanChao001/tauri-desktop-starter-extensions)"
    )
      throw Error("Unsupported explicit HTTP effect boundary");
    const query = url.searchParams.get("q");
    if (
      !query ||
      url.searchParams.getAll("q").length !== 1 ||
      [...query].length > 100 ||
      Buffer.byteLength(query) > 400 ||
      [...query].some((character) => {
        const code = character.codePointAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    )
      throw Error("Search effect must contain its bounded query");
    const error =
      !granted.includes("network:https") ||
      (request.networkMode === "system" &&
        !granted.includes("network:system-proxy"))
        ? {
            code: "EXTENSION_UNAVAILABLE",
            message: "HTTP permission is not granted",
            retryable: false,
          }
        : query === "fixture-search-failure"
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
        : { url: request.url, status: 200, headers: {}, body: bingHtml(query) },
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
      switch (operation.action) {
        case "status":
          break;
        case "start":
          lan.running = true;
          lan.nickname = operation.nickname;
          lan.port = operation.port;
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
              at: 1761400000000,
              outgoing: false,
              delivery: "received",
            },
          ];
          break;
        case "markRead":
          lan.peers.find((peer) => peer.id === operation.peerId).unread = 0;
          break;
        case "send":
          if (operation.text === "fixture-failed-send")
            throw Error("Explicit browser boundary send failure");
          lan.messages.push({
            id: String(lan.messages.length).padStart(32, "d"),
            peerId: operation.peerId,
            sender: lan.nodeId,
            nickname: lan.nickname,
            text: operation.text,
            at: 1761400001000,
            outgoing: true,
            delivery: "delivered",
          });
          break;
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
      result = lan;
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
          if (
            ![
              "https://images.wikipedia.org/one.jpg",
              "https://images.wikipedia.org/two.jpg",
              "https://ts2.mm.bing.net/th?id=OIP.fixture-one",
              "https://ts2.mm.bing.net/th?id=OIP.fixture-two",
            ].includes(operation.url)
          )
            return rejected(
              "INVALID_ARGUMENT",
              "Unknown explicit fixture image URL",
            );
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
      if (
        ![
          "https://www.wikipedia.org/one",
          "https://www.wikipedia.org/two",
        ].includes(operation.url)
      )
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
    activeResources: () =>
      [...sessions.values()].reduce(
        (count, session) => count + session.resources.size,
        0,
      ),
  };
}
