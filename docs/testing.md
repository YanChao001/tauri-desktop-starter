# 测试规范

本项目用 Vitest / Testing Library 检查前端，用 Node 内置测试器检查工程脚本，用 Rust 测试检查原生服务，并以真实 WebView E2E 验证跨进程主链路。

## 测试分层

| 层         | 工具                             | 关注点                                                                   |
| ---------- | -------------------------------- | ------------------------------------------------------------------------ |
| 前端纯逻辑 | Vitest                           | 设置迁移、并发同步、命令 / 快捷键、翻译和错误归一化                      |
| 组件       | Testing Library + jsdom          | 路由恢复、保存 / 重试、输入保留、键盘操作和无障碍                        |
| 工程脚本   | `node --test`                    | 版本、归档、路径边界、初始化事务 / 并发保护、诊断误判                    |
| Rust       | `cargo test`                     | 入参边界、错误码、原子存储、revision、SQLite 迁移 / 冲突、更新策略与脱敏 |
| IPC 契约   | tauri-specta 导出 + 少量调用断言 | 生成绑定未漂移、命令名 / 参数名 / DTO 一致                               |
| 真实桌面   | WebdriverIO + 内嵌 WebDriver     | 启动显示、原生 IPC、语言、窗口和进程重启后的设置                         |

按风险验证用户能感知的行为，不为覆盖率数字测试 getter、静态样式或实现细节。修复缺陷时优先增加可复现的回归。

## 前端与脚本

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm test:scripts
pnpm verify
```

测试与源码同目录，命名 `*.test.ts(x)`；jsdom 初始化和覆盖率范围见 [`vitest.config.ts`](../vitest.config.ts) 与 [`src/test/setup.ts`](../src/test/setup.ts)。普通单元测试不加载 `e2e/`。覆盖率当前不设置百分比门槛。

组件测试优先 mock `@/lib/tauri` 的业务能力，避免绑定插件内部实现。只在原生门面的少量契约测试中 mock `@tauri-apps/api/core`，确认真正的命令名、参数和结构化错误；真实 E2E 不使用这些 mock。

设置测试应覆盖旧版本迁移、未来版本拒写、首次加载期间编辑、在途保存、跨窗口旧事件、CAS 冲突、失败后重试和 StrictMode 生命周期。异步测试等待状态或持久化完成，不以固定延迟替代断言。

脚本测试在独立临时目录创建数据，清理前确认绝对路径位于本次创建的目录中。初始化测试包含全文件校验、写入失败回滚、并发修改保留、目录链接拒绝与重复运行无差异；品牌测试覆盖 BMP 通道 / 行布局、ICO / ICNS 尺寸层、重复生成一致性、插画文字留白及输出路径链接边界。不得改真实项目身份或用户数据。

## 体验与动效验收

演示验证可感知的交互结果，不把示例卡片、弹簧响应曲线或固定资料数量当作工程性能与测试统计。

- 创意展厅：选择风格只改变局部预览；应用后核对主题、强调色、皮肤、强度与圆角；撤销恢复此前外观。检查暂停、命令面板入口和各导览目的地，精简首页不推广已隐藏的演示。
- 交互场景：输入、选择与滑块真实更新预览；同页切换舞台保留编辑；演示协作者校验空值 / 格式 / 重复，角色修改和移除有结果；资料搜索、筛选、收藏、列表 / 网格与空态可用，模拟加载可取消。页面内数据不应被误写成原生持久化能力。
- 动效实验室：参数、布局、倾斜和路径控制有实际反馈，Tab / 方向键 / Home / End 与焦点行为符合控件语义；重播与暂停按场景生效。减少动效后仍能使用输入、选择及阅读结果。
- 活动策略：分别模拟应用减少动效、系统偏好变化、暂停、文档隐藏、实际画布离屏及卸载。检查观察器与监听释放；CSS 动画、命令式播放和 Motion 布局都应验证，不能只断言一个 `data-active` 标记。
- 导航与设置：分组、URL、演示 / 精简过滤和快捷入口一致；切页回到顶部且不抢焦点，同页设置搜索仍可聚焦；关于区折叠不影响其他设置，保存反馈保留。

浏览器视觉验收覆盖中英文、明暗主题、默认 / 最大侧栏宽度及 880×600 窗口，检查溢出、弹层焦点、可读性与高对比度。持续动效应在运行和暂停时分别观察实际位置或播放状态；单张截图和 jsdom 不能证明运动正确。浏览器原生能力页只能展示说明与导览，真实 IPC、系统操作和持久化仍由桌面 E2E 验证。

## Rust 测试

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

## 真实桌面 E2E

```bash
pnpm test:e2e
# 或分两步，适合复用刚生成的同一测试二进制
pnpm e2e:build
pnpm test:e2e --skip-build
```

[`e2e/build.mjs`](../e2e/build.mjs) 使用当前 Rust host、独立 `src-tauri/target/e2e/` 缓存、debug / no-bundle 构建，以及 `e2e` Cargo feature 和 [测试配置](../src-tauri/tauri.e2e.conf.json)。测试程序不会归档到正式 `installers/` / `portable/`。

[`e2e/run.mjs`](../e2e/run.mjs) 创建临时数据目录和动态端口，依次运行两次独立 WDIO / 应用进程。第一阶段通过界面与真实 IPC 验证成功 / 结构化失败、中英文、展厅换装与撤销、交互场景状态保留、动效实际播放与暂停、最大化 / 还原 / 最小化、超大屏外窗口回到工作区、诊断 JSON 高亮、SQLite CRUD / 过期版本拒绝、次窗口去重和双向设置事件，以及 SVG 皮肤与强度；退出前等待完整原生快照保存。第二阶段重新启动应用，验证语言、皮肤、强度、原生设置与已保存笔记仍在。窗口测试只改变隔离测试窗口，不修改系统分辨率；真实 RDP 和设备热插拔仍需人工验收。

隔离规则：

- 标识符使用品牌标识符的 `.e2e` 后缀，与正式单实例隔离。
- `STARTER_TEST_DATA_DIR` 只在 `e2e` feature 生效；配置、SQLite、日志和窗口存档在各平台均位于临时根目录，两阶段共享后再清理。
- Windows / Linux 的各 WebView 数据目录也在临时根内。macOS 的 WKWebView 不支持该目录选项，测试主 / 次窗口使用 incognito 非持久存储，重启断言仍验证原生设置与 SQLite；不依靠 WK 缓存保留偏好。平台限制见 [dataDirectory](https://v2.tauri.app/reference/config/#datadirectory) 与 [incognito](https://v2.tauri.app/reference/config/#incognito)。
- 测试构建禁止读写系统自启动项；正式构建不包含 WebDriver 插件。
- 测试通过 W3C execute 调用真实 Tauri IPC，没有浏览器 mock、签名跳过或任意系统目录读写。
- runner 只管理本次直接创建的应用 / WDIO 子树；超时、中断或异常都会先清理受控子树，再清理本次临时数据。失败截图、原生日志和重启后的窗口截图保留在 `artifacts/e2e/`。

`--skip-build` 只检查已有测试二进制的路径与哈希；源码或配置修改后应重新构建。测试 feature、标识符和数据路径保护不可用于正式分发构建。

runner 直接启动内嵌 WebDriver 的测试程序，等待 `/status` 就绪，再让 WDIO 通过动态 localhost 端口连接 W3C WebDriver。没有接入 tauri-service 的自动焦点 / mock 层，不需要额外 Rust mock 插件、生产前端 bootstrap、tauri-driver 或 EdgeDriver；窗口切换由测试显式控制。内嵌驱动支持 Windows、Linux、macOS，平台细节见 [WebdriverIO 内嵌 provider](https://webdriver.io/docs/desktop-testing/tauri/platform-support)。升级驱动和 WDIO 时应同时运行真实主链路，不能只依靠依赖可安装或类型检查通过。

Linux CI 额外安装 WebKitGTK、Xvfb、DBus 与 Openbox，以提供真正的窗口管理；macOS 保留系统红绿灯，窗口操作通过原生 API 验证。不能用 jsdom 通过或单个平台成功代替其他平台的真实结果。

## CI 里跑什么

[`ci.yml`](../.github/workflows/ci.yml) 分开执行：

- `frontend`：冻结安装、品牌资源一致性、版本 / 脚本测试、格式、lint、类型、前端测试和构建。
- `rust`：三端 Clippy / Rust 测试；Windows 另跑格式和生成绑定检查。
- `desktop-e2e`：Windows、Ubuntu、macOS 独立构建测试应用并运行两阶段 E2E；失败上传截图 / 日志。

CI 配置覆盖的目标平台，不等于当前开发机全部实测过。发布时仍需在目标平台检查安装 / 卸载、签名、自启动、托盘和真实版本升级，尤其不能用测试构建代替正式安装包验收。
