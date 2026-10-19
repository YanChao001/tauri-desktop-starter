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
日志时间戳是**本地时区**，单份上限 1 MB、保留最近 3 份（见 `lib.rs` 的日志配置）。

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
3. 应用内右键 →「检查」看 Console。生产构建打不开 DevTools 时，在 `lib.rs` 里临时加
   `window.open_devtools()` 调试。
4. 检查 `tauri.conf.json` 的 `build.frontendDist` 是否指向 `../dist`，以及 `dist` 是否真的构建出来了。

## 双击图标没反应

**原因**：单实例插件检测到已有进程，把窗口聚焦到已有实例上了，但那个窗口可能被最小化到托盘或隐藏。

**处理**：看任务管理器是否已有进程，结束它再启动。如果是打包后首次运行就这样，检查
`lib.rs` 里 `single_instance` 的回调是否调用了 `show()`。

## WebView2 缺失（Win10 老机器）

**现象**：启动报错 `WebView2 runtime not found`，或窗口空白且无报错。

**处理**：安装 Evergreen Bootstrapper：

```
https://go.microsoft.com/fwlink/p/?LinkId=2124703
```

长期方案是在安装包里内置引导：在 `tauri.conf.json` 的 `bundle.windows.webviewInstallMode`
里配置 `downloadBootstrapper`，NSIS 安装时会自动检测并安装。

## 打包时卡在下载 NSIS

**现象**：

```
Downloading https://github.com/tauri-apps/nsis-tauri-utils/releases/download/...
failed to bundle project: `CONNECT proxy failed: proxy server responded 502`
```

**原因**：Tauri 打包器需要下载 NSIS 与 `nsis_tauri_utils.dll`，公司代理或网络环境拦了 GitHub。

**处理**：手动放到缓存目录，重跑打包。

```bash
DLL_DIR="%LOCALAPPDATA%/tauri/NSIS/Plugins/x86-unicode"
curl -L -o "$DLL_DIR/nsis_tauri_utils.dll" \
  https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll
```

MSI 需要的是 WiX，缓存在 `%LOCALAPPDATA%\tauri\WixTools*`，处理方式相同（下载后解压到对应目录）。
实在不行就先只出 NSIS：`pnpm tauri build --bundles nsis`。

## cargo 报 linker not found

**现象**：

```
error: linker `link.exe` not found
```

**原因**：没装 MSVC 工具链，或 VS 装了但缺「使用 C++ 的桌面开发」工作负载。

**处理**：打开 Visual Studio Installer，勾选「使用 C++ 的桌面开发」。
确认已装：

```bash
"C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" \
  -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

有输出说明工具链在。若还是找不到，重开终端让 PATH 生效。

## 端口 1420 被占用

```bash
netstat -ano | findstr :1420
taskkill /PID <pid> /F
```

`vite.config.ts` 里 `strictPort: true` 是故意的——Tauri 必须连固定端口。
要换端口，`vite.config.ts` 与 `tauri.conf.json` 的 `devUrl` 必须同时改。

## invoke 报 command not found

**原因**：Rust 侧函数没注册，或前端命令名拼错（大小写敏感）。

```rust
.invoke_handler(tauri::generate_handler![greet, read_config])
```

命令名就是函数名，前端 `invoke("read_config")` 必须完全一致。

## invoke 报 not allowed / permission denied

**原因**：`src-tauri/capabilities/default.json` 没放开对应权限。

错误信息里会写明需要哪个权限标识，加进去后**重启** `app:dev`（能力文件不支持热更新）。

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

## 路径含中文或空格导致构建失败

- 项目路径尽量纯英文。Rust 的 `link.exe` 对含空格路径偶发问题。
- 如果必须放在中文路径下，确认 `CARGO_TARGET_DIR` 指向一个纯英文目录：

```bash
export CARGO_TARGET_DIR=D:/cargo-target
```

- 用户数据目录不要硬编码，用 `app_data_dir()` 获取。

## pnpm 锁文件冲突

**不要手改 `pnpm-lock.yaml`**。

```bash
git checkout --theirs pnpm-lock.yaml   # 或者 --ours，先选一边
pnpm install                            # 重新生成到正确状态
```

`Cargo.lock` 同理，冲突时删掉重新 `cargo build` 生成。

## 编译内存不足

**现象**：`link.exe` 报 out of memory，或系统卡死。

```bash
export CARGO_BUILD_JOBS=2
pnpm app:build
```

长期方案：关闭杀软实时扫描 `src-tauri/target` 目录。

## 更新包下载后装不上

**原因**：签名校验失败，或 `latest.json` 里的平台标识与实际不符。

- 确认构建时设置了 `TAURI_SIGNING_PRIVATE_KEY`，且与 `tauri.conf.json` 的 `pubkey` 配对。
- 检查 `platforms` 的 key 是否为 `windows-x86_64` 这类准确标识。
- 降级安装默认被拒绝，需要在代码里显式允许。

## 还是没解决

提 issue 时附上这些信息，能少两轮往返：

- 操作系统与版本、WebView2 版本（`edge://version`）
- `node -v`、`pnpm -v`、`rustc -V`
- 完整报错日志（不要截图，贴文本）
- 复现步骤，以及是否只在打包后出现
