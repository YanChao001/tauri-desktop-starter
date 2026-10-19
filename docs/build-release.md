# 构建与发布

## 版本号：三个地方必须一致

桌面应用的版本号散落在三个文件里，任何一个不同步都会出问题：

| 文件                        | 字段                | 影响             |
| --------------------------- | ------------------- | ---------------- |
| `package.json`              | `version`           | 前端与 CI        |
| `src-tauri/tauri.conf.json` | `version`           | 安装包、更新检查 |
| `src-tauri/Cargo.toml`      | `[package] version` | 二进制元信息     |

用脚本一次改完，不要手改：

```bash
pnpm version:set 1.2.0
```

脚本会校验语义化版本格式，并同时写入上述三个文件；`Cargo.lock` 里的自身条目也会一并更新。

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

当前工程实测（Windows x64，release）：exe 3.4MB，MSI 1.9MB，NSIS 1.4MB。

## 代码签名

### Windows

没有签名的 exe 会触发 SmartScreen 警告，用户看到"未知发布者"就会放弃安装。两种方案：

| 方案                               | 成本             | 适用                  |
| ---------------------------------- | ---------------- | --------------------- |
| OV/EV 代码签名证书（U 盾或云签名） | 每年数千元       | 对外分发              |
| Azure Trusted Signing              | 按月，需企业资质 | 已在 Azure 生态的团队 |

配置在 `tauri.conf.json` 的 `bundle.windows.certificateThumbprint` + `digestAlgorithm` + `timestampUrl`，
证书通过环境变量或 CI secret 注入，**绝不进仓库**。

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

**签名密钥一律走 GitHub Secrets。** 需要哪几个 secrets，写在 workflow 顶部的注释里；
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
