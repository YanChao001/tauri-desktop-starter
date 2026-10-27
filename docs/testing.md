# 测试规范

## 测试分层

| 层             | 工具                             | 关注点                                                                   |
| -------------- | -------------------------------- | ------------------------------------------------------------------------ |
| 前端纯逻辑     | Vitest                           | 设置迁移、并发同步、命令 / 快捷键、翻译和错误归一化                      |
| 组件           | Testing Library + jsdom          | 路由恢复、保存 / 重试、输入保留、键盘操作和无障碍                        |
| 工程脚本       | `node --test`                    | 版本、归档、路径边界、初始化事务 / 并发保护、诊断误判                    |
| Rust           | `cargo test`                     | 入参边界、错误码、原子存储、revision、SQLite 迁移 / 冲突、更新策略与脱敏 |
| IPC 契约       | tauri-specta 导出 + 少量调用断言 | 生成绑定未漂移、命令名 / 参数名 / DTO 一致                               |
| 浏览器构建     | Playwright + axe                 | 子路径资源、刷新、偏好恢复、键盘、虚拟列表和自动无障碍扫描               |
| 自定义扩展界面 | Playwright + axe + 原生 CLI      | 真实打包 HTML、受控消息桥、真实离线 Wasm、草稿、主题和隔离负例           |
| 真实桌面       | WebdriverIO + 内嵌 WebDriver     | 启动显示、原生 IPC、语言、窗口和进程重启后的设置                         |

按风险验证用户能感知的行为，不为覆盖率数字测试 getter、静态样式或实现细节。修复缺陷时优先增加可复现的回归。

## 日常验证范围

开发时先验证本次改动影响的行为，不要求每次编辑或提交都执行全量检查。

| 改动                    | 本地验证                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| 文档、注释、文案        | 相关文件的格式与内容核对；文案变化时预览受影响页面                   |
| 样式、布局              | 预览受影响的窗口尺寸和交互；涉及主题颜色时再检查明暗主题             |
| 前端逻辑                | 类型检查与相关测试；共享状态、公共入口或测试配置变化时跑前端全量测试 |
| 工程脚本                | 运行被修改脚本的测试；修改共用文件操作或构建入口时再跑全部脚本测试   |
| Rust、IPC、桌面生命周期 | 对应 Rust 测试，按影响补充绑定检查和真实桌面验证                     |
| 发布                    | 全量检查、目标平台构建与安装升级验收                                 |

```bash
# 运行指定测试文件，或根据源码依赖选择相关测试
pnpm test src/layouts/app-shell.test.tsx
pnpm exec vitest related --run src/lib/settings-sync.ts

# 只检查本次修改的文档
pnpm exec prettier --check docs/testing.md
```

已有检查通过后，仅在继续改动、出现失败或仍有明确疑点时重跑相关检查。CI 按下文的改动分类选择检查；需要原生验证时保留完整三平台矩阵，不把这些任务全部复制到每次本地迭代。`pnpm verify` 包含格式、身份配置与品牌资源一致性、README 截图格式与尺寸、lint、类型、前端 / 脚本测试、版本检查、内置扩展来源与分发资源哈希检查及桌面前端构建；Rust、IPC 绑定、浏览器演示构建、Playwright 和真实桌面 E2E 需分别验证。它适合共享基础设施改动或交付前自查，不是每次提交的前置条件。

### 并行与耗时

`pnpm verify` 通过 [`scripts/verify.mjs`](../scripts/verify.mjs) 最多并行三组检查：格式 / lint / 类型、配置与资源一致性、前端 / 脚本测试。组内顺序执行，避免两个测试运行器同时展开各自的 worker；任何检查失败都会阻止最终的桌面前端构建，其余独立检查仍完成并汇总。每项与总耗时显示在终端，完整输出保存在每次运行独立的 `.cache/verify/` 子目录。

```bash
# 减少资源争用，或顺序执行以定位并发问题 / 对比耗时
pnpm verify --jobs 2
pnpm verify --jobs 1

# 单独运行前端测试时，可按本机资源覆盖 worker 数并比较耗时
pnpm test --maxWorkers=6
```

浏览器测试默认使用两个 worker，在测试文件之间并行，同一文件内保持顺序；可用 `pnpm test:browser --workers=1` 顺序复现。比较性能采样时，在没有其他重任务的情况下使用一个 worker 定向运行采样。不要同时启动两个浏览器测试进程，它们共享预览端口和报告目录；测试期间也不要重建 `dist-web/`。

Cargo 已默认并行编译依赖。Rust 检查前仍须准备 `dist/`；共用同一 target 目录的 `clippy`、测试和绑定生成应顺序执行，避免构建锁等待。真实桌面 E2E 的重启持久化阶段也须保留顺序。不要通过删除 Rust 缓存或叠加多个原生构建来提速。

## 测试的收益与边界

新增测试应说明它防止的独立行为回归，不以数量、文件长度或覆盖率百分比判定收益。可逆的样式、文案调整通常用预览确认；行为修复、持久化、并发和外部输入边界保留针对性回归。

- 断言用户可观察的结果和公开契约。除非本身是要求，不固定注册项数量、SVG 画法、内部调用顺序、DOM 私有结构或特定 token 配色；等价实现与正常增加注册项不应要求修改无关测试。
- 完整规则矩阵由规则所属层维护，调用入口用少量集成场景确认接线。已经包含同一校验的完整操作不再先跑一次相同预检；相同输入、环境和测试集在没有新变化时不重复执行。
- 测试矩阵选择能改变行为的维度。语言、主题、平台与运行环境各有独立职责，不无条件做全笛卡尔积；浏览器替身与真实 IPC、提交模块与重编模块等不同边界仍分别验证。
- 删除无实际用途的分支时，同时删除只保护该分支的测试；保留数据兼容、原子提交、并发冲突、权限、合作取消、恢复与无障碍的具体失败场景。
- CI 根据可证明的改动范围选择任务，未知范围采用完整检查；聚合门禁区分有依据的跳过与失败、取消，不通过放宽失败条件获得提速。产物在同一可信执行链内复用，独立发布链保留自己的来源和验收边界。

## 避免干扰本机桌面

日常界面回归默认使用无头浏览器，鼠标、键盘和页面焦点操作在测试浏览器内部完成。不要为每次样式、翻译或布局修改重复打开真实桌面窗口。

| 命令                                | 桌面影响与用途                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm test:ui`                      | 先构建浏览器产物，再运行无头 Playwright；不显示浏览器窗口，适合用户继续工作时验证界面。 |
| `pnpm e2e:build`                    | 只构建隔离的原生测试程序，不启动应用窗口。                                              |
| `pnpm test:installer --interactive` | 执行 NSIS 原生绘制回归，会启动测试 exe；仅用于隔离 Windows 环境或安排的验收时段。       |
| `pnpm test:e2e --interactive`       | 显式运行真实桌面验收；会显示、激活和切换窗口，并验证最小化 / 恢复等行为。               |
| `pnpm docs:capture --interactive`   | Windows 原生截图采集并同步；会显示和调整窗口，只运行三个 README 场景。                  |

单独执行 `pnpm test:e2e` 或只带 `--skip-build` 会在构建、读取收据和创建进程之前退出，提示选择无头界面检查或显式的前台验收。CI 环境变量也不会自动绕过这个要求；仓库的独立 CI runner 使用 `--interactive` 保留原生覆盖。

普通 `test:scripts` / `verify` 默认跳过安装器原生绘制回归；显式运行 `test:installer --interactive` 前，需要 Windows 和 Tauri NSIS 构建缓存中的编译器。用例虽使用静默模式与不显示的测试控件，仍会创建并执行原生 exe，因此遵循同一桌面边界。发布工作流在独立 Windows runner 完成 NSIS 构建后执行该回归。

独立标识符和临时数据目录只隔离数据，不能隔离当前桌面的前台焦点。`windowsHide` 只隐藏子进程控制台，不隐藏应用 GUI，见 [Node.js 子进程选项](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)。无头浏览器由 [Playwright 的 headless 配置](https://playwright.dev/docs/test-use-options#other-options) 控制，仍可输出截图与 trace。

真实窗口、原生 IPC 和安装器验收优先安排在独立 CI / 虚拟机，或用户明确安排的前台时段。未执行时如实列为待验证；浏览器通过不能代替原生结果。桌面截图需要原生窗口，本机用户仍在工作时沿用已有截图并标明更新待办，不通过反复最小化、移动窗口或删除生产代码中的焦点逻辑来伪造后台验收。

## 前端与脚本

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm test:scripts
pnpm verify
```

测试与源码同目录，命名 `*.test.ts(x)`。组件测试使用 jsdom；纯逻辑文件用 `// @vitest-environment node` 避免启动 DOM。Vitest 使用 `vmThreads` 复用 worker 的环境加载，每个文件仍有独立的窗口与模块作用域；配置、初始化和覆盖率范围见 [`vitest.config.ts`](../vitest.config.ts) 与 [`src/test/setup.ts`](../src/test/setup.ts)。前端 Vitest 不加载 `e2e/`。覆盖率按排查需要生成，不设置百分比门槛。

组件测试优先 mock `@/lib/tauri` 的业务能力，避免绑定插件内部实现。只在原生门面的少量契约测试中 mock `@tauri-apps/api/core`，确认真正的命令名、参数和结构化错误；真实 E2E 不使用这些 mock。

设置迁移与同步协议的回归覆盖旧版本迁移、未来版本拒写、首次加载期间编辑、在途保存、跨窗口旧事件、CAS 冲突、失败后重试和 StrictMode 生命周期。局部字段变更复用已有模型与测试，不重复搭建整套场景。异步测试等待状态或持久化完成，不以固定延迟替代断言。

领域回归就近维护，重点覆盖批量部分失败、网络超时 / 取消 / 重试、Markdown 与附件边界、文件冲突保留输入、离页草稿、订阅晚到及任务退出等待；新增入口的跟做示例见 [模块指南](./demo-modules.md#新增页面到-ipc-与测试)。

`test:scripts` 统一运行 `scripts/` 和 `e2e/` 的 Node 单元测试，不启动真实 WebView。测试只使用本次创建的临时目录，清理前核对绝对路径；覆盖初始化 / 版本写入回滚、并发修改保留、重复执行一致性、链接边界、品牌格式及受控进程清理，不修改真实项目身份或用户数据。

## 体验与动效验收

按受影响的行为选择场景；演示卡片、弹簧曲线和资料数量不作为工程性能统计。界面规则见 [界面规范](./conventions/ui-guidelines.md)，已有浏览器回归位于 [`e2e/browser/`](../e2e/browser/)。

- 展厅与导览：风格选择只改局部预览，应用和撤销准确恢复外观；导览可跨页、收起，精简模式过滤隐藏演示。
- 交互与工作区：输入、筛选、收藏、布局和协作者操作确实生效；切换页签、错误重试、离页与取消保留应有草稿。覆盖树键盘、右键菜单、焦点恢复、撤销、多选、分栏、拖放与表单错误关联。
- 持续动效：分别验证运行、暂停、减少动效、文档隐藏、画布离屏及卸载；观察实际位置或播放状态，并确认监听和观察器释放。CSS、命令式播放与 Motion 布局分别覆盖，不能只断言活动标记或单张截图。
- 导航与设置：路由、过滤、命令和快捷入口一致；切页不抢焦点、不改变侧栏位置。弹层开关不改变内容宽度，提示不残留或叠加，滚动条位于标题栏下；保存失败和重试仍可见。
- 背景与皮肤：导入、去重、重编码、切换、重命名和删除可用；损坏、超限、未来格式和晚到结果不覆盖当前背景。覆盖 IndexedDB 事务、原生多窗口同步与重启恢复。内置 SVG 与最强档位的纯黑 / 白背景下，正文、标题栏和侧栏可读，次级文案达到 4.5:1 对比度。
- 全屏：菜单、命令面板和 F11 同步真实状态；Esc、顶部入口和系统退出恢复布局与侧栏偏好。覆盖拒绝、重复操作及晚到订阅；浏览器 Fullscreen API 不能替代原生验收。
- 窗口尺寸与启动位置：在真实桌面检查逻辑尺寸预设、工作区限制、特殊状态还原、手动拖动和保存失败重试；跨进程验证记住位置 / 居中、主次窗口和原显示器不可用。切换策略与重复激活不移动当前窗口；恢复默认尺寸时保留当前位置。

浏览器验收选择相关语言、主题、尺寸和侧栏状态，检查溢出、焦点与可读性；全局布局覆盖默认最小窗口 880×600，主题变化补充明暗和高对比度。真实 IPC、系统操作、原生持久化与窗口行为按下文桌面和安装版验收执行。

## 自定义扩展界面

先初始化 `marketplace` 子模块、安装 `wasm32-unknown-unknown` 目标，并按 [浏览器冒烟](#浏览器生产构建冒烟) 准备 Chromium。从宿主根目录准备本轮 CLI、内置与市场模块，再运行无头检查：

```powershell
pnpm build
cargo build --locked --manifest-path src-tauri/Cargo.toml --bin extension-tool
pnpm extension:demos:check
node --test scripts/extension-ui-sdk.test.mjs examples/extensions/apps/ui.test.mjs
$env:MARKET_REVISION = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
Push-Location marketplace
try { node scripts/check.mjs } finally { Pop-Location }
pnpm test:extensions:ui
```

内置工作台源码变化后先执行 `pnpm extension:demos:build`；完整重建比对用 `pnpm extension:demos:check --rebuild`。市场 `check` 编译收录模块并运行真实 Wasm fixture，不签发生产目录。已有与本轮源码匹配的产物时，可直接运行界面检查；`STARTER_EXTENSION_TOOL` 可指定 CLI 绝对路径。构建规则见 [内置应用资源](./extensions.md#内置应用资源) 和 [市场开发指南](../marketplace/docs/development.md)。

[runner](../e2e/extension-ui.mjs) 使用生产 React 外壳、包内 HTML / SDK 和真实离线 Wasm；服务 fixture 替换原生传输、窗口、桌面服务及系统对话框，不访问用户数据、真实 LAN 或图库。默认覆盖内置工作台、计算器、贪吃蛇、LAN 聊天及壁纸库；中英、明暗、窄屏大字号独立窗口和大屏嵌入的精确 profile 由 runner 维护。可定向执行，例如：

```bash
pnpm test:extensions:ui scientific-calculator --profiles=1,2
```

单独选择 `wallpaper-browser` 时只准备壁纸包，正常业务、授权确认和安全检查也限定于壁纸；例如 `node e2e/extension-ui.mjs wallpaper-browser --profiles=0,1,2` 会运行这三个界面 profile，并保留动效、可选权限与 iframe 隔离检查。

仅检查壁纸库本机卡片的图片应用、编辑 / 删除图标、键盘操作与确认焦点时，可运行：

```bash
node e2e/extension-ui.mjs wallpaper-browser --wallpaper-local-only
```

该模式只准备壁纸模块，在 900px 暗色和 360px 大字号界面中使用关闭网络授权的种子图库；不执行图源 HTTP、搜索矩阵、Rust 测试或安装验收。

预览弹窗的紧凑布局、操作按钮完整显示、独立图片信息层与键盘焦点，可使用 `node e2e/extension-ui.mjs wallpaper-browser --wallpaper-preview-only` 检查。该模式只准备壁纸模块，以离线图片服务 fixture 覆盖 900px 英文暗色和 360px 中文大字号；不重复图源搜索或真实网络检查。

重点检查主题 / 语言切换、减少动效、键盘、工具菜单、草稿与重载、无障碍和溢出，以及直接网络、存储、WebRTC、子框和导航绕过的负例。业务回归使用实际动作：工作台保留各场景与工具草稿，校验成果导出和失败重试；计算器检查采样、缩放和错误；游戏检查暂停、音效清理与进度；LAN 检查收发状态；壁纸区分下载、图库导入、CAS 冲突和取消。语言刷新保留 state / fields，不重复业务动作；作者 CSS 能覆盖 SDK 默认 layer。

本地工作台的 HTML / SDK 交互可先单独运行无头 fixture：

```bash
node e2e/extensions/workbench-studio.mjs
```

该 [定向检查](../e2e/extensions/workbench-studio.mjs) 加载真实工作台 HTML 和 SDK，以 fixture 消息传输验证画布、图表、流程、工具箱、检查点、语言、活动状态与布局；明暗及窗口尺寸 profile 以脚本为准，截图和报告写入 `artifacts/browser/workbench-studio/`。它不运行真实 Wasm、Tauri IPC 或系统对话框，不等同于上面的生产外壳加真实离线 Wasm runner，也不证明安装版或目标 WebView 通过验收。

宿主页面保留的回归还须验证：动态入口预载不执行 IPC；反复切换保留同一 iframe 且不重排 DOM；隐藏页面不进入布局 / 焦点顺序、不发新 SDK 请求并暂停观察、语言刷新和首屏计时；在途回执继续完成；LRU 移出后草稿可恢复；身份变化或必需授权撤销立即移除旧界面。SDK 验证缺省 `active` 兼容、CSS 动画暂停与隐藏请求拒绝，宿主桥另验证绕过 SDK 的隐藏请求同样失败。浏览器测量只能说明对应构建和 fixture 的行为，冷 / 热启动与正式安装版性能仍按 [安装版与启动验收](#安装版与启动验收) 采样。

可用 [导航缓存检查](../e2e/extensions/navigation-cache.mjs) 单独验证真实路由、ExtensionCustomUi 与 SDK 的预载和 iframe 保留行为：

```bash
node e2e/extensions/navigation-cache.mjs
```

该无头检查使用独立临时 Vite 构建与 IPC fixture，不启动 Rust；核对动态导航悬停不读取视图或申请租约、HTML 首屏不请求 Markdown / 图表解析依赖、往返普通页面与两个插件时的文档身份和局部草稿、稳定 DOM 顺序及隐藏请求拒绝。原生租约和身份撤销仍由对应 Rust 与真实桌面检查验证。

`test:extensions:ui` 先运行 `pnpm test:extensions:styles`：独立构建真实宿主控件与 CSS，对照 SDK 默认控件的主题、变体、尺寸、焦点、禁用和校验状态，并验证显式 Shadow DOM 接入、键盘和强制颜色回退。该检查可单独运行，不启动 Rust 或原生窗口；期望值取自实际宿主组件，不复制同一份样式常量充当验证。

报告与截图写入 `artifacts/extensions/custom-ui/`，包含模块 / UI 哈希和实际动作；并行任务可设置 `STARTER_EXTENSION_UI_RUN_ID`（1–80 个 ASCII 字母、数字、下划线或连字符）使用独立子目录。定向运行只报告实际应用与 profile。

该检查不验证真实 Tauri IPC、目标 WebView 注入、系统对话框、平台音频、多机 LAN / 防火墙或在线图片供应商；这些项目与正式安装版另行验收。隔离和呈现契约见 [自定义界面](./extensions.md#自定义界面)。

## Rust 测试

完整 Rust 检查从仓库根目录执行，先准备 `dist/` 供 `generate_context!` 读取：

```bash
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm bindings:check
```

局部修改可筛选对应模块；新增 feature 也要单独编译检查。服务测试注入临时路径和数据，覆盖入参、稳定错误码、事务迁移、未来版本保护与并发冲突，避免为纯逻辑启动图形界面。正式构建与 E2E feature 分别验证。

IPC 改动后运行 `pnpm bindings:generate` 并提交生成文件；它也会更新独立 SDK 公共 DTO。`bindings:check` 重新导出比较，Windows Rust CI 会阻止漂移；前端 CI 另用 `pnpm extension:sdk:check` 检查公开类型依赖闭包，脚本测试将 SDK 复制到仓库外做严格编译。生成类型不提供 Rust 边界的运行时校验。

扩展改动按所属层选择回归，协议和额度以 [扩展指南](./extensions.md) 为准：

| 范围                                        | 应验证的独立失败场景                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 包、注册表、调度与市场                      | 版本兼容、逐项授权、撤权、队列 / 窗口隔离；启用前预编译失败与 CAS 冲突保留原值、启动并发合并和前台让位；签名、防回退、损坏与未来存档保留                                  |
| `extension_services`                        | 安装身份、活动租约、窗口 epoch、关闭 / 退出 / 更新期间最终提交，以及安全外链边界                                                                                          |
| `extension_network` / `extension_resources` | origin / 方法 / 凭据隔离、DNS 与地址固定、直连 / 系统代理授权；图片发送中断最多重试一次且共用总时限，HTTP / 内容失败不重试；图片解码 / 额度、资源失效、在途保存与关窗拒写 |
| `extension_wallpaper` / `extension_lan`     | 图库 CAS、既有数据保留与取消；真实环回消息 / 附件收发与测试助手、校验和与缓存额度、历史迁移、坏帧、重连、最后窗口关闭与撤权清理                                           |
| 前端会话与界面桥                            | 通用第三方 ID、授权和显式数据发送、错误保留输入、关闭等待、导入身份 / 版本 / 哈希校验；启动预热不阻塞列表、只触发一次及失败显式重试                                       |
| 实际 Wasm / worker                          | 手写业务 fixture、ABI / UI 校验；Prepare 不实例化 / 不执行初始化、预热后实例隔离、坏模块后继续工作；取消、进程协议、环境清理与停止回收                                    |

宿主连接偏好的回归覆盖旧设置缺失字段、非法值与持久化、跨窗口同步，以及市场、更新、原生演示和扩展后续请求读取新偏好；更新检查与下载之间切换也须生效。扩展按宿主模式、缺省 / 显式请求、代理授权和环回来源验证选择 / 拒绝矩阵，壁纸恢复旧 state / checkpoint 后须继续继承宿主。纯规则复用 `storage`、`extension_network` 与对应前端模型 / 设置测试；真实代理传输另按下述在线验收记录，不以浏览器 mock 代替。

例如，聚焦图片服务及前端桥：

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_resources
pnpm test src/features/extensions/extension-app-service.test.tsx src/features/extensions/extension-ui-bridge.test.ts
pnpm extension:test:worker
```

预编译回归须分开验证包校验、仅编译 Prepare 与真实 Run：带陷阱 start 的模块应可 Prepare、在实际 Run 初始化时失败；可变全局计数器在预热后连续运行仍从各自初值开始。启用 / 安装并启用在预编译失败、取消或编译期间 revision 改变时保留原状态；启动预热核对多窗口在途合并、最多选取预算、前台抢占、停用 / 撤权 / 退出取消，以及实际结束前不释放执行位。生成绑定和门面覆盖新增的无参启动预热 IPC，浏览器 fixture 不能证明该原生编译路径已经执行。

命令计算预算另覆盖省略和 `standard` 默认、`compute` 最低宿主版本、未知值拒绝及清单之外不可覆盖。相同模块以标准档耗尽、计算档完成、再次标准档耗尽，证明缓存不泄漏额度；真实 worker 与 CLI 验证预算传递、预编译和取消后恢复。业务长局重放用真实 Wasm fixture 检查，不能仅以 UI 模拟或提高测试专用 fuel 证明生产额度足够。

没有匹配测试的过滤器不构成验收通过。CLI 的 `extension:validate` 不实例化，`extension:test` 使用真实离线 worker；进程内 Rust 测试不能替代 worker 回归，离线 fixture 不能替代网络 / KV 效果往返。内置提交模块和本次重编模块分别验证，平台重编规则见 [内置应用资源](./extensions.md#内置应用资源)，Rust / JS / TS 与固定上游模块的构建入口见 [扩展验证](./extensions.md#验证)。

市场兼容回归需在同一签名目录混合当前与未来清单，检查可用项仍可发现、未来项不能下载 / 升级，且坏外围元数据、重复键、签名或源身份仍被拒绝。线上验收使用已发布且有效的配套目录，实际走通发现、下载、审阅和来源安装；构建签名检查在市场仓库独立执行，普通宿主 CI 不拉取子模块。契约见 [官方插件市场](./extensions.md#官方插件市场)。

供应商解析由市场插件测试，宿主验证能力和图片内容。在线图片需通过配套插件真实 HTTP 链路验收，分别记录直连 / 系统代理模式与来源；Fake-IP 或非公网 DNS 的直连拒绝属于安全边界。系统 keyring、真实网络 / 代理、另存、图库多窗口、多机 LAN、后台接收与正式安装版，均在隔离设备或安排的前台时段单列实际结果。

无需启动桌面即可定位图片传输与解码问题：准备最多 48 条 `{ "provider": "图源名称", "url": "完整 HTTPS 图片地址" }` 的 JSON 数组文件，再运行显式忽略的在线测试。它调用真实 Rust 下载器，每批两张经过图片校验、资源缓存插入 / 查询、缩略图重绘和释放，记录来源 origin、错误码、大小、尺寸与耗时，不输出完整图片 URL。该检查使用独立内存缓存，不读取用户存档；它不覆盖插件解析、AppHandle 服务授权、WebView 消息桥或系统对话框。

```powershell
$env:STARTER_IMAGE_TEST_INPUT = 'E:\temporary\image-samples.json'
$env:STARTER_IMAGE_TEST_MODE = 'system' # 也须分别检查 direct
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib live_public_images_fetch_preview_and_release -- --ignored --nocapture
```

样图地址应来自该次真实 API 返回，不能把浏览器 / Node 下载成功代替宿主链路成功。直连 Fake-IP 被拒是预期失败，应明确记录；系统模式也不保证代理一定匹配或图源一定可达，不为在线测试改写代理、DNS 或关闭 TLS。

## 数据与恢复验证

涉及设置、SQLite、导入导出或更新迁移时，在隔离目录使用脱敏历史样本验证支持的升级路径，并在 PR 或发布记录中列出来源版本、目标版本、预期与实际结果。当前各存储的保护与恢复能力见 [数据存储](./architecture.md#数据存储)；以下是相关改动的验收要求，验证记录需明确未实现的能力和不适用项：

- 已支持的旧格式升级到当前格式，验证关键字段和用户记录；重复启动不得重复迁移或丢失内容。
- 损坏输入、未来版本、超量数据和并发写入被明确处理；失败时保留原始内容或可恢复备份，不以空值静默覆盖，用户能知道下一步。
- 迁移失败或进程中断后的数据状态可判定，重启后事务恢复或明确拒绝继续；只在本次创建的测试实例上注入中断，不终止用户正在使用的应用。
- 恢复步骤实际走通，确认恢复的数据范围与可能丢失的未保存内容；新格式能否被旧程序读取必须说明，不能用“有回滚”代替结果。

当前笔记页已有逻辑备份、导入预览和事务恢复；启动故障恢复使用隔离工作区，确认后在下次启动归档 / 替换。相关 Rust 回归在 `database.rs` / `recovery.rs`：超过旧列表上限的完整往返、回收站和窗口草稿、非法备份不改活数据、安全备份失败阻止替换、恢复插入失败回滚、未来版本拒写及恢复中断日志。逻辑备份不包含设置、凭据、日志或外部工作台文件；范围见 [数据存储](./architecture.md#数据存储)。

工作台与任务回归在 `workbench.rs`：受控授权、UTF-8 / 大小 / 格式边界、另存失败不触碰原件、外部改动冲突、真实 SHA-256、取消、执行 / 排队上限、FIFO 与重启中断。真实桌面还应验证系统对话框取消、拖入、文件定位、离页继续、多个窗口退出和安装前保存。普通单元测试不证明目标平台对话框、文件关联、系统凭据或通知权限实际可用。

需要文件级故障样本时，在测试应用完全退出后复制其完整临时数据目录；不能把运行中的单个 `.sqlite3` 文件复制视为可靠备份。真实产品仍需按数据价值和目标平台验证恢复，发布规则见 [回滚](./build-release.md#回滚)。没有相关数据或生命周期变化的改动不必重复整套演练。

## 浏览器生产构建冒烟

```bash
pnpm exec playwright install --only-shell chromium
pnpm test:ui
```

Linux CI 使用 `pnpm exec playwright install --with-deps --only-shell chromium` 准备系统库。`test:ui` 组合 `build:web` 与 `test:browser`；已构建本次源码时可单独执行 `pnpm test:browser`，定向复测可附加 `--grep`。[`playwright.config.ts`](../playwright.config.ts) 明确启用无头模式，启动独立端口的 preview，刻意挂载在 `/desktop-demo/`，测试真实 `dist-web/`，不复用开发服务。结果及失败 trace / 截图在 `artifacts/browser/`，查看 trace 可用 `pnpm exec playwright show-trace <trace.zip>`；交互 trace 查看器与 `--headed` 调试均属于有界面操作。

[`smoke.spec.ts`](../e2e/browser/smoke.spec.ts) 覆盖子路径资源与 HashRouter 刷新、localStorage 偏好、无外部请求的网络 fixture、命令面板键盘、万条虚拟列表的末行与有限 DOM，以及明暗 / 中英 / 窄屏 / 880px 加宽侧栏下的溢出截图。axe 扫描指定演示页的 WCAG A / AA 问题；自动扫描通过不代表完整无障碍认证，仍需键盘、焦点、读屏和目标 WebView 复核。

[`desktop-ui.spec.ts`](../e2e/browser/desktop-ui.spec.ts) 覆盖菜单、导航、滚动、提示与背景恢复；全部路由检查四组语言 / 主题 / 窗口下的溢出，并在明暗着色主题下扫描无障碍。控件回归检查七种强调色的主按钮及悬停对比度、部分选择样式、校验与原生控件明暗配色。真实桌面 [`desktop-ui.mjs`](../e2e/specs/desktop-ui.mjs) 验证窗口 / 跨窗口行为；文件输入夹具不代表已人工验收系统文件选择对话框。

浏览器冒烟验证浏览器边界，不调用真实 Rust；桌面 E2E 与正式安装验收分别提供原生和分发证据。Pages 部署必须先通过这套生产构建冒烟。

## 真实桌面 E2E

```bash
pnpm test:e2e --interactive
# 或分两步，适合复用刚生成的同一测试二进制
pnpm e2e:build
pnpm test:e2e --interactive --skip-build
```

[`e2e/build.mjs`](../e2e/build.mjs) 使用当前 Rust host、独立 `src-tauri/target/e2e/` 缓存、debug / no-bundle 构建，以及 `e2e` Cargo feature 和 [测试配置](../src-tauri/tauri.e2e.conf.json)。测试程序不会归档到正式 `installers/` / `portable/`。

[`e2e/run.mjs`](../e2e/run.mjs) 创建临时数据目录和动态端口，依次运行三个独立 WDIO / 应用进程：

1. `fresh` 验证真实 IPC、界面交互与动效、窗口操作、诊断、SQLite 和多窗口设置同步，完成恢复默认设置与窗口预设验收，并保存后续阶段使用的偏好、位置和笔记。
2. `persisted` 重新启动，验证语言、外观、设置、笔记及记住的窗口位置能够恢复，再保存居中策略。
3. `centered` 验证主 / 次窗口在创建时居中，随后手动移动与重复激活仍保持运行中的位置。

窗口测试只改变隔离测试窗口，不修改系统分辨率；真实 RDP 和设备热插拔仍需人工验收。

隔离规则：

- 标识符使用品牌标识符的 `.e2e` 后缀，与正式单实例隔离。
- `STARTER_TEST_DATA_DIR` 只在 `e2e` feature 生效；配置、SQLite、日志和窗口存档在各平台均位于临时根目录，三个阶段共享后再清理。
- Windows / Linux 的各 WebView 数据目录也在临时根内。macOS 的 WKWebView 不支持该目录选项，测试主 / 次窗口使用 incognito 非持久存储，重启断言仍验证原生设置与 SQLite；不依靠 WK 缓存保留偏好。平台限制见 [dataDirectory](https://v2.tauri.app/reference/config/#datadirectory) 与 [incognito](https://v2.tauri.app/reference/config/#incognito)。
- 测试构建禁止读写系统自启动与专用凭据项；正式构建不包含 WebDriver 插件。
- 跨进程位置验收通过测试专属权限，在阶段结束前显式保存窗口状态；正式应用仍由正常退出流程保存，不增加生产界面的窗口状态写入权限。
- 测试通过 W3C execute 调用真实 Tauri IPC，没有浏览器 mock、签名跳过或任意系统目录读写。
- runner 只管理本次创建的应用 / WDIO 进程；超时、中断或异常后先尝试停止受控子树，再清理本次临时数据。无法确认受控进程退出时保留数据以便排查，不扩大到按产品名终止用户实例。失败截图、原生日志和重启后的窗口截图保留在 `artifacts/e2e/`。

原生日志记录本次测试应用的退出码、信号与 PID。Linux CI 在隔离 runner 中为本次应用收集 core dump，并按构建收据中的确切程序生成 `artifacts/e2e/crash/` 下的原生线程栈；处理后删除对应 core，上传规则也排除所有原始 core，只保留文本栈、日志和截图。崩溃继续导致质量门禁失败，不通过重试或忽略平台代替定位。

`--skip-build` 只检查已有测试二进制的路径与哈希；源码或配置修改后应重新构建。测试 feature、标识符和数据路径保护不可用于正式分发构建。

runner 直接启动内嵌 WebDriver 的测试程序，等待 `/status` 就绪，再让 WDIO 通过动态 localhost 端口连接 W3C WebDriver。没有接入 tauri-service 的自动焦点 / mock 层，不需要额外 Rust mock 插件、生产前端 bootstrap、tauri-driver 或 EdgeDriver；窗口切换由测试显式控制。内嵌驱动支持 Windows、Linux、macOS，平台细节见 [WebdriverIO 内嵌 provider](https://webdriver.io/docs/desktop-testing/tauri/platform-support)。升级驱动和 WDIO 时应同时运行真实主链路，不能只依靠依赖可安装或类型检查通过。

Linux CI 额外安装 WebKitGTK、Xvfb、DBus 与 Openbox，以提供真正的窗口管理；无桌面会话时，按 [`ci.yml` 的 `desktop-e2e` job](../.github/workflows/ci.yml) 准备依赖并运行其 DBus / Xvfb / Openbox 命令，单独加 `xvfb-run` 不能提供窗口管理器。Xvfb 软件渲染使用 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` 保留共享内存传输；`WEBKIT_DISABLE_DMABUF_RENDERER=1` 在 WebKitGTK 2.50 等版本的 View Transition 中存在[原生空指针崩溃](https://bugs.webkit.org/show_bug.cgi?id=324730)，不能用于此测试环境。macOS 保留系统红绿灯，窗口操作通过原生 API 验证。不能用 jsdom 通过或单个平台成功代替其他平台的真实结果。

## README 原生截图更新

中英文 README 共用的明暗预览，以及英文 README 引用的皮肤图库，随影响画面的功能 PR 一起提交；合入 `develop` 后随正常发布进入 `main`。不在功能合入后再等待独立截图 PR，也不改写已发布标签。

在 Windows 独立环境或已安排的前台时段执行：

```sh
pnpm docs:capture --interactive
pnpm docs:previews:check
git diff --stat -- docs/assets
```

`docs:capture` 默认构建当前源码，使用独立应用标识符和临时数据，只运行展厅明暗主题、深色皮肤图库三个场景，不执行完整 E2E 的持久化、重启或窗口生命周期验收。采集成功后自动将 `artifacts/e2e/previews/` 中的三张 PNG 同步到 `docs/assets/preview-light.png`、`preview-dark.png` 和 `skins-dark.png`，并清理本次进程与临时数据。应检查画面后将图片与功能一起提交；画面没有变化时无需刷新。仅刚用当前源码完成 `pnpm e2e:build` 时才可追加 `--skip-build`，不能复用旧源码的 exe。

不能使用本机前台时，可复用同一版界面代码已通过的 Windows CI 截图。[`ci.yml`](../.github/workflows/ci.yml) 的 Windows 桌面 E2E 成功后上传 `readme-previews-windows`，保留 14 天，包含同轮采集的 `desktop-light.png`、`desktop-dark.png` 和 `desktop-skins-dark.png`。核对来源提交并将产物解压到 `artifacts/e2e/previews/`，再执行：

```sh
pnpm docs:previews          # 同步三张图片，不构建或启动应用
pnpm docs:previews --check  # 只比较文档图片与本轮采集结果
```

CI 保留截图产物并通过 `pnpm docs:previews:check` 检查已提交图片的 PNG 格式、窗口尺寸和明暗尺寸一致性；此检查也纳入 `pnpm verify`，不要求存在采集产物。它不能判断画面是否过时，需在 PR 中核对界面与图片。CI 不提交图片、不创建截图分支或 PR，无需为此授予写权限。源码变化后应先验证更新后的 CI 截图，再在同一个功能 PR 中补交图片；不依赖像素逐字节比较判断跨环境画面一致。

[`readme-previews.mjs`](../scripts/readme-previews.mjs) 在写入前验证全部输入，缺图或不合格时保留原图，提交中断则回滚已替换文件。不能用浏览器截图冒充原生验收；本机前台未获安排且无适用产物时，将更新列为待办。

## 安装版与启动验收

真实桌面 E2E 使用测试 feature 和 debug 构建，不能代替 release 安装包。修改启动、窗口生命周期、单实例、图标或安装配置后，在目标平台安装本次最终产物，至少验证：

- 从桌面快捷方式、开始菜单或平台应用入口首次启动，图标、产品名和发布版本正确；核对快捷方式确实指向本次安装路径，避免运行旧 exe。
- 退出后再次启动；分别验证窗口正常显示、最小化、隐藏到托盘时的再次激活。初次初始化期间也连续多次激活，确认最终只有一个长期存活的应用主进程、窗口恢复且能交互。WebView 的多个子进程是正常现象，应按同一安装路径的应用主进程判断。
- 启动不等待非关键更新检查或远程请求；设置 / 数据库加载失败时有可恢复的错误或明确失败提示。窗口可见、兜底显示或截图存在，都不能单独证明已完成交互启动。
- 在安装升级场景复查快捷方式和任务栏图标，保存设置与笔记后完整退出、重开，确认数据保留；卸载对用户数据的处理符合发布说明。

用外部计时或录屏记录从入口激活到首个有意义内容、到可交互的耗时；重复激活单独记录到窗口恢复的耗时。冷启动说明系统是否重启、缓存和 WebView 运行时状态；热启动在应用完全退出后重复测量。保留机器 / OS / WebView 版本、应用版本和哈希、模式、数据量、样本数、各次耗时及异常日志，给出中位数和最慢值。需要 p95 时收集足够样本并注明计算方式，不从少量单次结果推导稳定性。

插件采样另区分原生编译缓存与界面保留：应用启动后台预热完成前 / 后、未编译模块首次打开、已编译模块首次打开、保留 iframe 的返回、LRU 移出后的重建分别记录。注明目标插件是否被本轮预热选中、缓存是否被淘汰及 worker 是否回收，不能仅用“冷 / 热”掩盖不同触发条件；不将启用时预编译写成所有插件首开无延迟的保证。

性能目标和回归预算按 [性能治理](./engineering-at-scale.md#性能发布与故障反馈) 在对应需求或提案中确定。原生 [启动阶段日志](./troubleshooting.md#启动慢或重复启动后卡死) 用于定位初始化、窗口创建和首帧握手；它不包含系统创建进程之前的时间，也不能替代完整可交互启动测量。用同一设备、安装包和计时口径比较前后结果。未测的平台或情形明确写“未测”，安装失败、白屏、重复长期实例或预算未通过的目标不能标为通过。

## 持续集成检查

[`ci.yml`](../.github/workflows/ci.yml) 分开执行：

- `changes`：以严格的文档路径集合判断纯文档改动，未知路径、比较失败、初次推送及手动触发采用完整检查；仅明确的纯文档改动跳过原生矩阵，前端和浏览器检查继续执行。
- `frontend`：冻结安装后执行 `pnpm verify`，并行检查后构建桌面前端；失败上传完整检查日志。
- `browser-smoke`：与 `frontend` 独立并行，构建本次浏览器演示并运行 Chromium 子路径 / 交互 / 无障碍冒烟，失败上传截图与 trace；浏览器产物只在此任务构建一次。Pages 保留独立发布链的本次构建和实测，避免跨工作流引入来源及过期部署协调。
- `rust`：三端 Clippy / Rust 测试、内置 Wasm 真编译与双模块 ABI / UI 和 fixture 验证；Windows 参考平台另做模块逐字节比对、格式和生成绑定检查，失败保留必要模块与编译器证据。
- `desktop-e2e`：Windows、Ubuntu、macOS 独立构建测试应用并运行三个阶段的 E2E；失败上传截图 / 日志，Windows 成功时另存 README 截图。
- `quality-gate`：始终汇总分类、前端、浏览器和原生结果；仅分类明确为纯文档时接受原生任务跳过，其他失败、取消或非预期跳过仍拒绝。分支保护使用此项作为必需检查。

Rust / SDK 的 Linux 检查使用 Ubuntu 24.04，以满足固定 `extism-js` 编译器的 glibc 2.39 要求；真实桌面 E2E 与 Linux 分发构建仍保留 Ubuntu 22.04 基线。

CI 配置覆盖的目标平台，不等于当前开发机全部实测过。发布时仍需在目标平台检查安装 / 卸载、签名、自启动、托盘和真实版本升级，尤其不能用测试构建代替正式安装包验收。
