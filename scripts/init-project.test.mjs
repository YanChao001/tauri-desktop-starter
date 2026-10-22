import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  applyInitialization,
  initializationDiff,
  prepareInitialization,
  validateAppConfig,
} from "./init-lib.mjs";
import { checkVersions } from "./version.mjs";

const config = {
  schemaVersion: 1,
  name: "Starter",
  shortName: "Start",
  packageName: "old-app",
  identifier: "com.example.starter",
  description: "An app",
  author: "Example",
  repositoryUrl: "https://github.com/example/app",
  docsUrl: "https://example.com/docs",
  defaultMode: "demo",
  updates: { endpoint: "", publicKey: "" },
};

// 与 src-tauri/src/update_signature.rs 共用公开测试样本，不保存私钥。
const PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDExMjgyNEJFMDZDREQ3QjAKUldTdzE4MEd2aVFvRVJNSlV1SVZldmFLWHlhMjdWSW9Sb3Rkdm10WklRYmFLbUtnWmhwcmJXSUMK";

test("a derived identity does not inherit the template's update signing trust", (t) => {
  for (const patch of [
    { identifier: "com.example.new-app" },
    { repositoryUrl: "https://github.com/example/derived" },
  ]) {
    const { root } = fixture(t);
    writeFileSync(
      join(root, "app.config.json"),
      JSON.stringify({
        ...config,
        updates: {
          endpoint: "https://example.com/latest.json",
          publicKey: PUBLIC_KEY,
        },
      }),
    );
    applyInitialization(prepareInitialization(root, patch));
    assert.equal(
      JSON.parse(readFileSync(join(root, "app.config.json"), "utf8")).updates
        .publicKey,
      "",
    );
  }
});

test("an explicitly supplied update public key is preserved during derivation", (t) => {
  const { root } = fixture(t);
  applyInitialization(
    prepareInitialization(root, {
      identifier: "com.example.new-app",
      updates: {
        endpoint: "https://example.com/latest.json",
        publicKey: PUBLIC_KEY,
      },
    }),
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "app.config.json"), "utf8")).updates
      .publicKey,
    PUBLIC_KEY,
  );
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-init-test-"));
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    assert.match(root, /starter-init-test-/);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "src-tauri", "src"), { recursive: true });
  mkdirSync(join(root, "src-tauri", "src", "bin"));
  const files = {
    "app.config.json": JSON.stringify(config),
    "package.json": JSON.stringify({
      name: "old-app",
      version: "0.1.0",
      scripts: { build: "vite build" },
    }),
    "src-tauri/tauri.conf.json": JSON.stringify({
      productName: "Starter",
      identifier: config.identifier,
      version: "0.1.0",
      app: { windows: [{ label: "main", title: "Starter" }] },
      bundle: { active: false },
      plugins: { updater: { pubkey: "keep-me" } },
    }),
    "src-tauri/tauri.macos.conf.json": JSON.stringify({
      app: {
        windows: [{ label: "main", title: "Starter", decorations: true }],
      },
    }),
    "src-tauri/tauri.e2e.conf.json": JSON.stringify({
      identifier: `${config.identifier}.e2e`,
    }),
    "src-tauri/Cargo.toml":
      '[package]\nname = "old-app"\ndefault-run = "old-app"\nversion = "0.1.0"\ndescription = "An app"\nauthors = ["Example"]\n\n[lib]\nname = "old_app_lib"\ncrate-type = ["rlib"]\n\n[dependencies]\nserde = "1"\n',
    "src-tauri/Cargo.lock":
      'version = 4\n\n[[package]]\nname = "old-app"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
    "src-tauri/src/main.rs":
      "fn main() { old_app_lib::run() }\n// old-app is a historical example\n",
    "src-tauri/src/bin/export-bindings.rs":
      "fn main() { old_app_lib::bindings::export() }\n",
    "src-tauri/src/bin/verify-updater.rs":
      "fn main() { old_app_lib::update_signature::verify_manifest() }\n",
    "index.html": "<html><head><title>Starter</title></head></html>\n",
  };
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(root, path), content);
  return { root, files };
}

test("dry-run plans consistent identities without writing or changing version/signing", (t) => {
  const { root, files } = fixture(t);
  const plan = prepareInitialization(
    root,
    {
      name: "Acme & Desk",
      packageName: "acme-desk",
      description: 'A "quoted" description with \\ paths',
      identifier: "io.acme.desk",
    },
    { minimal: true },
  );
  assert.match(initializationDiff(plan), /--- a\/app.config.json/);
  for (const [path, content] of Object.entries(files))
    assert.equal(readFileSync(join(root, path), "utf8"), content);
  applyInitialization(plan);
  const read = (path) => readFileSync(join(root, path), "utf8");
  assert.equal(JSON.parse(read("app.config.json")).defaultMode, "minimal");
  assert.match(read("src-tauri/src/main.rs"), /acme_desk_lib::run\(\)/);
  assert.match(read("src-tauri/Cargo.toml"), /default-run = "acme-desk"/);
  assert.match(
    read("src-tauri/src/bin/export-bindings.rs"),
    /acme_desk_lib::bindings::export\(\)/,
  );
  assert.match(
    read("src-tauri/src/bin/verify-updater.rs"),
    /acme_desk_lib::update_signature::verify_manifest\(\)/,
  );
  assert.match(
    read("src-tauri/src/main.rs"),
    /old-app is a historical example/,
  );
  assert.equal(
    JSON.parse(read("src-tauri/tauri.conf.json")).plugins.updater.pubkey,
    "keep-me",
  );
  assert.equal(
    JSON.parse(read("src-tauri/tauri.e2e.conf.json")).identifier,
    "io.acme.desk.e2e",
  );
  assert.match(read("index.html"), /Acme &amp; Desk/);
  assert.equal(checkVersions(root), "0.1.0");
  assert.equal(prepareInitialization(root).changes.length, 0);
});

test("all files are validated before writes and unknown fields are rejected", (t) => {
  const { root, files } = fixture(t);
  assert.throws(
    () => prepareInitialization(root, { privateKey: "secret" }),
    /未知品牌/,
  );
  assert.throws(
    () => prepareInitialization(root, { packageName: "../escape" }),
    /packageName/,
  );
  assert.throws(
    () => prepareInitialization(root, { docsUrl: "javascript:alert(1)" }),
    /HTTPS/,
  );
  writeFileSync(join(root, "index.html"), "invalid");
  assert.throws(() => prepareInitialization(root, { name: "Acme" }), /title/);
  assert.equal(
    readFileSync(join(root, "app.config.json"), "utf8"),
    files["app.config.json"],
  );
});

test("failed commit rolls every file back and removes temporary files", (t) => {
  const { root, files } = fixture(t);
  const plan = prepareInitialization(root, { packageName: "renamed" });
  assert.throws(
    () =>
      applyInitialization(plan, {
        beforeCommit(index) {
          if (index === 3) throw new Error("simulated write failure");
        },
      }),
    /simulated/,
  );
  for (const [path, content] of Object.entries(files))
    assert.equal(readFileSync(join(root, path), "utf8"), content);
  for (const path of [
    root,
    join(root, "src-tauri"),
    join(root, "src-tauri", "src"),
  ])
    assert.ok(readdirSync(path).every((name) => !name.startsWith(".update-")));
});

test("unrelated TOML syntax errors abort initialization before any write", (t) => {
  const { root, files } = fixture(t);
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    files["src-tauri/Cargo.toml"] + "broken = [\n",
  );
  assert.throws(
    () => prepareInitialization(root, { name: "Acme" }),
    /TOML|Invalid|Unexpected/,
  );
  assert.equal(
    readFileSync(join(root, "app.config.json"), "utf8"),
    files["app.config.json"],
  );
});

test("rollback preserves concurrent edits and the original backup on conflict", (t) => {
  const { root, files } = fixture(t);
  const plan = prepareInitialization(root, { name: "Changed" });
  assert.throws(
    () =>
      applyInitialization(plan, {
        beforeCommit(index) {
          if (index === 1)
            writeFileSync(
              join(root, "app.config.json"),
              "concurrent user edit",
            );
          if (index === 2) throw new Error("simulated commit failure");
        },
      }),
    /恢复失败.*备份保留/,
  );
  assert.equal(
    readFileSync(join(root, "app.config.json"), "utf8"),
    "concurrent user edit",
  );
  const backups = readdirSync(root).filter((name) => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(
    readFileSync(join(root, backups[0]), "utf8"),
    files["app.config.json"],
  );
  assert.equal(
    readFileSync(join(root, "package.json"), "utf8"),
    files["package.json"],
  );
});

test("concurrent modification is detected before committing and never overwritten", (t) => {
  const { root, files } = fixture(t);
  const plan = prepareInitialization(root, { name: "Changed" });
  writeFileSync(join(root, "index.html"), "concurrent edit");
  assert.throws(() => applyInitialization(plan), /预检后被修改/);
  assert.equal(
    readFileSync(join(root, "index.html"), "utf8"),
    "concurrent edit",
  );
  assert.equal(
    readFileSync(join(root, "app.config.json"), "utf8"),
    files["app.config.json"],
  );
});

test("configuration rejects credentials, private keys and incomplete data", () => {
  assert.throws(
    () => validateAppConfig({ ...config, docsUrl: ["https://example.com"] }),
    /URL 文本/,
  );
  assert.throws(
    () => validateAppConfig({ ...config, name: "Acme/Desk" }),
    /Windows/,
  );
  assert.throws(
    () => validateAppConfig({ ...config, packageName: undefined }),
    /packageName/,
  );
  assert.throws(
    () =>
      validateAppConfig({
        ...config,
        repositoryUrl: "https://token@example.com",
      }),
    /无凭据/,
  );
  assert.throws(
    () =>
      validateAppConfig({
        ...config,
        updates: { endpoint: "", publicKey: "-----BEGIN PRIVATE KEY-----" },
      }),
    /私钥/,
  );
  assert.throws(() => validateAppConfig({ ...config, name: "" }), /name/);
});

test("updater public keys validate the Tauri envelope and minisign packet", () => {
  const [comment, encodedPacket] = Buffer.from(PUBLIC_KEY, "base64")
    .toString("utf8")
    .trimEnd()
    .split("\n");
  const packet = Buffer.from(encodedPacket, "base64");
  const encode = (text) => Buffer.from(text).toString("base64");
  const envelope = (bytes, header = comment) =>
    encode(`${header}\n${bytes.toString("base64")}\n`);
  const alternate = Buffer.from(packet);
  alternate[1] = 0x44;
  for (const publicKey of [
    "",
    PUBLIC_KEY,
    encode(`${comment}\r\n${encodedPacket}\r\n`),
    envelope(alternate),
  ]) {
    assert.doesNotThrow(() =>
      validateAppConfig({ ...config, updates: { endpoint: "", publicKey } }),
    );
  }
  // 此数据包为刻意构造的无效样本，不含生成的私钥材料。
  const fakeSecret = Buffer.concat([Buffer.from("Ed"), Buffer.alloc(156)]);
  for (const publicKey of [
    undefined,
    null,
    123,
    " ",
    "invalid key",
    "a".repeat(8193),
    "-----BEGIN PRIVATE KEY-----",
    envelope(fakeSecret, "untrusted comment: minisign encrypted secret key"),
    envelope(fakeSecret),
    `${PUBLIC_KEY}==`,
    `${PUBLIC_KEY}\n`,
    `${PUBLIC_KEY}\0`,
    Buffer.from([0xff]).toString("base64"),
    Buffer.from(PUBLIC_KEY, "base64").toString("utf8"),
    encode(`${comment}\n${encodedPacket}\nextra line`),
    encode(`${comment}\0\n${encodedPacket}\n`),
    encode(`${comment}\n${encodedPacket.slice(0, -1)}!\n`),
    encode(`${comment}\n${encodedPacket}\0\n`),
    envelope(packet.subarray(0, 41)),
    envelope(Buffer.concat([packet, Buffer.alloc(1)])),
    envelope(Buffer.alloc(42)),
  ]) {
    assert.throws(
      () =>
        validateAppConfig({ ...config, updates: { endpoint: "", publicKey } }),
      /updates.publicKey.*公钥.*私钥/,
    );
  }
});

test("an encoded secret-key-shaped value aborts initialization before any write", (t) => {
  const { root, files } = fixture(t);
  const fakeSecret = Buffer.from(
    `untrusted comment: minisign encrypted secret key\n${Buffer.alloc(158).toString("base64")}\n`,
  ).toString("base64");
  assert.throws(
    () => prepareInitialization(root, { updates: { publicKey: fakeSecret } }),
    /updates.publicKey.*公钥.*私钥/,
  );
  for (const [path, content] of Object.entries(files))
    assert.equal(readFileSync(join(root, path), "utf8"), content);
});

test("directory junctions cannot redirect initialization outside the project", (t) => {
  const { root } = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "starter-init-outside-"));
  t.after(() => {
    assert.equal(dirname(outside), tmpdir());
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(join(outside, "src"));
  writeFileSync(
    join(outside, "Cargo.toml"),
    readFileSync(join(root, "src-tauri", "Cargo.toml")),
  );
  rmSync(join(root, "src-tauri"), { recursive: true });
  symlinkSync(
    outside,
    join(root, "src-tauri"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => prepareInitialization(root), /ENOENT|项目外/);
});
