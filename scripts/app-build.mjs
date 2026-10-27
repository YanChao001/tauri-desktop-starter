#!/usr/bin/env node
import { resolve } from "node:path";
import { publishArtifacts } from "./artifact-lib.mjs";
import {
  buildApplication,
  bundleApplication,
  prepareBuild,
} from "./build-lib.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(`Usage: pnpm app:build [--optimize speed|size] [--target <triple>] [--bundles nsis,msi] [--config <JSON>] [--features <features>]
Defaults to size for smaller binaries; use speed for faster compilation. Both use release builds.
Also supports --ci, --no-sign, --skip-stapling, --no-binary-patching, and -v / --verbose.
--no-bundle builds the application without archiving installers. For advanced options, use pnpm tauri build.`);
} else {
  try {
    const root = resolve(import.meta.dirname, "..");
    const plan = prepareBuild(root, args);
    const built = await buildApplication(plan);
    if (plan.noBundle) {
      console.log(`\nApplication built: ${built.executable}`);
    } else {
      const outputDir = await bundleApplication(plan, built, (entries) =>
        publishArtifacts(root, {
          version: plan.version,
          target: built.target,
          kind: "installers",
          entries,
        }),
      );
      console.log(`\nInstallers archived: ${outputDir}`);
    }
  } catch (error) {
    console.error(
      `Application build failed${error.code ? ` [${error.code}]` : ""}: ${error.message}`,
    );
    if (["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
      console.error(
        "Close installers, preview windows, or terminals using the distribution directory, check write permissions, and try again.",
      );
    }
    process.exitCode = error.exitCode ?? 1;
  }
}
