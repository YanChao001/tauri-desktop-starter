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

选择能证明本次行为的层级。纯逻辑在所属模块验证，入口用少量集成场景确认接线，系统行为再交给真实桌面或安装包。

## 日常验证范围

先确认要证明的行为，再选最小有效检查。检查已通过且没有继续改动、失败或明确疑点时，结束验证。

| 任务或改动       | 本地验证起点                           | 何时扩大范围                                                 |
| ---------------- | -------------------------------------- | ------------------------------------------------------------ |
| 文档、注释       | 修改文件的格式、链接与事实核对         | 命令、默认值或权限说明变化时核对实现；无需运行应用测试       |
| 文案、样式、布局 | 受影响的无头界面场景                   | 涉及主题、键盘或窗口尺寸时补对应维度                         |
| 功能             | 相关测试与类型检查                     | 共享状态、公共入口或测试基础设施变化时跑受影响层的全量测试   |
| 修复             | 可复现缺陷的回归，检查修复后结果       | 同一原因影响其他入口时补相应场景；低风险可视调整可用预览确认 |
| 工程脚本         | 被修改脚本的测试                       | 共用文件操作或构建入口变化时再跑全部脚本测试                 |
| Rust、IPC        | 对应 Rust 测试；IPC 改动生成并检查绑定 | 原生窗口、生命周期或平台集成变化时安排对应桌面验证           |
| 发布             | 发布检查与目标平台构建、安装升级验收   | 按 [构建与发布](./build-release.md) 确定目标和证据           |

```bash
# 运行指定测试文件，或根据源码依赖选择相关测试
pnpm test src/layouts/app-shell.test.tsx
pnpm exec vitest related --run src/lib/settings-sync.ts

# 定向验证工程脚本
node --test scripts/clean.test.mjs

# 只检查本次修改的文档
pnpm exec prettier --check docs/testing.md
```

`pnpm verify` 汇总格式、lint、类型、前端 / 脚本测试、配置与生成资源一致性检查，最后构建桌面前端；准确步骤见 [`scripts/verify.mjs`](../scripts/verify.mjs)。它适合共享基础设施改动或交付前自查，不是每次提交的前置条件，也不包含 Rust、IPC 重新导出、浏览器 Playwright 或真实桌面检查。CI 的固定范围见 [持续集成检查](#持续集成检查)，无需在本地重复整套 CI。

### 并行与耗时

`verify` 最多并行三组，组内顺序执行；任何检查失败都会阻止最后构建，其余独立检查仍完成并汇总。耗时显示在终端，完整输出保存在本次 `.cache/verify/` 子目录。

```bash
# 减少资源争用，或顺序执行以定位并发问题 / 对比耗时
pnpm verify --jobs 2
pnpm verify --jobs 1

# 单独运行前端测试时，可按本机资源覆盖 worker 数并比较耗时
pnpm test --maxWorkers=6
```

浏览器测试的 worker 配置见 [`playwright.config.ts`](../playwright.config.ts)，用 `pnpm test:browser --workers=1` 顺序复现或采样。两个浏览器测试进程共享预览端口和报告目录，应分开运行，测试期间保持 `dist-web/` 不变。共用 Cargo target 的检查和绑定生成顺序执行即可；保留编译缓存，不靠叠加构建提速。

## 测试的收益与边界

新增测试应能指出它防止的独立回归。可逆的样式、文案调整通常用预览确认；行为修复、持久化、并发和外部输入边界保留针对性回归。

- 断言用户可观察的结果和公开契约。除非本身是要求，不固定注册项数量、SVG 画法、内部调用顺序、DOM 私有结构或特定 token 配色；等价实现与正常增加注册项不应要求修改无关测试。
- 完整规则矩阵由所属层维护，入口确认接线。选择能改变行为的语言、主题、平台与环境，不做全笛卡尔积；浏览器替身与真实 IPC、提交模块与重编模块仍有不同的验证作用。
- 删除无实际用途的分支时，同时删除只保护该分支的测试；保留数据兼容、原子提交、并发冲突、权限、合作取消、恢复与无障碍的具体失败场景。
- 复用与本轮源码匹配的产物，避免重复构建和预检；过滤器须实际匹配到测试。覆盖率用于定位遗漏，不设百分比门槛。

## 避免干扰本机桌面

日常界面回归默认使用无头浏览器，鼠标、键盘和焦点操作在测试浏览器内部完成。真实窗口验收安排在独立 CI / 虚拟机，或用户明确安排的前台时段。

| 命令                                | 桌面影响与用途                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm test:ui`                      | 先构建浏览器产物，再运行无头 Playwright；不显示浏览器窗口，适合用户继续工作时验证界面。 |
| `pnpm e2e:build`                    | 只构建隔离的原生测试程序，不启动应用窗口。                                              |
| `pnpm test:installer --interactive` | 执行 NSIS 原生绘制回归，会启动测试 exe；仅用于隔离 Windows 环境或安排的验收时段。       |
| `pnpm test:e2e --interactive`       | 显式运行真实桌面验收；会显示、激活和切换窗口，并验证最小化 / 恢复等行为。               |
| `pnpm docs:capture --interactive`   | Windows 原生截图采集并同步；会显示和调整窗口，只运行三个 README 场景。                  |

`test:e2e` 和 `docs:capture` 要求显式 `--interactive`，CI 也不绕过。普通 `test:scripts` / `verify` 跳过安装器绘制回归；单独执行 `test:installer --interactive` 还需 Windows 和 Tauri 缓存中的 NSIS 编译器。

独立标识符和临时目录只隔离数据，`windowsHide` 只隐藏子进程控制台，均不隔离应用 GUI 的前台焦点。未安排前台时段时使用无头检查，原生验收或截图更新列为待办；沿用已有图片或匹配提交的 CI 截图，不以移动、最小化测试窗口代替隔离环境。

## 前端与脚本

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm test:scripts
pnpm verify
```

测试与源码同目录，命名 `*.test.ts(x)`。组件使用 jsdom，纯逻辑可用 `// @vitest-environment node`；运行配置和初始化见 [`vitest.config.ts`](../vitest.config.ts) 与 [`src/test/setup.ts`](../src/test/setup.ts)。

组件测试优先 mock `@/lib/tauri` 的业务能力，避免绑定插件内部实现。只在原生门面的少量契约测试中 mock `@tauri-apps/api/core`，确认真正的命令名、参数和结构化错误；真实 E2E 不使用这些 mock。

共享设置协议重点覆盖迁移 / 未来版本拒写、加载期间编辑、在途保存、跨窗口旧事件、CAS 冲突、失败重试与 StrictMode 订阅重建。业务测试就近覆盖输入保留、部分失败、网络取消 / 超时、离页草稿和晚到订阅；局部字段复用已有模型与测试，异步断言等待具体状态。

`test:scripts` 运行 `scripts/` 和 `e2e/` 的 Node 单元测试，不启动真实 WebView。文件与进程测试只操作本次临时目录和受控进程，覆盖回滚、并发编辑保留、链接边界及清理，不修改真实项目身份或用户数据。新增入口示例见 [模块指南](./demo-modules.md#新增页面到-ipc-与测试)。

## 体验与动效验收

界面规则由 [界面规范](./conventions/ui-guidelines.md) 定义，现有回归在 [`e2e/browser/`](../e2e/browser/)。按改动选择相关场景：

| 范围           | 验证行为                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 交互与草稿     | 操作生效，应用 / 撤销可恢复；切页、重试、离页与取消保留输入；键盘、焦点和表单错误关联可用                               |
| 导航与设置     | 路由、命令和模式过滤一致；切页不抢焦点，弹层和提示不挤压布局，保存失败可重试                                            |
| 持续动效       | 运行 / 暂停、减少动效、文档隐藏、离屏和卸载；观察实际播放或位置及清理，分别覆盖受影响的 CSS、命令式或 Motion 实现       |
| 背景与皮肤     | 导入与切换、坏数据和晚到结果、事务 / 多窗口同步与重启恢复；在受影响的材质和极端背景上检查可读性                         |
| 全屏           | 入口状态一致，退出后恢复布局与偏好；拒绝、重复操作及晚到订阅处理正确                                                    |
| 窗口尺寸与位置 | 尺寸预设、工作区限制、手动拖动和失败重试；重启后记住位置 / 居中，显示器不可用时可操作，切换策略与重复激活不移动当前窗口 |

全局布局变化检查最小窗口，主题变化补明暗和高对比度，翻译变化补对应语言；无需组合所有维度。原生全屏回归在 Windows 分别从普通和最大化窗口进入，检查外框、客户区及 WebView 覆盖完整显示器（含任务栏原占用区域），退出后还原此前尺寸、位置与最大化状态。浏览器 Fullscreen API 不覆盖该原生行为。

## 自定义扩展界面

此层验证生产 React 外壳、包内 HTML / SDK 与真实离线 Wasm，原生传输、窗口和系统服务由 fixture 提供。先初始化 `marketplace` 子模块、安装 `wasm32-unknown-unknown` 目标，并按 [浏览器冒烟](#浏览器生产构建冒烟) 准备 Chromium。本轮产物尚未准备时，从宿主根目录执行：

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

内置源码变化后先执行 `pnpm extension:demos:build`，完整重建比对用 `pnpm extension:demos:check --rebuild`。市场 `check` 编译模块并运行真实 Wasm fixture，不签发生产目录。与源码匹配的产物可复用，`STARTER_EXTENSION_TOOL` 可指定 CLI 绝对路径；构建约定见 [内置应用资源](./extensions.md#内置应用资源) 和 [市场开发指南](../marketplace/docs/development.md)。

[runner](../e2e/extension-ui.mjs) 维护实际应用与语言、主题、窗口 profile，可定向执行：

```bash
pnpm test:extensions:ui scientific-calculator --profiles=1,2
```

| 定向入口                                                               | 适用改动与覆盖边界                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm test:extensions:styles`                                          | 真实宿主控件与 SDK 默认样式、状态、Shadow DOM、键盘和强制颜色对照；不启动 Rust             |
| `node e2e/extension-ui.mjs --styles-only`                              | 实际插件包的选定控件、圆角、背景与导航；尊重计算器 / Snake 的设计例外，不运行完整业务      |
| `node e2e/extension-ui.mjs wallpaper-browser --wallpaper-local-only`   | 离线种子图库的应用、编辑 / 删除、键盘与确认焦点                                            |
| `node e2e/extension-ui.mjs wallpaper-browser --wallpaper-preview-only` | 离线图片 fixture 的预览布局、操作、信息层与焦点                                            |
| `node e2e/extensions/workbench-studio.mjs`                             | 工作台真实 HTML / SDK 的画布、图表、流程与草稿；消息与业务均为 fixture                     |
| `node e2e/extensions/navigation-cache.mjs`                             | 真实路由、宿主组件与 SDK 的预载、iframe 保留、稳定 DOM、草稿与隐藏请求拒绝；IPC 为 fixture |

`test:extensions:ui` 已先执行样式对照，直接运行它时无需再单独执行相同检查。实际业务使用操作结果断言，覆盖草稿 / 重载、语言 / 主题切换、减少动效、键盘、导出 / 重试和溢出；相关网络、存储、WebRTC、子框与导航绕过保留隔离负例。

页面缓存相关改动补充：预载不执行 IPC，隐藏页面退出布局 / 焦点且停止新请求和观察，在途回执继续完成，LRU 移出后恢复草稿，身份变化 / 撤权移除旧界面。活动状态同时验证 SDK 和绕过 SDK 的宿主桥拒绝路径。

透明度按普通面板、字段材质和作者背景分别验证；绘图对象及状态色不套用面板断言。axe 扫描透明文档时会临时补宿主纯色底，真实透明合成另由像素检查验证。对照期望取自真实宿主组件，具体 profile 与动作由 runner 维护。

报告在 `artifacts/extensions/custom-ui/`，记录模块 / UI 哈希和实际动作；`STARTER_EXTENSION_UI_RUN_ID` 可隔离报告子目录。定向检查只证明选中的应用与场景；真实 IPC、目标 WebView、系统对话框、音频、多机 LAN / 防火墙、在线图源和安装版需按实际改动另验。隔离契约见 [自定义界面](./extensions.md#自定义界面)。

## Rust 测试

Rust 构建需要 `dist/` 供 `generate_context!` 读取，尚未准备时先运行 `pnpm build`。局部改动筛选对应测试；共享原生基础设施或交付前的完整检查如下：

```bash
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm bindings:check
```

服务测试注入临时路径，验证入参、稳定错误码、事务和并发冲突，无需启动图形界面。新增 feature 单独编译；E2E feature 与正式安装包的验证作用不同。

虚拟会话与记录示例可通过无头测试验证：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib device::
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib capture::
cargo test --manifest-path src-tauri/Cargo.toml --locked --bin device-tool --test device_tool
```

`device_tool` 使用本轮 CLI 和自建临时目录，验证精确二进制往返、记录 / 回放、既有输出保护、截断拒绝 / 显式前缀恢复和未来格式。模块测试覆盖游标缺口、旧连接 token、发送仲裁、饱和时关闭 / 排空、坏校验与失败写入。这些测试只证明 [虚拟示例](./device-workbench.md) 与文件链路。

[Wasmtime 缓存补丁](../src-tauri/vendor/wasmtime-internal-cache/README.md)或压缩依赖变化时运行 `pnpm test:wasmtime-cache`。脚本在独立临时 workspace 运行上游测试，复用宿主 target，不修改生产源码或锁文件；它不包含在 `verify` 中。

IPC 改动后运行 `pnpm bindings:generate`、`pnpm bindings:check` 并提交生成结果；两者均通过 Rust 导出，需准备 `dist/`，也会同步 / 检查独立 SDK 公共 DTO。仅 SDK 提取规则变化时可运行 `pnpm extension:sdk:check`。生成类型不能代替边界运行时校验。

扩展改动按所属层选择回归，协议和额度以 [扩展指南](./extensions.md) 为准：

| 范围                   | 独立失败场景                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 包、注册表、调度与市场 | 兼容 / 授权 / 撤权、队列与窗口隔离、签名 / 防回退 / 坏存档；预编译失败或 CAS 冲突保留原值，启动合并与前台让位                                     |
| `extension_services`   | 安装身份、活动租约、窗口 epoch、关闭 / 更新时最终提交；饱和仍可停止；管理提交后沿用执行位清理和通知，取消等待后继续收尾，清理失败仍通知已提交状态 |
| 网络与图片资源         | origin / 凭据、DNS / 地址固定、直连 / 代理授权、重试与总时限；解码 / 额度、失效资源、在途保存与关窗拒写                                           |
| 图库与 LAN             | CAS / 取消保留数据；真实环回消息 / 附件、坏帧与校验、历史迁移、重连、关窗与撤权清理                                                               |
| 前端会话与桥           | 第三方 ID、显式发送 / 授权、错误保留输入、关闭等待、导入身份 / 版本 / 哈希；启动预热非阻塞、去重与失败重试                                        |
| Wasm / worker          | 真实业务 fixture、ABI / UI；Prepare 不实例化，Run 初始化失败、预热后实例隔离、坏模块后继续工作；预算隔离、取消、环境清理与停止回收                |

连接偏好变化时验证设置迁移 / 同步和后续请求读取新值，包括更新检查到下载之间切换、旧插件 state 恢复后的继承；纯规则放在设置 / 网络所属层，真实代理传输另验。预算变化使用同一模块交替运行不同档位，检查缓存不泄漏额度；真实 worker / CLI 验证传递、取消和后续恢复，业务长局使用生产额度的真实 Wasm fixture。

例如，聚焦图片服务及前端桥：

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_resources
pnpm test src/features/extensions/extension-app-service.test.tsx src/features/extensions/extension-ui-bridge.test.ts
pnpm extension:test:worker
```

CLI 的 `extension:validate` 不实例化，`extension:test` 使用真实离线 worker；进程内测试与离线 fixture 分别不能证明 worker 协议和网络 / KV 效果往返。内置提交模块和本次重编模块分别验证，规则见 [内置应用资源](./extensions.md#内置应用资源)。

市场兼容回归混合当前与未来清单，检查可用项仍可发现、未来项不可下载 / 升级，坏外围元数据、重复键和签名仍被拒绝。市场仓库独立检查构建签名；线上验收再走通真实发现、下载、审阅和来源安装，契约见 [官方插件市场](./extensions.md#官方插件市场)。

真实网络 / 代理、keyring、另存、图库多窗口、多机 LAN 与后台接收按改动单列实测。图片供应商解析由市场插件测试，宿主负责下载与内容边界；需要无头定位时，可准备实际 API 返回的 `{ "provider": "图源名称", "url": "完整 HTTPS 图片地址" }` JSON 数组并执行显式在线测试：

```powershell
$env:STARTER_IMAGE_TEST_INPUT = 'E:\temporary\image-samples.json'
$env:STARTER_IMAGE_TEST_MODE = 'system' # 按改动选择 system 或 direct
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib live_public_images_fetch_preview_and_release -- --ignored --nocapture
```

它使用真实 Rust 下载器和独立内存缓存，覆盖图片校验、缓存 / 缩略图与释放，不读取用户存档，不覆盖插件解析、消息桥或对话框。记录来源、模式和错误码；Fake-IP / 非公网 DNS 的直连拒绝是预期安全行为，保留现有代理、DNS 和 TLS 边界。

## 数据与恢复验证

涉及设置、SQLite、导入导出或迁移行为时，用隔离目录中的脱敏样本验证受影响路径，在 PR 或发布记录说明来源 / 目标版本和实际结果。现有能力见 [数据存储](./architecture.md#数据存储)，按改动选择：

- 支持的旧格式迁移与重复启动，关键字段和用户记录保留。
- 损坏 / 未来格式、超量和并发写入失败，保留原件或可恢复备份，并给出下一步。
- 迁移失败或中断后事务恢复 / 明确拒绝；故障注入只针对本次测试实例。
- 恢复实际走通，数据范围和未保存内容的损失可说明；涉及降级时验证旧程序能否读取。

笔记 / 恢复回归在 `database.rs` / `recovery.rs`，包括完整数据往返、回收站 / 草稿、非法备份不改活数据、安全备份失败阻止替换、插入失败回滚与中断日志。工作台回归在 `workbench.rs`，包括授权 / 格式边界、另存失败保留原件、外部冲突、真实 SHA-256、有界队列 / FIFO、合作取消与重启中断。对话框、拖入、多个窗口退出或安装前保存变化再补桌面验收。

需要文件级样本时，退出测试应用后复制完整临时数据目录；运行中单独复制 `.sqlite3` 不等于可靠备份。发布恢复见 [回滚](./build-release.md#回滚)，无相关数据或生命周期变化时无需重复演练。

## 浏览器生产构建冒烟

```bash
pnpm exec playwright install --only-shell chromium
pnpm test:ui
```

Linux CI 用 `pnpm exec playwright install --with-deps --only-shell chromium` 准备系统库。`test:ui` 已包含 `build:web`；产物与本轮源码一致时直接运行 `pnpm test:browser`，定向可附加测试文件或 `--grep`。

[`playwright.config.ts`](../playwright.config.ts) 使用无头模式和独立 preview，在 `/desktop-demo/` 测试真实 `dist-web/`。结果及失败 trace / 截图在 `artifacts/browser/`；`show-trace` 查看器和 `--headed` 调试会显示界面，遵循 [桌面干扰边界](#避免干扰本机桌面)。

[`smoke.spec.ts`](../e2e/browser/smoke.spec.ts) 覆盖子路径 / 刷新、偏好、网络 fixture、命令面板键盘、虚拟列表与溢出；[`desktop-ui.spec.ts`](../e2e/browser/desktop-ui.spec.ts) 覆盖导航、弹层、背景和主题控件。axe 扫描之外，受影响的键盘、焦点和读屏行为仍需对应验证。浏览器不调用真实 Rust，文件输入 fixture 不证明系统对话框可用；Pages 发布前运行这套生产构建检查。

## 真实桌面 E2E

```bash
pnpm test:e2e --interactive
# 或分两步，适合复用刚生成的同一测试二进制
pnpm e2e:build
pnpm test:e2e --interactive --skip-build
```

[`e2e/build.mjs`](../e2e/build.mjs) 使用独立 target、debug / no-bundle、`e2e` feature 和 [测试配置](../src-tauri/tauri.e2e.conf.json)，测试程序不归档到正式分发目录。

[`e2e/run.mjs`](../e2e/run.mjs) 创建临时数据目录和动态端口，依次运行三个独立 WDIO / 应用进程：

1. `fresh`：真实 IPC、交互、窗口、诊断、SQLite 和多窗口同步，保存后续使用的偏好、位置与笔记。
2. `persisted`：重启后恢复数据与位置，再保存居中策略。
3. `centered`：主 / 次窗口创建时居中，手动移动和重复激活保持当前位置。

窗口测试只改变隔离测试窗口，不修改系统分辨率；真实 RDP 和设备热插拔仍需人工验收。

隔离规则：

- `.e2e` 标识符与正式单实例隔离；`STARTER_TEST_DATA_DIR` 只在测试 feature 生效，配置、SQLite、日志和窗口存档均在本轮临时目录。
- Windows / Linux 的 WebView 数据也在临时目录；macOS 测试窗口使用 incognito，重启断言依靠原生设置 / SQLite，不依赖 WKWebView 缓存。
- 测试构建禁止读写系统自启动与专用凭据项，窗口状态写入权限只供测试；正式构建不包含 WebDriver。
- W3C execute 调用真实 IPC；runner 只管理本次应用 / WDIO 进程，先停止受控子树再清理数据。无法确认退出时保留现场，不按产品名批量结束用户实例。
- 截图、退出码 / 信号 / PID 和原生日志保留在 `artifacts/e2e/`。

Linux CI 为本次测试进程生成 `artifacts/e2e/crash/` 文本栈，原始 core 处理后删除且不上传；崩溃仍使门禁失败。

`--skip-build` 只检查已有测试二进制的路径与哈希；源码或配置修改后应重新构建。测试 feature、标识符和数据路径保护不可用于正式分发构建。

runner 启动内嵌 WebDriver 测试程序，等待 `/status` 就绪，再让 WDIO 连接动态 localhost 端口；无需另装 tauri-driver / EdgeDriver。平台细节见 [内嵌 provider](https://webdriver.io/docs/desktop-testing/tauri/platform-support)，驱动升级需运行真实主链路。

Linux 无桌面会话时按 [`ci.yml` 的 `desktop-e2e` job](../.github/workflows/ci.yml) 准备 WebKitGTK、DBus、Xvfb 与 Openbox，单独 `xvfb-run` 不提供窗口管理。软件渲染保留 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`；替代设置 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 在部分 WebKitGTK 版本的 View Transition 中有已知 [原生崩溃](https://bugs.webkit.org/show_bug.cgi?id=324730)。macOS 保留系统红绿灯，以原生 API 验证窗口行为。

## README 原生截图更新

中英文 README 的明暗预览和英文版皮肤图库，在画面变化时随功能 PR 更新；画面未变化无需刷新。

在 Windows 独立环境或已安排的前台时段执行：

```sh
pnpm docs:capture --interactive
pnpm docs:previews:check
git diff --stat -- docs/assets
```

`docs:capture` 构建当前源码，以独立标识符和临时数据运行展厅明暗、深色皮肤图库三个场景，成功后同步三张 PNG 到 `docs/assets/` 并清理本次进程与数据。检查画面后提交图片；它不执行完整 E2E。仅已有本轮 `e2e:build` 结果时可加 `--skip-build`。

不能使用本机前台时，可复用同一版界面代码已通过的 Windows CI 截图。[`ci.yml`](../.github/workflows/ci.yml) 的 Windows 桌面 E2E 成功后上传 `readme-previews-windows`，保留 14 天，包含同轮采集的 `desktop-light.png`、`desktop-dark.png` 和 `desktop-skins-dark.png`。核对来源提交并将产物解压到 `artifacts/e2e/previews/`，再执行：

```sh
pnpm docs:previews          # 同步三张图片，不构建或启动应用
pnpm docs:previews --check  # 只比较文档图片与本轮采集结果
```

`docs:previews:check` 只检查已提交图片格式与尺寸，已纳入 `verify`，不能判断画面是否过时。CI 不提交图片；PR 核对来源提交和画面，不做跨环境逐字节比较。[同步脚本](../scripts/readme-previews.mjs) 缺图或校验失败时保留原图。本机未安排前台且无适用 CI 产物时，将原生截图更新列为待办。

## 安装版与启动验收

真实桌面 E2E 使用测试 feature 和 debug 构建，不能代替 release 安装包。在目标平台安装本次最终产物，按改动选择对应验收；发布基础流程见 [构建与发布](./build-release.md)。

- 身份、图标或安装配置变化：从平台应用入口启动，核对图标、产品名、版本及快捷方式指向的安装路径。
- 启动、窗口生命周期或单实例变化：检查退出后重开、正常 / 最小化 / 托盘隐藏时再次激活，以及初始化期间连续激活；最终只有一个长期存活的应用主进程且窗口可交互，WebView 子进程不计为重复主实例。
- 原生初始化或启动依赖变化：非关键远程请求不阻塞启动，设置 / 数据库失败有恢复入口或明确提示；窗口显示不等于完成交互启动。
- 安装升级、迁移或卸载变化：复查入口与图标，保存设置 / 笔记后退出重开，核对数据保留和卸载行为。
- 启用或更改更新链路：准备两个版本，走通发现、下载、验签和安装；安装前验证多窗口未保存工作的保存 / 取消协商，再核对重启后的版本和数据。

涉及启动性能或明确回归预算时，再用外部计时 / 录屏测量入口激活到有意义内容、可交互及重复激活恢复的耗时。记录设备 / OS / WebView、产物版本与哈希、数据和缓存条件、样本与异常日志；相同设备和口径比较前后结果，少量样本报告各次值，不推导 p95。

插件性能采样按实际触发条件区分预热前后、首次编译、编译缓存、保留 iframe 返回和 LRU 重建。预算在 [对应需求](./engineering-at-scale.md#性能发布与故障反馈) 定义；[启动阶段日志](./troubleshooting.md#启动慢或重复启动后卡死) 只用于定位，不能替代完整可交互测量。未测的平台和场景明确列出。

## 持续集成检查

[`ci.yml`](../.github/workflows/ci.yml) 定义当前检查范围：

- `changes`：明确的纯文档路径跳过原生矩阵；未知范围、比较失败或手动触发采用完整检查。
- `frontend` / `browser-smoke`：分别运行 `verify` 与生产浏览器检查，失败上传日志 / trace。
- `rust`：三平台原生检查、内置 Wasm 真编译、ABI / fixture、worker 和缓存补丁回归；参考平台另查生成绑定和提交模块一致性。
- `desktop-e2e`：三平台隔离构建和三阶段 E2E，Windows 成功时保留 README 截图。
- `quality-gate`：汇总结果，仅接受分类允许的跳过；失败、取消和非预期跳过继续阻止合入。

Rust / SDK 的 Linux 检查使用 Ubuntu 24.04，以满足固定 `extism-js` 编译器的 glibc 2.39 要求；真实桌面 E2E 与 Linux 分发构建仍保留 Ubuntu 22.04 基线。

纯文档 CI 当前仍运行前端和浏览器任务，这不增加本地文档修改的验证要求。Pages 和桌面发布各自保留本次来源与验收链；CI 平台配置不等于本机实测，测试构建也不代替正式安装、签名和升级验收。
