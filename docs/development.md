# 开发指南

## 环境要求

| 组件             | 版本                                 | 说明                             |
| ---------------- | ------------------------------------ | -------------------------------- |
| Node.js          | 22.12+（见 `.nvmrc`）                | 前端构建                         |
| pnpm             | 12+                                  | 包管理器，不要用 npm 生成锁文件  |
| Rust             | 1.88+（stable-msvc）                 | edition 2024 与 let-chain 的要求 |
| Visual Studio    | 2022/2026，含「使用 C++ 的桌面开发」 | 提供 MSVC 链接器                 |
| Windows SDK      | 10.0.19041 以上                      | 链接系统库                       |
| WebView2 Runtime | 任意近期版本                         | Win11 自带，Win10 多数已装       |

macOS 需要 Xcode Command Line Tools；Linux 需要 `libwebkit2gtk-4.1-dev` 等依赖，详见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

## 首次启动

```bash
pnpm install
pnpm app:dev
```

第一次 `app:dev` 会编译全部 Rust 依赖，5–10 分钟属于正常。之后改前端是秒级热更新。

## 常用命令

| 命令                     | 作用                        | 什么时候用                 |
| ------------------------ | --------------------------- | -------------------------- |
| `pnpm app:dev`           | 启动完整桌面应用（含 Rust） | 日常开发，需要系统能力时   |
| `pnpm dev`               | 只起 Vite（localhost:1420） | 纯调样式，不想等 Rust 编译 |
| `pnpm app:build`         | 打包安装程序                | 出测试包 / 发布            |
| `pnpm typecheck`         | 类型检查，不产物            | 提交前                     |
| `pnpm lint`              | ESLint                      | 提交前                     |
| `pnpm format`            | Prettier 格式化             | 提交前                     |
| `pnpm version:set x.y.z` | 同步三处版本号              | 发布时                     |

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
- 需要保密的值放在 Rust 侧：用 `std::env::var("XXX")` 或配置文件读取，再通过命令返回结果。
- 新增的 `VITE_` 变量要在 `src/vite-env.d.ts` 里补类型，否则是 `any`。
- 仓库里只提交 `.env.example`，写清需要哪些变量和用途，不写真实值。

## 调试

### 前端

- 开发模式下窗口内右键 →「检查」，或 `Ctrl + Shift + I`，打开的是标准 Chromium DevTools。
- React 组件树用 React DevTools（需要单独装浏览器扩展，或在 DevTools 里加载）。
- 也可以直接 `pnpm dev`，在浏览器里调样式和交互，**但 `invoke` 会失败**——
  `lib/tauri.ts` 里的 `isTauri()` 判断会拦住并给出提示。

### Rust

- `println!` / `eprintln!` 在 `app:dev` 的终端里能看到（debug 构建会附带控制台）。
- 需要结构化日志时接入 `tauri-plugin-log`：

```rust
.plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
```

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

| 改动                            | 是否自动生效                         |
| ------------------------------- | ------------------------------------ |
| `src/` 下的 tsx / css           | 是，HMR 秒级                         |
| `index.html`                    | 否，需刷新                           |
| `src-tauri/src/*.rs`            | 否，`app:dev` 会自动重编译并重启窗口 |
| `src-tauri/tauri.conf.json`     | 否，需要重启 `app:dev`               |
| `src-tauri/capabilities/*.json` | 否，需要重启                         |
| `Cargo.toml` / `package.json`   | 否，需重新安装依赖并重启             |

## 端口被占用

`vite.config.ts` 里 `strictPort: true`，1420 被占会直接报错而不是自动换端口（Tauri 需要固定端口）。

```bash
# Windows 查占用
netstat -ano | findstr :1420
taskkill /PID <pid> /F
```

确实要换端口的话，**两处都要改**：`vite.config.ts` 的 `server.port` 和 `tauri.conf.json` 的 `build.devUrl`。

## 网络慢 / 拉不动依赖

国内环境建议配镜像，只影响本机，不要提交到仓库。

```toml
# ~/.cargo/config.toml
[source.crates-io]
replace-with = "rsproxy-sparse"

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"
```

```bash
pnpm config set registry https://registry.npmmirror.com
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

另外 `src-tauri/target` 会涨到几个 GB，属于正常现象，不要手动删（删了下次要重编十分钟）。

## 重置环境

改了依赖、锁文件冲突、玄学编译错误，按这个顺序来：

```bash
rm -rf node_modules dist
pnpm install

# 还不行再清 Rust 缓存（代价是重新编译）
rm -rf src-tauri/target
```

## 新增依赖的评审标准

不是不能加，但要能回答三个问题：

1. **体积**：前端依赖会不会把 bundle 撑大？`pnpm build` 后有体积报告，单包超过 100KB 要考虑按需引入或替代方案。
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

保存时自动格式化的设置（`.vscode/settings.json`，可选）：

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[rust]": { "editor.defaultFormatter": "rust-lang.rust-analyzer" }
}
```
