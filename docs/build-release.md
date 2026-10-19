# 构建与发布

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

脚本先读取并校验所有版本文件，再同时更新上面四处；Cargo 包名与 npm 包名不同也会正确定位自身锁文件条目。`pnpm version:check` 检查四处版本一致，CI 和发布流程都会执行。

当前包含 MSI，版本须满足 major ≤ 255、minor ≤ 255、patch ≤ 65535。预发布标识或构建元数据若用于 MSI 第四段，必须为 ≤ 65535 的整数；使用 `beta.1` 等文本时，需要显式配置 `bundle.windows.wix.version` 或仅构建 NSIS。非法版本在写入前就会被拒绝。

版本校验依据项目配置执行；若选择仅构建 NSIS 来使用文本预发布，需先在配置中移除 MSI 目标，仅传 `--bundles nsis` 不会改变版本校验依据。

> 版本号是**用户可见的契约**：自动更新靠它判断新旧，降级安装会被拒绝。已经发布过的版本号不要复用。

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

只出某一个格式：

```bash
pnpm app:build --bundles nsis
```

Vite 的 `dist/` 与 Cargo 默认 `src-tauri/target/` 是编译中间产物与缓存；直接运行 `pnpm tauri build` 保留 Tauri 原始输出，不执行项目脚本的分发收集。需要交付时使用 `pnpm app:build` 或 `pnpm app:portable`，只清理交付目录使用 `pnpm clean:artifacts`。

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

默认构建沿用 Cargo 编译目录与缓存，支持 `CARGO_TARGET_DIR` 和 Cargo `target-dir`。旧 `dist-portable/` 不再作为输出目录。

便携脚本支持共享的 release 参数，如 `--target` / `-t`、`--config` / `-c`、`--features` / `-f`、`--ci`、`--no-sign` 与 verbose；不接受 `--bundles`。配置合并后版本必须与项目一致，Windows 便携版的编译目标也必须是 Windows。

`--skip-build` 必须通过先前便携构建记录的版本、配置、构建参数与 exe SHA-256 校验；缺少记录或 exe 已被其他打包步骤改写时，需要重新运行不带 `--skip-build` 的便携构建。收据不判断源码是否修改，使用者仍需确认现有 exe 对应准备交付的源码。

产物包含 exe、`使用说明.txt` 与 `manifest.json`，压缩后即可分发。适用前提与限制：

- 目标机器需要 WebView2 运行时（Win11 自带；老 Win10 缺失时按说明安装）。
- 窗口位置、日志仍写入当前用户的 AppData，不随 exe 移动；要做"绿色版"需自行改路径。
- 未签名的 exe 可能触发 SmartScreen，对外分发应按下文配置代码签名；签名也不保证立即获得信誉。
- `--no-bundle` 不经过打包器，**不会**自动签名；需要签名的便携版请对 exe 单独执行 `signtool`。
- Linux 的 AppImage 本身就是便携格式；macOS 用 `.app` 拖拽安装，无需另做便携包。

### 安装器外观

NSIS 与 MSI 的界面元素都在 `src-tauri/installer/`，路径配置在 `tauri.conf.json > bundle.windows`：

| 打包器 | 配置项                 | 尺寸    | 用途                  |
| ------ | ---------------------- | ------- | --------------------- |
| NSIS   | `nsis.headerImage`     | 150×57  | 内页页眉              |
| NSIS   | `nsis.sidebarImage`    | 164×314 | 欢迎页 / 完成页侧栏   |
| NSIS   | `nsis.installerIcon`   | .ico    | 安装器图标            |
| NSIS   | `nsis.uninstallerIcon` | .ico    | 卸载器图标            |
| WiX    | `wix.bannerPath`       | 493×58  | 内页顶部横幅          |
| WiX    | `wix.dialogImagePath`  | 493×312 | 欢迎 / 完成对话框背景 |

要点：

- 位图用 24 位 BMP（不要带 alpha），配色与主界面一致（neutral + indigo 强调色）。
- NSIS 在 125% / 150% 缩放下会整体放大小图，图里不要放小字，否则会发虚。
- **WiX 会在位图之上叠加自己的文字控件**（`WixUI_InstallDir`，dlu→px 为 4/3），画图必须避开：
  - banner（493×58）：标题文字 x 20–287 / y 8–28，描述文字 x 33–406 / y 31–51 ⇒ 图形放右侧（x > 290）或底部条带（y > 52）。
  - dialog（493×312）：标题与描述文字都在右侧 x 180–473 / y 27–187 ⇒ 主视觉放左侧（x < 180）或底部（y > 190）。
  - 压到文字就是"图标错位"。MSI 实测布局可从 WiX 工具集 `WixUIExtension.dll` 内嵌 objects XML 提取。
- 两张 WiX 位图由 `scripts/gen-installer-bitmaps.py` 生成（依赖 `pip install pillow`），改样式后重跑脚本并重新 `pnpm app:build`。
- 页脚文字来自 `bundle.copyright`；留空时 NSIS 会回退成 "Nullsoft Install System vX"。
- 安装语言由 `nsis.languages` 决定，中文系统会命中 `SimpChinese`；MSI 界面语言由 `wix.language` 控制（当前 `zh-CN`）。
- 模板自带 `src-tauri/installer/installer.nsi`，欢迎页 / 完成页的文案与配色在 `CUSTOM BRANDING` 标记之间，使用独立 `LangString` 并通过页面宏引用，不覆盖 NSIS 内置翻译。
  - 新增安装语言时，要为自定义文案补齐对应语言的 `LangString`，并实际编译检查，不能假设自定义键会自动回落到内置翻译。
- **升级 Tauri 后**：对照同版本官方 NSIS 模板合并更新，保留 `CUSTOM BRANDING` 各段的配色、页面宏引用与语言字符串，并复核 WebView2 临时路径、执行引号和文件关联修复是否已被上游覆盖。不要整份沿用旧模板。自定义 MSI 模板同理，对应 `wix.template`。

## 代码签名

### Windows

Windows Authenticode 签名标识发布者并验证文件完整性，不能保证立即消除 SmartScreen 告警。公共信任证书的私钥保护要求、服务地区与价格会变化，购买或配置前以服务商当前政策为准；Tauri 的旧 PFX 教程仅适用于允许导出私钥的旧证书，新签发 OV / EV 应使用签发方支持的硬件或托管流程。参见 [Tauri Windows 签名指南](https://v2.tauri.app/distribute/sign/windows/)。

本仓库提供的接入点：

| 路线                                | 仓库现状                        | 需要完成                                           |
| ----------------------------------- | ------------------------------- | -------------------------------------------------- |
| SignPath Foundation                 | 可选签名 job 已实现             | 申请通过、配置门户与仓库参数、人工审批             |
| Azure Artifact Signing 或证书商 HSM | 未安装 CLI，也未注入 Azure 变量 | 修改 workflow，安装工具，配置 `signCommand` 与凭据 |
| 可导出的 PFX 证书                   | 导入与验证步骤已实现            | 确认证书仍有效且用途符合分发范围，配置 Secrets     |

#### 路线 A：SignPath Foundation（开源免费）

仓库侧已经接好，剩下的是 SignPath 的申请与参数配置。

申请要求以 [SignPath Foundation 条款](https://signpath.org/terms) 为准，主要包括：

- 项目公开、使用 OSI 许可（本项目 MIT）、**已经发布过至少一个版本**；
- SignPath 与 GitHub 账号都启用 MFA；
- 仓库里有签名策略页：[code-signing-policy.md](./code-signing-policy.md)（README 已链接）。

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
未配置 `SIGNPATH_ORGANIZATION_ID` 时该 job 直接跳过，现有发布流程不受影响。

**限制**：

- 发布者显示 "SignPath Foundation"，不是你的名字；
- 每次发版要在 SignPath 门户人工批准一次；
- 当前配置只签 NSIS 安装包外层，安装后的应用 exe 与 MSI 不会被该 job 签名；需要调整嵌套签名范围时，必须同时修改 artifact 配置、产物收集和验证步骤。
- 当前 SignPath 流程不能直接与 `createUpdaterArtifacts` 组合：打包后重签会改变安装包字节，使先前生成的更新签名失效。流水线会拒绝该组合；接入自动更新时，须将更新签名生成移到 Authenticode 签名之后。

#### 路线 B：Azure Artifact Signing（原名 Trusted Signing）

微软的托管签名服务，私钥由托管服务保护；当前仓库尚未接入。实施步骤以 [Tauri 签名指南](https://v2.tauri.app/distribute/sign/windows/) 和 [微软前置条件](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart#prerequisites) 为准：

1. 在 Azure 创建 Artifact Signing 账户与证书配置文件（Certificate Profile）；
2. 创建 App Registration，在证书配置文件范围向它授予 **Artifact Signing Certificate Profile Signer** 角色（见 [微软角色说明](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)）；
3. 安装 CLI：`cargo install artifact-signing-cli`（需要 .NET 8 与较新的 Windows SDK）；
4. 在 `tauri.conf.json` 配置签名命令：

```json
{
  "bundle": {
    "windows": {
      "signCommand": "artifact-signing-cli -e https://wus2.codesigning.azure.net -a <账户名> -c <证书配置文件> -d <产品名> %1"
    }
  }
}
```

5. CI 注入三个环境变量：`AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET`。

`%1` 是 Tauri 传入的待签名文件路径；`-d` 的值会出现在 UAC 提示里，填产品名而不是随机串。
官方参考：<https://v2.tauri.app/distribute/sign/windows/>。

#### 路线 C：OV / EV 证书 + USB Token

需要自己的发布者名称、又不满足 Azure 地区/资质要求时选这条：

- 新证书私钥在 USB Token 或 CA 云 HSM 里，**不能导出 PFX**；
- CI 二选一：自托管 runner 插着 Token 跑；或购买 CA 的云签名服务（SSL.com eSigner、DigiCert KeyLocker、GlobalSign），用 `signCommand` 调它的 CLI；
- EV 自 2024 年起**不再即时绕过 SmartScreen**，和 OV 一样按下载量积累信誉，不必为「秒过」多花钱。

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

#### 先不签名可以吗

可以生成未签名的模板或内测包；Windows 用户可能遇到信誉提示，实际运行行为还受系统与组织策略限制。
不要为此买 EV：2024 年后 EV 也不再即时消除警告。

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

Tauri 会自动完成签名、公证与打包。

### Linux

一般不做签名。走 AppImage 分发时建议同时提供 `.deb`，并在 README 里给出校验和。

## 自动更新

### 接入步骤

```bash
pnpm tauri add updater
```

1. 生成签名密钥对（私钥安全保存并离线备份；CI 用 Secrets 注入，不能提交仓库）：

```bash
pnpm tauri signer generate -w ~/.tauri/myapp.key
```

2. 公钥写进 `tauri.conf.json`：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<公钥内容>",
      "endpoints": [
        "https://example.com/updates/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

3. 构建时设置环境变量：

```bash
export TAURI_SIGNING_PRIVATE_KEY="<私钥内容>"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<私钥密码>"
```

4. `bundle.createUpdaterArtifacts` 设为 `true`，构建会额外产出更新包与 `.sig`；发布流水线中的 `tauri-action` 再汇总生成 `latest.json`，本地 `tauri build` 不生成该清单。

5. 前端调用检查更新：

```ts
import { check } from "@tauri-apps/plugin-updater";

const update = await check();
if (update) {
  await update.downloadAndInstall();
}
```

`check()` 返回更新对象或 `null`，没有 `available` 字段。参见 [Tauri 2 更新插件文档](https://v2.tauri.app/plugin/updater/)。插件导入和调用应封装在 `src/lib/tauri.ts`，页面调用封装函数。

### 更新服务端

最省事的方式是把构建产物和 `latest.json` 一起发到 GitHub Releases，
然后把 `endpoints` 指向 `https://github.com/<org>/<repo>/releases/latest/download/latest.json`。

自建服务端只需要一个静态文件服务，返回如下结构：

```json
{
  "version": "1.2.0",
  "notes": "修复了窗口位置丢失的问题",
  "pub_date": "2026-10-19T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<.sig 文件内容>",
      "url": "https://example.com/downloads/app_1.2.0_x64-setup.exe"
    }
  }
}
```

签名校验失败时更新会被拒绝——这是设计如此，不要试图绕过。

## CI 多平台构建

`.github/workflows/ci.yml` 只做校验（格式、lint、类型、测试、编译）。
出正式包由 `.github/workflows/release.yml` 负责，打 tag 触发。

发布流程先由 `validate` job 执行冻结安装和 `pnpm verify`，通过后才进入各平台构建；PFX 签名验证按配置检查实际启用的 NSIS / MSI 产物，缺失或签名无效会失败。

构建矩阵覆盖：

| 平台            | 产物           |
| --------------- | -------------- |
| Windows x64     | nsis / msi     |
| macOS arm64+x64 | dmg / app      |
| Linux x64       | deb / appimage |

产物以 **draft Release** 上传，人工确认后再发布。

工作流另将 `tauri-action` 本次返回的产物收集到同一套 `artifacts/<version>/<target>/installers/` 结构，生成清单并上传为 `build-installers-<target>`。这是 build 阶段的归档，尚未经过可选的 SignPath 后签名；启用 SignPath 后，签名 job 会重新生成签名文件的清单，上传 `signed-installers-x86_64-pc-windows-msvc` 并覆盖 draft Release 的 NSIS 资产。需要 SignPath 签名包时，使用签名 job 的归档或完成签名后的 Release。

CI 只收集 `tauri-action` 明确返回的文件，不按相邻文件猜测签名或压缩包。macOS 上传 workflow artifact 前，会把已归档的 `installers/` 整体打成 tar 包以保留 `.app` 的执行权限和符号链接；Release 中的应用压缩包仍由 `tauri-action` 生成。

**签名密钥一律走 GitHub Secrets。** 下表区分已接线参数与需要额外实施的参数；未配置签名时仍会生成包，但不代表满足公开分发要求：

| Secret                                                                        | 用途                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`                        | 已接线：允许导出且有效的 Windows PFX，受证书用途与信任范围约束           |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`                 | 未接线：Azure Artifact Signing，需安装 CLI、注入变量并配置 `signCommand` |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS 签名                                                               |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`                               | macOS 公证                                                               |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`            | 自动更新签名（接入 updater 后生效）                                      |

当前 `release.yml` 内置了 **PFX**、macOS 与可选的 SignPath 链路；SignPath 需要配置门户与仓库参数，Azure 需要额外安装 CLI 并注入三个环境变量。

证书和私钥永远不进仓库——进了就当作已泄露，必须吊销重签。

Linux 构建需要先装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

## 发布检查清单

发布前逐项确认，任何一项没过就不发：

- [ ] 已从 `develop` 创建 `release/x.y.z`，检查本次提交范围
- [ ] `pnpm version:set x.y.z` 已执行，四处版本号一致
- [ ] `git log v上一版..HEAD --oneline` 过一遍，确认没有漏进版本的提交，也没有不该进的
- [ ] `pnpm verify` 和目标平台 Rust 检查通过，发布分支 CI 全绿
- [ ] 在目标平台的干净机器上安装并验证启动、窗口操作、外链与 IPC
- [ ] 需要签名的 Windows 分发渠道已检查签名状态与发布者；SignPath 仅覆盖 NSIS 外层
- [ ] 发布 macOS 包时已完成签名、公证，并用 `spctl -a -vvv -t install <app>` 验证
- [ ] 若接入自动更新：验证旧版本能够收到并成功安装新版本
- [ ] 卸载后残留检查（用户数据是否按预期保留或清理）
- [ ] `release/*` 已通过 PR 合入 `main` 和 `develop`，在 `main` 对应合并提交打 tag `vX.Y.Z`
- [ ] 等待发布 workflow 和可选签名 job 全部成功，检查 draft 中版本、平台资产、签名与更新元数据后人工发布
- [ ] 发布公告与更新说明同步给使用方

## 回滚

- **应用级**：推荐把回滚后的代码发布为更高版本，让现有客户端正常升级。
  仅将 `latest.json` 指向较旧版本不会触发默认更新；自动降级需要预先在 Rust 更新器中自定义版本比较，并处理 Windows 安装器的降级限制，否则让用户手动重装。
- **代码级**：`git revert` 对应合并节点后重新发版，不要强推 tag。
- **数据级**：涉及数据库结构变更的版本，必须提前设计向前兼容的迁移，不做"降级删表"。
