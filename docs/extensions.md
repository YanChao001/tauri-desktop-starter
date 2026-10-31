# Extism 扩展开发与安装

扩展中心位于 `/extensions`。宿主用 Extism 运行 Rust / JavaScript / TypeScript 编译的 Wasm，提供命令、侧栏、独立窗口、通用视图和隔离 HTML 界面；网络、私有数据与桌面服务均经授权。浏览器演示仅说明限制，安装和运行需要桌面环境。模块分工见 [架构说明](./architecture.md)，长期取舍见 [ADR 索引](./adr/README.md)。

按任务阅读：插件作者从 [包与输入契约](#包与输入契约)、[应用插件](#开发带界面的应用插件) 和 [SDK](../sdk/README.md) 开始；宿主维护者关注 [执行与生命周期](#执行存储与生命周期)、[市场信任](#官方插件市场) 和 [验证](#验证)；派生项目移除宿主能力见 [裁剪指南](./demo-modules.md#实际裁剪模块)。本指南维护协议、授权和预算，SDK 维护界面调用方式，市场的收录 / 发布操作由 [市场文档](../marketplace/docs/README.md) 维护。

“发现插件”统一展示随包的本地工作台与在线插件，共用搜索、分类和安装 / 更新状态；内置项优先并带“内置”徽标。卡片的“…”菜单提供打开、授权、更新、停用、卸载和独立窗口，“详情”展示来源与授权，诊断字段收于“技术信息”。内置目录独立于安装记录及在线市场，断网、刷新失败或卸载不会移除目录；重新安装仍需授权审阅。

本地安装与市场筛选共用紧凑面板，保留开发文档、刷新、搜索和分类；窄屏搜索独占一行，分类与本地安装相邻。本地安装按钮始终使用“本地安装”文字及无障碍名称，并保留格式提示与焦点，方便连续选择文件。“高级设置”首次打开才读取 KV 和凭据状态，关闭保留本页未保存输入，秘密不进入普通存档。

## 架构与兼容范围

当前契约为 **包格式 3、API 2、视图 2、注册表 schema 3**。每条命令独立声明输入、结果、入口和启动所需能力；同一插件可同时提供文本命令与应用视图。宿主复用 Extism ABI，不加载插件原生程序、动态库、Node.js 或远程网页，不兼容 VS Code API。依赖其他应用专用 Host Functions 或界面协议的模块仍需适配；只用标准 Extism 能力的模块可补充清单后调用真实导出。

媒体权限 `network:images`、`network:system-proxy`、`links:open` 任一出现时，Rust 强制 `minHostVersion >= 0.1.6`；其他能力可要求更高版本，以插件清单为准。新增原生能力需重建并重启 Rust 进程。旧宿主可能先因未知字段拒绝包 / 目录，客户端能力随实际二进制交付。

新增插件依赖的宿主能力时，同时提高宿主版本和插件最低宿主版本，按 [版本规则](./build-release.md#版本号四个地方必须一致) 同步并先发布配套宿主。共享版本号的开发快照按配套源码使用；市场 `host_ref` 只选择校验工具源码，客户端兼容和线上状态分别以二进制与实际 Release 为准。

宿主拒绝不支持或损坏的包 / 存档并保留原件；已知旧开发注册表使用 [归档入口](#旧开发版告警与恢复)，未来版或不明损坏保留现场。重装应用保留用户数据。插件负责校验自己的业务状态、动作和数据。

## 旧开发版告警与恢复

“扩展包、API 或存档版本不兼容，原数据已保留”可能来自旧注册表；它在内置包登记前读取，因此更新 Wasm、重编译或重装应用不会解除阻塞。

在扩展中心确认检测结果后选择“归档并重建”。原生仅接受识别出的 schema 1 / 2，核对确认时的原始摘要，并要求无扩展活动、不在恢复隔离、暂停或退出期间。操作将整个 `extensions/` 原子改名到同级唯一归档位置，再初始化当前注册表及默认禁用、无授权的内置工作台；界面显示归档路径。`extension-data/`、系统凭据、设置、笔记和外部文件均不在归档范围。

归档不迁移旧插件，其他插件须重新安装并审阅权限。确认期间原件变化返回冲突；移动失败保留原目录，归档后初始化失败仍保留归档，可重试读取。未来版、损坏、不明结构或目录链接不提供重建按钮；不要在其他进程使用数据时从外部移动目录。

## 安装与体验

首次安装、本地文件导入和来源 / 权限范围变化的升级均需审阅来源与权限后确认；本地包即使与内置包相同也走审阅。“全选”只改变可选权限，未选项目保持拒绝。技术信息展示标识、最低宿主和网络来源；原生继续核验完整性与来源。

**免确认升级**指用户点击更新后完成下载、验证与安装，不再打开第二个审阅窗口；不表示后台自动安装。仅限同一已安装扩展、同一可信来源、更高数字版本，且必需权限、可选权限与网络 origin / 方法集合完全相同的升级，比较忽略排列顺序，不以主 / 次 / 补丁版本号代替授权判断。内置来源须与宿主实际携带的完整清单、Wasm 字节和 UI 文档一致，不能只凭 ID 或模块哈希判断；市场来源须重新验签并匹配仓库与公钥身份。升级保留原启用状态和已授予权限，原先拒绝的可选权限继续拒绝，禁用扩展保持禁用。任一权限增加、删除、必需 / 可选分类改变、网络范围或可信来源改变都重新审阅。决策与取舍见 [ADR 0023](./adr/0023-preserve-extension-upgrade-consent.md)。

原生在注册表锁内重新判断是否可继承授权，缺少确认不等于同意；条件不符返回冲突，不先替换或静默安装为禁用状态。安装仍核对包、revision 和授权，在锁外完成启用前预编译，再复核原 revision 和身份，以一次原子写入提交；编译失败、取消、缺少必需授权或并发冲突均保留原安装与启用状态，不自动重放确认或扩大授权。预览和未启用安装沿用包校验，不额外触发启用预热；包校验可编译核对 ABI 与导出，但不创建业务实例、不执行 Wasm start / 初始化或命令导出。应用视图初始化仍在实际打开时执行。

安装、升级、启用与权限管理共用列表及全选 / 半选行为，提交期间禁用选择；拒绝可选能力仍可使用无关离线功能。刷新保留列表和滚动，审阅关闭后恢复到来源控件或同区域有效焦点。

首次读取列表仅预置 **本地工作台**，默认禁用且无授权，需用户审阅后启用；无需文本、文件、网络或私有存储权限。创意画布、数据透镜和流程编排提供本地即时交互及成果导出；用法、导出额度与会话兼容见 [工作台说明](../examples/extensions/apps/README.md)。启用后从卡片、命令面板或声明的侧栏入口打开；同一独立窗口入口重复打开会聚焦已有窗口，各窗口会话独立。

内置登记只执行一次，不覆盖同 ID 安装，卸载后不自动重装；内置安装与更新由用户在目录卡片或已安装插件菜单中触发，是否审阅遵循上述升级规则。读取目录不执行登记或安装，也不向前端传输完整 Wasm / HTML；实际安装时读取并重新校验完整随包资源。升级要求更高数字版本，保留前一包供显式回退；回退撤销授权并禁用，须重新确认。包内作者为自述，模块 SHA-256 标识内容，市场签名表示维护者发布目录，均不认证包内作者。

禁用、升级、卸载和权限变更撤回入口并请求停止旧调用，实际结束后才释放租约；桌面服务按 [服务生命周期](#受控桌面服务) 协调撤回。卸载删除系统凭据，失败会阻止卸载并保留重试信息；私有 KV 与 LAN 历史保留，同 ID 重装须重新授权。清除 KV 应在卸载前进入“高级设置”确认，清空不结束当前会话，也不清除独立 LAN 历史。

## 包与输入契约

开发工具将 UTF-8 JSON 清单与标准 base64 核心 Wasm 打包。最小文本示例：

```json
{
  "manifest": {
    "formatVersion": 3,
    "apiVersion": 2,
    "minHostVersion": "0.1.4",
    "id": "example.echo",
    "version": "1.0.0",
    "name": "Echo example",
    "author": "Example author",
    "description": "Returns explicitly submitted input",
    "commands": [
      {
        "id": "echo",
        "title": "Echo",
        "function": "echo",
        "inputFormat": "text",
        "resultFormat": "text",
        "permissions": ["text:read"]
      }
    ],
    "permissions": ["text:read"],
    "optionalPermissions": [],
    "network": []
  },
  "wasm": "<standard base64 of the Wasm core module>"
}
```

权威校验位于 [extensions.rs](../src-tauri/src/extensions.rs)：拒绝未知字段；包最多 24 MiB，模块最多 16 MiB，命令 1–32 个且 ID 唯一。插件 ID 为有界小写反向域名，版本和 `minHostVersion` 为三段数字；最低宿主高于当前版本时拒绝。字符 / 长度细则沿用 Rust，不在打包脚本维护第二套规则。

| 声明                                       | 用途                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 命令 `inputFormat`                         | `text` 接收原始 UTF-8；`json` 接收宿主或视图请求                                                           |
| 命令 `resultFormat`                        | `text`、`json`、`markdown` 或声明式 `view`；视图必须配 JSON 输入                                           |
| 命令 `ui`                                  | 声明 `sidebar` / `window` 入口，可用 `document` 引用本地 HTML；省略仍可在扩展中心打开通用视图              |
| 命令 `permissions`                         | 启动门槛，须来自插件声明；不满足时撤回或禁用入口                                                           |
| 命令 `executionBudget`                     | 可省略或使用 `standard` / `compute`，选择有界 Wasm 计算额度；不是权限，详见[执行预算](#执行存储与生命周期) |
| 插件 `permissions` / `optionalPermissions` | 必需 / 可选能力，唯一且互不重叠                                                                            |
| 插件 `network`                             | 精确 origin 与 HTTP 方法，须匹配网络能力                                                                   |

**授权主体是整个插件**。命令权限只决定能否启动，不构成该命令独立的能力上限；效果和主动发送的数据均按插件当前全部授权检查。

JSON 文本命令接收 `apiVersion: 2`、`inputText`、`files` 和 `network`。文本最多 1 MiB；最多 16 个用户主动选择的已授权文件，原始内容合计 2 MiB。文件含名称、`mediaType`、`encoding`（`utf8` / `base64`）和内容，不含系统路径；类型提示不认证真实内容。选择不等于发送，提交时宿主重读保存的文件，不代发未保存草稿。编码后请求最多 4 MiB，计入 JSON / base64 开销。

文本结果按纯文本显示，JSON / Markdown 由 Rust 和安全组件校验，不自动写入笔记或文件。输入输出的完整预算见 [执行编排](../src-tauri/src/extension_execution.rs) 和 [视图协议](../src-tauri/src/extension_view.rs)。

## 网络、凭据与私有数据

### 来源与授权

`network:https` 授权精确公网 HTTPS 来源，`network:local` 单独授权本机 HTTP：

```json
{
  "optionalPermissions": ["network:https", "network:local"],
  "network": [
    { "origin": "https://api.example.com", "methods": ["GET", "POST"] },
    { "origin": "http://127.0.0.1:3000", "methods": ["GET"] }
  ]
}
```

origin 必须是标准化的精确协议 / 主机 / 端口，无路径、凭据、查询、片段或通配符。HTTP 效果和图片请求的 `networkMode` 是可选兼容字段，通常省略并继承 [宿主网络设置](./architecture.md#状态管理与设置迁移)：宿主为 `direct` 时始终直连，包括旧插件显式请求的 `system`；宿主为 `system` 时，缺省请求仅在拥有 `network:system-proxy` 授权后使用代理，否则直连。本机 HTTP 缺省始终直连。显式 `direct` 继续直连；显式 `system` 在宿主为 `system` 时仍严格检查代理授权，并拒绝本机 HTTP。

直连禁用代理，HTTPS 全部 DNS 地址须通过公网检查并固定到本次连接，拒绝私网、环回、映射、隧道和保留地址。本机 HTTP 仅接受 `localhost` 或字面环回，全部解析结果须为环回，不开放 LAN。宿主禁止重定向和 Cookie，不为清单来源放宽 WebView CSP。

系统代理使用用户系统 / 环境代理及 `NO_PROXY`；无匹配代理或被排除时仍校验并固定目标公网 DNS。代理主机可以位于本机 / 内网，远端解析时宿主无法证明最终目标 IP 为公网；精确 origin、方法、HTTPS 证书、禁跳转和内容预算继续生效。插件不能指定代理 URL、关闭 TLS 或据此宣称支持任意 PAC。切换宿主偏好不新增插件授权，也不影响浏览器 fetch、WebView WSS、外链或 LAN。

支持 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`，逐次核对清单和授权。正文最多 1 MiB，响应最多 2 MiB 严格 UTF-8，每请求最多 15 秒；请求头最多 32 项 / 16 KiB。插件不能设置 Authorization、Cookie、代理或连接控制头。实现见 [extension_network.rs](../src-tauri/src/extension_network.rs)，通用安全要求见 [安全规范](./security.md)。

### 系统凭据

在“高级设置”按清单 origin 配置别名与密钥，最多 32 个别名，单密钥最多 8 KiB。秘密存系统 keyring，按应用、插件 ID、origin、别名隔离；普通 JSON 只登记位置。HTTP 效果的 `credential` 引用别名，宿主向匹配来源注入 Bearer 头，没有读取密钥的 IPC，也不把秘密作为字段放入会话、KV 或日志。服务端仍可能在响应中回显收到的秘密，别名机制不对服务端保密。

卸载、换来源 / 本地包替换与回退清除旧凭据；同一已验证来源且允许保留授权的升级可继续使用别名。设置 / 删除失败明确报告，别名登记不保证 keyring 可读，运行时缺失须重新配置。隔离恢复与 E2E 不操作真实凭据；目标平台 keyring 另行验收。

凭据设置、删除与安装维护按插件串行，系统 keyring 调用不占用全局注册表锁；无关插件仍可读取、准备调用和管理授权。停止等待不提前释放同插件维护门闩，须等已开始的系统调用真实结束。清理前检查安装身份与 revision，清理后提交仍严格复核；若其他插件期间推进全局 revision，提交可返回冲突并保留原安装，但已完成的凭据删除不回滚，需要重新配置或明确重试，不能自动重放外部副作用。

安装、回退、卸载、启用 / 授权与凭据管理在实际阻塞任务内登记扩展活动，覆盖系统调用、提交、资源撤回和通知；暂停 / 退出后拒绝新管理准入，更新 / 退出等待已开始的维护真实结束。管理活动不占窗口或 Wasm 执行位，停止前端等待不提前释放。

### 私有 JSON 存储

授予 `storage` 后，视图的 `host.storage` 提供 `{ revision, values }`。storage 效果提交 `expectedRevision` 和 `changes`，revision 不符返回冲突，不覆盖其他窗口。每插件最多 1 MiB / 128 键；键为 1–128 字节、无控制字符的字符串，可用 Unicode 和命名空间分隔符，不参与磁盘路径。

顶层 `changes` 的 `null` 删除键；保存 JSON null 时包一层对象，如 `{ "item": { "value": null } }`，嵌套 null 不变。存储 schema 1 独立于注册表 schema 3，使用原子替换，未知版本、损坏或链接路径拒写。卸载保留 KV，显式清空仍检查 revision；KV 不属于笔记备份或会话导出。实现见 [extension_storage.rs](../src-tauri/src/extension_storage.rs)。

## 受控桌面服务

自定义界面通过 `starter.services.request(service, request)` 调用固定服务，不执行 Wasm。图片资源、外链和自身窗口有 SDK 类型，`lan` / `wallpaper` 结果须从 `unknown` 收窄；类型不能代替原生校验。作者用法见 [SDK](../sdk/README.md#注册的宿主服务)，分派与授权见 [extension_services.rs](../src-tauri/src/extension_services.rs)。

| 入口             | 清单能力                                                               | 范围                                          |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Wasm HTTP 效果   | `network:https` / `network:local`；系统代理另需 `network:system-proxy` | 精确 origin / 方法的文本请求                  |
| `resources`      | `network:images`；系统代理另需 `network:system-proxy`                  | 任意公网 HTTPS GET 图片下载、预览、另存和释放 |
| `wallpaper`      | `wallpapers:manage`；资源导入另需 `network:images`                     | 本机图库和应用背景，不负责供应商搜索          |
| `links`          | `links:open`                                                           | 打开 HTTPS 来源页                             |
| `lan`            | `messaging:lan`                                                        | 内网消息 / 附件、本机回环与独立历史           |
| `window`         | `window:control`                                                       | 读取、切换本插件独立原生窗口的置顶状态        |
| `starter.notify` | 无独立系统授权                                                         | 应用 toast，不是操作系统通知                  |

权限可必需或可选，彼此独立：图库不隐含图片网络、文本 HTTP 或外链，拒绝可选能力仍可使用无关离线功能。没有任意 IPC、服务注册、系统路径、Shell、系统剪贴板、操作系统通知或通用后台任务接口。

每次服务请求复核启用、授权、模块哈希、安装代次与原生窗口令牌。请求持有同插件读门闩，替换 / 撤权 / 禁用 / 卸载持有写门闩，等待该插件已开始的调用结束再撤回资源；不阻挡无关插件，全局归档另有屏障。`ServicePermit` 全程计入原生活动，关闭 / 退出 / 重启 / 更新等待下载、对话框和其他已开始工作真实结束，不因前端停止等待而释放。

窗口销毁后的 LAN 与图片资源收尾等待现有阻塞名额，不因普通容量满而跳过；清理仍绑定旧窗口所有者，不触及同 label 重开后的资源。

最终写入复核窗口生命周期，关闭后的请求不得提交；窗口 epoch 隔离同 label 重开，旧清理不能撤回新资源。以上不回滚已完成的写入或发送，也不保证失败即未执行。对话框可等待用户选择，SDK 不以统一前端超时截断请求；Wasm 和网络仍各有预算。

原生桌面服务普通请求最多全局 8 项、每窗口 4 项在途；只有精确的 LAN `{"action":"stop"}` 另有全局 1 项、每窗口 1 项独立容量，停止不占普通名额，先开始停止也不减少普通额度。停止的安装身份读取和真实 LAN 分派在同一次 owned 准入下进入阻塞池，不竞争通用 `blocking::run` 的 16 项容量；普通请求仍沿用该通用限额。容量、维护读门闩与已授予的窗口活动租约由在途工作持有，前端取消等待不提前释放。

停止仍复核窗口 epoch、安装身份、启用和授权，等待相同的插件 / 全局维护屏障；重复停止超出独立容量返回 `EXTENSION_BUSY`。这只是原生服务准入与分派的容量保留，不绕过界面桥 / SDK 的 4 项在途上限，不保证端到端必达或立即停止，也不回滚已完成的副作用。

### 插件自身窗口

`window` 需要声明并获得 `window:control`，最低宿主版本为 `0.1.7`。`{ action: "get-state" }` 读取状态，`{ action: "set-always-on-top", enabled: boolean }` 设置置顶；两者均返回实际原生状态 `{ alwaysOnTop: boolean }`。该能力可设为可选，拒绝授权时不阻塞计算等无关离线功能。

设置只提交一次，并在让出事件循环后进行有界状态确认，兼容 macOS / Linux 的异步窗口状态更新；未确认返回 `WINDOW_ERROR`，不会把请求值冒充实际状态。确认读取继续检查原生活动租约；错误不承诺撤销已经发生的窗口变化。

目标只来自 Rust 注入的调用窗口，且必须匹配当前安装清单中 `ui.window: true` 的入口。嵌入主窗口的界面、其他插件窗口和宿主主 / 次窗口均不可由此控制；请求不接受 label、安装身份、路径或其他窗口动作。操作在原生主线程复核活动租约后执行，关闭、暂停、重开、禁用或撤权期间的旧请求不能晚到修改窗口。浏览器与无头服务替身明确返回不支持，不能据此宣称原生置顶已经验收。置顶不写入插件工作区或会话导出。

### 局域网通信

`lan` 提供 `status`、`start`、`loopback`、`stop`、`connect`、`send`、`sendAttachment`、`previewAttachment`、`saveAttachment`、`markRead`、`nickname`、`clearHistory`、`forget`。监听、连接、消息和附件发送都由用户启动，不扫描 / 自动发现、不修改防火墙。仅接受私有 / 环回及允许的本地链路 IP 字面量，不解析任意主机名；端口、文本、连接、帧和线程额度由 [extension_lan.rs](../src-tauri/src/extension_lan.rs) 校验。

`start` 可指定 `mode: "lan" | "loopback"`；`loopback` 创建绑定 `127.0.0.1` 随机端口的主节点与独立回环助手，执行真实 TCP 握手、回送和 ACK。状态提供 `mode` 和 `loopbackPeerId`，方便界面定位测试会话；用户切换模式会停止既有连接，历史保留。本机回环验证原生链路，不表示跨设备路由、防火墙或正式安装版已验收。

`send` 支持普通文字和 Unicode 大表情；正文最多 8192 UTF-8 字节，允许换行 / 制表符，拒绝其他控制字符。`sendAttachment` 只接收会话 ID 和 `image` / `file` 分类，由原生对话框选择实际文件，文件须非空。图片最多 8 MiB，支持真实 PNG / JPEG / WebP 解码；单边最多 8192 像素、总计 1600 万像素、解码分配预算 128 MiB，并与已有图像任务共用最多 2 项处理名额。普通文件最多 1 GiB，允许任意格式，统一以 `application/octet-stream` 卡片传输，不自动打开或执行。

历史只向界面返回附件名称、MIME、大小与 SHA-256；名称仅作为显示和另存建议，最多 240 UTF-8 字节，拒绝路径分隔符、控制字符、Windows 设备名及末尾空格 / 点。`previewAttachment` 通过消息 ID 返回重绘后最多 94 KiB 的 data URL 预览，`saveAttachment` 通过系统对话框另存，不暴露或接受任意系统路径。文件 SHA-256 证明内容一致性，不认证发送方。

普通文件按 64 KiB 块流式读取、传输和增量 SHA-256 校验，另存也按块复制并校验，不把整个文件载入内存。接收内容先写服务私有临时文件，满足声明长度与散列后才原子提交；中断、校验失败或停止时清理未完成临时文件，不显示已送达。每个流式读写或校验阶段分别计时，连续 15 秒无进展或达到 30 分钟阶段预算时超时；一次请求可包含多个阶段，累计时长可能超过 30 分钟。元数据仍受有界 JSON 帧限制。

文字 / 表情发送、昵称广播及附件元数据发送各自沿用 2 秒预算，包含等待同一连接发送锁的时间；附件正文使用上述流式预算。等待时持续检查窗口关闭和服务停止，未写出首字节时放弃不会断开其他在途发送；半帧或已发送附件头后的正文失败会关闭连接，避免后续内容被误解码。

附件缓存位于服务自己的私有目录，文件按 SHA-256 命名，已缓存内容与在途预留字节共同计入每个聊天节点最多 2 GiB 的额度，执行普通文件、路径与链接检查。回环助手有独立的测试暂存，每次完成回送后回收，停止回环时再次清理；它同样受 2 GiB 单节点上限约束，主节点和助手理论合计上限为 4 GiB，不等于整个进程的磁盘或内存上限。主节点历史淘汰、清空或移除联系人后清理未被引用的附件；仍在发送、另存或预览中使用的附件保留，使用结束后由后续缓存或清理操作回收。满额时明确报错，由用户清理历史后重试，不删除仍被历史引用的文件。系统文件选取最多 2 项并发，全局最多 4 项流式接收。

`messaging:lan` 授权现包含收发文件及受控选择 / 另存，权限文案必须说明此范围；没有新增 Tauri capability、CSP、任意文件 API、Shell 或原生 IPC 入口。附件不通过 Wasm 或检查点传输，会话纯文本导出只保留附件说明。

附件失败按稳定码区分：`EXTENSION_ATTACHMENT_TOO_LARGE` 表示超出附件额度，`EXTENSION_ATTACHMENT_CACHE_FULL` 表示本机缓存满，`EXTENSION_TRANSFER_INTERRUPTED` 表示传输中断或完整性校验失败，`EXTENSION_TIMEOUT` 表示超出单个阶段的无进展或时长预算。界面按码提示对应处理，保留草稿与已有记录，不解析原生错误文本，也不将所有失败都解释为 IP / 端口问题；缺少送达回执时先核对对端记录，再决定是否显式重试。

协议为 **明文、无账户认证**，消息与附件都没有加密；昵称、节点标识和送达回执不认证身份，只用于用户信任的网络。协议版本 2 明确拒绝版本 1，双方须运行配套宿主。联系人最多 64 项、连接最多 16 个、历史最多 500 条且编码存档不超过 1 MiB。联系人、历史与未读状态按插件保存于 `extension-data/lan/`，schema 2 可读取已有 schema 1 文本记录，将缺失消息分类视为文字，下次修改时原子升级；损坏 / 未来版 / 链接路径拒写并保留原件，不属于 KV、会话导出或笔记备份。

附件与回环能力按配套宿主使用，长期边界见 [ADR 0018](./adr/0018-lan-attachments-and-loopback.md)；插件版本与最低宿主由清单维护，发布操作见 [市场发布顺序](../marketplace/docs/publishing.md#固定配套宿主)。

连接由原生持有，使用窗口组成所有者集合。同一窗口切页、iframe 卸载或停止轮询不结束服务；最后一个使用窗口销毁，或禁用 / 撤权 / 换安装身份 / 卸载 / 应用退出时回收连接，保留历史。多个窗口共享服务，明确停止会影响其他窗口；关闭不回滚已发送消息，核对回执且勿自动重发。

### 壁纸图库与图片搜索

`wallpaper` 管理 **应用背景**，复用宿主图库和设置，不设置操作系统桌面壁纸。动作是 `list`、本机 `import`、`import-resource`、`apply`、`rename`、`remove`、`open-settings`。本机导入使用系统对话框；资源导入传 `resourceId` / 名称，其他操作传图库 ID 和受校验参数，不接受系统路径或远程 URL。背景设置使用 revision CAS 并跨窗口同步，移除当前背景须确认并恢复纯色。

重命名命中设置中保存的背景图片时，同步其名称并广播设置，保留图片内容、显示方式和其他偏好；重命名其他图库图片只修改图库。

移除任何图库项都会推进设置 revision；版本检查、设置提交与图库删除共用设置写入锁，其他窗口按旧快照保存背景或移除图片时返回冲突。后续删除或预览失败不会回滚已完成的设置提交，已提交的快照仍会广播；设置写入失败时不删除图库项。未来设置版本、损坏图库继续拒绝覆盖原件。

图源 API、搜索 / 补齐、响应解析和许可说明属于插件，详见 [壁纸插件](../marketplace/plugins/wallpaper-browser/README.md)。宿主负责下载与图库服务，图片请求通常省略 `networkMode` 继承宿主网络设置；通用下载只附带固定应用 User-Agent，不接受插件自定义请求头。供应商修复可单独更新插件，宿主下载或服务变更则需重建并重启宿主；已有图库与背景保留。

`network:images` 授权 **任意公网 HTTPS GET 图片来源**，不要求动态原站逐一列入文本 HTTP origin；仅接受公共 DNS 名称和 443 端口，不接受 IP 字面量、URL 凭据或片段。路径 / 查询也可能发送数据，须独立审阅。下载仍校验公网地址、重定向与实际内容；`networkMode` 沿用 [直连 / 系统代理边界](#来源与授权)。

| `resources` 动作 | 请求                                | 结果                                                                    |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `fetch-image`    | `url`、可选 `networkMode`           | `{ resourceId, mime, bytes, width, height, sha256 }`                    |
| `preview`        | `resourceId`                        | `{ dataUrl }`，有界重绘，不让 iframe 访问原站                           |
| `save`           | `resourceId`、可选建议文件名 `name` | 系统对话框选路径；`{ cancelled: true }` 或 `{ cancelled: false, name }` |
| `release`        | `resourceId`                        | 释放资源，返回 `null`                                                   |

建议文件名可含中文 / 空格，拒绝分隔符、控制字符、设备名和错误图片后缀；省略时宿主生成名称。**另存原图**保留已验证字节；`wallpaper` 的 `import-resource` 重绘压缩后入库，受现有图库数量 / 单图额度约束，不把预览成功当作保存完成。图库图片损坏或不可解码时可返回 `dataUrl: null`；处理名额暂时不足则返回 `EXTENSION_BUSY`，界面保留上次成功列表并允许刷新重试，不用空预览冒充正常结果，也不回滚已经完成的写入。

图片 DNS / 传输 / 读体合计最多 20 秒。固定图片 GET 在取得响应头前遇到连接 / 发送错误时，保留同一个已校验 client、URL、代理和 TLS 配置，等待 250ms 后最多再发送一次；DNS、两次发送、退避和读体共用原 20 秒预算。不自动重试已收到的 HTTP 状态（包括 429 / 5xx）、跳转、MIME、内容或像素错误，也不改变通用 HTTP 效果的重试行为。远程原图最多 16 MiB，只接受真实 JPEG / PNG / WebP；单边最多 8192 像素、总计 1600 万像素、解码分配预算 128 MiB。下载 / 图像处理最多 2 项并发，与图库共用处理名额。缓存保留原图：TTL 10 分钟，每窗口所有者最多 8 项 / 32 MiB，全局 32 项 / 64 MiB；这些不是整个进程内存上限。

本机文件 / 文件夹导入使用独立的输入额度和自动压缩流程，不受远程下载预算限制；图片、视频封面与独立视频副本的归属和容量见[数据存储](./architecture.md#数据存储)。视频从宿主设置导入，已有视频仍可通过共用图库选用。

图片失败按稳定 `code` 区分：`EXTENSION_NETWORK_BLOCKED` 表示解析地址未通过网络边界，包括直连与系统模式未匹配代理时的 Fake-IP；这类安全拒绝保留原错误码且不自动重试。`EXTENSION_IMAGE_REDIRECT` 表示图片地址跳转，`EXTENSION_IMAGE_SOURCE_REJECTED` 表示上游返回非成功 HTTP 状态，`EXTENSION_IMAGE_INVALID` 表示 MIME / 图片内容 / 解码无效，`EXTENSION_IMAGE_TOO_LARGE` 表示字节 / 像素 / 解码分配超额。429 和 5xx 来源拒绝可重试，其他来源拒绝需换图或检查来源；超时仍为 `EXTENSION_TIMEOUT`、处理繁忙为 `EXTENSION_BUSY`。插件按码显示本地化原因，桥隐藏原生错误细节与完整 URL。

资源绑定插件 ID、哈希、安装代次和窗口 epoch，跨窗口、换身份、到期、释放后拒绝新请求，关闭 / 撤权清理缓存。`resourceId` 不能导出或跨重启恢复，应重新获取。`release` 返回 `NOT_FOUND` 时表示句柄已不再可用，调用方停止重试；暂时繁忙或页面隐藏时可在恢复后继续释放。释放只阻止后续查找，已取得字节的在途操作保留到结束，最终提交仍核对生命周期；缩略图 CPU 工作不持有最终提交锁。实现见 [extension_resources.rs](../src-tauri/src/extension_resources.rs)。

### 来源外链

`starter.services.request("links", { url })` 需 `links:open`，仅打开公共 DNS 名称、443 端口、无 URL 凭据的 HTTPS 来源页，可保留片段，不开放文件、其他协议或命令。最终连接由系统浏览器负责，宿主不控制浏览器 DNS / 后续导航，打开页面也不证明图片许可。外链授权独立于 HTTP、图片与图库能力。

## 界面能力与适用范围

通用视图适合表单、文本、数据与回合制操作，由宿主固定组织 `fields/groups/blocks`，不提供自由交错布局、实时 Canvas、通用指针 / 拖拽或游戏方向键。需要这些交互时使用 [自定义界面](#自定义界面)，在 HTML 中组织布局和局部循环，不按每帧调用 Wasm。两者共用业务协议、授权和执行服务。

## 开发带界面的应用插件

参考 [本地工作台](../examples/extensions/apps/) 或 [TypeScript notebook](../examples/extensions/typescript/)，命令声明 JSON 输入、`view` 结果和入口。通用视图返回 JSON，由 [React 渲染器](../src/features/extensions/extension-view.tsx) 绘制 DOM；自定义界面额外声明本地 HTML。Wasm 中的 JavaScript 与网页脚本是不同上下文，前者处理业务与受控效果，后者使用 DOM / Canvas 或框架；不共享宿主 DOM 和原生对象。

首次请求为 `version: 2`、`action: null`、`state: ""`、空 `fields` 与当前语言，后续交回不透明 state 和当前字段。宿主附加 `host`（授权与可用存储快照），前端不能伪造。仅用户点击“发送数据”时附加 `data`，使用 `action: "host-data"`；普通动作不重读或重发文件，但仍可发起已授权网络效果。

视图响应可带 `effects`：

```json
[
  {
    "kind": "http",
    "id": "load-items",
    "request": {
      "url": "https://api.example.com/items",
      "method": "GET",
      "headers": {},
      "body": null,
      "credential": "account"
    }
  },
  {
    "kind": "storage",
    "id": "save-title",
    "expectedRevision": 3,
    "changes": { "title": "Draft" }
  }
]
```

宿主先检查效果 ID 重复、全动作预算，并预检 state / fields 能否容纳宿主上下文与结果收据，不满足则在本批执行前拒绝；通过后顺序执行，保留本轮 state / fields、刷新上下文，用 `action: "host-result"` 和 `results: [{ id, value, error }]` 再调用同一导出。结果聚合超限时，已完成效果的超量 `value` 变为 `null`、错误为 `INPUT_TOO_LONG`，保留 ID 和其他收据，明确操作已完成而响应省略，不能据此自动重试。

每动作最多 8 轮 / 16 效果，60 秒合作取消预算从取得执行租约开始，排队不计时。同步系统 I/O 可能超时后仍未结束，租约持续保留。效果批次不是事务：后续校验失败、取消或超时均不回滚已完成网络 / KV 写入，也不能保证总能返回收据。插件按稳定错误码处理冲突与失败，不自动重试外部副作用。完整编排见 [extension_execution.rs](../src-tauri/src/extension_execution.rs)。

视图必需 `version/state/display/description/fields/groups`，页签、块、字段错误、效果和产物可选。DTO 与各文本细则见 [extension_view.rs](../src-tauri/src/extension_view.rs)：

| 能力       | 范围                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表单       | 最多 32 项：文本、多行、数字、选择、复选、日期，值均为字符串；默认单字段 64 KiB，`maxBytes` 可提高到 256 KiB，合计 1 MiB；`errors` 按字段 ID 关联 |
| 页签与按钮 | 最多 12 页签且恰好一个激活；16 组 / 共 128 动作，支持棋盘和独立无障碍标签                                                                         |
| 展示块     | 最多 24 块：安全 Markdown、指标、分页表格、折线 / 柱状图、进度、内嵌图片                                                                          |
| 表格与图表 | 最多 32 列 / 2000 行；图表 8 序列 / 1000 标签，数值有限，提供可读替代内容                                                                         |
| 图片       | 有界 PNG / JPEG / WebP base64 data URL，核对文件头和尺寸；无 SVG / 远程 URL                                                                       |
| 状态与响应 | state 最多 256 KiB，完整请求 / 响应各 4 MiB，各字段 / 块另有限额                                                                                  |
| 产物       | 最多 8 个，各解码后 2 MiB，仍受总响应预算约束；文本、CSV / TSV、JSON、Markdown、PDF、ZIP、PNG / JPEG / WebP，文件名 / 后缀 / MIME / 编码须匹配    |

请求串行，失败保留输入与上次视图。运行锁以可访问不可用状态防重复并保留焦点，业务禁用仍用禁用控件；展示棋盘格不做按钮。宿主支持 Tab、Enter / Space、页签方向键、运行状态和停止入口。保存结果 / 产物只写用户选择的路径，不执行、解压或导入；取消不清除未保存标记。Markdown 不执行 HTML 或危险 URL。

同一窗口切换导航保留会话 / 数据草稿，并请求停止离页运行。会话 JSON 导入 / 导出最多 **32 MiB**，计入输入、结果、检查点和转义开销；专用会话保存不扩大普通文本导出 8 MiB 上限。导入须匹配插件 ID、命令、版本、模块哈希和视图 / 工具种类，确认替换后恢复；不执行 Wasm、不恢复授权、凭据或文件资源，仅记录文件名，文件需重选。会话不代替私有 KV 备份。

窗口内会话缓存采用最近使用顺序回收非活动的干净会话，软预算为 12 项 / 32 MiB 序列化载荷；活动、未保存或仍在运行 / 导出 / 选择文件的会话始终保留，因此预算不等于整个窗口的硬内存上限。干净会话被回收后再次打开重新初始化；未保存草稿不会因容量回收静默丢失。

原始视图经 Rust 完整校验，未提交字段草稿独立恢复，硬额度为每字段 256 KiB / 合计 1 MiB。草稿超过作者额度或暂不符合数字、日期、复选框语义时保留但禁止运行，SDK 不能绕过；普通宿主表单还要求选择值属于当前视图的选项。自定义 HTML 界面可在同次动作中改变父字段与关联选择，不能用上一轮的选项拒绝新值；其有界选择草稿由插件按新上下文校验或规范化，返回视图仍必须通过 Rust 的完整校验，包括选择值属于本轮选项。超过恢复硬额度则保存前拒绝并保持未保存，避免导出不可恢复文件。语言刷新只合并草稿，不改写已验证原始视图。

“扩展工具”集中窗口、会话、数据交付等低频动作，生成产物仍须明确保存；自定义界面入口见 [下文](#自定义界面)。独立窗口复用语言 / 主题并跨窗口同步，初始逻辑尺寸默认来自主窗口配置；视图入口可声明 `ui.windowSize: { "width": 1100, "height": 820 }`，要求 `ui.window: true` 和 `minHostVersion: "0.1.7"` 或更新版本。宽度允许 360–1920、高度允许 480–1440，均为整数逻辑像素。该字段只提供默认尺寸，不强制固定窗口；已有记忆尺寸优先，后续仍按入口记忆并适配 DPI 和显示器工作区。恢复默认窗口尺寸会清除动态插件入口的尺寸记忆，下次创建重新读取当前清单。窗口标题栏、系统按钮与宿主工具入口保留。

结束有进度或运行中的会话需导出、放弃或取消，取消导出 / 确认不清空草稿。系统关闭走未保存工作协商，保存 / 放弃遵循 AbortSignal，原生实际停止后释放占用；独立窗口正常关闭，不关闭到托盘。窗口创建与退出 / 重启 / 更新互斥；关闭使旧运行和排队失效，同 label 重开不恢复旧请求。长期服务按原生窗口所有权回收，不以界面暂离推断连接停止。

结束会话等待原生关窗或导航结果后才清理内容。关窗失败保留正文与检查点，恢复未保存标记，并由现有结束对话框提供显式重试；父组件刷新或错误状态变化不会自动重复关闭请求。

## 构建 Rust 示例

示例使用官方 Extism PDK，辅助 DTO 在示例源码。首次运行开发 CLI 通过 Cargo 构建本机 `extension-tool`，需 Rust / 平台编译环境但不启动桌面窗口；插件无需按宿主平台分别编译。

从仓库根运行：

```powershell
pnpm build
rustup target add wasm32-unknown-unknown
cargo build --manifest-path examples/extensions/rust/Cargo.toml --release --locked --target wasm32-unknown-unknown --target-dir src-tauri/target/extension-example
pnpm extension:validate --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm
pnpm extension:test --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm --fixture examples/extensions/rust/smoke.json
pnpm extension:pack --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm --out artifacts/extensions/rust-text-1.0.0.starter-extension.json
```

`validate` 检查清单、ABI 和编译，不创建实例或执行 Wasm start；`test` 在真实无界面 worker 运行离线 fixture 并校验结果；`pack` 权威校验后封装，不执行插件或覆盖已有输出。可用 `STARTER_EXTENSION_TOOL` 指定已编译工具绝对路径。它们不代表网络、凭据或多窗口已验收。

fixture 为单对象或顺序执行的 1–32 项数组，例如 `{ "command": "echo", "input": "Hello", "expectOutput": "Hello" }`；JSON 输入可用对象。断言须且只能选 `expectOutput`（完整文本）、`expectJson`（JSON 等价）、`expectJsonSubset`（非空对象递归子集，数组 / 标量完全相等）或 `expectError`（稳定错误码）。视图始终先经 Rust 完整校验，子集只需手写稳定行为，无需复制不透明 state。`cancelAfterMs` 通常预期 `USER_CANCELLED`，不同于预算耗尽的 `EXTENSION_TIMEOUT`。离线 fixture 不执行宿主效果或 SDK 服务；需要回执时提供合成请求，真实 broker / CAS / TCP 另测。

## 构建 JavaScript 和 TypeScript 示例

[JavaScript](../examples/extensions/javascript/) 演示多文本命令，[TypeScript](../examples/extensions/typescript/) 演示报告和私有 notebook；[示例 SDK](../examples/extensions/sdk.ts) 帮助构造宿主协议，Wasm ABI 仍用官方 Extism PDK。

安装官方 `extism-js` 与 Binaryen，将 `extism-js`、`wasm-merge`、`wasm-opt` 加入 PATH；`EXTISM_JS` 可指定编译器。工具版本以示例工程和 CI 为准，从根目录运行：

```powershell
pnpm --dir examples/extensions install --frozen-lockfile
pnpm --dir examples/extensions typecheck
pnpm --dir examples/extensions build
pnpm extension:validate --manifest examples/extensions/javascript/extension.json --wasm examples/extensions/dist/javascript.wasm
pnpm extension:test --manifest examples/extensions/javascript/extension.json --wasm examples/extensions/dist/javascript.wasm --fixture examples/extensions/javascript/smoke.json
pnpm extension:pack --manifest examples/extensions/typescript/extension.json --wasm examples/extensions/dist/typescript.wasm --out artifacts/extensions/ts-report-1.0.0.starter-extension.json
```

TS 经 esbuild 转 CommonJS，再编译为包含 JS 引擎的 Wasm。用户无需 Node / Rust / 开发工具；纯计算依赖可打包，Node 内置模块、DOM 和常驻异步任务需适配。

## 内置应用资源

内置目录与安装操作读取当前运行的宿主程序在编译时嵌入的插件包，不从网络拉取，也不直接读取工作区源码。通过本地文件升级插件只更新已安装副本；卡片显示“本机版本较新”时，表示已安装副本高于宿主携带的版本，应用会保留新版，不执行降级。

让宿主内置版本同步更新，需要按下述流程重建插件资源，再执行 `pnpm app:build` 并更新、重启实际使用的安装版；开发运行则重新启动 `pnpm app:dev` 的 Rust 进程。仅刷新前端、重新生成 Wasm 或导入插件包不会改变正在运行的宿主内置包。

普通应用构建使用提交的 [demo-apps.wasm](../resources/extensions/demo-apps.wasm)，无需交叉编译目标。修改工作台源码、HTML、清单、锁文件、工具链或实际编译 recipe 后，在参考平台重建并提交模块与回执：

```powershell
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml
pnpm extension:demos:build
pnpm extension:demos:check --rebuild
```

| 检查                         | 覆盖范围                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm extension:demos:check` | 核对 Rust / HTML、清单、锁文件、工具链、recipe、参考平台和模块哈希回执；已纳入 `pnpm verify`，不重新编译 |
| `--rebuild`                  | 参考平台 `x86_64-pc-windows-msvc`（Windows x64）逐字节重建，只有该平台可更新分发资源                     |
| `--compile`                  | Linux / macOS 真实编译并核对源码回执，不覆盖分发资源或断言跨平台字节相同                                 |

三端 Rust CI 分别对提交模块与本次重编模块执行 ABI / UI 校验和同套手写 fixture。相同 Wasm 目标与 Rust 版本不保证跨构建平台字节一致：Cargo 依赖编译元数据仍区分构建平台，路径重映射不能替代参考环境或功能验证。

编译输入、路径重映射和环境清理由 [extension-apps-recipe.mjs](../scripts/extension-apps-recipe.mjs) 定义并计入回执，修改 recipe 后重新生成资源。参考平台的路径 / 缓存差异由独立构建与 Windows CI 逐字节核对。

## 执行、存储与生命周期

宿主并行最多 2 项、等待最多 16 项；同窗串行，按可运行窗口队列调度。排队可取消，关窗使旧请求失效；取得租约后计完整动作的 60 秒预算，覆盖数据 broker、Wasm 和效果。取消 / 到期请求停止，租约保留到同步 I/O 等真实结束，已完成副作用保留。

安装、启停、回退和卸载在对应插件的维护租约内提交变更；提交后的旧服务撤回与变化通知沿用同一次已准入的阻塞任务，不再竞争新的执行位。调用方停止等待不会中断收尾；清理失败仍通知各窗口已提交的状态，并返回真实错误，不表示注册表已回滚。

Wasm 运行在当前应用的 `--extension-worker` 子进程，早于 Tauri 初始化分派。每调用最多 15 秒，涵盖槽等待、创建进程、通信、编译、初始化和执行；超时 / 取消 / 断连终止并回收本次拥有进程。每次真实运行创建新实例，guest 内存、变量和 WASI 状态隔离，线性内存最多 256 MiB。

池最多 2 个 worker，每个保留最多 4 条编译 LRU、合计 32 MiB 源模块。Run 优先使用命中模块哈希与预算档的空闲 worker，也可使用其他空闲槽；父缓存提示与 worker 使用同一预算变体计数和淘汰。源字节额度并非 JIT 内存上限。

命令 `executionBudget` 省略或为 `standard` 时，初始化和执行各限 100,000,000 fuel；`compute` 各限 10,000,000,000 fuel，用于已知有界计算，并要求 `minHostVersion >= 0.1.7`。预算来自已校验清单，前端不能覆盖，未知值、`null` 和数字拒绝。两档共享墙钟、内存、输入输出、队列、取消及权限边界，编译缓存按 fuel 区分；取舍见 [ADR 0019](./adr/0019-bounded-extension-compute.md)。

启用预编译与启动预热使用 worker `Prepare`，只填充编译缓存，不实例化或执行 start / 初始化 / 导出 / 业务效果。它经内部 RunLease 进入既有队列，同一时刻一个预编译 owner，每项共享 15 秒总预算；只准备清单使用的预算档，混合档分别占缓存条目与源字节额度。编译不持注册表锁，启用 / 安装最终以初始 revision 做 CAS，预编译成功仍需实际打开时初始化。

各窗口 ExtensionsProvider 首次成功接受列表时检查一次：已有启用插件才后台调用无参 `prepare_enabled_extensions`，不阻塞路由，刷新不重复触发。原生合并同轮并发请求，从有效列表优先选择含视图命令的最多 4 个启用插件逐项预热，复用 worker 且不写磁盘 JIT 缓存。预热让位于前台运行 / 启用；停用、撤权、替换、暂停、恢复隔离及退出沿用租约取消与真实结束等待。合作取消结束本轮，此前真实错误仍汇总报告；失败保留启用状态，toast 提供显式重试，也可直接打开执行。

退出、worker 回收或 LRU 淘汰后重新编译，尚未预热 / 被让位 / 未选中的插件也可能走冷路径。缓存命中仍复核安装身份、授权和窗口；它与导航预载、界面保留及磁盘内容缓存各自管理，见 [ADR 0017](./adr/0017-precompile-enabled-extensions.md)。

worker 不继承环境、预开目录或插件 stdout；直接 Extism HTTP、文件注册、远程模块、系统命令、同步 WASI `poll_oneoff`、磁盘编译缓存、dump 和 profiler 均关闭。worker 以当前用户运行，进程分离提供终止 / 恢复边界，操作系统权限仍属于当前用户。

以下数据均不纳入笔记备份 / 恢复归档：

| 位置                               | 规则                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `extensions/registry.json`         | schema 3、revision CAS、原子替换，最多 64 项；未知 / 未来 schema、重复结构字段、损坏和链接路径拒写      |
| `extensions/` 模块缓存             | 内容哈希命名，总量 128 MiB，保留运行租约模块与前一包；释放名额后异步合并清理，每 Store 最多一项清理任务 |
| `extension-data/storage/`          | [插件私有 KV](#私有-json-存储)                                                                          |
| `extension-data/credential-slots/` | 凭据别名位置，秘密在系统 keyring                                                                        |
| `extension-data/lan/`              | 独立 LAN 联系人与历史                                                                                   |

注册表与 KV 拒绝链接祖先和 Windows 重解析点。安装 / 替换 / 回退更新 `generation`，启用 / 授权变化不更新；同哈希重装或不同清单 / 来源均为新身份。IPC 核对 generation 与哈希拒绝晚到旧请求，管理变更另用 revision CAS；运行使用本次核验模块和当前授权。恢复隔离期间禁止安装与运行，保留原数据。

## 官方插件市场

市场从配置的固定仓库取得签名目录与 Release 附件；下载先审阅，确认后安装，原生重新核对目录、完整包和来源收据。本地导入不能伪装市场来源。来源包括仓库、公钥指纹、目录 revision 和完整包哈希。

同次安装请求复用该次原生完整校验产生的包数据，不重复解析、解码和验证 Wasm；下载阶段的校验不替代安装校验，前端预览也不构成原生可信凭据。

下载按钮内部按实际接收字节与已验签目录中的完整包大小显示进度；准备目录、校验和确认后的安装分别显示对应状态，不将下载完成视为已安装。下载进度通过本次命令的私有 IPC Channel 传回当前窗口，结束后忽略晚到消息；关闭页面只停止展示，不代表取消原生下载或回滚安装。进度不改变签名、大小、哈希校验或权限审阅要求。

客户端要求 **目录 schema 2**。旧 schema 1 不能用于当前发现 / 下载，维护者须按市场 [发布与管理](../marketplace/docs/publishing.md) 构建兼容包并发布已签名 latest；推送代码、离线 fixture 或 CI 配置不更新线上内容。本地包与内置工作台可独立使用。协议不兼容、已验签当前目录到期、签名 / 时间 / 完整性无效分别报告，不通过接受旧协议、改公钥或删除信任恢复。

从 0.1.6 起，已验签目录内只有 **严格有效且高于当前宿主的 `minHostVersion`** 才允许隔离未知清单正文。目录 / 附件元数据、兼容头、全目录 ID 去重、UI 元数据及重复 JSON 字段仍严格校验，不能掩盖坏签名、时间或哈希。无法理解的未来项仅显示名称 / ID / 版本 / 最低宿主 / 分类，不入下载安装索引；可理解的未来项保留预览，但原生下载前仍拒绝，界面不提供下载 / 升级。当前或更低最低宿主的未知清单拒绝整份目录；旧二进制不会获得此修复。

`app.config.json` 的 `extensionMarket.repository` / `publicKey` 定义信任源，两项为空禁用市场。派生新身份 / 主仓库默认清除继承市场配置，单独换市场仓库也清除旧公钥，不完整配置拒写。IPC 不收任意下载 URL，只取配置仓库的 GitHub Release，重定向逐跳受限。

| 目录与信任   | 宿主规则                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 签名 payload | schema 2，含 UTC Unix 秒 `issuedAt` / `expiresAt`、完整清单、哈希、大小、分类及附件位置                                            |
| 有效期       | 最长 30 天，签发时钟容差 5 分钟；发布工具默认 7 天，到期前发布更高 revision                                                        |
| 进程缓存     | 最多 5 分钟且不越过签名截止；刷新失败可展示旧目录，下载 / 安装仍重新校验，不依赖过期目录                                           |
| 持久信任     | `extension-market/trust.json` 按仓库 / 公钥指纹隔离，原子保存最高 revision 和摘要，拒绝回退、同 revision 换内容；损坏 / 未来版拒写 |
| 摘要         | 覆盖完整原始签名 payload，包括隔离未来正文，不随客户端可用条目投影改变；目录内容缓存不跨重启恢复                                   |

市场源码由 `marketplace/` Git 子模块引用，普通宿主构建无需初始化：

```sh
git submodule update --init --recursive
```

[市场说明](../marketplace/README.md) 维护插件列表，[市场文档索引](../marketplace/docs/README.md) 维护收录、构建、测试、安全与发布操作；需初始化子模块后阅读。市场当前固定 Rust / Cargo 构建，宿主 JS / TS 示例不自动参与。维护者审核源码、许可、权限和实际运行，再构建、签名、核对附件并发布；测试密钥的离线验签不代表生产发布，私钥只在仓库外临时文件或受控 Secret 使用。

下架是移除收录项并发布更高 revision，停止新下载，不远程删除已装包 / 历史。用户回退上一包与目录防回退是不同操作，不能降低目录 revision 回滚分发。

## 依赖与分发

Extism 为 BSD-3-Clause，Wasmtime 为 Apache-2.0 WITH LLVM-exception，精确版本见 Cargo 锁文件。宿主关闭 Extism 默认 feature，复用 Wasmtime JIT、keyring、HTTP 与签名依赖。编译 / worker 体积按目标安装包实测，macOS Hardened Runtime / 签名版 JIT 需 [单独验收](./build-release.md#macos)。

扩展窗口使用 [extensions.json](../src-tauri/capabilities/extensions.json) 的有限事件、窗口、剪贴板写入和外链能力，不直接开放文件 / HTTP 插件权限。capability 不能代替自定义 Rust 命令或 Wasm 授权 ACL，见 [能力最小化](./security.md#能力最小化)。[第三方许可原文](../resources/third-party/) 随安装器和便携包分发。

## 验证

按改动选择入口，具体命令与测试层的覆盖范围由 [测试规范](./testing.md#rust-测试) 维护：

- 插件作者：使用本页 Rust / JS / TS 构建步骤与 `extension:test` 离线 fixture；HTML 作者再检查草稿、语言、活动状态及 SDK 失败处理。
- 宿主维护者：协议、授权、CAS、调度或服务改动运行对应 Rust / 前端回归；worker 进程与回收改动使用 `pnpm extension:test:worker`，扩展 UI 改动使用 [定向 WebView 检查](./testing.md#自定义扩展界面)。
- 互操作：使用 [上游 fixture](../examples/extensions/upstream/fixture.json) 并核对固定 SHA-256；市场联通使用实际发布且未过期的配套目录。
- 分发：系统 keyring、实际多窗口退出 / 更新、多机 LAN / 防火墙及平台 WebView 在目标环境验收；正式安装包与启动检查见 [安装版验收](./testing.md#安装版与启动验收)。

离线 fixture 不执行真实 broker 效果，worker 检查不启动 WebView，浏览器不能证明原生隔离或系统集成。记录执行环境与未验证范围，前台操作遵循 [桌面干扰边界](./testing.md#避免干扰本机桌面)。

## 自定义界面

视图命令声明 `ui.document: "main"`，文档放在 `ui/main.html`，打包传 `--ui-dir`。HTML 自包含 CSS、JavaScript、数据图片或框架构建结果，与清单、Wasm、`uiDocuments` 一起打包；目录预览绑定文档 ID / SHA-256 / 字节数，市场签名覆盖完整包。

[extension_ui.rs](../src-tauri/src/extension_ui.rs) 限定最多 32 份、单文档 512 KiB、总计 2 MiB，仅接受清单引用且 ID 无路径的文档。缓存按内容哈希命名，最多 64 MiB，不跟随链接；打开与回退重新校验，损坏 / 未来注册表保留。UI 是当前协议的可选字段，旧宿主可能拒绝；现有 schema 3 无需归档。

文档在无同源权限的 sandbox frame 中运行，专用协议按窗口 / 随机令牌复核安装代次、启用和命令授权。CSP 禁止直接网络、外部脚本、外部子 frame、worker、表单及基址修改；全 frame 启动脚本在作者代码前锁定 WebRTC，只向打包文档安装 SDK，初始 `about:blank` / `srcdoc` 子文档没有通道。带密钥的原生 IPC 发送入口只装在顶层宿主；子文档的上游只读元数据不含可用密钥传输。作者代码顺序不变，只取得受限 MessagePort，与宿主 DOM、凭据及原生对象隔离；通用 CSP 见 [安全规范](./security.md#csp)。

UI 没有逐 iframe 可抢占执行、CPU / 内存配额或跨平台独立 renderer 保证，Wasm 预算不覆盖 UI 死循环。连接 / 首屏超时、关端口和撤租约只能拒绝后续调用。产品若需终止失控同步 JavaScript，需另选可终止的独立执行边界，并在目标平台验证焦点、输入法、无障碍、崩溃重建和会话恢复。

消息桥绑定内容框实例、来源和安装身份，只接受声明字段、当前命令动作、检查点、产物索引及固定服务。单请求 2 MiB、状态推送 12 MiB，序号递增；畸形、超大或重放消息关闭端口。卸载、禁用、替换及关窗使旧端口失效，晚到结果不影响新实例；Wasm、网络、文件和 KV 继续走 Rust broker，长期服务不占 worker 维持连接。

桥的令牌桶容量 96、每秒补充 60 项，合计最多 4 项在途，可容纳 24 张图片下载 / 预览 / 释放的短突发。暂时过载返回 `EXTENSION_BUSY` / `retryable: true` 且不执行，消耗该序号，重试使用新请求；SDK 达到在途上限也返回忙碌，不自动重试。连续前 16 次过载返回忙碌，第 17 次关端口，获准执行后清零计数。该预算独立于图片处理、缓存、网络与授权限制，已执行的副作用按服务契约处理。

每个主 / 次窗口 AppShell 保留最近使用的最多 3 个插件页面，DOM 顺序稳定；非当前页 `hidden` / `inert`，退出布局和焦点顺序。保留时端口继续连接并发送 `active: false`，SDK 与桥拒绝新请求（`EXTENSION_UNAVAILABLE`），在途请求继续接收回执。切页收起扩展菜单 / 发送数据面板并保留草稿，晚到关闭回调保留用户的新焦点。隐藏时暂停执行轮询、语言刷新、主题 / 尺寸观察及握手 / 首屏计时；恢复同步最新设置并重置可见等待预算。作者局部循环按 [SDK 活动状态](../sdk/README.md#活动状态与页面保留) 暂停。

超出 LRU 时释放最旧文档 / 端口，保留现有会话 state、字段、检查点与脏工作回调，返回时重建。generation / 哈希 / 版本变化、禁用、卸载或必需命令授权失效立即移除旧页；可选授权变化只更新快照。原生界面租约按窗口、插件与命令入口隔离，同入口重建只替换自己的旧令牌。界面保留仍逐次校验身份和授权，失效的文件 / 图片 / 服务资源需重新取得，见 [ADR 0016](./adr/0016-retain-extension-surfaces.md)。

`checkpoint(value, dirty)` 登记最多 256 KiB JSON 草稿，从快照恢复，业务保存完成才置 `dirty: false`；宿主保存表示导出会话，保存期间冻结草稿。导入额外绑定文档哈希，沿用 [会话契约](#开发带界面的应用插件)。语言变化以 `action: null` 纯刷新活动视图，隐藏页延后到恢复时刷新。作者 API、主题 / 字体、共享样式、首屏握手及动效见 [SDK](../sdk/README.md)，共享控件取舍见 [ADR 0022](./adr/0022-shared-control-materials.md)。

宿主在侧栏当前插件项或独立窗口标题栏提供“扩展工具”，集中窗口、重载、会话导入 / 导出、发送数据、运行停止和结束会话。正文直接呈现业务内容，菜单与焦点行为遵循 [界面规范](./conventions/ui-guidelines.md)。发送数据在独立 Dialog 编辑，点击发送才调用插件，Esc 保留草稿并恢复焦点；会话持有导入选择 / 审阅，菜单关闭后仍处理晚到校验。

重载仅重建连接并恢复字段 / 检查点，失败保留会话并可重试，不重新运行 Wasm 初始化；未登记的局部状态无法恢复。界面取舍见 [ADR 0012](./adr/0012-extension-ui-surfaces.md)，检查入口见 [验证](#验证)。
