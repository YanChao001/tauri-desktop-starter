# Git 协作规范

本文规定分支、提交、评审和发布的协作方式，使特性边界、集成时间与提交范围可以追踪。

## 分支模型

采用精简版 GitFlow：两条长期分支 + 四种短期分支。

| 分支                     | 用途                                 | 从哪来    | 合到哪                             | 生命周期   |
| ------------------------ | ------------------------------------ | --------- | ---------------------------------- | ---------- |
| `main`                   | 生产代码，每次合并都对应一个发布标签 | —         | —                                  | 永久       |
| `develop`                | 集成分支，日常开发的合并目标         | `main`    | —                                  | 永久       |
| `feature/<issue>-<slug>` | 新功能                               | `develop` | `develop`                          | 合并后删除 |
| `fix/<issue>-<slug>`     | 普通缺陷修复                         | `develop` | `develop`                          | 合并后删除 |
| `release/<x.y.z>`        | 发布修复、版本和必要发布配置         | `develop` | `main`，再由 `main` 回流 `develop` | 发布后删除 |
| `hotfix/<x.y.z>`         | 线上紧急修复                         | `main`    | `main`，再由 `main` 回流 `develop` | 发布后删除 |

分支名全小写，单词用连字符；功能 / 普通修复有 issue 时带编号，如 `feature/42-command-palette`、`fix/57-window-flash`；发布 / 紧急修复使用版本号。

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

普通功能 / 修复分支合并前按需整理临时提交，留下可独立理解和回滚的原子提交；已经清晰的里程碑提交不必为形式再次改写。交互环境可用 `git rebase -i origin/develop`；非交互工具使用事先明确范围的非交互整理或保留原子提交，不强行启动编辑器。发布与紧急修复分支不改写共享历史。分支内 rebase 保持线性，集成时 `--no-ff` 保留特性边界，取舍见 [ADR 0002](../adr/0002-git-merge-strategy.md)。改变策略时同步仓库设置与规范。

### 并行 worktree 与线性里程碑

并行任务从同一设计基线分出隔离 worktree，先约定公共契约和独占文件范围；共享入口、清单、生成文件和锁文件由集成方串行维护。worktree 名称不是功能历史，不自动构成需要合入的分支。

由集成方检查各模块补丁并按依赖顺序形成里程碑提交，可直接应用未提交补丁，或依次 cherry-pick 已明确授权的模块提交；不要把临时任务分支逐个 merge 进特性分支。共享 Cargo target 的构建顺序执行，避免并行编译争用和用旧产物验收。各模块仍须实际运行适用检查，不能把子任务报告当作集成验证。

此处的线性只针对特性分支内部，不改变保护分支通过 PR、`--no-ff` 合并的规则。未经请求不推送、开发布或合入保护分支。

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

- subject 不超过 50 字，动词开头，结尾不加句号。
- 正文按需要说明问题、改动原因、行为影响及验证结果，避免中英文交替描述同一工程事实。工具自动生成的合并记录与外部依赖元数据保留其标准格式。
- 一次提交围绕一个明确问题；必要的格式整理和文档同步随对应改动提交，避免夹带无关重排。
- 破坏性变更在 footer 写 `BREAKING CHANGE: 说明`，并在 PR 标题加 `!`，如 `feat(ipc)!: 重命名 invoke 封装`。
- 不提交 `node_modules`、`dist`、`dist-web`、`src-tauri/target` 等依赖与构建输出；凭据及 `.env` 的处理见 [密钥与证书](../security.md#密钥与证书)。

## 本地不装 git hook

模板未引入 husky / lint-staged。本地按 [日常验证范围](../testing.md#日常验证范围) 执行相关检查，不强制每次提交运行 `pnpm verify`；CI 执行完整校验，是否阻止合并由仓库管理员配置的必需检查与分支保护决定。

## 合并方式

| 合并路径                          | 命令                              | 说明                                             |
| --------------------------------- | --------------------------------- | ------------------------------------------------ |
| `feature/*` / `fix/*` → `develop` | `git merge --no-ff feature/xxx`   | 保留合并节点，便于整块回滚                       |
| `release/*` → `main`              | `git merge --no-ff release/x.y.z` | 同上，并在合并后打 tag                           |
| `hotfix/*` → `main`               | `git merge --no-ff hotfix/x.y.z`  | 发布紧急修复，并在合并后打 tag                   |
| `main` → `develop`                | `git merge --no-ff main`          | 发布后回流正式发布提交、修复和版本，保留共同祖先 |

表中命令说明合并策略，保护分支的实际合入通过 PR 完成。发布按 `release/*`（或 `hotfix/*`）→ `main` → `develop` 顺序回流，完成后再删除短期分支；不将同一发布分支分别合入两条长期分支，以免遗漏 `main` 的正式发布提交。

若发布期间 `develop` 已推进，导致直接从 `main` 回流的 PR 无法满足其同步要求，从最新 `develop` 创建 `sync/release-x.y.z`，合并 `origin/main`、处理实际冲突后向 `develop` 开 PR；不为同步而直接修改保护分支。发布与回流的取舍见 [ADR 0005](../adr/0005-gitflow-release-backmerge.md)。

团队协作和外部贡献默认至少由 1 位非作者批准。单维护者自己的变更保留 PR、自审记录和 CI 结果；GitHub 不支持作者批准自己的 PR，应按实际维护者数量设置分支规则。仓库已启用的保护要求仍须满足，不以文档代替审批或临时绕过保护。

## PR 规范

**标题**：遵循提交信息规范；合并时确认合并提交能说明该 PR 的用途，标题是否自动沿用取决于平台合并设置。

**描述**：按 [PR 模板](../../.github/pull_request_template.md) 交代最终行为、原因、实际验证结果及影响范围，注明相关但未验证的情形。

达到 [设计评审门槛](../engineering-at-scale.md#设计评审与-adr-门槛) 时附影响分析和适用评审，长期技术取舍再记录 ADR。

**关于规模**：

- PR 围绕一个问题；能独立评审与验证的改动再拆分，不以固定行数作为门槛。
- 视觉变化按需附截图；涉及主题颜色时提供明暗主题结果。交互和动效变化说明复现步骤与观察结果，必要时附录屏；无视觉变化不要求截图。
- 涉及 `capabilities/default.json`、`tauri.conf.json`、`Cargo.toml` 的改动，要在描述里单独标出。
- 作者跟进并解决评审意见；评审人通常在 1 个工作日内给出首次反馈，无法按期处理时说明安排。

## 代码评审重点

按以下优先级检查：

1. **正确性**：边界条件、错误处理、异步竞态。
2. **边界**：`pages/` 是否绕过原生门面调用 `invoke`，`lib/` 是否包含界面实现。
3. **安全**：入参校验、路径访问边界与最小权限。
4. **一致性**：命名与样式 token 是否符合规范。

可自动处理的格式与静态规则由 Prettier 和 ESLint 检查，人工评审关注行为、边界和工程取舍。

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
| 合并前要求   | `质量门禁` 通过；按上文维护者规模配置非作者评审                  |
| 分支同步要求 | `develop` 要求来源分支最新；`main` 不要求来源分支包含最新 `main` |
| 允许强推     | 关闭                                                             |
| 允许合并方式 | 只保留 merge commit（与 `--no-ff` 策略一致）                     |
| 合并后       | 特性分支可删除；发布与紧急修复待 `main` 回流 `develop` 后删除    |

GitHub 路径：Settings → Branches → Add branch protection rule。

`main` 使用必需状态检查的宽松模式，仍须通过 `质量门禁`，不豁免管理员或允许强推。发布前核对已验证的来源和目标 SHA，目标 `main` 推进后重新验证，不沿用旧基线结果，也无需为祖先关系向 `release/*` 补入空合并。两种状态检查模式见 [GitHub 说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)。

分支保护、默认分支、允许的合并方式都是服务端设置，本地仓库无法携带；创建派生仓库时由管理员配置，换开发机器无需重设现有仓库规则。

## 自动化工作流

| 工作流                                          | 触发条件                                      | 行为                                                                                                    |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [持续集成](../../.github/workflows/ci.yml)      | 向 `main` / `develop` 提交 PR、推送或手动运行 | 汇总前端、浏览器、三端 Rust 与桌面 E2E 为 `质量门禁`；覆盖范围见 [测试规范](../testing.md#日常验证范围) |
| [在线演示](../../.github/workflows/pages.yml)   | `develop` 的相关源码推送，或在该分支手动运行  | 构建并验证浏览器产物，通过 GitHub Actions 部署 Pages，无需产物分支                                      |
| [版本发布](../../.github/workflows/release.yml) | 推送 `v*` 标签，或手动运行                    | 验证代码已进入 `main` 及版本一致，构建各平台安装包，必要任务全部成功后自动公开 Release                  |
| [依赖更新](../../.github/dependabot.yml)        | 配置的更新周期                                | 向 `develop` 提交依赖更新 PR，沿用相同检查和评审                                                        |
| [依赖审计](../../.github/workflows/audit.yml)   | 每周一或手动运行                              | 检查 npm 与 Rust 锁文件中的已知漏洞                                                                     |

触发条件和任务以链接的配置为准；CI 配置不等于本地或目标设备实测。README 图片随相关功能 PR 提交，见 [截图流程](../testing.md#readme-原生截图更新)。

## 冲突处理

同步、继续及放弃命令见 [rebase 规则](#rebase-规则必须遵守)。解决冲突时还需确认：

- 冲突解决后重新执行适用检查，确认 rebase 后的最终行为与预期一致。
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
