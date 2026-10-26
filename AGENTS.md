# AGENTS.md

本文件适用于整个仓库，为编码智能体提供工作入口和关键约束。完整规范由 [文档索引](./docs/README.md) 中的对应文档维护；修改约定时同步其权威定义，避免产生两套规则。

## 开始工作

- 先读 [README](./README.md) 和 [文档索引](./docs/README.md)，再按任务阅读相关文档与源码，不必为局部改动通读全部资料。
- 默认保留完整可操作 demo；`minimal` 仅影响展示。体验、真实模块裁剪与新增页面 / IPC 教程见 [模块指南](./docs/demo-modules.md)，不可把隐藏导航当成已经移除依赖或权限。
- 模块职责与数据边界见 [架构说明](./docs/architecture.md)；环境与脚本见 [开发指南](./docs/development.md)；故障定位见 [排障手册](./docs/troubleshooting.md)。命令、版本和默认配置以对应配置文件与实际实现为准，发现文档偏差时一并修正。
- 涉及跨模块、数据兼容、权限、窗口生命周期或发布恢复时，先按 [设计门槛](./docs/engineering-at-scale.md#设计评审与-adr-门槛) 明确影响、兼容和验证方案；长期技术取舍记录到 [ADR](./docs/adr/README.md)。普通局部改动无需新建提案或 ADR。

## 环境与运行

这是 Tauri 2 + React 19 + TypeScript 桌面应用基座，桌面与浏览器演示共用 `src/`。Node 版本见 [`.nvmrc`](./.nvmrc)，其他支持版本及精确 pnpm 版本见 [`package.json`](./package.json)，Rust 工具链见 [`rust-toolchain.toml`](./rust-toolchain.toml)。使用 pnpm，首次安装执行 `pnpm install --frozen-lockfile`，保留现有锁文件。

命令从仓库根目录运行，按 [常用命令](./docs/development.md#常用命令) 选择桌面开发、浏览器预览或构建；未安装依赖时可用 `node scripts/doctor.mjs` 诊断环境。源码入口见 [运行时结构](./docs/architecture.md#运行时结构)。修改源码，不手改 `dist/`、`dist-web/`、`src-tauri/target/` 或 `artifacts/` 的构建输出。

## 命令被策略拦截时

- 带 `-Force` 的检查命令（如 `Get-ChildItem -Force`）应与删除、修改、服务启停等操作分成独立工具调用，不要放在同一脚本中；仅换行或用分号分隔无效。
- 遇到 `blocked by policy`，先检查完整脚本是否混用了上述命令和参数，不要直接归因于权限不足。
- 每步执行后核验实际结果；仍被拦截时如实记录命令和错误。

## 实现约束

- **路由与命令**：路由、导航与页面懒加载统一维护于 `src/routes.tsx`；菜单、命令面板与快捷键复用 `src/commands/` 和 `CommandsProvider` 的注册、执行入口。保留演示 / 精简模式与原生环境的可用性过滤。
- **原生门面**：手写应用代码通过 `src/lib/tauri.ts` 使用系统能力，页面、组件和 Hook 不直接导入 `@tauri-apps/*` 或调用 `invoke`。生成绑定与门面契约测试沿用现有例外。
- **IPC 契约**：Rust 命令和 DTO 是类型来源；基础命令在 `commands.rs`，领域命令在对应 `*_commands.rs` 或已有生命周期 / 恢复模块，统一在 `bindings.rs` 注册。变更后运行 `pnpm bindings:generate` 与 `pnpm bindings:check`，提交生成结果；不手改 `src/lib/generated/bindings.ts`，不另写重复 DTO 或散落命令字符串。
- **Rust 分层与错误**：`lib.rs` 只组装插件、共享状态、命令和生命周期，业务逻辑放对应服务模块。阻塞 I/O 通过现有 `blocking::run` / `spawn_blocking` 移出异步工作线程。命令使用 `NativeResult<T>` 和结构化错误；前端按稳定 `code` 处理，不解析错误文本。生成类型不能替代 Rust 边界的运行时校验。
- **状态与持久化**：页面内状态留在组件，跨页偏好复用 `SettingsProvider`、`settings-model.ts` 与 `settings-sync.ts`。保留设置迁移、原子写入、revision 冲突处理、多窗口同步及未来 schema 拒写保护；数据库沿用事务迁移、参数化查询和版本冲突语义。异步订阅须处理卸载、StrictMode 重建和晚到的取消函数。
- **工作与恢复**：未保存工作登记 `useUnsavedWork`，保留离页回调并遵循协商 AbortSignal；任务使用有界队列与合作取消，前端停止等待不冒充原生回滚。备份、启动隔离、恢复归档与未来版本保护沿用既有服务，不以删除用户数据修复错误。
- **双环境**：保留 HashRouter 和浏览器演示能力；浏览器中的原生能力入口明确说明环境限制，实际调用仍由门面检查，不伪造 IPC 成功。浏览器 localStorage 与桌面原生存档分别维护，演示场景的临时数据不冒充持久化或后台服务。
- **代码组织**：遵循 [代码风格](./docs/conventions/code-style.md)。组件文件使用 `kebab-case`、组件名使用 `PascalCase`、Rust 模块使用 `snake_case`；页面默认导出，项目组件命名导出。手写 TypeScript 不用 `any` 或 `enum`，未知数据用 `unknown` 收窄。复用真实规则，不为局部示例预建空壳模块或未使用的扩展点。
- **界面与语言**：遵循 [界面规范](./docs/conventions/ui-guidelines.md)，复用语义 token 与 `src/components/ui/`，保留键盘操作、焦点和无障碍语义。界面文案通过 `src/i18n/` 同步中英词典；新增语言更新 `registry.ts`。持续动效消费 `useDemoMotion` 活动状态，处理减少动效、离屏、文档隐藏与卸载清理。
- **说明与反馈**：遵循 [说明与布局稳定](./docs/conventions/ui-guidelines.md#说明与布局稳定)，精简常驻解释，操作反馈复用右下角 toast，避免动态文字和结果提示挤压布局；保留必要正文、关键错误与无障碍信息。
- **上游组件**：`src/components/ui/` 可做保持调用兼容的定制，升级时保留本地行为修复；不对该目录批量格式化，不手改逐字保留的 `src/styles/shadcn.css`。

## 验证与交付

按 [日常验证范围](./docs/testing.md#日常验证范围) 选择检查，先验证本次受影响的行为。已有检查通过后，仅在继续改动、出现失败或仍有明确疑点时重跑。

日常界面检查默认使用 `pnpm test:ui` 的无头浏览器，不抢占用户正在工作的桌面。未明确安排前台验收时，不运行 `test:e2e --interactive`、`docs:capture --interactive`、有界面浏览器或直接启动测试 exe；需要原生验收时记录待验证范围，按 [桌面干扰边界](./docs/testing.md#避免干扰本机桌面) 使用独立 CI / 虚拟机或用户安排的前台时段。README 图片按 [截图流程](./docs/testing.md#readme-原生截图更新) 随相关功能 PR 提交。

`pnpm verify` 的覆盖范围和分层命令统一见 [测试规范](./docs/testing.md#日常验证范围)；Rust、绑定、浏览器与真实桌面需分别验证。完整 Rust 检查按 [Rust 测试](./docs/testing.md#rust-测试) 执行，先构建 `dist/` 供 `generate_context!` 读取，不要求每次局部改动跑整套检查。

- 测试与源码就近放置，前端命名 `*.test.ts(x)`；组件测试优先 mock `@/lib/tauri`。新增测试应防止具体行为回归，不复制实现或为覆盖率数字加测试。
- 真实桌面测试使用既有 E2E runner、独立标识符和临时数据目录，只管理本次创建的进程与数据；源码或配置变化后重新构建，不用旧 `--skip-build` 结果。不能用浏览器 mock 或 debug E2E 代替正式安装版、目标平台和升级验收。
- 交付说明实际改动、已执行检查与结果，并如实标明未验证范围；CI 配置覆盖某个平台不等于本机已实测。测试和恢复验证详见 [测试规范](./docs/testing.md)。

## 配置、生成资源与安全

- 应用身份与品牌默认值集中在 `app.config.json`，前端通过 `src/config/app.ts` 使用；派生项目按 [初始化流程](./docs/development.md#项目初始化) 操作。版本使用 `pnpm version:set x.y.z` 同步，再运行 `pnpm version:check`，不单改某一处版本号。
- 品牌视觉源只维护 `resources/branding/*.svg`，修改后执行 `pnpm branding:generate`、`pnpm branding:check` 并提交派生图标与安装器资源；映射和分发流程见 [构建与发布](./docs/build-release.md)。
- 遵循 [安全规范](./docs/security.md)：IPC 入参、路径、存储数据和外部 URL 在边界校验，权限保持最小范围；权限与 CSP 变化说明用途和影响。不要把插件 capability 白名单当作所有自定义 Rust 命令的 ACL。
- 不提交密钥、证书、令牌或真实 `.env`；`VITE_` 变量对前端公开。凭据不存 localStorage、普通 JSON 或 SQLite；日志与诊断保留脱敏。更新维持 HTTPS、可信端点和签名验证，不为调试绕过；签名状态以实际配置与验证结果为准，见 [签名策略](./docs/code-signing-policy.md)。
- 新依赖按 [评审标准](./docs/development.md#新增依赖的评审标准) 说明体积、维护状态、许可证与平台影响。锁文件冲突先合清单再基于现有锁文件解析，不删除锁文件或借机全量升级。

## 文档与 Git 协作

- 自有工程规范使用中文、UTF-8 和相对链接，英文 README 保留简短快速开始，遵循 [文档维护规则](./docs/README.md#维护规则)。一份事实只在职责最明确的文档定义，其他位置引用；新增长期文档补索引，代码与相关文档同步修改，不另建 CHANGELOG 或临时排查流水账。
- 分支与合并遵循 [Git 协作规范](./docs/conventions/git-workflow.md)：功能 / 修复从 `develop` 开分支，普通特性分支用 rebase 同步，保护分支走 PR 和 `--no-ff` 合并，不直接推送或改写保护分支历史。
- 提交信息采用 Conventional Commits，type / scope 保留英文，主题与正文使用中文；PR 说明最终行为、原因、验证和影响范围。权限、Tauri 配置与 Cargo 清单变化单独指出，使用仓库已有 PR 模板。
