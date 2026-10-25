# Tauri Desktop Starter

[在线演示](https://yanchao001.github.io/tauri-desktop-starter/) · [English](./README.en.md) · [文档索引](./docs/README.md) · [发行记录](https://github.com/YanChao001/tauri-desktop-starter/releases) · [Code signing policy](./docs/code-signing-policy.md)

Tauri 2 + React 19 + TypeScript 桌面应用基座。默认保留完整、可操作的 demo，体验后按产品需要裁剪；`minimal` 仅隐藏演示入口，不删除源码、依赖或权限。

桌面与浏览器共用 `src/`。浏览器可体验交互、动效、CSV 数据工作流、网络 fixture、媒体和外观；原生文件、数据库、系统集成、可安装扩展和更新安装需要桌面环境。

| 亮色                                             | 暗色                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| ![展厅亮色主题](./docs/assets/preview-light.png) | ![展厅暗色主题](./docs/assets/preview-dark.png) |

以上为隔离 Windows 桌面构建的原生截图，按 [截图更新流程](./docs/testing.md#readme-原生截图更新) 在本地采集并随功能 PR 提交，发布时随代码进入 `main`。皮肤资源见 [说明](./resources/skins/README.md)。

## 快速开始

工具版本以 [`.nvmrc`](./.nvmrc)、[`package.json`](./package.json) 和 [`rust-toolchain.toml`](./rust-toolchain.toml) 为准；平台依赖见 [环境要求](./docs/development.md#环境要求)。

```sh
pnpm install --frozen-lockfile
rustup toolchain install
pnpm run doctor
pnpm app:dev
```

只体验浏览器界面时，安装前端依赖后运行 `pnpm dev`，访问 `http://localhost:1420`。未安装依赖也可运行 `node scripts/doctor.mjs` 诊断环境。

## 已有能力

| 领域       | 可操作演示                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 交互与动效 | 创意展厅、外观预览 / 应用 / 撤销；表单、控件状态、反馈、收藏；弹簧、共享布局、倾斜与 SVG 路径                |
| 外观与导航 | 中英文、明暗 / 系统主题、强调色、字体、圆角；八款线稿与本机壁纸图库；命令面板、设置搜索、侧栏调宽与全屏      |
| 文件与任务 | 原生选择 / 拖入、文本编辑与预览、原子保存和外部冲突；Rust 扫描 / SHA-256、有界队列、进度、取消、重试与导出   |
| 数据可靠性 | SQLite 分页、搜索、排序、回收站、持久草稿与版本冲突；完整逻辑备份、事务恢复、启动隔离恢复                    |
| 表格与表单 | 万条数据、虚拟滚动与批量部分失败；CSV 字段映射、校验、有效行确认与 CSV / JSON 导出；动态表单与错误定位       |
| 冲突与检索 | 文件 / 笔记逐块差异选择与合并后版本校验；命令面板搜索本地笔记及已授权最近文件名；可下载工作流样例            |
| 扩展       | Wasm 命令、页面与独立窗口；可选授权、声明网络、私有存储、生成文件和会话导入；Rust / JS / TS 开发工具         |
| 网络与媒体 | 本地 fixture / 白名单 HTTPS、缓存、超时、取消、有限重试；安全 Markdown、本地附件、图表、WSS 与固定 worker    |
| 桌面集成   | 多窗口、托盘、自启动、窗口尺寸与启动位置、未保存工作协商；通知、剪贴板、快捷键、深链 / 文件关联和系统凭据    |
| 工程链路   | 类型化 IPC、设置迁移与跨窗口同步、脱敏诊断、签名更新入口；前端 / 脚本 / Rust / 浏览器 / 桌面测试与版本化分发 |

体验路径、源码入口、数据边界和实际裁剪方法统一见 [模块指南](./docs/demo-modules.md)，扩展协议与系统权限边界见 [Extism 扩展](./docs/extensions.md)。内置及本地包可离线安装；市场源码需独立构建、签名并发布为 latest 才会更新线上内容。开发态旧扩展需归档重建，见扩展指南；正式签名、更新公钥与外部服务由维护者配置。

## 从源码运行

| 命令                          | 用途                                   |
| ----------------------------- | -------------------------------------- |
| `pnpm app:dev`                | Rust + WebView 桌面开发                |
| `pnpm dev`                    | 浏览器开发，固定端口 1420              |
| `pnpm build` / `pnpm preview` | 构建 / 预览桌面前端，无 Rust 进程      |
| `pnpm build:web`              | 生成可部署的浏览器演示                 |
| `pnpm test:ui`                | 构建并进行无头界面检查，不占用桌面焦点 |

前端入口为 [index.html](./index.html) → [main.tsx](./src/main.tsx) → [App.tsx](./src/App.tsx)；原生入口为 [main.rs](./src-tauri/src/main.rs) → [lib.rs](./src-tauri/src/lib.rs)。修改源码，不手改构建输出。

两种环境使用 HashRouter，支持 `#/components` 等深层链接；浏览器偏好与原生存档分别维护。F5 调试、全部工程命令及 GitHub Pages 部署见 [开发指南](./docs/development.md)。模块职责和通信方式见 [架构说明](./docs/architecture.md)。

## 创建派生项目

准备品牌 JSON，按 [初始化流程](./docs/development.md#项目初始化) 设置应用名、包名、唯一标识符、仓库和更新源：

```sh
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
# 如需精简初始界面，两条命令均添加 --minimal
```

初始化同时同步深链、文件关联、浏览器存储隔离和品牌链接；用 `pnpm config:check` 检查派生配置一致性。随后替换品牌 SVG，配置实际安全报告渠道、签名和更新密钥。真实移除功能按 [裁剪配方](./docs/demo-modules.md#实际裁剪模块) 同步清理调用方、IPC、依赖、权限、翻译与测试。

## 验证

```sh
pnpm verify       # 工程综合检查，覆盖范围见测试规范
pnpm test:ui      # 浏览器生产构建、交互和无障碍检查
pnpm bindings:check
```

日常按 [改动范围](./docs/testing.md#日常验证范围) 选择检查。Rust、真实桌面与安装升级需分别验收；真实窗口测试只在独立环境或安排的前台时段运行，见 [测试规范](./docs/testing.md#避免干扰本机桌面)。

## 构建产物

```sh
pnpm app:build     # 安装包
pnpm app:portable  # Windows 便携 exe 与说明
```

最终分发在 `artifacts/<version>/<target-triple>/installers/` 或 `portable/`，附 SHA-256 清单。`dist/`、`dist-web/` 和 `src-tauri/target/` 为生成输出。平台格式、签名与更新见 [构建与发布](./docs/build-release.md)。

便携版仍依赖 WebView2，数据保存在当前用户目录。清理前先用 `pnpm clean:temporary --dry-run` 检查范围；各模式的删除与保留边界见 [清理说明](./docs/development.md#清理构建产物)。

## 文档与协作

[文档索引](./docs/README.md) · [贡献流程](./CONTRIBUTING.md) · [智能体入口](./AGENTS.md) · [安全报告](./SECURITY.md) · [代码签名策略](./docs/code-signing-policy.md) · [MIT 许可](./LICENSE)
