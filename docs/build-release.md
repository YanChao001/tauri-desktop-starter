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

没有签名的 exe 会触发 SmartScreen 警告，用户看到"未知发布者"就会放弃安装。两种方案：

| 方案                               | 成本             | 适用                  |
| ---------------------------------- | ---------------- | --------------------- |
| OV/EV 代码签名证书（U 盾或云签名） | 每年数千元       | 对外分发              |
| Azure Trusted Signing              | 按月，需企业资质 | 已在 Azure 生态的团队 |

签名参数不写进 `tauri.conf.json`，而是构建时用 `--config` 合并——指纹与本机环境绑定，提交进仓库只会制造冲突：

```bash
pnpm tauri build --config '{"bundle":{"windows":{"certificateThumbprint":"<THUMBPRINT>","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com"}}}'
```

查本机证书指纹：

```powershell
Get-ChildItem Cert:\CurrentUser\My | Select-Object Subject, Thumbprint
```

CI 由 `release.yml` 自动完成：PFX 转 base64 存入 `WINDOWS_CERTIFICATE`、密码存入
`WINDOWS_CERTIFICATE_PASSWORD`；runner 导入证书后生成同样的 `--config`，构建完再用
`Get-AuthenticodeSignature` 校验签名有效。证书与私钥**绝不进仓库**。

> 签名发生在**打包阶段**：`tauri build --no-bundle`（便携版）不会触发签名。
> 需要签名的便携 exe 请单独执行 `signtool sign /sha1 <指纹> /fd sha256 <exe>`，
> 或改用安装包分发。

> `certificateThumbprint` 方式要求证书能以 PFX 导入 runner。硬件令牌、云 HSM 或
> Azure Trusted Signing 需要改用 `bundle.windows.signCommand` 调用对应的签名工具。

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

| Secret                                                                        | 用途                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`                        | Windows 代码签名（PFX 的 base64 与密码） |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS 签名                               |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`                               | macOS 公证                               |
| `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`            | 自动更新签名（接入 updater 后生效）      |

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
