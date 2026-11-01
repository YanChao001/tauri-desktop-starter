// Browser-only boundary substitutes. These do not exercise TCP, network, dialogs or native storage.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import {
  readRepositoryConfig,
  wallpaperUserAgent,
} from "../../marketplace/scripts/repository-config.mjs";

const wallpaperAgent = wallpaperUserAgent(
  readRepositoryConfig(),
  JSON.parse(
    readFileSync(
      new URL("../../marketplace/listings.json", import.meta.url),
      "utf8",
    ),
  ).repository,
);

const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=";
// Tiny solid PNGs keep the offline fixture bounded while making preview quality
// observable through the image's actual decoded dimensions.
function fixturePng(width, height) {
  const chunk = (kind, bytes) => {
    const name = Buffer.from(kind),
      content = Buffer.concat([name, bytes]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // One-bit grayscale needs very few fixture bytes.
  const image = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk(
      "IDAT",
      deflateSync(Buffer.alloc((Math.ceil(width / 8) + 1) * height)),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${image.toString("base64")}`;
}
const thumbnailDataUrl = fixturePng(320, 200),
  largePreviewDataUrl = fixturePng(1920, 1200),
  lanPreviewDataUrl = fixturePng(1600, 1000);
const localPreviewKey = createHash("sha256").update(dataUrl).digest("hex");
// Only HTTP/native edges are substituted. The real packaged Wasm parses these
// provider payloads and resolves the stable thumbnail/original pairs itself.
const fixtureImageUrls = new Set();
const fixtureSourceUrls = new Set();
function imageUrl(url) {
  fixtureImageUrls.add(url);
  return url;
}
function sourceUrl(url) {
  fixtureSourceUrls.add(url);
  return url;
}
function providerPayload(url) {
  // Listing identities remain stable when an HTTP effect sequence changes.
  const serial = createHash("sha256")
    .update(url.href)
    .digest("hex")
    .slice(0, 12);
  const number = Number.parseInt(serial, 16);
  const empty = decodeURIComponent(url.href).includes("fixture-no-results");
  const finalPage = decodeURIComponent(url.href).includes("fixture-final-page");
  const title = (index) =>
    index === 0 ? "Fixture landscape" : `${index} ` + "Landscape".repeat(24);
  const cards = (render) =>
    Array.from({ length: empty ? 0 : 24 }, (_value, index) =>
      render(`${number}${String(index).padStart(2, "0")}`, title(index)),
    ).join("\n");
  if (url.origin === "https://www.bizhihui.com")
    return `<title>壁纸汇</title><ul id="item-lists" class="clear">${cards(
      (id, label) => {
        const source = sourceUrl(`https://www.bizhihui.com/p/${id}.html`);
        const original = imageUrl(
          `https://s.panlai.com/zb_users/upload/2026/10/bizhihui_com_${id}.jpg`,
        );
        const thumbnail = imageUrl(original + "-pcthumbs");
        imageUrl(original + "-arthumbs");
        return `<li class="item-list masonry-brick"><div class="item-content"><a class="item-img" href="${source}" title="${label}"><img src="${thumbnail}" alt="${label}" width="450" height="285"></a><div class="item-info2"><h3><a href="${source}"><p><span class="float-lt">1920 x 1200</span></p></a></h3></div></div></li>`;
      },
    )}</ul>`;
  if (
    url.origin === "https://www.wallcoo.com" &&
    url.pathname === "/wp-json/bc/v1/wallpapers"
  )
    return JSON.stringify({
      items: Array.from({ length: empty ? 0 : 24 }, (_value, index) => ({
        id: number + index,
        title: title(index),
        link: sourceUrl(
          `https://www.wallcoo.com/landscape/fixture-${serial}-${index}/`,
        ),
        url: imageUrl(
          `https://www.wallcoo.com/wp-content/uploads/wallcoo/2026/10/w5/thumb_th-${serial}-${index}.jpg`,
        ),
        largeUrl: imageUrl(
          `https://www.wallcoo.com/wp-content/uploads/wallcoo/2026/10/w5/preview_th-${serial}-${index}.webp`,
        ),
      })),
      pagination: {
        current_page: Number(url.searchParams.get("page") ?? 1),
        per_page: 24,
        total_pages: empty || finalPage ? 1 : 40,
        total_items: empty ? 0 : finalPage ? 24 : 960,
        has_more: !empty && !finalPage,
      },
    });
  if (url.origin === "https://wallpaperscraft.com")
    return `<title>WallpapersCraft</title><ul class="wallpapers__list">${cards(
      (id, label) => {
        const slug = `fixture_landscape_${id}`;
        const source = sourceUrl(
          `https://wallpaperscraft.com/download/${slug}/1920x1080`,
        );
        const thumbnail = imageUrl(
          `https://images.wallpaperscraft.com/image/single/${slug}_300x168.jpg`,
        );
        imageUrl(
          `https://images.wallpaperscraft.com/image/single/${slug}_1920x1080.jpg`,
        );
        return `<li class="wallpapers__item"><a class="wallpapers__link" href="${source}"><span class="wallpapers__canvas"><img class="wallpapers__image" src="${thumbnail}" alt="${label}"></span><span class="wallpapers__info">1920x1080</span><span class="wallpapers__info">${label}</span></a></li>`;
      },
    )}</ul>`;
  if (url.origin === "https://www.goodfon.com")
    return `<title>GoodFon</title><div class="wallpapers">${cards(
      (id, label) => {
        const slug = `fixture-landscape-${id}`;
        const source = sourceUrl(
          `https://www.goodfon.com/landscapes/wallpaper-${slug}.html`,
        );
        const thumbnail = imageUrl(
          `https://img.goodfon.com/wallpaper/big/c/9f/${slug}.webp`,
        );
        imageUrl(`https://img.goodfon.com/wallpaper/nbig/c/9f/${slug}.webp`);
        imageUrl(`https://img.goodfon.com/original/1920x1200/c/9f/${slug}.jpg`);
        return `<div class="wallpapers__item"><div class="wallpapers__item__wall" itemscope itemtype="http://schema.org/ImageObject"><a title="${label}" href="${source}" itemprop="url"><picture><img alt="${label}" class="wallpapers__item__img" height="380" itemprop="thumbnail" src="${thumbnail}" width="596"></picture></a><div class="wallpapers__item__bottom"><div class="wallpapers__item__size"><div><small>1920x1200</small></div></div></div></div></div>`;
      },
    )}</div>`;
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
  let largePreviewFailurePending = false;
  let lanAttachmentCancellationPending = false;
  let lanSaveCancellationPending = false;
  let nextLanAttachmentGate = null;
  let nextHttpGate = null;
  let nextWallpaperListGate = null;
  let nextWallpaperApplyGate = null;
  const wallpaperPreviewGates = [],
    imageFetchGates = [],
    imageReleaseGates = [];
  let seedNextGallery = 0,
    imageFetches = 0,
    imageFetchPeak = 0,
    localPreviews = 0,
    localPreviewPeak = 0,
    ownerResourcePeak = 0;
  function gate() {
    let complete;
    const boundary = {
      started: false,
      released: false,
      cancelled: false,
      wait: new Promise((resolve) => (complete = resolve)),
    };
    boundary.cancel = () => {
      boundary.cancelled = true;
      complete();
    };
    return {
      boundary,
      control: {
        started: () => boundary.started,
        released: () => boundary.released,
        cancelled: () => boundary.cancelled,
        release: () => {
          boundary.released = true;
          complete();
        },
      },
    };
  }
  function state(session, seedGallery = false) {
    if (!sessions.has(session)) {
      const galleryCount = seedNextGallery || (seedGallery ? 1 : 0);
      seedNextGallery = 0;
      sessions.set(session, {
        lan: {
          running: false,
          nickname: "Fixture device",
          nodeId: "a".repeat(32),
          port: 0,
          addresses: ["192.168.1.20"],
          discoveredPeers: [],
          discoveryError: null,
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
          items: Array.from({ length: galleryCount }, (_value, index) => ({
            id:
              index === 0
                ? "f".repeat(64)
                : index.toString(16).padStart(64, "0"),
            name:
              index === 0
                ? "Fixture local image"
                : `Fixture local image ${index + 1}`,
            dataUrl: null,
            previewKey:
              index === 0
                ? localPreviewKey
                : createHash("sha256")
                    .update(`${dataUrl}:${index}`)
                    .digest("hex"),
            active: false,
          })),
          limit: 24,
        },
        resources: new Map(),
        pendingDownloads: new Map(),
      });
    }
    return sessions.get(session);
  }
  async function http(input, effect) {
    const request = effect.request;
    const url = new URL(request.url);
    const granted = input.boundaryGrantedPermissions ?? [];
    if (
      effect.kind !== "http" ||
      ![
        "https://www.bizhihui.com",
        "https://www.wallcoo.com",
        "https://wallpaperscraft.com",
        "https://www.goodfon.com",
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
      request.headers.Accept !==
        (url.origin === "https://www.wallcoo.com"
          ? "application/json"
          : "text/html") ||
      request.headers["User-Agent"] !== wallpaperAgent
    )
      throw Error("Unsupported explicit HTTP effect boundary");
    const payload = providerPayload(url);
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
            body: payload,
          },
    };
    httpCalls.push({
      plugin: input.id,
      request: structuredClone(request),
      boundaryMock: true,
      receipt: structuredClone(receipt),
    });
    const held = nextHttpGate;
    nextHttpGate = null;
    if (held) {
      held.started = true;
      await held.wait;
    }
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
        case "transferStatus":
          result = { transfers: data.lanTransfers ?? [] };
          break;
        case "status":
          break;
        case "start":
          lan.running = true;
          lan.nickname = operation.nickname;
          lan.port = operation.port ?? 45873;
          lan.mode = operation.mode ?? "lan";
          lan.loopbackPeerId = null;
          lan.addresses = ["192.168.1.20"];
          lan.discoveredPeers = [
            {
              id: "b".repeat(32),
              nickname: "Fixture friend",
              address: "192.168.1.10",
              port: 45873,
              lastSeen: 1761400000000,
            },
          ];
          break;
        case "loopback":
          lan.running = true;
          lan.nickname = operation.nickname;
          lan.port = 41234;
          lan.mode = "loopback";
          lan.loopbackPeerId = "e".repeat(32);
          lan.addresses = ["127.0.0.1"];
          lan.discoveredPeers = [];
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
          data.lanTransfers = [];
          lan.running = false;
          lan.discoveredPeers = [];
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
        case "thumbnailAttachment":
        case "previewAttachment": {
          const message = lan.messages.find(
            (item) => item.id === operation.messageId,
          );
          if (!message?.attachment)
            return rejected("NOT_FOUND", "Boundary attachment is unavailable");
          result = {
            dataUrl:
              message.kind !== "image"
                ? null
                : operation.action === "thumbnailAttachment"
                  ? thumbnailDataUrl
                  : lanPreviewDataUrl,
          };
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
          data.lanTransfers = operation.peerId
            ? (data.lanTransfers ?? []).filter(
                (entry) => entry.peerId !== operation.peerId,
              )
            : [];
          lan.messages = operation.peerId
            ? lan.messages.filter(
                (message) => message.peerId !== operation.peerId,
              )
            : [];
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
        case "preview": {
          const item = library.items.find((entry) => entry.id === operation.id);
          if (!item || item.previewKey !== operation.previewKey)
            return rejected("NOT_FOUND", "Gallery preview is unavailable");
          if (localPreviews >= 1)
            return rejected(
              "EXTENSION_BUSY",
              "Gallery preview capacity is full",
            );
          localPreviewPeak = Math.max(localPreviewPeak, ++localPreviews);
          const result = { id: item.id, previewKey: item.previewKey, dataUrl };
          const held = wallpaperPreviewGates.shift();
          if (!held) {
            localPreviews--;
            return result;
          }
          held.started = true;
          return held.wait
            .then(() => result)
            .finally(() => {
              localPreviews--;
            });
        }
        case "list": {
          const held = nextWallpaperListGate;
          nextWallpaperListGate = null;
          if (held) {
            // Capture before waiting so a late read really predates later writes.
            const captured = held.fail
              ? rejected(
                  "EXTENSION_RUN_FAILED",
                  "Explicit offline gallery list boundary failure",
                )
              : { ...structuredClone(library), boundaryMock: true };
            held.started = true;
            return held.wait.then(() => captured);
          }
          result = library;
          break;
        }
        case "import-resource": {
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          const item = {
            id: "f".repeat(64),
            name: operation.name,
            dataUrl: null,
            previewKey: localPreviewKey,
            active: false,
          };
          if (!library.items.some((existing) => existing.id === item.id))
            library.items.push(item);
          library.revision++;
          result = { item, library };
          break;
        }
        case "apply": {
          library.items.forEach((item) => {
            item.active = item.id === operation.id;
          });
          library.revision++;
          const acknowledgement = {
            applied: true,
            activeId: operation.id,
            revision: library.revision,
          };
          const held = nextWallpaperApplyGate;
          nextWallpaperApplyGate = null;
          if (held) {
            // The compact acknowledgement follows the committed revision;
            // concurrent gallery reads remain independent of its delivery.
            held.started = true;
            return held.wait.then(() => acknowledgement);
          }
          return acknowledgement;
        }
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
          if (
            operation.preview !== undefined &&
            !["thumbnail", "large"].includes(operation.preview)
          )
            return rejected(
              "INVALID_ARGUMENT",
              "Unknown inline image preview size",
            );
          if (
            operation.requestId !== undefined &&
            !/^[a-zA-Z0-9_-]{1,80}$/.test(operation.requestId)
          )
            return rejected(
              "INVALID_ARGUMENT",
              "Invalid image request identity",
            );
          if (operation.preview === "large" && largePreviewFailurePending) {
            largePreviewFailurePending = false;
            return rejected(
              "EXTENSION_RUN_FAILED",
              "Explicit transient large preview boundary failure",
            );
          }
          if (imageFetches >= 3)
            return rejected(
              "EXTENSION_BUSY",
              "Image download capacity is full",
            );
          imageFetchPeak = Math.max(imageFetchPeak, ++imageFetches);
          const metadata = {
            resourceId: (++resourceSerial).toString(16).padStart(48, "0"),
            mime: "image/png",
            bytes: 1024,
            width: 1920,
            height: 1200,
            sha256: "e".repeat(64),
            ...(operation.preview
              ? {
                  dataUrl:
                    operation.preview === "large"
                      ? largePreviewDataUrl
                      : thumbnailDataUrl,
                }
              : {}),
          };
          const index = imageFetchGates.findIndex(
              (entry) => entry.preview === operation.preview,
            ),
            held =
              index < 0 ? null : imageFetchGates.splice(index, 1)[0].boundary;
          const finish = () => {
            if (held?.cancelled)
              return rejected("USER_CANCELLED", "Image request cancelled");
            if (data.resources.size >= 8)
              return rejected(
                "EXTENSION_BUSY",
                "Owner image handle capacity is full",
              );
            data.resources.set(metadata.resourceId, {
              plugin: input.id,
              metadata,
            });
            ownerResourcePeak = Math.max(
              ownerResourcePeak,
              data.resources.size,
            );
            return { ...metadata, boundaryMock: true };
          };
          const complete = () => {
            imageFetches--;
            if (
              operation.requestId &&
              data.pendingDownloads.get(operation.requestId) === held
            )
              data.pendingDownloads.delete(operation.requestId);
          };
          if (!held) {
            complete();
            return finish();
          }
          held.started = true;
          if (operation.requestId)
            data.pendingDownloads.set(operation.requestId, held);
          return held.wait.then(finish).finally(complete);
        }
        case "cancel-fetch": {
          const held = data.pendingDownloads.get(operation.requestId);
          held?.cancel();
          return { cancelled: Boolean(held) };
        }
        case "preview":
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          if (
            operation.size !== undefined &&
            !["thumbnail", "large"].includes(operation.size)
          )
            return rejected("INVALID_ARGUMENT", "Unknown preview size");
          if (operation.size === "large" && largePreviewFailurePending) {
            largePreviewFailurePending = false;
            return rejected(
              "EXTENSION_RUN_FAILED",
              "Explicit transient large preview boundary failure",
            );
          }
          result = {
            dataUrl:
              operation.size === "large"
                ? largePreviewDataUrl
                : thumbnailDataUrl,
          };
          break;
        case "save":
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          result = { cancelled: true };
          break;
        case "release": {
          if (!resource())
            return rejected("NOT_FOUND", "Image resource is unavailable");
          data.resources.delete(operation.resourceId);
          const held = imageReleaseGates.shift();
          if (!held) return null;
          held.started = true;
          return held.wait.then(() => null);
        }
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
    seedNextWallpaperGallery: (count = 1) => {
      seedNextGallery = count;
    },
    holdNextWallpaperPreview: () => {
      const held = gate();
      wallpaperPreviewGates.push(held.boundary);
      return held.control;
    },
    holdNextImageFetch: (preview) => {
      const held = gate();
      imageFetchGates.push({ preview, boundary: held.boundary });
      return held.control;
    },
    holdNextImageRelease: () => {
      const held = gate();
      imageReleaseGates.push(held.boundary);
      return held.control;
    },
    imageConcurrency: () => ({
      downloads: imageFetches,
      downloadPeak: imageFetchPeak,
      localPreviews,
      localPreviewPeak,
      ownerResourcePeak,
    }),
    holdNextHttp: () => {
      if (nextHttpGate) throw Error("An HTTP boundary gate is already armed");
      const held = gate();
      nextHttpGate = held.boundary;
      return held.control;
    },
    holdNextWallpaperList: ({ fail = false } = {}) => {
      if (nextWallpaperListGate)
        throw Error("A wallpaper list boundary gate is already armed");
      const held = gate();
      held.boundary.fail = fail;
      nextWallpaperListGate = held.boundary;
      return held.control;
    },
    holdNextWallpaperApply: () => {
      if (nextWallpaperApplyGate)
        throw Error("A wallpaper apply boundary gate is already armed");
      const held = gate();
      nextWallpaperApplyGate = held.boundary;
      return held.control;
    },
    failNextHttp: () => {
      httpFailurePending = true;
    },
    failNextLargePreview: () => {
      largePreviewFailurePending = true;
    },
    cancelNextLanAttachment: () => {
      lanAttachmentCancellationPending = true;
    },
    cancelNextLanSave: () => {
      lanSaveCancellationPending = true;
    },
    setLanTransfers: (entries) => {
      for (const session of sessions.values())
        session.lanTransfers = structuredClone(entries);
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
