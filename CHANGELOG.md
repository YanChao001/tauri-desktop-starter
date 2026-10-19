# 变更记录

本文件记录所有值得使用者知晓的变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 文末的版本对比链接是占位地址，接入代码仓库后替换为真实 URL。

## [Unreleased]

### 新增

- 采用 MIT 许可（见 `LICENSE`）
- 工程规范文档体系：架构、开发、测试、发布、安全、排障、代码风格、Git 协作、界面规范
- 架构决策记录（ADR）机制与首批两份决策
- ESLint + Prettier 配置，CI 中强制执行
- `pnpm version:set` 脚本，同步四处版本号
- GitHub Actions 校验流水线与 PR / Issue 模板

### 变更

- 前端分层调整：`layouts/` 承接应用外壳，`hooks/` 承接 React 逻辑，`lib/` 回归纯 TS
- 路由与侧边导航合并为 `routes.tsx` 单一数据源，加页面只改一处
- Rust 侧拆出 `commands.rs`，`lib.rs` 只做组装；`greet` 改为返回 `Result` 以示范错误链路
- ESLint 增加 IPC 边界规则，静态 `import` 与动态 `import()` 都会被拦
- `shadcn` CLI 从 `dependencies` 移到 `devDependencies`
- 复制文本能力抽到 `lib/clipboard.ts`，并加 `execCommand` 降级

### 移除

- 删除未使用的 `tabs`、`avatar` 组件

### 修复

- `useRevealWindow` 改为双 `requestAnimationFrame`，避免首帧未绘制就显示窗口

## [0.1.0] - 2026-10-19

### 新增

- Tauri 2 + React 19 + TypeScript + Vite 8 基础工程
- Tailwind CSS 4 + shadcn/ui（radix、nova 风格）组件体系
- 侧边栏 + 顶栏 + 内容区的桌面布局，含概览 / 前端调用 / 设置三个页面
- 主题切换（浅色 / 深色 / 跟随系统）
- 前端 ↔ Rust 的 `invoke` 示例与错误处理
- 单实例、窗口位置记忆、外链交由系统浏览器打开
- 启动不闪白屏：窗口延迟显示 + Rust 侧 3 秒兜底
- release 构建体积优化（LTO、strip、`opt-level=s`、`panic=abort`）
- 能力白名单最小化配置

### 已知限制

- 未接入测试框架，接入步骤见 `docs/testing.md`
- 未接入自动更新，接入步骤见 `docs/build-release.md`
- CSP 仍为 `null`，发布前需按 `docs/security.md` 收紧

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/releases/tag/v0.1.0
