# 参与开发

日常开发按下面四步进行，详细规则从 [文档索引](./docs/README.md) 按需阅读；使用编码智能体时同时遵循 [AGENTS.md](./AGENTS.md)。

## 贡献流程

1. **明确问题。** 记录触发场景、期望行为和可验证结果，阅读受影响的 [架构](./docs/architecture.md) 与源码；按 [开发指南](./docs/development.md#环境要求) 准备所需环境。
2. **确定改动范围。** 从 `develop` 创建或继续合适的功能 / 修复分支，命名与同步见 [日常开发流程](./docs/conventions/git-workflow.md#日常开发流程)。涉及 [高影响设计](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 时，先在 issue / PR 说明取舍和验收；普通局部改动直接实现。
3. **实现并验证。** 修改源码和所属权威文档，按 [日常验证范围](./docs/testing.md#日常验证范围) 检查受影响行为。修复验证具体回归，重构检查行为保持，文档检查内容与链接；检查通过且没有新变化即可进入评审。
4. **评审与交付。** 用 [PR 模板](./.github/pull_request_template.md) 说明最终行为、原因、实际验证与相关未测范围，按 [PR 规范](./docs/conventions/git-workflow.md#pr-规范) 合并。分发版本另按 [发布流程](./docs/build-release.md) 验收。

文档修改遵循索引中的 [维护规则](./docs/README.md#维护规则)。日常 UI 检查使用无头浏览器；原生窗口验收遵循 [桌面干扰边界](./docs/testing.md#避免干扰本机桌面)。

安全问题通过 [SECURITY.md](./SECURITY.md) 所述私密渠道报告，不在公开 issue 或 PR 中披露细节。
