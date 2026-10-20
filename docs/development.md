# 开发指南

## 环境要求

| 组件                      | 版本                                                               | 说明                              |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| Node.js                   | [`.nvmrc`](../.nvmrc)；其他支持版本见 [`engines`](../package.json) | 前端构建与测试                    |
| pnpm                      | [`package.json`](../package.json) 的 `packageManager`              | 使用该精确版本，保留 pnpm 锁文件  |
| Rust                      | [`rust-toolchain.toml`](../rust-toolchain.toml)                    | 固定工具链，含 rustfmt / clippy   |
| Visual Studio Build Tools | 含「使用 C++ 的桌面开发」工作负载                                  | 提供 MSVC 链接器，仅 Windows 需要 |
| Windows SDK               | 兼容当前 Windows / Rust MSVC 工具链的版本                          | 链接系统库                        |
| WebView2 Runtime          | 支持目标 Windows 版本的 Evergreen Runtime                          | 未安装时需按平台说明准备          |

macOS 需要 Xcode Command Line Tools；Linux 需要 WebKitGTK、编译工具和对应发行版的开发库。各平台的安装步骤以 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/) 为准，CI 中的软件包列表只对应其 runner 环境。

先安装 Node.js、与 `packageManager` 一致的 pnpm 和 rustup。仓库内运行 Rust 命令时，rustup 会按 `rust-toolchain.toml` 自动安装工具链与组件；CI 也读取该文件。升级版本后需验证三端构建。

## 首次启动

```bash
pnpm install --frozen-lockfile
rustup toolchain install
pnpm run doctor
pnpm app:dev
```

第一次 `app:dev` 会编译 Rust 依赖，耗时取决于机器、缓存和网络；后续复用编译缓存，前端修改由 Vite 热更新。

源码入口与两种运行环境见 [README · 从源码运行](../README.md#从源码运行)。`pnpm dev` 与在线演示共用桌面应用的 React 页面；`pnpm app:dev` 同时启动 Rust 和原生窗口。只开发或构建浏览器界面时，安装前端依赖即可，无需编译 Rust。

## 项目初始化

应用身份集中在 [`app.config.json`](../app.config.json)，前端入口是 [`src/config/app.ts`](../src/config/app.ts)。准备一份品牌 JSON，使用完整字段或仅填写需要覆盖的字段；`updates` 也按字段合并：

```json
{
  "name": "Acme Desk",
  "shortName": "Acme",
  "packageName": "acme-desk",
  "identifier": "io.acme.desk",
  "description": "Acme desktop application",
  "author": "Acme",
  "repositoryUrl": "https://github.com/acme/desk",
  "docsUrl": "https://example.com/docs",
  "updates": {
    "endpoint": "https://github.com/acme/desk/releases/latest/download/latest.json",
    "publicKey": ""
  }
}
```

```bash
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
```

`--dry-run` 展示差异且不写文件；`--minimal` 将默认模式设为精简，源码演示仍保留。默认新模板为 demo；已有配置不指定模式时保留当前值，需要切回可在 JSON 写 `"defaultMode": "demo"`。

脚本先检查所有 JSON、完整 Cargo TOML / lock、四处版本、原生入口与路径，再暂存和提交变更：品牌、npm / Cargo 包与库、Cargo `default-run` / lock、主程序与辅助导出入口、Tauri 主 / 平台标题、测试标识符及 HTML 标题。失败时恢复原文件；若文件被并发编辑，保留用户编辑和 `.update-*.bak` 原备份并报告恢复冲突，核对后再手动处理。

包名使用小写 kebab-case，标识符使用唯一的至少三段反向域名；应用名须能作为 Windows 文件名。未知字段、含凭据的 URL、版本漂移或不支持的入口会在写入前拒绝。修改仓库地址不会自动猜测更新服务，`updates.endpoint` 应同时按实际部署填写；空公钥禁用更新请求。

另行处理 LICENSE 归属、安全私密报告渠道、代码签名与更新公钥；初始化不读取或修改签名私钥。启用 SignPath 时还需更新 `.signpath/artifact-configuration.xml` 的产品名称限制和 [签名策略](./code-signing-policy.md) 中的维护者、范围，并同步门户配置。

品牌图标和安装器主视觉统一修改 `resources/branding/*.svg`，运行 `pnpm branding:generate` 生成平台格式，再用 `pnpm branding:check` 检查一致性，尺寸和映射见 [构建与发布](./build-release.md#安装器外观)。版本仍用 `pnpm version:set`，然后运行 `pnpm verify`、Rust 检查与目标平台安装测试。

## 环境诊断

```bash
node scripts/doctor.mjs
node scripts/doctor.mjs --json
```

无需先安装 npm 依赖。诊断检查 Node engines、精确 pnpm / Rust 工具链、Git、依赖安装状态和当前平台组件：Windows 的 MSVC / SDK / WebView2，macOS 的 Xcode Command Line Tools，Linux 的 WebKitGTK / AppIndicator / SVG 开发库与图形会话。只读探测，不自动下载工具；缺少必要组件退出码为 1，警告与错误分别显示。它不替代真实编译、签名或安装验收。

## 常用命令

| 命令                                       | 作用                                                | 什么时候用                   |
| ------------------------------------------ | --------------------------------------------------- | ---------------------------- |
| `pnpm app:dev`                             | 启动完整桌面应用（含 Rust）                         | 日常开发，需要系统能力时     |
| `pnpm run doctor`                          | 实际检查工具与平台环境                              | 首次启动、环境异常           |
| `pnpm init:project`                        | 同步品牌、应用身份与精简默认模式                    | 派生新项目                   |
| `pnpm bindings:generate`                   | 从 Rust 导出 TypeScript IPC 绑定                    | 修改命令或 DTO 后            |
| `pnpm bindings:check`                      | 检查生成绑定未漂移                                  | 提交原生改动前               |
| `pnpm test:e2e`                            | 隔离构建并运行真实桌面进程测试                      | 改启动、窗口或 IPC 主链路后  |
| `pnpm dev`                                 | 只起 Vite（localhost:1420）                         | 纯调样式，不想等 Rust 编译   |
| `pnpm app:build`                           | 构建安装包并收集到版本化 `artifacts/`               | 出测试包 / 发布              |
| `pnpm app:portable`                        | 收集 Windows exe 与说明到版本化 `artifacts/`        | 内测分发、免安装场景         |
| `pnpm build`                               | 只构建前端 `dist/`                                  | 前端验证或原生构建前置       |
| `pnpm preview`                             | 通过本地 HTTP 服务预览 `dist/`                      | 检查前端构建结果，无原生能力 |
| `pnpm build:web`                           | 构建浏览器演示到 `dist-web/`                        | 在线演示发布                 |
| `pnpm exec vite preview --outDir dist-web` | 通过本地 HTTP 服务预览浏览器演示                    | 检查演示构建与路由           |
| `pnpm verify`                              | 格式、lint、类型、前端/脚本测试、版本检查、前端构建 | 提交前跑一次；Rust 另查      |
| `pnpm test`                                | 执行单元测试                                        | 逻辑变更后                   |
| `pnpm test:watch`                          | 测试监听模式                                        | 边写边测                     |
| `pnpm test:coverage`                       | 生成覆盖率报告                                      | 想知道哪里没测到             |
| `pnpm test:scripts`                        | Node 构建与版本脚本回归测试                         | 修改脚本后                   |
| `pnpm typecheck`                           | 类型检查，不产物                                    | 排查类型错误                 |
| `pnpm lint`                                | ESLint                                              | 排查越界与未使用变量         |
| `pnpm lint:fix`                            | ESLint 自动修复                                     | 批量修小问题                 |
| `pnpm format`                              | Prettier 格式化                                     | 提交前                       |
| `pnpm clean:artifacts`                     | 只删 `artifacts/`，保留 Rust 编译缓存               | 清理最终分发文件             |
| `pnpm clean`                               | 清理默认构建产物与缓存，见下节                      | 磁盘吃紧、构建状态异常       |
| `pnpm clean:all`                           | 连同 `node_modules` 一起删                          | 准备把工程复制给别人         |
| `pnpm version:set x.y.z`                   | 同步四处版本号                                      | 发布时                       |
| `pnpm version:check`                       | 检查配置、清单与锁文件的版本一致性                  | 修改版本或发布前             |

## 清理构建产物

`pnpm clean:artifacts` 只删除最终分发目录 `artifacts/`，保留 `dist/`、`dist-web/` 和 Rust 编译缓存。`pnpm clean` 删除 `artifacts/`、`dist/`、`dist-web/`、`coverage/`、默认 `src-tauri/target/` 及旧版遗留的 `dist-portable/`；`pnpm clean:all` 还会删除 `node_modules/`。

清理后构建可以重建输出，但删除 Rust 缓存会使下次完整编译更慢。`CARGO_TARGET_DIR` 或 Cargo `target-dir` 指向的自定义目录不在固定清理范围内，由设置者管理。分发目录布局见 [README · 构建产物](../README.md#构建产物)。

复制工程优先使用 Git clone 或模板仓库，避免携带本地依赖与缓存。

## 环境变量

Vite 只把 `VITE_` 开头的变量注入前端代码，其余变量前端读不到。

```bash
# .env.local —— 已被 .gitignore 忽略，不要提交
VITE_API_BASE=https://api.example.com
```

```ts
const base = import.meta.env.VITE_API_BASE;
```

注意事项：

- 前端能读到的变量会被**打进 bundle**，任何人解包都能看到，不要放密钥。
- 需要保密的值由 Rust 或服务端使用，只向界面返回操作结果；不要通过命令把密钥返回前端。桌面应用随包携带的凭据仍可被提取，用户令牌应按 [本地数据规范](./security.md#本地数据) 保存。
- 新增的 `VITE_` 变量要在 `src/vite-env.d.ts` 里声明类型，并在使用处校验必填值和格式；类型声明不能保证部署时实际提供了变量。
- 仓库里只提交 `.env.example`，写清需要哪些变量和用途，不写真实值。

## 调试

### 前端

- 开发模式下使用 WebView 的开发者工具；Windows 为 WebView2，macOS / Linux 为各自的 WebKit 工具，入口与快捷键随平台不同。
- 调试 React 组件树可在 `pnpm dev` 的普通浏览器预览中使用 React DevTools；浏览器扩展不会自动安装到 Tauri WebView。
- 浏览器预览使用 `pnpm dev`；原生能力页展示运行说明，`lib/tauri.ts` 的环境检查会拒绝实际原生调用。

### Rust

- `println!` / `eprintln!` 在 `app:dev` 的终端里能看到（debug 构建会附带控制台）。
- 项目已接入 `tauri-plugin-log`，用 `log::info!` / `log::error!` 记录上下文；日志位置见 [排障手册](./troubleshooting.md#先看日志)，不要重复注册插件。

仓库已包含 [launch.json](../.vscode/launch.json) 与 [tasks.json](../.vscode/tasks.json)。安装推荐的 CodeLLDB，按 F5 选择：

- `Desktop: Rust + WebView`：先启动 Vite 后用 Cargo 构建并在 LLDB 下运行原生主程序，可在 Rust 文件设断点；二进制由 Cargo 元数据选择，不硬编码品牌文件名。
- `Frontend: Chrome`：先启动 Vite，再启动浏览器调试会话，支持 TS / TSX 断点；此模式无原生能力。

后台任务等待 Vite 的 1420 就绪提示后才启动调试；已有服务占用端口时先确认归属并停止自己的开发任务。Cargo 调试绕过 Tauri CLI 的专属构建流程，依赖平台配置或安装器行为时仍使用 `pnpm app:dev` / 正式构建验证。F5 不会自动重启正在调试的 Rust 进程，改 Rust 后重新开始调试。

### 定位"白屏"

按 [排障手册 · 窗口不出现 / 白屏](./troubleshooting.md#窗口不出现--白屏) 检查浏览器渲染、首帧显示、原生日志和资源加载。

## 热更新边界

| 改动                            | 是否自动生效                              |
| ------------------------------- | ----------------------------------------- |
| `src/` 下的 tsx / css           | 是，HMR 秒级                              |
| `index.html`                    | Vite 通常触发页面整页重载                 |
| `src-tauri/src/*.rs`            | `app:dev` 自动重编译并重启原生进程        |
| `src-tauri/tauri.conf.json`     | 检查 CLI 重启日志；未生效时重启 `app:dev` |
| `src-tauri/capabilities/*.json` | 需重新编译原生端；未生效时重启 `app:dev`  |
| `Cargo.toml` / `package.json`   | 否，需重新安装依赖并重启                  |

## 端口被占用

`vite.config.ts` 里 `strictPort: true`，1420 被占会直接报错而不是自动换端口（Tauri 需要固定端口）。

```powershell
# Windows 查占用
netstat -ano | findstr :1420
# 确认进程归属后，关闭对应程序或停止该进程
Get-Process -Id <pid>
Stop-Process -Id <pid>
```

更换端口时同步 `vite.config.ts` 的 `server.port`、`tauri.conf.json` 的 `build.devUrl`，以及 `.vscode/` 中的浏览器 URL 和任务就绪匹配规则；然后重启开发服务与调试任务。

## 依赖下载失败或缓慢

需要镜像时，先确认镜像来源可信，再配置到用户级设置，不要修改已提交的锁文件来源：

```toml
# ~/.cargo/config.toml
[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"
```

```bash
pnpm config set --global registry https://registry.npmmirror.com
```

如果打包时卡在下载 NSIS / WiX 工具链，见 [排障手册](./troubleshooting.md#打包时卡在下载-nsis)。

## 编译耗时优化

Rust 首次编译会构建依赖。重复构建较慢时，先确认是否命中缓存；需要共享编译缓存时可评估 `sccache`：

```bash
cargo install sccache
```

```toml
# ~/.cargo/config.toml
[build]
rustc-wrapper = "sccache"
```

`src-tauri/target` 可能增长到数 GB。仅在需要释放磁盘或定位缓存问题时运行 `pnpm clean`，它会导致下一次完整编译。

## 重置环境

先确认工具链版本、实际报错与锁文件差异。依赖安装损坏时可重新安装，以下命令会清理本地依赖和默认构建目录：

```bash
pnpm clean:all
pnpm install --frozen-lockfile
```

## 新增依赖的评审标准

新增前说明以下三项：

1. **体积**：前端依赖会不会显著增加 bundle？比较 `pnpm build` 前后的分块体积，较大的依赖考虑按需引入。
2. **维护状态**：是否仍维护、能否兼容当前工具链、已知问题如何处理？成熟库不以发布频率单独判断。
3. **许可证**：记录许可证、分发方式及需要履行的义务；有疑问时由项目负责人与相关专业人员确认，不能仅凭许可证名称认定可直接分发。

Rust 依赖还需评估编译时间和目标平台兼容性。

## IDE 配置

项目自带 `.vscode/extensions.json`，打开 VS Code 会提示安装：

- **rust-analyzer**：Rust 补全与跳转，必装
- **CodeLLDB**：F5 调试 Rust / WebView 主程序
- **Tauri**：`tauri.conf.json` 的 schema 校验与命令入口
- **ESLint**：实时标出问题
- **Prettier**：保存时自动格式化
- **EditorConfig for VS Code**：统一换行与缩进

仓库已包含 [`.vscode/settings.json`](../.vscode/settings.json)，配置保存格式化、Rust 专用 formatter 与搜索排除项；无需再复制一份设置。

VS Code 资源管理器默认隐藏 `dist/`、`dist-web/` 与 `src-tauri/target/`，搜索和文件监听也排除这些生成目录；Vite 的开发监听同步排除浏览器演示输出。`artifacts/` 保持可见，便于查找最终分发文件；隐藏设置不改变实际构建路径。

## 浏览器演示构建与部署

在线演示直接构建根 `index.html` 与 `src/`，共用页面、样式、路由、词典和矢量资源。展厅、交互场景、动效实验室、导航和外观设置在浏览器中运行；原生能力页面提供功能说明与导览，系统调用仍受 `lib/tauri.ts` 的环境检查约束。浏览器偏好写入当前站点的 localStorage，桌面设置与笔记继续由 Rust 原生存储维护。

```bash
pnpm build:web
pnpm exec vite preview --outDir dist-web
```

`build:web` 运行类型检查，并以 Vite 的 `web-demo` 模式构建；[`vite.config.ts`](../vite.config.ts) 将资源基路径设为相对路径，输出到 `dist-web/`。桌面构建继续使用 `dist/`，两个输出分别维护。通过 HTTP 服务预览构建结果，不直接打开生成的 HTML。

HashRouter 将页面路径保留在 `#` 后，静态服务只需提供首页与构建资源，适用于 `/tauri-desktop-starter/` 等项目子路径。部署后检查首页、`#/components` 等页面的直接访问与刷新，以及语言、主题、设置保存、动效暂停、窄屏布局和原生能力说明。

[`pages.yml`](../.github/workflows/pages.yml) 安装锁定依赖、执行 `pnpm build:web` 并将 `dist-web/` 发布到 [GitHub Pages 在线演示](https://yanchao001.github.io/tauri-desktop-starter/)，与桌面安装包发布分别执行。推送到 `develop` 且命中工作流路径时自动部署，也可从该分支手动触发。仓库 Pages 来源须选择 GitHub Actions，`github-pages` 环境须允许 `develop` 部署。

派生项目需同步仓库 About 与 README 的演示地址，并将 `app.config.json` 的 `docsUrl` 指向真实工程文档入口。界面和能力变化在同一份源码中维护，发布演示前同时复核浏览器边界与桌面行为。
