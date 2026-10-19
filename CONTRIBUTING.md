# 参与开发

## 最短路径

```bash
# 1. 环境：Node 22+ / pnpm 12+ / Rust stable-msvc / VS C++ 工具链
#    详细要求见 docs/development.md

# 2. 拉起项目
git clone <repo-url>
cd tauri-desktop-starter
pnpm install
pnpm app:dev

# 3. 开分支（从 develop 切，不要从 main）
git switch develop && git pull --rebase
git switch -c feature/42-命令面板

# 4. 写代码，提交前自检
pnpm format:check && pnpm lint && pnpm typecheck

# 5. 提交（Conventional Commits）
git add .
git commit -m "feat(ui): 增加命令面板"

# 6. 合并前同步主干（rebase，不要 merge）
git fetch origin
git rebase origin/develop
git push --force-with-lease

# 7. 开 PR，等 CI 绿 + 1 人 approve
```

## 必读规范

| 主题                            | 文档                                               |
| ------------------------------- | -------------------------------------------------- |
| 命名、组件写法、TS/Rust 约定    | [代码风格](./docs/conventions/code-style.md)       |
| 分支模型、rebase 规则、提交格式 | [Git 协作规范](./docs/conventions/git-workflow.md) |
| 颜色、间距、状态处理            | [界面规范](./docs/conventions/ui-guidelines.md)    |
| 架构与分层                      | [架构说明](./docs/architecture.md)                 |

## 提交要求

- 一次提交只做一件事，不要把格式化和逻辑改动混在一起。
- 提交信息用 Conventional Commits，scope 写模块名（`ui` / `tauri` / `ipc` / `build`）。
- 不提交 `node_modules`、`dist`、`src-tauri/target`、任何密钥。

## PR 要求

- 标题符合同一套提交规范（`--no-ff` 合并后它就是合并节点的标题）。
- 描述里写清：改了什么、为什么、怎么验证、影响面。
- diff 控制在 400 行以内，超了先拆。
- UI 改动附截图，**亮色和暗色各一张**。
- 动了 `capabilities/default.json`、`tauri.conf.json`、`Cargo.toml` 要在描述里单独说明。
- CI 必须全绿才可合并；reviewer 在 1 个工作日内给第一次反馈。

## 代码审查看什么

按优先级：

1. **正确性**：边界条件、错误处理、异步竞态。
2. **边界**：`pages/` 有没有直接调 `invoke`，`lib/` 有没有混入 JSX。
3. **安全**：入参校验、路径穿越、权限是否开大了。
4. **一致性**：命名、目录、样式 token 是否符合规范。
5. **可维护性**：这段代码三个月后别人能不能改。

风格问题交给 Prettier 和 ESLint，reviewer 不要在这上面花时间。

## 常见退回原因

- 分支没 rebase 到最新 `develop`
- 提交信息是 "修改"、"fix bug" 这类无信息量的描述
- UI 改动没有深色模式截图
- 新增依赖没有说明理由
- 文档没跟着改

## 新人第一周

| 天      | 做什么                                                                       |
| ------- | ---------------------------------------------------------------------------- |
| 第 1 天 | 跑通 `pnpm app:dev`，读 [架构说明](./docs/architecture.md)                   |
| 第 2 天 | 照着 [界面规范](./docs/conventions/ui-guidelines.md#新增一个页面) 加一个页面 |
| 第 3 天 | 写一个 Rust 命令并在前端调用，走通 IPC                                       |
| 第 4 天 | 认领一个 `good first issue`，走完整 PR 流程                                  |
| 第 5 天 | 读一遍 [构建与发布](./docs/build-release.md)，自己打一个包                   |
