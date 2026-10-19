# Git 协作规范

> 目标：任何一个人在任何时间看 `develop` 的历史，都能一眼看出「哪个特性、什么时候进的、包含哪些提交」。

## 分支模型

采用精简版 GitFlow：两条长期分支 + 四种短期分支。

```mermaid
gitGraph
  commit id: "init"
  branch develop
  commit id: "feat: 基建"
  branch feature/12-窗口记忆
  commit id: "feat(window): 记住窗口位置"
  commit id: "test(window): 补充用例"
  checkout develop
  merge feature/12-窗口记忆
  branch release/1.1.0
  commit id: "chore: 版本 1.1.0"
  checkout main
  merge release/1.1.0 tag: "v1.1.0"
  checkout develop
  merge release/1.1.0
```

| 分支                     | 用途                                 | 从哪来    | 合到哪             | 生命周期   |
| ------------------------ | ------------------------------------ | --------- | ------------------ | ---------- |
| `main`                   | 生产代码，每次合并都对应一个发布标签 | —         | —                  | 永久       |
| `develop`                | 集成分支，日常开发的合并目标         | `main`    | —                  | 永久       |
| `feature/<issue>-<slug>` | 新功能                               | `develop` | `develop`          | 合并后删除 |
| `fix/<issue>-<slug>`     | 普通缺陷修复                         | `develop` | `develop`          | 合并后删除 |
| `release/<x.y.z>`        | 发布准备，只修 bug、只改版本号       | `develop` | `main` + `develop` | 发布后删除 |
| `hotfix/<x.y.z>`         | 线上紧急修复                         | `main`    | `main` + `develop` | 发布后删除 |

**分支命名**：全小写，单词用连字符，带上 issue 号。

```
feature/42-command-palette
fix/57-window-flash
release/1.2.0
hotfix/1.1.1
```

## 日常开发流程

```bash
# 1. 更新本地集成分支
git switch develop
git pull --rebase

# 2. 切特性分支
git switch -c feature/42-command-palette

# 3. 开发过程中定期同步（不要用 merge）
git fetch origin
git rebase origin/develop

# 4. 提交前自检
pnpm format:check && pnpm lint && pnpm typecheck

# 5. 推送（首次）
git push -u origin feature/42-command-palette

# 6. 合并前再 rebase 一次，然后强推自己的分支
git fetch origin
git rebase origin/develop
git push --force-with-lease

# 7. 开 PR → CI 绿 → 至少 1 人 approve → 合并（用 --no-ff，见下文）
```

## rebase 规则（必须遵守）

| 场景                      | 做法                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| 拉取远端更新              | `git pull --rebase`，配置 `git config --global pull.rebase true`                   |
| 同步 `develop` 到特性分支 | `git rebase origin/develop`，**不允许** `git merge develop`                        |
| 合并前                    | 必须 rebase 到最新 `origin/develop`，且本地自检通过                                |
| 冲突                      | 本地解决 → `git add <file>` → `git rebase --continue`；放弃用 `git rebase --abort` |
| 已推送的分支被 rebase     | `git push --force-with-lease`，**禁止** `--force`                                  |
| `develop` / `main`        | 保护分支：只能通过 PR 合并，不 rebase、不 force push、不直接 push                  |
| `release/*` / `hotfix/*`  | 由发布负责人推送，不 force push；期间只允许修复提交                                |

**为什么特性分支上禁止 merge develop：** 会产生一条"整合提交"，把别人的几十个提交混进你的分支历史里。review 的人打开 PR 看到的全是噪音，分不清哪些是你改的。

**同一条 PR 内部提交要做整理：** 合并前用 `git rebase -i origin/develop` 把 `fix typo`、`再改一下` 这类提交合并或改写，留下能独立读懂、能独立回滚的原子提交。

### rebase 和 GitFlow 的 --no-ff 冲突吗

不冲突，因为两者作用于不同层面：

- **rebase** 作用于特性分支**内部**：去掉从 develop 带进来的合并噪音，让分支自己的提交是线性的。
- **--no-ff** 作用于**合并动作**：在 `develop` 上留下一个明确的合并节点。

最终效果：`develop` 上每个特性有一个合并点，点开这个点，里面是一条干净的线性提交链。

### 为什么不用 squash merge

- 原子提交能保留，`git bisect` 定位问题时粒度更细。
- 大特性可以分多次 review，每次看一个提交。
- 代价是 `develop` 上提交数较多，靠 `--no-ff` 的合并点来分组。

如果团队更习惯 squash，要**整体切换**并记录到 `docs/adr/`，不要一部分人 merge、一部分人 squash。

## 提交信息规范

采用 Conventional Commits，中文描述。

```
<type>(<scope>): <subject>

<body 可选，说明动机与影响>

<footer 可选，BREAKING CHANGE / Refs #42>
```

| type       | 用途                     |
| ---------- | ------------------------ |
| `feat`     | 新功能                   |
| `fix`      | 缺陷修复                 |
| `refactor` | 重构，不改变外部行为     |
| `perf`     | 性能优化                 |
| `style`    | 格式调整，不影响逻辑     |
| `docs`     | 文档                     |
| `test`     | 测试                     |
| `build`    | 构建脚本、依赖、打包配置 |
| `ci`       | CI 配置                  |
| `chore`    | 杂项，如版本号、忽略文件 |
| `revert`   | 回滚某次提交             |

**scope** 用模块名，不要用文件名：`ui`、`tauri`、`ipc`、`window`、`docs`、`deps`。

```
feat(window): 支持记住窗口尺寸与位置
fix(tauri): 修复重复启动时窗口不聚焦
refactor(ipc): 把 invoke 调用收敛到 lib/tauri.ts
build(deps): 升级 tauri 到 2.12.4
docs: 补充发布流程中的签名说明
```

要求：

- subject 不超过 50 字，动词开头，结尾不加句号。
- 一次提交只做一件事。混了格式化 + 逻辑改动的提交，review 成本翻倍。
- 破坏性变更在 footer 写 `BREAKING CHANGE: 说明`，并在 PR 标题加 `!`，如 `feat(ipc)!: 重命名 invoke 封装`。

## 合并方式

| 合并路径                        | 命令                              | 说明                                              |
| ------------------------------- | --------------------------------- | ------------------------------------------------- |
| `feature/*` → `develop`         | `git merge --no-ff feature/xxx`   | 保留合并节点，便于整块回滚                        |
| `release/*` → `main`            | `git merge --no-ff release/x.y.z` | 同上，并在合并后打 tag                            |
| `release/*` → `develop`         | 同上                              | 把发布期间的修复带回集成分支                      |
| `hotfix/*` → `main` / `develop` | 同上                              | 两处都要合，漏了 develop 会导致下个版本回退该修复 |

**合并前必须满足**：CI 全绿、至少 1 人 approve、分支已 rebase 到最新 develop、无冲突。合并后删除远端分支。

## PR 规范

**标题**：与 commit 规范一致，因为 `--no-ff` 合并时它会成为合并节点的标题。

**描述**（模板见 `.github/pull_request_template.md`）必须包含：

1. 改了什么（一段话）
2. 为什么改（关联 issue）
3. 怎么验证的（手动步骤或测试）
4. 影响面（是否涉及打包、权限、数据结构变更）

**关于规模**：

- 单个 PR 建议控制在 400 行 diff 以内；超出请在描述里说明为什么不能拆。拆分通常比 review 更快。
- UI 改动附截图，**亮色与暗色各一张**。
- 涉及 `capabilities/default.json`、`tauri.conf.json`、`Cargo.toml` 的改动，要在描述里单独标出。
- 作者负责跟进评论，不要等 reviewer 催。reviewer 尽量在 1 个工作日内给第一次反馈。

## Review 时看什么

按优先级，前三条能挡住大部分问题：

1. **正确性**：边界条件、错误处理、异步竞态。
2. **边界**：`pages/` 有没有直接调 `invoke`，`lib/` 有没有混入 JSX。
3. **安全**：入参校验、路径穿越、权限是否开大了。
4. **一致性**：命名与样式 token 是否符合规范。

风格问题交给 Prettier 和 ESLint，reviewer 不要在这上面花时间。

## 仓库设置（一次性）

规范能不能落地，取决于服务端有没有开保护。新建仓库后由管理员完成：

| 设置         | 值                                           |
| ------------ | -------------------------------------------- |
| 默认分支     | `develop`                                    |
| 保护分支     | `main`、`develop`                            |
| 合并前要求   | CI 通过 + 至少 1 个 approve                  |
| 允许强推     | 关闭                                         |
| 允许合并方式 | 只保留 merge commit（与 `--no-ff` 策略一致） |
| 合并后       | 自动删除源分支                               |

GitHub 路径：Settings → Branches → Add branch protection rule。

## 冲突处理

```bash
git fetch origin
git rebase origin/develop
# 冲突文件会标记出来
# 编辑解决后：
git add <file>
git rebase --continue

# 想整个放弃重来：
git rebase --abort
```

原则：

- 冲突解决后**必须重新跑一遍自检**，rebase 后的代码和你想的不一定一样。
- 涉及 `pnpm-lock.yaml`、`Cargo.lock` 的冲突，不要手改，重新生成：`pnpm install`、`cargo update -p <crate>`。
- 不确定的冲突找提交者一起看，不要凭感觉删代码。

## 发布流程

```bash
# 1. 从 develop 切发布分支
git switch develop && git pull --rebase
git switch -c release/1.2.0

# 2. 同步版本号（见 scripts/set-version.mjs）
pnpm version:set 1.2.0

# 3. 更新 CHANGELOG（把 Unreleased 段落改为 1.2.0 并写日期）
# 4. 此分支只允许 fix，不允许 feat

# 5. 合入 main 并打标签
git switch main && git pull --rebase
git merge --no-ff release/1.2.0
git tag -a v1.2.0 -m "v1.2.0"
git push origin main --follow-tags

# 6. 合回 develop（关键，否则下个版本会丢掉发布期的修复）
git switch develop
git merge --no-ff release/1.2.0
git push origin develop

# 7. 删除发布分支
git branch -d release/1.2.0
git push origin --delete release/1.2.0
```

发布检查清单见 [构建与发布](../build-release.md#发布检查清单)。

## 紧急修复

```bash
git switch main && git pull --rebase
git switch -c hotfix/1.1.1
# 修 bug，自检，提交
git switch main && git merge --no-ff hotfix/1.1.1
git tag -a v1.1.1 -m "v1.1.1"
git push origin main --follow-tags

# 必须回合并到 develop
git switch develop && git merge --no-ff hotfix/1.1.1 && git push
```

判断标准：**只有线上故障才走 hotfix**。还没发布的 bug 一律回 develop 走正常流程。

## 明确禁止

- 直接 push 到 `develop` 或 `main`
- 在 `develop` / `main` 上 rebase 或 force push
- 用 `git merge develop` 同步特性分支
- 用 `git push --force`（只能用 `--force-with-lease`）
- 提交 `node_modules`、`dist`、`src-tauri/target`
- 提交任何密钥、证书、`.env`
- 一个 PR 同时做重构和功能改动
- 把 `release/*` 只合到 `main` 不合回 `develop`
