# 排障手册

按现象查，每条都给出原因和可执行的解法。

## 先看日志

release 构建没有控制台，日志落在系统日志目录下的 `app.log`：

| 平台    | 路径                                              |
| ------- | ------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\com.starter.desktop\logs\app.log` |
| macOS   | `~/Library/Logs/com.starter.desktop/app.log`      |
| Linux   | `~/.local/share/com.starter.desktop/logs/app.log` |

路径由 `identifier`（`tauri.conf.json`）决定，改标识符后要跟着变。
默认记 `Info` 级；临时要看细节，把 `lib.rs` 里的 `.level(log::LevelFilter::Info)` 调成 `Debug`。
日志时间戳是**本地时区**，单份上限 1 MB、保留 3 份历史归档及当前日志（见 `lib.rs` 的日志配置）。

> 日志文件是 UTF-8 无 BOM。Windows PowerShell 5.1 默认按 GBK 读，中文会显示成乱码：
> 用 `Get-Content app.log -Encoding UTF8`，或者直接用 VS Code / 记事本打开。

报问题时附上这个文件，比描述「它就是打不开」有用得多。

## 窗口不出现 / 白屏

**现象**：进程在跑，但看不到窗口；或者窗口出现了但一片白。

排查顺序：

1. 等 3 秒。窗口默认 `visible: false`，由前端首帧渲染后调用 `show()`；Rust 侧有 3 秒兜底。
   3 秒后才出现 → 前端渲染有问题，去看 DevTools。
2. `pnpm dev` 打开 `http://localhost:1420`，看浏览器里是否正常。
   浏览器正常、应用白屏 → 多半是资源路径或 CSP 问题。
3. 在开发构建打开 WebView 调试工具查看 Console。仅在 release 出现时，保留日志与复现条件，再用 debug 构建定位；不要把调试入口发布给用户。
4. 检查 `tauri.conf.json` 的 `build.frontendDist` 是否指向 `../dist`，以及 `dist` 是否真的构建出来了。

## 双击图标没反应

**可能原因**：已有实例未能恢复窗口，或新进程在初始化阶段退出。本模板没有托盘功能，重复启动的回调会还原、显示并聚焦主窗口。

**处理**：先查看任务管理器和日志，确认进程归属后关闭旧实例再试；同时检查 `single_instance` 回调和后续插件初始化错误。

## WebView2 缺失（Win10 老机器）

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

**原因**：Rust 侧函数没注册，或前端命令名拼错（大小写敏感）。

```rust
.invoke_handler(tauri::generate_handler![commands::greet, commands::read_config])
```

命令名就是函数名，前端 `invoke("read_config")` 必须完全一致。

## invoke 报 not allowed / permission denied

核心或插件命令先检查 `src-tauri/capabilities/default.json` 中的窗口绑定、权限和 scope；自定义命令还要检查是否启用了应用 ACL。按 [能力最小化](./security.md#能力最小化) 补齐必要范围，重新编译原生端验证，不要直接授予宽泛权限。

## 自定义标题栏下原生边框又出现了

**现象**：`tauri.conf.json` 里配了 `"decorations": false`，运行时窗口顶部仍然有原生标题栏，和自绘标题栏叠成两层。

- 真凶通常是 `tauri-plugin-window-state`：它的默认 `StateFlags::all()` 含 `DECORATIONS`，会把**旧版本存盘**的 `decorated: true` 在启动时 `set_decorations(true)` 恢复回来，覆盖配置。升级过版本的机器必现（新装机器不现）。
- 排查：看 `%APPDATA%\<identifier>\.window-state.json` 里有没有 `"decorated": true`。
- 修复：装饰是设计决策而非用户状态，初始化插件时剔除该 flag——
  `with_state_flags(StateFlags::all().difference(StateFlags::DECORATIONS | StateFlags::VISIBLE))`（本项目已这么配）。
- 同时剔除 `VISIBLE`，避免插件提前显示窗口，绕过前端首帧与 Rust 的 3 秒兜底。
- macOS 的 `titleBarStyle: "Overlay"` 依赖 `decorations: true`，由 `tauri.macos.conf.json` 平台配置控制，不受此影响。

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

未签名的 exe 被 360/火绒拦截很常见。处理优先级：

1. 上代码签名（最有效）。
2. 向厂商提交误报申诉，附安装包与哈希。
3. 内网分发时提供 SHA256 校验值。

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

- 确认构建时设置了 `TAURI_SIGNING_PRIVATE_KEY`，且与 `tauri.conf.json` 的 `pubkey` 配对。
- 检查 `platforms` 的 key 是否为 `windows-x86_64` 这类准确标识。
- 默认更新器只接受更高版本，Windows 安装器还有独立的降级限制；回滚策略见 [构建与发布](./build-release.md#回滚)。

## 还是没解决

提 issue 时附上这些信息，能少两轮往返：

- 操作系统与版本、WebView 运行时版本（Edge 浏览器版本不一定等于应用使用的 WebView2 Runtime）
- `node -v`、`pnpm -v`、`rustc -V`
- 完整报错日志（不要截图，贴文本）
- 复现步骤，以及是否只在打包后出现
