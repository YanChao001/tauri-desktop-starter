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
  id: "market.text-tools",
  version: "1.0.0",
  name: "文本工具箱",
  author: "Tauri Desktop Starter",
  description: "仅用于离线验签和市场安装校验的测试扩展。",
  icon: "puzzle",
  commands: [
    {
      id: "uppercase",
      title: "转为大写",
      function: "uppercase",
      inputFormat: "text",
      resultFormat: "text",
      permissions: ["text:read"],
    },
    {
      id: "lowercase",
      title: "转为小写",
      function: "lowercase",
      inputFormat: "text",
      resultFormat: "text",
      permissions: ["text:read"],
    },
  ],
  permissions: ["text:read"],
  optionalPermissions: [],
  network: [],
};
// 仅包含两个正确签名的导出；fixture 从不执行转换逻辑。
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
  section(7, [2, ...exportName("uppercase", 0), ...exportName("lowercase", 1)]),
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
      asset: "market.text-tools-1.0.0.starter-extension.json",
      packageSha256: hash(pkg),
      packageBytes: pkg.length,
    },
  ],
};
const payload = Buffer.from(JSON.stringify(catalog));
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
const envelope = {
  payload: payload.toString("base64"),
  signature: [
    "untrusted comment: TEST ONLY extension market fixture",
    Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64"),
    "trusted comment: " + trusted,
    global.toString("base64"),
    "",
  ].join("\n"),
};
const root = import.meta.dirname;
writeFileSync(join(root, "package.json"), pkg);
writeFileSync(
  join(root, "catalog.json"),
  JSON.stringify(envelope, null, 2) + "\n",
);
writeFileSync(
  join(root, "public-key.txt"),
  Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64") + "\n",
);
