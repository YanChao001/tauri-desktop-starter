# 参与开发

这份文件只给路径，具体规则都在 `docs/`，避免同一个规则在两处各说一遍、最后说法不一致。

源码入口、桌面运行与浏览器预览的区别见 [README · 从源码运行](./README.md#从源码运行)；交付安装包或便携版统一从 [版本化分发目录](./README.md#构建产物) 获取。

## 最短路径

```bash
# 1. 环境版本以 .nvmrc、package.json 和 rust-toolchain.toml 为准
#    详细要求见 docs/development.md

# 2. 拉起项目
git clone <repo-url>
cd tauri-desktop-starter
pnpm install --frozen-lockfile
pnpm app:dev

# 3. 开分支（从 develop 切，不要从 main）
git switch develop
git pull --ff-only
git switch -c feature/42-command-palette

# 4. 写代码，提交前跑前端检查；Rust 检查见 docs/testing.md
pnpm verify

# 5. 提交并首次推送
git add -A
git commit -m "feat(ui): 增加命令面板"
git push -u origin feature/42-command-palette

# 6. 合并前同步主干（rebase，不要 merge），然后强推自己的分支
git fetch origin
git rebase origin/develop
git push --force-with-lease

# 7. 开 PR → CI 绿 → 1 人 approve → --no-ff 合并
```

## 必读规范

| 主题                    | 文档                                                 |
| ----------------------- | ---------------------------------------------------- |
| 架构分层与 IPC 边界     | [架构说明](./docs/architecture.md)                   |
| 命名、组件写法、TS/Rust | [代码风格](./docs/conventions/code-style.md)         |
| 分支模型、rebase、提交  | [Git 协作规范](./docs/conventions/git-workflow.md)   |
| 颜色、间距、状态处理    | [界面规范](./docs/conventions/ui-guidelines.md)      |
| 环境变量与本地配置      | [开发指南](./docs/development.md#环境变量)           |
| 新增依赖的评估标准      | [开发指南](./docs/development.md#新增依赖的评审标准) |

提交格式、PR 要求、review 关注点、合并方式都在 Git 协作规范里；PR 模板会自动带出清单。

## 新人第一周

| 天      | 做什么                                                                       |
| ------- | ---------------------------------------------------------------------------- |
| 第 1 天 | 跑通 `pnpm app:dev`，读 [架构说明](./docs/architecture.md)                   |
| 第 2 天 | 照着 [界面规范](./docs/conventions/ui-guidelines.md#新增一个页面) 加一个页面 |
| 第 3 天 | 写一个 Rust 命令并在前端调用，走通 IPC                                       |
| 第 4 天 | 认领一个 `good first issue`，走完整 PR 流程                                  |
| 第 5 天 | 读一遍 [构建与发布](./docs/build-release.md)，自己打一个包                   |
