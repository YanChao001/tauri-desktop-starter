# 参与开发

本文提供贡献入口。具体架构、开发命令与协作规则分别由 `docs/` 中对应文档维护；使用编码智能体时同时遵循 [AGENTS.md](./AGENTS.md) 的工作指引。

## 贡献流程

1. 按 [开发指南](./docs/development.md#环境要求) 准备本次任务所需的工具和依赖。前端交互可用浏览器预览，涉及原生能力时运行 `pnpm app:dev`；源码入口与两种环境的区别见 [README](./README.md#从源码运行)。文档改动按验证范围检查即可。
2. 阅读 [架构说明](./docs/architecture.md)，从 `develop` 创建功能或修复分支；命名、提交与同步方法见 [Git 协作规范](./docs/conventions/git-workflow.md#日常开发流程)。涉及跨模块、数据兼容、权限或发布恢复时，先按 [设计门槛](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 说明方案并完成适用评审。
3. 修改代码和对应文档，按 [日常验证范围](./docs/testing.md#日常验证范围) 执行相关检查。共享基础设施变更或交付前可运行 `pnpm verify`；涉及 Rust、IPC 或桌面主链路时补充对应验证。
4. 使用仓库 PR 模板说明问题、改动与验证结果，按 [PR 规范](./docs/conventions/git-workflow.md#pr-规范) 完成评审和合并。

## 按改动查规范

| 主题                              | 文档                                               |
| --------------------------------- | -------------------------------------------------- |
| 模块分层、IPC、设置与数据边界     | [架构说明](./docs/architecture.md)                 |
| 多业务域、负责人、兼容与设计评审  | [规模化开发指南](./docs/engineering-at-scale.md)   |
| 命名、组件、TS / Rust、抽象与注释 | [代码风格](./docs/conventions/code-style.md)       |
| 页面、样式、动效与无障碍          | [界面规范](./docs/conventions/ui-guidelines.md)    |
| 分支、提交、PR 与发布协作         | [Git 协作规范](./docs/conventions/git-workflow.md) |
| 环境变量、新增依赖与本地调试      | [开发指南](./docs/development.md)                  |
| 测试、真实桌面验证与 CI           | [测试规范](./docs/testing.md)                      |
| 打包、签名与版本发布              | [构建与发布](./docs/build-release.md)              |

安全问题通过 [SECURITY.md](./SECURITY.md) 所述私密渠道报告，不在公开 issue 或 PR 中披露细节。
