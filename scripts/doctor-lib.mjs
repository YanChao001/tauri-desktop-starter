import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function runProbe(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    ...options,
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
    error: result.error?.message,
  };
}

function numeric(version) {
  const match = version.match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : undefined;
}
function compare(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function supportsNode(version, range) {
  const actual = numeric(version);
  if (!actual) return false;
  return range.split("||").some((part) => {
    const match = part.trim().match(/^(\^|>=)(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error(`doctor 不支持的 Node engines 表达式：${part}`);
    const minimum = match.slice(2).map(Number);
    return (
      compare(actual, minimum) >= 0 &&
      (match[1] !== "^" || actual[0] === minimum[0])
    );
  });
}

export function diagnose(
  root,
  {
    platform = process.platform,
    env = process.env,
    nodeVersion = process.version,
    probe = runProbe,
    exists = existsSync,
    read = (path) => readFileSync(path, "utf8"),
  } = {},
) {
  const pkg = JSON.parse(read(join(root, "package.json")));
  const readOnlyEnv = {
    ...env,
    RUSTUP_AUTO_INSTALL: "0",
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
    npm_config_manage_package_manager_versions: "false",
  };
  const results = [];
  const add = (name, ok, detail, remedy, required = true) =>
    results.push({
      name,
      status: ok ? "ok" : required ? "error" : "warning",
      detail,
      ...(ok ? {} : { remedy }),
    });
  add(
    "Node.js",
    supportsNode(nodeVersion, pkg.engines.node),
    `${nodeVersion}; 要求 ${pkg.engines.node}`,
    "安装 .nvmrc 指定的 Node.js，然后重新打开终端。",
  );
  const packageManager = pkg.packageManager.match(/^pnpm@(\d+\.\d+\.\d+)/)?.[1];
  const pnpm =
    env.npm_execpath && /pnpm\.(?:c?js|mjs)$/i.test(env.npm_execpath)
      ? probe(process.execPath, [env.npm_execpath, "--version"], {
          env: readOnlyEnv,
        })
      : probe("pnpm", ["--version"], {
          shell: platform === "win32",
          env: readOnlyEnv,
        });
  add(
    "pnpm",
    pnpm.ok && pnpm.output.split(/\s+/).includes(packageManager),
    pnpm.ok ? pnpm.output : "命令不可用",
    `安装 packageManager 指定的 pnpm@${packageManager}（npm install -g pnpm@${packageManager}），再运行 pnpm install --frozen-lockfile。`,
  );
  const cargoBin = join(
    env.CARGO_HOME ?? join(env.USERPROFILE ?? env.HOME ?? homedir(), ".cargo"),
    "bin",
  );
  const rustTool = (name) => {
    const direct = join(
      cargoBin,
      `${name}${platform === "win32" ? ".exe" : ""}`,
    );
    return exists(direct) ? direct : name;
  };
  const toolchain = read(join(root, "rust-toolchain.toml")).match(
    /^channel\s*=\s*"([^"]+)"/m,
  )?.[1];
  for (const name of ["rustc", "cargo"]) {
    const result = probe(rustTool(name), ["--version"], {
      cwd: root,
      env: readOnlyEnv,
    });
    const version = numeric(result.output)?.join(".");
    add(
      name,
      result.ok && version === toolchain,
      result.ok ? result.output : "命令不可用",
      `安装 Rust/rustup；在仓库运行 rustup toolchain install（当前锁定 ${toolchain}）。`,
    );
  }
  const git = probe("git", ["--version"]);
  add(
    "Git",
    git.ok,
    git.ok ? git.output : "命令不可用",
    "安装 Git 并将它加入 PATH。",
  );
  add(
    "前端依赖",
    exists(join(root, "node_modules", ".modules.yaml")),
    "检查 pnpm 安装目录",
    "运行 pnpm install --frozen-lockfile。",
  );
  if (platform === "win32") {
    const vswhere = join(
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft Visual Studio",
      "Installer",
      "vswhere.exe",
    );
    const vc = exists(vswhere)
      ? probe(vswhere, [
          "-latest",
          "-products",
          "*",
          "-requires",
          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
          "-property",
          "installationPath",
        ])
      : { ok: false, output: "" };
    add(
      "MSVC C++ 工具",
      vc.ok && !!vc.output.trim(),
      vc.output
        ? "已找到含 x64/x86 C++ 工具的 Visual Studio / Build Tools"
        : "未找到 MSVC x64/x86 工具组件",
      "在 Visual Studio Installer 安装“使用 C++ 的桌面开发”和 Windows 10/11 SDK。https://tauri.app/start/prerequisites/#windows",
    );
    const windows = probe("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$sdk=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10; $headers=@(Get-ChildItem -LiteralPath ($sdk+'Include') -Filter windows.h -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1); $keys=@('HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKLM:\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'); $versions=@($keys | ForEach-Object {(Get-ItemProperty -LiteralPath $_ -ErrorAction SilentlyContinue).pv} | Where-Object {$_ -and $_ -ne '0.0.0.0'}); [pscustomobject]@{sdk=($headers.Count -gt 0);webview=$versions} | ConvertTo-Json -Compress",
    ]);
    let detected = {};
    try {
      detected = JSON.parse(windows.output);
    } catch {
      /* 报告未能验证，不伪造成功 */
    }
    add(
      "Windows SDK",
      detected.sdk === true,
      detected.sdk ? "找到 Windows SDK 头文件" : "未验证到 Windows SDK 头文件",
      "在 Visual Studio Installer 安装 Windows 10/11 SDK。",
    );
    add(
      "WebView2 Runtime",
      Array.isArray(detected.webview) && detected.webview.length > 0,
      detected.webview?.length
        ? `Evergreen ${detected.webview.join(", ")}`
        : "未找到已注册的 Evergreen Runtime",
      "安装 Microsoft Edge WebView2 Evergreen Runtime。https://developer.microsoft.com/microsoft-edge/webview2/",
    );
  } else if (platform === "darwin") {
    const xcode = probe("xcrun", ["--find", "clang"]);
    add(
      "Xcode Command Line Tools",
      xcode.ok,
      xcode.ok ? xcode.output : "未找到 clang",
      "运行 xcode-select --install；App Store 分发还需要完整 Xcode。",
    );
  } else if (platform === "linux") {
    for (const libraries of [
      ["webkit2gtk-4.1"],
      ["ayatana-appindicator3-0.1", "appindicator3-0.1"],
      ["librsvg-2.0"],
    ]) {
      const probes = libraries.map((library) =>
        probe("pkg-config", ["--modversion", library]),
      );
      const result = probes.find((result) => result.ok) ?? probes[0];
      add(
        libraries.join(" / "),
        result.ok,
        result.ok ? result.output : "pkg-config 未找到开发库",
        "Ubuntu/Debian：sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential；其他发行版见 https://tauri.app/start/prerequisites/#linux",
      );
    }
    const display = !!(env.DISPLAY || env.WAYLAND_DISPLAY);
    add(
      "桌面会话",
      display,
      display ? "已设置 DISPLAY / WAYLAND_DISPLAY" : "当前无图形显示服务",
      "桌面运行需要图形会话；CI E2E 使用 xvfb-run -a pnpm test:e2e。",
      false,
    );
  } else
    add(
      "操作系统",
      false,
      platform,
      "本模板的桌面构建支持 Windows、macOS、Linux。",
    );
  return {
    platform,
    ok: results.every((item) => item.status !== "error"),
    checks: results,
  };
}
