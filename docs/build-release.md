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

脚本会校验语义化版本格式，并同时写入上面四处。

> 版本号是**用户可见的契约**：自动更新靠它判断新旧，降级安装会被拒绝。已经发布过的版本号不要复用。

## 构建

```bash
pnpm app:build
```

产物在 `src-tauri/target/release/bundle/`：

| 平台    | 产物                               | 说明                               |
| ------- | ---------------------------------- | ---------------------------------- |
| Windows | `nsis/*.exe`                       | 推荐分发，无需管理员权限，体积最小 |
| Windows | `msi/*.msi`                        | 企业内网分发用，可走组策略         |
| macOS   | `dmg/*.dmg`、`macos/*.app`         |                                    |
| Linux   | `deb/*.deb`、`appimage/*.AppImage` |                                    |

只出某一个格式：

```bash
pnpm tauri build --bundles nsis
```

当前工程实测值（Windows x64，release）见 [README 的构建产物一节](../README.md#构建产物)。

### 便携版（免安装）

Windows 没有 portable 打包目标。用 `--no-bundle` 出单文件 exe，再收集到 `dist-portable/`：

```bash
pnpm app:portable              # 构建 + 收集
pnpm app:portable --skip-build # 复用已有 release 产物
```

产物包含 exe 与一份 `使用说明.txt`，压缩后即可分发。适用前提与限制：

- 目标机器需要 WebView2 运行时（Win11 自带；老 Win10 缺失时按说明安装）。
- 窗口位置、日志仍写入当前用户的 AppData，不随 exe 移动；要做"绿色版"需自行改路径。
- 未签名的 exe 会触发 SmartScreen，对外分发仍要按上文配置代码签名。
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
- 页脚文字来自 `bundle.copyright`；留空时 NSIS 会回退成 "Nullsoft Install System vX"。
- 安装语言由 `nsis.languages` 决定，中文系统会命中 `SimpChinese`；MSI 界面语言由 `wix.language` 控制（当前 `zh-CN`）。
- 模板自带 `src-tauri/installer/installer.nsi`（基于 tauri-cli 2.12.3 的官方模板）。欢迎页/完成页的文案与配色在文件里的 `CUSTOM BRANDING` 标记之间，按语言分别定义：
  - 在 `MUI_LANGUAGE` 之后用 `LangString` 覆盖 MUI 默认文案，后定义生效；编译时会出现 `LangString set multiple times ... wasting space` 警告，属预期，不影响产物。
  - 新增安装语言时，为它补一段 `LangString`，否则回落到 NSIS 自带翻译。
- **升级 Tauri 后**：官方 NSIS 模板可能新增变量或修正逻辑。按同版本源码重新复制 `installer.nsi`，再把 `CUSTOM BRANDING` 两段合并回去，不要整份沿用旧模板。MSI 同理，对应 `wix.template`。

## 代码签名

### Windows

没有签名的 exe 会触发 SmartScreen「未知发布者」，多数用户看到蓝色拦截页就放弃了。先记住 2023 年后的硬规则：

> CA/Browser Forum 要求代码签名私钥必须存放在 FIPS 140-2 L2 / CC EAL4+ 硬件（USB Token 或云 HSM）中，
> **新证书不能再导出 PFX 交给 CI**。2026 年 3 月起证书最长有效期 460 天。
> 网上大量「导出 PFX → base64 塞 secret」的教程，只适用于 2023-06-01 之前签发、仍可导出的老证书。

三条可落地的路线：

| 路线                                         | 成本         | CI 友好                       | 用户看到的发布者    | 适用                             |
| -------------------------------------------- | ------------ | ----------------------------- | ------------------- | -------------------------------- |
| SignPath Foundation                          | 免费（开源） | ✅                            | SignPath Foundation | 公开开源项目                     |
| Azure Artifact Signing（原 Trusted Signing） | $9.99/月起   | ✅                            | 你的组织名          | 组织在 US/CA/EU/UK；个人仅 US/CA |
| OV / EV 证书 + USB Token                     | ¥1k–3k / 年  | ⚠️ 需自托管 runner 或云签服务 | 你的公司名          | 必须用自己的发布者名称           |

#### 路线 A：SignPath Foundation（开源免费）

仓库侧已经接好，剩下的是 SignPath 的申请与参数配置。

**前置条件**（SignPath 硬性要求）：

- 项目公开、使用 OSI 许可（本项目 MIT）、**已经发布过至少一个版本**；
- SignPath 与 GitHub 账号都启用 MFA；
- 仓库里有签名策略页：[code-signing-policy.md](./code-signing-policy.md)（README 已链接）。

**申请**：

1. 打开 <https://signpath.org/>，用 GitHub 登录并提交 OSS 申请（仓库 URL、许可证、用途、构建方式）；
2. 审核通常几天到两周，通过后拿到组织与项目。

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

**发版**：打 tag 后，`release.yml` 的 `build` job 产出 draft Release；随后 `sign-windows` job 自动
下载安装包 → 上传 artifact → 提交签名请求（到 SignPath 门户点批准）→ 校验签名 → 覆盖 draft 资产。
未配置 `SIGNPATH_ORGANIZATION_ID` 时该 job 直接跳过，现有发布流程不受影响。

**限制**：

- 发布者显示 "SignPath Foundation"，不是你的名字；
- 每次发版要在 SignPath 门户人工批准一次；
- 只签 NSIS 安装包外层，安装后的应用 exe 不带签名；内外层都要签需改用 MSI + 深签名配置。

#### 路线 B：Azure Artifact Signing（原名 Trusted Signing）

微软的托管签名服务，私钥在 Azure HSM 中，CI 直接调用，不需要任何硬件：

1. 在 Azure 创建 Artifact Signing 账户与证书配置文件（Certificate Profile）；
2. 创建 App Registration，授予 **Key Vault Certificate User** 与 **Key Vault Crypto User** 角色；
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

#### 遗留 PFX 流程（仅 2023-06-01 前的老证书）

证书仍可导出 PFX 时，签名参数不要写进 `tauri.conf.json`，用 `--config` 在构建时合并：

```bash
pnpm tauri build --config '{"bundle":{"windows":{"certificateThumbprint":"<THUMBPRINT>","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com"}}}'
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

可以。开源模板、内测包完全能先不签，代价是用户要点「更多信息 → 仍要运行」。
不要为此买 EV：2024 年后 EV 也不再即时消除警告。

### macOS

必须同时做签名和公证（notarization），否则用户首次打开会被 Gatekeeper 拦截。

```bash
export APPLE_CERTIFICATE="<base64 的 .p12>"
export APPLE_CERTIFICATE_PASSWORD="<密码>"
export APPLE_SIGNING_IDENTITY="Developer ID Application: 公司名 (TEAMID)"
export APPLE_ID="<Apple ID>"
export APPLE_PASSWORD="<App 专用密码>"
export APPLE_TEAM_ID="<Team ID>"

pnpm app:build
```

Tauri 会自动完成签名 + 公证 + stable 打包。

### Linux

一般不做签名。走 AppImage 分发时建议同时提供 `.deb`，并在 README 里给出校验和。

## 自动更新

### 接入步骤

```bash
pnpm tauri add updater
```

1. 生成签名密钥对（**私钥必须离线保存**，丢了就无法给老版本推更新）：

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

4. `bundle.createUpdaterArtifacts` 设为 `true`，构建会额外产出 `.sig` 与 `latest.json`。

5. 前端调用检查更新：

```ts
import { check } from "@tauri-apps/plugin-updater";

const update = await check();
if (update?.available) {
  await update.downloadAndInstall();
}
```

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
出正式包由 `.github/workflows/release.yml` 负责，打 tag 触发，矩阵覆盖：

| 平台            | 产物           |
| --------------- | -------------- |
| Windows x64     | nsis / msi     |
| macOS arm64+x64 | dmg / app      |
| Linux x64       | deb / appimage |

产物以 **draft Release** 上传，人工确认后再发布。

**签名密钥一律走 GitHub Secrets。** 当前流水线识别这些（未配置时自动跳过，产物仍可用）：

| Secret                                                                        | 用途                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`                        | Windows 遗留 PFX（仅 2023-06-01 前签发、可导出的证书）          |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`                 | Azure Artifact Signing（需改用 `signCommand`，见 Windows 一节） |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS 签名                                                      |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`                               | macOS 公证                                                      |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`            | 自动更新签名（接入 updater 后生效）                             |

当前 `release.yml` 只内置了**遗留 PFX** 与 macOS 两条链路；选 Azure 或 SignPath 时，
按 Windows 一节对应的步骤接入（Azure 需要额外安装 CLI 并注入三个环境变量）。

证书和私钥永远不进仓库——进了就当作已泄露，必须吊销重签。

Linux 构建需要先装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

## 发布检查清单

发布前逐项确认，任何一项没过就不发：

- [ ] `develop` 已合并到 `release/x.y.z`，CI 全绿
- [ ] `pnpm version:set x.y.z` 已执行，四处版本号一致
- [ ] `git log v上一版..HEAD --oneline` 过一遍，确认没有漏进版本的提交，也没有不该进的
- [ ] 在干净机器上安装过一次（不是开发机），确认能启动
- [ ] Windows 已签名，SmartScreen 无"未知发布者"
- [ ] macOS 已公证，`spctl -a -vvv -t install <app>` 通过
- [ ] 自动更新链路验证：装旧版本 → 发布新版本 → 能收到并成功升级
- [ ] 卸载后残留检查（用户数据是否按预期保留或清理）
- [ ] 打 tag `vX.Y.Z`，触发 CI 出包并上传 Release
- [ ] `release/*` 已合回 `main` 和 `develop`
- [ ] 发布公告与更新说明同步给使用方

## 回滚

- **应用级**：把 `latest.json` 的 `version` 改回上一个版本并重新指向旧安装包。
  注意 Tauri 默认不允许降级，需要在代码里显式放开 `allowDowngrades`，或让用户手动重装。
- **代码级**：`git revert` 对应合并节点后重新发版，不要强推 tag。
- **数据级**：涉及数据库结构变更的版本，必须提前设计向前兼容的迁移，不做"降级删表"。
