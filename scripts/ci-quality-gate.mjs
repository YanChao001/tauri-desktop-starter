import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function qualityGateFailures(needs) {
  const docsOnly = needs.changes?.outputs?.docs_only === "true";
  const rustRequired = needs.changes?.outputs?.rust_required !== "false";
  const sdkRequired = needs.changes?.outputs?.sdk_required !== "false";
  const reused = /^[1-9]\d*$/.test(needs.changes?.outputs?.reused_run ?? "");
  const allowedSkips = new Set([
    ...(reused ? ["frontend"] : []),
    ...(reused || docsOnly ? ["browser-smoke", "desktop-e2e"] : []),
    ...(reused || !rustRequired ? ["rust", "bindings"] : []),
    ...(reused || !sdkRequired ? ["extension-sdk"] : []),
  ]);
  return [
    "changes",
    "frontend",
    "browser-smoke",
    "rust",
    "bindings",
    "extension-sdk",
    "desktop-e2e",
  ]
    .filter((job) => {
      const result = needs[job]?.result;
      return (
        result !== "success" && !(result === "skipped" && allowedSkips.has(job))
      );
    })
    .map(
      (job) =>
        `Required check ${job} did not pass: ${needs[job]?.result ?? "missing"}`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const failures = qualityGateFailures(JSON.parse(process.env.CI_NEEDS));
  if (failures.length) {
    failures.forEach((failure) => console.error(failure));
    process.exitCode = 1;
  } else {
    console.log(
      "All required checks passed; skipped jobs match the change scope.",
    );
  }
}
