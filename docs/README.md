# 文档索引

工程文档按职责维护；先从下表找到任务入口，不必顺序通读。

| 任务                                        | 权威文档                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 项目介绍、启动与派生入口                    | [README](../README.md)、[English quick start](../README.en.md)                              |
| 体验完整 demo、新增页面 / IPC、按需裁剪     | [模块指南](./demo-modules.md)                                                               |
| 运行结构、数据归属与模块边界                | [架构说明](./architecture.md)                                                               |
| Extism Wasm 扩展、官方市场、应用视图与开发  | [扩展指南](./extensions.md)                                                                 |
| 编写隔离的插件 HTML / CSS / JavaScript 界面 | [界面 SDK](../sdk/README.md)                                                                |
| 市场仓库的插件收录、构建、测试与签名发布    | [市场文档索引](../marketplace/docs/README.md)（需初始化子模块）                             |
| 环境、初始化、命令、调试与浏览器部署        | [开发指南](./development.md)                                                                |
| 测试选择、无头界面、原生及安装验收          | [测试规范](./testing.md)                                                                    |
| 版本、产物、签名、更新与发布恢复            | [构建与发布](./build-release.md)、[代码签名策略](./code-signing-policy.md)                  |
| IPC、权限、CSP、凭据与依赖审计              | [安全规范](./security.md)、[漏洞报告](../SECURITY.md)                                       |
| 启动、窗口、构建与存储故障                  | [排障手册](./troubleshooting.md)                                                            |
| 命名、类型、组件与抽象                      | [代码风格](./conventions/code-style.md)                                                     |
| 主题、布局、控件、动效与无障碍              | [界面规范](./conventions/ui-guidelines.md)、[皮肤资源](../resources/skins/README.md)        |
| 分支、提交、评审与合并                      | [Git 协作](./conventions/git-workflow.md)、[贡献流程](../CONTRIBUTING.md)                   |
| 跨模块、兼容或高影响设计                    | [设计门槛](./engineering-at-scale.md#设计评审与-adr-门槛)、[提案模板](./design-template.md) |
| 长期技术取舍与历史                          | [ADR 索引](./adr/README.md)                                                                 |
| 编码智能体工作约束                          | [AGENTS.md](../AGENTS.md)                                                                   |

## 维护规则

### 一份事实只写一处

README 保留介绍与必要启动命令；英文 README 提供简短快速开始。架构记录当前运行方式，操作指南说明执行方法，规范定义约束，ADR 保留长期决策。模块指南维护体验与裁剪路径，PR / issue / Release 留存某次变更的方案和验证证据。

写入前搜索已有定义，将重复内容合并到职责最明确的文档，其余使用相对链接。已有章节能够承载的内容不另建文件；过期操作说明合并或删除，同时修复入链。ADR 按 [状态规则](./adr/README.md#命名与状态) 保留历史。

### 内容与验证

- 自有工程文档使用中文、UTF-8、可读链接文字和存在的文件 / 标题锚点；代码块标明语言，避免混用各 shell 的语法。
- 说明职责、行为边界、操作与原因；不复写函数签名、完整配置或源码清单。易变化的版本和权限链接到配置，示例明确标为示例。
- 代码与相关文档同改。设计提案与当前实现分开，不把 CI 配置、demo 数据或未执行的目标平台检查写成实测结果。
- 文档改动检查相关文件的 Prettier 格式和本地链接；命令、默认值与权限变化时核对对应实现。
- 提交历史由 Git 维护，不另建 CHANGELOG 或临时审查流水账；发布说明补充用户可感知的变化、升级要求和已知限制。

代码去重与抽象见 [代码风格](./conventions/code-style.md#重复与抽象)；规模化维护职责见 [文档层级](./engineering-at-scale.md#文档层级与维护职责)。
