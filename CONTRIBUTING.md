# 参与开发

从 [文档索引](./docs/README.md) 选择任务入口；使用编码智能体时同时遵循 [AGENTS.md](./AGENTS.md)。

## 贡献流程

1. 阅读 [README](./README.md) 和受影响的 [架构](./docs/architecture.md) 章节，按 [开发指南](./docs/development.md#环境要求) 准备任务所需环境；两种运行方式见 [从源码运行](./README.md#从源码运行)。
2. 从 `develop` 创建功能或修复分支，命名与同步见 [日常开发流程](./docs/conventions/git-workflow.md#日常开发流程)。达到 [设计门槛](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 时，先说明影响和方案并完成适用评审。
3. 修改源码和对应文档，按 [日常验证范围](./docs/testing.md#日常验证范围) 执行检查，如实记录结果和未验证范围；Rust、绑定、浏览器与真实桌面分别验证。
4. 使用 [PR 模板](./.github/pull_request_template.md)，按 [PR 规范](./docs/conventions/git-workflow.md#pr-规范) 完成评审和合并。

文档修改遵循索引中的 [维护规则](./docs/README.md#维护规则)。日常 UI 检查使用无头浏览器；原生窗口验收遵循 [桌面干扰边界](./docs/testing.md#避免干扰本机桌面)。

安全问题通过 [SECURITY.md](./SECURITY.md) 所述私密渠道报告，不在公开 issue 或 PR 中披露细节。
