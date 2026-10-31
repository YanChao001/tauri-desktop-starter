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

macOS 需要 Xcode Command Line Tools；Linux 需要 WebKitGTK、编译工具和对应发行版的开发库。Windows 构建 MSI 还需启用 VBScript 可选组件。各平台安装步骤见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)，CI 的软件包列表只对应其 runner 环境。

先安装 Node.js、指定版本的 pnpm 和 rustup。仓库内的 Rust 命令由 rustup 按 `rust-toolchain.toml` 选择工具链；升级工具链时通过 CI 检查受影响的平台。

Linux 上 Node.js 若提示缺少 `libatomic.so.1`，补齐发行版对应的 `libatomic` 运行库后重试。

## 首次启动

以下项目命令均从仓库根目录运行。

```bash
pnpm install --frozen-lockfile
rustup toolchain install
pnpm run doctor
pnpm app:dev
```

第一次 `app:dev` 会编译 Rust 依赖，耗时取决于机器、缓存和网络；后续复用编译缓存，前端修改由 Vite 热更新。

源码入口与两种运行环境见 [README · 从源码运行](../README.md#从源码运行)。`pnpm dev` 与在线演示共用桌面应用的 React 页面；`pnpm app:dev` 同时启动 Rust 和原生窗口。只开发或构建浏览器界面时，安装前端依赖即可，无需编译 Rust。

## 开发流程

先确定本次交付的行为和影响范围，再选择源码入口与验证方式：

| 任务 | 工作路径                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能 | 按 [模块指南](./demo-modules.md) 找到或新增入口，实现当前需求；只有达到 [设计门槛](./engineering-at-scale.md#设计评审与-adr-门槛) 时才先做提案或 ADR。 |
| 修复 | 从 [排障手册](./troubleshooting.md) 定位问题，优先复现；能稳定复现的行为缺陷补针对性回归。                                                             |
| 文档 | 更新事实所属的权威文档，核对实现、格式与链接，规则见 [维护规则](./README.md#维护规则)。                                                                |
| 发布 | 按 [构建与发布](./build-release.md) 准备版本、产物和目标平台验收，保留实际验证结果。                                                                   |

本地检查按 [日常验证范围](./testing.md#日常验证范围) 选择，完成后在 PR 说明行为、验证和未测范围。分支、提交与合并统一遵循 [Git 协作](./conventions/git-workflow.md)。

## 项目初始化

应用身份集中在 [`app.config.json`](../app.config.json)，前端通过 [`src/config/app.ts`](../src/config/app.ts) 使用。准备只包含待覆盖字段的 JSON 补丁，通过 `--config` 传入，便于脚本识别旧身份并保留额外注册项：

```json
{
  "name": "Acme Desk",
  "shortName": "Acme",
  "packageName": "acme-desk",
  "identifier": "io.acme.desk",
  "repositoryUrl": "https://github.com/acme/desk",
  "integration": {
    "deepLinkScheme": "acme-desk",
    "fileExtension": "acme-doc"
  }
}
```

```bash
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
pnpm config:check
```

`--dry-run` 只展示差异；`--minimal` 将默认模式设为精简，也可在 JSON 写 `"defaultMode": "demo"` 切回。未指定模式时保留当前值。精简模式仅过滤 `demoOnly` 展示与命令；真实删除模块或新增页面 / IPC 见 [模块指南](./demo-modules.md)。

脚本同步 npm / Cargo 身份、Tauri 平台配置、测试身份、README 品牌链接及安装关联，先审查 `--dry-run` 差异再写入。写入失败会回滚；发生并发编辑时保留用户内容和 `.update-*.bak` 备份，按报告核对恢复冲突。字段校验与同步目标以 [`scripts/init-lib.mjs`](../scripts/init-lib.mjs) 为准。

初始化时关注以下产品决定：

- 使用独立的包名和反向域名标识符。`integration` 同步深链、文件关联与界面示例；新增协议或文件格式仍需实现对应解析。
- `homepageUrl` 是产品主页，`docsUrl` 是应用内文档入口；更换仓库且未显式提供时回退到新仓库地址。
- 更换标识符或主仓库会清空继承的更新与市场配置；单独换源也会清除旧公钥。显式提供新源及可信公钥后才启用，详见 [更新通道](./security.md#更新通道) 与 [官方插件市场](./extensions.md#官方插件市场)。
- `browserStorageNamespace` 隔离同域下的浏览器偏好、图库与广播，更换标识符时默认随之更换。只有承接同一产品数据时才复用旧值；原生存档路径由 Tauri 标识符决定。

初始化不迁移或删除用户数据。发布后更换标识符、协议、扩展名或存储命名空间，应另行处理数据迁移与安装关联。`pnpm config:check` 只读核对配置与派生值，已纳入 `verify` 和 CI。

随后处理 LICENSE 归属、安全报告渠道、仓库 About、Pages 和 Secrets；签名身份按 [代码签名策略](./code-signing-policy.md) 配置，初始化不修改私钥或签名门户。品牌资源按 [安装器外观](./build-release.md#安装器外观) 生成，版本使用 `pnpm version:set x.y.z` 同步。首次发布用自己的安装包验证身份、深链 / 文件关联及卸载登记。

## 环境诊断

```bash
node scripts/doctor.mjs
node scripts/doctor.mjs --json
```

诊断无需 npm 依赖，只读检查 Node、精确 pnpm / Rust 工具链、Git、依赖与当前平台组件，不自动安装工具；缺少必要组件时退出码为 1。它面向完整桌面环境，纯浏览器开发可忽略缺少 Rust 或桌面组件的结果；诊断通过仍需实际构建与安装验收。

## 常用命令

完整脚本见 [`package.json`](../package.json)。以下保留常用入口；测试命令与选择见 [测试规范](./testing.md#日常验证范围)，扩展开发命令见 [扩展指南](./extensions.md#验证)。

| 命令                                                                                                     | 用途                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm app:dev` / `pnpm dev`                                                                              | 完整桌面开发 / 仅 Vite 浏览器开发（端口 1420）                                              |
| `pnpm run doctor`                                                                                        | 只读环境诊断；未安装依赖时用 `node scripts/doctor.mjs`                                      |
| `pnpm init:project` / `pnpm config:check`                                                                | [初始化](#项目初始化) / 只读配置一致性检查                                                  |
| `pnpm bindings:generate` / `pnpm bindings:check`                                                         | 修改 Rust 命令或 DTO 后生成 / 检查 IPC 绑定，并同步独立 SDK 公共类型                        |
| `pnpm build` / `pnpm preview`                                                                            | 构建 / HTTP 预览桌面前端 `dist/`，预览不提供原生能力                                        |
| `pnpm build:web` / `pnpm exec vite preview --outDir dist-web`                                            | 构建 / 预览浏览器演示                                                                       |
| `pnpm app:build` / `pnpm app:portable`                                                                   | 构建并归档安装包 / Windows 便携包到版本化 `artifacts/`                                      |
| `pnpm verify`                                                                                            | 运行 [前端与工程综合检查](./testing.md#日常验证范围)                                        |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:fix`                                                         | 类型检查 / ESLint / 自动修复                                                                |
| `pnpm format` / `pnpm format:check`                                                                      | 全仓库 Prettier 格式化 / 检查；局部修改用 `pnpm exec prettier --write <文件>`               |
| `pnpm test:ui` / `pnpm test:browser`                                                                     | 构建后运行无头浏览器检查 / 检查已构建的浏览器产物                                           |
| `pnpm device:tool`                                                                                       | 虚拟数据采集与原始记录只读回放，通过无头 CLI 运行，见 [虚拟会话指南](./device-workbench.md) |
| `pnpm clean:outputs` / `pnpm clean:temporary` / `pnpm clean:artifacts` / `pnpm clean` / `pnpm clean:all` | 删除范围见 [下节](#清理构建产物)，均支持 `--dry-run`                                        |
| `pnpm version:set x.y.z` / `pnpm version:check`                                                          | 同步 / 检查配置、清单与锁文件版本                                                           |

## 清理构建产物

所有清理入口统一调用跨平台 [`scripts/clean.mjs`](../scripts/clean.mjs)，均支持 `--dry-run` 只预览，**不带该参数会执行删除**。先检查范围，再执行相同模式：

```bash
pnpm clean:outputs --dry-run
pnpm clean:outputs
```

| 模式                   | 删除范围                                                                                                         | 保留范围                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm clean:outputs`   | 宿主与示例构建输出、安装器暂存、测试报告、截图、工作区临时文件，以及市场的新旧生成包目录                         | 编译缓存、编译工具、已安装依赖、项目源码与正式文档资源 |
| `pnpm clean:temporary` | 固定临时诊断目录、旧 `.portable-previous-*` 备份、构建输出、Rust `target`、生成 schema、依赖内的 Vite / 通用缓存 | 正式版本的安装包和便携分发、实际依赖                   |
| `pnpm clean:artifacts` | 整个 `artifacts/`，包括正式分发与临时诊断文件                                                                    | `dist/`、`dist-web/`、Rust 编译缓存和依赖              |
| `pnpm clean`           | `artifacts/`、`dist/`、`dist-web/`、`coverage/`、默认 `src-tauri/target/` 和生成 schema                          | `node_modules/`                                        |
| `pnpm clean:all`       | `pnpm clean` 的范围，加上 `node_modules/`                                                                        | 项目源码、配置与锁文件                                 |

日常释放产物空间选择 `clean:outputs`：保留 Cargo 缓存、依赖及扩展编译工具，删除固定的生成目录；项目源码、`docs/assets/`、品牌图标和内置扩展资源均保留。`clean:artifacts` 整体删除根 `artifacts/`，其中混入的编译缓存也会被删除。具体目录和历史备份识别规则见 [`scripts/clean-lib.mjs`](../scripts/clean-lib.mjs)，以 `--dry-run` 的实际结果核对范围。

清理不跟随目录链接，也不会结束运行中的进程；执行前停止自己启动的开发或测试进程，遇到占用按报错路径处理。自定义 `CARGO_TARGET_DIR` / Cargo `target-dir` 由设置者管理。删除编译缓存会使下次构建更慢，正常编译等待无需清缓存。

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

`VITE_` 值会进入前端 bundle，应仅放公开配置。新增变量在 `src/vite-env.d.ts` 声明类型，并在使用处校验实际值；仓库只提交写明用途的 `.env.example`。凭据与用户令牌按 [本地数据规范](./security.md#本地数据) 保存。

## 调试

### 前端

- 开发模式下使用 WebView 的开发者工具；Windows 为 WebView2，macOS / Linux 为各自的 WebKit 工具，入口与快捷键随平台不同。
- 调试 React 组件树可在 `pnpm dev` 的普通浏览器预览中使用 React DevTools；浏览器扩展不会自动安装到 Tauri WebView。
- 浏览器预览使用 `pnpm dev`；原生能力页展示运行说明，`lib/tauri.ts` 的环境检查会拒绝实际原生调用。

### Rust

- `println!` / `eprintln!` 在 `app:dev` 的终端里能看到（debug 构建会附带控制台）。
- 项目已接入 `tauri-plugin-log`，用 `log::info!` / `log::error!` 记录上下文；日志位置见 [排障手册](./troubleshooting.md#先看日志)，不要重复注册插件。

仓库已包含 [launch.json](../.vscode/launch.json) 与 [tasks.json](../.vscode/tasks.json)。安装推荐的 CodeLLDB，按 F5 选择：

- `Desktop: Rust + WebView`：先启动 Vite 后用 Cargo 构建并在 LLDB 下运行原生主程序，可在 Rust 文件设断点；`--bin` 选定应用目标，实际二进制路径由 Cargo 返回。项目初始化同步目标包名，避免误选扩展开发工具。
- `Frontend: Chrome`：先启动 Vite，再启动浏览器调试会话，支持 TS / TSX 断点；此模式无原生能力。

后台任务等待 Vite 的 1420 就绪提示后才启动调试；已有服务占用端口时先确认归属并停止自己的开发任务。Cargo 调试绕过 Tauri CLI 的专属构建流程，依赖平台配置或安装器行为时仍使用 `pnpm app:dev` / 正式构建验证。F5 不会自动重启正在调试的 Rust 进程，改 Rust 后重新开始调试。

### 定位"白屏"

按 [排障手册 · 窗口不出现 / 白屏](./troubleshooting.md#窗口不出现--白屏) 检查浏览器渲染、首帧显示、原生日志和资源加载。

## 热更新边界

| 改动                              | 是否自动生效                                              |
| --------------------------------- | --------------------------------------------------------- |
| `src/` 下的 tsx / css             | 是，HMR 秒级                                              |
| `index.html`                      | Vite 通常触发页面整页重载                                 |
| `src-tauri/src/*.rs`              | `app:dev` 自动重编译并重启原生进程                        |
| `src-tauri/tauri.conf.json`       | 检查 CLI 重启日志；未生效时重启 `app:dev`                 |
| `src-tauri/capabilities/*.json`   | 需重新编译原生端；未生效时重启 `app:dev`                  |
| `Cargo.toml` / `Cargo.lock`       | 依赖变化需重新编译；检查 CLI 输出，未生效时重启 `app:dev` |
| `package.json` / `pnpm-lock.yaml` | 前端依赖变化后运行 `pnpm install`；脚本变化后重启相应任务 |

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

先根据报错区分 registry、GitHub 或安装器工具下载，检查当前终端的网络与代理。需要镜像时使用确认可信的来源，配置到用户级 pnpm / Cargo 设置，保留已提交的锁文件来源。NSIS / WiX 下载失败见 [排障手册](./troubleshooting.md#打包时卡在下载-nsis)。

## 编译耗时优化

重复构建较慢时，先确认是否复用了相同工具链、目标目录与编译策略。日常前端迭代用 HMR，原生功能用 `app:dev`；需要分发产物时再执行完整打包。安装包的速度 / 体积取舍见 [编译策略](./build-release.md#编译策略)，正常等待与异常区分见 [Rust 构建停顿](./troubleshooting.md#rust-构建长时间停在-802805)。

## 重置环境

先确认工具链版本、实际报错与锁文件差异。依赖安装损坏时可重新安装，以下命令会清理本地依赖和默认构建目录：

```bash
pnpm clean:all --dry-run
pnpm clean:all
pnpm install --frozen-lockfile
```

## 新增依赖的评审标准

在 PR 说明新增依赖的用途，并按实际影响检查：

1. **体积**：显著影响前端 bundle 时比较构建前后分块，较大的依赖考虑按需引入。
2. **维护状态**：是否仍维护、能否兼容当前工具链、已知问题如何处理？成熟库不以发布频率单独判断。
3. **许可证**：记录许可证、分发方式及需要履行的义务；有疑问时由项目负责人与相关专业人员确认，不能仅凭许可证名称认定可直接分发。

Rust 依赖还需评估编译时间和目标平台兼容性。

现有演示库的用途、许可证和加载边界见 [依赖与加载](./demo-modules.md#依赖与加载)，精确版本读取锁文件。

## IDE 配置

推荐扩展见 [`.vscode/extensions.json`](../.vscode/extensions.json)，包含 Rust / Tauri、CodeLLDB、ESLint、Prettier 和 EditorConfig。F5 用法见 [调试](#调试)；保存格式化、Rust formatter 与搜索排除项已配置在 [`.vscode/settings.json`](../.vscode/settings.json)。

VS Code 资源管理器默认隐藏 `dist/`、`dist-web/` 与 `src-tauri/target/`，搜索和文件监听也排除这些生成目录；Vite 的开发监听同步排除浏览器演示输出。`artifacts/` 保持可见，便于查找最终分发文件；隐藏设置不改变实际构建路径。

## 浏览器演示构建与部署

在线演示直接构建根 `index.html` 与 `src/`，共用桌面页面、样式、路由、词典和资源。浏览器可运行页面及本地 fixture，原生能力由门面进行环境检查，存储范围见 [数据存储](./architecture.md#数据存储)。

```bash
pnpm build:web
pnpm exec vite preview --outDir dist-web
```

发布前按 [浏览器生产构建冒烟](./testing.md#浏览器生产构建冒烟) 运行无头检查，覆盖子路径、键盘、偏好、fixture 与无障碍。

`build:web` 使用 Vite 的 `web-demo` 模式，输出到 `dist-web/`；桌面前端输出到 `dist/`。资源基路径由 [`vite.config.ts`](../vite.config.ts) 配置，通过 HTTP 服务预览构建结果。

HashRouter 将页面路径保留在 `#` 后，静态服务只需提供首页与构建资源，适用于 `/tauri-desktop-starter/` 等项目子路径；部署后复核首页及 `#/components` 等页面的直接访问和刷新。

[`pages.yml`](../.github/workflows/pages.yml) 安装锁定依赖、构建 `dist-web/` 并通过 Playwright 冒烟后，发布 GitHub Pages 在线演示，与桌面安装包发布分别执行。推送到 `develop` 且命中工作流路径时自动部署，也可从该分支手动触发。仓库 Pages 来源须选择 GitHub Actions，`github-pages` 环境须允许 `develop` 部署。

派生项目在初始化补丁的 `homepageUrl` 填写演示或产品主页，`docsUrl` 指向文档入口，并同步仓库 About。
