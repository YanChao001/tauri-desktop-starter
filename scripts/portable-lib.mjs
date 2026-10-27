import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  existsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileSha256 } from "./artifact-lib.mjs";

export function portableFileName(value) {
  if (
    typeof value !== "string" ||
    !value ||
    /[<>:"/\\|?*]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(value) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  ) {
    throw new Error(`Invalid Windows executable filename: ${value}`);
  }
  return `${value}.exe`;
}

function receiptPath(plan) {
  return join(plan.metadata.target_directory, ".starter-portable.json");
}

function fingerprint(plan) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        config: plan.config,
        buildArgs: plan.buildArgs,
        optimize: plan.optimize,
      }),
    )
    .digest("hex");
}

export function recordPortableBuild(plan, built) {
  const receipt = {
    root: realpathSync(plan.root),
    version: plan.version,
    fingerprint: fingerprint(plan),
    target: built.target,
    executable: realpathSync(built.executable),
    sha256: fileSha256(built.executable),
  };
  const file = receiptPath(plan);
  const temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** --skip-build 仅复用本项目相同版本和配置且未被打包器改写的便携编译。 */
export function loadPortableBuild(plan) {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath(plan), "utf8"));
    const executable = realpathSync(receipt.executable);
    const offset = relative(
      realpathSync(plan.metadata.target_directory),
      executable,
    );
    if (
      !offset ||
      offset === ".." ||
      offset.startsWith(`..${sep}`) ||
      isAbsolute(offset) ||
      receipt.root !== realpathSync(plan.root) ||
      receipt.version !== plan.version ||
      receipt.fingerprint !== fingerprint(plan) ||
      receipt.sha256 !== fileSha256(executable)
    ) {
      throw new Error("The version, configuration, or executable has changed");
    }
    return {
      executable,
      outputDir: dirname(executable),
      target: receipt.target,
    };
  } catch (error) {
    throw new Error(
      `Cannot skip the build: ${error.message}. Run pnpm app:portable first.`,
      { cause: error },
    );
  }
}
