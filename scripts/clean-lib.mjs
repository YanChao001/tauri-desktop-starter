import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

const DISTRIBUTIONS = [["artifacts", "按版本归档的分发产物"]];
const BUILD_OUTPUT = [
  ["dist", "前端构建产物"],
  ["dist-web", "浏览器演示构建产物"],
  ...DISTRIBUTIONS,
  ["coverage", "测试覆盖率报告"],
  ["src-tauri/target", "Rust 编译缓存"],
  ["src-tauri/gen/schemas", "生成的配置 schema"],
];
const TEMPORARY = [
  ...["branding", "branding-preview", "browser", "e2e", "ui-review"].map(
    (name) => [`artifacts/${name}`, "临时诊断产物"],
  ),
  ...BUILD_OUTPUT.filter(([path]) => path !== "artifacts"),
  ["node_modules/.vite", "Vite 缓存"],
  ["node_modules/.vite-temp", "Vite 临时缓存"],
  ["node_modules/.cache", "依赖工具缓存"],
];
const OUTPUTS = [
  ...BUILD_OUTPUT.filter(
    ([path]) => path !== "artifacts" && path !== "src-tauri/target",
  ),
  ["examples/extensions/dist", "Extension example packages"],
  ["marketplace/artifacts", "Marketplace packages"],
  ["marketplace/dist", "Legacy marketplace packages"],
  ["src-tauri/target/release/bundle", "Installer staging output"],
];
const MODES = ["--all", "--artifacts", "--temporary", "--outputs"];
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TARGET = /^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/;
const PORTABLE_BACKUP =
  /^\.portable-previous-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function parseCleanupArgs(args) {
  const modes = args.filter((arg) => MODES.includes(arg));
  if (
    modes.length > 1 ||
    args.some((arg) => ![...MODES, "--dry-run"].includes(arg))
  )
    throw new Error(
      "Usage: pnpm clean [--all | --artifacts | --temporary | --outputs] [--dry-run]; custom paths are not accepted",
    );
  return {
    mode: modes[0]?.slice(2) ?? "default",
    dryRun: args.includes("--dry-run"),
  };
}

/** 逐级核对绝对路径；只有 outputs 模式允许删除计划中的普通文件。 */
export function validateCleanupTarget(root, path, { allowFile = false } = {}) {
  const base = realpathSync(root);
  const target = resolve(base, path);
  const offset = relative(base, target);
  if (
    !offset ||
    offset === ".." ||
    offset.startsWith(`..${sep}`) ||
    isAbsolute(offset)
  )
    throw new Error(`拒绝清理项目外路径或项目根目录：${target}`);
  let ancestor = base;
  for (const segment of offset.split(sep)) {
    ancestor = join(ancestor, segment);
    let info;
    try {
      info = lstatSync(ancestor);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const isOutputFile = allowFile && ancestor === target && info.isFile();
    if (info.isSymbolicLink() || (!info.isDirectory() && !isOutputFile))
      throw new Error(`拒绝通过链接或非目录清理：${ancestor}`);
  }
  return target;
}

/** 历史诊断目录曾混入 Cargo 缓存；按 Cargo 标记保留原路径，避免搬迁使缓存失效。 */
function disposableOutput(root, path, label) {
  const absolute = validateCleanupTarget(root, path, { allowFile: true });
  if (!absolute) return { retained: false, targets: [[path, label]] };
  if (path === join(".cache", "extension-tools"))
    return { retained: true, targets: [] };
  if (!lstatSync(absolute).isDirectory())
    return { retained: false, targets: [[path, label]] };
  const entries = readdirSync(absolute, { withFileTypes: true });
  const cargoTag = entries.find(
    (entry) => entry.name === "CACHEDIR.TAG" && entry.isFile(),
  );
  if (
    cargoTag &&
    readFileSync(join(absolute, cargoTag.name), "utf8")
      .replaceAll("\r\n", "\n")
      .startsWith(
        "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.",
      )
  )
    return { retained: true, targets: [] };
  const children = entries.map((entry) => {
    const child = join(path, entry.name);
    // 删除父目录时 rm 不跟随内部链接；若父目录必须保留，最终预检会拒绝链接目标。
    return entry.isDirectory()
      ? disposableOutput(root, child, label)
      : { retained: false, targets: [[child, label]] };
  });
  return children.some((child) => child.retained)
    ? { retained: true, targets: children.flatMap((child) => child.targets) }
    : { retained: false, targets: [[path, label]] };
}

function matchingDirectories(root, parent, pattern) {
  const absolute = validateCleanupTarget(root, parent);
  if (!absolute) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter(
      (entry) =>
        pattern.test(entry.name) &&
        (entry.isDirectory() || entry.isSymbolicLink()),
    )
    .map((entry) => {
      const path = join(parent, entry.name);
      validateCleanupTarget(root, path);
      return path;
    });
}

export function cleanupTargets(root, mode) {
  if (mode === "default") return BUILD_OUTPUT;
  if (mode === "all") return [...BUILD_OUTPUT, ["node_modules", "依赖目录"]];
  if (mode === "artifacts") return DISTRIBUTIONS;
  if (mode === "outputs")
    return [
      ...OUTPUTS,
      ...["artifacts", ".cache"].flatMap(
        (path) =>
          disposableOutput(root, path, "Generated output and temporary files")
            .targets,
      ),
    ];
  if (mode !== "temporary") throw new Error(`未知清理模式：${mode}`);
  const backups = [];
  for (const version of matchingDirectories(root, "artifacts", VERSION))
    for (const target of matchingDirectories(root, version, TARGET))
      for (const backup of matchingDirectories(root, target, PORTABLE_BACKUP))
        backups.push([backup, "旧便携版备份"]);
  return [...TEMPORARY, ...backups];
}

/** 使用固定的只读命令取快照，不把任何待删路径拼进 PowerShell。 */
export function getWindowsProcesses(probe = spawnSync) {
  const result = probe(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $items = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId, ExecutablePath); ConvertTo-Json -InputObject $items -Compress",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `无法检查 Windows 运行进程，未执行清理：${result.error?.message ?? result.stderr?.trim() ?? result.status}`,
    );
  try {
    const data = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    const processes = Array.isArray(data) ? data : [data];
    if (
      processes.some(
        (entry) =>
          !entry ||
          !Number.isInteger(entry.ProcessId) ||
          entry.ProcessId <= 0 ||
          typeof entry.ExecutablePath !== "string" ||
          !win32.isAbsolute(entry.ExecutablePath),
      )
    )
      throw new Error("进程记录缺少有效 PID 或可执行文件路径");
    return processes;
  } catch (error) {
    throw new Error(`无法解析 Windows 进程快照，未执行清理：${error.message}`, {
      cause: error,
    });
  }
}

export function assertNoRunningPrograms(target, processes) {
  const absolute = win32.resolve(target).toLowerCase();
  const prefix = `${absolute}\\`;
  const blocking = processes.filter((entry) => {
    const executable = win32.resolve(entry.ExecutablePath).toLowerCase();
    return executable === absolute || executable.startsWith(prefix);
  });
  if (blocking.length)
    throw new Error(
      `存在运行中的项目内程序，未清理此目录：${blocking.map((entry) => `PID ${entry.ProcessId} ${entry.ExecutablePath}`).join("；")}`,
    );
}
