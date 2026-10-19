# 文档索引

第一次接触这个项目，按顺序读：**架构说明 → 开发指南 → 代码风格 → Git 协作规范**。
其余按需查。

## 按"我想做什么"找

| 我想……                         | 看这份                                        |
| ------------------------------ | --------------------------------------------- |
| 搞清楚这个应用是怎么跑起来的   | [架构说明](./architecture.md)                 |
| 把项目跑起来、知道有哪些命令   | [开发指南](./development.md)                  |
| 写代码前确认命名和写法         | [代码风格与命名](./conventions/code-style.md) |
| 提交代码、开 PR、处理分支      | [Git 协作规范](./conventions/git-workflow.md) |
| 加界面、调样式                 | [界面规范](./conventions/ui-guidelines.md)    |
| 写测试                         | [测试规范](./testing.md)                      |
| 打包、签名、发版、做自动更新   | [构建与发布](./build-release.md)              |
| 加权限、配 CSP、处理敏感数据   | [安全规范](./security.md)                     |
| 遇到报错                       | [排障手册](./troubleshooting.md)              |
| 想知道某个技术选型为什么这么定 | [决策记录](./adr/README.md)                   |

## 文档地图

```
docs/
├── README.md              本文，索引
├── architecture.md        运行时结构、分层、通信、状态与存储策略
├── development.md         环境、命令、调试、镜像、依赖评审
├── testing.md             测试分层与接入步骤
├── build-release.md       版本、签名、自动更新、发布清单
├── security.md            攻击面、CSP、权限、密钥、审计
├── troubleshooting.md     常见故障的现象与解法
├── conventions/
│   ├── code-style.md      命名、组件、TS/Rust 约定、注释
│   ├── git-workflow.md    分支模型、rebase、提交规范、PR
│   └── ui-guidelines.md   设计 token、布局、状态、无障碍
└── adr/
    ├── README.md          ADR 的写法与索引
    ├── 0001-desktop-shell-tauri.md
    └── 0002-git-merge-strategy.md
```

根目录还有这些：

| 文件                                  | 作用                     |
| ------------------------------------- | ------------------------ |
| [README.md](../README.md)             | 项目介绍与快速开始       |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 参与开发的最短路径       |
| [SECURITY.md](../SECURITY.md)         | 安全问题上报渠道（占位） |
| [CHANGELOG.md](../CHANGELOG.md)       | 版本变更记录             |
| [LICENSE](../LICENSE)                 | MIT 许可                 |

## 维护规则

- **文档和代码在同一个 PR 里改。** 接口变了文档不改，比没有文档更糟。
- 每份文档开头写清"这份文档解决什么问题"，不写正确的废话。
- 长文档用二级标题分节即可，不必每份都加目录；分节标题要能独立看懂。
- 失效的文档直接删，不要留着标注"已过时"——没人会去读第二遍。
