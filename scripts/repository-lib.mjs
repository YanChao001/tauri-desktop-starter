import { readFileSync } from "node:fs";
import { formatRepositoryLink } from "../src/config/repository-links.mjs";

export const repositoryConfig = JSON.parse(
  readFileSync(new URL("../repository.config.json", import.meta.url), "utf8"),
);

export function repositoryUrl(repository, config = repositoryConfig) {
  return formatRepositoryLink(config.hosting.repositoryUrlTemplate, "", {
    repository,
  });
}

export function repositoryLink(
  kind,
  repository,
  parameters = {},
  config = repositoryConfig,
) {
  return formatRepositoryLink(
    config.hosting.links[kind],
    repositoryUrl(repository, config),
    parameters,
  );
}

/** 发布元数据中资产必须恰好符合本次仓库、tag 与配置模板。 */
export function releaseAssetFromUrl(
  url,
  repository,
  tag,
  config = repositoryConfig,
) {
  const marker = "__repository_asset__";
  const sample = repositoryLink(
    "releaseAsset",
    repository,
    { tag, asset: marker },
    config,
  );
  const [prefix, suffix] = sample.split(marker);
  if (suffix === undefined || !url.startsWith(prefix) || !url.endsWith(suffix))
    throw new Error(
      "Update asset URL does not match the configured repository and tag",
    );
  const encoded = url.slice(prefix.length, suffix ? -suffix.length : undefined);
  const asset = decodeURIComponent(encoded);
  if (
    !asset ||
    /[/\\]/.test(asset) ||
    [...asset].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    asset === "." ||
    asset === ".." ||
    repositoryLink("releaseAsset", repository, { tag, asset }, config) !== url
  )
    throw new Error("Update asset URL contains an invalid asset name");
  return asset;
}

export function validateRepositoryConfig(config) {
  if (config?.schemaVersion !== 1 || !config.hosting || !config.marketplace)
    throw new Error("Invalid repository.config.json schema");
  const hosting = config.hosting;
  const fields = (value, allowed, label) => {
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        throw new Error(`Unknown ${label} field: ${key}`);
  };
  fields(
    config,
    ["schemaVersion", "hosting", "marketplace"],
    "repository configuration",
  );
  fields(
    hosting,
    [
      "provider",
      "repositoryUrlTemplate",
      "defaultBranch",
      "releaseBranch",
      "links",
      "apiBaseUrl",
      "uploadBaseUrl",
    ],
    "hosting",
  );
  for (const key of ["defaultBranch", "releaseBranch", "provider"])
    if (
      typeof hosting[key] !== "string" ||
      !hosting[key].trim() ||
      /[\r\n]/.test(hosting[key])
    )
      throw new Error(`Invalid hosting.${key}`);
  for (const key of ["defaultBranch", "releaseBranch"])
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(hosting[key]) ||
      hosting[key].includes("..")
    )
      throw new Error(`Invalid hosting.${key} branch name`);
  const required = {
    file: ["ref", "path"],
    commit: ["ref"],
    commits: ["ref"],
    compare: ["base", "ref"],
    releases: [],
    release: ["tag"],
    releaseAsset: ["tag", "asset"],
    latestAsset: ["asset"],
  };
  const values = {
    ref: "main",
    path: "docs/README.md",
    base: "v1",
    tag: "v2",
    asset: "app.bin",
  };
  fields(hosting.links ?? {}, Object.keys(required), "hosting.links");
  for (const [kind, keys] of Object.entries(required)) {
    const template = hosting.links?.[kind];
    if (
      typeof template !== "string" ||
      keys.some((key) => !template.includes(`{${key}}`))
    )
      throw new Error(`Invalid hosting.links.${kind}`);
    repositoryLink(kind, "example/app", values, config);
  }
  for (const key of ["apiBaseUrl", "uploadBaseUrl"])
    formatRepositoryLink(hosting[key], "");
  const source = repositoryUrl("example/market", config);
  const marketValues = { ...values, repository: "example/market" };
  const market = config.marketplace;
  fields(
    market,
    [
      "gitUrl",
      "catalogUrlTemplate",
      "packageUrlTemplate",
      "downloadUrlPrefixes",
    ],
    "marketplace",
  );
  formatRepositoryLink(market.catalogUrlTemplate, source, marketValues);
  if (
    !["tag", "asset"].every((key) =>
      market.packageUrlTemplate?.includes(`{${key}}`),
    )
  )
    throw new Error("Market package URL requires tag and asset placeholders");
  formatRepositoryLink(market.packageUrlTemplate, source, marketValues);
  if (
    !Array.isArray(market.downloadUrlPrefixes) ||
    !market.downloadUrlPrefixes.length ||
    market.downloadUrlPrefixes.length > 16
  )
    throw new Error("Market download URL prefixes are required");
  for (const template of market.downloadUrlPrefixes) {
    const value = formatRepositoryLink(template, source, marketValues);
    const url = new URL(value);
    if (
      !value.endsWith("/") ||
      url.search ||
      url.hash ||
      (url.port && url.port !== "443")
    )
      throw new Error(
        "Market download prefixes require an HTTPS directory URL",
      );
  }
  if (
    typeof market.gitUrl !== "string" ||
    !market.gitUrl.trim() ||
    /[\r\n]/.test(market.gitUrl)
  )
    throw new Error("Invalid marketplace.gitUrl");
  return config;
}
