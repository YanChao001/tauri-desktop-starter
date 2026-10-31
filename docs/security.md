# 安全规范

本文定义 IPC、权限、内容、更新和本地数据的安全边界。按外部输入能够触及的资源选择校验与验证；局部改动的检查范围见 [日常验证](./testing.md#日常验证范围)。桌面代码以当前用户运行，目录、窗口和插件隔离不能抵御同账户恶意进程；前端代码和随包配置均为公开内容。

## 攻击面

| 面             | 主要风险                             | 防线                                                   |
| -------------- | ------------------------------------ | ------------------------------------------------------ |
| WebView 内容   | XSS 后调用 IPC、内容注入             | CSP、安全渲染、外链与插件界面隔离                      |
| IPC 与能力声明 | 路径穿越、命令注入、权限过大         | Rust 边界校验、最小 capability、受控资源 ID            |
| 依赖与更新     | 供应链投毒、安装包替换               | 锁文件、来源审查、审计、HTTPS 与版本绑定签名           |
| 本地数据       | 明文秘密、并发覆盖、损坏             | 系统 keyring、revision、事务、备份与未来版本拒写       |
| 扩展与桌面服务 | 不可信模块、资源耗尽、网络和资源越权 | 有界 worker、显式授权、来源 broker、身份与生命周期复核 |

## 能力最小化

[`src-tauri/capabilities/`](../src-tauri/capabilities/) 是 Tauri 核心与插件命令的白名单，未授予的插件能力默认拒绝。**它不是所有自定义 Rust 命令的 ACL**：本项目未启用应用命令 ACL，`bindings.rs` 注册的命令由 Rust 各入口校验。更新、退出 / 重启、自启动、演示凭据、全局快捷键及恢复管理只接受主 / 次窗口；扩展宿主可读取恢复状态供启动门禁使用。其他命令按各自身份与授权规则处理，不能据此推断已有全面窗口 ACL。需要应用命令 ACL 时，按 [Tauri 应用命令权限](https://v2.tauri.app/security/capabilities/) 配置并验证。

主 / 次窗口使用 [`default.json`](../src-tauri/capabilities/default.json)，可信扩展宿主窗口使用 [`extensions.json`](../src-tauri/capabilities/extensions.json)，均未授予远程页面 capability。精确插件权限直接查配置；通知授权、剪贴板读写和外链由用户操作触发。

文件、数据库、更新、凭据、自启动、快捷键与 worker 通过 Rust 服务暴露受控操作，前端不获得通用文件、Shell、SQL 或 updater 接口。HTTP 演示只允许主 / 次窗口访问固定 HTTPS 来源，限制重定向、请求头、体积、超时与按窗口取消，见 [`demo_http.rs`](../src-tauri/src/demo_http.rs)。注册插件和 Rust 直接调用插件均不免除服务层的校验责任。

视频选择由原生对话框授权，媒体协议仅向主 / 次窗口提供应用管理的副本；扩展界面和远程页面不能据此读取本机文件。

权限变更在同一 PR 说明用途、窗口范围与验证结果，使用具体能力并删除闲置授权。展示外部内容的窗口独立分配权限，保留可信宿主与内容的边界。

宿主网络设置仅选择后续原生 HTTP 的直连 / 系统代理传输，来源、方法、TLS、签名和 DNS 校验仍生效；浏览器 fetch、WebView WSS、系统浏览器与 LAN 不受它控制。扩展代理与环回分别授权，见 [来源与授权](./extensions.md#来源与授权)。

扩展授权属于可信本地前端流程，不能抵御已被控制的 WebView。变更涉及以下边界时，按 [扩展指南](./extensions.md) 的对应契约核对：

- 安装与执行：包完整性、市场验签 / 防回退、来源收据与运行身份共同约束执行；升级仅在同可信来源且权限 / 网络范围完全相同时继承授权。Wasm worker 有界，取消不回滚副作用。见 [安装与体验](./extensions.md#安装与体验)、[执行与生命周期](./extensions.md#执行存储与生命周期)、[官方市场](./extensions.md#官方插件市场)。
- 原生服务：网络来源 / 方法、代理、环回和图片网络分别授权，凭据只向匹配来源注入；资源绑定安装身份与窗口，撤权 / 替换等待已开始操作。见 [网络与私有数据](./extensions.md#网络凭据与私有数据)、[受控桌面服务](./extensions.md#受控桌面服务)、[图片资源](./extensions.md#壁纸图库与图片搜索)。
- 内容隔离：自定义界面运行在无同源权限的 sandbox frame，使用独立 CSP 与有限桥；自身窗口能力仅作用当前插件窗口。见 [自定义界面](./extensions.md#自定义界面)、[插件自身窗口](./extensions.md#插件自身窗口)。
- 数据与连接：插件 KV 保留配额、CAS 和未来存档拒写；LAN 消息、附件与历史未加密、无账户认证，节点 ID 不证明身份。恢复归档不继承授权，见 [局域网通信](./extensions.md#局域网通信)、[旧扩展恢复](./extensions.md#旧开发版告警与恢复)。

测试 WebDriver 仅由可选 `e2e` feature 和测试 overlay 启用，正式配置不注册测试服务；测试身份、数据与桌面隔离见 [真实桌面 E2E](./testing.md#真实桌面-e2e)。

## CSP

生产规则以 [`tauri.conf.json > app.security`](../src-tauri/tauri.conf.json) 为准；新增资源时只放行实际来源，并验证涉及的生产资源类型。

- `style-src 'unsafe-inline'` 用于 Radix 浮层定位，脚本仍只允许本地来源。
- `connect-src` 保留 Tauri IPC 与演示 HTTPS / WSS 来源。浏览器同源策略、桌面 CSP 与原生 HTTP 命令的来源校验各自生效，不能互代。
- `devCsp: null` 回退生产 `csp`，适用于 Tauri 提供的本地应用资源；Windows 地址可能为 `http://tauri.localhost`。`app:dev` 从 Vite 加载，开发能运行不能证明正式包 CSP 正确；改用本地 `dist` 或接入新开发资源时重新验证，不预先放开 HMR 端口。
- 本地图片使用同源资源、`data:` / `blob:`，视频另有专用媒体协议；仅为授权附件构造固定 MIME 并释放 object URL。Markdown 使用安全渲染，原始 HTML、远端图片和危险协议不作为内容能力开放。
- 对象嵌入、基础 URL 改写、表单导航和被外部页面嵌入均关闭。扩展 frame 使用独立 CSP，专用来源不授予远程页面 Tauri API。

CSP 变更后检查生产构建启动、导航及受影响资源；白屏或资源缺失先查控制台拦截，按实际来源修正规则。

## 入参校验

前端及外部存档均不可信。生成绑定提供编译期类型，Rust 提交边界按 [实际风险](./conventions/code-style.md#约束与复杂度) 校验身份、格式与资源预算；规则须对应越权、损坏、资源耗尽或业务约束，展示名称和等价 JSON 排版不因此需要额外白名单。

- 文件授权：自有数据使用固定目录和受控 ID；外部文件由原生选择、拖入或关联授权，后续 IPC 接收资源 ID。按规范路径组件检查归属，处理链接、特殊文件与打开后替换风险；字符串前缀不能建立文件边界。[工作台](../src-tauri/src/workbench.rs) 重开核对路径、遍历不跟随链接，并用磁盘 revision 保留外部冲突；检查与替换仍有竞态窗口。
- 存档与媒体：设置使用 revision CAS，笔记使用参数化查询与版本检查；背景 / 封面为有界重绘栅格，视频为受控内容 ID 与固定 MIME，不接收任意路径或 URL。视频导入校验文件并由 WebView 实际解码；协议复核窗口、ID 与归属，使用有界 Range 读取。清理仅针对确定无引用的应用副本，未来 / 损坏存档或引用读取失败时拒绝清理，保留原始文件。见 [数据存储](./architecture.md#数据存储)、[`wallpaper_video.rs`](../src-tauri/src/wallpaper_video.rs)。
- 执行与资源：任务保留队列、深度、文件数和哈希预算；仅启动自身固定 worker，系统进程调用使用参数数组，用户文本不拼成 Shell 命令。页面卸载或停止等待不代表 worker 已停止。
- 外部入口与导出：深链 / 文件关联只处理 [品牌配置](../app.config.json) 的 scheme、后缀和路由；CSV 解析与导出有界，文本防公式解释。搜索和差异比较不扩大授权，也不替代磁盘 / 数据库版本校验，见 [数据工作流](./demo-modules.md#数据工作流与冲突比较)。

命令使用 `NativeResult<T>` 与 `NativeError` 稳定错误码；内部细节只进脱敏日志，前端不解析错误文本。外部备份导入与内部安全快照的额度分别定义，见 [数据存储](./architecture.md#数据存储)。

## 虚拟会话内部接口

当前虚拟会话示例只有可信 Rust 调用方，没有桌面 IPC、插件能力或外部资源授权。模拟发送只提交会话事件，内部 token 只标识会话 / 连接。开放原生服务时再评审资源授权、写入仲裁和撤权；当前契约见 [虚拟会话指南](./device-workbench.md)。

记录摘要只检测损坏，不认证来源、加密原始正文或赋予设备权限。未知格式拒绝；显式前缀恢复不改原件，状态和有效偏移不表示记录完整。只读回放没有连接 token 或真实发送回调，历史 TX 不重新执行。

无头 CLI 仅访问显式输入／输出参数，不读取应用用户数据目录；输出以排他创建保护既有文件，输入检查普通文件与末级链接／Windows 重解析点。调用者选择的祖先路径不构成托管目录授权或同账户进程沙箱。录制内容可能敏感，Unix 新文件使用 `0600`，Windows 沿用目标目录 ACL；不将 raw 内容写入诊断日志。

## 密钥与证书

- 构建签名证书、更新私钥和服务 API Key 通过环境变量或 CI Secrets 注入；运行时用户凭据使用系统 keyring，不存 localStorage、普通 JSON 或 SQLite。
- 不提交真实 `.env`。忽略范围见 [`.gitignore`](../.gitignore)，仅允许不含凭据的 `.env.example`；忽略规则不保护已跟踪文件，误提交须撤销或轮换并评估产物。
- 更新私钥生成后离线备份两份。正常换钥先用旧密钥签发包含新公钥的过渡版本，或手动安装可信版本；只换服务器公钥不能迁移旧客户端。
- 本机私钥和口令副本存仓库外并限制读取。Windows DPAPI 副本绑定账户与机器，不能代替离线备份；迁移 / 重装前通过可信密码管理器或离线介质备份，明文不得进入日志、Git 或聊天。

发布工作流的 Action 固定到上游提交 SHA，由 Dependabot 通过 PR 维护。更新私钥只注入发布配置校验与 Tauri 构建步骤，不写入后续步骤共享的环境；Apple 证书只在 macOS job 临近构建时注入，并在结束后清空。各 job 明确声明权限；当前构建 job 同时上传草稿 Release 资产，因此仍需要 `contents: write`，不能仅改成只读而保留上传行为。

## 依赖审计

```sh
pnpm audit
pnpm --dir examples/extensions audit
cargo audit --file src-tauri/Cargo.lock # 先 cargo install cargo-audit --locked
cargo audit --file examples/extensions/apps/Cargo.lock
cargo audit --file examples/extensions/rust/Cargo.lock
```

镜像无 audit 端点时可用 `pnpm audit --registry https://registry.npmjs.org`。请求失败表示未完成审计；`cargo audit` 信息告警可能不影响退出码，须同时看输出与 advisory。

提交 `pnpm-lock.yaml` 与 `Cargo.lock`；系统工具链和外部构建工具另行控制。[审计 CI](../.github/workflows/audit.yml) 每周一和手动触发，覆盖宿主与本仓库扩展示例的独立 npm / Rust 锁文件；单项失败仍检查其余锁文件，最后汇总失败状态。该工作流不包含市场子模块，其依赖需在独立仓库另行审计。本地命令用于复查与修复验证。新增依赖按 [评审标准](./development.md#新增依赖的评审标准)；高危优先升级，暂不能升级时记录原因与缓解措施。

[`pnpm-workspace.yaml`](../pnpm-workspace.yaml) 为 WDIO 传递依赖设置 scoped overrides；调整时核对上游范围和审计结果，影响驱动运行时按 [真实桌面 E2E](./testing.md#真实桌面-e2e) 验证。

### 已记录的间接依赖告警

以下记录上游处理路径，不代表最新联网审计；当前版本与依赖链以锁文件 / `cargo tree` 为准，修复后移除对应条目。

- Tauri / GTK：`glib` 的 [VariantStrIter 内存安全公告](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) 需跟踪兼容升级，业务未直接调用不足以排除风险；`proc-macro-error` [停止维护](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)，随 GTK 宏链路迁移。
- opener / single-instance → zbus：`zvariant`、`zvariant_derive`、`zbus_names` 的 [0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html)、[0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html)、[0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html) 为停止独立维护公告，跟踪插件迁移，避免强行跨主版本替换 GUI / DBus 依赖。
- Specta：`paste` [停止维护](https://rustsec.org/advisories/RUSTSEC-2024-0436.html)，跟踪兼容迁移。

### Wasmtime 缓存依赖补丁

宿主在 [`Cargo.toml`](../src-tauri/Cargo.toml) 定向替换 Wasmtime 缓存 crate，提高压缩依赖下限以修复下列公告；来源、最小差异、特性、许可证、验证与撤销条件由 [补丁说明](../src-tauri/vendor/wasmtime-internal-cache/README.md) 维护。

版本下限对应 [RUSTSEC-2026-0391](https://rustsec.org/advisories/RUSTSEC-2026-0391.html)、[0398](https://rustsec.org/advisories/RUSTSEC-2026-0398.html)、[0403](https://rustsec.org/advisories/RUSTSEC-2026-0403.html) 及 [`zstd-safe` 的相关 `unsound` 公告](https://rustsec.org/packages/zstd-safe.html)所列修复范围。使用修复版本后仍执行联网审计并检查全部输出，不由这组修复推断其他告警已解决。

`.with_cache_disabled()` 仅关闭运行时磁盘缓存，不能从依赖图移除压缩库。修改补丁时执行来源说明中的检查；正式上游配套可用后按撤销条件移除补丁。

## 更新通道

配置、签名和安装操作见 [自动更新](./build-release.md#自动更新)。安全边界如下：

- 默认策略编译自 `app.config.json`，前端不能传任意更新 URL。端点须 HTTPS、无凭据 / fragment，原生客户端拒绝 HTTP 降级；CSP 不限制 Rust 请求。
- 端点或公钥任一为空时禁用且不联网；启用后强制校验包签名及被签版本，不跳过验签或接受版本漂移。只接受 Tauri v2 原生更新格式，关闭旧 ZIP 兼容路径；最终字节签名后不得再改。
- `appConfigDir/deployment.json` 的 `updates.endpoint` 可覆盖镜像地址，空端点禁用更新；过大、不可读或无效时报错。退出协商及扩展停止等待结束后、实际安装前再次重读策略，发生变化须重新检查，不能沿用等待前的校验结果。
- 验签公钥固定在编译期品牌配置中。部署文件可省略 `publicKey`；若提供，必须与内置值完全相同，否则拒绝检查和安装。它不能为未内置公钥的客户端启用更新，也不能用来换钥；换钥须发布可信过渡版本或手动安装，取舍见 [ADR 0020](./adr/0020-pin-updater-trust-root.md)。此约束避免普通配置回写改变信任根，不提供同账户恶意进程或被替换应用二进制的系统级防护。
- 公钥可提交，私钥仅用于构建 / CI，不进入品牌配置、部署文件或诊断。派生初始化会清理不再适用的模板信任，规则见 [初始化流程](./development.md#项目初始化)。

## 本地数据

位置与备份范围见 [数据存储](./architecture.md#数据存储)。偏好、SQLite、备份、工作台历史 / 报告、插件 KV、LAN 历史和日志均未加密；凭据演示仅使用 keyring 固定项，E2E 禁用。读取的凭据会进入界面内存，系统服务不可用时报错；本地会话示例不实现 OAuth、远程认证或真实令牌刷新。

Unix 上笔记数据库以 `0600` 创建，打开已有存档时收紧数据库及现存 WAL / SHM 权限；新建 SQLite sidecar 继承数据库权限。Windows 沿用应用数据目录的账户 ACL。扩展读取除路径检查外还拒绝末级链接并检查打开的文件句柄；这不等于持有所有祖先目录句柄，不能承诺抵御同账户进程并发替换整个目录树。

偏好保留原子写入与 revision；临时文件在 `appCacheDir` 按任务隔离，由创建者定义清理时机。重置偏好不等于清理用户数据，外部文件授权不等于磁盘隔离。

设置 / 数据库遇未来 schema 拒写，读写、迁移或备份失败时保留原件，不以删数据修复。导入在 Rust 校验格式、标识、重复与额度；恢复先保存完整安全备份，再事务替换并使旧编辑版本失效。启动替换须确认、受控文件名、归档和恢复日志，中断回滚或保留证据，见 [恢复流程](./architecture.md#恢复诊断与更新)。

逻辑备份含完整笔记 / 草稿，导出后仍须保护；未来版本拒写、事务和退出协商不能代替备份副本保管、故障演练或安装验收。

## 日志

日志不记录令牌、完整请求体或路径中的用户名，新增敏感字段在写入处处理。生产构建默认不输出调试日志；目录、轮换与时间戳见 [日志排障](./troubleshooting.md#先看日志)。stderr、轮换文件与诊断使用基础脱敏，诊断仅预览有限近期日志，前端异常记录有限流。复制、导出或反馈前复核内容，脱敏器不能保证过滤所有业务数据。

## 漏洞上报

按根目录 [SECURITY.md](../SECURITY.md) 使用私密渠道，不在公开 issue 披露细节、凭据或用户数据。
