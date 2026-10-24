import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  collectUpdaterMetadata,
  ensureDraftRelease,
  mergeUpdaterMetadata,
  releaseAssetName,
  resolveReleaseAssets,
  updaterReleasePlan,
  uploadReleaseAsset,
} from "./release-lib.mjs";

const repository = "owner/starter";
const version = "1.2.3";
const brand = {
  updates: {
    endpoint: `https://github.com/${repository}/releases/latest/download/latest.json`,
    publicKey: "public-key",
  },
};

test("one draft is created before builds and its ID is reused on reruns", () => {
  const options = {
    version: "1.2.3-beta.1+build",
    repository,
    commit: "abc123",
  };
  const requests = [];
  let draft;
  const request = (args, body) => {
    requests.push(args);
    if (args[0].includes("/commits/")) return [[]];
    if (args[0].endsWith("/generate-notes")) return { body: "首发" };
    if (!body) return [draft ? [draft] : []];
    assert.equal(body.target_commitish, options.commit);
    assert.equal(body.draft, true);
    assert.equal(body.prerelease, true);
    draft = { id: 42, ...body };
    return draft;
  };
  assert.equal(ensureDraftRelease(options, request), 42);
  draft.body = "人工补充的实际验收限制";
  assert.equal(ensureDraftRelease(options, request), 42);
  assert.equal(draft.body, "人工补充的实际验收限制");
  assert.equal(requests.filter((args) => args.includes("POST")).length, 2);
});

test("duplicate, published or mismatched-source releases stop before builds or uploads", () => {
  const draft = {
    id: 42,
    tag_name: `v${version}`,
    draft: true,
    target_commitish: "abc123",
  };
  for (const releases of [
    [draft, { ...draft, id: 43 }],
    [{ ...draft, draft: false }],
    [{ ...draft, target_commitish: "other-commit" }],
  ]) {
    const requests = [];
    assert.throws(() =>
      ensureDraftRelease({ version, repository, commit: "abc123" }, (args) => {
        requests.push(args);
        return [releases];
      }),
    );
    assert.equal(requests.length, 1);
  }
});

test("replacement assets upload by release ID even when the tag has other drafts", () => {
  const requests = [];
  uploadReleaseAsset(
    "/metadata/latest.json",
    { id: 42, assets: [{ id: 81, name: "latest.json" }] },
    repository,
    (args) => requests.push(args),
  );
  assert.deepEqual(requests[0], [
    `repos/${repository}/releases/assets/81`,
    "--method",
    "DELETE",
  ]);
  assert.equal(
    requests[1][0],
    `https://uploads.github.com/repos/${repository}/releases/42/assets?name=latest.json`,
  );
  assert.equal(requests[1].at(-1), "/metadata/latest.json");
});

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

test("requested upload names preserve spaces and include the macOS version and architecture", () => {
  const common = {
    productName: "Tauri Desktop Starter",
    version,
    target: "aarch64-apple-darwin",
  };
  assert.equal(
    releaseAssetName("/bundle/macos/Tauri Desktop Starter.app.tar.gz", common),
    "Tauri Desktop Starter_1.2.3_aarch64.app.tar.gz",
  );
  assert.equal(
    releaseAssetName("/bundle/macos/Tauri Desktop Starter.app.tar.gz.sig", {
      ...common,
      target: "x86_64-apple-darwin",
    }),
    "Tauri Desktop Starter_1.2.3_x64.app.tar.gz.sig",
  );
  assert.equal(
    releaseAssetName(
      "C:\\bundle\\nsis\\Tauri Desktop Starter_1.2.3_x64-setup.exe",
      common,
    ),
    "Tauri Desktop Starter_1.2.3_x64-setup.exe",
  );
});

function draftRelease() {
  const prefix = `https://github.com/${repository}/releases/download/v${version}/`;
  const app = "Tauri Desktop Starter_1.2.3_aarch64.app.tar.gz";
  const setup = "Tauri Desktop Starter_1.2.3_x64-setup.exe";
  const files = [
    [app, app],
    [setup, setup.replaceAll(" ", ".")],
  ];
  return {
    manifest: {
      version,
      platforms: Object.fromEntries(
        ["darwin-aarch64", "windows-x86_64"].map((key, index) => [
          key,
          {
            signature: `verified-signature-${index}`,
            url: `${prefix}${encodeURIComponent(files[index][0])}`,
          },
        ]),
      ),
    },
    release: {
      draft: true,
      tag_name: `v${version}`,
      assets: files.flatMap(([label, name]) =>
        ["", ".sig"].map((extension) => ({
          name: name + extension,
          label: label + extension,
          // 草稿 API 的真实返回形态：临时 tag，部分名称保留空格。
          url: `https://github.com/${repository}/releases/download/untagged-temporary/${encodeURIComponent(name + extension)}`,
          state: "uploaded",
          size: 100,
        })),
      ),
    },
    prefix,
  };
}

test("draft assets resolve by upload label or name into published URLs without guessing sanitization", () => {
  const { manifest, release, prefix } = draftRelease();
  release.assets[0].label = ""; // 名称本身匹配时不要求上传标签。
  const resolved = resolveReleaseAssets(manifest, release, {
    version,
    repository,
  });
  assert.equal(
    resolved.platforms["darwin-aarch64"].url,
    prefix + "Tauri%20Desktop%20Starter_1.2.3_aarch64.app.tar.gz",
  );
  assert.equal(
    resolved.platforms["windows-x86_64"].url,
    prefix + "Tauri.Desktop.Starter_1.2.3_x64-setup.exe",
  );
  assert.equal(
    resolved.platforms["windows-x86_64"].signature,
    "verified-signature-1",
  );
  assert.equal(JSON.stringify(resolved).includes("untagged-"), false);
  assert.match(manifest.platforms["windows-x86_64"].url, /%20/);
});

test("manifest publication rejects missing signatures, unfinished or ambiguous assets and the wrong release", () => {
  const invalid = [
    (release) => {
      release.assets.splice(1, 1);
    },
    (release) => {
      release.assets[0].state = "new";
    },
    (release) => {
      release.assets[0].size = 0;
    },
    (release) => {
      release.assets.push({ ...release.assets[0] });
    },
    (release) => {
      release.draft = false;
    },
    (release) => {
      release.tag_name = "v1.2.2";
    },
  ];
  for (const change of invalid) {
    const { manifest, release } = draftRelease();
    change(release);
    assert.throws(
      () => resolveReleaseAssets(manifest, release, { version, repository }),
      /缺少|重名|未就绪|draft/,
    );
  }
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
    notes: "  ## Improvements\n\nReal release notes.  ",
  });
  assert.equal(manifest.pub_date, "2026-01-02T00:00:00.000Z");
  assert.equal(manifest.notes, "## Improvements\n\nReal release notes.");
  assert.ok(
    mergeUpdaterMetadata(records, {
      repository,
      version,
      notes: "x".repeat(9000),
    }).notes.length <= 8000,
  );
  assert.equal(
    mergeUpdaterMetadata(records, { repository, version, notes: "  " }).notes,
    `Release v${version}`,
  );
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
