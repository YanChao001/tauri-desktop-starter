// Browser-only boundary substitutes. These do not exercise TCP, network, dialogs or native storage.
const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=";
const remote = {
  pageId: 123,
  title: "Fixture landscape",
  author: "Fixture author",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  sourceUrl: "https://commons.wikimedia.org/?curid=123",
  width: 1200,
  height: 800,
  bytes: 10000,
};
export function createBoundaryServices() {
  const sessions = new Map();
  const calls = [];
  function state(session) {
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
        wallpaper: { revision: 0, items: [], limit: 24 },
      });
    return sessions.get(session);
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
    const data = state(input.fixtureSession),
      operation = input.request;
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
        case "search":
          result = { source: "wikimedia-commons", items: [remote] };
          break;
        case "preview":
          result = { image: remote, dataUrl };
          break;
        case "import-remote": {
          const item = {
            id: "f".repeat(64),
            name: remote.title,
            dataUrl,
            active: false,
          };
          if (!library.items.some((existing) => existing.id === item.id))
            library.items.push(item);
          library.revision++;
          result = { item, source: remote, library };
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
        case "download-original":
          result = { cancelled: true };
          break;
        case "open-source":
        case "open-settings":
          result = { opened: true };
          break;
        default:
          throw Error("Unsupported explicit wallpaper boundary operation");
      }
    } else throw Error("Unknown service fixture");
    return { ...structuredClone(result), boundaryMock: true };
  }
  return { request, calls };
}
