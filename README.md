# Tauri Desktop Starter

一个可以直接拿去开新项目的桌面应用基座：Tauri 2 + React 19 + TypeScript + Tailwind 4 + shadcn/ui。
提供可运行的演示界面、系统能力封装、测试和发布流程。业务能力、自动更新与生产签名需要按产品需求接入。

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

前置版本以 [`.nvmrc`](./.nvmrc)、[`package.json`](./package.json) 的 `packageManager` / `engines` 和 [`rust-toolchain.toml`](./rust-toolchain.toml) 为准。Windows 还需 MSVC Build Tools 与 WebView2；macOS / Linux 的系统依赖见 [开发指南](./docs/development.md#环境要求)。

```bash
pnpm install --frozen-lockfile
pnpm app:dev      # 开发模式，热更新
pnpm app:build    # 构建安装包并收集到 artifacts/<version>/<target>/installers/
pnpm app:portable # 构建 Windows 便携版到 artifacts/<version>/<target>/portable/
pnpm verify       # 格式、lint、类型、前端/脚本测试、版本一致性、前端构建
```

`pnpm test` 跑单元测试。只清理最终分发目录用 `pnpm clean:artifacts`，保留 Rust 编译缓存；`pnpm clean` 清理所有默认构建输出，范围见 [清理说明](./docs/development.md#清理构建产物)。
`pnpm verify` 不编译 Rust；修改原生端后还需运行 [Rust 检查](./docs/testing.md#rust-测试)。

## 从源码运行

在仓库根目录运行 `pnpm app:dev` 启动完整桌面应用，前端与 Rust 源码修改后会热更新或重新编译。只调整界面时运行 `pnpm dev`，浏览器访问 `http://localhost:1420`；此模式没有 Rust 进程，IPC 与原生窗口功能不可用。

前端入口是根目录的 [`index.html`](./index.html) → [`src/main.tsx`](./src/main.tsx) → [`src/App.tsx`](./src/App.tsx)；桌面入口是 [`src-tauri/src/main.rs`](./src-tauri/src/main.rs) → [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)。修改界面请编辑 `src/`，修改命令和原生生命周期请编辑 `src-tauri/src/`。

`pnpm build` 只把前端编译到 `dist/`，其中的 `dist/index.html` 是生成文件，不应手改或双击作为应用入口。查看已构建的前端可运行 `pnpm preview`，需要完整桌面功能则运行 `pnpm app:dev` 或安装 / 启动 [分发产物](#构建产物)。

## 界面能力

- **外观**：7 种主题色、3 档圆角、4 种字体、3 档字号、纯色与 5 款原创 SVG 插画皮肤、3 档皮肤强度和动效开关，即时生效并保存在本地
- **语言**：简体中文 / English，标题栏与设置页即时切换并保留选择；首次按系统偏好匹配，词典和扩展注册表在 `src/i18n/`
- **标题栏**：自绘窗口框，含文件 / 编辑 / 视图 / 帮助菜单、拖拽区域与窗口按钮；macOS 保留系统红绿灯
- **主题切换**：View Transitions 圆形扩散，从点击位置铺满窗口；关闭动效时直接切换
- **全窗口皮肤**：星光、樱花、月夜、枝叶与云景覆盖标题栏、侧栏和主体；设置页复用实际 SVG 作为预览，表单与弹层保留清晰表面
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
│   │   ├── language-switch.tsx # 标题栏与设置页共用的语言入口
│   │   ├── window-background.tsx # 窗口与缩略图共用的原创矢量插画
│   │   ├── skin-picker.tsx  # 皮肤画廊与强度设置
│   │   ├── error-boundary.tsx     # 渲染层兜底，崩溃不白屏
│   │   └── theme-toggle.tsx
│   ├── hooks/
│   │   ├── use-external-links.ts  # 外链交给系统浏览器
│   │   ├── use-reveal-window.ts   # 首帧后显示窗口
│   │   └── use-theme-switch.ts    # 主题切换 + 圆形扩散
│   ├── providers/
│   │   ├── settings.tsx     # 外观偏好：类型、默认值、localStorage
│   │   └── i18n.tsx         # 语言 Context 与 t()
│   ├── i18n/                # 中英文词典、locale 注册表与翻译函数
│   ├── lib/
│   │   ├── tauri.ts         # 唯一的系统能力出口：环境判断、外链、窗口、IPC
│   │   ├── clipboard.ts     # 复制文本，含降级
│   │   ├── platform.ts      # 平台判断（macOS / Windows / Linux）
│   │   ├── backgrounds.ts   # 皮肤、强度与显示元数据注册表
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
│   ├── capabilities/        # Tauri 核心与插件能力白名单
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
│   ├── app-build.mjs        # 安装包构建与版本化分发收集
│   ├── portable.mjs         # Windows 便携版构建与收集
│   ├── set-version.mjs      # 同步四处版本号
│   ├── check-version.mjs    # 版本一致性与发布标签校验
│   └── version.mjs          # 共用版本解析与校验
├── index.html               # 前端源码入口，加载 src/main.tsx
├── vitest.config.ts         # 测试配置，alias 复用 vite.config.ts
├── rust-toolchain.toml      # 固定具体 Rust 版本，自动装 rustfmt / clippy
├── .github/                 # CI、发布流水线、依赖更新、PR 与 Issue 模板
├── CONTRIBUTING.md
├── SECURITY.md              # 安全报告政策，派生项目需配置真实渠道
├── LICENSE                  # MIT，版权方需按项目替换
└── .env.example             # 环境变量示例，复制为 .env.local 使用
```

## 已经处理好的几件事

以下行为已在源码中实现；涉及系统 WebView 的交互仍需在目标平台验证：

1. **启动不闪白屏** —— 窗口在 `tauri.conf.json` 里是 `visible: false`，前端首帧渲染后调用 `show()` 才出现（`useRevealWindow`）。Rust 侧另有 3 秒兜底线程，防止前端抛异常导致窗口永远不出现。
2. **外链不劫持** —— 页面里所有 `http(s)` 链接被 `useExternalLinks` 拦截，交给系统浏览器打开。否则用户点个文档链接，应用就"变成"了浏览器且回不去。
3. **单实例** —— 桌面端首先注册 `tauri-plugin-single-instance`，重复启动时还原并聚焦已有窗口。
4. **窗口位置记忆** —— `tauri-plugin-window-state` 自动保存/恢复窗口尺寸与位置。
5. **HashRouter 而非 BrowserRouter** —— 生产环境前端跑在自定义协议下，BrowserRouter 刷新或深链会 404。
6. **体积优化** —— `Cargo.toml` 的 release 档已开 `lto`、`codegen-units=1`、`opt-level="s"`、`strip`、`panic="abort"`。
7. **能力白名单** —— `capabilities/default.json` 分配核心与插件权限，外链限定为 `http(s)`。自定义命令的权限与入参校验见 [安全规范](./docs/security.md#能力最小化)。
8. **渲染崩溃有兜底** —— `ErrorBoundary` 包在 `App` 外层。组件树抛错时显示错误文本和「重新加载」，而不是一个空白窗口——桌面应用里白屏时用户连控制台都打不开。
9. **日志落盘** —— `tauri-plugin-log` 同时写 stdout 和系统日志目录（`app.log`），保留轮换归档；位置见 [排障手册](./docs/troubleshooting.md#先看日志)。
10. **生产 CSP** —— 仅开放界面所需资源与 IPC 通道；增加远端 API 时需同步调整域名范围，见 [CSP 说明](./docs/security.md#csp)。

## 拿它开新项目

按顺序修改以下身份信息，再运行 `pnpm install`、`pnpm build`、`cargo check --manifest-path src-tauri/Cargo.toml`，更新对应锁文件并审查差异，最后执行 `pnpm verify`。仅在旧构建缓存导致问题时执行 `pnpm clean`：

1. `package.json` → `name`
2. `src-tauri/Cargo.toml` → `package.name`、`[lib] name`（下划线命名）、`description`、`authors`
3. `src-tauri/src/main.rs` → 把 `tauri_desktop_starter_lib::run()` 换成新的 lib 名
4. `src-tauri/tauri.conf.json` → `productName`、`identifier`、`app.windows[0].title`、`bundle.shortDescription`、`bundle.copyright`（安装器页脚）；窗口标题也要同步到 `tauri.macos.conf.json`
5. `index.html` → `<title>` 与 favicon（引用的是 `public/tauri.svg`）
6. `src/i18n/zh-CN.ts`、`en.ts` → 品牌与双语文案；检查 `title-bar.tsx`、`app-shell.tsx` 中的外壳展示
7. 图标：准备一张 1024×1024 PNG，执行 `pnpm tauri icon ./logo.png`；安装器外观图在 `src-tauri/installer/`，按现有尺寸替换（页眉 150×57、侧栏 164×314、WiX banner 493×58 / dialog 493×312），欢迎页/完成页文案在同目录 `installer.nsi` 的 `CUSTOM BRANDING` 段
8. `LICENSE` → 版权方改成你的名字或公司（模板里是 `Tauri Desktop Starter contributors`）
9. `SECURITY.md` → 配置实际可用的私密报告渠道；`docs/code-signing-policy.md` → 替换维护者并完成真实签名配置
10. 全局收尾：`rg -n -i starter --glob '!pnpm-lock.yaml' --glob '!src-tauri/Cargo.lock'`，检查存储键、文案、产物名、日志路径以及 `.signpath/artifact-configuration.xml` 的产品名；不要把原项目的远端地址与标签推入新仓库

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

**加一个 Rust 命令**：实现命令、在 handler 注册、在前端边界封装三步缺一不可。以下示例读取应用自己的配置文件，页面需要处理文件不存在等错误：

```rust
// 1. src-tauri/src/commands.rs
use tauri::Manager;

#[tauri::command]
pub async fn read_config(app: tauri::AppHandle) -> Result<String, String> {
    // 数据目录随系统变化，不要用相对路径或 exe 所在目录
    let dir = app.path().app_data_dir().map_err(|_| "无法定位应用数据目录".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_to_string(dir.join("config.json"))
            .map_err(|_| "无法读取配置文件".to_owned())
    })
    .await
    .map_err(|_| "读取配置任务失败".to_owned())?
}
```

```rust
// 2. src-tauri/src/lib.rs —— 登记到 handler
.invoke_handler(tauri::generate_handler![commands::greet, commands::read_config])
```

```ts
// 3. src/lib/tauri.ts —— 前端只通过这里调用
export async function readConfig(): Promise<string> {
  if (!isTauri()) throw new Error("请用 pnpm app:dev 启动");
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

CLI 会修改插件依赖与初始化配置；运行后审查差异，按实际使用范围调整 `capabilities/default.json`，并将前端调用封装在 `src/lib/tauri.ts`。

**自动更新**：`pnpm tauri add updater`，然后配置签名公钥与 `bundle.createUpdaterArtifacts`，配合 GitHub Releases 使用。

## 构建产物

最终分发文件统一在 `artifacts/<version>/<target-triple>/`，例如 Windows x64：

```text
artifacts/
└── 0.1.0/
    └── x86_64-pc-windows-msvc/
        ├── installers/     # pnpm app:build：按 nsis/、msi/ 等保留安装包
        │   └── manifest.json
        └── portable/       # pnpm app:portable：应用 exe、使用说明与 manifest.json
```

安装包类型随平台不同：

- Windows：NSIS `.exe`、MSI `.msi`
- macOS：`.dmg`、`.app`
- Linux：`.deb`、`.AppImage`

每次构建只替换当前版本、目标平台对应的 `installers/` 或 `portable/`，避免混入旧文件；其他版本、目标平台与另一类分发产物保留。`pnpm clean:artifacts` 删除整个分发目录。

每类产物附带 `manifest.json`，记录版本、目标平台、类别、收集时间和普通文件 SHA-256；`.app` 等目录包记录目录类型。交付时可用安装包或归档文件的哈希核对完整性。

`dist/` 是前端编译中间产物，`src-tauri/target/` 是 Rust 编译缓存与 Tauri 原始输出，均保留工具默认布局；`artifacts/` 才是整理后的本地分发入口。旧 `dist-portable/` 不再接收新产物，仅兼容历史清理。自定义 Cargo 目标目录也不会改变最终 `artifacts/` 的位置。

**便携版（免安装）**：`pnpm app:portable` 构建单文件 exe 并生成使用说明，默认沿用 Cargo 的编译目录与缓存。完整命令、复用已有构建的规则与运行限制见 [构建与发布](./docs/build-release.md#便携版免安装)。

**安装器外观**：NSIS 安装器已做基础品牌化——中文界面（`SimpChinese` / `English`）、页眉与侧栏位图、安装器图标，页脚取自 `bundle.copyright`。位图在 `src-tauri/installer/`，替换后重新打包即可；MSI 使用同目录下的 WiX banner / dialog 位图。

Tauri 的 Windows 打包目标只有 msi / nsis，没有官方 portable 目标；但前端资源在编译期已嵌进二进制，`--no-bundle` 产出的 exe 本身就是便携程序。两点限制：目标机器需要 WebView2 运行时（Win11 自带）；窗口位置与日志仍写 AppData，不随 exe 移动。

首次 `pnpm app:build` 需要编译全部 Rust 依赖，明显慢于增量构建。体积与耗时取决于依赖、工具链、平台和签名配置，以实际产物为准。

## 说明

- 字体用的是 Geist Variable（随包内置），只覆盖拉丁字符，中文走系统字体。
- 需要改主题色，改 `src/index.css` 里的 CSS 变量即可，组件不用动。
- 许可：MIT，全文见 [LICENSE](./LICENSE)。复制成新项目后，记得把版权方换成自己的名字或公司。
