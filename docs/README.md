# 文档索引

本文是工程文档的统一入口。环境配置见 [开发指南](./development.md)；模块改动以架构说明、对应规范和实际验证结果为依据。

## 按工程职责检索

| 工程职责                             | 文档入口                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 运行时结构与模块边界                 | [架构说明](./architecture.md)                                                                                                          |
| 环境配置、启动与工程命令             | [开发指南](./development.md)                                                                                                           |
| 浏览器演示构建与 GitHub Pages 部署   | [浏览器演示构建与部署](./development.md#浏览器演示构建与部署)                                                                          |
| 自动配置品牌、诊断工具链、按 F5 调试 | [初始化](./development.md#项目初始化)、[诊断](./development.md#环境诊断)、[调试](./development.md#调试)                                |
| 理解设置迁移、多窗口同步和 SQLite    | [架构说明](./architecture.md#状态管理与设置迁移)                                                                                       |
| 找源码入口、区分中间产物与最终分发   | [README · 从源码运行与构建产物](../README.md#从源码运行)                                                                               |
| 命名、类型与代码组织                 | [代码风格与命名](./conventions/code-style.md)                                                                                          |
| 公共逻辑复用与抽象边界               | [代码风格 · 重复与抽象](./conventions/code-style.md#重复与抽象)                                                                        |
| 分支、提交与合并评审                 | [Git 协作规范](./conventions/git-workflow.md)                                                                                          |
| 界面与交互设计                       | [界面规范](./conventions/ui-guidelines.md)                                                                                             |
| 理解展厅、交互场景与受控动效         | [页面边界](./architecture.md#页面与演示边界)、[动效约定](./conventions/ui-guidelines.md#动效)、[体验验收](./testing.md#体验与动效验收) |
| 测试分层、真实桌面与重启验收         | [测试规范](./testing.md)                                                                                                               |
| 打包、签名、发布与自动更新           | [构建与发布](./build-release.md)                                                                                                       |
| 修改 SVG 并生成应用图标、安装器图片  | [品牌资源与安装器](./build-release.md#安装器外观)                                                                                      |
| 申请 SignPath 免费签名、查签名范围   | [代码签名策略](./code-signing-policy.md)                                                                                               |
| 权限、CSP 与敏感数据                 | [安全规范](./security.md)                                                                                                              |
| 故障定位与恢复                       | [排障手册](./troubleshooting.md)                                                                                                       |
| 技术选型与长期取舍                   | [决策记录](./adr/README.md)                                                                                                            |
| 确认后续扩展边界                     | [架构说明 · 扩展原则](./architecture.md#扩展原则)                                                                                      |
| 从模板演进为多模块、多人维护的产品   | [规模化开发指南](./engineering-at-scale.md)                                                                                            |
| 评审跨模块、兼容或发布方案           | [设计门槛](./engineering-at-scale.md#设计评审与-adr-门槛)、[设计提案模板](./design-template.md)                                        |

## 文档地图

```
docs/
├── README.md              本文，索引
├── architecture.md        运行时结构、分层、通信、状态与存储策略
├── engineering-at-scale.md 能力边界、业务域、负责人、设计与运行治理
├── design-template.md     跨模块或高影响改动的设计提案模板
├── development.md         环境、命令、调试、镜像、依赖评审
├── testing.md             单元 / 脚本 / Rust / IPC / 真实桌面测试
├── build-release.md       版本、签名、自动更新、发布清单
├── code-signing-policy.md SignPath 申请、签名范围与审批流程
├── security.md            攻击面、CSP、权限、密钥、审计
├── troubleshooting.md     常见故障的现象与解法
├── conventions/
│   ├── code-style.md      命名、组件、TS/Rust 约定、去重与抽象、注释
│   ├── git-workflow.md    分支模型、rebase、提交规范、PR
│   └── ui-guidelines.md   设计 token、布局、状态、无障碍
└── adr/
    ├── README.md          ADR 的写法与索引
    ├── 0001-desktop-shell-tauri.md
    └── 0002-git-merge-strategy.md
```

根目录文档负责项目入口与仓库政策：

| 文件                                  | 作用                             |
| ------------------------------------- | -------------------------------- |
| [README.md](../README.md)             | 项目介绍与快速开始               |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程与规范入口               |
| [SECURITY.md](../SECURITY.md)         | 安全问题报告政策，待落实私密渠道 |
| [LICENSE](../LICENSE)                 | MIT 许可                         |

提交记录由 Git 历史维护，版本边界由 tag 标记；仓库不额外维护 CHANGELOG。版本差异通过以下命令查询：

```bash
git log v1.1.0..v1.2.0 --oneline          # 两个版本之间
git log v1.2.0..HEAD --oneline --no-merges # 上个版本之后
git tag -l --sort=-v:refname              # 按版本排序
```

对外发版说明以提交范围为基础，发布时人工补充用户可感知的行为、升级要求和已知限制。

## 维护规则

### 一份事实只写一处

规范只设一个权威定义点，其他文档通过链接引用。快速开始可保留必要命令，示例可以解释配置，但不能复制整段配置形成需要独立维护的第二份事实。

README 负责项目介绍与环境启动；CONTRIBUTING 负责贡献入口；`docs/` 的架构、操作指南、工程规范与 ADR 分别维护当前结构、执行方法、约束规则和决策依据。设计提案与当前实现的区别见 [文档层级](./engineering-at-scale.md#文档层级与维护职责)。PR 模板引用规范，不再定义另一套门槛。

写文档前用 `rg` 搜索关键词，确认是否已有定义。发现重复时，合并到职责最明确的那份，其余改成链接。

### 文档与源码的边界

- 不罗列函数签名和内部参数；文档说明职责、行为边界、操作方法与设计原因。影响使用的默认行为可以写明，并链接其来源。
- 工具版本、权限清单等易变化的配置链接到源文件；用于解释规则的示例需标明示例，不承诺与配置逐项相同。
- 目录树可以列承担关键职责的文件，但新增普通文件不必回头改它；不要把它当成完整清单。

### 新增与合并原则

已有文档能够承载的内容，优先纳入对应章节。

新增文档需有独立用途和索引入口；不要为一次审查、重复清单或临时排查过程建立长期维护的流水账。

### 其他

- 文档与对应代码在同一个 PR 中更新，避免契约、操作方法与实现发生偏差。
- 文档开头说明用途，避免无关背景与口号。
- 自有工程文档使用中文，以职责、契约、操作条件和验证证据组织内容，避免按阅读者资历或固定学习周期划分内容。代码注释遵循 [注释规范](./conventions/code-style.md#注释)，提交信息遵循 [提交信息规范](./conventions/git-workflow.md#提交信息规范)。
- 长文档用二级标题分节即可，不必每份都加目录；分节标题要能独立看懂。
- 失效的操作文档合并或删除，并修复入链；ADR 保留历史，按 [ADR 状态规则](./adr/README.md#命名与状态) 标记取代关系。
- 变更记录不手写，用 git 历史代替（见上文）。
- Markdown 使用 UTF-8、相对路径和可读链接文字；本地链接需指向存在的文件或标题锚点。命令块标明 `bash` / `powershell`，跨平台命令可用 `sh`，避免混用 `$env:`、`export`、`%VAR%`。
- 发布前检查示例命令与当前脚本、权限、CI 行为一致，并运行 `pnpm format:check`。未执行的目标平台检查应如实记录，不能把设计目标写成验证结果。

## 代码侧的对应规则

文档防重复，代码也一样。抽象时机、什么算重复、抽到哪个目录，见
[代码风格 · 重复与抽象](./conventions/code-style.md#重复与抽象)。
