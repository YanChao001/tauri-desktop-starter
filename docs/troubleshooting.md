# 排障手册

按现象定位；环境或首次启动失败先运行 `node scripts/doctor.mjs`，按检测结果修复。它不需要 npm 依赖，见 [环境诊断](./development.md#环境诊断)。

## 先看日志

从桌面启动发布版时优先查看文件日志，默认文件为系统日志目录下的 `app.log`：

| 平台    | 路径                                              |
| ------- | ------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\com.starter.desktop\logs\app.log` |
| macOS   | `~/Library/Logs/com.starter.desktop/app.log`      |
| Linux   | `~/.local/share/com.starter.desktop/logs/app.log` |

以上是默认用户目录的示例；标识符来源为 `app.config.json`，同步到 `tauri.conf.json`。更换标识符、Linux XDG 设置或目录覆盖后，按 Tauri `appLogDir` 的实际结果查找。
默认记 `Info` 级；临时要看细节，把 `lib.rs` 里的 `.level(log::LevelFilter::Info)` 调成 `Debug`。
日志时间戳是**本地时区**，单份上限 1 MB、保留 3 份历史归档及当前日志（见 `lib.rs` 的日志配置）。

> 日志文件是 UTF-8 无 BOM。Windows PowerShell 5.1 默认按系统 ANSI 编码读取此类文件，中文 Windows 上通常为 GBK，可能显示乱码：
> 用 `Get-Content app.log -Encoding UTF8`，或者直接用 VS Code / 记事本打开。

应用能启动时，可在「诊断与恢复」查看环境及脱敏日志预览并复制报告。反馈前仍需人工检查，移除业务数据或遗漏的敏感信息。

## 窗口不出现 / 白屏

**现象**：进程在跑，但看不到窗口；或者窗口出现了但一片白。

排查顺序：

1. 查看 [启动阶段日志](#启动慢或重复启动后卡死)。窗口默认不自动创建，原生状态就绪后创建隐藏窗口，前端两次动画帧回调后通过 IPC 握手显示；Rust 在窗口创建成功后安排 3 秒显示兜底。
   兜底不包含此前的原生初始化或 WebView 创建耗时，也不能解除事件循环死锁。不能以“双击后三秒应出现”或窗口已经可见来判断启动是否正常。
2. `pnpm dev` 打开 `http://localhost:1420`，看浏览器里是否正常。
   浏览器正常只能排除部分界面问题；应用还需检查资源路径、CSP、原生 IPC、WebView 创建与窗口事件循环。
3. 在开发构建打开 WebView 调试工具查看 Console。仅在 release 出现时，保留日志与复现条件，再用 debug 构建定位；不要把调试入口发布给用户。
4. 检查 `tauri.conf.json` 的 `build.frontendDist` 是否指向 `../dist`，以及 `dist` 是否真的构建出来了。

## 双击图标没反应

**可能原因**：已有实例隐藏到托盘、未能恢复窗口，或新进程在初始化阶段退出。启用后台运行且托盘可用时，关窗会隐藏；托盘「显示窗口」和重复启动都会恢复主窗口，托盘 / 菜单「退出」明确结束应用。

**处理**：先检查托盘和诊断 / 日志；确认后台运行偏好、托盘可用状态、`single_instance` 回调与插件初始化错误。已有次窗口时恢复主窗口也会复用或重建正确标签的窗口。

## 启动慢或重复启动后卡死

先核对正在运行 exe 的路径和版本，避免桌面旧快捷方式、旧便携版和新安装版混用。保存日志、PID 与现场窗口状态，再退出该应用；托盘退出无响应时，只结束已经确认路径属于本应用的主进程。不要按所有 WebView2 进程批量结束，也不要删设置或数据库来尝试解除死锁。

本地日志按启动阶段记录 `Startup phase=... elapsed_ms=...`，耗时从 Rust 桌面状态创建起算，不包含桌面双击到系统创建进程的时间：

| 阶段                     | 含义与排查方向                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `native-state-ready`     | 插件初始化及设置、数据库等共享状态已准备好；此前慢时检查运行环境、插件与本地存储初始化 |
| `window-create-start`    | 开始构建主窗口；到下一阶段之间关注 WebView 运行时、窗口创建及插件就绪回调              |
| `window-created`         | 主窗口创建完成；之后关注前端资源、渲染与首帧握手                                       |
| `frontend-ready`         | 前端发出首帧握手，Rust 随后尝试显示窗口；不代表所有懒加载页面和业务数据均已完成        |
| `window-reveal-fallback` | 窗口创建后的显示兜底触发，应继续检查为何没有正常握手，不能当成性能达标                 |

重复启动在 Windows 上通过同步单实例消息通知已有进程；事件循环卡住时，后续进程可能等待约十秒超时。因此持续点击会放大现场进程数，十秒等待不一定是每次都重新加载前端。当前实现让唤醒回调立即返回、合并请求并后台创建窗口，初始化期间不提前显示空白 WebView。

扩展窗口插件时，不在持有插件锁的窗口就绪回调里同步设置尺寸或位置；Win32 事件重入会再次访问插件锁并可能死锁。几何修正等待回调返回后调度，普通几何存档也不应同步阻塞 UI 线程。检查实际阶段日志与复现条件，再按 [安装版与启动验收](./testing.md#安装版与启动验收) 验证修复；单元测试或浏览器预览通过不能代替正式安装版的连续激活测试。

## 启动时反复打印 libpng / iCCP 警告

```text
libpng warning: iCCP: known incorrect sRGB profile
```

PNG 解码器发现异常 ICC 色彩配置时会输出此警告，见 [libpng 校验](https://github.com/pnggroup/libpng/blob/v1.6.43/png.c#L2179-L2187)。它不是 Rust 编译告警；重复输出不代表同等数量的业务错误。先对照启动阶段：若随后已有 `window-created` 和 `frontend-ready`，应继续排查后续异常，不能仅凭警告判断启动失败。

1. 检查项目 PNG 与 ICO 内嵌 PNG 的 `iCCP` 块；品牌资源有问题时从 SVG 按 [品牌流程](./build-release.md#安装器外观) 重建。
2. 项目资源正常时，对比创建窗口时加载的环境组件。Windows 输入法组件可载入应用进程，见 [Microsoft 文本服务说明](https://learn.microsoft.com/en-us/windows/win32/tsf/64-bit-platform-considerations)。可先用 `Win + Space` 切换微软拼音或英文键盘，再重新启动；第三方输入法仅切为英文模式未必卸载其图形库。
3. 必要时只读检查已加载 DLL 或调用栈。DLL 中含告警文本只能证明有打印能力，仍需启动对比确认来源。若来源是输入法资源，向其官方渠道反馈；修改项目图片库不能修复 DLL 自带资源。

libpng 默认写标准错误，调整 Rust 日志级别无法过滤，见 [上游警告处理](https://github.com/pnggroup/libpng/blob/v1.6.43/pngerror.c#L721-L767)。保留现场，不修改输入法安装文件、不禁用 IME、不清空应用数据或丢弃全部标准错误。

`ELIFECYCLE ... exit code -1` 应独立排查：记录是关闭 / Ctrl+C 后退出还是应用自行退出；后者保留同一时间的日志、panic / WebView 错误和 Windows 应用事件。首帧握手不代表后续功能都正常。

## 扩展页出现 Unsupported workspace route

工作区恢复只记录主 / 次窗口的静态页面。扩展会话路径由安装记录动态生成，不能当成静态页面写入恢复存档。前端持久化必须过滤这些路径，原生端继续校验窗口标签和路由白名单；不能通过放宽 Rust 校验来接受任意 URL。扩展会话的保留与导出见 [扩展指南](./extensions.md#开发带界面的应用插件)。

## 扩展提示包、API 或存档版本不兼容

先正常退出旧运行进程并重新构建启动。内置 Wasm 已更新不代表已安装注册表也符合当前协议；扩展中心会只读识别存档类型。对已知旧开发版使用确认后的归档入口，未来或损坏数据保留原件；具体边界与失败恢复统一见 [旧开发版告警与恢复](./extensions.md#旧开发版告警与恢复)。不要删除整个应用数据目录来消除告警。

## 安装后仍显示旧图标

分开核对设计源、平台资源、应用 exe 和快捷方式，安装器外层图标正确不代表内部 exe 的嵌入图标已经更新：

1. 按 [品牌生成流程](./build-release.md#安装器外观) 运行 `pnpm branding:generate` 和 `pnpm branding:check`，确认 `src-tauri/icons/icon.ico` 与当前 SVG 一致。
2. 重新构建应用和安装包，检查 exe 自身的图标、版本和哈希，再对比实际安装路径。`src-tauri/build.rs` 监听 `icons/`，资源变化会重新编译应用嵌入图标；只重打安装器或只改前端 SVG 不会改变已编译的 exe。
3. 检查桌面和开始菜单快捷方式是否指向当前安装 exe，以及图标来源是否为该 exe 的索引 0。NSIS 模板已显式设置图标并刷新 Shell 图标缓存。
4. 只有确认 exe 嵌入图标已更新、快捷方式来源正确而 Explorer 仍旧显示时，再处理图标缓存或重新固定任务栏入口；不先清空全局缓存或重启 Explorer 来掩盖旧二进制。

## MSI 没有弹出管理员权限确认

当前 MSI 为所有用户安装（`ALLUSERS=1`），由 Windows Installer 在执行安装时处理提权；显示欢迎页不要求立即弹出 UAC。NSIS 则按当前用户安装，无需管理员权限。

若 MSI 全程没有提示，先核对启动进程是否已提权、是否由企业策略部署，再只读检查系统策略：

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' |
  Select-Object EnableLUA, ConsentPromptBehaviorAdmin, PromptOnSecureDesktop
```

`EnableLUA=1` 且 `ConsentPromptBehaviorAdmin=0` 表示管理员提权不提示，不能据此判断安装器没有申请权限。需要恢复提示时，通过 Windows UAC 设置或组织策略调整，应用与构建脚本不修改全局安全策略。取值见 [Microsoft UAC 配置](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/settings-and-configuration#user-account-control-configuration)。

双击 MSI 后先短暂显示准备窗口、消失再进入欢迎页，来自 WiX 的 `PrepareDlg`。本项目通过 [安装器 UI 片段](../src-tauri/installer/wix-ui.wxs) 跳过其显示；重新打包后检查最终 MSI 的 `InstallUISequence` 中该行条件为 `0`。应用启动窗口闪现需另按 [启动排查](#启动慢或重复启动后卡死) 定位。

## WebView2 缺失

**现象**：启动报错 `WebView2 runtime not found`，或窗口空白且无报错。

**处理**：从 [Microsoft WebView2 Runtime 下载页](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 选择 Evergreen Bootstrapper 安装；离线机器使用匹配架构的 Evergreen Standalone Installer。

安装包的引导行为由 `bundle.windows.webviewInstallMode` 控制；免安装 exe 不会执行安装器引导。离线部署需要另行准备运行时安装方案。

## Rust 构建长时间停在 802/805

Cargo 的 `802/805` 是构建任务数量，不是按耗时计算的百分比。最后的应用编译、代码生成与链接可能比前面多数依赖更慢，具体数字也会随依赖和构建选项变化。先观察当前构建所属 `rustc` / 链接器进程的累计 CPU 时间、磁盘活动和完整日志，区分仍在计算、等待资源与实际报错；多核机器上只占用一个核心时，总 CPU 使用率也可能较低。

`pnpm app:build` 与 `pnpm app:portable` 默认使用原有体积策略，完整 LTO 与单代码生成单元会增加最后阶段的编译耗时。需要优先编译速度时显式传入 `--optimize speed`；策略影响与缓存复用见[编译策略](./build-release.md#编译策略)。首次使用新策略需要重编依赖，不要通过清空 Cargo 缓存处理正常的编译等待。

应用会把前端 `dist/` 嵌入 Rust 二进制。重新构建前端后，即使未修改 Rust 源码，也可能再次触发应用 crate 编译；这不表示所有依赖都被重编。日常交互开发使用 `pnpm app:dev`，需要交付安装包或便携版时再构建。

## 打包时卡在下载 NSIS

**现象**：

```text
Downloading https://github.com/tauri-apps/nsis-tauri-utils/releases/download/...
failed to bundle project: `CONNECT proxy failed: proxy server responded 502`
```

**原因**：Tauri 打包器需要下载 NSIS 与 `nsis_tauri_utils.dll`，公司代理或网络环境拦了 GitHub。

**处理**：先确认终端代理与 GitHub 下载地址可达，修正代理后重新 `pnpm app:build`。安装器工具缓存在 Windows 的 `%LOCALAPPDATA%\tauri` 下；需要离线缓存时，按当前构建日志确认工具版本、下载地址和解压层级，勿从旧教程复制 DLL 覆盖不同版本的缓存。

只缺 WiX 时可暂时只构建 NSIS：`pnpm app:build --bundles nsis`。NSIS 自身下载失败时，改目标不会修复该依赖；可用 `pnpm app:portable` 先验证不经过打包器的应用构建。

## Linux CI 安装依赖耗时过长

先区分 `apt-get update`、包下载和解包耗时。日志若在 `azure.archive.ubuntu.com` 出现大量 `Ign`，随后切到 `archive.ubuntu.com` 才迅速下载，说明时间消耗在首选镜像等待和重试，而非应用编译。每个 GitHub 托管 job 使用新虚拟机，pnpm / Rust 缓存不包含这些系统包。

[CI](../.github/workflows/ci.yml) 与 [发布工作流](../.github/workflows/release.yml) 使用官方 HTTPS 镜像，并限制连接 / 数据等待、重试及安装步骤总时长。Rust 检查使用 Ubuntu 24.04，桌面 E2E 与 Linux 分发保留 22.04；调整 runner 后复核源配置，按具体下载错误处理，保留签名校验。

## cargo 报 linker not found

**现象**：

```text
error: linker `link.exe` not found
```

**原因**：没装 MSVC 工具链，或 VS 装了但缺「使用 C++ 的桌面开发」工作负载。

**处理**：打开 Visual Studio Installer，勾选「使用 C++ 的桌面开发」。
确认已装：

```powershell
& "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe" `
  -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

有输出仅说明相应 C++ 组件已安装，不等于当前构建已能调用链接器。重新打开终端后运行 `node scripts/doctor.mjs`，核对 Windows SDK 与工具链；仍失败时保留完整构建错误，按 [Windows 前置条件](https://v2.tauri.app/start/prerequisites/#windows) 核对 Rust 的 MSVC host 与目标架构，不通过切换未锁定的 Rust 版本掩盖问题。

## 端口 1420 被占用

Vite 开启 `strictPort`，不会自动改端口。先确认占用进程归属，只停止自己的任务；查占用命令及需要同步修改的配置见 [开发指南](./development.md#端口被占用)。

## invoke 报 command not found

**原因**：Rust 侧函数未在 `bindings.rs` 注册、旧二进制仍在运行，或生成绑定未同步。

在 `bindings.rs` 的 `collect_commands!` 中注册实际存在的命令，再运行 `pnpm bindings:generate`。通过 `lib/tauri.ts` 调用生成的命令，并重新编译 / 启动原生程序；`pnpm bindings:check` 验证已提交文件未漂移。不要在页面新增字符串命令规避门面。

## invoke 报 not allowed / permission denied

核心或插件命令先检查 `src-tauri/capabilities/default.json` 中的窗口绑定、权限和 scope；自定义命令还要检查是否启用了应用 ACL。按 [能力最小化](./security.md#能力最小化) 补齐必要范围，重新编译原生端验证，不要直接授予宽泛权限。

## 自定义标题栏下原生边框又出现了

**现象**：`tauri.conf.json` 里配了 `"decorations": false`，运行时窗口顶部仍然有原生标题栏，和自绘标题栏叠成两层。

- 检查 `tauri-plugin-window-state`：其默认 `StateFlags::all()` 含 `DECORATIONS`，可能把旧存档的 `decorated: true` 恢复回来，覆盖配置；是否复现取决于存档与插件初始化方式。
- 排查：看 `%APPDATA%\<identifier>\.window-state.json` 里有没有 `"decorated": true`。
- 修复：装饰是设计决策而非用户状态，初始化插件时剔除该 flag——
  `with_state_flags(StateFlags::all().difference(StateFlags::SIZE | StateFlags::DECORATIONS | StateFlags::VISIBLE))`（本项目已配置）。
- 同时剔除 `VISIBLE`，避免插件提前显示窗口，绕过前端首帧与 Rust 的 3 秒兜底。
- macOS 的 `titleBarStyle: "Overlay"` 依赖 `decorations: true`，由 `tauri.macos.conf.json` 平台配置控制，不受此影响。

## 远程桌面断开后窗口过大或落在屏幕外

旧窗口状态插件保存物理像素，无法独立恢复跨 DPI 的视觉大小。项目由 `window-geometry` 在配置目录的 `window-geometry.json` 保存逻辑尺寸；启动、DPI 或显示器布局变化时按可用工作区约束，必要时临时降低最小尺寸，保留原首选尺寸。首次迁移缺少历史 DPI，只能按当前缩放换算。

普通拖动允许局部超出屏幕，只要标题栏可操作；显示器变化、窗口过大或标题栏不可达时才完整移入工作区。Windows 拖动期间暂缓修正，运行中的最大化、全屏和最小化窗口不主动改位置。

先在设置页选择可用的逻辑尺寸预设，或拖动窗口边缘。启动位置的「记住上次位置 / 居中」只在下次创建窗口时生效，切换偏好与重复激活不移动当前窗口；居中使用有效显示器工作区，原显示器不可用时选择最近的工作区。恢复默认设置重置已打开与已记忆窗口的尺寸及启动位置策略，并保留当前位置。

排查时保留 `.window-state.json` 和 `window-geometry.json`，记录前后分辨率、缩放、任务栏位置和显示器数量；居中问题还需确认偏好保存成功且窗口确实重新创建。自动化只模拟超大 / 屏外窗口，真实 RDP 断开与多屏热插拔仍需对应设备验收。

GTK / macOS 可能异步应用尺寸与位置，API 返回后的暂态坐标不能覆盖恢复目标。检查日志中的目标、实际客户端 / 外框尺寸与显示状态；初始修正采用原生事件和有限复核，不在主线程阻塞等待，也不持续定位覆盖后续用户移动。

## 深色窗口四周出现白色细线

**原因**：手动清除 Win32 的 `WS_CAPTION` 会破坏 Tao 无装饰窗口的非客户区绘制，使左右及底部出现经典白色边框。这不是页面 CSS 边框，设置 DWM 边框颜色也不能消除它。

**修复**：保留 Tao 创建的原生窗口样式，让它通过 `WM_NCCALCSIZE` 配合 `decorations: false` 隐藏标题栏。不要再用 `SetWindowLongPtrW` 强制清除 `WS_CAPTION` 或 `WS_THICKFRAME`；后者还会影响缩放。旧窗口装饰状态仍按上一节从恢复列表中排除。

## 中文输入法候选框位置错乱

**现象**：输入中文时候选词浮在左上角，或跟光标位置对不上。

- 记录系统、输入法与实际 WebView 运行时版本，先比较原生 `<input>` / `<textarea>` 与富文本输入，缩小到具体控件。
- 检查输入控件及其祖先的缩放 / 坐标变换，避免用 `transform: scale()` 缩放整页。
- 仅特定运行时或输入法复现时，保留最小复现与版本信息，检查其官方更新；不以禁用中文输入处理候选框问题。

## 高分屏字体发虚

- 不要用 `transform: scale()` 做整体缩放，会让文字栅格化失真。
- `viewport` meta 保持 `width=device-width, initial-scale=1.0`，不要锁 `user-scalable=no`。
- 位图按目标缩放率准备足够分辨率；图标优先使用已有 SVG 资源。

## 杀毒软件误报

先核对被拦文件与构建产物是否一致，再按厂商流程检查和申诉；不要仅凭程序来自本项目就认定是误报。

1. 核对构建来源、依赖与 SHA-256，检查是否包含意外变更。
2. 确认为误报后向厂商申诉，附安装包与哈希。
3. 按分发渠道配置代码签名，并提供校验值；签名不能保证消除拦截。

## Windows 归档目录出现 EPERM

**现象**：应用已经编译或安装包已经生成，但替换 `artifacts/.../installers` 或 `portable` 时报告 `EPERM`、`EACCES` 或 `EBUSY`。

Windows 的目录或子项句柄可能阻止同级目录重命名。脚本会对这三类错误短暂重试；仍失败时保留旧分发结果，并输出原错误码。

1. 检查正在运行的便携程序、安装器、文件预览和位于分发子目录的终端，关闭确认占用的窗口后重试构建。
2. 保留 `vite.config.ts` 的 `server.watch.ignored` 和 VS Code 的 `files.watcherExclude`，将 `artifacts/`、`dist/` 与 Rust 编译目录排除在生成文件监听之外；自定义工具的监听也采用同样范围。
3. 若仍无法定位，使用 Windows 资源监视器的「关联的句柄」搜索报错目录，确认占用来源。此问题无需清空 Cargo 编译缓存。

## 路径相关的构建失败

先保留完整错误并检查具体工具的路径引用，中文或空格本身不能证明是 Rust 链接器问题。可把编译产物暂存到较短路径，比较是否与路径长度或缓存有关：

```powershell
$previousCargoTargetDir = $env:CARGO_TARGET_DIR
try {
    $env:CARGO_TARGET_DIR = "D:/cargo-target"
    pnpm app:build
} finally {
    $env:CARGO_TARGET_DIR = $previousCargoTargetDir
}
```

自定义目标目录不在 `pnpm clean` 的固定清理范围内，需要由设置者管理；用户数据路径仍使用 Tauri 路径 API 获取。

## pnpm 锁文件冲突

先合并依赖清单，再从合并目标分支恢复锁文件作为基线，安装 / 检查后审查差异。以下是普通特性分支同步 `origin/develop` 的示例：

```bash
git restore --source=origin/develop -- pnpm-lock.yaml src-tauri/Cargo.lock
pnpm install
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm version:check
git diff -- pnpm-lock.yaml src-tauri/Cargo.lock
# 确认没有无关升级后再 git add，并继续 merge / rebase
```

`pnpm build` 先准备原生编译所需的 `dist/`。不要删除整个 `Cargo.lock` 来处理单个冲突，否则会重新解析全部依赖。`--ours` / `--theirs` 在 rebase 中的含义容易误读，使用明确的来源分支更便于核对。

## 编译内存不足

**现象**：`link.exe` 报 out of memory，或系统卡死。

```powershell
$previousCargoBuildJobs = $env:CARGO_BUILD_JOBS
try {
    $env:CARGO_BUILD_JOBS = "2"
    pnpm app:build
} finally {
    $env:CARGO_BUILD_JOBS = $previousCargoBuildJobs
}
```

仍失败时检查可用内存、交换文件、并行构建进程和链接器报错；不应通过关闭安全软件来处理内存不足。

## 更新包下载后装不上

**原因**：签名校验失败，或 `latest.json` 里的平台标识与实际不符。

- 确认构建时设置了 `TAURI_SIGNING_PRIVATE_KEY`，且与 `app.config.json` 或部署覆盖 `deployment.json` 中的 `updates.publicKey` 配对。
- 检查 `platforms` 的 key 是否为 `windows-x86_64` 这类准确标识。
- 不支持旧版兼容 ZIP 更新；发布流程使用 v2 原生包，签名后不得再修改安装包。元数据版本必须与签名覆盖的版本一致。
- 默认更新器只接受更高版本，Windows 安装器还有独立的降级限制；回滚策略见 [构建与发布](./build-release.md#回滚)。

## 设置保存失败或版本不兼容

「保存失败」保留未提交输入，先用界面的重试；多窗口冲突会读取新 revision 并合并本地字段，持续冲突时保留现场，不直接删除整个数据目录。配置目录中的 `settings.json` 可能有损坏备份，先保留备份再排查权限、磁盘和原子替换失败。

检测到未来设置 schema 时禁止旧版本写回，优先换回能够读取该存档的新版本；明确执行「重置偏好」才允许恢复默认。重置保留语言，不删除笔记或修改系统自启动。迁移与数据范围见 [架构说明](./architecture.md#状态管理与设置迁移)。

## SQLite 保存冲突或数据库打不开

笔记更新使用 `expectedVersion`；其他窗口已保存时会拒绝旧版本，刷新后核对内容再保存。数据库位于应用数据目录的 `starter.sqlite3`，不要通过删除数据库处理普通编辑冲突。

未来 `PRAGMA user_version` 会被旧程序拒绝，不能强行调低版本号；保留数据库、使用对应新版本并检查日志。迁移、事务与原生错误码均由 Rust 服务负责，页面不会获得通用 SQL 或文件访问权限。

正常笔记页可创建完整逻辑备份并预览 / 恢复。「诊断与恢复」集中显示诊断报告与恢复状态；旧 `/recovery` 路径仍兼容。启动故障进入隔离恢复时，当前数据库和设置是临时工作区，不代表原始数据被清空；保留原件和恢复日志，先选备份、核对数量与样本，再明确安排下次启动替换。恢复失败检查磁盘空间、目录权限、备份格式 / 16MiB 上限和未来版本保护，不删除原数据库、WAL / SHM 或 `recovery-*` 归档来强制启动。流程见 [恢复说明](./architecture.md#恢复诊断与更新)。

## 文件无法保存或后台任务没有完成

Windows 深层缓存目录中的小附件也可能因旧构建的长路径原子替换失败而收不到保存回执，尤其是内网通信的本机回环助手。当前宿主在创建临时文件前规范化父目录，使临时文件和目标都使用支持长路径的地址；更新时需重新构建并重启原生宿主，保留原历史与附件，无需修改系统长路径策略。附件额度和其他失败类型见 [局域网通信](./extensions.md#局域网通信)。

工作台仅打开已由原生选择、关联或拖入授权的文件。旧最近记录失效、目录被移动或变成链接时重新选择；文本须为 UTF-8 且不超过 2MiB，图片只读且不超过 8MiB。JSON 或配置的应用专属扩展名文档不合法时先修正文档。外部冲突时草稿仍保留，查看磁盘版本或另存副本，不用重复覆盖来处理冲突；取消另存不会清除草稿。

任务最多两项执行、十项排队；等待中的任务可取消，执行取消需等待 worker 到达检查点，不能立即释放执行位置。离页 / 隐藏窗口不停止任务；重启后 `interrupted` 需显式重试。部分文件不可读、扫描达到上限或文件变化时查看结果和导出报告，不能将局部完成当成完整目录清单。退出选择等待时仍有长任务，可以取消退出后回任务页查看。

## 系统能力或外部演示不可用

浏览器不具备系统通知、原生凭据、全局快捷键或文件服务。桌面通知先由用户授权，后台任务不会反复请求权限；快捷键冲突时换用界面列出的其他组合并释放旧组合。系统凭据依赖当前用户的凭据服务，测试构建有意禁用，不用明文 JSON 临时替代。深链 / 文件关联需要安装版登记；先核对 `app.config.json` 的 `integration`，再按 [初始化流程](./development.md#项目初始化) 同步安装关联并重新构建。Rust 解析和系统页示例读取该配置，开发运行不能证明安装关联可用。

HTTPS / WSS 示例依赖指定外部服务，可能受网络或服务状态影响；先切本地 fixture 验证取消、超时、重试和离线，不通过放宽 CSP、scope 或 TLS 来绕过失败。本地会话不会登录远程账户。定位与裁剪入口见 [模块指南](./demo-modules.md)。

## E2E 无法连接或窗口操作超时

日常界面回归使用 `pnpm test:ui`，不显示测试窗口。真实桌面验收需显式运行 `pnpm test:e2e --interactive`；它会激活和切换窗口，应安排在独立 CI / 虚拟机或可占用桌面的时段，见 [桌面干扰边界](./testing.md#避免干扰本机桌面)。不要直接把正式 exe 交给驱动。测试构建必须包含 `e2e` feature、独立 `.e2e` 标识和测试 overlay；runner 等内嵌服务 `/status` 就绪后才连接动态端口。源码 / 配置改动后重新 `pnpm e2e:build`，不要继续复用旧收据。

先查看 `artifacts/e2e/` 的截图和日志。Linux 无图形会话时需要 Xvfb、DBus 和窗口管理器，macOS 使用内嵌 provider；具体环境与命令见 [真实桌面 E2E](./testing.md#真实桌面-e2e)。只管理本次测试进程和临时目录，勿用清理真实用户数据解决测试隔离问题。

## 问题升级与反馈

提 issue 时附上这些信息，能少两轮往返：

- 操作系统与版本、WebView 运行时版本（Edge 浏览器版本不一定等于应用使用的 WebView2 Runtime）
- `node -v`、`pnpm -v`、`rustc -V`
- 完整报错日志（不要截图，贴文本）
- 复现步骤，以及是否只在打包后出现
