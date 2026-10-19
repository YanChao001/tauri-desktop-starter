# 安全规范

> 桌面应用的安全边界和 Web 应用不一样：代码跑在用户机器上，用户能直接看到文件和进程。
> 目标不是"防住用户"，而是**防住被注入的内容、防住供应链、防住自己的疏忽**。

## 攻击面

| 面               | 风险                             | 主要防线                                        |
| ---------------- | -------------------------------- | ----------------------------------------------- |
| WebView 里的内容 | XSS → 拿到 IPC 调用能力          | CSP、不使用 `dangerouslySetInnerHTML`、外链隔离 |
| IPC 命令         | 参数未校验导致路径穿越、命令注入 | Rust 侧校验入参                                 |
| 能力声明         | 权限开太大，前端被攻破即失守     | capabilities 最小化                             |
| 依赖             | 供应链投毒                       | 锁文件、审计、来源审查                          |
| 更新通道         | 中间人替换安装包                 | 签名校验 + HTTPS                                |
| 本地数据         | 明文存储敏感信息                 | 系统钥匙串、按需加密                            |

## 能力最小化

`src-tauri/capabilities/default.json` 是**白名单**，没写的一律调不通。

```json
{
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "opener:allow-open-url",
    "opener:allow-default-urls",
    "window-state:default"
  ]
}
```

规则：

- 一个权限一个理由。加之前先问：不加会怎样？能不能在 Rust 侧代劳？
- 不要用 `core:all` 或通配符图省事。
- 按窗口分配权限。如果以后加了「预览窗口」展示外部内容，它不应该有文件系统权限。
- 每季度复查一次，删掉不再需要的权限。

## CSP

生产 CSP 已内建在 `tauri.conf.json` 中，**模板默认就是收紧状态**，不需要发布前再补：

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost data:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost",
      "devCsp": null
    }
  }
}
```

说明：

- `style-src 'unsafe-inline'` 是必需的：Radix 的浮层组件通过 `style` 属性做定位。
- `connect-src` 里保留 `ipc:` 与 `http://ipc.localhost`，否则 `invoke` 会被拦。
- `devCsp: null` 的准确含义：开发构建里 **回退到上面的生产 `csp`**（Tauri 源码 `AppManager::csp()`），不是「开发模式没有 CSP」。开发者实际感觉不到限制，是因为 `pnpm app:dev` 的页面由 Vite dev server（外部 URL）提供，Tauri 只对 `tauri://` 协议下的 HTML 注入 CSP。
- 因此一旦把 `build.devUrl` 置空、改成在 Tauri 里直接加载 `dist`，生产 CSP 会在开发模式生效：此时 `connect-src` 需要补 `ws://localhost:1421`（HMR），或显式配置 `devCsp`。
- 需要访问外部 API 时，在 `connect-src` 里精确列出域名，不要写 `*`。

改完 CSP 后必须完整跑一遍应用：白屏、图标不显示、字体加载失败，通常都是 CSP 拦的。

## 入参校验

前端传来的任何东西都不可信，即使是你自己写的界面。

```rust
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let root = std::env::temp_dir();
    let target = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("路径无效: {e}"))?;

    // 限制在允许的目录内，防止 ../../ 穿越
    if !target.starts_with(&root) {
        return Err("无权访问该路径".into());
    }

    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}
```

必查项：路径穿越（`..`）、空值、超长字符串、非法字符、数值范围。

**永远不要**把前端传来的字符串拼进 shell 命令。要用就传参数数组，不要拼字符串。

## 密钥与证书

- 代码签名证书、更新私钥、API Key 一律走环境变量或 CI Secrets。
- 仓库里不放 `.env`；`.gitignore` 已包含 `*.local`，新增敏感文件名要同步加进去。
- 更新私钥生成后**离线备份两份**，丢失后老版本无法接收新更新。
- 日志里不打印令牌、路径中的用户名、完整请求体。

## 依赖审计

```bash
pnpm audit
pnpm outdated

cd src-tauri
cargo audit          # 需要先 cargo install cargo-audit
cargo tree -d        # 检查重复依赖
```

> 国内镜像（如 npmmirror）没有实现 npm 的 audit 端点，`pnpm audit` 会报 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。
> 临时指定官方源即可：`pnpm audit --registry https://registry.npmjs.org`。CI 不受影响，runner 默认就是官方源。

- 锁文件（`pnpm-lock.yaml`、`Cargo.lock`）必须提交，保证构建可复现。
- CI 每周一自动跑一遍两个生态的漏洞审计（`.github/workflows/audit.yml`），本节命令用于本地复查与修复验证。
- 新增依赖按 [开发指南](./development.md#新增依赖的评审标准) 的三条标准评估。
- 出现高危漏洞时优先升级；无法升级要记录原因与缓解措施。

## 更新通道

- 端点必须 HTTPS。
- `tauri.conf.json` 里的 `pubkey` 与构建时的私钥配对，签名不匹配的包会被拒绝安装。
- 不要把私钥写进 `tauri.conf.json` 或任何会提交的文件。

## 本地数据

| 数据       | 存放                         | 要求         |
| ---------- | ---------------------------- | ------------ |
| 用户偏好   | `localStorage`               | 不含敏感信息 |
| 业务数据   | `appDataDir` 下的 SQLite     | 按用户隔离   |
| 令牌、密码 | 系统钥匙串（`keyring` 插件） | 不落明文     |
| 临时文件   | `appCacheDir`                | 退出时清理   |

界面里要提供「清除本地数据」入口，并说明清除范围——用户有权知道数据在哪。

## 日志

- 生产构建默认不输出调试日志。
- 日志文件写在 `appLogDir`，单份上限 1 MB、保留最近 3 份（`lib.rs` 显式配置，不依赖插件默认值），时间为本地时区。
- 提供给用户"导出诊断日志"时，先脱敏（路径、用户名、令牌）。

## 漏洞上报

见根目录 [SECURITY.md](../SECURITY.md)。内部发现的漏洞先走私密渠道，不要开公开 issue。
