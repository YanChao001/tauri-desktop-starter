# 构建与发布

本文说明本地分发目录、平台签名、更新信任链和正式发布步骤。命令从仓库根目录执行；发布工作流以 [release.yml](../.github/workflows/release.yml) 为准。

## 版本号：四个地方必须一致

桌面应用的版本号散落在四个文件里，任何一个不同步都会出问题：

| 文件                        | 字段                | 影响             |
| --------------------------- | ------------------- | ---------------- |
| `package.json`              | `version`           | 前端与 CI        |
| `src-tauri/tauri.conf.json` | `version`           | 安装包、更新检查 |
| `src-tauri/Cargo.toml`      | `[package] version` | 二进制元信息     |
| `src-tauri/Cargo.lock`      | 自身 package 条目   | 可复现构建       |

用脚本一次改完，不要手改：

```bash
pnpm version:set 1.2.0
```

脚本先读取并校验所有版本文件，用项目锁定的 Prettier 与仓库配置格式化 JSON，再通过共享文件事务暂存、检测并发修改并替换四处内容；失败时回滚本轮写入，遇到并发编辑则保留用户内容与原备份并报告冲突。Cargo 包名与 npm 包名不同也会正确定位自身锁文件条目。`pnpm version:check` 检查四处版本一致，CI 和发布流程都会执行。

当前包含 MSI，版本须满足 major ≤ 255、minor ≤ 255、patch ≤ 65535。预发布标识或构建元数据若用于 MSI 第四段，必须为 ≤ 65535 的整数；使用 `beta.1` 等文本时，需要显式配置 `bundle.windows.wix.version` 或仅构建 NSIS。非法版本在写入前就会被拒绝。

版本校验依据项目配置执行；若选择仅构建 NSIS 来使用文本预发布，需先在配置中移除 MSI 目标，仅传 `--bundles nsis` 不会改变版本校验依据。

自动更新通过版本号判断新旧，安装器也可能限制降级。已经发布的版本号不要复用；回滚方式见 [回滚](#回滚)。

## 构建

```bash
pnpm app:build
```

脚本完成 Tauri 构建后，将本次安装包收集到 `artifacts/<version>/<target-triple>/installers/`。完整分发目录与源码 / 中间产物的区别见 [README · 构建产物](../README.md#构建产物)。

| 平台    | 产物                               | 说明                               |
| ------- | ---------------------------------- | ---------------------------------- |
| Windows | `nsis/*.exe`                       | 当前配置按用户安装，无需管理员权限 |
| Windows | `msi/*.msi`                        | 适合企业分发                       |
| macOS   | `dmg/*.dmg`、`macos/*.app`         |                                    |
| Linux   | `deb/*.deb`、`appimage/*.AppImage` |                                    |
| Linux   | `rpm/*.rpm`                        | RPM 系发行版分发                   |

当前配置 `bundle.targets: "all"`，Linux 同时包含 DEB、RPM 与 AppImage；默认格式依据当前锁定 [Tauri CLI 的平台目标定义](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.3/crates/tauri-bundler/src/bundle/settings.rs#L1068-L1096)，升级 CLI 后复核。

只出某一个格式：

```bash
pnpm app:build --bundles nsis
```

Vite 的 `dist/` 与 Cargo 默认 `src-tauri/target/` 是编译中间产物与缓存；直接运行 `pnpm tauri build` 保留 Tauri 原始输出，不执行项目脚本的分发收集。需要交付时使用 `pnpm app:build` 或 `pnpm app:portable`，只清理交付目录使用 `pnpm clean:artifacts`。

浏览器在线演示使用同一份 React 源码，单独构建到 `dist-web/` 并由 GitHub Pages 托管；构建、预览和部署见 [开发指南](./development.md#浏览器演示构建与部署)。原生能力与桌面安装包仍按本文的目标平台流程验证和发布。

分发目录按项目版本与 Rust target triple 隔离；每次只更新当前版本 / target 下对应的 `installers/` 或 `portable/`，保留其他版本、target 和另一类产物。自定义 Cargo 编译目录不会改变 `artifacts/` 的统一位置。

`app:build` 默认构建 release，先通过 `tauri build --no-bundle` 编译并从 Cargo 结构化输出确定真实产物，再打包并归档。它沿用 Cargo 默认缓存，不为默认构建强制增加 host target 子目录。打包阶段隔离旧 bundle，成功后归档本次输出；失败时恢复旧 bundle，避免把旧安装包误作本次结果。

分发切换使用同级目录重命名；Windows 短暂占用时最多等待 1.3 秒重试，每次重新校验路径。Vite 和 VS Code 均排除生成目录的文件监听，支持开发预览运行时归档；自定义监听配置须保留这一约定。持续占用的处理见 [Windows 归档目录出现 EPERM](./troubleshooting.md#windows-归档目录出现-eperm)。

常用参数：

| 参数                                                           | 用途                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `--target` / `-t`                                              | 指定 Rust 编译目标，分发目录使用对应 target triple         |
| `--bundles` / `-b`                                             | 指定安装包格式，支持列表或逗号分隔                         |
| `--config` / `-c`                                              | 合并 JSON 配置文件或 JSON 字符串；合并后版本必须与项目一致 |
| `--features` / `-f`                                            | 指定 Cargo features                                        |
| `--ci`、`--no-sign`、`--skip-stapling`、`--no-binary-patching` | 透传对应构建 / 打包选项                                    |
| `--verbose` / `-v`                                             | 增加工具日志                                               |
| `--no-bundle`                                                  | 只编译应用，不生成本轮分发归档                             |

`--debug`、自定义 runner、裸 Cargo 参数与 macOS universal target 不在封装范围内；需要这些高级能力时直接使用 `pnpm tauri`，并自行管理其输出。若只构建 NSIS，当前 `installers/` 会整体替换，旧 MSI 不会混入这次交付。

`installers/` 与 `portable/` 各有 `manifest.json`，包含版本、target、类别、收集时间和普通文件 SHA-256；`.app` 等目录包记录目录类型，校验分发完整性时使用 `.dmg` 或归档文件的哈希。安装器子目录保留原格式布局，便携目录包含 exe、`使用说明.txt` 与清单。清单不会改变程序的数据目录或系统签名状态。

### 便携版（免安装）

Windows 没有 portable 打包目标。脚本编译应用 exe，再收集到 `artifacts/<version>/<target-triple>/portable/`：

```bash
pnpm app:portable              # 构建 + 收集
pnpm app:portable --skip-build # 复用已有构建；确认源码与版本后使用
```

默认构建沿用 Cargo 编译目录与缓存，支持 `CARGO_TARGET_DIR` 和 Cargo `target-dir`。

便携脚本支持共享的 release 参数，如 `--target` / `-t`、`--config` / `-c`、`--features` / `-f`、`--ci`、`--no-sign` 与 verbose；不接受 `--bundles`。配置合并后版本必须与项目一致，Windows 便携版的编译目标也必须是 Windows。

`--skip-build` 必须通过先前便携构建记录的版本、配置、构建参数与 exe SHA-256 校验；缺少记录或 exe 已被其他打包步骤改写时，需要重新运行不带 `--skip-build` 的便携构建。收据不判断源码是否修改，使用者仍需确认现有 exe 对应准备交付的源码。

产物包含 exe、`使用说明.txt` 与 `manifest.json`，压缩后即可分发。适用前提与限制：

- 目标机器需要 WebView2 运行时；缺失时按便携目录内说明安装。
- 窗口位置、日志仍写入当前用户的 AppData，不随 exe 移动；要做"绿色版"需自行改路径。
- 设置与 SQLite 同样按用户存储；关闭窗口或更新前先保存笔记草稿，便携目录不包含未保存内容。
- 当前 Windows 默认更新入口指向 NSIS。便携版内安装更新会启动安装器并转为安装版，不会原地替换便携 exe；要保留免安装形态，请手动下载新版本 portable。
- 未签名的 exe 可能触发 SmartScreen，对外分发应按下文配置代码签名；签名也不保证立即获得信誉。
- `--no-bundle` 不经过打包器，**不会**自动签名；需要签名的便携版请对 exe 单独执行 `signtool`。
- Linux 的 AppImage 本身就是便携格式；macOS 用 `.app` 拖拽安装，无需另做便携包。

手动签名应针对 `portable/` 中最终交付的 exe；签名改变文件字节，随后必须更新 `manifest.json` 中对应文件的 SHA-256，再验证签名与清单。不要把签名前的哈希随签名文件交付；重新运行便携收集会整体替换该目录。

### 安装器外观

应用图标、标题栏图标、网页 favicon 与安装器插画统一由 [`resources/branding/`](../resources/branding/) 的 SVG 源维护。修改 SVG 后执行：

```bash
pnpm branding:generate  # 生成全部平台图标和安装器图片
pnpm branding:check     # 只检查是否与源文件一致，不改正式输出
```

`app-icon.svg` 是共用标志，前端和 favicon 直接使用它；四份 `installer-*.svg` 引用同一标志，再增加各自画布的装饰与留白。图形不依赖系统字体、嵌入位图或网络图片。品牌名称、版本与中英文安装文案由配置和原生文字控件显示，图片中不写死这些内容。

[`scripts/branding.mjs`](../scripts/branding.mjs) 调用 resvg 按三倍分辨率直接渲染安装器 SVG、编码 24 位 BMP，并使用项目锁定的 Tauri CLI 生成完整的系统图标尺寸。ICO 与 ICNS 的层顺序经过规范化，避免重复生成产生无意义差异。无需 Python、Pillow 或手动逐张导出。

| SVG 源                                        | 使用位置                             | 生成产物                                               |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `resources/branding/app-icon.svg`             | 标题栏、favicon、系统应用 / 托盘图标 | `src-tauri/icons/` 下的 ICO、ICNS、PNG；前端直接用 SVG |
| `resources/branding/installer-header.svg`     | NSIS 安装 / 卸载页眉                 | `src-tauri/installer/header.bmp`                       |
| `resources/branding/installer-sidebar.svg`    | NSIS 欢迎 / 完成页                   | `src-tauri/installer/sidebar.bmp`                      |
| `resources/branding/installer-wix-banner.svg` | MSI 内页页眉                         | `src-tauri/installer/wix-banner.bmp`                   |
| `resources/branding/installer-wix-dialog.svg` | MSI 欢迎 / 完成页                    | `src-tauri/installer/wix-dialog.bmp`                   |

`src-tauri/icons/` 和 `src-tauri/installer/` 是平台要求的输出位置，保留 Tauri 的常规目录。设计源只有上表这些 SVG，派生图片需提交，勿手工修改；`pnpm verify` 和 CI 会检查是否同步。切换品牌时先修改 `app.config.json` 并运行初始化，再修改共用 SVG 并重新生成资源。

Windows 应用图标在 Rust 构建时嵌入 exe，`src-tauri/build.rs` 监听 `icons/` 触发资源重编译；安装器外层图标单独由 NSIS 配置读取。最终验收需同时检查安装器、安装后的 exe 和快捷方式，不能只看源 ICO 或安装器外观。NSIS 显式使用已安装 exe 的图标索引 0，并在安装后刷新 Shell 图标缓存；旧图标排查见 [排障手册](./troubleshooting.md#安装后仍显示旧图标)。

SVG 能统一修改来源，也适合前端直接使用；Windows 系统图标必须保留 ICO，macOS 使用 ICNS，Linux 使用 PNG，NSIS / WiX 的对应插画控件仍需 BMP，不能仅改后缀或在这些控件里直接放 SVG。必要图标尺寸不删减；最终安装包体积受图形细节和压缩方式影响，并不保证每种派生格式都更小。格式要求见 [Tauri 图标说明](https://v2.tauri.app/develop/icons/) 和 [NSIS Modern UI](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html)。

NSIS 与 MSI 的生成文件路径配置在 `tauri.conf.json > bundle.windows`：

| 打包器 | 配置项                 | 设计尺寸   | BMP 像素尺寸 | 用途                  |
| ------ | ---------------------- | ---------- | ------------ | --------------------- |
| NSIS   | `nsis.headerImage`     | 150×57     | 450×171      | 内页页眉              |
| NSIS   | `nsis.sidebarImage`    | 164×314    | 492×942      | 欢迎页 / 完成页侧栏   |
| NSIS   | `nsis.installerIcon`   | ICO 多尺寸 | —            | 安装器图标            |
| NSIS   | `nsis.uninstallerIcon` | ICO 多尺寸 | —            | 卸载器图标            |
| WiX    | `wix.bannerPath`       | 493×58     | 1479×174     | 内页顶部横幅          |
| WiX    | `wix.dialogImagePath`  | 493×312    | 1479×936     | 欢迎 / 完成对话框背景 |

要点：

- 位图用 24 位 BMP（不要带 alpha），配色与主界面一致（neutral + indigo 强调色）。
- NSIS 页眉、欢迎页和完成页按控件的实际像素尺寸，用 GDI `HALFTONE` 缩放三倍分辨率原图，避免默认缩放产生锯齿或放大低分辨率图像。MUI 继续负责对话框布局与侧栏图片释放；加载失败时保留其默认图片。修改后需检查实际安装界面，包括高 DPI 显示器；图中仍不放小字。
- **WiX 会在位图之上叠加自己的文字控件**（`WixUI_InstallDir`，dlu→px 为 4/3），画图必须避开：
  - banner（493×58）：标题文字 x 20–287 / y 8–28，描述文字 x 33–406 / y 31–51 ⇒ 图形放右侧（x > 290）或底部条带（y > 52）。
  - dialog（493×312）：标题与描述文字都在右侧 x 180–473 / y 27–187 ⇒ 主视觉放左侧（x < 180）或底部（y > 190）。
  - 压到文字就是"图标错位"。MSI 实测布局可从 WiX 工具集 `WixUIExtension.dll` 内嵌 objects XML 提取。
- 所有位图通过 `pnpm branding:generate` 生成；重新 `pnpm app:build` 才会更新安装包内的资源。
- 页脚文字来自 `bundle.copyright`；留空时 NSIS 会回退成 "Nullsoft Install System vX"。
- 安装语言由 `nsis.languages` 决定，中文系统会命中 `SimpChinese`；MSI 界面语言由 `wix.language` 控制（当前 `zh-CN`）。
- 模板自带 `src-tauri/installer/installer.nsi`，欢迎页 / 完成页的文案与配色在“品牌定制”标记之间，使用独立 `LangString` 并通过页面宏引用，不覆盖 NSIS 内置翻译。
  - 页眉标志在右侧，为标题和说明留出空间；中英文分别使用 Windows 自带的 Microsoft YaHei UI / Segoe UI。标题与正文分级，保留原生步骤、键盘导航及 DPI 缩放。
  - 新增安装语言时，要为自定义文案补齐对应语言的 `LangString`，并实际编译检查，不能假设自定义键会自动回落到内置翻译。
- **升级 Tauri 后**：对照同版本官方 NSIS 模板合并更新，保留“品牌定制”各段的配色、页面宏引用、高清位图加载和语言字符串，并复核 WebView2 临时路径、执行引号和文件关联修复是否已被上游覆盖。不要整份沿用旧模板。自定义 MSI 模板同理，对应 `wix.template`。

### 自启动与卸载

Windows 自启动按当前用户在 HKCU 下以应用 identifier 写入 Run 项，读取实际 StartupApproved 状态并严格引用当前 exe。NSIS currentUser 卸载器会清理本应用的 Run / StartupApproved 项。

MSI 卸载可能由另一账户或以 per-machine 方式执行，默认模板无法可靠删除每个原用户创建的 HKCU 值；MSI 用户应在卸载前通过应用关闭开机启动。macOS / Linux 使用官方自启动插件，仍需在对应系统验收安装、启用 / 禁用与卸载；E2E 不改系统自启动设置。

## 代码签名

### Windows

Windows Authenticode 签名标识发布者并验证文件完整性，不能保证消除 SmartScreen 告警。证书要求、服务资格与工具参数会变化，实施前核对 [Tauri Windows 签名指南](https://v2.tauri.app/distribute/sign/windows/) 和服务商当前文档。

本仓库提供的接入点：

| 路线                                | 仓库现状                        | 需要完成                                           |
| ----------------------------------- | ------------------------------- | -------------------------------------------------- |
| SignPath Foundation                 | 可选签名 job 已实现             | 申请通过、配置门户与仓库参数、人工审批             |
| Azure Artifact Signing 或证书商 HSM | 未安装 CLI，也未注入 Azure 变量 | 修改 workflow，安装工具，配置 `signCommand` 与凭据 |
| 可导出的 PFX 证书                   | 导入与验证步骤已实现            | 确认证书仍有效且用途符合分发范围，配置 Secrets     |

#### SignPath Foundation

仓库侧已经接好，剩下的是 SignPath 的申请与参数配置。

申请要求以 [SignPath Foundation 条款](https://signpath.org/terms) 为准，主要包括：

- 项目公开、持续维护、使用 OSI 许可（本项目 MIT），并已按申请签名的产物形式公开发布版本；
- SignPath 与 GitHub 账号都启用 MFA；
- 仓库首页和下载入口公开[代码签名策略](./code-signing-policy.md)，启用前落实其中的策略入口、服务署名与隐私说明。

**申请**：

1. 打开 <https://signpath.org/>，用 GitHub 登录并提交 OSS 申请（仓库 URL、许可证、用途、构建方式）；
2. 申请通过后取得组织与项目，并确认签名审批责任人。

**在 SignPath 门户配置**：

1. 创建 project，slug 记为 `SIGNPATH_PROJECT_SLUG`；
2. 创建 artifact configuration：上传一个打好的 `*-setup.exe` 作为样本，或直接粘贴
   `.signpath/artifact-configuration.xml`，slug 记为 `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`；
3. 创建 signing policy（如 `release-signing`）并开启人工审批，slug 记为 `SIGNPATH_SIGNING_POLICY_SLUG`；
4. 生成 API token（需要项目提交权限），存为 `SIGNPATH_API_TOKEN`。

**在 GitHub 仓库配置（Settings → Secrets and variables → Actions）**：

| 类型      | 名称                                   | 值                          |
| --------- | -------------------------------------- | --------------------------- |
| Variables | `SIGNPATH_ORGANIZATION_ID`             | SignPath 组织 ID            |
| Variables | `SIGNPATH_PROJECT_SLUG`                | 项目 slug                   |
| Variables | `SIGNPATH_SIGNING_POLICY_SLUG`         | 签名策略 slug               |
| Variables | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | artifact configuration slug |
| Secret    | `SIGNPATH_API_TOKEN`                   | API token                   |

**发版**：打 tag 后，`release.yml` 的 `build` job 产出 draft Release，并将未签名的 NSIS 包直接上传为本次运行的 artifact；随后 `sign-windows` job 使用该 artifact 的 ID
提交签名请求（到 SignPath 门户点批准）→ 校验签名 → 覆盖 draft 资产。这样签名来源直接关联到本次构建。SignPath 与 PFX 签名应二选一。
上传签名文件前会再次核对目标 Release 的 tag 与 draft 状态，拒绝覆盖已公开版本。
未配置 `SIGNPATH_ORGANIZATION_ID` 时该 job 直接跳过，现有发布流程不受影响。

**限制**：

- 发布者显示 "SignPath Foundation"，不是你的名字；
- 每次发版要在 SignPath 门户人工批准一次；
- 当前配置只签 NSIS 安装包外层，安装后的应用 exe 与 MSI 不会被该 job 签名；需要调整嵌套签名范围时，必须同时修改 artifact 配置、产物收集和验证步骤。
- 当前 SignPath 流程不能直接与 `createUpdaterArtifacts` 组合：打包后重签会改变安装包字节，使先前生成的更新签名失效。流水线会拒绝该组合；接入自动更新时，须将更新签名生成移到 Authenticode 签名之后。

#### 其他硬件或托管签名

Azure Artifact Signing、USB Token 和证书商 HSM 尚未接入本仓库。选择后需按服务商文档安装工具、配置身份与授权，并通过 Tauri 的 `bundle.windows.signCommand` 接入；不要把这些方案的凭据仅填入 Secrets 后就视为已启用。当前仓库接线状态见上表。

具体步骤见 [Tauri Windows 签名指南](https://v2.tauri.app/distribute/sign/windows/)；服务资格与私钥保护方式以签发方或服务商政策为准。

#### 可导出 PFX 流程

仅在证书有效且发行策略允许导出私钥时使用，例如受组织信任的内部分发证书。自签名 / 内部证书不会自动获得公共信任；不要据此采购新公共 OV / EV 证书。签名参数不要写进仓库，使用临时配置文件在构建时合并：

```bash
pnpm app:build --config <临时签名配置文件路径>
```

查本机证书指纹：

```powershell
Get-ChildItem Cert:\CurrentUser\My | Select-Object Subject, Thumbprint
```

`release.yml` 已内置这条链路：PFX 转 base64 存入 `WINDOWS_CERTIFICATE`、密码存入
`WINDOWS_CERTIFICATE_PASSWORD`，runner 导入证书后用 `Get-AuthenticodeSignature` 校验。
证书与私钥**绝不进仓库**。

> 签名发生在**打包阶段**：`tauri build --no-bundle`（便携版）不会触发签名。
> 需要签名的便携 exe 请单独执行 `signtool sign /sha1 <指纹> /fd sha256 <exe>`。

#### 未签名分发

可以生成未签名的模板或内测包；Windows 用户可能遇到信誉提示，实际运行行为还受系统与组织策略限制。

### macOS

面向站外分发时应做 Developer ID 签名和公证（notarization），并在干净机器上验证 Gatekeeper 行为。

```bash
export APPLE_CERTIFICATE="<base64 的 .p12>"
export APPLE_CERTIFICATE_PASSWORD="<密码>"
export APPLE_SIGNING_IDENTITY="Developer ID Application: 公司名 (TEAMID)"
export APPLE_ID="<Apple ID>"
export APPLE_PASSWORD="<App 专用密码>"
export APPLE_TEAM_ID="<Team ID>"

pnpm app:build
```

证书与公证凭据完整有效时，Tauri 执行签名、公证与打包；GitHub Actions 使用同名 Secrets。未配置证书时，当前工作流仍可生成未签名、未公证产物，不应把构建成功当作 Gatekeeper 验收通过。

对最终交付的 `.app` 检查代码签名和执行策略，路径有空格时保留引号：

```bash
codesign --verify --deep --strict --verbose=2 "/path/to/My App.app"
spctl --assess --type exec --verbose=3 "/path/to/My App.app"
```

`.app` 使用执行评估；`--type install` 适用于 `.pkg` 安装器，不能用它代替应用检查。命令及结果含义见 [Apple 公证排障](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)。仍需在目标系统用实际下载、挂载、拖拽安装与首次启动验证分发体验。

### Linux

当前发布流程未为 Linux 配置独立的发行包签名。分发时提供文件校验值；软件源或其他渠道有额外签名要求时，按该渠道配置。自动更新签名仍按下节执行。

## 自动更新

模板已注册 Rust updater 插件，页面通过 `lib/tauri.ts` 的生成命令调用原生更新服务，重启由 Rust `AppHandle::restart` 执行。默认源为当前模板的 GitHub Releases 地址，`app.config.json > updates.publicKey` 为空时显示未配置，不请求网络；派生项目须同时修改仓库地址和更新端点。

### 配置公钥与发布签名

1. 在仓库外生成并保管更新密钥，私钥离线备份，公钥可提交：

```bash
pnpm tauri signer generate -w ~/.tauri/my-app.key
```

2. 修改品牌配置；端点必须对应本项目的 GitHub 仓库，CI 会校验：

```json
{
  "updates": {
    "endpoint": "https://github.com/<owner>/<repo>/releases/latest/download/latest.json",
    "publicKey": "<签名公钥内容>"
  }
}
```

3. GitHub Secrets 配置 `TAURI_SIGNING_PRIVATE_KEY`，有密码时再配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。公钥与私钥必须配对；两者都缺失时生成普通安装包，只配置一边会使 CI 失败。

4. 正常打 tag 发布。工作流用临时配置启用 `bundle.createUpdaterArtifacts: true`，生成 Tauri v2 更新产物；本地默认构建仍不额外产出更新签名。每个平台收集后，用独立 Rust 验证器核对最终文件字节、公钥、`.sig` 与签名绑定的版本，随后上传平台元数据。

5. 构建完成后由单独 job 合并四个目标的元数据，核对 draft Release 中的实际资产并上传唯一的 `latest.json`，避免矩阵任务互相覆盖。检查并发布正式版 draft 后，客户端才能通过 GitHub latest 入口获取新版本。

默认 `/releases/latest/` 通道只分发正式版；GitHub 不将 draft 或 prerelease 设为 latest，见 [GitHub Release 规则](https://docs.github.com/en/rest/releases/releases#create-a-release)。预发布包仍可单独下载；需要测试更新通道时，另行设计端点、版本比较与发布校验，不能假定给 tag 加 `beta` 就会进入默认更新通道。

发布内部接口在 [`release-lib.mjs`](../scripts/release-lib.mjs)（`prepare / collect / merge`）；版本 / 签名验证入口在 [`verify-updater.rs`](../src-tauri/src/bin/verify-updater.rs)。签名覆盖版本号，手工签名也需使用匹配的 `--app-version`，不能把旧签名用于不同版本的清单。

### 运行时策略与安装行为

默认策略从 `app.config.json` 编译进入应用。受控部署可在 `appConfigDir/deployment.json` 写同样的 `{ "updates": { "endpoint": "...", "publicKey": "..." } }` 覆盖；此文件只放端点和公钥，不能放私钥。运行时要求 HTTPS、无 URL 凭据和 fragment，拒绝 HTTP 重定向降级，并启用签名版本一致性检查。

部署文件整体替换默认更新策略，限制和信任边界见 [更新通道](./security.md#更新通道)。变更端点或公钥后须重新检查更新；已检查的安装句柄不会继续沿用旧策略。

检查结果、下载 / 安装句柄与进度由 Rust 管理，各窗口通过事件同步；重复操作返回明确状态。下载验签完成后、实际安装前统一协商所有应用窗口，保存 / 放弃成功后才继续；笔记持久草稿、文件编辑及后台任务参加协商，保存失败或取消保留工作。安装期间保持窗口冻结，不能将下载开始时的确认当作安装时仍然有效。实现边界见 [架构说明](./architecture.md#恢复诊断与更新)。

**Windows 安装可能结束当前进程、启动安装器并由安装器重新打开应用。** 不能承诺安装后总是留在界面等待用户重启。其他平台若安装后应用仍在运行，可通过界面重启入口加载新版。

更新仅支持 Tauri v2 原生安装包 / 应用归档，Rust 依赖关闭旧 ZIP 兼容路径。Windows 默认更新入口优先 NSIS，另有 NSIS / MSI 明确平台入口；macOS 使用 `.app.tar.gz`，Linux 默认入口优先 AppImage，并提供 DEB / RPM 类型入口，防止已安装的包收到错误格式。DEB / RPM 安装可能调用系统提权界面。不要给 v1 兼容 ZIP 接入相同通道。

### 更新服务端与签名顺序

当前默认使用 GitHub Releases 的静态 `latest.json`；若改用其他服务器，保持 Tauri 的版本、平台 URL 与签名格式，并自行调整本项目的发布端点校验。格式参考 [Tauri updater 文档](https://v2.tauri.app/plugin/updater/)。

更新签名必须覆盖**最终交付字节**。PFX 在打包阶段完成 Authenticode 签名，可与当前更新流程配合；SignPath 后签名会改变包字节，当前 workflow 明确拒绝与 updater 组合。需要该组合时，须先实现后签名完成后的更新重签、版本绑定验证与清单生成，再开放配置。

代码签名与更新签名用途不同：Authenticode / Developer ID 解决系统发布者与安装信任，更新公钥验证客户端收到的包和版本；不能互相替代，不能跳过验签处理安装失败。

## CI 多平台构建

`.github/workflows/ci.yml` 执行格式、lint、类型、单元测试、Rust 编译与独立的三端真实桌面 E2E job。
出正式包由 `.github/workflows/release.yml` 负责，推送 `v*` tag 或手动触发均可运行。tag 触发会核对 tag 与项目版本；手动触发按所选 ref 构建，并以项目版本关联 `v<version>` Release。正式发布应选择已合入 `main` 的发布提交及对应 tag，不能以手动触发绕过分支评审。

发布流程先由 `validate` job 执行冻结安装和 `pnpm verify`，通过后才进入各平台构建；PFX 签名验证按配置检查实际启用的 NSIS / MSI 产物，缺失或签名无效会失败。

构建矩阵覆盖：

| 平台            | 产物                 |
| --------------- | -------------------- |
| Windows x64     | nsis / msi           |
| macOS arm64+x64 | dmg / app            |
| Linux x64       | deb / rpm / appimage |

产物以 **draft Release** 上传，人工确认后再发布。

某个平台或后续验证失败时，其他平台可能已把资产上传到 draft；此时不能发布部分成功的草稿。先确认失败原因与该 tag 的源码：无需改代码时可重跑失败任务，完成后重新核对全部目标、签名和更新元数据；需要改代码时使用新版本和新 tag。已公开版本不得通过重跑工作流替换资产，后置的 draft 检查不代表整个构建上传阶段都禁止覆盖。

工作流另将 `tauri-action` 本次返回的产物收集到同一套 `artifacts/<version>/<target>/installers/` 结构，生成清单并上传为 `build-installers-<target>`。这是 build 阶段的归档，尚未经过可选的 SignPath 后签名；启用 SignPath 后，签名 job 会重新生成签名文件的清单，上传 `signed-installers-x86_64-pc-windows-msvc` 并覆盖 draft Release 的 NSIS 资产。需要 SignPath 签名包时，使用签名 job 的归档或完成签名后的 Release。

CI 只收集 `tauri-action` 明确返回的文件，不按相邻文件猜测签名或压缩包。macOS 上传 workflow artifact 前，会把已归档的 `installers/` 整体打成 tar 包以保留 `.app` 的执行权限和符号链接；Release 中的应用压缩包仍由 `tauri-action` 生成。

**签名密钥一律走 GitHub Secrets。** 下表区分已接线参数与需要额外实施的参数；未配置签名时仍会生成包，但不代表满足公开分发要求：

| Secret                                                                        | 用途                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`                        | 已接线：允许导出且有效的 Windows PFX，受证书用途与信任范围约束           |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`                 | 未接线：Azure Artifact Signing，需安装 CLI、注入变量并配置 `signCommand` |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS 签名                                                               |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`                               | macOS 公证                                                               |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`            | 更新签名；与品牌配置公钥配对后由发布流程启用                             |

当前 `release.yml` 内置了 **PFX**、macOS 与可选的 SignPath 链路；SignPath 需要配置门户与仓库参数，Azure 需要额外安装 CLI 并注入三个环境变量。

证书和私钥不进仓库；泄露后按凭据类型撤销、轮换并评估已发布产物，更新私钥还需制定现有客户端的迁移方案。

Linux 构建需要先装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

## 发布检查清单

由发布负责人在 Release 或发布 issue 留下实际版本、commit、平台、产物哈希和检查证据，并指定发布后的支持与恢复责任人。下列检查按适用目标执行，不适用的项目说明理由；阻断项失败或目标平台未验收时，不把该目标标记为可交付。

- [ ] 已从 `develop` 创建 `release/x.y.z`，检查本次提交范围
- [ ] `pnpm version:set x.y.z` 已执行，四处版本号一致
- [ ] 通过 `git log v上一版..HEAD --oneline` 审查提交范围，确认无遗漏或无关变更
- [ ] `pnpm verify` 和目标平台 Rust 检查通过，发布分支 CI 全绿
- [ ] 在目标平台的干净机器上完成 [安装版与启动验收](./testing.md#安装版与启动验收)，验证图标、冷 / 热启动、初始化期间重复启动、窗口操作、外链与 IPC，保留实测结果
- [ ] 需要签名的 Windows 分发渠道已检查签名状态与发布者；SignPath 仅覆盖 NSIS 外层
- [ ] 发布 macOS 包时已按 [macOS 签名检查](#macos) 验证签名、公证和实际下载后的首次启动
- [ ] 启用自动更新时，验证旧版本能够收到并成功安装新版本；安装前保存各窗口内容
- [ ] 系统集成使用派生项目自己的 scheme / 扩展名，验证安装版深链、文件关联冷 / 热启动及通知、快捷键、凭据权限；未测平台明确记录
- [ ] 涉及数据格式变更时，按 [数据与恢复验证](./testing.md#数据与恢复验证) 记录支持升级的历史版本、迁移失败状态及恢复演练结果
- [ ] 卸载后残留检查（用户数据是否按预期保留或清理）
- [ ] `release/*` 已通过 PR 合入 `main` 和 `develop`，在 `main` 对应合并提交打 tag `vX.Y.Z`
- [ ] 等待发布 workflow 和可选签名 job 全部成功，检查 draft 中版本、平台资产、签名与更新元数据后人工发布
- [ ] 发布公告与更新说明同步给使用方

## 发布后观察

发布负责人核对公开下载与更新源实际可用、资产哈希和签名与验收包一致，并在目标平台走通下载 / 更新入口。根据支持渠道收到的启动、白屏、数据、安装升级反馈判断是否暂停分发；记录观察范围和结果，不把“没有收到反馈”等同于没有故障。

当前模板只有本地日志与诊断，没有遥测上传、自动告警、远程关闭开关或分阶段放量系统。维护者应提供真实支持渠道，需要用户日志时说明采集范围并脱敏。引入监控或更新通道时，另行设计隐私、支持版本和发布控制，不能在文档中承诺尚未实施的能力。

发现阻断故障后，先确定受影响版本与数据状态，停止继续推荐问题包；修改更新源只能影响后续请求，不能撤销已下载的安装器或恢复用户数据。保留原始产物与哈希供定位，记录处理决定，再按下述路径发布修复。故障与行动项记录规则见 [故障反馈](./engineering-at-scale.md#性能发布与故障反馈)。

## 回滚

- **应用级**：推荐把回滚后的代码发布为更高版本，让现有客户端正常升级。
  仅将 `latest.json` 指向较旧版本不会触发默认更新；自动降级需要预先在 Rust 更新器中自定义版本比较，并处理 Windows 安装器的降级限制，否则让用户手动重装。
- **代码级**：`git revert` 对应合并节点后重新发版，不要强推 tag。
- **数据级**：涉及数据库结构变更的版本，必须提前设计向前兼容的迁移，不做"降级删表"。

涉及迁移或恢复机制的发布，提前用隔离的旧版本数据实测：升级后重开、注入迁移失败、再使用修复版本恢复读取，并核对完整记录、回收站与草稿。正常运行时通过笔记页创建 / 预览 / 恢复逻辑备份；启动存储失败时通过隔离恢复入口验证备份、暂存替换并重启。保留安全备份和原件归档，说明范围与可能丢失的内容；逻辑备份不覆盖设置、凭据、日志或外部文件。数据库已升级时不得默认直接安装旧二进制，未来版本保护不保证旧程序能读新数据。演练结果与恢复负责人留在发布记录，功能存在不等于所有平台已验收。
