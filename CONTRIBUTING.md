# 参与开发

本文提供贡献入口。具体架构、开发命令与协作规则分别由 `docs/` 中对应文档维护；使用编码智能体时同时遵循 [AGENTS.md](./AGENTS.md) 的工作指引。

## 贡献流程

1. 按 [开发指南](./docs/development.md#环境要求) 准备本次任务所需的工具和依赖。前端交互可用浏览器预览，涉及原生能力时运行 `pnpm app:dev`；源码入口与两种环境的区别见 [README](./README.md#从源码运行)。文档改动按验证范围检查即可。
2. 阅读 [架构说明](./docs/architecture.md)，从 `develop` 创建功能或修复分支；命名、提交与同步方法见 [Git 协作规范](./docs/conventions/git-workflow.md#日常开发流程)。涉及跨模块、数据兼容、权限或发布恢复时，先按 [设计门槛](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 说明方案并完成适用评审。
3. 修改代码和对应文档，按 [日常验证范围](./docs/testing.md#日常验证范围) 执行相关检查。共享基础设施变更或交付前可运行 `pnpm verify`；涉及 Rust、IPC 或桌面主链路时补充对应验证。
4. 使用仓库 PR 模板说明问题、改动与验证结果，按 [PR 规范](./docs/conventions/git-workflow.md#pr-规范) 完成评审和合并。

按任务从 [文档索引](./docs/README.md) 查找代码风格、界面、开发、测试与发布规范；文档修改遵循其中的 [维护规则](./docs/README.md#维护规则)。

安全问题通过 [SECURITY.md](./SECURITY.md) 所述私密渠道报告，不在公开 issue 或 PR 中披露细节。
