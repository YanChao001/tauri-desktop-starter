# 开发指南

## 环境要求

| 组件                      | 版本                                                               | 说明                              |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| Node.js                   | [`.nvmrc`](../.nvmrc)；其他支持版本见 [`engines`](../package.json) | 前端构建与测试                    |
| pnpm                      | [`package.json`](../package.json) 的 `packageManager`              | 使用该精确版本，保留 pnpm 锁文件  |
| Rust                      | [`rust-toolchain.toml`](../rust-toolchain.toml)                    | 固定工具链，含 rustfmt / clippy   |
| Visual Studio Build Tools | 含「使用 C++ 的桌面开发」工作负载                                  | 提供 MSVC 链接器，仅 Windows 需要 |
| Windows SDK               | 10.0.19041 以上                                                    | 链接系统库                        |
| WebView2 Runtime          | 任意近期版本                                                       | Win11 自带，Win10 多数已装        |

macOS 需要 Xcode Command Line Tools；Linux 需要 `libwebkit2gtk-4.1-dev` 等依赖，详见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

先安装 Node.js、与 `packageManager` 一致的 pnpm 和 rustup。仓库内运行 Rust 命令时，rustup 会按 `rust-toolchain.toml` 自动安装工具链与组件；CI 也读取该文件。升级版本后需验证三端构建。

## 首次启动

```bash
pnpm install --frozen-lockfile
pnpm app:dev
```

第一次 `app:dev` 会编译全部 Rust 依赖，5–10 分钟属于正常。之后改前端是秒级热更新。

源码入口与两种运行模式见 [README · 从源码运行](../README.md#从源码运行)。`pnpm dev` 适合浏览器预览界面；`pnpm app:dev` 才会启动 Rust 和原生窗口。

## 常用命令

| 命令                     | 作用                                                | 什么时候用                   |
| ------------------------ | --------------------------------------------------- | ---------------------------- |
| `pnpm app:dev`           | 启动完整桌面应用（含 Rust）                         | 日常开发，需要系统能力时     |
| `pnpm dev`               | 只起 Vite（localhost:1420）                         | 纯调样式，不想等 Rust 编译   |
| `pnpm app:build`         | 构建安装包并收集到版本化 `artifacts/`               | 出测试包 / 发布              |
| `pnpm app:portable`      | 收集 Windows exe 与说明到版本化 `artifacts/`        | 内测分发、免安装场景         |
| `pnpm build`             | 只构建前端 `dist/`                                  | 前端验证或原生构建前置       |
| `pnpm preview`           | 通过本地 HTTP 服务预览 `dist/`                      | 检查前端构建结果，无原生能力 |
| `pnpm verify`            | 格式、lint、类型、前端/脚本测试、版本检查、前端构建 | 提交前跑一次；Rust 另查      |
| `pnpm test`              | 跑一遍单元测试                                      | 改完逻辑                     |
| `pnpm test:watch`        | 测试监听模式                                        | 边写边测                     |
| `pnpm test:coverage`     | 生成覆盖率报告                                      | 想知道哪里没测到             |
| `pnpm test:scripts`      | Node 构建与版本脚本回归测试                         | 修改脚本后                   |
| `pnpm typecheck`         | 类型检查，不产物                                    | 排查类型错误                 |
| `pnpm lint`              | ESLint                                              | 排查越界与未使用变量         |
| `pnpm lint:fix`          | ESLint 自动修复                                     | 批量修小问题                 |
| `pnpm format`            | Prettier 格式化                                     | 提交前                       |
| `pnpm clean:artifacts`   | 只删 `artifacts/`，保留 Rust 编译缓存               | 清理最终分发文件             |
| `pnpm clean`             | 清理默认构建产物与缓存，见下节                      | 磁盘吃紧、构建状态异常       |
| `pnpm clean:all`         | 连同 `node_modules` 一起删                          | 准备把工程复制给别人         |
| `pnpm version:set x.y.z` | 同步四处版本号                                      | 发布时                       |
| `pnpm version:check`     | 检查配置、清单与锁文件的版本一致性                  | 修改版本或发布前             |

## 清理构建产物

`pnpm clean:artifacts` 只删除最终分发目录 `artifacts/`，不会清除 `dist/` 或 Rust 编译缓存。`pnpm clean` 删除 `artifacts/`、`dist/`、`coverage/`、默认 `src-tauri/target/` 及旧版遗留的 `dist-portable/`；`pnpm clean:all` 还会删除 `node_modules/`。

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
- 新增的 `VITE_` 变量要在 `src/vite-env.d.ts` 里补类型，否则是 `any`。
- 仓库里只提交 `.env.example`，写清需要哪些变量和用途，不写真实值。

## 调试

### 前端

- 开发模式下使用 WebView 的开发者工具；Windows 为 WebView2，macOS / Linux 为各自的 WebKit 工具，入口与快捷键随平台不同。
- 调试 React 组件树可在 `pnpm dev` 的普通浏览器预览中使用 React DevTools；浏览器扩展不会自动安装到 Tauri WebView。
- 也可以直接 `pnpm dev`，在浏览器里调样式和交互，**但 `invoke` 会失败**——
  `lib/tauri.ts` 里的 `isTauri()` 判断会拦住并给出提示。

### Rust

- `println!` / `eprintln!` 在 `app:dev` 的终端里能看到（debug 构建会附带控制台）。
- 项目已接入 `tauri-plugin-log`，用 `log::info!` / `log::error!` 记录上下文；日志位置见 [排障手册](./troubleshooting.md#先看日志)，不要重复注册插件。

- VS Code 里用 `CodeLLDB` 或 `rust-analyzer` 的「Debug」可以直接给 Rust 打断点，
  需要额外配置 `launch.json`，指向 `src-tauri/target/debug/tauri-desktop-starter.exe`。

### 定位"白屏"

按这个顺序排查，能覆盖九成情况：

1. `pnpm dev` 打开 `localhost:1420`，看前端是否报错（最常见是运行时报错）。
2. 打开 DevTools 看 Console 与 Network。
3. 检查窗口是否被显示：`tauri.conf.json` 里 `visible: false`，前端 `useRevealWindow` 负责 `show()`，
   Rust 侧有 3 秒兜底。如果 3 秒后窗口才出现，说明前端渲染链路有问题。
4. 看 Rust 终端有没有 panic。

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

确实要换端口的话，**两处都要改**：`vite.config.ts` 的 `server.port` 和 `tauri.conf.json` 的 `build.devUrl`。

## 网络慢 / 拉不动依赖

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

## 编译太慢

Rust 首次编译慢是常态。长期开发建议上 `sccache`：

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

不是不能加，但要能回答三个问题：

1. **体积**：前端依赖会不会显著增加 bundle？比较 `pnpm build` 前后的分块体积，较大的依赖考虑按需引入。
2. **维护状态**：最近一次发布是否在一年内？有没有明确的维护者？
3. **许可证**：MIT / Apache-2.0 / BSD 可以直接用；GPL / AGPL 需要法务确认；商业授权组件要走采购。

Rust 侧额外注意：编译时间也是成本，一个依赖可能让 CI 多跑两分钟。

## IDE 配置

项目自带 `.vscode/extensions.json`，打开 VS Code 会提示安装：

- **rust-analyzer**：Rust 补全与跳转，必装
- **Tauri**：`tauri.conf.json` 的 schema 校验与命令入口
- **ESLint**：实时标出问题
- **Prettier**：保存时自动格式化
- **EditorConfig for VS Code**：统一换行与缩进

仓库已包含 [`.vscode/settings.json`](../.vscode/settings.json)，配置保存格式化、Rust 专用 formatter 与搜索排除项；无需再复制一份设置。

VS Code 资源管理器默认隐藏 `dist/` 与 `src-tauri/target/`，保留 `artifacts/` 可见，便于直接找到最终分发文件；隐藏设置不改变实际构建路径。
