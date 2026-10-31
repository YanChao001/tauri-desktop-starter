# AGENTS.md

本文件适用于整个仓库，只保留工作入口和容易误用的约束；详细规则由 [文档索引](./docs/README.md) 指向的权威文档维护。

## 开始工作

- 先读 [README](./README.md) 和 [文档索引](./docs/README.md)，再读任务涉及的文档与源码。日常流程见 [贡献指南](./CONTRIBUTING.md)。
- 项目是通用桌面应用 demo 基座，具体业务由派生项目定义。默认保留完整 demo；`minimal` 只隐藏入口，实际裁剪与新增页面 / IPC 见 [模块指南](./docs/demo-modules.md)。
- 跨模块、兼容、权限、窗口生命周期或发布恢复变更，先按 [设计门槛](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 说明影响与验收；通常写在 issue / PR，长期取舍才进入 ADR。

## 环境与运行

使用 pnpm，首次安装执行 `pnpm install --frozen-lockfile`。版本以 [`.nvmrc`](./.nvmrc)、[`package.json`](./package.json) 和 [`rust-toolchain.toml`](./rust-toolchain.toml) 为准；命令从仓库根目录运行，见 [开发指南](./docs/development.md)。未安装依赖可运行 `node scripts/doctor.mjs`。修改源码与资源源文件，生成输出通过对应命令更新。

## 命令被策略拦截时

带 `-Force` 的检查命令与修改、删除、服务启停分成独立工具调用。遇到 `blocked by policy`，先检查完整脚本是否混用了这些操作；核验实际结果，仍失败时记录命令和错误。

## 实现约束

- **页面与命令**：路由、导航、懒加载与预载统一在 `src/routes.tsx`；菜单、命令面板与快捷键复用 `src/commands/`，保留模式和环境过滤。
- **原生调用**：手写应用通过 `src/lib/tauri.ts` 使用系统能力，页面、组件和 Hook 不直接导入 `@tauri-apps/*` 或调用 `invoke`。Rust 命令 / DTO 是类型来源；签名、DTO 或绑定注册变化时生成并检查绑定，提交生成结果，见 [IPC 流程](./docs/demo-modules.md#新增页面到-ipc-与测试)。
- **状态与异步**：页面状态留在组件，跨页偏好复用设置 Provider / 模型 / 同步器；保留原子写入、迁移、revision / version 冲突和未来数据保护。订阅处理卸载、StrictMode 与晚到结果，具体职责见 [架构](./docs/architecture.md)。
- **任务与恢复**：未保存工作登记 `useUnsavedWork`，沿用离页回调、AbortSignal、有界队列和合作取消；等待停止不等于原生回滚。恢复保留原始数据、备份与归档，见 [恢复架构](./docs/architecture.md#恢复诊断与更新)。
- **双环境**：保留 HashRouter；原生能力由门面检查环境，浏览器演示与原生存档分开。
- **代码规则**：命名、导出、Rust 分层和错误处理按 [代码风格](./docs/conventions/code-style.md)。手写 TypeScript 用 `unknown` 收窄未知数据，不用 `any` / `enum`；原生错误按稳定 `code` 处理。抽象、校验和兼容分支对应实际用途与失败场景。
- **界面**：按 [界面规范](./docs/conventions/ui-guidelines.md) 复用语义 token 和控件，维护焦点、键盘与无障碍语义。文案同步中英词典；持续动效消费 `useDemoMotion` 活动状态并清理。`src/components/ui/` 保留上游兼容和本地修复，不批量格式化；`src/styles/shadcn.css` 保持上游原文。

## 验证与交付

- 按 [日常验证范围](./docs/testing.md#日常验证范围) 选择受影响行为的检查；通过后只因新改动、失败或明确疑点重跑。文档与样式等低风险改动使用相称的验证，不机械新增测试。
- 界面检查默认使用无头 `pnpm test:ui`。真实窗口、测试 exe 和截图仅在独立环境或用户安排的前台时段运行，见 [桌面干扰边界](./docs/testing.md#避免干扰本机桌面)；README 图片按同文的截图流程更新。
- Rust 检查先准备 `dist/`，共享 target 的 Rust 检查和绑定任务顺序执行。测试分层、数据隔离和生成资源检查均以 [测试规范](./docs/testing.md) 为准。
- 交付说明实际改动、检查结果和相关未验证范围；区分本机检查、CI 与正式安装版验收。

## 配置、生成资源与安全

- 身份与品牌通过 `app.config.json` 和 [初始化流程](./docs/development.md#项目初始化) 维护；版本使用 `pnpm version:set`，品牌 SVG 使用生成脚本更新派生资源，见 [构建与发布](./docs/build-release.md)。
- IPC、路径、存储、外链与权限变化按 [安全规范](./docs/security.md) 处理。密钥和凭据使用受控渠道与系统存储；`VITE_` 是公开配置，日志保持脱敏。
- 新依赖与锁文件变更按 [依赖评审](./docs/development.md#新增依赖的评审标准) 处理，保持锁文件和定向更新范围。

## 文档与 Git 协作

- 文档随行为变化更新到唯一权威位置；中文、UTF-8、相对链接及 ADR 维护规则见 [文档索引](./docs/README.md#维护规则)。
- 功能 / 修复从 `develop` 分支开发，普通特性分支 rebase 同步，保护分支走 PR 与 `--no-ff` 合并。提交格式和现有 PR 模板见 [Git 协作规范](./docs/conventions/git-workflow.md)。
