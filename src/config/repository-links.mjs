const variables = new Set([
  "repositoryUrl",
  "repository",
  "ref",
  "path",
  "base",
  "tag",
  "asset",
]);

function encodePath(value) {
  const index = value.indexOf("#");
  const path = index === -1 ? value : value.slice(0, index);
  const fragment = index === -1 ? "" : value.slice(index);
  return path.split("/").map(encodeURIComponent).join("/") + fragment;
}

/** 前端与构建脚本共用显式模板，不探测或猜测托管平台。 */
export function formatRepositoryLink(template, repositoryUrl, parameters = {}) {
  if (typeof template !== "string" || !template)
    throw new Error("A repository URL template is required");
  const values = {
    ...parameters,
    repositoryUrl: repositoryUrl.replace(/\/+$/, "").replace(/\.git$/, ""),
  };
  const value = template.replace(/\{([^{}]+)\}/g, (_, key) => {
    if (!variables.has(key) || typeof values[key] !== "string")
      throw new Error(`Unknown or missing repository URL placeholder: ${key}`);
    if (key === "repositoryUrl") return values[key];
    if (key === "path" || key === "repository") return encodePath(values[key]);
    return encodeURIComponent(values[key]);
  });
  if (/[{}\r\n]/.test(value))
    throw new Error("Invalid repository URL template");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Repository links require HTTPS without credentials");
  return value;
}
