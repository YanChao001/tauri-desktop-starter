# Tauri Desktop Starter

Tauri 2 + React 19 + TypeScript 的桌面应用基座，包含可切换的演示 / 精简模式、命令面板、中英文、原创 SVG 皮肤，以及原生设置、SQLite、托盘、多窗口、诊断和签名更新链路。更新公钥与正式代码签名由应用维护者配置。

## 快速开始

版本以 [`.nvmrc`](./.nvmrc)、[`package.json`](./package.json) 和 [`rust-toolchain.toml`](./rust-toolchain.toml) 为准。平台依赖见 [开发指南](./docs/development.md#环境要求)。

```bash
pnpm install --frozen-lockfile
rustup toolchain install
pnpm run doctor
pnpm app:dev
```

`node scripts/doctor.mjs` 可在依赖未安装时运行，检查工具版本和当前平台组件并给出修复提示，不会自动安装工具。

## 从源码运行

- `pnpm app:dev`：启动完整桌面应用，前端热更新，Rust 修改后重新编译。
- `pnpm dev`：浏览器访问 `http://localhost:1420`，可调界面；原生页面显示不可用提示。
- `pnpm build` / `pnpm preview`：构建并预览前端，仍没有 Rust 进程。

前端入口是根目录 [`index.html`](./index.html) → [`src/main.tsx`](./src/main.tsx) → [`src/App.tsx`](./src/App.tsx)；原生入口是 [`src-tauri/src/main.rs`](./src-tauri/src/main.rs) → [`lib.rs`](./src-tauri/src/lib.rs)。编辑 `src/` 和 `src-tauri/src/`；`dist/index.html` 是生成文件，不应手改或双击作为应用入口。

VS Code 已包含前端与 Rust 的 F5 配置，见 [调试说明](./docs/development.md#调试)。

## 已有能力

| 领域       | 实现                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 外观       | 明暗 / 系统主题，主题色、圆角、字体、字号、动效；纯色和星光、樱花、月夜、枝叶、云景原创 SVG 插画，覆盖整个窗口并复用画廊预览 |
| 语言       | 简体中文 / English；首次按系统偏好匹配，用户选择优先；标题栏与设置页共用语言注册表                                           |
| 快捷操作   | 命令面板、菜单和快捷键共用命令注册表；设置搜索、侧栏折叠与键盘 / 拖拽调宽                                                    |
| 恢复与存储 | 页面局部错误恢复；schema 2 设置迁移、原生原子写入、保存状态 / 重试、revision 冲突处理与跨窗口同步；浏览器使用 localStorage   |
| 原生桌面   | 单实例恢复、主 / 次窗口、窗口位置记忆、托盘、可选后台运行和登录启动；macOS 保留系统红绿灯                                    |
| 数据示例   | Rust `rusqlite` 管理 SQLite 迁移与笔记 CRUD（显式保存），参数化查询及版本冲突处理                                            |
| IPC        | Rust 命令生成 TypeScript 绑定，统一结构化错误，页面只调用 `src/lib/tauri.ts`                                                 |
| 诊断与更新 | 环境 / 存储 / 运行状态报告、脱敏日志预览；GitHub Releases 更新源、检查 / 下载 / 安装 / 重启状态，配置公钥后启用验证          |
| 验证与发布 | 前端 / 脚本 / Rust 测试、真实桌面 E2E、三端 CI、版本化分发目录和 SHA-256 清单                                                |

纯色之外的皮肤使用程序化 SVG，没有内嵌位图或远端素材；高对比度模式会移除装饰。应用内中英文覆盖模板界面与自带 IPC 示例，安装器和系统组件有各自的语言设置。

默认关闭最后一个窗口时退出应用；其他窗口仍打开时可继续使用。开启后台运行且托盘创建成功时，关窗隐藏到托盘。菜单「退出」始终退出。更新功能默认缺少公钥，显示未配置且不发起更新请求；Windows 安装更新可能结束当前进程并由安装器重新打开，安装前须保存各窗口内容。配置步骤见 [自动更新](./docs/build-release.md#自动更新)。

## 拿它开新项目

品牌字段集中在 [`app.config.json`](./app.config.json)，前端从 [`src/config/app.ts`](./src/config/app.ts) 使用。准备一份 JSON，填写或覆盖应用名、简称、包名、唯一反向域名标识符、描述、作者、仓库与文档地址：

```bash
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
# 需要精简初始界面时，在两条命令中都增加 --minimal
pnpm verify
```

脚本预检完整 JSON / Cargo TOML、版本、入口和路径，先展示差异，再同步 package、Cargo 包 / 库 / 默认入口 / 锁文件、Rust 辅助入口、原生主 / 平台标题及 HTML 标题。失败时恢复已提交文件；遇到并发编辑则保留用户修改与原备份并报告冲突。`--dry-run` 不写文件；`--minimal` 设置精简默认模式，源码演示仍保留。

图标与安装器位图、安全报告渠道、许可证归属、签名和更新公钥需另外配置。初始化不会生成或修改签名私钥；版本使用 `pnpm version:set`。详细字段和边界见 [项目初始化](./docs/development.md#项目初始化)。发布后应保持应用 `identifier` 稳定，它关联安装升级与用户数据目录。

## 目录结构

```text
app.config.json              品牌与部署默认值
src/
  config/                    品牌入口
  routes.tsx                 页面、导航与命令可用性的路由来源
  commands/                  命令描述、快捷键匹配、设置搜索索引
  layouts/                   应用外壳
  pages/                     概览、演示、设置、桌面、数据库、诊断、更新
  components/                外壳 / 交互 / 恢复边界；ui/ 为 shadcn 组件
  providers/                 设置、语言、命令 Context
  i18n/                      中英文词典和 locale 注册表
  lib/                       原生门面、生成绑定、设置模型与同步、工具
src-tauri/
  src/lib.rs                 插件、状态、命令与生命周期组装
  src/commands.rs            IPC 边界
  src/{storage,database,desktop,diagnostics,updater}.rs
  src/bindings.rs            Rust 命令与类型导出注册
  capabilities/              核心 / 插件权限
  tauri*.conf.json           主、平台与 E2E 配置
scripts/                     初始化、诊断、绑定、版本、构建、收集与清理
e2e/                         隔离构建、两阶段进程测试与真实桌面断言
docs/                        工程文档，入口 docs/README.md
.vscode/                     工作区设置、任务与 F5 调试入口
```

原生调用、状态与安全边界见 [架构说明](./docs/architecture.md)。已有 shadcn 组件在 `src/components/ui/`；添加组件使用 `pnpm dlx shadcn@latest add <name>`，升级时保留本地行为修复。

## 验证

```bash
pnpm verify          # 格式、lint、TS、前端 / 脚本测试、版本与前端构建
pnpm bindings:check  # Rust IPC 导出与已提交的绑定一致
pnpm test:e2e        # 构建隔离测试应用，运行真实桌面 E2E
```

`pnpm verify` 不编译 Rust。修改原生端还需执行 [Rust 检查](./docs/testing.md#rust-测试)。E2E 通过测试 feature、独立 `.e2e` 标识和临时数据目录运行；两次独立应用进程覆盖启动、真实 IPC 成功 / 失败、中英文、窗口操作、多窗口同步、SQLite 冲突处理，以及设置和笔记重启恢复。三端运行环境和验证边界见 [测试规范](./docs/testing.md)。

[`pnpm-workspace.yaml`](./pnpm-workspace.yaml) 对当前 WDIO 工具链的旧传递依赖范围设置 scoped overrides，修补 glob、序列化、Mocha / diff，并移除旧浏览器下载工具的脆弱 ZIP 依赖路径；升级后需重跑真实 E2E。2026-10-20 用官方源执行 `pnpm audit --registry https://registry.npmjs.org` 返回 0 个已知漏洞，此结果不保证未来扫描不变；Rust 信息告警跟踪见 [安全规范](./docs/security.md#已记录的间接依赖告警)。

## 构建产物

```bash
pnpm app:build     # 安装包
pnpm app:portable  # Windows 便携 exe 与使用说明
```

最终交付统一在 `artifacts/<version>/<target-triple>/`：

```text
artifacts/0.1.0/x86_64-pc-windows-msvc/
  installers/       # nsis/、msi/ 等安装包与 manifest.json
  portable/         # exe、使用说明.txt 与 manifest.json
```

每次只替换当前版本 / target 下的整类 `installers/` 或 `portable/`，保留其他版本、平台和另一类产物。清单记录普通文件 SHA-256，目录包记录类型。Windows 提供 NSIS / MSI，macOS 提供 DMG / APP，Linux 提供 DEB / AppImage。

`dist/` 保留 Vite 默认前端输出；`src-tauri/target/` 保留 Cargo 缓存和 Tauri 原始输出；旧 `dist-portable/` 仅兼容清理，不接收新产物。`pnpm clean:artifacts` 只清理 `artifacts/`，`pnpm clean` 清理默认构建目录，范围见 [清理说明](./docs/development.md#清理构建产物)。E2E 失败截图与日志位于 `artifacts/e2e/`。

便携版仍依赖系统 WebView2，设置、数据库与日志写入当前用户目录；免安装不代表数据跟随 exe 移动。当前便携版内安装更新会转为安装版，保留免安装形态需手动下载新版 portable。`--no-bundle` 不会执行安装器签名。参数、签名、更新包与发布步骤见 [构建与发布](./docs/build-release.md)。

## 文档与协作

完整入口：[文档索引](./docs/README.md)。开发规范见 [代码风格](./docs/conventions/code-style.md)、[界面规范](./docs/conventions/ui-guidelines.md) 和 [Git 协作](./docs/conventions/git-workflow.md)；贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全报告见 [SECURITY.md](./SECURITY.md)。
