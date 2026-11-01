import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { releaseAssetFromUrl } from "./repository-lib.mjs";

const repositoryConfig = JSON.parse(
  readFileSync(
    new URL("./test-fixtures/repository-github.json", import.meta.url),
    "utf8",
  ),
);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "starter-repository-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(
      join(root, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const app = {
    repositoryUrl: "https://github.com/example/app",
    docsUrl: "https://github.com/example/app/blob/develop/docs/README.md",
    homepageUrl: "https://example.github.io/app/",
  };
  const config = structuredClone(repositoryConfig);
  config.marketplace.gitUrl = "https://github.com/example/market.git";
  write("app.config.json", app);
  write("repository.config.json", config);
  write("repository.generated.json", { schemaVersion: 1, app, config });
  write(
    "README.md",
    "[Docs](https://github.com/example/app/blob/develop/docs/README.md) [Releases](https://github.com/example/app/releases) [Upstream](https://github.com/other/upstream)\n",
  );
  write(
    ".gitmodules",
    '[submodule "marketplace"]\n\tpath = marketplace\n\turl = https://github.com/example/market.git\n',
  );
  write(
    ".github/workflows/ci.yml",
    "on:\n  push:\n    branches: [develop, main]\n  pull_request:\n    branches: [develop, main]\n",
  );
  return { root, write, app, config };
}

function run(root, mode) {
  return spawnSync(
    process.execPath,
    [
      new URL("./repository-config.mjs", import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
      mode,
      "--root",
      root,
    ],
    { encoding: "utf8", windowsHide: true },
  );
}

test("one sync updates managed links, branches and submodule and then becomes idempotent", (t) => {
  const { root, write, app, config } = fixture(t);
  config.hosting.defaultBranch = "integration";
  config.hosting.links.releases = "{repositoryUrl}/-/releases";
  config.marketplace.gitUrl = "https://code.example/acme/market.git";
  app.repositoryUrl = "https://code.example/acme/desk";
  app.docsUrl = "https://docs.example/desk";
  app.homepageUrl = "https://desk.example/";
  write("app.config.json", app);
  write("repository.config.json", config);
  assert.notEqual(run(root, "check").status, 0);
  const result = run(root, "sync");
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(join(root, "README.md"), "utf8"),
    /https:\/\/docs\.example\/desk/,
  );
  assert.match(
    readFileSync(join(root, "README.md"), "utf8"),
    /https:\/\/code\.example\/acme\/desk\/-\/releases/,
  );
  assert.match(
    readFileSync(join(root, "README.md"), "utf8"),
    /https:\/\/github\.com\/other\/upstream/,
  );
  assert.match(
    readFileSync(join(root, ".gitmodules"), "utf8"),
    /https:\/\/code\.example\/acme\/market\.git/,
  );
  assert.match(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
    /branches: \[integration, main\]/,
  );
  assert.equal(run(root, "check").status, 0);
  const second = run(root, "sync");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already synchronized/i);
});

test("unknown templates stop synchronization before changing a managed file", (t) => {
  const { root, write, config } = fixture(t);
  const before = readFileSync(join(root, "README.md"), "utf8");
  config.hosting.links.file = "{repositoryUrl}/{unknown}/{ref}/{path}";
  write("repository.config.json", config);
  const result = run(root, "sync");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /placeholder/);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), before);
});

test("release asset parsing rejects control characters rather than publishing their encoded names", () => {
  assert.throws(() =>
    releaseAssetFromUrl(
      "https://github.com/owner/app/releases/download/v1/a%00.exe",
      "owner/app",
      "v1",
      repositoryConfig,
    ),
  );
});

test("a removed workflow branch filter is reported rather than silently left unmanaged", (t) => {
  const { root, write } = fixture(t);
  write(".github/workflows/ci.yml", "on:\n  push: {}\n  pull_request: {}\n");
  const result = run(root, "check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /branch/i);
});

test("the root command also synchronizes and checks an initialized marketplace", (t) => {
  const { root, write } = fixture(t);
  write(
    "marketplace/scripts/repository-config.mjs",
    `
    import { existsSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    const marker=join(import.meta.dirname,"../synchronized");
    if (process.argv[2] === "sync") writeFileSync(marker,"ready");
    else if (!existsSync(marker)) { console.error("market configuration drift"); process.exitCode=1; }
  `,
  );
  assert.notEqual(run(root, "check").status, 0);
  const result = run(root, "sync");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(root, "marketplace/synchronized"), "utf8"),
    "ready",
  );
  assert.equal(run(root, "check").status, 0);
});

for (const [name, path, content] of [
  [
    "Pages branch list structure drift",
    ".github/workflows/pages.yml",
    "on:\n  push:\n    branches:\n      - stale-branch\njobs:\n  deploy:\n    if: github.ref == 'refs/heads/develop'\n",
  ],
  [
    "Pages condition structure drift",
    ".github/workflows/pages.yml",
    "on:\n  push:\n    branches: [develop]\njobs:\n  deploy:\n    if: ${{ github.ref == 'refs/heads/stale-branch' }}\n",
  ],
  [
    "Dependabot missing target branch",
    ".github/dependabot.yml",
    "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n",
  ],
]) {
  test(`${name} fails the managed configuration check`, (t) => {
    const { root, write } = fixture(t);
    write(path, content);
    const result = run(root, "check");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /branch|condition/i);
  });
}

test("a missing marketplace URL never rewrites a following third-party submodule", (t) => {
  const { root, write } = fixture(t);
  const content =
    '[submodule "marketplace"]\n\tpath = marketplace\n[submodule "vendor-tool"]\n\tpath = vendor\n\turl = https://vendor.example/third-party.git\n';
  write(".gitmodules", content);
  const result = run(root, "sync");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /marketplace.*URL|submodule.*URL/i);
  assert.equal(readFileSync(join(root, ".gitmodules"), "utf8"), content);
});

test("market transport templates accept the repository placeholder consistently with the native client", (t) => {
  const { root, write, config } = fixture(t);
  config.marketplace.catalogUrlTemplate =
    "https://downloads.example/market/{repository}/catalog.json";
  config.marketplace.packageUrlTemplate =
    "https://downloads.example/market/{repository}/{tag}/{asset}";
  config.marketplace.downloadUrlPrefixes = [
    "https://downloads.example/market/{repository}/",
  ];
  write("repository.config.json", config);
  const result = run(root, "sync");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run(root, "check").status, 0);
});
