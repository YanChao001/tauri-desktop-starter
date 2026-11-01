import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runScope } from "./hosting/github-ci-scope.mjs";

export { classifyChanges, detectChanges } from "./hosting/github-ci-scope.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runScope();
