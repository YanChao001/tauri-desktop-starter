# 构建与发布

本文维护版本、分发产物、签名接入、更新与发布恢复的操作。命令从仓库根目录执行；自动发布以 [release.yml](../.github/workflows/release.yml) 为准，当前签名资格与范围见 [代码签名策略](./code-signing-policy.md)，运行时信任边界见 [安全规范](./security.md)。

## 版本号：四个地方必须一致

使用脚本同步版本，不单改某一文件：

```sh
pnpm version:set 1.2.0
pnpm version:check
```

脚本同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 的自身包版本，写前校验并通过文件事务检测并发修改；失败回滚本轮写入，并发冲突保留用户内容与备份。CI 同时检查项目版本及 `v<version>` tag。

当前包含 MSI，主版本 ≤ 255、次版本 ≤ 255、修订版本 ≤ 65535；预发布或构建元数据用作第四段时须为 ≤ 65535 的整数。`beta.1` 等文本需显式设置 `bundle.windows.wix.version`，或先从配置移除 MSI；仅传 `--bundles nsis` 不改变版本校验依据。NSIS 各主版本段也须 ≤ 65535，完整规则见 [版本脚本](../scripts/version.mjs)。

已发布版本号不复用；自动更新和安装器的版本限制见 [回滚](#回滚)。

## 构建

```sh
pnpm app:build # 默认优先压缩程序体积
pnpm app:build --bundles nsis # 只交付一种格式
pnpm app:build --optimize speed # 优先编译速度
```

脚本构建 release 并将本次安装包收集到 `artifacts/<version>/<target-triple>/installers/`：

| 平台    | 格式                                            | 当前安装方式                                        |
| ------- | ----------------------------------------------- | --------------------------------------------------- |
| Windows | `nsis/*.exe`、`msi/*.msi`                       | NSIS 按用户安装；MSI 所有用户安装，提权遵循系统策略 |
| macOS   | `dmg/*.dmg`、`macos/*.app`                      | 拖拽安装                                            |
| Linux   | `deb/*.deb`、`rpm/*.rpm`、`appimage/*.AppImage` | 系统包或 AppImage                                   |

目标由 [`tauri.conf.json > bundle.targets`](../src-tauri/tauri.conf.json) 决定，当前为 `all`；升级 Tauri CLI 后复核各平台默认格式。[浏览器演示](./development.md#浏览器演示构建与部署) 单独输出 `dist-web/`，不生成原生包。

`dist/`、`dist-web/` 和 Cargo 默认 `src-tauri/target/` 是生成输出，不作为统一交付目录。`app:build` 先编译并从 Cargo 输出确定实际产物，再隔离旧 bundle、打包和归档；失败恢复旧 bundle，避免把旧包误作新结果。沿用 Cargo 缓存，支持自定义编译目录，统一归档位置不变。

每次只替换当前版本 / target 对应的 `installers/` 或 `portable/`，保留其他版本、target 和另一类产物。因此仅构建 NSIS 时，本轮 `installers/` 不保留旧 MSI。每类目录的 `manifest.json` 记录版本、target、时间和普通文件 SHA-256；`.app` 等目录只记录目录类型，应校验 DMG / 归档文件哈希。清单不提供系统发布者签名。

常用参数如下；完整说明可运行 `pnpm app:build --help`：

| 参数                                                                               | 用途                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `--target` / `-t`                                                                  | Rust target triple，也是归档目标名          |
| `--bundles` / `-b`                                                                 | 安装格式，支持列表或逗号分隔                |
| `--config` / `-c`                                                                  | 合并配置文件或 JSON；合并后版本须与项目一致 |
| `--features` / `-f`                                                                | Cargo features                              |
| `--optimize size\|speed`                                                           | 编译策略，默认 `size`；由项目脚本处理       |
| `--ci`、`--no-sign`、`--skip-stapling`、`--no-binary-patching`、`--verbose` / `-v` | 透传对应构建 / 打包选项                     |
| `--no-bundle`                                                                      | 只编译，不生成本轮分发归档                  |

`--debug`、自定义 runner、裸 Cargo 参数及 macOS universal target 不在封装范围，使用 `pnpm tauri` 并自行管理输出；直接调用 Tauri 不执行项目分发收集。只清理交付目录用 `pnpm clean:artifacts`，其他范围见 [清理说明](./development.md#清理构建产物)。

归档使用同级重命名并重试短暂文件占用；自定义监听须继续排除生成目录。持续占用按 [EPERM 排障](./troubleshooting.md#windows-归档目录出现-eperm) 处理，不手工混合新旧产物。

### 编译策略

`app:build` 与 `app:portable` 默认采用原有的 `size` 体积策略，也可显式传入 `--optimize size`；需要优先编译速度时传入 `--optimize speed`。此参数由项目包装脚本消费，不透传给 Tauri CLI。

- `size` 使用体积优化、完整 LTO 和单代码生成单元，关闭增量编译并剥离符号，代价是更长的编译等待。
- `speed` 以缩短编译等待为目标：关闭 Rust 优化与 LTO、增加代码生成并行单元、开启增量编译并保留符号。程序和编译缓存会增大，原生代码的运行性能也可能下降，需按产品负载评估。

具体值以 [`Cargo.toml` 的 release 配置](../src-tauri/Cargo.toml) 和[构建脚本](../scripts/build-lib.mjs)为准。两种策略均沿用 release 构建与分发路径，不启用 debug 构建，共用 Cargo 缓存目录。切换策略会改变编译选项，首次需要重新编译依赖；持续使用同一策略时复用缓存，`speed` 还可复用增量结果。无需为切换策略清空缓存，具体耗时取决于机器、依赖与改动范围。

### 便携版（免安装）

Windows 便携脚本编译主 exe，连同 `使用说明.txt`、第三方许可和 `manifest.json` 收集到 `artifacts/<version>/<target-triple>/portable/`：

```sh
pnpm app:portable # 默认优先压缩程序体积
pnpm app:portable --skip-build # 核对源码后复用先前便携构建
pnpm app:portable --optimize speed
```

支持上表中的 release 编译参数，不接受 `--bundles`，仅支持 Windows 目标。`--skip-build` 校验先前便携构建收据中的版本、配置、参数、编译策略及 exe SHA-256；缺记录、策略不匹配或文件被改写时须重建，不能跨策略复用。复用 `speed` 构建时同时传入 `--optimize speed --skip-build`。收据不检测源码变化，源码或配置修改后不要复用旧结果。

- 目标机器需要 WebView2，安装入口见随包说明。数据写当前用户目录，不随 exe 移动；笔记、持久草稿、设置与日志均不在便携包中。
- 应用内更新默认启动 NSIS 安装器并转为安装版；保留免安装形态时，从发行页手动下载新版 portable。
- `--no-bundle` 不经过打包器，不进行 Authenticode 签名。需签名时对最终交付 exe 单独运行 `signtool`，例如 `signtool sign /sha1 <指纹> /fd sha256 <exe>`；签名后更新清单 SHA-256 并验证签名。重新收集会整体替换便携目录。
- Linux 使用 AppImage，macOS 分发 `.app` / DMG，不使用此脚本。

### 安装器外观

品牌视觉源仅维护 [`resources/branding/`](../resources/branding/) 的 SVG。应用名称等身份先按 [初始化流程](./development.md#项目初始化) 修改，再生成并提交全部派生资源：

```sh
pnpm branding:generate
pnpm branding:check
```

| 源                         | 生成位置 / 用途                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `app-icon.svg`             | 前端 / favicon 直接使用；`src-tauri/icons/` 的 ICO、ICNS、PNG 用于系统、托盘与安装器 |
| `installer-header.svg`     | NSIS 页眉 `header.bmp`，450×171                                                      |
| `installer-sidebar.svg`    | NSIS 欢迎 / 完成页 `sidebar.bmp`，492×942                                            |
| `installer-wix-banner.svg` | WiX `wix-banner.bmp`，1480×176（370×44 IU）                                          |
| `installer-wix-dialog.svg` | WiX `wix-dialog.bmp`，1480×936（370×234 IU）                                         |

安装器 BMP 均位于 `src-tauri/installer/`，为无 alpha 的 24 位格式。脚本使用 resvg 和锁定的 Tauri CLI，规范化 ICO / ICNS 层顺序；不手改派生图片，也不以 SVG 改后缀替代系统格式。窗口背景是独立资源，见 [皮肤说明](../resources/skins/README.md)。

定制时保留以下约束：

- 安装文字使用原生控件，不写入图片。WiX 会叠加标题和正文；横幅图形留右侧，欢迎页视觉留左侧，IU 不是 Win32 对话框单位。以实际中英文 / 高 DPI 安装界面核对留白和比例。
- [NSIS 模板](../src-tauri/installer/installer.nsi) 的“品牌定制”段维护文案、字体、页脚、等比页眉和铺满侧栏。保留 24 位缩放目标、绘制失败回退和图片所有权；布局脚本会静默检查，但不能代替实际安装验收。
- 自定义文案使用独立 `LangString`；增加语言时补齐并编译检查。NSIS 语言由 `nsis.languages`、MSI 由 `wix.language` 控制；`bundle.copyright` 为空会使 NSIS 回退上游页脚。
- [WiX 片段](../src-tauri/installer/wix-ui.wxs) 跳过可见 `PrepareDlg`，后台准备与提权仍保留；`fragmentPaths` 与 `componentGroupRefs` 必须同时配置。
- 重新构建才更新安装包。Rust 构建监听 `icons/`，NSIS 快捷方式使用已安装 exe 的图标索引 0 并刷新缓存；验收同时检查安装器、已安装 exe 和快捷方式，旧缓存见 [排障](./troubleshooting.md#安装后仍显示旧图标)。
- 升级 Tauri 时对照同版本上游模板合并，保留本地品牌、高清图片、WebView2 临时路径、执行引号与文件关联修复，不整份沿用旧模板。使用自定义 `wix.template` 时同样处理。

### 自启动与卸载

Windows 按当前用户在 HKCU 以应用 identifier 写 Run 项，读取 StartupApproved 状态并严格引用当前 exe；NSIS currentUser 卸载器清理本应用的 Run / StartupApproved 项。

MSI 卸载可能由另一账户或按机器执行，不能可靠删除原用户的 HKCU 项，用户应先在应用内关闭自启动。macOS / Linux 使用官方插件，仍需各平台验收启用、禁用与卸载；E2E 不改系统自启动。

## 代码签名

### Windows

Authenticode 标识发布者并验证完整性，不能保证消除 SmartScreen 告警。证书要求和服务资格以 [Tauri 签名指南](https://v2.tauri.app/distribute/sign/windows/) 及服务方文档为准；本仓库的资格、审批人与签名范围只在 [代码签名策略](./code-signing-policy.md) 维护。

| 路线                                     | 仓库接入状态                                                |
| ---------------------------------------- | ----------------------------------------------------------- |
| SignPath Foundation                      | 可选 job 已实现，启用前须完成申请、门户和仓库配置           |
| 可导出 PFX                               | 导入、打包签名与产物验证已接线，证书须有效且用途允许        |
| Azure Artifact Signing / USB Token / HSM | 未接线，须安装工具、配置身份及 `bundle.windows.signCommand` |

#### SignPath Foundation

按 [基金会申请入口](https://signpath.org/apply) 和 [条款](https://signpath.org/terms) 提交真实项目、许可、公开产物和信誉信息。申请人自行确认个人数据处理与条款；draft Release 不等于公开发布，工作流存在不等于申请获批。启用前完成 [策略要求](./code-signing-policy.md#状态) 的公开入口、署名与 MFA。

门户侧配置 project、artifact configuration（[仓库 XML](../.signpath/artifact-configuration.xml)）、开启人工审批的 signing policy，并按 [GitHub 可信构建接入](https://docs.signpath.io/trusted-build-systems/github) 约束仓库、工作流和 commit。API token 只授予项目 / 策略提交权限，不授予自动审批。

在 GitHub Settings → Secrets and variables → Actions 配置：

| 类型      | 名称                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Variables | `SIGNPATH_ORGANIZATION_ID`、`SIGNPATH_PROJECT_SLUG`、`SIGNPATH_SIGNING_POLICY_SLUG`、`SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` |
| Secret    | `SIGNPATH_API_TOKEN`                                                                                                        |

未设组织 ID 时签名 job 跳过。启用后以本次 Actions artifact ID 提交请求，门户人工批准，验证签名、重建清单，再替换同一个 draft Release 的 NSIS 资产；拒绝覆盖已公开版本。完整任务顺序见 [CI 多平台构建](#ci-多平台构建)。

SignPath 与 PFX 二选一；当前只签 NSIS 外层，不签安装后的 exe 或 MSI。后签会改变包字节，当前流程拒绝与 updater 组合；如需组合，先实现后签后的更新重签、版本校验和清单生成。

#### 其他硬件或托管签名

Azure Artifact Signing、USB Token 和证书商 HSM 需自行安装 CLI / 驱动、配置身份和 `signCommand`，仅填入 Azure Secrets 不会启用签名。公共信任、私钥保护与用途由签发方政策决定。

#### 可导出 PFX 流程

仅用于允许导出私钥且仍有效的证书；内部 / 自签名证书不会自动获得公共信任。CI 已接入 `WINDOWS_CERTIFICATE`（PFX 的 base64）与 `WINDOWS_CERTIFICATE_PASSWORD`，导入后在打包阶段签名并验证当前 NSIS / MSI 产物。

本地可查询证书指纹，将 `certificateThumbprint` 等参数放入仓库外临时配置后构建：

```powershell
Get-ChildItem Cert:\CurrentUser\My | Select-Object Subject, Thumbprint
pnpm app:build --config <临时签名配置文件路径>
```

证书和私钥不进仓库；便携 exe 按 [便携版](#便携版免安装) 单独签名。

#### 未签名分发

未配置代码签名仍可构建模板 / 内测包，实际能否运行取决于系统与组织策略；公开交付时如实标明签名状态和已验证平台。

### macOS

站外分发应做 Developer ID 签名、公证，并在干净机器验证 Gatekeeper。本地构建设置环境变量，CI 使用同名 Secrets：

| 变量                                                                        | 用途                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY` | base64 `.p12`、密码与 Developer ID Application 身份 |
| `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`                               | Apple ID、App 专用密码与团队 ID，用于公证           |

配置后运行 `pnpm app:build`。缺证书时当前 CI 仍可生成未签名 / 未公证包，构建成功不代表 Gatekeeper 通过。对最终 `.app` 检查：

```sh
codesign --verify --deep --strict --verbose=2 "/path/to/My App.app"
spctl --assess --type exec --verbose=3 "/path/to/My App.app"
```

`.app` 用执行评估，`--type install` 用于 `.pkg`；说明见 [Apple 公证排障](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)。还须实际下载、挂载、拖拽安装和首次启动。

Extism 使用 Wasmtime JIT，Hardened Runtime 下须额外验证可执行内存权限与扩展运行，参见 [Apple JIT](https://developer.apple.com/documentation/apple-silicon/porting-just-in-time-compilers-to-apple-silicon) 和 [Wasmtime 跟踪](https://github.com/bytecodealliance/wasmtime/issues/11989)。当前尚未完成 macOS 签名安装版的扩展验收，不自动添加未经验证的 entitlement。

### Linux

当前未配置独立发行包签名，提供文件哈希；软件源有额外要求时按渠道配置。更新签名独立执行。

## 自动更新

Rust updater 经 [`src/lib/tauri.ts`](../src/lib/tauri.ts) 的生成命令提供服务，重启由 Rust 执行。当前 [`app.config.json`](../app.config.json) 已配置本项目公钥与 GitHub Releases 端点；维护者仍须提供匹配私钥，并发布有效清单、签名和更高版本，才能实际更新。

主窗口设置就绪且页面可见后延迟检查一次；`autoCheckUpdates` 默认 `true`，可在设置关闭，浏览器不检查。后台失败不弹窗 / 跳转，新版本提示只引导查看，下载和安装须用户确认。检查超时 20 秒，下载预算独立为 300 秒；界面提供失败分类、重试、最近成功时间和发行页入口。

### 配置公钥与发布签名

1. 首次配置时在仓库外生成密钥，按 [密钥管理](./security.md#密钥与证书) 备份；已有通道不可直接覆盖旧密钥。

   ```sh
   pnpm tauri signer generate -w ~/.tauri/my-app.key
   ```

2. 在 `app.config.json` 设置公钥和本项目端点，CI 会核对 GitHub 仓库：

   ```json
   {
     "updates": {
       "endpoint": "https://github.com/<owner>/<repo>/releases/latest/download/latest.json",
       "publicKey": "<签名公钥内容>"
     }
   }
   ```

3. 配置 Secrets `TAURI_SIGNING_PRIVATE_KEY`，加密密钥另设 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。公私钥只配一边会使 CI 失败；两边均不配置时生成普通安装包。
4. 按正式流程发版。CI 临时启用 `createUpdaterArtifacts: true`，收集后用 [Rust 验证器](../src-tauri/src/bin/verify-updater.rs) 核对最终文件、公钥、`.sig` 与签名版本；本地默认构建不额外生成更新签名。
5. 独立 job 汇总四个目标元数据，与 draft 实际资产按文件名 / 上传标签匹配，再生成唯一 `latest.json`。下载 URL 使用 GitHub 返回的正式资产名，不猜重命名或使用草稿临时地址。正文取自 Release，最多 8000 字符，优先保留摘要、限制与完整说明链接。

初始无公钥客户端须手动安装带公钥版本，或通过可信部署迁移。首轮验收使用两个不同版本完成发现、下载、验签和安装；同版本安装或仅生成清单不足以证明升级可用。便携版更新会转为安装版。

默认 `/releases/latest/` 不分发 draft / prerelease，详见 [GitHub Release 规则](https://docs.github.com/en/rest/releases/releases#create-a-release)。测试通道须另行设计端点、版本比较与发布校验；tag 加 `beta` 不会进入默认通道。手动生成更新签名也须提供匹配 `--app-version`，不得复用不同版本的签名；内部工具见 [release-lib.mjs](../scripts/release-lib.mjs)。

### 运行时策略与安装行为

默认策略编译自 `app.config.json`。受控部署可在 `appConfigDir/deployment.json` 写 `{ "updates": { "endpoint": "...", "publicKey": "..." } }` 整体覆盖；只放公钥和端点，安全限制见 [更新通道](./security.md#更新通道)。变更策略后须重新检查，旧安装句柄不能沿用。

检查、下载句柄与进度由 Rust 管理并跨窗口同步。下载验签后、实际安装前统一协商所有窗口的笔记草稿、文件编辑和任务；保存失败或取消则保留工作，安装期间冻结窗口。见 [更新与恢复架构](./architecture.md#恢复诊断与更新)。

设置中的更新区保持状态与操作简洁；发现新版本后，点击“版本说明”在弹窗中阅读该版本的 Markdown 正文。正文复用安全 Markdown 渲染，支持标题、列表、表格和代码块，长内容在弹窗内部滚动；外链沿用受控入口，HTML 和远程图片不执行或加载。没有正文时显示空态，不影响下载安装。

Windows 安装可能结束当前进程、启动安装器并重新打开应用，不能承诺停留等待重启；其他平台安装后仍在运行时，可用界面重启入口。

仅支持 Tauri v2 原生格式：Windows 默认 NSIS，并有 NSIS / MSI 明确平台入口；macOS 使用 `.app.tar.gz`；Linux 默认优先 AppImage，另有 DEB / RPM 入口，系统包可能提权。不向同一通道接入 v1 兼容 ZIP 或错误包格式。

### 更新服务端与签名顺序

默认 GitHub Releases 静态清单；自建服务器须保持 [Tauri updater 格式](https://v2.tauri.app/plugin/updater/) 并调整发布端点校验。

代码签名处理系统发布者信任，更新签名验证包与版本，两者不能互代。**更新签名须覆盖最终交付字节**：当前 PFX 在打包阶段签名，可以配合更新流程；SignPath 后签组合尚未支持。任何代码签名、压缩或字节修改均须在生成最终更新签名与清单之前完成。

## CI 多平台构建

日常 CI 的验证范围见 [测试规范](./testing.md#持续集成检查)。正式包由 [release.yml](../.github/workflows/release.yml) 在推送 `v*` tag 或手动触发后构建；校验任务要求提交已属于 `main`，tag 与项目版本一致。手动触发按所选 ref 的项目版本关联 Release，同样是正式发布决定。

**打 tag / 手动触发前完成适用验收并确认发布说明；全部必要任务成功后会自动公开，不再等待人工点发布。** 草稿只暂存构建与签名资产，自动公开不代替目标平台安装、签名或升级验收。

流程如下：

1. `validate` 冻结安装并运行 `pnpm verify`，创建 / 复用唯一同版本 draft，将 Release ID 传给后续任务。多草稿、已公开版本或草稿源码不匹配均在构建前失败。
2. `build` 构建 Windows x64（NSIS / MSI）、macOS arm64 与 x64（DMG / app）、Linux x64（DEB / RPM / AppImage），按 ID 上传；配置 PFX 时校验实际 NSIS / MSI 签名。Linux 系统依赖由 workflow 安装，本地环境见 [开发指南](./development.md#环境要求)。
3. 已启用的 `publish-updater` 汇总清单；`sign-windows` 完成 SignPath 签名与验证。两者成功或因未启用而跳过后，才公开同一 Release。必要任务失败、取消或意外跳过时保留草稿。

`build-installers-<target>` 是 build 阶段的归档；SignPath 启用时最终签名归档为 `signed-installers-x86_64-pc-windows-msvc`，Release 的 NSIS 也会替换。收集只使用 `tauri-action` 返回文件，不猜相邻产物；macOS workflow artifact 外包 tar，保留 `.app` 权限与符号链接。

签名凭据全部走 Secrets：Windows、macOS 和更新变量见各自章节；Azure 未接线，单独填入 Secrets 无效。缺代码签名凭据可生成未签名包，不代表满足分发信任要求。

发布正文由 [发布说明脚本](../scripts/release-notes.mjs) 生成，固定包含版本信息、变更摘要、破坏性变更、更新内容、升级与限制、下载与系统要求、完整变更。摘要 / 限制读取合入 `main` 的 `release/*` 或 `hotfix/*` PR，优先“变更摘要”“升级与限制”，回退“变更内容”“影响范围”；只有模板注释会阻止建草稿。首次发布如实记录没有历史升级路径。

变更列表直接读取上一公开正式版标签至本次确切 SHA 的完整 Git 历史，按 Conventional Commits 的 `feat`、`fix`、`perf`、`refactor`、`docs`、`build`、`ci`、`test`、`style`、`chore`、`revert` 分类，未识别类型保留在“其他变更”，不依赖维护者手动给 PR 添加分类标签。合并记录不重复列入，底层普通提交仍参与分类；过滤没有破坏性声明的纯升版 / 回流 `chore(release)`，`fix(release)` 等实际修复保留。`!`、`BREAKING CHANGE:` 和 `BREAKING-CHANGE:` 会额外进入破坏性变更章节。没有非合并产品提交时如实说明，并保留源码对比链接。

发布 job 已检出完整历史，本地预览也须有完整历史和上一正式标签；浅克隆、标签缺失、基线不是本次来源的祖先，或说明超过大小上限时，均在创建草稿前停止。下载说明列出实际四个目标的架构与安装格式、WebView2 等依赖和签名说明。当前项目未声明经安装验收的统一最低系统版本，不能把 CI runner 版本写成最低支持版本；具体系统与安装验收范围须在发布 PR 中说明。

发布 PR 合入后、打 tag 前可预览正文，不修改远端：

```powershell
$env:GITHUB_REPOSITORY = 'owner/repo'
pnpm release:notes # 需已登录 gh，输出 artifacts/<version>/release-notes.md
```

摘要须覆盖上一正式版以来的实际变更，破坏性提交正文应给出升级操作和数据影响。更新弹窗说明过长时优先保留摘要、破坏性变更和升级限制，再附完整 Release 链接。重跑保留草稿人工编辑；正文修正须在更新清单汇总前完成，生成后再改正文不会同步 `latest.json`，公开后不替换既有资产。

失败恢复按是否需要源码变化处理：无须改代码时重跑失败任务；须改代码时使用新版本和新 tag。历史重复草稿先备份元数据，按资产 ID 下载并校验哈希，归并到一个草稿且保留上传标签，核对后删除重复草稿并重跑汇总。已公开版本不能靠重跑替换资产。

## 发布检查清单

打 tag 前按适用目标执行，在 Release / 发布 issue 留下版本、commit、平台、产物哈希、检查证据及支持 / 恢复负责人；不适用项说明理由，未验收目标不标记可交付。

- [ ] 从 `develop` 创建 `release/x.y.z`，同步版本，审查上一正式版以来提交范围；`pnpm verify`、目标 Rust 检查和发布 CI 通过。
- [ ] 按 [安装验收](./testing.md#安装版与启动验收) 在干净目标环境检查图标、启动、重复启动、窗口、外链及 IPC；签名 / 公证、macOS JIT 和未测平台如实记录。
- [ ] 验证派生 scheme / 后缀、安装版深链和文件关联冷 / 热启动，以及适用通知、快捷键、凭据、自启动和卸载残留。
- [ ] 启用更新时，旧版到新版实际发现、下载、验签、保存各窗口工作并完成安装；数据变更按 [恢复验证](./testing.md#数据与恢复验证) 留存历史版本、失败与恢复演练结果。
- [ ] 发布 PR 摘要完整、升级限制明确，已预览 PR 清单；未将 CI 通过写成完整安装 / 升级实测。
- [ ] 发布 PR 合入 `main`，确认验收后在对应提交打 `vX.Y.Z`，再通过回流 PR 同步 `develop`，见 [Git 发布流程](./conventions/git-workflow.md#发布流程)。
- [ ] 全部必要 job 成功自动公开后，核对公开版本、平台资产、哈希、签名、更新清单与 Latest 状态，并向使用方同步说明。

## 发布后观察

负责人核对公开下载与更新源实际可用、哈希 / 签名与验收包一致，并在目标平台走通入口；根据启动、白屏、数据和安装升级反馈决定是否暂停推荐问题版本，记录观察范围，不能以“没有反馈”认定无故障。

当前仅有本地日志与诊断，没有遥测上传、自动告警、远程关闭或分阶段放量。维护者提供真实支持渠道，收集日志时说明范围并脱敏；新增监控或通道另行设计隐私和控制。

阻断故障先确认版本与数据状态，暂停推荐问题包并保留原产物 / 哈希。改更新源只影响后续请求，不能撤销已下载安装器或恢复数据；处理决定与行动项见 [故障反馈](./engineering-at-scale.md#性能发布与故障反馈)。

## 回滚

- 应用代码恢复后以更高版本发布，沿用正常升级。把清单指向旧版不触发默认更新；自动降级需另设 Rust 版本比较并处理安装器限制，否则由用户手动重装。
- 代码使用 `git revert` 后重新发版，不强推既有 tag。
- 数据迁移须预先设计兼容与恢复，不以降级删表或直接安装旧二进制恢复；未来 schema 拒写不保证旧程序能读新数据。

数据变更发布前按 [数据与恢复验证](./testing.md#数据与恢复验证) 用隔离旧版本数据演练升级、迁移失败和修复版恢复，核对记录、回收站与草稿。正常运行用逻辑备份，启动失败用隔离恢复入口验证备份、暂存替换并重启；保留安全备份和原件归档，记录负责人、范围与可能丢失内容。逻辑备份不含设置、凭据、日志或外部文件，功能存在不等于目标平台已验收。
