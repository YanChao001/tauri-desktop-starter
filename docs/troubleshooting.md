# 排障手册

按现象查，每条都给出原因和可执行的解法。

环境或首次启动失败时先运行 `node scripts/doctor.mjs`，按实际工具 / 平台检测结果修复。它不需要 npm 依赖，说明见 [环境诊断](./development.md#环境诊断)。

## 先看日志

从桌面启动发布版时优先查看文件日志，默认文件为系统日志目录下的 `app.log`：

| 平台    | 路径                                              |
| ------- | ------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\com.starter.desktop\logs\app.log` |
| macOS   | `~/Library/Logs/com.starter.desktop/app.log`      |
| Linux   | `~/.local/share/com.starter.desktop/logs/app.log` |

以上是默认用户目录的示例；路径由 `identifier`（`tauri.conf.json`）和系统目录设置决定。修改标识符或 Linux 的 XDG 目录后，按 Tauri `appLogDir` 的实际解析结果查找；配置了目录覆盖时使用对应的日志目录。
默认记 `Info` 级；临时要看细节，把 `lib.rs` 里的 `.level(log::LevelFilter::Info)` 调成 `Debug`。
日志时间戳是**本地时区**，单份上限 1 MB、保留 3 份历史归档及当前日志（见 `lib.rs` 的日志配置）。

> 日志文件是 UTF-8 无 BOM。Windows PowerShell 5.1 默认按 GBK 读，中文会显示成乱码：
> 用 `Get-Content app.log -Encoding UTF8`，或者直接用 VS Code / 记事本打开。

应用能启动时，可先在「诊断」页面查看环境与脱敏日志预览，再复制报告。原始日志和诊断报告都应在反馈前人工检查，移除业务数据或未覆盖的敏感信息。

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

## 安装后仍显示旧图标

分开核对设计源、平台资源、应用 exe 和快捷方式，安装器外层图标正确不代表内部 exe 的嵌入图标已经更新：

1. 按 [品牌生成流程](./build-release.md#安装器外观) 运行 `pnpm branding:generate` 和 `pnpm branding:check`，确认 `src-tauri/icons/icon.ico` 与当前 SVG 一致。
2. 重新构建应用和安装包，检查 exe 自身的图标、版本和哈希，再对比实际安装路径。`src-tauri/build.rs` 监听 `icons/`，资源变化会重新编译应用嵌入图标；只重打安装器或只改前端 SVG 不会改变已编译的 exe。
3. 检查桌面和开始菜单快捷方式是否指向当前安装 exe，以及图标来源是否为该 exe 的索引 0。NSIS 模板已显式设置图标并刷新 Shell 图标缓存。
4. 只有确认 exe 嵌入图标已更新、快捷方式来源正确而 Explorer 仍旧显示时，再处理图标缓存或重新固定任务栏入口；不先清空全局缓存或重启 Explorer 来掩盖旧二进制。

## WebView2 缺失

**现象**：启动报错 `WebView2 runtime not found`，或窗口空白且无报错。

**处理**：安装 Evergreen Bootstrapper：

```
https://go.microsoft.com/fwlink/p/?LinkId=2124703
```

安装包的引导行为由 `bundle.windows.webviewInstallMode` 控制；免安装 exe 不会执行安装器引导。离线部署需要另行准备运行时安装方案。

## 打包时卡在下载 NSIS

**现象**：

```
Downloading https://github.com/tauri-apps/nsis-tauri-utils/releases/download/...
failed to bundle project: `CONNECT proxy failed: proxy server responded 502`
```

**原因**：Tauri 打包器需要下载 NSIS 与 `nsis_tauri_utils.dll`，公司代理或网络环境拦了 GitHub。

**处理**：先确认终端代理与 GitHub 下载地址可达，修正代理后重新 `pnpm app:build`。安装器工具缓存在 Windows 的 `%LOCALAPPDATA%\tauri` 下；需要离线缓存时，按当前构建日志确认工具版本、下载地址和解压层级，勿从旧教程复制 DLL 覆盖不同版本的缓存。

只缺 WiX 时可暂时只构建 NSIS：`pnpm app:build --bundles nsis`。NSIS 自身下载失败时，改目标不会修复该依赖；可用 `pnpm app:portable` 先验证不经过打包器的应用构建。

## cargo 报 linker not found

**现象**：

```
error: linker `link.exe` not found
```

**原因**：没装 MSVC 工具链，或 VS 装了但缺「使用 C++ 的桌面开发」工作负载。

**处理**：打开 Visual Studio Installer，勾选「使用 C++ 的桌面开发」。
确认已装：

```powershell
& "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe" `
  -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

有输出说明工具链在。若还是找不到，重开终端让 PATH 生效。

## 端口 1420 被占用

```powershell
netstat -ano | findstr :1420
Get-Process -Id <pid>
# 确认是自己的开发进程后再停止
Stop-Process -Id <pid>
```

`vite.config.ts` 里 `strictPort: true` 是故意的——Tauri 必须连固定端口。
要换端口，`vite.config.ts` 与 `tauri.conf.json` 的 `devUrl` 必须同时改。

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

旧窗口状态插件存档中的尺寸是物理像素，无法独立恢复不同 DPI 下的视觉大小。项目排除该插件的尺寸恢复，在它之后注册 `window-geometry`，按窗口在配置目录的 `window-geometry.json` 统一保存逻辑尺寸；启动、DPI 和显示器布局变化时，将窗口调整到当前显示器工作区（扣除任务栏），必要时临时降低最小尺寸。显示器布局每秒检查一次，移动和缩放事件等待 300 ms 稳定后处理。

普通拖动允许窗口局部超出屏幕，只要标题栏仍能操作；显示器变化、超大窗口或标题栏不可达时才完整移入工作区。Windows 正在拖动时暂缓修正，运行期间的最大化、全屏和最小化状态不主动改位置。临时缩小不会覆盖之前保存的逻辑尺寸。首次迁移旧窗口状态时缺少历史 DPI，只能按当前缩放换算并约束到可用区域。

排查时保留 `.window-state.json` 和 `window-geometry.json`，记录断开前后的分辨率、缩放比例、任务栏位置与显示器数量。自动化测试模拟超大且屏外的窗口；真实 RDP 断开、多屏热插拔仍应在对应设备验收。

需要主动调整时，在设置页选择常用尺寸预设，所选尺寸立即应用并记忆；超出当前工作区范围的预设不可选，也可继续通过窗口边缘拖动调节。显示尺寸使用逻辑像素，不能直接与物理像素对比。恢复默认设置会恢复已打开和已记忆窗口的默认尺寸，将启动位置策略恢复为记住上次位置，并保留当前窗口位置。

启动位置可选择记住上次位置或居中，策略保存后在下次创建窗口时生效；修改选项和重复激活都不会移动当前窗口。居中依据此前恢复的位置选择有效显示器工作区，不固定使用主屏幕；原显示器断开时选择最近的有效工作区。排查居中问题时，确认偏好已保存、窗口确实经历重新创建，并同时保留位置存档与显示器布局信息。

GTK 等窗口系统异步处理尺寸和位置请求，API 返回不代表窗口管理器已完成配置。初始布局在显示前准备，可见后依据原生配置事件和有限复核确认最终结果；排查时应记录实际尺寸、外框位置与显示状态，不能仅凭请求返回判断完成。不得在主线程阻塞等待配置，也不得持续居中覆盖后续用户移动；不支持定位或长期未确认时应结束初始修正并记录日志。

## 深色窗口四周出现白色细线

**原因**：手动清除 Win32 的 `WS_CAPTION` 会破坏 Tao 无装饰窗口的非客户区绘制，使左右及底部出现经典白色边框。这不是页面 CSS 边框，设置 DWM 边框颜色也不能消除它。

**修复**：保留 Tao 创建的原生窗口样式，让它通过 `WM_NCCALCSIZE` 配合 `decorations: false` 隐藏标题栏。不要再用 `SetWindowLongPtrW` 强制清除 `WS_CAPTION` 或 `WS_THICKFRAME`；后者还会影响缩放。旧窗口装饰状态仍按上一节从恢复列表中排除。

## 中文输入法候选框位置错乱

**现象**：输入中文时候选词浮在左上角，或跟光标位置对不上。

- 原生 WebView2 / WKWebView 一般没问题，先确认 WebView2 是最新版。
- 如果用了自绘输入框（contenteditable 模拟），改成真正的 `<input>` / `<textarea>`。
- 无边框窗口 + 自定义标题栏时，确认没有对窗口做坐标变换（`transform: scale` 之类）。

## 高分屏字体发虚

- 不要用 `transform: scale()` 做整体缩放，会让文字栅格化失真。
- `viewport` meta 保持 `width=device-width, initial-scale=1.0`，不要锁 `user-scalable=no`。
- 图片给 2x 资源。

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
$env:CARGO_TARGET_DIR = "D:/cargo-target"
pnpm app:build
# 排查结束后恢复当前终端
Remove-Item Env:CARGO_TARGET_DIR
```

自定义目标目录不在 `pnpm clean` 的固定清理范围内，需要由设置者管理；用户数据路径仍使用 Tauri 路径 API 获取。

## pnpm 锁文件冲突

先合并依赖清单，再从合并目标分支恢复锁文件作为基线，安装 / 检查后审查差异。以下是普通特性分支同步 `origin/develop` 的示例：

```bash
git restore --source=origin/develop -- pnpm-lock.yaml src-tauri/Cargo.lock
pnpm install
cargo check --manifest-path src-tauri/Cargo.toml
pnpm version:check
git diff -- pnpm-lock.yaml src-tauri/Cargo.lock
# 确认没有无关升级后再 git add，并继续 merge / rebase
```

不要删除整个 `Cargo.lock` 来处理单个冲突，否则会重新解析全部依赖。`--ours` / `--theirs` 在 rebase 中的含义容易误读，使用明确的来源分支更便于核对。

## 编译内存不足

**现象**：`link.exe` 报 out of memory，或系统卡死。

```powershell
$env:CARGO_BUILD_JOBS = "2"
pnpm app:build
Remove-Item Env:CARGO_BUILD_JOBS
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

## E2E 无法连接或窗口操作超时

使用 `pnpm test:e2e`，不要直接把正式 exe 交给驱动。测试构建必须包含 `e2e` feature、独立 `.e2e` 标识和测试 overlay；runner 等内嵌服务 `/status` 就绪后才连接动态端口。源码 / 配置改动后重新 `pnpm e2e:build`，不要继续复用旧收据。

先查看 `artifacts/e2e/` 的截图和日志。Linux 无图形会话时需要 Xvfb、DBus 和窗口管理器，macOS 使用内嵌 provider；具体环境与命令见 [真实桌面 E2E](./testing.md#真实桌面-e2e)。只管理本次测试进程和临时目录，勿用清理真实用户数据解决测试隔离问题。

## 问题升级与反馈

提 issue 时附上这些信息，能少两轮往返：

- 操作系统与版本、WebView 运行时版本（Edge 浏览器版本不一定等于应用使用的 WebView2 Runtime）
- `node -v`、`pnpm -v`、`rustc -V`
- 完整报错日志（不要截图，贴文本）
- 复现步骤，以及是否只在打包后出现
