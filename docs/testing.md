# 测试规范

本项目用 Vitest / Testing Library 检查前端，用 Node 内置测试器检查工程脚本，用 Rust 测试检查原生服务，以 Playwright 验证浏览器生产构建，并以真实 WebView E2E 验证跨进程主链路。

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

已有检查通过后，仅在继续改动、出现失败或仍有明确疑点时重跑相关检查。CI 保留完整检查，不把 CI 的三平台验证全部复制到每次本地迭代。`pnpm verify` 包含格式、身份配置与品牌资源一致性、README 截图格式与尺寸、lint、类型、前端 / 脚本测试、版本检查、内置扩展来源与分发资源哈希检查及桌面前端构建；Rust、IPC 绑定、浏览器演示构建、Playwright 和真实桌面 E2E 需分别验证。它适合共享基础设施改动或交付前自查，不是每次提交的前置条件。

新增测试应说明要防止哪种实际回归。可逆的样式、文案调整通常用预览确认；不复制配置数组、不重复测试第三方库本身，也不为已经被类型检查约束的普通赋值增加测试。自定义组件的行为修复、数据持久化、并发和外部输入边界仍保留针对性回归。

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

领域回归与实现就近维护：`features/data-studio` 检查过滤 / 多选 / 批量部分失败与复杂表单；`features/network` 检查超时、取消、重试、离线、fixture 和本地会话；`features/media` 检查 Markdown 协议 / HTML、附件 URL 清理、WSS 和 worker。文件工作台检查外部冲突保留输入、另存取消、离页草稿及生命周期中止；`use-workspace` / `use-task-notifications` 检查订阅晚到、旧快照、通知去重及任务退出等待。新增领域入口与测试的跟做示例见 [模块指南](./demo-modules.md#新增页面到-ipc-与测试)。

脚本测试在独立临时目录创建数据，清理前确认绝对路径位于本次创建的目录中。初始化与版本设置测试覆盖全文件预检、写入失败回滚、并发修改保留和项目外目录链接拒绝；初始化还检查重复运行无差异。品牌测试覆盖 BMP 通道 / 行布局、ICO / ICNS 尺寸层、重复生成一致性、插画文字留白及输出路径链接边界。`e2e/process.test.mjs` 与被测模块就近放置，由 `test:scripts` 统一运行 `scripts/` 和 `e2e/` 下的 Node 单元测试，验证受控进程取消、启动失败、日志释放及 Unix 孤儿后代清理，不启动真实 WebView。不得改真实项目身份或用户数据。

## 体验与动效验收

演示验证可感知的交互结果，不把示例卡片、弹簧响应曲线或固定资料数量当作工程性能与测试统计。

以下场景按改动范围选用，不是每次迭代都要执行的清单。

- 创意展厅：选择风格只改变局部预览；应用后核对主题、强调色、皮肤、强度与圆角；撤销恢复此前外观。检查暂停、命令面板入口和各导览目的地，精简首页不推广已隐藏的演示。
- 交互场景：输入、选择与滑块真实更新预览；同页切换舞台保留编辑；协作者校验、角色修改和移除有结果；资料筛选、收藏、布局、空态与可取消加载可用，错误重试保留筛选与收藏。控件参照覆盖只读、禁用、错误关联和部分选择 / 全选，键盘可操作。
- 动效实验室：参数、布局、倾斜和路径控制有实际反馈，Tab / 方向键 / Home / End 与焦点行为符合控件语义；重播与暂停按场景生效。减少动效后仍能使用输入、选择及阅读结果。
- 体验导览与工作区：校验跨页 / 同页步骤、收起与精简过滤；工作区覆盖树键盘、右键菜单、焦点恢复、撤销、类型搜索多选、分栏与拖放移动。数据列显隐 / 调宽 / 详情和媒体标签切换保留输入。`e2e/browser/experience.spec.ts` 同时观察弹簧拖放与轨道流光在运行、暂停、离屏时的实际位置，并扫描四个动效场景的明暗主题。
- 活动策略：分别模拟应用减少动效、系统偏好变化、暂停、文档隐藏、实际画布离屏及卸载。检查观察器与监听释放；CSS 动画、命令式播放和 Motion 布局都应验证，不能只断言一个 `data-active` 标记。
- 导航与设置：分组、URL、演示 / 精简过滤和快捷入口一致；切页只重置内容区，不抢焦点或改变侧栏位置，同页设置搜索仍可聚焦。菜单 / 语言选择框开关时内容宽度与背景位置稳定，滚动条位于标题栏下方，细轨道无箭头且离开后淡出。折叠不显示展开时残留的提示，连续聚焦 / 悬停时最多显示一条，切页和滚动后清除。关于区折叠不影响其他设置，成功安静、失败与重试仍可见。
- 自定义背景：真实 PNG / JPEG / WebP 多选导入、去重、缩放与重编码，切换、重命名、填充方式和删除；损坏 / 超限 / 危险格式不替换当前图片，批次保留成功项；卸载或改选后晚到结果不改变当前背景。验证旧图片首次纳入图库、容量、损坏 / 未来图库拒写、刷新、原生双向多窗口同步和跨进程重启恢复，以及取消当前图片保留图库。浏览器需覆盖 IndexedDB 事务与跨标签页更新。
- 风格画廊：核对八款疏朗手绘线稿；预览与实际加载同一 SVG 蒙版，明暗与强调色改变线条颜色，手动主题不被系统主题覆盖。暗色无固定青绿染色、光晕、模糊滤镜或发光投影。检查标题栏与侧栏能看清纹理，缩略主体不被裁断；内置线稿与纯黑 / 纯白自定义图片在最强背景档位下，正文、标题栏及侧栏仍有足够的阅读底色，次级文案达到 4.5:1 对比度。
- 全屏沉浸：视图菜单、命令面板和 F11 共用实际全屏状态；进入后标题栏和侧栏隐藏，F11、Esc、顶部退出入口以及系统外部退出均能恢复布局，保留侧栏宽度 / 折叠偏好。拒绝全屏、快速重复操作与晚到订阅不留下伪全屏或泄漏。浏览器 Fullscreen API 测试不代替真实原生全屏验收。
- 窗口尺寸：在真实桌面验证预设以逻辑像素标注，选择后立即应用并记忆；范围外预设禁用，标准预设随应用配置与可用工作区适配。手动拖动后显示实际尺寸，不误选其他预设；最大化 / 最小化 / 全屏时选择尺寸应先还原。模拟几何保存失败，确认错误与重试入口，保存成功提示必须等待持久化确认。
- 启动位置：分别验证记住位置与居中策略的跨进程恢复，覆盖主 / 次窗口、多屏和原显示器不可用；居中发生在首次显示前，最大化 / 全屏状态正确恢复。切换策略不移动当前窗口，手动移动后重复激活仍保持原位。恢复默认设置覆盖已打开与已记忆窗口的尺寸，将策略恢复为记住位置并保留当前位置；偏好保存失败时保留确认框与错误。

浏览器视觉验收选择受影响的语言、主题、窗口尺寸和侧栏状态，检查溢出、弹层焦点与可读性；全局布局改动需覆盖默认最小窗口 880×600，主题改动补充明暗与高对比度检查。持续动效应在运行和暂停时分别观察实际位置或播放状态；单张截图和 jsdom 不能证明运动正确。浏览器原生能力页只能展示说明与导览，真实 IPC、系统操作和持久化仍由桌面 E2E 验证。

浏览器演示发布前执行 `pnpm build:web` 并通过 `pnpm exec vite preview --outDir dist-web` 预览，复核项目子路径下的资源加载、HashRouter 页面直接访问与刷新、localStorage 偏好恢复和窄屏布局。构建及部署方式见 [开发指南](./development.md#浏览器演示构建与部署)。桌面 E2E 与安装版验收分别提供原生行为和分发证据。

## 自定义扩展界面

从宿主根目录准备 CLI、内置 Wasm 和市场 Wasm，然后运行无头检查：

```powershell
pnpm build
cargo build --locked --manifest-path src-tauri/Cargo.toml --bin extension-tool
pnpm extension:demos:check
node --test scripts/extension-ui-sdk.test.mjs examples/extensions/apps/ui.test.mjs
$env:MARKET_REVISION = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
Push-Location marketplace
node scripts/check.mjs
Pop-Location
pnpm test:extensions:ui
```

并行运行时可设置 `STARTER_EXTENSION_UI_RUN_ID` 为 1–80 个 ASCII 字母、数字、下划线或连字符，报告将写入 `artifacts/extensions/custom-ui/<run-id>/`，避免不同任务相互覆盖；未设置时沿用原目录。该值是运行标识，不接受文件系统路径。

需先初始化 marketplace 子模块和安装 Wasm 目标；内置工作台源码变化后先执行 `pnpm extension:demos:build`，当前分发资源的完整重建比对使用 `pnpm extension:demos:check --rebuild`。市场 `check` 编译当前收录的科学计算器、贪吃蛇、局域网聊天和壁纸库，运行真实 Wasm fixture；与内置本地工作台共五个应用。单插件编译入口见各插件 README。已有匹配源码的构建可直接运行最后一条；变更插件 Rust 后必须重新编译对应模块。`STARTER_EXTENSION_TOOL` 可指定实际 CLI 绝对路径。报告与截图位于 `artifacts/extensions/custom-ui/`，报告记录 Wasm / UI 哈希和每轮真实动作。

检查使用生产 React 外壳、完整包内 HTML 和 SDK，Wasm 动作由真实 extension-tool / worker 执行；局部 Canvas / 游戏交互在界面内运行。浏览器 fixture 替换协议传输、窗口、桌面服务与系统对话框边界，不访问用户数据，不启动真实 LAN 或修改图库；取消保存返回取消。验收需覆盖中英、明暗、窄屏大字号独立窗口、精简工具菜单、语言 / 主题切换、圆形过渡及减少动效、键盘、草稿保留、界面重载、无障碍、溢出，以及直接网络 / 存储 / WebRTC / 子框绕过与导航负例。源代码不暴露测试入口到生产应用。

默认主流程按五个应用与四组 profile 形成 20 个场景：中文亮色 1120×800 / 16px、英文暗色 900×760 / 16px、中文亮色 360×760 / 20px 独立窗口、中文暗色 1920×1080 / 20px 嵌入。精确配置由 [runner](../e2e/extension-ui.mjs) 维护；定向筛选只说明实际执行的应用和 profile，不按默认总数报告通过。另检查内容框右缘与可用高度、单一整页滚动、普通状态字体、计算器三色曲线与同高按钮，以及可选权限全选 / 半选和窄屏换行。

五个应用按实际功能检查：工作台四页签独立草稿、显式载入数据和失败保留输入；计算器运算、实际采样、平移缩放与求根 / 积分错误；贪吃蛇开始、转向、触控、暂停 / 失焦、音效首次手势与清理、进度恢复；LAN 界面授权、连接状态、收发 / 未读和错误反馈；壁纸界面来源 / 许可、原图下载与图库导入区别、CAS 冲突和取消。SDK 回归另检查作者 CSS 可以覆盖默认 layer，语言变化使用既有 state / fields 的 `action: null` 环境刷新，不初始化或重做业务动作。测试实现、报告和本次实际执行结果分别说明，不把待覆盖目标写成通过。

它仍不验证真实 Tauri IPC、WebView2 / WKWebView / WebKitGTK 注入、原生文件对话框、平台音频策略、多机 LAN / 防火墙或必应及第三方图片在线服务。原生传输的脚本回归另检查顶层通信、子框拒绝、序列化、二进制和失败回退；跨平台真实 WebView 与正式安装仍需独立验收。

## Rust 测试

CSV / 差异 / 搜索的前端回归就近维护于对应领域及文件 / 笔记页；无头浏览器 `workflows.spec.ts` 检查工作流和扩展页浏览器边界。扩展改动按领域选择原生服务、实际 Wasm 与无界面 worker 检查，命令见 [扩展验证](./extensions.md#验证)。这些检查不启动应用窗口，不替代正式安装、多窗口退出和目标平台验收；测试与 CI 配置描述覆盖范围，执行结果仍在 PR / 发布证据中记录。

扩展包 / 注册表与调度检查格式 3 / API 2、最低宿主版本、必需 / 可选能力、命令门槛、明确审阅后授权、内置首次登记、回退撤权、2 项执行 / 16 项排队、按窗口串行、排队取消及旧窗口请求失效。声明任一新图片 / 系统代理 / 外链权限但 `minHostVersion` 低于 0.1.6 的清单必须拒绝。Host / network / storage 检查精确公网与本机来源、DNS 地址固定、凭据 origin 隔离、KV CAS / 配额 / 损坏拒写、类型化效果轮次、失败与取消。凭据服务单元测试使用内存替身，不能替代目标系统 keyring 验收。

前端应用回归使用第三方 ID 视图夹具检查通用字段、图表、图片、错误关联、排队状态、输入保留、关闭等待、导航恢复、可选授权、显式数据发送、单独保存结果和会话导入。导入必须匹配插件身份 / 版本 / 哈希，不执行 Wasm 或恢复文件资源 ID；错误、取消和超限不能替换当前草稿。真实本地工作台 Wasm 检查文本、CSV / JSON、待办、文件 / 网络四页签、显式数据载入、效果请求与中英输出；新市场模块另运行手写 fixture，不能用前端 fixture 替代。

服务验证按职责分层，要求使用临时数据和本轮源码，不修改用户图库：

- `extension_services`：当前安装身份、启用和每项独立权限；读写门闩、活动租约、窗口 epoch 与最终提交覆盖关闭 / 退出 / 重启 / 更新等待；安全外链拒绝非 HTTPS、凭据及非法目标，旧包不自动取得新授权。
- `extension_network`：精确 origin / 方法、HTTP 原额度和凭据来源；省略 `networkMode` 保持直连，`system` 缺少 `network:system-proxy` 时拒绝，环回 HTTP 不接受系统代理。覆盖有 / 无匹配代理、`NO_PROXY`、真实直连 DNS 全集合校验和地址固定，代理传输主机与目标的信任边界分别检查；不能以代理远端解析成功声称最终 IP 已校验。
- `extension_resources`：`network:images` 独立授权、任意公网 HTTPS GET 图片的 URL / DNS / MIME / 真解码校验、字节 / 像素 / 解码内存额度、TTL、每所有者 / 全局配额及并发。覆盖跨窗口 epoch / 插件代次拒绝、关闭 / 撤权 / 替换清理、释放、资源持有期间的预览 / 保存、取消对话框及最终写入复核；`release` 只撤销新查找，不取消已取得 `Arc` 的在途保存，关窗仍拒绝最终写入。原图另存和重绘导入分别检查。
- `extension_wallpaper`：仅图库列表、本机 / 资源导入、背景设置 CAS、重命名 / 移除及现有数据保留；与资源服务共用图片处理名额，缩略图不在最终提交窗口锁中执行，忙 / 损坏预览返回 `dataUrl: null` 并保留成功写入结果。旧供应商 `search` / `resultId` / Commons `pageId` 入口拒绝，不在宿主保留供应商解析测试。
- `extension_lan`：临时历史与真实双端环回连接的收发回执、坏帧 / 超限、重连、最后窗口关闭和撤权清理，保留损坏 / 未来存档。固定 LAN 的后台接收不等于已实现通用后台任务。

供应商 URL / 查询 / HTML / JSON 解析、搜索无结果与验证码等失败路径在市场插件测试中验证，再执行真实 Wasm HTTP 效果往返；宿主只验证能力和图片内容，不认证结果来自 Bing。另检查拒绝新网络权限后本机图库仍可用，旧 1.0.2 搜索须升级到配套 1.0.3 / 0.1.6，已有图库与设置不丢失。数学内核和游戏规则仍按各插件真实行为回归。宿主 toast、操作系统通知、固定 LAN 和通用后台能力按[实际能力矩阵](./extensions.md#受控桌面服务)区分，不为未提供的能力报告通过。

从宿主根目录可聚焦运行服务与界面回归：

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_services
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_lan
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_network
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_resources
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib extension_wallpaper
cargo test --locked --manifest-path examples/extensions/apps/Cargo.toml
pnpm test src/features/extensions/extension-app-service.test.tsx src/features/extensions/extension-ui-bridge.test.ts
```

这些命令仍需准备下述 `dist/`；没有匹配测试的过滤器不构成验收通过。媒体能力变化需重新编译匹配的 0.1.6 工具与应用进程，兼容说明见 [扩展指南](./extensions.md#架构与兼容范围)。原生宿主不再提供旧 Bing / Commons 联网测试入口；供应商联通需从配套插件的真实 HTTP 链路验收，分别记录已授权的 direct / system 模式、关键词来源和图片原站。存在 Fake-IP / 非公网 DNS 时直连必须拒绝，不能以浏览器替身或预先准备的图片冒充原生下载通过。

真实网络、系统代理、系统另存及取消、图库导入 / 多窗口同步、多机 LAN / 防火墙、真实窗口关闭和后台接收、目标 WebView 与正式安装版均须在隔离设备或已安排的前台时段单列实际结果。离线图片 fixture、浏览器服务替身与 CI 配置只说明各自边界，不能预言这些平台行为已通过。

`pnpm extension:demos:check` 快速核对源码、清单、锁文件、工具链、构建脚本、参考构建平台与模块哈希回执；Windows x64 参考平台用 `--rebuild` 实际编译并逐字节比较提交 Wasm，Linux / macOS 用显式 `--compile` 真实编译并保留参考资源。三端 Rust CI 都对提交模块与本次重编模块分别执行 ABI / UI 校验及同套手写 fixture；构建契约见 [内置应用资源](./extensions.md#内置应用资源)。开发 CLI `extension:validate` 不实例化，`extension:test` 在真实 worker 中执行离线 fixture；可用 1–32 项顺序 fixture 验证取消后下一项仍成功。`pnpm extension:test:worker` 检查真实子进程协议、超限、环境清理、实例隔离与停止回收。普通 `cargo test` 的进程内运行时测试不能代替 worker 边界，离线 fixture 不代替网络 / KV 效果端到端检查。CI 中的 Rust / 上游与 JS / TS 编译任务不代表本机或其他平台已经实测。

官方市场检查目录 schema 2 签名与有效期、跨重启最高 revision、同 revision 内容替换、换仓库 / 公钥、来源收据、包篡改、清单不符、下架与重定向边界，使用临时信任存档保留损坏 / 未来版本原件。线上联通验收需使用已发布的配套目录，核对实际 latest、签名有效期与公开附件；旧 schema 1 或其他不兼容目录被拒绝时不能当作新版目录验收。维护者在市场仓库发布后，分别检查发现、下载、审阅和来源安装；不以离线 fixture 或本地导入代替。市场仓库构建、签名与发布检查独立运行，普通宿主 CI 不要求拉取子模块。

市场演进回归还需使用同一签名目录混合当前插件与未知未来清单，验证可用项保持可发现、未来摘要没有下载 / 升级操作、原生附件下载前拒绝不兼容版本。提高最低宿主不能掩盖坏外围元数据、重复 ID / JSON 键、超限、坏签名、时间或源身份；仅修改隔离正文也必须触发同修订替换拒绝。具体隔离范围与完整 payload 摘要规则见[官方市场契约](./extensions.md#官方插件市场)。

```bash
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm bindings:check
```

从仓库根运行。先准备 `dist/`，供 `generate_context!` 读取。新增原生 feature 时，也要编译并检查相应 feature；正式和 E2E 构建不能相互替代。

无 `AppHandle` / `State` 的命令可直接测试。存储、数据库和更新策略优先在服务层注入临时路径与数据，避免为了纯逻辑启动图形界面。数据库测试应使用临时库，验证事务迁移、参数边界、未来 schema 保护与版本冲突。

IPC 改动后运行 `pnpm bindings:generate` 并提交生成文件；`bindings:check` 重新导出比较，Windows Rust CI 会阻止漂移。生成文件中的类型断言不提供运行时校验，Rust 边界测试仍然必需。

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

`--skip-build` 只检查已有测试二进制的路径与哈希；源码或配置修改后应重新构建。测试 feature、标识符和数据路径保护不可用于正式分发构建。

runner 直接启动内嵌 WebDriver 的测试程序，等待 `/status` 就绪，再让 WDIO 通过动态 localhost 端口连接 W3C WebDriver。没有接入 tauri-service 的自动焦点 / mock 层，不需要额外 Rust mock 插件、生产前端 bootstrap、tauri-driver 或 EdgeDriver；窗口切换由测试显式控制。内嵌驱动支持 Windows、Linux、macOS，平台细节见 [WebdriverIO 内嵌 provider](https://webdriver.io/docs/desktop-testing/tauri/platform-support)。升级驱动和 WDIO 时应同时运行真实主链路，不能只依靠依赖可安装或类型检查通过。

Linux CI 额外安装 WebKitGTK、Xvfb、DBus 与 Openbox，以提供真正的窗口管理；无桌面会话时，按 [`ci.yml` 的 `desktop-e2e` job](../.github/workflows/ci.yml) 准备依赖并运行其 DBus / Xvfb / Openbox 命令，单独加 `xvfb-run` 不能提供窗口管理器。macOS 保留系统红绿灯，窗口操作通过原生 API 验证。不能用 jsdom 通过或单个平台成功代替其他平台的真实结果。

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

性能目标和回归预算按 [性能治理](./engineering-at-scale.md#性能发布与故障反馈) 在对应需求或提案中确定。原生 [启动阶段日志](./troubleshooting.md#启动慢或重复启动后卡死) 用于定位初始化、窗口创建和首帧握手；它不包含系统创建进程之前的时间，也不能替代完整可交互启动测量。用同一设备、安装包和计时口径比较前后结果。未测的平台或情形明确写“未测”，安装失败、白屏、重复长期实例或预算未通过的目标不能标为通过。

## 持续集成检查

[`ci.yml`](../.github/workflows/ci.yml) 分开执行：

- `frontend`：冻结安装、品牌资源一致性、README 截图格式与尺寸、版本 / 脚本测试、格式、lint、类型、前端测试，以及桌面前端与浏览器演示的分别构建。
- `browser-smoke`：构建浏览器产物，运行 Chromium 子路径 / 交互 / 无障碍冒烟，失败上传截图与 trace；Pages 部署另有相同门禁。
- `rust`：三端 Clippy / Rust 测试、内置 Wasm 真编译与双模块 ABI / UI 和 fixture 验证；Windows 参考平台另做模块逐字节比对、格式和生成绑定检查，失败保留必要模块与编译器证据。
- `desktop-e2e`：Windows、Ubuntu、macOS 独立构建测试应用并运行三个阶段的 E2E；失败上传截图 / 日志，Windows 成功时另存 README 截图。
- `quality-gate`：汇总全部检查，仅所有前置任务成功时通过；分支保护使用此项作为必需检查。

CI 配置覆盖的目标平台，不等于当前开发机全部实测过。发布时仍需在目标平台检查安装 / 卸载、签名、自启动、托盘和真实版本升级，尤其不能用测试构建代替正式安装包验收。
