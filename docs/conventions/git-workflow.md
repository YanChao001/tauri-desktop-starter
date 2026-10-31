# Git 协作规范

本文维护分支、提交、PR 与发布回流流程；本地验证按 [改动范围](../testing.md#日常验证范围) 选择。

## 分支模型

采用精简版 GitFlow：两条长期分支 + 四种短期分支。

| 分支                     | 用途                         | 从哪来    | 合到哪                             | 生命周期   |
| ------------------------ | ---------------------------- | --------- | ---------------------------------- | ---------- |
| `main`                   | 正式发布基线                 | —         | —                                  | 永久       |
| `develop`                | 集成分支，日常开发的合并目标 | `main`    | —                                  | 永久       |
| `feature/<issue>-<slug>` | 新功能                       | `develop` | `develop`                          | 合并后删除 |
| `fix/<issue>-<slug>`     | 普通缺陷修复                 | `develop` | `develop`                          | 合并后删除 |
| `release/<x.y.z>`        | 发布修复、版本和必要发布配置 | `develop` | `main`，再由 `main` 回流 `develop` | 发布后删除 |
| `hotfix/<x.y.z>`         | 线上紧急修复                 | `main`    | `main`，再由 `main` 回流 `develop` | 发布后删除 |

分支名全小写，单词用连字符；有 issue 时可带编号，如 `feature/42-command-palette`、`fix/57-window-flash`；发布 / 紧急修复使用版本号。

## 日常开发流程

```bash
# 从最新集成分支开始
git switch develop
git pull --ff-only
git switch -c feature/42-command-palette

# 开发中及合并前同步
git fetch origin
git rebase origin/develop

# 完成相关检查后首次推送
git push -u origin feature/42-command-palette
```

按 [日常验证范围](../testing.md#日常验证范围) 自检后开 PR；CI 通过、无冲突并完成适用评审后，以 merge commit 合入 `develop`。已推送分支的同步方式见下表。

## rebase 规则（必须遵守）

| 场景                      | 做法                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| 拉取远端更新              | 保护分支用 `git pull --ff-only`；自己的特性分支可用 `git pull --rebase`            |
| 同步 `develop` 到特性分支 | `git rebase origin/develop`，**不允许** `git merge develop`                        |
| 普通特性分支合并前        | 必须 rebase 到最新 `origin/develop`，且本地自检通过                                |
| 冲突                      | 本地解决 → `git add <file>` → `git rebase --continue`；放弃用 `git rebase --abort` |
| 已推送的分支被 rebase     | `git push --force-with-lease`，**禁止** `--force`                                  |
| `develop` / `main`        | 保护分支：只能通过 PR 合并，不 rebase、不 force push、不直接 push                  |
| `release/*` / `hotfix/*`  | 由发布负责人推送，不改写共享历史；仅修复与必要的版本、发布配置调整                 |

普通功能 / 修复分支合并前按需整理临时提交，保留可理解、可回滚的提交；已有清晰提交可直接保留。交互整理可用 `git rebase -i origin/develop`，自动工具使用明确范围的非交互操作。分支内 rebase 保持线性，集成时 `--no-ff` 保留特性边界，取舍见 [ADR 0002](../adr/0002-git-merge-strategy.md)。

### 并行 worktree 与线性里程碑

同一工作区并行编辑时约定文件范围，共享入口、清单、生成文件和锁文件串行维护。需要独立分支或构建环境时再用 worktree，并核对实际 HEAD 与同步基线。

集成方按依赖顺序应用补丁或 cherry-pick 模块提交，在特性分支内保留线性历史；最终集成结果执行适用检查。共享 Cargo target 的构建串行执行，避免编译争用和旧产物混用。推送与发布按用户授权和保护分支流程执行。

## 提交信息规范

采用 Conventional Commits；类型和模块标识保留英文，主题与正文使用中文。API、路径、命令和外部产品名称保留原标识。

```text
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

```text
feat(window): 支持记住窗口尺寸与位置
fix(tauri): 修复重复启动时窗口不聚焦
refactor(ipc): 把 invoke 调用收敛到 lib/tauri.ts
build(deps): 更新 Tauri 依赖
docs: 补充发布流程中的签名说明
```

要求：

- subject 用简短中文说明动作，结尾不加句号。
- 正文按需要说明问题、改动原因、行为影响及验证结果，避免中英文交替描述同一工程事实。工具自动生成的合并记录与外部依赖元数据保留其标准格式。
- 一次提交围绕一个明确问题；必要的格式整理和文档同步随对应改动提交，避免夹带无关重排。
- 破坏性变更在 footer 写 `BREAKING CHANGE: 说明`，并在 PR 标题加 `!`，如 `feat(ipc)!: 重命名 invoke 封装`。
- 不提交 `node_modules`、`dist`、`dist-web`、`src-tauri/target` 等依赖与构建输出；凭据及 `.env` 的处理见 [密钥与证书](../security.md#密钥与证书)。

## 本地不装 git hook

模板未引入 husky / lint-staged。本地按 [日常验证范围](../testing.md#日常验证范围) 执行相关检查，不强制每次提交运行 `pnpm verify`；CI 按工作流执行并汇总检查，是否阻止合并由服务端必需检查与分支保护决定。

## 合并方式

| 合并路径                          | 命令                              | 说明                                             |
| --------------------------------- | --------------------------------- | ------------------------------------------------ |
| `feature/*` / `fix/*` → `develop` | `git merge --no-ff feature/xxx`   | 保留合并节点，便于整块回滚                       |
| `release/*` → `main`              | `git merge --no-ff release/x.y.z` | 同上，并在合并后打 tag                           |
| `hotfix/*` → `main`               | `git merge --no-ff hotfix/x.y.z`  | 发布紧急修复，并在合并后打 tag                   |
| `main` → `develop`                | `git merge --no-ff main`          | 发布后回流正式发布提交、修复和版本，保留共同祖先 |

表中命令说明合并策略，保护分支的实际合入通过 PR 完成。发布按 `release/*`（或 `hotfix/*`）→ `main` → `develop` 顺序回流，完成后再删除短期分支；不将同一发布分支分别合入两条长期分支，以免遗漏 `main` 的正式发布提交。

若发布期间 `develop` 已推进，导致直接从 `main` 回流的 PR 无法满足其同步要求，从最新 `develop` 创建 `sync/release-x.y.z`，合并 `origin/main`、处理实际冲突后向 `develop` 开 PR；不为同步而直接修改保护分支。发布与回流的取舍见 [ADR 0005](../adr/0005-gitflow-release-backmerge.md)。

评审要求按实际维护者数量和服务端规则设置。单维护者的变更保留 PR、自审与 CI 结果；多人协作安排非作者评审，满足仓库已启用的保护要求。

## PR 规范

**标题**：遵循提交信息规范；合并时确认合并提交能说明该 PR 的用途，标题是否自动沿用取决于平台合并设置。

**描述**：按 [PR 模板](../../.github/pull_request_template.md) 交代最终行为、原因、实际验证结果及影响范围，注明相关但未验证的情形。

达到 [设计评审门槛](../engineering-at-scale.md#设计评审与-adr-门槛) 时附影响分析和适用评审，长期技术取舍再记录 ADR。

**关于规模**：

- PR 围绕一个问题；能独立评审与验证的改动再拆分，不以固定行数作为门槛。
- 视觉变化按需附截图；涉及主题颜色时提供明暗主题结果。交互和动效变化说明复现步骤与观察结果，必要时附录屏；无视觉变化不要求截图。
- 涉及 `capabilities/default.json`、`tauri.conf.json`、`Cargo.toml` 的改动，要在描述里单独标出。
- 评审意见在合并前处理或明确后续范围。

## 代码评审重点

评审关注改动实际影响：

1. **行为**：需求是否完成，独立失败和异步竞态是否处理。
2. **边界**：职责、原生门面与数据来源是否清晰，抽象是否服务当前用途。
3. **安全**：涉及外部输入、路径或权限时，检查相应信任边界。
4. **验证**：证据覆盖受影响行为，未验证范围说明准确。

格式与静态规则交给现有工具，复杂度取舍见 [代码风格](./code-style.md#约束与复杂度)。

## 首次推送

复制模板并创建自己的 GitHub 仓库后，若本地还没有远端，先把下例的 `<org>/<repo>` 替换为真实仓库路径再执行：

```bash
git remote add origin git@github.com:<org>/<repo>.git
git switch main
git branch develop
git push -u origin main
git push -u origin develop
```

上例假设 `main` 已存在、`develop` 尚未创建；已有集成分支时跳过创建。不要把模板原仓库的历史标签作为新产品的版本一起推送。推完到仓库设置里把默认分支改成 `develop`，再按下表配置保护。

## 仓库设置（一次性）

分支规范通过服务端保护规则落实，新建仓库后由管理员完成以下设置：

| 设置         | 值                                                               |
| ------------ | ---------------------------------------------------------------- |
| 默认分支     | `develop`                                                        |
| 保护分支     | `main`、`develop`                                                |
| 适用范围     | 管理员同样受保护规则约束                                         |
| 合并前要求   | `质量门禁` 通过；按上文维护者规模配置非作者评审                  |
| 分支同步要求 | `develop` 要求来源分支最新；`main` 不要求来源分支包含最新 `main` |
| 允许强推     | 关闭                                                             |
| 允许合并方式 | 只保留 merge commit（与 `--no-ff` 策略一致）                     |
| 合并后       | 特性分支可删除；发布与紧急修复待 `main` 回流 `develop` 后删除    |

GitHub 路径：Settings → Branches → Add branch protection rule。

`main` 的必需检查使用宽松模式，仍须通过 `质量门禁`。发布前核对来源和目标 SHA；目标推进后重新确认受影响的检查结果。设置方式见 [GitHub 说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)。

分支保护、默认分支、允许的合并方式都是服务端设置，本地仓库无法携带；创建派生仓库时由管理员配置，换开发机器无需重设现有仓库规则。

## 自动化工作流

| 工作流                                          | 触发条件                                      | 行为                                                                                                    |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [持续集成](../../.github/workflows/ci.yml)      | 向 `main` / `develop` 提交 PR、推送或手动运行 | 汇总前端、浏览器、三端 Rust 与桌面 E2E 为 `质量门禁`；覆盖范围见 [测试规范](../testing.md#日常验证范围) |
| [在线演示](../../.github/workflows/pages.yml)   | `develop` 的相关源码推送，或在该分支手动运行  | 构建并验证浏览器产物，通过 GitHub Actions 部署 Pages，无需产物分支                                      |
| [版本发布](../../.github/workflows/release.yml) | 推送 `v*` 标签，或手动运行                    | 验证代码已进入 `main` 及版本一致，构建各平台安装包，必要任务全部成功后自动公开 Release                  |
| [依赖更新](../../.github/dependabot.yml)        | 配置的更新周期                                | 向 `develop` 提交依赖更新 PR，沿用相同检查和评审                                                        |
| [依赖审计](../../.github/workflows/audit.yml)   | 每周一或手动运行                              | 检查 npm 与 Rust 锁文件中的已知漏洞                                                                     |

触发条件、任务与跳过规则以配置为准，CI 配置与实际执行结果分别说明。README 图片见 [截图流程](../testing.md#readme-原生截图更新)。

## 冲突处理

同步、继续及放弃命令见 [rebase 规则](#rebase-规则必须遵守)。解决冲突时还需确认：

- 冲突解决后检查最终差异，对受冲突处理影响的行为执行验证。
- 锁文件冲突先合并清单，再基于已有锁文件重新解析并审查差异，见 [锁文件冲突处理](../troubleshooting.md#pnpm-锁文件冲突)；不要借解决冲突全量升级依赖。
- 无法确定冲突双方语义时，与原提交者确认处理方案。

## 发布流程

以下以 `1.2.0` 为例，替换为实际版本与标签。这里维护分支操作；产物、签名、发布说明、验收和失败重跑统一见 [构建与发布](../build-release.md#ci-多平台构建)。

```bash
# 从最新 develop 创建发布分支
git switch develop
git pull --ff-only
git switch -c release/1.2.0
pnpm version:set 1.2.0

# 审查范围；首次发布改用 git log HEAD --oneline
git log v1.1.1..HEAD --oneline
git push -u origin release/1.2.0
```

发布分支只接受修复及必要版本、发布配置调整。向 `main` 开 PR，CI 和适用评审通过后保留 merge commit 合并。完成 [发布检查清单](../build-release.md#发布检查清单)，在确认的正式发布提交打 tag：

```bash
git switch main
git pull --ff-only
git tag -a v1.2.0 -m "v1.2.0"
git push origin v1.2.0
```

推送 tag 即决定公开，工作流成功后自动发布；适用验收、未验证范围和发布说明须提前确认。再从 `main` 向 `develop` 开回流 PR，按 [合并方式](#合并方式) 处理同步，完成后删除发布分支：

```bash
git fetch origin
git branch -d release/1.2.0
git push origin --delete release/1.2.0
```

## 紧急修复

仅线上故障走 hotfix；未发布的缺陷从 `develop` 按普通修复处理。

```bash
git switch main
git pull --ff-only
git switch -c hotfix/1.1.1
# 修复后同步版本，再自检、提交
pnpm version:set 1.1.1
git push -u origin hotfix/1.1.1
```

随后沿用 [发布流程](#发布流程)：PR 合入 `main` → 确认适用验收和说明 → 在正式发布提交打 tag → `main` 回流 `develop` → 删除短期分支。紧急恢复后补齐的设计与回归要求见 [设计评审门槛](../engineering-at-scale.md#设计评审与-adr-门槛)。
