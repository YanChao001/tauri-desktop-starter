# AGENTS.md

本文件适用于整个仓库，提供工作入口和关键约束；完整规范由 [文档索引](./docs/README.md) 指向的权威文档维护，修改约定时同步更新。

## 开始工作

- 先读 [README](./README.md) 和 [文档索引](./docs/README.md)，再按任务阅读相关文档与源码，不必为局部改动通读全部资料。
- 项目定位为通用桌面应用 demo 基座；文档、代码示例与后续计划描述通用能力，具体业务方向由派生项目定义。
- 默认保留完整可操作 demo；`minimal` 仅改变展示，不删除源码、依赖或权限；真实裁剪与新增页面 / IPC 见 [模块指南](./docs/demo-modules.md)。
- 按任务查阅 [架构](./docs/architecture.md)、[开发](./docs/development.md) 或 [排障](./docs/troubleshooting.md)。命令、版本和默认值以配置与实现为准，发现文档偏差时一并修正。
- 跨模块、兼容、权限、窗口生命周期或发布恢复变更按 [设计门槛](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 明确影响和验证方案；长期取舍记入 [ADR](./docs/adr/README.md)，普通局部改动无需提案或 ADR。

## 环境与运行

Tauri 2 + React 19 + TypeScript，桌面与浏览器共用 `src/`。版本读取 [`.nvmrc`](./.nvmrc)、[`package.json`](./package.json) 和 [`rust-toolchain.toml`](./rust-toolchain.toml)。使用 pnpm，首次安装执行 `pnpm install --frozen-lockfile`，保留锁文件。

命令从仓库根目录运行，见 [常用命令](./docs/development.md#常用命令)；未安装依赖可用 `node scripts/doctor.mjs` 诊断。源码入口见 [运行时结构](./docs/architecture.md#运行时结构)。不手改 `dist/`、`dist-web/`、`src-tauri/target/` 或 `artifacts/` 构建输出。

## 命令被策略拦截时

- 带 `-Force` 的检查命令（如 `Get-ChildItem -Force`）应与删除、修改、服务启停等操作分成独立工具调用，不要放在同一脚本中；仅换行或用分号分隔无效。
- 遇到 `blocked by policy`，先检查完整脚本是否混用了上述命令和参数，不要直接归因于权限不足。
- 每步执行后核验实际结果；仍被拦截时如实记录命令和错误。

## 实现约束

- **路由与命令**：路由、导航、懒加载与预载统一维护于 `src/routes.tsx`；菜单、命令面板和快捷键复用 `src/commands/` 与 `CommandsProvider`。保留模式和环境的可用性过滤。
- **原生门面**：手写应用代码通过 `src/lib/tauri.ts` 使用系统能力，页面、组件和 Hook 不直接导入 `@tauri-apps/*` 或调用 `invoke`。生成绑定与门面契约测试沿用现有例外。
- **IPC 契约**：Rust 命令和 DTO 是类型来源，基础及领域命令统一在 `bindings.rs` 注册。变更后运行 `pnpm bindings:generate`、`pnpm bindings:check` 并提交生成结果；不手改 `src/lib/generated/bindings.ts`、重复声明 DTO 或散落命令字符串。命令归属见 [架构说明](./docs/architecture.md)。
- **Rust 分层与错误**：`lib.rs` 只组装插件、状态、命令和生命周期，业务放服务模块；阻塞 I/O 使用 `blocking::run` / `spawn_blocking`。命令返回 `NativeResult<T>`，前端按稳定 `code` 处理，不解析错误文本；生成类型不能代替边界运行时校验。
- **状态与持久化**：页面内状态留在组件，跨页偏好复用 `SettingsProvider`、`settings-model.ts` 与 `settings-sync.ts`。保留设置迁移、原子写入、revision 冲突处理、多窗口同步及未来 schema 拒写保护；数据库沿用事务迁移、参数化查询和版本冲突语义。异步订阅须处理卸载、StrictMode 重建和晚到的取消函数。
- **工作与恢复**：未保存工作登记 `useUnsavedWork`，保留离页回调和协商 AbortSignal；任务使用有界队列与合作取消，停止等待不等于原生回滚。沿用备份、隔离、恢复归档和未来版本保护，不以删除用户数据修复错误。
- **双环境**：保留 HashRouter 与浏览器演示；原生入口说明环境限制，实际调用由门面检查，不伪造 IPC 成功。浏览器 localStorage 与原生存档分开，临时演示数据不冒充持久化或后台服务。
- **代码组织**：遵循 [代码风格](./docs/conventions/code-style.md)。组件文件使用 `kebab-case`、组件名使用 `PascalCase`、Rust 模块使用 `snake_case`；页面默认导出，项目组件命名导出。手写 TypeScript 不用 `any` 或 `enum`，未知数据用 `unknown` 收窄。复用真实规则，不为局部示例预建空壳模块或未使用的扩展点。
- **复杂度与兼容**：开发阶段以当前契约为准，变更同步更新相关调用方，不为未承诺支持的历史版本保留兼容负担；按当前需求、信任边界和独立失败场景决定设计与测试，见 [约束与复杂度](./docs/conventions/code-style.md#约束与复杂度) 和 [测试边界](./docs/testing.md#测试的收益与边界)。
- **界面与语言**：遵循 [界面规范](./docs/conventions/ui-guidelines.md)，复用语义 token 与 `src/components/ui/`，保留键盘操作、焦点和无障碍语义。界面文案通过 `src/i18n/` 同步中英词典；新增语言更新 `registry.ts`。持续动效消费 `useDemoMotion` 活动状态，处理减少动效、离屏、文档隐藏与卸载清理。
- **说明与反馈**：精简常驻解释，操作反馈复用右下角 toast，避免提示挤压布局；保留必要正文、关键错误和无障碍信息，见 [说明与布局稳定](./docs/conventions/ui-guidelines.md#说明与布局稳定)。
- **上游组件**：`src/components/ui/` 可做保持调用兼容的定制，升级时保留本地行为修复；不对该目录批量格式化，不手改逐字保留的 `src/styles/shadcn.css`。

## 验证与交付

按 [日常验证范围](./docs/testing.md#日常验证范围) 检查受影响行为；通过后仅在继续改动、失败或仍有明确疑点时重跑。

界面检查默认用 `pnpm test:ui` 无头浏览器。未安排前台验收时，不运行 `test:e2e --interactive`、`docs:capture --interactive`、有界面浏览器或测试 exe；原生验收使用独立 CI / 虚拟机或用户安排的前台时段，见 [桌面干扰边界](./docs/testing.md#避免干扰本机桌面)。README 图片按 [截图流程](./docs/testing.md#readme-原生截图更新) 随功能 PR 提交。

`pnpm verify` 不包含全部分层检查；绑定、Rust、浏览器和真实桌面分别验证。Rust 检查前构建 `dist/` 供 `generate_context!` 读取，具体命令见 [Rust 测试](./docs/testing.md#rust-测试)。

- 测试就近放置，前端命名 `*.test.ts(x)`，组件测试优先 mock `@/lib/tauri`；验证具体回归，不复制实现或追求覆盖率数字。
- 真实桌面测试使用既有 E2E runner、独立标识符和临时数据目录，只管理本次创建的进程与数据；源码或配置变化后重新构建，不用旧 `--skip-build` 结果。不能用浏览器 mock 或 debug E2E 代替正式安装版、目标平台和升级验收。
- 交付说明实际改动、检查结果和未验证范围；CI 平台配置不等于本机实测。

## 配置、生成资源与安全

- 应用身份与品牌集中在 `app.config.json`，前端通过 `src/config/app.ts` 使用；派生项目见 [初始化流程](./docs/development.md#项目初始化)。版本用 `pnpm version:set x.y.z` 同步，再运行 `pnpm version:check`。
- 品牌视觉源只维护 `resources/branding/*.svg`，修改后执行 `pnpm branding:generate`、`pnpm branding:check` 并提交派生图标与安装器资源；映射和分发流程见 [构建与发布](./docs/build-release.md)。
- 按 [安全规范](./docs/security.md) 校验 IPC、路径、存储与外部 URL，权限最小化；权限 / CSP 变化说明影响，插件 capability 不是所有自定义命令的 ACL。
- 不提交密钥、证书、令牌或真实 `.env`，`VITE_` 对前端公开。凭据不存 localStorage、普通 JSON 或 SQLite，日志保持脱敏；更新保留 HTTPS、可信端点与签名验证，实际签名范围见 [签名策略](./docs/code-signing-policy.md)。
- 新依赖按 [评审标准](./docs/development.md#新增依赖的评审标准) 说明体积、维护状态、许可证与平台影响。锁文件冲突先合清单再基于现有锁文件解析，不删除锁文件或借机全量升级。

## 文档与 Git 协作

- 自有工程文档用中文、UTF-8 和相对链接，英文 README 保留简短快速开始；事实只在权威文档定义，其余引用。文档随代码更新，长期文档补索引，不另建 CHANGELOG 或临时流水账，见 [维护规则](./docs/README.md#维护规则)。
- 分支与合并遵循 [Git 协作规范](./docs/conventions/git-workflow.md)：功能 / 修复从 `develop` 开分支，普通特性分支用 rebase 同步，保护分支走 PR 和 `--no-ff` 合并，不直接推送或改写保护分支历史。
- 提交信息采用 Conventional Commits，type / scope 保留英文，主题与正文使用中文；PR 说明最终行为、原因、验证和影响范围。权限、Tauri 配置与 Cargo 清单变化单独指出，使用仓库已有 PR 模板。
