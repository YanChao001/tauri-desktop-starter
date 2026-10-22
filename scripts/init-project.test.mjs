import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
  homepageUrl: "https://example.com",
  browserStorageNamespace: "starter",
  integration: { deepLinkScheme: "old-app", fileExtension: "old-app" },
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
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "app.config.json"), "utf8")).updates,
      { endpoint: "", publicKey: "" },
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
  mkdirSync(join(root, ".signpath"));
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
    "README.md":
      "# Starter\n\n[主页](https://example.com) · [文档](https://example.com/docs) · [发行记录](https://github.com/example/app/releases)\n",
    "README.en.md":
      "# Starter\n\n[Releases](https://github.com/example/app/releases)\n",
    ".signpath/artifact-configuration.xml":
      '<pe-file product-name="Starter" />\n',
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
  assert.match(read("README.md"), /^# Acme & Desk/);
  assert.match(
    read(".signpath/artifact-configuration.xml"),
    /product-name="Acme &amp; Desk"/,
  );
  const brand = JSON.parse(read("app.config.json"));
  assert.equal(brand.browserStorageNamespace, "io.acme.desk");
  assert.deepEqual(brand.integration, {
    deepLinkScheme: "acme-desk",
    fileExtension: "acme-desk",
  });
  const native = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.deepEqual(native.plugins["deep-link"].desktop.schemes, ["acme-desk"]);
  assert.equal(
    native.bundle.fileAssociations[0].mimeType,
    "application/x-acme-desk",
  );
  assert.equal(checkVersions(root), "0.1.0");
  assert.equal(prepareInitialization(root).changes.length, 0);
});

test("repository derivation drops inherited links and updater endpoint unless explicitly supplied", (t) => {
  const { root } = fixture(t);
  const plan = prepareInitialization(root, {
    repositoryUrl: "https://github.com/acme/desk",
  });
  assert.equal(plan.config.docsUrl, "https://github.com/acme/desk");
  assert.equal(plan.config.homepageUrl, "https://github.com/acme/desk");
  assert.equal(plan.config.updates.endpoint, "");
  applyInitialization(plan);
  assert.match(
    readFileSync(join(root, "README.md"), "utf8"),
    /https:\/\/github.com\/acme\/desk\/releases/,
  );
  assert.doesNotMatch(
    readFileSync(join(root, "README.md"), "utf8"),
    /https:\/\/example.com/,
  );
  const explicit = prepareInitialization(root, {
    repositoryUrl: "https://github.com/acme/new-desk",
    homepageUrl: "https://acme.example/",
    docsUrl: "https://acme.example/help",
  });
  assert.equal(explicit.config.homepageUrl, "https://acme.example/");
  assert.equal(explicit.config.docsUrl, "https://acme.example/help");
});

test("brand names keep dollar replacement sequences literal in generated text", (t) => {
  const { root, files } = fixture(t);
  const name = "Price $$ $& $` $' Desk";
  applyInitialization(prepareInitialization(root, { name }));
  const read = (path) => readFileSync(join(root, path), "utf8");
  for (const path of ["README.md", "README.en.md"])
    assert.equal(
      read(path),
      `# ${name}${files[path].slice("# Starter".length)}`,
    );
  assert.equal(
    read("index.html"),
    "<html><head><title>Price $$ $&amp; $` $' Desk</title></head></html>\n",
  );
  assert.equal(
    read(".signpath/artifact-configuration.xml"),
    '<pe-file product-name="Price $$ $&amp; $` $\' Desk" />\n',
  );
  assert.equal(prepareInitialization(root).changes.length, 0);
});

test("identity-only derivation isolates browser data and system registrations", (t) => {
  const { root } = fixture(t);
  const plan = prepareInitialization(root, { identifier: "io.acme.desk" });
  assert.equal(plan.config.browserStorageNamespace, "io.acme.desk");
  assert.deepEqual(plan.config.integration, {
    deepLinkScheme: "io-acme-desk",
    fileExtension: "io-acme-desk",
  });
  const explicit = prepareInitialization(root, {
    identifier: "io.acme.desk",
    browserStorageNamespace: "existing-product",
    integration: { deepLinkScheme: "acme", fileExtension: "acme-doc" },
  });
  assert.equal(explicit.config.browserStorageNamespace, "existing-product");
  assert.deepEqual(explicit.config.integration, {
    deepLinkScheme: "acme",
    fileExtension: "acme-doc",
  });
});

test("changing an updater endpoint requires explicitly re-establishing signing trust", (t) => {
  const { root } = fixture(t);
  writeFileSync(
    join(root, "app.config.json"),
    JSON.stringify({
      ...config,
      updates: {
        endpoint: "https://example.com/old.json",
        publicKey: PUBLIC_KEY,
      },
    }),
  );
  const plan = prepareInitialization(root, {
    updates: { endpoint: "https://example.com/new.json" },
  });
  assert.equal(plan.config.updates.publicKey, "");
  assert.equal(plan.config.updates.endpoint, "https://example.com/new.json");
});

test("configuration synchronization detects drift and preserves the original copyright year", (t) => {
  const { root } = fixture(t);
  applyInitialization(prepareInitialization(root));
  const path = join(root, "src-tauri/tauri.conf.json");
  const native = JSON.parse(readFileSync(path, "utf8"));
  native.bundle.copyright = "© 2020 Example";
  native.plugins["deep-link"].desktop.schemes = [];
  writeFileSync(path, JSON.stringify(native));
  const plan = prepareInitialization(root);
  const fixed = JSON.parse(
    plan.changes.find((change) => change.path === "src-tauri/tauri.conf.json")
      .content,
  );
  assert.equal(fixed.bundle.copyright, "© 2020 Example");
  assert.deepEqual(fixed.plugins["deep-link"].desktop.schemes, ["old-app"]);
  applyInitialization(plan);
  assert.equal(prepareInitialization(root).changes.length, 0);
});

test("invalid or conflicting integration names fail before changing files", (t) => {
  const { root, files } = fixture(t);
  for (const patch of [
    { integration: null },
    { integration: { unknown: "x" } },
    { integration: { deepLinkScheme: "https" } },
    { integration: { deepLinkScheme: "MixedCase" } },
    { integration: { fileExtension: "../escape" } },
    { integration: { fileExtension: "json" } },
    { browserStorageNamespace: "shared:key" },
    { homepageUrl: "http://example.com" },
    { packageName: "con" },
    { packageName: "com1" },
  ])
    assert.throws(() => prepareInitialization(root, patch));
  for (const [path, content] of Object.entries(files))
    assert.equal(readFileSync(join(root, path), "utf8"), content);
});

test("derivation preserves extra registrations and updates inherited platform identities", (t) => {
  const { root } = fixture(t);
  const path = join(root, "src-tauri/tauri.macos.conf.json");
  writeFileSync(
    path,
    JSON.stringify({
      productName: config.name,
      identifier: config.identifier,
      plugins: {
        "deep-link": {
          desktop: {
            schemes: ["old-app", "extra-protocol"],
            name: "Extra metadata",
          },
        },
      },
      bundle: {
        fileAssociations: [
          { ext: ["unrelated"], name: "Unrelated format" },
          { ext: ["old-app", "existing-doc"], role: "Editor" },
        ],
      },
    }),
  );
  applyInitialization(
    prepareInitialization(root, {
      name: "Acme",
      identifier: "io.acme.desk",
      packageName: "acme-desk",
    }),
  );
  const native = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(native.productName, "Acme");
  assert.equal(native.identifier, "io.acme.desk");
  assert.deepEqual(native.plugins["deep-link"].desktop, {
    schemes: ["acme-desk", "extra-protocol"],
    name: "Extra metadata",
  });
  assert.deepEqual(native.bundle.fileAssociations[0], {
    ext: ["unrelated"],
    name: "Unrelated format",
  });
  assert.deepEqual(native.bundle.fileAssociations[1].ext, [
    "acme-desk",
    "existing-doc",
  ]);
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
