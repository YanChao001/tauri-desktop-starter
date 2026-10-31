import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
// 固定测试密钥，仅用于测试夹具。绝不能用于任何真实市场或发布签名。
const seed = createHash("sha256")
  .update("extension-market-fixtures-only-never-production-v2")
  .digest();
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]),
  format: "der",
  type: "pkcs8",
});
const raw = createPublicKey(key)
  .export({ format: "der", type: "spki" })
  .subarray(-32);
const keyId = createHash("sha256").update(raw).digest().subarray(0, 8);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = {
  formatVersion: 3,
  apiVersion: 2,
  minHostVersion: "0.1.4",
  id: "market.registry-fixture",
  version: "1.0.0",
  name: "市场校验夹具",
  author: "Tauri Desktop Starter",
  description: "仅用于离线验签和市场安装校验的测试扩展。",
  icon: "puzzle",
  commands: [
    {
      id: "echo",
      title: "回显",
      function: "echo",
      inputFormat: "text",
      resultFormat: "text",
      permissions: ["text:read"],
    },
    {
      id: "repeat",
      title: "重复",
      function: "repeat",
      inputFormat: "text",
      resultFormat: "text",
      permissions: ["text:read"],
    },
  ],
  permissions: ["text:read"],
  optionalPermissions: [],
  network: [],
};
// 仅包含两个正确签名的导出；fixture 不执行插件业务逻辑。
const section = (id, data) => Buffer.from([id, data.length, ...data]);
const exportName = (name, index) => [
  name.length,
  ...Buffer.from(name),
  0,
  index,
];
const wasm = Buffer.concat([
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  section(1, [1, 0x60, 0, 1, 0x7f]),
  section(3, [2, 0, 0]),
  section(7, [2, ...exportName("echo", 0), ...exportName("repeat", 1)]),
  section(10, [2, 4, 0, 0x41, 0, 0x0b, 4, 0, 0x41, 0, 0x0b]),
]);
new WebAssembly.Module(wasm);
const pkg = Buffer.from(
  JSON.stringify({ manifest, wasm: wasm.toString("base64") }, null, 2) + "\n",
);
const catalog = {
  schemaVersion: 2,
  revision: 1,
  repository: "YanChao001/tauri-desktop-starter-extensions",
  issuedAt: 1800000000,
  expiresAt: 1800003600,
  entries: [
    {
      package: { manifest, sha256: hash(wasm), bytes: wasm.length },
      category: "text",
      featured: true,
      releaseTag: "market-1",
      asset: "market.registry-fixture-1.0.0.starter-extension.json",
      packageSha256: hash(pkg),
      packageBytes: pkg.length,
    },
  ],
};
function signedEnvelope(catalog) {
  const payload = Buffer.from(
    typeof catalog === "string" ? catalog : JSON.stringify(catalog),
  );
  const signature = sign(
    null,
    createHash("blake2b512").update(payload).digest(),
    key,
  );
  const trusted = "market revision:1";
  const global = sign(
    null,
    Buffer.concat([signature, Buffer.from(trusted)]),
    key,
  );
  return {
    payload: payload.toString("base64"),
    signature: [
      "untrusted comment: TEST ONLY extension market fixture",
      Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64"),
      "trusted comment: " + trusted,
      global.toString("base64"),
      "",
    ].join("\n"),
  };
}
const root = import.meta.dirname;
writeFileSync(join(root, "package.json"), pkg);
// 历史 / 未来协议故意不满足当前 DTO，以验证版本诊断发生在验签后、
// 完整反序列化之前；此处所有签名仍只使用上面的固定测试密钥。
const { issuedAt: _issuedAt, expiresAt: _expiresAt, ...legacy } = catalog;
function futureEntry(futureManifest) {
  const content = Buffer.from(
    JSON.stringify(
      { manifest: futureManifest, wasm: wasm.toString("base64") },
      null,
      2,
    ) + "\n",
  );
  return {
    ...catalog.entries[0],
    package: {
      manifest: futureManifest,
      sha256: hash(wasm),
      bytes: wasm.length,
    },
    category: "tools",
    featured: false,
    asset: `${futureManifest.id}-${futureManifest.version}.starter-extension.json`,
    packageSha256: hash(content),
    packageBytes: content.length,
  };
}
const futureManifest = {
  ...structuredClone(manifest),
  id: "market.future-tools",
  name: "未来工具",
  minHostVersion: "65535.0.0",
  permissions: ["text:read", "future:capability"],
};
const knownFuture = {
  ...structuredClone(manifest),
  id: "market.next-tools",
  name: "新版工具",
  minHostVersion: "65535.0.0",
};
const mixed = {
  ...catalog,
  entries: [
    catalog.entries[0],
    futureEntry(futureManifest),
    futureEntry(knownFuture),
  ],
};
const changed = {
  ...mixed,
  entries: [
    catalog.entries[0],
    futureEntry({
      ...futureManifest,
      description: "Changed future-only metadata",
    }),
    futureEntry(knownFuture),
  ],
};
const duplicate = JSON.stringify(mixed).replace(
  '"minHostVersion":"65535.0.0"',
  '"minHostVersion":"0.1.4","minHostVersion":"65535.0.0"',
);
for (const [filename, value] of [
  ["catalog.json", catalog],
  ["catalog-schema-1.json", { ...legacy, schemaVersion: 1 }],
  ["catalog-schema-99.json", { schemaVersion: 99, futureFormat: true }],
  ["catalog-mixed-future.json", mixed],
  ["catalog-mixed-future-changed.json", changed],
  ["catalog-mixed-future-duplicate.json", duplicate],
]) {
  writeFileSync(
    join(root, filename),
    JSON.stringify(signedEnvelope(value), null, 2) + "\n",
  );
}
writeFileSync(
  join(root, "public-key.txt"),
  Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64") + "\n",
);
