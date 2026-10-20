import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  collectUpdaterMetadata,
  mergeUpdaterMetadata,
  releaseAssetName,
  updaterReleasePlan,
} from "./release-lib.mjs";

const repository = "owner/starter";
const version = "1.2.3";
const brand = {
  updates: {
    endpoint: `https://github.com/${repository}/releases/latest/download/latest.json`,
    publicKey: "public-key",
  },
};

test("updater release requires a complete key pair, matching repository and compatible signing order", () => {
  assert.deepEqual(
    updaterReleasePlan({ brand: { updates: { publicKey: "" } } }),
    { enabled: false },
  );
  for (const input of [
    { brand },
    { brand: { updates: { publicKey: "" } }, privateKey: "private" },
    { brand, privateKey: "private", repository, signPath: "configured" },
    { brand, privateKey: "private", repository: "other/repo" },
  ])
    assert.throws(() => updaterReleasePlan(input));
  const plan = updaterReleasePlan({ brand, privateKey: "private", repository });
  assert.equal(plan.overlay.bundle.createUpdaterArtifacts, true);
  assert.equal(plan.overlay.plugins.updater.requireSignedVersion, true);
  assert.equal(JSON.stringify(plan).includes("private"), false);
});

test("release asset names match tauri-action v1 including versioned macOS archives", () => {
  const common = {
    productName: "Tauri Desktop Starter",
    version,
    target: "aarch64-apple-darwin",
  };
  assert.equal(
    releaseAssetName("/bundle/macos/Tauri Desktop Starter.app.tar.gz", common),
    "Tauri.Desktop.Starter_1.2.3_aarch64.app.tar.gz",
  );
  assert.equal(
    releaseAssetName("/bundle/macos/Tauri Desktop Starter.app.tar.gz.sig", {
      ...common,
      target: "x86_64-apple-darwin",
    }),
    "Tauri.Desktop.Starter_1.2.3_x64.app.tar.gz.sig",
  );
  assert.equal(
    releaseAssetName(
      "C:\\bundle\\nsis\\Tauri Desktop Starter_1.2.3_x64-setup.exe",
      common,
    ),
    "Tauri.Desktop.Starter_1.2.3_x64-setup.exe",
  );
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return (path) => {
    const file = join(root, "bundle", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "signed artifact");
    writeFileSync(`${file}.sig`, "signed-version-signature\n");
    return [file, `${file}.sig`];
  };
}

test("only explicit current artifact paths are used and Windows defaults to NSIS while preserving MSI", (t) => {
  const make = fixture(t);
  const msi = make("msi/Starter_1.2.3_x64_en-US.msi");
  const nsis = make("nsis/Starter_1.2.3_x64-setup.exe");
  make("msi/stale_0.9.0_x64_en-US.msi");
  const result = collectUpdaterMetadata({
    paths: [...msi, ...nsis],
    target: "x86_64-pc-windows-msvc",
    repository,
    version,
    productName: "Starter",
  });
  assert.equal(result.verification.length, 2);
  assert.equal(Object.keys(result.metadata.platforms).length, 3);
  assert.equal(
    result.metadata.platforms["windows-x86_64"].url.endsWith("setup.exe"),
    true,
  );
  assert.equal(
    result.metadata.platforms["windows-x86_64-msi"].signature,
    "signed-version-signature",
  );
  assert.equal(JSON.stringify(result).includes("stale"), false);
  assert.throws(
    () =>
      collectUpdaterMetadata({
        paths: [nsis[0]],
        target: "x86_64-pc-windows-msvc",
        repository,
        version,
      }),
    /缺少更新签名/,
  );
  assert.throws(
    () =>
      collectUpdaterMetadata({
        paths: [nsis[1]],
        target: "x86_64-pc-windows-msvc",
        repository,
        version,
      }),
    /缺少对应更新包/,
  );
});

test("a single manifest requires all four targets and rejects stale, duplicate or redirected metadata", (t) => {
  const make = fixture(t);
  const inputs = [
    ["x86_64-pc-windows-msvc", "nsis/Starter_1.2.3_x64-setup.exe"],
    ["aarch64-apple-darwin", "macos/Starter.app.tar.gz"],
    ["x86_64-apple-darwin", "macos/Starter.app.tar.gz"],
    ["x86_64-unknown-linux-gnu", "appimage/Starter_1.2.3_amd64.AppImage"],
  ];
  const records = inputs.map(
    ([target, path]) =>
      collectUpdaterMetadata({
        paths: make(path),
        target,
        repository,
        version,
        productName: "Starter",
      }).metadata,
  );
  const manifest = mergeUpdaterMetadata(records, {
    repository,
    version,
    now: new Date("2026-01-02T00:00:00Z"),
  });
  assert.equal(manifest.pub_date, "2026-01-02T00:00:00.000Z");
  assert.equal(Object.keys(manifest.platforms).length, 8);
  assert.throws(
    () => mergeUpdaterMetadata(records.slice(1), { repository, version }),
    /四个/,
  );
  assert.throws(
    () =>
      mergeUpdaterMetadata([records[0], ...records.slice(0, 3)], {
        repository,
        version,
      }),
    /重复/,
  );
  const stale = structuredClone(records);
  stale[0].version = "1.2.2";
  assert.throws(
    () => mergeUpdaterMetadata(stale, { repository, version }),
    /不一致/,
  );
  const redirected = structuredClone(records);
  redirected[0].platforms["windows-x86_64"].url =
    "https://attacker.example/install.exe";
  assert.throws(
    () => mergeUpdaterMetadata(redirected, { repository, version }),
    /URL/,
  );
});

test("Linux update metadata preserves deb/rpm installer types and uses AppImage for the generic target", (t) => {
  const make = fixture(t);
  const paths = [
    ...make("deb/Starter_1.2.3_amd64.deb"),
    ...make("rpm/Starter_1.2.3_x86_64.rpm"),
    ...make("appimage/Starter_1.2.3_amd64.AppImage"),
  ];
  const { metadata, verification } = collectUpdaterMetadata({
    paths,
    target: "x86_64-unknown-linux-gnu",
    repository,
    version,
    productName: "Starter",
  });
  assert.equal(verification.length, 3);
  assert.equal(Object.keys(metadata.platforms).length, 4);
  assert.ok(metadata.platforms["linux-x86_64"].url.endsWith(".AppImage"));
  assert.ok(metadata.platforms["linux-x86_64-deb"].url.endsWith(".deb"));
  assert.ok(metadata.platforms["linux-x86_64-rpm"].url.endsWith(".rpm"));
});
