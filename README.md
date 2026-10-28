# Tauri Desktop Starter

[在线演示](https://yanchao001.github.io/tauri-desktop-starter/) · [English](./README.en.md) · [文档索引](./docs/README.md) · [发行记录](https://github.com/YanChao001/tauri-desktop-starter/releases)

Tauri 2 + React 19 + TypeScript 桌面应用基座，随附含 Wasm 扩展宿主与市场的完整示例应用。默认保留全部可操作 demo；`minimal` 仅隐藏演示入口，不删除源码、依赖或权限。派生项目需按产品范围手动移除模块，步骤见 [裁剪指南](./docs/demo-modules.md#实际裁剪模块)。

桌面与浏览器共用 `src/`。浏览器可体验交互、动效、CSV 数据工作流、网络 fixture、媒体和外观；原生文件、数据库、系统集成、可安装扩展和更新安装需要桌面环境。

| 亮色                                             | 暗色                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| ![展厅亮色主题](./docs/assets/preview-light.png) | ![展厅暗色主题](./docs/assets/preview-dark.png) |

截图来自隔离的 Windows 原生构建，更新见 [截图流程](./docs/testing.md#readme-原生截图更新)；更多外观见 [皮肤资源](./resources/skins/README.md)。

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

| 领域       | 可操作演示                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 交互与外观 | 创意展厅、表单与控件、持续动效；中英文、主题、强调色、字体、皮肤与壁纸图库；命令面板与设置搜索     |
| 文件与任务 | 原生选择 / 拖入、文本编辑、原子保存与冲突合并；Rust 扫描 / SHA-256、队列、进度与合作取消           |
| 数据与表单 | SQLite 分页、回收站、持久草稿与版本冲突；备份和隔离恢复；虚拟表格、CSV 映射校验与导出              |
| 扩展与媒体 | Wasm 命令、隔离 HTML / Canvas 与独立窗口、受控官方市场；HTTPS / WSS、Markdown、附件、图表与 worker |
| 桌面集成   | 多窗口、托盘、自启动、未保存工作协商；通知、剪贴板、快捷键、深链 / 文件关联与系统凭据              |
| 工程链路   | 类型化 IPC、设置迁移与跨窗口同步、脱敏诊断、签名更新；分层测试与版本化分发                         |

体验路径、源码入口和实际裁剪方法见 [模块指南](./docs/demo-modules.md)。内置本地工作台提供创意画布、数据透镜和流程编排，支持即时交互与成果导出，文本、CSV / JSON、待办及文件网络操作收在工具箱；市场收录计算器、贪吃蛇、内网通信和壁纸库。计算器提供标准、科学、绘图、程序员和日期计算五种模式，以及货币等十三类转换器。安装与宿主兼容、授权边界及插件独立发布见 [扩展指南](./docs/extensions.md)。

## 从源码运行

前端入口为 [index.html](./index.html) → [main.tsx](./src/main.tsx) → [App.tsx](./src/App.tsx)；原生入口为 [main.rs](./src-tauri/src/main.rs) → [lib.rs](./src-tauri/src/lib.rs)。修改源码，不手改构建输出。

两种环境使用 HashRouter，支持 `#/components` 等深层链接；浏览器偏好与原生存档分别维护。构建浏览器演示用 `pnpm build:web`；全部命令、F5 调试与 Pages 部署见 [开发指南](./docs/development.md)，模块和通信边界见 [架构说明](./docs/architecture.md)。

## 创建派生项目

准备品牌 JSON，按 [初始化流程](./docs/development.md#项目初始化) 设置应用名、包名、唯一标识符、仓库和更新源：

```sh
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
# 如需精简初始界面，两条命令均添加 --minimal
```

初始化同步应用身份、深链、文件关联和浏览器存储隔离；随后运行 `pnpm config:check`，替换品牌 SVG，配置安全报告渠道、签名和更新密钥。实际移除功能见 [裁剪配方](./docs/demo-modules.md#实际裁剪模块)。

## 验证

```sh
pnpm verify   # 工程综合检查，覆盖范围见测试规范
pnpm test:ui  # 浏览器生产构建、交互和无障碍检查
```

日常按 [改动范围](./docs/testing.md#日常验证范围) 选择检查。绑定、Rust、真实桌面与安装升级需分别验证；真实窗口测试只在独立环境或安排的前台时段运行，见 [桌面干扰边界](./docs/testing.md#避免干扰本机桌面)。

## 构建产物

```sh
pnpm app:build     # 安装包
pnpm app:portable  # Windows 便携 exe 与说明
```

最终分发在 `artifacts/<version>/<target-triple>/installers/` 或 `portable/`，附 SHA-256 清单。平台格式、签名与更新见 [构建与发布](./docs/build-release.md)。

便携版仍依赖 WebView2，数据保存在当前用户目录。只清理生成产物和临时文件、保留编译缓存时，先用 `pnpm clean:outputs --dry-run` 检查范围；各模式的删除与保留边界见 [清理说明](./docs/development.md#清理构建产物)。

## 文档与协作

[文档索引](./docs/README.md) · [贡献流程](./CONTRIBUTING.md) · [智能体入口](./AGENTS.md) · [安全报告](./SECURITY.md) · [代码签名策略](./docs/code-signing-policy.md) · [MIT 许可](./LICENSE)
