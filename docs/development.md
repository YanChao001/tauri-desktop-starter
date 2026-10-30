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

macOS 需要 Xcode Command Line Tools；Linux 需要 WebKitGTK、编译工具和对应发行版的开发库。Windows 构建 MSI 还需启用 VBScript 可选组件。各平台的安装步骤以 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/) 为准，CI 中的软件包列表只对应其 runner 环境。

先安装 Node.js、与 `packageManager` 一致的 pnpm 和 rustup。仓库内运行 Rust 命令时，rustup 会按 `rust-toolchain.toml` 自动安装工具链与组件；CI 也读取该文件。升级版本后需验证三端构建。

默认 Node.js 跟随 `.nvmrc` 固定的 LTS 版本；保留支持的其他版本线也须满足 `engines.node` 的安全补丁下限。Node.js 25 起，官方 Linux 二进制额外依赖 `libatomic`；若启动提示缺少 `libatomic.so.1`，Debian / Ubuntu 可安装 `libatomic1`，其他发行版使用对应运行库包。详见 [Node.js LTS 发布说明](https://nodejs.org/en/blog/release/v26.13.0)。

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

## 项目初始化

应用身份集中在 [`app.config.json`](../app.config.json)，前端入口是 [`src/config/app.ts`](../src/config/app.ts)。准备一份品牌 JSON，使用完整字段或仅填写需要覆盖的字段；`updates` 和 `integration` 按字段合并。变更品牌时通过 `--config` 传入补丁，脚本才能识别并替换旧身份、保留额外注册项：

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
  "homepageUrl": "https://example.com",
  "integration": {
    "deepLinkScheme": "acme-desk",
    "fileExtension": "acme-doc"
  },
  "updates": {
    "endpoint": "https://github.com/acme/desk/releases/latest/download/latest.json",
    "publicKey": ""
  }
}
```

```bash
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
pnpm config:check
```

`--dry-run` 只展示差异；`--minimal` 将默认模式设为精简，也可在 JSON 写 `"defaultMode": "demo"` 切回。未指定模式时保留当前值。精简模式仅过滤 `demoOnly` 展示与命令；真实删除模块或新增页面 / IPC 见 [模块指南](./demo-modules.md)。

脚本在写入前检查配置、Cargo 清单 / 锁文件、版本、入口与路径，再同步品牌、npm / Cargo 身份、Tauri 平台配置、测试身份、README 品牌链接及安装关联。失败时回滚；若文件被并发编辑，则保留用户编辑和 `.update-*.bak` 原备份并报告恢复冲突，核对后再处理。

包名使用小写 kebab-case，标识符使用唯一的至少三段反向域名；应用名须能作为 Windows 文件名。未知字段、含凭据的 URL、版本漂移或不支持的入口会在写入前拒绝。`homepageUrl` 用于 npm / 安装包主页，`docsUrl` 用于应用内文档入口，二者独立。

更换仓库时，未显式提供的主页和文档地址回退到新仓库；更换应用标识符或仓库时，清空继承的更新端点与公钥，显式提供的 `updates` 字段优先。单独更换更新端点也会清空旧公钥，须明确提供该源可信的公钥才能启用；脚本不猜测发布服务。端点或公钥为空时禁用更新请求。

`integration.deepLinkScheme` 和 `fileExtension` 控制安装注册、原生解析和界面示例。二者限定为 1–64 位小写字母、数字或连字符，必须以字母开头，拒绝系统协议和常用文件格式。更换标识符时，未显式提供的值取本次新包名；包名未变则从新标识符转为小写并将点替换为连字符，超过长度时须显式提供短名称。保留额外协议、文件关联和同组其他后缀；新增的自定义协议及文件格式仍需实现各自解析。

浏览器持久化由 `browserStorageNamespace` 隔离设置、主题、壁纸 IndexedDB 和广播通道；原模板保留 `tauri-starter` 以兼容已有数据，更换标识符时默认改为新标识符。只有明确承接同一产品数据时才显式复用旧命名空间；同域名下的独立派生产品应使用不同值。初始化不读取、迁移或删除用户数据，原生存档路径仍由 Tauri 标识符决定。

`pnpm config:check` 已纳入 `verify` 和 CI，只读比较解析后的配置与派生值，接受等价 JSON / TOML 排版；执行初始化时还需能安全定位待改字段，不支持的结构会在写入前拒绝。发布后更换标识符、协议、扩展名或存储命名空间，须设计迁移或重新关联，不能用重新初始化代替升级迁移。

官方扩展市场由 `extensionMarket.repository` 与 `publicKey` 管理。更换应用标识符或主仓库时，默认清空继承的市场配置；单独更换市场仓库也会清除旧公钥，必须显式提供新源可信的公钥。两项均为空时禁用市场，配置不完整则初始化拒绝写入。协议与发布边界见 [官方插件市场](./extensions.md#官方插件市场)。

另行处理 LICENSE 归属、安全私密报告渠道、代码签名与更新公钥；初始化不读取或修改签名私钥。启用 SignPath 时仍需核对 [签名策略](./code-signing-policy.md) 中的实际维护者、资格和范围，并同步门户配置；本地产品名同步不代表门户授权发生变化。README 之外的实际维护者声明不自动改写，GitHub About、Pages 和 Secrets 由派生仓库配置。

品牌图标和安装器主视觉修改 `resources/branding/*.svg`，运行 `pnpm branding:generate`、`pnpm branding:check`，尺寸和映射见 [安装器外观](./build-release.md#安装器外观)。版本使用 `pnpm version:set x.y.z` 同步。初始化后按 [验证范围](./testing.md#日常验证范围) 检查；发布前用自己的安装包验收深链 / 文件关联的冷、热启动、平台配置及卸载登记。

## 环境诊断

```bash
node scripts/doctor.mjs
node scripts/doctor.mjs --json
```

诊断无需 npm 依赖，只读检查 Node、精确 pnpm / Rust 工具链、Git、依赖与当前平台组件，不自动安装工具；缺少必要组件时退出码为 1。它面向完整桌面环境，纯浏览器开发可忽略缺少 Rust 或桌面组件的结果；诊断通过仍需实际构建与安装验收。

## 常用命令

以下命令由 [`package.json`](../package.json) 定义；测试选型与覆盖范围统一见 [测试规范](./testing.md#日常验证范围)。原生验收和截图会占用桌面，按 [桌面干扰边界](./testing.md#避免干扰本机桌面) 安排执行。

| 命令                                                                                                     | 用途                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm app:dev` / `pnpm dev`                                                                              | 完整桌面开发 / 仅 Vite 浏览器开发（端口 1420）                                                    |
| `pnpm run doctor`                                                                                        | 只读环境诊断；未安装依赖时用 `node scripts/doctor.mjs`                                            |
| `pnpm init:project` / `pnpm config:check`                                                                | [初始化](#项目初始化) / 只读配置一致性检查                                                        |
| `pnpm bindings:generate` / `pnpm bindings:check`                                                         | 修改 Rust 命令或 DTO 后生成 / 检查 IPC 绑定，并同步独立 SDK 公共类型                              |
| `pnpm extension:sdk:generate` / `pnpm extension:sdk:check`                                               | 从生成绑定提取 / 检查 SDK 公开 DTO，外部插件用法见 [界面 SDK](../sdk/README.md)                   |
| `pnpm build` / `pnpm preview`                                                                            | 构建 / HTTP 预览桌面前端 `dist/`，预览不提供原生能力                                              |
| `pnpm build:web` / `pnpm exec vite preview --outDir dist-web`                                            | 构建 / 预览浏览器演示                                                                             |
| `pnpm app:build` / `pnpm app:portable`                                                                   | 构建并归档安装包 / Windows 便携包到版本化 `artifacts/`                                            |
| `pnpm verify`                                                                                            | 运行 [前端与工程综合检查](./testing.md#日常验证范围)                                              |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage`                                                   | 单元测试 / 监听 / 按需生成覆盖率                                                                  |
| `pnpm test:scripts`                                                                                      | `scripts/` 和 `e2e/` 的 Node 单元测试                                                             |
| `pnpm typecheck` / `pnpm lint` / `pnpm lint:fix`                                                         | 类型检查 / ESLint / 自动修复                                                                      |
| `pnpm format` / `pnpm format:check`                                                                      | 全仓库 Prettier 格式化 / 检查；局部修改用 `pnpm exec prettier --write <文件>`                     |
| `pnpm test:ui` / `pnpm test:browser`                                                                     | 构建后运行无头浏览器检查 / 检查已构建的浏览器产物                                                 |
| `pnpm e2e:build` / `pnpm test:e2e --interactive`                                                         | 构建隔离原生测试程序 / 运行真实桌面 E2E                                                           |
| `pnpm test:installer --interactive`                                                                      | Windows NSIS 原生绘制回归，需已缓存 NSIS 工具链                                                   |
| `pnpm docs:capture --interactive`                                                                        | Windows 原生截图采集并同步，见 [截图流程](./testing.md#readme-原生截图更新)                       |
| `pnpm docs:previews` / `pnpm docs:previews:check`                                                        | 同步已采集截图 / 只检查已提交截图格式与尺寸，均不启动窗口                                         |
| `pnpm extension:pack` / `pnpm extension:validate` / `pnpm extension:test`                                | 扩展打包 / Rust 预检 / 真实离线 worker fixture，参数见 [扩展指南](./extensions.md#构建-rust-示例) |
| `pnpm device:tool`                                                                                       | 虚拟设备采集与原始记录只读回放，不启动桌面或真实设备，见 [设备工作台指南](./device-workbench.md)  |
| `pnpm extension:demos:check` / `pnpm extension:test:worker` / `pnpm test:extensions:ui`                  | 内置 Wasm 回执 / worker 协议 / 自定义界面检查，见 [扩展验证](./extensions.md#验证)                |
| `pnpm test:extensions:styles`                                                                            | 无头对照真实宿主控件与 SDK 默认外观、Shadow DOM 和键盘语义                                        |
| `pnpm clean:outputs` / `pnpm clean:temporary` / `pnpm clean:artifacts` / `pnpm clean` / `pnpm clean:all` | 删除范围见 [下节](#清理构建产物)，均支持 `--dry-run`                                              |
| `pnpm version:set x.y.z` / `pnpm version:check`                                                          | 同步 / 检查配置、清单与锁文件版本                                                                 |

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

临时模式的构建输出包含 `dist/`、`dist-web/` 和 `coverage/`；schema 为 `src-tauri/gen/schemas/`；依赖内缓存限于 `node_modules/.vite/`、`.vite-temp/` 和 `.cache/`。`clean:artifacts` 会整体删除 `artifacts/`，其中误放的历史编译缓存也会删除；要保留这些缓存应使用 `clean:outputs`。临时诊断目录与备份识别规则以脚本固定列表为准，不接受自定义待删路径。

`clean:outputs` 适合“只保留编译缓存”的日常清理：清理根目录 `artifacts/`、`.cache/` 中的生成内容，以及脚本固定的构建目录，包含 `examples/extensions/dist/`、`marketplace/artifacts/` 和旧 `marketplace/dist/`。该模式保留 `target/` 编译目录（只删除宿主 `target/release/bundle/` 的安装器暂存）、`node_modules/` 及其 Vite 缓存、包管理器缓存，以及 `.cache/extension-tools/` 的编译工具。根目录 `artifacts/`、`.cache/` 内曾混入的 Cargo 缓存按标准 Cargo `CACHEDIR.TAG` 识别并原地保留；不要继续把编译缓存放入产物目录。源码测试、`docs/assets/` 截图、品牌图标与内置扩展资源属于项目内容，不在清理范围。

生成结果按仓库统一使用 `artifacts/`：宿主分发与测试报告位于根目录，独立市场仓库的发布包位于 `marketplace/artifacts/market-<revision>/`，详情见 [市场开发指南](../marketplace/docs/development.md)。市场包不再写入 `marketplace/dist/`，编译缓存留在市场 `target/`；独立检出市场仓库时规则相同。

脚本在受控递归删除前检查项目路径、固定清理范围与链接边界，不跟随目录链接。Windows 上运行中的项目内程序会阻止清理其所在目标，脚本不会结束进程；文件占用、路径边界或权限失败会报告路径并以非零状态退出。执行前自行停止相关开发服务与测试进程。

清理后构建可以重建输出，但删除 Rust 缓存会使下次完整编译更慢；需要保留缓存时选择 `clean:outputs`，不要使用 `clean:temporary`。固定范围以外的自定义 `CARGO_TARGET_DIR` 或 Cargo `target-dir` 由设置者管理。分发目录布局见 [README · 构建产物](../README.md#构建产物)。

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
pnpm clean:all --dry-run
pnpm clean:all
pnpm install --frozen-lockfile
```

## 新增依赖的评审标准

新增前说明以下三项：

1. **体积**：前端依赖会不会显著增加 bundle？比较 `pnpm build` 前后的分块体积，较大的依赖考虑按需引入。
2. **维护状态**：是否仍维护、能否兼容当前工具链、已知问题如何处理？成熟库不以发布频率单独判断。
3. **许可证**：记录许可证、分发方式及需要履行的义务；有疑问时由项目负责人与相关专业人员确认，不能仅凭许可证名称认定可直接分发。

Rust 依赖还需评估编译时间和目标平台兼容性。

现有演示库的用途、许可证和加载边界见 [依赖与加载](./demo-modules.md#依赖与加载)，精确版本读取锁文件。升级时核对这些边界，构建体积与运行性能分别测量。

## IDE 配置

推荐扩展见 [`.vscode/extensions.json`](../.vscode/extensions.json)，包含 Rust / Tauri、CodeLLDB、ESLint、Prettier 和 EditorConfig。F5 用法见 [调试](#调试)；保存格式化、Rust formatter 与搜索排除项已配置在 [`.vscode/settings.json`](../.vscode/settings.json)。

VS Code 资源管理器默认隐藏 `dist/`、`dist-web/` 与 `src-tauri/target/`，搜索和文件监听也排除这些生成目录；Vite 的开发监听同步排除浏览器演示输出。`artifacts/` 保持可见，便于查找最终分发文件；隐藏设置不改变实际构建路径。

## 浏览器演示构建与部署

网页直接展示占满视口的桌面界面，顶部只有应用标题栏；窄屏页面选择入口位于同一标题栏，不附加宣传、下载或演示说明外壳。

在线演示直接构建根 `index.html` 与 `src/`，共用页面、样式、路由、词典和资源。浏览器可运行演示页面及本地 fixture；指定 HTTPS / WSS 示例依赖外部服务，原生能力仍受 `lib/tauri.ts` 环境检查。浏览器存储与桌面原生存档分别维护，范围见 [数据存储](./architecture.md#数据存储)。

```bash
pnpm build:web
pnpm exec vite preview --outDir dist-web
```

发布前按 [浏览器生产构建冒烟](./testing.md#浏览器生产构建冒烟) 运行无头检查，覆盖子路径、键盘、偏好、fixture 与无障碍。

`build:web` 运行类型检查，并以 Vite 的 `web-demo` 模式构建；[`vite.config.ts`](../vite.config.ts) 将资源基路径设为相对路径，输出到 `dist-web/`。桌面构建继续使用 `dist/`，两个输出分别维护。通过 HTTP 服务预览构建结果，不直接打开生成的 HTML。

HashRouter 将页面路径保留在 `#` 后，静态服务只需提供首页与构建资源，适用于 `/tauri-desktop-starter/` 等项目子路径；部署后复核首页及 `#/components` 等页面的直接访问和刷新。

[`pages.yml`](../.github/workflows/pages.yml) 安装锁定依赖、构建 `dist-web/` 并通过 Playwright 冒烟后，发布 GitHub Pages 在线演示，与桌面安装包发布分别执行。推送到 `develop` 且命中工作流路径时自动部署，也可从该分支手动触发。仓库 Pages 来源须选择 GitHub Actions，`github-pages` 环境须允许 `develop` 部署。

派生项目在初始化补丁的 `homepageUrl` 填写实际演示或产品主页，`docsUrl` 指向真实文档入口，并同步仓库 About。界面和能力变化在同一份源码中维护，发布演示前同时复核浏览器边界与桌面行为。
