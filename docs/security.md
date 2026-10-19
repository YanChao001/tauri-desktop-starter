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

`src-tauri/capabilities/default.json` 是 Tauri 核心与插件命令的**白名单**，未授予的能力默认拒绝。

自定义 Rust 命令另有规则：本项目没有启用应用命令 ACL，`generate_handler!` 注册的 `greet` 默认可由本地应用前端调用。需要按窗口限制自定义命令时，先通过 `tauri_build::AppManifest::commands` 定义应用 ACL，再声明权限并分配到 capability。入参校验始终放在命令内部。

完整权限列表以 [`default.json`](../src-tauri/capabilities/default.json) 为准：主窗口只获得所需窗口操作、应用信息和 `http(s)` 外链能力。窗口状态由 Rust 插件自动管理，无需把插件的前端保存 / 恢复 API 一并授权。自定义命令规则参考 [Tauri 应用命令权限](https://v2.tauri.app/security/capabilities/)。

规则：

- 一个权限一个理由。加之前先问：不加会怎样？能不能在 Rust 侧代劳？
- 不要用 `core:all` 或通配符图省事。
- 按窗口分配权限。如果以后加了「预览窗口」展示外部内容，它不应该有文件系统权限。
- 每季度复查一次，删掉不再需要的权限。

## CSP

生产规则在 [`tauri.conf.json > app.security`](../src-tauri/tauri.conf.json)，限制脚本、字体、图片与网络来源；新增资源来源时在同一提交调整并验证。

说明：

- `style-src 'unsafe-inline'` 是必需的：Radix 的浮层组件通过 `style` 属性做定位。
- `connect-src` 里保留 `ipc:` 与 `http://ipc.localhost`，否则 `invoke` 会被拦。
- `devCsp: null` 的准确含义：开发构建里 **回退到上面的生产 `csp`**（Tauri 源码 `AppManager::csp()`），不是「开发模式没有 CSP」。开发者实际感觉不到限制，是因为 `pnpm app:dev` 的页面由 Vite dev server（外部 URL）提供，Tauri 只对 `tauri://` 协议下的 HTML 注入 CSP。
- 改成加载本地 `dist` 时应重新验证 CSP；构建产物本身不使用 Vite HMR。若另行接入开发资源，按实际地址配置 `devCsp`，不要预先放开固定 WebSocket 端口。
- 需要访问外部 API 时，在 `connect-src` 里精确列出域名，不要写 `*`。

改完 CSP 后必须完整跑一遍应用：白屏、图标不显示、字体加载失败，通常都是 CSP 拦的。

## 入参校验

前端传来的任何东西都不可信，即使是你自己写的界面。

现有 [`greet`](../src-tauri/src/commands.rs) 示范了 Rust 边界校验。新增文件命令时优先接收应用内资源标识或限定的相对路径，将允许目录固定到应用数据目录；不要直接暴露整个临时目录或任意绝对路径。

访问已有文件时规范化根目录与目标，再按路径组件检查目标位于根目录中；同时考虑符号链接、检查与打开之间的竞态、文件大小和阻塞 I/O。简单字符串前缀检查不能建立文件访问边界。

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

### 已记录的间接依赖告警

最近核验（2026-10-19）：官方 npm 审计未报告已知漏洞；使用刚刷新的官方 RustSec 数据库（`999ec89`）检查当前 Cargo 锁文件，`cargo-audit 0.22.2` 退出码为 0，仍报告下表 5 项信息告警。退出码为 0 不代表这些告警已消除。

以下是既有审计记录中需要跟踪的上游链路，不能代替对当前锁文件的重新扫描。`cargo audit` 的信息告警可能不影响退出码，审查时同时查看输出与对应 advisory：

| 依赖                                                            | 告警                                                                                                                                                                                                                   | 来源与处理约束                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `glib 0.18`                                                     | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)，`VariantStrIter` 内存安全问题                                                                                                              | Linux 的 Tauri / GTK 间接依赖；需跟踪上游兼容升级，不能用当前应用未直接调用该 API 证明安全                                             |
| `proc-macro-error 1.0.4`                                        | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)，停止维护                                                                                                                                   | 来自 `gtk3-macros` / `glib-macros`，属于构建期依赖，需随 GTK 上游迁移                                                                  |
| `zvariant 5.15.1`、`zvariant_derive 5.15.1`、`zbus_names 4.3.5` | [RUSTSEC-2026-0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html)、[0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html)、[0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html)，停止独立维护 | 来自 `tauri-plugin-opener 2.7.2` 与 `tauri-plugin-single-instance 2.5.4 → zbus 5`；这些库已合入 zbus 6，需由两个插件上游完成主版本迁移 |

项目业务代码未直接使用 `VariantStrIter`，但不能据此认定上游调用链不受影响。Linux 发布前应复核该链路，并跟踪 Tauri/GTK、opener 与 single-instance 的兼容升级；当前保留审计告警，不用忽略列表掩盖，也不强行跨主版本替换 GUI/DBus 依赖。

## 更新通道

- 端点必须 HTTPS。
- `tauri.conf.json` 里的 `pubkey` 与构建时的私钥配对，签名不匹配的包会被拒绝安装。
- 不要把私钥写进 `tauri.conf.json` 或任何会提交的文件。

## 本地数据

| 数据       | 存放                                  | 要求         |
| ---------- | ------------------------------------- | ------------ |
| 用户偏好   | `localStorage`                        | 不含敏感信息 |
| 业务数据   | `appDataDir` 下的 SQLite              | 按用户隔离   |
| 令牌、密码 | 系统钥匙串（按需接入 Rust `keyring`） | 不落明文     |
| 临时文件   | `appCacheDir`                         | 退出时清理   |

当前模板只提供外观偏好重置，不会删除窗口存档、日志或 WebView 数据。接入业务数据后需设计清除入口并说明范围，避免把「重置外观」描述成删除全部用户数据。

## 日志

- 生产构建默认不输出调试日志。
- 日志文件写在 `appLogDir`，单份上限 1 MB、保留 3 份历史归档及当前日志（`lib.rs` 显式配置，不依赖插件默认值），时间为本地时区。
- 提供给用户"导出诊断日志"时，先脱敏（路径、用户名、令牌）。

## 漏洞上报

见根目录 [SECURITY.md](../SECURITY.md)。内部发现的漏洞先走私密渠道，不要开公开 issue。
