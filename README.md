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
| 主题 | next-themes                  | 浅色 / 深色 / 跟随系统                        |
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
| 安全规范             | [docs/security.md](./docs/security.md)                                   |
| 常见故障排查         | [docs/troubleshooting.md](./docs/troubleshooting.md)                     |
| 技术选型决策         | [docs/adr/](./docs/adr/README.md)                                        |

协作流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 快速开始

前置：Node 20+、pnpm、Rust（`rustup` 安装 stable-msvc）、Windows 上还需要 MSVC Build Tools 与 WebView2 运行时。

```bash
pnpm install
pnpm app:dev      # 开发模式，热更新
pnpm app:build    # 产出安装包
pnpm typecheck    # 只做类型检查
pnpm lint         # ESLint
pnpm format       # Prettier 格式化
```

`pnpm dev` 只起前端（浏览器里能看界面，但 `invoke` 不可用）。

## 目录结构

```
.
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn 组件，随用随加，可直接改源码
│   │   ├── app-shell.tsx    # 侧边栏 + 顶栏 + 内容区骨架
│   │   └── theme-toggle.tsx
│   ├── pages/
│   │   ├── overview.tsx     # 概览页（含命令速查）
│   │   ├── bridge.tsx       # 前端 ↔ Rust 调用示例
│   │   └── settings.tsx     # 主题切换、运行时信息
│   ├── lib/
│   │   ├── tauri.ts         # 环境判断、外链、窗口显示、invoke 封装
│   │   └── utils.ts         # cn()
│   ├── App.tsx              # Provider + 路由
│   ├── main.tsx
│   └── index.css            # Tailwind 入口与主题变量
├── src-tauri/
│   ├── src/lib.rs           # Rust 侧入口，命令与插件注册
│   ├── src/main.rs          # 二进制入口，调用 lib.rs
│   ├── capabilities/        # 前端可调用的接口白名单
│   ├── tauri.conf.json      # 窗口、打包、标识符
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
│   └── set-version.mjs      # 同步三处版本号
├── .github/                 # CI、PR 与 Issue 模板
├── CONTRIBUTING.md
├── CHANGELOG.md
└── SECURITY.md
```

## 已经处理好的几件事

这些不是"顺手加的"，每一个都对应一个真实会踩的坑：

1. **启动不闪白屏** —— 窗口在 `tauri.conf.json` 里是 `visible: false`，前端首帧渲染后调用 `show()` 才出现（`useRevealWindow`）。Rust 侧另有 3 秒兜底线程，防止前端抛异常导致窗口永远不出现。
2. **外链不劫持** —— 页面里所有 `http(s)` 链接被 `useExternalLinks` 拦截，交给系统浏览器打开。否则用户点个文档链接，应用就"变成"了浏览器且回不去。
3. **单实例** —— `tauri-plugin-single-instance` 已注册且必须最先注册；重复启动时聚焦已有窗口，而不是开第二个。
4. **窗口位置记忆** —— `tauri-plugin-window-state` 自动保存/恢复窗口尺寸与位置。
5. **HashRouter 而非 BrowserRouter** —— 生产环境前端跑在自定义协议下，BrowserRouter 刷新或深链会 404。
6. **体积优化** —— `Cargo.toml` 的 release 档已开 `lto`、`codegen-units=1`、`opt-level="s"`、`strip`、`panic="abort"`。
7. **能力白名单** —— `capabilities/default.json` 只放开了必要权限。加新插件后如果前端调用报 "not allowed"，就是这里没加。

## 拿它开新项目

按顺序改这几处，改完 `rm -rf node_modules dist src-tauri/target && pnpm install`：

1. `package.json` → `name`
2. `src-tauri/Cargo.toml` → `package.name`、`[lib] name`（下划线命名）、`description`、`authors`
3. `src-tauri/src/main.rs` → 把 `tauri_desktop_starter_lib::run()` 换成新的 lib 名
4. `src-tauri/tauri.conf.json` → `productName`、`identifier`、`app.windows[0].title`
5. `index.html` → `<title>`
6. `src/components/app-shell.tsx` → 左上角品牌名（现在写的是 Tauri Starter）
7. 图标：准备一张 1024×1024 PNG，执行 `pnpm tauri icon ./logo.png`

> `identifier` 要唯一（形如 `com.公司.产品`），升级安装和 WebView 数据目录都依赖它。一旦发布就不要再改。

## 常见扩展

**加 shadcn 组件**

```bash
pnpm dlx shadcn@latest add dialog table form select
```

**加一个 Rust 命令**

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn read_config() -> Result<String, String> {
    std::fs::read_to_string("config.json").map_err(|e| e.to_string())
}
```

注册进 `generate_handler![greet, read_config]`，前端 `invoke<string>("read_config")`。

> 注意：前端 `invoke` 的返回类型不会被自动校验，建议像 `lib/tauri.ts` 那样统一包一层函数并显式标注泛型。项目变大后可以接 `tauri-specta` 自动生成类型绑定。

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

| 产物                                   | 体积   |
| -------------------------------------- | ------ |
| 可执行文件 `tauri-desktop-starter.exe` | 3.4 MB |
| MSI 安装包                             | 1.9 MB |
| NSIS 安装包                            | 1.4 MB |

首次 `pnpm app:build` 需要编译全部 Rust 依赖，约 7 分钟；之后改前端不动 Rust，几十秒即可。
`src-tauri/target` 会占 1.5 GB 左右（编译缓存，已在 .gitignore 中）。

## 说明

- 项目本身不依赖 bun，bun 只在生成脚手架时用过。
- 字体用的是 Geist Variable（随包内置），只覆盖拉丁字符，中文走系统字体。
- 需要改主题色，改 `src/index.css` 里的 CSS 变量即可，组件不用动。
- 许可：目前未指定开源协议。对外发布前请补 `LICENSE` 文件；内部使用请按公司规定处理。
