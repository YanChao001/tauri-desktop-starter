import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { githubRequest } from "./hosting/github-api.mjs";
import { runAction as runGitHubAction } from "./hosting/github-actions.mjs";

const repositoryConfig = JSON.parse(
  readFileSync(
    new URL("./test-fixtures/repository-github.json", import.meta.url),
    "utf8",
  ),
);
const runAction = (mode, options) =>
  runGitHubAction(mode, { config: repositoryConfig, ...options });

test("the API adapter uses its configured base and sends structured request bodies", () => {
  const config = structuredClone(repositoryConfig);
  config.hosting.apiBaseUrl = "https://forge.example/api/v3";
  const result = githubRequest(
    ["repos/owner/app/releases/42", "--method", "PATCH"],
    { draft: false },
    {
      config,
      run(binary, args, options) {
        assert.equal(binary, "gh");
        assert.deepEqual(args, [
          "api",
          "https://forge.example/api/v3/repos/owner/app/releases/42",
          "--method",
          "PATCH",
          "--input",
          "-",
        ]);
        assert.equal(options.input, '{"draft":false}');
        return '{"id":42}';
      },
    },
  );
  assert.deepEqual(result, { id: 42 });
  config.hosting.provider = "unimplemented";
  assert.throws(() =>
    githubRequest(["repos/owner/app/releases"], undefined, {
      config,
      run: () => assert.fail("unsupported adapters must not invoke gh"),
    }),
  );
});

test("unsigned artifact selection considers all pages and writes only the unambiguous current artifact", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "starter-github-outputs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "output");
  const env = {
    GITHUB_REPOSITORY: "owner/app",
    GITHUB_RUN_ID: "19",
    GITHUB_OUTPUT: output,
  };
  runAction("unsigned-artifact", {
    env,
    request(args) {
      assert.deepEqual(args, [
        "repos/owner/app/actions/runs/19/artifacts?per_page=100",
        "--paginate",
        "--slurp",
      ]);
      return [
        { artifacts: [{ id: 1, name: "unsigned-nsis", expired: true }] },
        { artifacts: [{ id: 42, name: "unsigned-nsis", expired: false }] },
      ];
    },
  });
  assert.equal(readFileSync(output, "utf8"), "artifact-id=42\n");
  assert.throws(() =>
    runAction("unsigned-artifact", {
      env,
      request: () => [
        {
          artifacts: [
            { id: 42, name: "unsigned-nsis" },
            { id: 43, name: "unsigned-nsis" },
          ],
        },
      ],
    }),
  );
  assert.equal(readFileSync(output, "utf8"), "artifact-id=42\n");
});

test("publication uses the prepared release ID and rejects malformed IDs before contacting the API", () => {
  runAction("publish-release", {
    env: { GITHUB_REPOSITORY: "owner/app", RELEASE_ID: "42" },
    request(args, body) {
      assert.deepEqual(args, [
        "repos/owner/app/releases/42",
        "--method",
        "PATCH",
      ]);
      assert.deepEqual(body, { draft: false, make_latest: "legacy" });
    },
  });
  assert.throws(() =>
    runAction("publish-release", {
      env: { GITHUB_REPOSITORY: "owner/app", RELEASE_ID: "42/other" },
      request: () =>
        assert.fail("invalid release IDs must stop before the request"),
    }),
  );
});
