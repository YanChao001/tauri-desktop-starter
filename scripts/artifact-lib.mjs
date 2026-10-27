import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { removeProjectPath } from "./fs-utils.mjs";

const RETRY_DELAYS = [100, 200, 400, 600];
const TRANSIENT_ERRORS = new Set(["EACCES", "EPERM", "EBUSY"]);

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Windows 扫描器可能短暂阻止目录改名；有限重试同一个原子操作，每次重新校验路径。 */
export function renameWithRetry(
  source,
  destination,
  {
    validate,
    platform = process.platform,
    rename = renameSync,
    delay = wait,
  } = {},
) {
  if (typeof validate !== "function")
    throw new Error("Directory renames require path validation");
  for (let attempt = 0; ; attempt += 1) {
    validate(source, destination);
    try {
      return rename(source, destination);
    } catch (error) {
      if (
        platform !== "win32" ||
        !TRANSIENT_ERRORS.has(error.code) ||
        attempt === RETRY_DELAYS.length
      )
        throw error;
      delay(RETRY_DELAYS[attempt]);
    }
  }
}

export function fileSha256(path) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  const descriptor = openSync(path, "r");
  try {
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, count));
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function segment(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(value)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function contained(root, path) {
  const offset = relative(root, path);
  return (
    offset === "" ||
    (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
  );
}

/** 发布目录始终留在仓库内，且不通过 junction / symlink 写入其他目录。 */
function publicationPath(root, path) {
  const base = realpathSync(root);
  const target = resolve(base, path);
  if (target === base || !contained(base, target))
    throw new Error("Publication path is outside the project directory");
  let current = target;
  while (current !== base) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error(
          `Publication path cannot contain directory links: ${current}`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    current = dirname(current);
  }
  return target;
}

export function artifactDirectory(root, version, target, kind) {
  if (!["installers", "portable"].includes(kind))
    throw new Error(`Unknown artifact kind: ${kind}`);
  return publicationPath(
    root,
    join(
      "artifacts",
      segment(version, "version"),
      segment(target, "target platform"),
      kind,
    ),
  );
}

/** 先复制完整结果，再替换同版本 / 平台 / 类型，保留其他产物与原有成功结果。 */
export function publishArtifacts(root, { version, target, kind, entries }) {
  const outputDir = artifactDirectory(root, version, target, kind);
  if (!entries.length)
    throw new Error("No distribution files to archive for this build");
  const names = new Set();
  const sources = entries.map(({ source, path: entryPath, contents }) => {
    const path =
      typeof entryPath === "string"
        ? entryPath.replaceAll("\\", "/")
        : entryPath;
    if (
      typeof path !== "string" ||
      !path ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(`Invalid distribution file path: ${path}`);
    }
    const key = path.toLowerCase();
    if (
      key === "manifest.json" ||
      [...names].some(
        (name) =>
          name === key ||
          name.startsWith(`${key}/`) ||
          key.startsWith(`${name}/`),
      )
    )
      throw new Error(`Duplicate distribution file path: ${path}`);
    names.add(key);
    if (contents !== undefined) {
      if (typeof contents !== "string" || source !== undefined)
        throw new Error(`Invalid distribution text contents: ${path}`);
      return { path, contents, directory: false };
    }
    const absolute = realpathSync(source);
    if (contained(outputDir, absolute))
      throw new Error(
        "The existing publication directory cannot be used as a build source",
      );
    const stat = lstatSync(absolute);
    if (stat.isDirectory() && contained(absolute, outputDir))
      throw new Error(
        "Build source directory cannot contain the publication directory",
      );
    if (!stat.isFile() && !stat.isDirectory())
      throw new Error(`Unsupported distribution file: ${source}`);
    return { source: absolute, path, directory: stat.isDirectory() };
  });

  const parent = dirname(outputDir);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, `.${kind}-`));
  const backup = join(parent, `.${kind}-previous-${randomUUID()}`);
  const renamePublication = (source, destination) =>
    renameWithRetry(source, destination, {
      validate: () => {
        publicationPath(root, source);
        publicationPath(root, destination);
        if (dirname(source) !== parent || dirname(destination) !== parent)
          throw new Error(
            "Publication directories can only be replaced within the same parent directory",
          );
      },
    });
  try {
    const files = sources.map(({ source, path, directory, contents }) => {
      const destination = join(staging, path);
      mkdirSync(dirname(destination), { recursive: true });
      if (contents !== undefined) writeFileSync(destination, contents, "utf8");
      else
        cpSync(source, destination, {
          recursive: directory,
          verbatimSymlinks: true,
        });
      return directory
        ? { path: path.replaceAll("\\", "/"), type: "directory" }
        : {
            path: path.replaceAll("\\", "/"),
            sha256: fileSha256(destination),
          };
    });
    writeFileSync(
      join(staging, "manifest.json"),
      `${JSON.stringify({ version, target, kind, createdAt: new Date().toISOString(), files }, null, 2)}\n`,
    );
    if (existsSync(outputDir)) renamePublication(outputDir, backup);
    try {
      renamePublication(staging, outputDir);
    } catch (error) {
      if (existsSync(backup)) renamePublication(backup, outputDir);
      throw error;
    }
    if (existsSync(backup)) {
      try {
        removeProjectPath(root, relative(root, backup));
      } catch (error) {
        console.warn(
          `New artifacts archived; the previous backup could not be removed: ${backup} (${error.message})`,
        );
      }
    }
  } finally {
    if (existsSync(staging)) removeProjectPath(root, relative(root, staging));
  }
  return outputDir;
}
