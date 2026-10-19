# Tauri Desktop Starter

一个可以直接拿去开新项目的桌面应用基座：Tauri 2 + React 19 + TypeScript + Tailwind 4 + shadcn/ui。
界面是完整的，桌面端该踩的坑已经处理掉，剩下的位置留给你写业务。

## 技术栈

| 层   | 选型                         | 说明                                          |
| ---- | ---------------------------- | --------------------------------------------- |
| 外壳 | Tauri 2                      | 用系统 WebView，不打包浏览器                  |
| 前端 | React 19 + TypeScript 6      | 严格模式，无 `any`                            |
| 构建 | Vite 8                       | 端口固定在 1420，供 Tauri 连接                |
| 样式 | Tailwind CSS 4               | 通过 `@tailwindcss/vite` 接入，无 config 文件 |
| 组件 | shadcn/ui（radix + nova）    | 组件源码在 `src/components/ui`，可直接改      |
| 路由 | React Router 7（HashRouter） | 见下方说明                                    |
| 主题 | next-themes + CSS 变量       | 浅色 / 深色 / 跟随系统，外观可配置            |
| 图标 | lucide-react                 |                                               |
| 提示 | sonner                       | `toast.success(...)`                          |

## 文档

规范与工程文档都在 `docs/`，入口是 [文档索引](./docs/README.md)。

| 主题                 | 文档                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| 架构与分层           | [docs/architecture.md](./docs/architecture.md)                           |
| 开发、调试、镜像加速 | [docs/development.md](./docs/development.md)                             |
| 命名与代码风格       | [docs/conventions/code-style.md](./docs/conventions/code-style.md)       |
| Git 分支与协作流程   | [docs/conventions/git-workflow.md](./docs/conventions/git-workflow.md)   |
| 界面与设计规范       | [docs/conventions/ui-guidelines.md](./docs/conventions/ui-guidelines.md) |
| 测试策略             | [docs/testing.md](./docs/testing.md)                                     |
| 构建、签名、发布     | [docs/build-release.md](./docs/build-release.md)                         |
| 代码签名策略         | [docs/code-signing-policy.md](./docs/code-signing-policy.md)             |
| 安全规范             | [docs/security.md](./docs/security.md)                                   |
| 常见故障排查         | [docs/troubleshooting.md](./docs/troubleshooting.md)                     |
| 技术选型决策         | [docs/adr/](./docs/adr/README.md)                                        |

协作流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 快速开始

前置：Node 22（≥22.12）、pnpm 12+（`packageManager` 字段已锁定，corepack 会自动对齐）、Rust 1.99.1（`rustup` 自动安装，见 `rust-toolchain.toml`）、Windows 上还需要 MSVC Build Tools 与 WebView2 运行时。

```bash
pnpm install
pnpm app:dev      # 开发模式，热更新
pnpm app:build    # 产出安装包（msi / nsis）
pnpm app:portable # 产出免安装便携版（Windows 单文件 exe）
pnpm verify       # 提交前跑一次：格式 + lint + 类型 + 测试 + 构建
```

`pnpm dev` 只起前端（浏览器里能看界面，但 `invoke` 不可用）。
`pnpm test` 跑单元测试，`pnpm clean` 删除 `dist`、`dist-portable` 与整个 `src-tauri/target`（通常 1 GB 以上）。

## 界面能力

- **外观**：7 种主题色、3 档圆角、4 种字体、3 档字号、4 种背景、动效开关，即时生效并保存在本地
- **语言**：中文 / English 即时切换，字典在 `src/providers/i18n.tsx`
- **标题栏**：自绘窗口框，含文件 / 编辑 / 视图 / 帮助菜单、拖拽区域与窗口按钮；macOS 保留系统红绿灯
- **主题切换**：View Transitions 圆形扩散，从点击位置铺满窗口；关闭动效时直接切换
- **演示页**：概览、组件、动效、前端 ↔ Rust、设置。组件页覆盖按钮、表单、浮层、表格、骨架屏等常用控件

## 目录结构

```
.
├── src/
│   ├── routes.tsx           # 路由与侧边导航的唯一数据源（页面懒加载）
│   ├── layouts/
│   │   └── app-shell.tsx    # 标题栏 + 侧边栏 + 页面标题 + 内容区
│   ├── pages/
│   │   ├── overview.tsx     # 概览：指标、动态、工程状态
│   │   ├── components.tsx   # 组件演示：按钮、表单、浮层、表格
│   │   ├── motion.tsx       # 动效：主题扩散、错峰入场、骨架屏
│   │   ├── bridge.tsx       # 前端 ↔ Rust 调用示例（含错误链路）
│   │   └── settings.tsx     # 外观、语言、窗口、运行时信息
│   ├── components/
│   │   ├── ui/              # shadcn 组件，随用随加，可直接改源码
│   │   ├── title-bar.tsx    # 自绘标题栏：菜单、拖拽、窗口按钮
│   │   ├── error-boundary.tsx     # 渲染层兜底，崩溃不白屏
│   │   └── theme-toggle.tsx
│   ├── hooks/
│   │   ├── use-external-links.ts  # 外链交给系统浏览器
│   │   ├── use-reveal-window.ts   # 首帧后显示窗口
│   │   └── use-theme-switch.ts    # 主题切换 + 圆形扩散
│   ├── providers/
│   │   ├── settings.tsx     # 外观偏好：类型、默认值、localStorage
│   │   └── i18n.tsx         # 中英文字典与 t()
│   ├── lib/
│   │   ├── tauri.ts         # 唯一的系统能力出口：环境判断、外链、窗口、IPC
│   │   ├── clipboard.ts     # 复制文本，含降级
│   │   ├── platform.ts      # 平台判断（macOS / Windows / Linux）
│   │   └── utils.ts         # cn()
│   ├── App.tsx              # Provider + 路由
│   ├── main.tsx
│   ├── index.css            # Tailwind 入口、主题变量与外观 data-* 规则
│   ├── styles/shadcn.css    # shadcn 基础样式，逐字复制自上游
│   └── test/setup.ts        # 测试环境初始化
├── src-tauri/
│   ├── src/lib.rs           # 只做组装：插件、命令注册、启动兜底
│   ├── src/commands.rs      # 前端可调用的命令实现
│   ├── src/main.rs          # 二进制入口，调用 lib.rs
│   ├── capabilities/        # 前端可调用的接口白名单
│   ├── installer/           # 安装器外观：NSIS 模板与位图
│   ├── tauri.conf.json      # 窗口、打包、标识符、安装器外观
│   ├── tauri.macos.conf.json # macOS 窗口覆盖：保留系统红绿灯
│   └── Cargo.toml
├── docs/                    # 全部工程文档，入口 docs/README.md
│   ├── architecture.md
│   ├── development.md
│   ├── testing.md
│   ├── build-release.md
│   ├── security.md
│   ├── troubleshooting.md
│   ├── conventions/         # 代码风格、Git 协作、界面规范
│   └── adr/                 # 架构决策记录
├── scripts/
│   ├── clean.mjs            # 清理 dist 与 Rust 编译缓存
│   └── set-version.mjs      # 同步四处版本号
├── vitest.config.ts         # 测试配置，alias 复用 vite.config.ts
├── rust-toolchain.toml      # 固定 stable，自动装 rustfmt / clippy
├── .github/                 # CI、发布流水线、依赖更新、PR 与 Issue 模板
├── CONTRIBUTING.md
├── SECURITY.md              # 安全邮箱为占位，新项目需替换
├── LICENSE                  # MIT，版权方需按项目替换
└── .env.example             # 环境变量示例，复制为 .env.local 使用
```

## 已经处理好的几件事

这些不是"顺手加的"，每一个都对应一个真实会踩的坑：

1. **启动不闪白屏** —— 窗口在 `tauri.conf.json` 里是 `visible: false`，前端首帧渲染后调用 `show()` 才出现（`useRevealWindow`）。Rust 侧另有 3 秒兜底线程，防止前端抛异常导致窗口永远不出现。
2. **外链不劫持** —— 页面里所有 `http(s)` 链接被 `useExternalLinks` 拦截，交给系统浏览器打开。否则用户点个文档链接，应用就"变成"了浏览器且回不去。
3. **单实例** —— `tauri-plugin-single-instance` 已注册（紧跟日志插件、先于其余插件），重复启动时聚焦已有窗口，而不是开第二个。
4. **窗口位置记忆** —— `tauri-plugin-window-state` 自动保存/恢复窗口尺寸与位置。
5. **HashRouter 而非 BrowserRouter** —— 生产环境前端跑在自定义协议下，BrowserRouter 刷新或深链会 404。
6. **体积优化** —— `Cargo.toml` 的 release 档已开 `lto`、`codegen-units=1`、`opt-level="s"`、`strip`、`panic="abort"`。
7. **能力白名单** —— `capabilities/default.json` 只放开了必要权限。加新插件后如果前端调用报 "not allowed"，就是这里没加。
8. **渲染崩溃有兜底** —— `ErrorBoundary` 包在 `App` 外层。组件树抛错时显示错误文本和「重新加载」，而不是一个空白窗口——桌面应用里白屏时用户连控制台都打不开。
9. **日志落盘** —— `tauri-plugin-log` 同时写 stdout 和系统日志目录（`app.log`）。release 构建没有控制台，用户报问题时这是唯一能拿到的线索。
10. **生产 CSP 默认收紧** —— `tauri.conf.json` 的 `csp` 只放行自身资源与 IPC 通道。开发模式下前端由 Vite dev server 提供（外部 URL），Tauri 不向它注入 CSP，所以 HMR 不受影响；`devCsp` 为 `null` 时，开发构建会回退到生产 `csp`（Tauri 源码 `AppManager::csp()` 的行为），**不等于「开发模式没有 CSP」**。即使页面被注入恶意内容，也加载不了外部脚本、外传不了数据，发布前不需要额外补配置。

## 拿它开新项目

按顺序改这几处，改完 `rm -rf node_modules dist src-tauri/target && pnpm install`：

1. `package.json` → `name`
2. `src-tauri/Cargo.toml` → `package.name`、`[lib] name`（下划线命名）、`description`、`authors`
3. `src-tauri/src/main.rs` → 把 `tauri_desktop_starter_lib::run()` 换成新的 lib 名
4. `src-tauri/tauri.conf.json` → `productName`、`identifier`、`app.windows[0].title`、`bundle.shortDescription`、`bundle.copyright`（安装器页脚）
5. `index.html` → `<title>` 与 favicon（引用的是 `public/tauri.svg`）
6. `src/layouts/app-shell.tsx` → 左上角品牌名（现在写的是 Tauri Starter）
7. 图标：准备一张 1024×1024 PNG，执行 `pnpm tauri icon ./logo.png`；安装器外观图在 `src-tauri/installer/`，按现有尺寸替换（页眉 150×57、侧栏 164×314、WiX banner 493×58 / dialog 493×312），欢迎页/完成页文案在同目录 `installer.nsi` 的 `CUSTOM BRANDING` 段
8. `LICENSE` → 版权方改成你的名字或公司（模板里是 `Tauri Desktop Starter contributors`）
9. `SECURITY.md` → 把 `security@example.com` 换成真实的安全邮箱
10. 全局收尾：`grep -ri starter` 过一遍，清理 docs 里残留的产物名与日志路径（`tauri-desktop-starter.exe`、`com.starter.desktop`）

> `identifier` 要唯一（形如 `com.公司.产品`），升级安装和 WebView 数据目录都依赖它。一旦发布就不要再改。

## 常见扩展

**加 shadcn 组件**

```bash
pnpm dlx shadcn@latest add dialog table form select
```

模板没有把 shadcn CLI 装进 `dependencies`：它只负责生成组件，用 `dlx` 临时执行就够。
`radix-nova` 风格依赖的基础样式（`data-open` 等变体、`scroll-fade` 等工具类）已内置在
`src/styles/shadcn.css`，逐字复制自 `shadcn@4.22.0`；升级风格时整体覆盖该文件即可。
如果 CLI 在 `index.css` 里自动加回 `@import "shadcn/tailwind.css"`，删掉那一行。

**加一个 Rust 命令**（三步，少一步就会报 "command not found"）

```rust
// 1. src-tauri/src/commands.rs
use tauri::Manager;

#[tauri::command]
pub fn read_config(app: tauri::AppHandle) -> Result<String, String> {
    // 数据目录随系统变化，不要用相对路径或 exe 所在目录
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::read_to_string(dir.join("config.json")).map_err(|e| e.to_string())
}
```

```rust
// 2. src-tauri/src/lib.rs —— 登记到 handler
.invoke_handler(tauri::generate_handler![commands::greet, commands::read_config])
```

```ts
// 3. src/lib/tauri.ts —— 前端只通过这里调用
export async function readConfig(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("read_config");
}
```

页面里直接 `await readConfig()`，不要自己 import `@tauri-apps/api`——ESLint 会拦。

> `invoke` 的返回类型不会被运行时校验。后端结构变了，前端不会立刻报错，
> 所以跨边界的返回值要当不可信数据处理。项目再大一些可以接 `tauri-specta` 自动生成类型绑定。

**加官方插件**（文件系统、对话框、通知、剪贴板等）

```bash
pnpm tauri add dialog
```

会自动改 `Cargo.toml`、`lib.rs`、`capabilities/default.json` 和 `package.json`。

**自动更新**：`pnpm tauri add updater`，然后配置签名公钥与 `bundle.createUpdaterArtifacts`，配合 GitHub Releases 使用。

## 构建产物

`pnpm app:build` 之后在 `src-tauri/target/release/bundle/` 下：

- Windows：`nsis/*.exe`（安装包）、`msi/*.msi`
- macOS：`dmg/*.dmg`、`macos/*.app`
- Linux：`deb/*.deb`、`appimage/*.AppImage`

本机（Windows x64，release 档）实测：

| 产物                                   | 体积    |
| -------------------------------------- | ------- |
| 可执行文件 `tauri-desktop-starter.exe` | 3.5 MB  |
| MSI 安装包                             | 2.38 MB |
| NSIS 安装包                            | 1.41 MB |

> 安装包体积包含自定义安装器位图（NSIS 页眉/侧栏、WiX banner/dialog）；不需要品牌化时可以删掉对应配置，MSI 会小约 0.45 MB。

**便携版（免安装）**：`pnpm app:portable` 执行 `tauri build --no-bundle`，把单文件 exe 与一份使用说明收集到 `dist-portable/`（已在 .gitignore 中）。

**安装器外观**：NSIS 安装器已做基础品牌化——中文界面（`SimpChinese` / `English`）、页眉与侧栏位图、安装器图标，页脚取自 `bundle.copyright`。位图在 `src-tauri/installer/`，替换后重新打包即可；MSI 使用同目录下的 WiX banner / dialog 位图。

Tauri 的 Windows 打包目标只有 msi / nsis，没有官方 portable 目标；但前端资源在编译期已嵌进二进制，`--no-bundle` 产出的 exe 本身就是便携程序。两点限制：目标机器需要 WebView2 运行时（Win11 自带）；窗口位置与日志仍写 AppData，不随 exe 移动。

首次 `pnpm app:build` 需要编译全部 Rust 依赖，约 7 分钟；之后改前端不动 Rust，几十秒即可。
`src-tauri/target` 会占 1.5 GB 左右（编译缓存，已在 .gitignore 中）。

## 说明

- 项目本身不依赖 bun，bun 只在生成脚手架时用过。
- 字体用的是 Geist Variable（随包内置），只覆盖拉丁字符，中文走系统字体。
- 需要改主题色，改 `src/index.css` 里的 CSS 变量即可，组件不用动。
- 许可：MIT，全文见 [LICENSE](./LICENSE)。复制成新项目后，记得把版权方换成自己的名字或公司。
