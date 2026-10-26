# Extism 扩展开发与安装

扩展中心位于 `/extensions`。宿主使用 Extism 运行 Rust / JavaScript / TypeScript 编译的 Wasm，通过清单登记命令、侧栏与独立窗口，用类型化效果连接已授权的网络和私有数据，提供通用视图、隔离的自定义界面和有限桌面服务。能力宿主、界面与服务的长期取舍分别见 [ADR 0011](./adr/0011-capability-extension-host.md)、[ADR 0012](./adr/0012-extension-ui-surfaces.md)、[ADR 0013](./adr/0013-extension-desktop-services.md) 和 [ADR 0015](./adr/0015-plugin-media-capabilities.md)。浏览器演示提供限制说明，安装、运行和系统能力需要桌面环境。

## 架构与兼容范围

当前契约为 **包格式 3、API 2、视图版本 2、注册表 schema 3**。每条命令分别声明输入、结果、入口和所需能力；同一插件可以同时提供普通文本工具与应用视图。宿主复用 Extism ABI，不加载插件原生程序、动态库、Node.js 或远程网页，不提供 VS Code API 兼容层。

本轮媒体能力与壁纸库 **1.0.3** 要求 **0.1.6 配套原生宿主**，壁纸清单使用 `minHostVersion: "0.1.6"`；声明 `network:images`、`network:system-proxy` 或 `links:open` 任一权限时，Rust 强制最低宿主版本不得低于 0.1.6，其他包以各自清单为准。本轮更新源码和开发构建，不据此宣称已发布宿主安装包。需重新构建并重启 Rust 进程，前端刷新或 HMR 不能添加原生服务。新权限属于闭集枚举增量，旧宿主可能在检查最低版本之前就因无法解析目录而拒绝；仅调整清单数字不能倒修旧二进制。应使用兼容源码构建宿主，不通过改公钥、跳过校验或清空数据解决。

正式发行以宿主版本和包的 `minHostVersion` 建立兼容门槛；共享同一版本号的开发快照不作稳定 API 兼容承诺。每个正式版本必须包含该版本承诺的全部宿主能力；新增被插件依赖的能力时，须提高宿主版本，并将插件的最低宿主版本提高到包含该能力的正式版本，版本同步遵循[发行版本规则](./build-release.md#版本号四个地方必须一致)。市场 CI / 发布固定的 `host_ref` 只确定校验工具的源码，不能代替客户端的兼容校验，也不能给旧原生进程添加能力。

只依赖标准 Extism 能力的模块可保留原始 Wasm，补充本应用清单后调用真实导出函数；其他应用的专用 Host Functions 或界面协议仍需适配。插件的业务状态、动作和数据格式由插件自行校验；生成的 TypeScript 类型不能代替 Rust 和插件边界校验。

本轮属于开发阶段重构，**不兼容旧扩展包、视图、注册表和市场目录**。遇到旧版、未来版或损坏存档明确拒绝并保留原件，不自动迁移或清空。已知旧开发版可通过下面的归档入口重新建立当前扩展环境；未来版本或原因不明的损坏继续保留现场。重装应用会保留用户数据，不能代替存档处理。

## 旧开发版告警与恢复

“扩展包、API 或存档版本不兼容，原数据已保留”可能来自已安装的旧开发版注册表。读取注册表发生在登记内置包之前，因此更新 Wasm、重新编译或重新安装应用都不能单独解除旧存档的阻塞。

在扩展中心确认检测结果后，使用“归档旧扩展并重建”。原生只允许识别出的旧 schema 1 / 2，按确认时的原始摘要核对，且要求扩展没有活动任务、不在恢复隔离、暂停或退出期间。操作将整个 `extensions/` 原子改名到同级唯一归档位置，随后重新读取列表，按当前协议安装默认禁用且没有授权的内置本地工作台。归档位置会显示在界面中；原安装包与注册表完整保留，`extension-data/` 私有数据、系统凭据、设置、笔记及外部文件均不在此操作范围。

归档不是旧插件迁移。其他插件需重新安装当前协议的包，并重新审阅权限。原始内容在确认期间变化时返回冲突，应重新检测；移动失败时原目录不变，归档成功但后续初始化失败时仍保留归档，可重试读取。未来版本、损坏或不明结构、目录链接不提供重建按钮，不把它们自动认作旧开发版。不要在另一进程仍使用数据时从外部搬动目录。

## 安装与体验

用户主动安装或升级时，先审阅来源与必需权限，按需选择可选权限，点击“安装并启用”或“升级并启用”一次完成确认。原生端重新检查包、revision 与授权，在同一次注册表原子写入中完成安装和启用；缺少信任、必需授权、出现未知 / 重复授权或并发冲突时不改变原安装。安装本身不运行 Wasm。

可选权限区域提供“全选可选权限”，部分勾选时显示半选状态，可一次选中全部可选项或清除可选项；现有必需授权和其他授权仍按原确认流程处理。安装、升级、启用与管理权限复用同一权限列表，提交期间禁用选择控件，纯包详情不显示批量选择入口。

首次读取列表时，宿主只预置 **本地工作台** 的安装记录，默认禁用且没有授权；这不是用户主动安装，不代替用户确认。审阅包来源、命令和用途，确认信任后启用；必需能力需要全部同意，可选能力可以拒绝或随后在“管理权限”调整。工作台的文本、文件、网络与私有存储均为可选能力，可先启用体验离线工具。

本地工作台 2.2 的源码与实际额度见 [apps 说明](../examples/extensions/apps/README.md)，包含四个独立保留草稿的页签：

- 文本：从空白编辑器开始，提供九种转换、Unicode / UTF-8 统计、按需词频图表与 TXT 导出，支持 Ctrl / Command + Enter。
- CSV / JSON：粘贴数据或使用样例，预览表格、按需显示数值图表并安全导出；输入与其他工具分别保存。
- 待办：截止日期、完成 / 恢复、逐行删除、备份和清空确认；写入检查 revision，拒绝按过期行索引修改另一项任务。未授权存储时保留当前草稿。
- 文件与网络：查看用户显式发送的文件信息，或主动请求已声明 HTTPS 样例。接收后需明确载入文本或数据编辑器，不连带替换其他草稿。

工作台 2.2 使用会话 schema 3，旧会话明确拒绝并保留原文件。游戏和其他独立应用由市场插件提供。

启用且满足命令能力要求后，从卡片、命令面板或清单声明的侧栏入口打开。应用视图首次加载会执行初始化函数；预览、安装、启用本身不执行 Wasm。声明独立窗口入口的命令可创建本地宿主系统窗口，同一入口重复打开聚焦既有窗口，每个窗口保留自己的会话。默认安装只发生一次，卸载后不会自动重装；恢复内置扩展需要重新审阅和手动安装，同 ID 包不被默认资源覆盖。已有安装可在扩展中心检查内置版本，审阅后升级。

本地导入使用 `.starter-extension.json`。作者来自包内自述，内容 SHA-256 标识模块，市场签名表示维护者发布目录，均不能认证包内作者。安装升级要求更高的数字版本，并保留前一包供显式回退；回退撤销授权并禁用，需重新确认后启用，不是市场目录降级。

主动升级与首次安装一样，审阅后一次完成授权与启用。后台内置登记只在尚未初始化时预置工作台，不替换已存在的安装记录；内置资源更新也由用户重新审阅升级。

禁用、升级、卸载和权限变更撤回不可用入口并请求停止旧调用；租约在原生执行真正结束后释放。桌面服务还通过下述读写门闩等待已开始的调用结束，再撤回原身份持有的连接。卸载撤销该插件的系统凭据，私有数据和 LAN 历史保留，重装同 ID 后需重新授权访问。需要清除私有 KV 时，在卸载前进入详情中的存储概况，确认后清空；清空不结束当前会话，也不清除独立 LAN 历史。系统凭据删除失败会阻止卸载并保留重试信息。

## 包与输入契约

推荐使用开发工具生成 UTF-8 JSON 包，清单和核心 Wasm 以标准 base64 封装。最小文本示例：

```json
{
  "manifest": {
    "formatVersion": 3,
    "apiVersion": 2,
    "minHostVersion": "0.1.4",
    "id": "example.text-tool",
    "version": "1.0.0",
    "name": "Text tool",
    "author": "Example author",
    "description": "Transforms explicitly submitted text",
    "commands": [
      {
        "id": "uppercase",
        "title": "Uppercase",
        "function": "uppercase",
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

契约与校验源为 [extensions.rs](../src-tauri/src/extensions.rs)，未知字段拒绝。包最多 24 MiB，模块最多 16 MiB；支持 1–32 个命令，命令 ID 唯一。插件 ID 使用有界小写反向域名，版本与 `minHostVersion` 使用三段数字版本；最低宿主高于当前应用时明确提示不兼容。准确字符和长度限制由 Rust 校验，不在打包脚本重复维护另一套规则。

| 声明                                       | 用途                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 命令 `inputFormat`                         | `text` 原样交付本次 UTF-8 文本；`json` 接收宿主请求或视图请求                                             |
| 命令 `resultFormat`                        | `text`、`json`、`markdown` 或版本化声明式 `view`；视图必须配合 JSON 输入                                  |
| 命令 `ui`                                  | 视图可声明 `sidebar` / `window` 入口，并以可选 `document` 引用本地 HTML；省略时仍可在扩展中心打开通用视图 |
| 命令 `permissions`                         | 该命令的必需能力门槛，必须来自插件已声明能力；不满足时撤回或禁用入口                                      |
| 插件 `permissions` / `optionalPermissions` | 必需与可选能力集合，唯一且互不重叠；调整授权会停止旧调用                                                  |
| 插件 `network`                             | 精确 origin 和允许的 HTTP 方法，必须与声明的网络能力对应                                                  |

授权的主体是整个插件。命令所列能力决定其能否启动，不是此命令独立的权限上限；插件效果和主动发送的数据仍按该插件当前的全部授权检查。不得因为离线命令未列网络门槛，就推断已授予插件的网络能力不可用。

JSON 文本工具接收 `apiVersion: 2`、`inputText`、`files` 和 `network`。文本最多 1 MiB；最多 16 个当前用户主动选择的已授权文件，原始内容合计 2 MiB。文件只含名称、`mediaType`、`encoding`（`utf8` 或 `base64`）和内容，不含系统路径。`mediaType` 是提示，不是内容认证；插件须自行检查实际格式。选择不等于发送，用户提交后宿主重新读取保存的文件内容，不代发工作台未保存草稿。完整编码请求最多 4 MiB，base64 与 JSON 开销均计入。

JSON 与 Markdown 结果由 Rust / 安全组件检查，文本结果按纯文本显示，结果不自动写入笔记或文件。完整输入输出与体积检查统一在 [执行编排](../src-tauri/src/extension_execution.rs) 和 [视图协议](../src-tauri/src/extension_view.rs) 实施。

## 网络、凭据与私有数据

### 来源与授权

`network:https` 支持明确声明的公网 HTTPS 服务，`network:local` 单独允许精确的本机 HTTP 服务。例如：

```json
{
  "optionalPermissions": ["network:https", "network:local"],
  "network": [
    { "origin": "https://api.example.com", "methods": ["GET", "POST"] },
    { "origin": "http://127.0.0.1:3000", "methods": ["GET"] }
  ]
}
```

origin 必须是标准化的精确协议 / 主机 / 端口，不带路径、凭据、查询、片段或通配符。默认 `networkMode: "direct"` 禁用代理，公网 HTTPS 的所有解析地址必须通过公网地址检查，并固定到本次连接；拒绝私网、环回、映射、隧道与保留地址。本机 HTTP 仅接受 `localhost` 或字面环回地址，全部解析结果仍需为环回；它不开放局域网或任意内网。宿主禁止重定向和 Cookie，不因插件声明服务而增加 WebView CSP 来源。

HTTP 效果可显式选择 `networkMode: "system"`，但额外要求独立的 `network:system-proxy` 授权；省略时保持原有直连行为，本机 HTTP 不允许此模式。`system` 沿用用户已配置的系统 / 环境代理和 `NO_PROXY`，不会放宽清单的精确 origin、方法或响应额度。没有匹配代理或命中排除规则时仍校验并固定目标全部 DNS 公网地址。用户代理传输主机可以位于本机或内网；代理在远端解析目标时，宿主无法证明它最终连接的 IP 为公网，HTTPS、正常证书、禁跳转和内容校验仍生效。插件不能提交代理地址、关闭 TLS 或宣称支持任意 PAC。

支持 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`，逐次检查清单的方法集合和当前授权。请求正文最多 1 MiB，响应正文最多 2 MiB 严格 UTF-8，HTTP 请求最多 15 秒；头部数量和总字节另有限额。插件不能自行设置 Authorization、Cookie、代理和连接控制头。完整限制见 [extension_network.rs](../src-tauri/src/extension_network.rs)。

### 系统凭据

扩展详情中按清单 origin 配置凭据别名和密钥，最多 32 个别名，单个密钥最多 8 KiB。秘密进入系统 keyring，按应用、插件 ID、origin 与别名隔离，普通 JSON 仅保留可删除的配置位置。插件在 HTTP 效果中用 `credential` 引用别名，宿主只向匹配来源注入 Bearer 头；没有读取密钥的 IPC，宿主不直接把秘密作为字段返回插件或写入会话、私有 KV、日志；受信服务仍可能在响应中回显自己收到的数据，不能把引用机制当成对服务端的保密措施。

卸载、换来源替换、本地包替换与回退会清除旧凭据；同一已验证来源的允许保留授权升级继续使用对应别名。设置 / 删除失败明确报告，不用空值冒充成功。别名列表表示已登记的位置，不保证操作系统中仍可读取秘密；配置失败可重试或删除登记，运行时取不到会提示重新配置。隔离恢复与 E2E 构建不操作真实系统凭据，目标平台的 keyring 可用性需单独验收。

### 私有 JSON 存储

授予 `storage` 后，视图请求的 `host.storage` 提供该插件的 `{ revision, values }` 快照。插件通过 storage 效果提交 `expectedRevision` 和 `changes`，与当前修订不一致时返回冲突，不静默覆盖其他窗口。每插件最多 1 MiB、128 个键；使用原子替换，未知版本、损坏存档和链接路径拒写。存储文件自身使用 schema 1，与扩展注册表 schema 3 分开。

`changes` 的顶层 `null` 表示删除该键；需要保存 JSON null 时放入对象，例如 `{ "item": { "value": null } }`。嵌套 null 保持普通 JSON 语义。卸载保留 KV，显式清空使用同样的 revision CAS；它不属于笔记备份或应用会话文件。实现与更多额度见 [extension_storage.rs](../src-tauri/src/extension_storage.rs)。

## 受控桌面服务

自定义界面可通过 `starter.services.request("lan" | "wallpaper" | "resources" | "links", request)` 调用固定注册的服务。`lan` / `wallpaper` 的结果需从 `unknown` 收窄，图片资源和外链有对应 SDK 类型；类型均不能代替运行时校验。服务请求不执行 Wasm，不提供任意 IPC、服务注册、系统路径或 Shell；搜索业务可由插件通过 `run` 和 HTTP 效果完成。用法与错误处理见 [SDK](../sdk/README.md#注册的宿主服务)，原生权威边界见 [extension_services.rs](../src-tauri/src/extension_services.rs)。

| 入口                                   | 清单能力                                                                   | 实际范围                                                           |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Wasm HTTP 效果                         | `network:https` / `network:local`，使用系统代理另需 `network:system-proxy` | 精确 origin 和方法的有界文本请求，供应商业务由插件解释             |
| `resources`                            | `network:images`，使用系统代理另需 `network:system-proxy`                  | 任意公网 HTTPS GET 图片资源的安全下载、预览、另存与释放            |
| `wallpaper`                            | `wallpapers:manage`；资源导入另需 `network:images`                         | 现有本机图库、图片资源导入与应用背景设置，不负责搜索供应商         |
| `links`                                | `links:open`                                                               | 安全打开外部 HTTPS 来源页                                          |
| `lan`                                  | `messaging:lan`                                                            | 手动私有 IP 连接、有限文本收发、联系人与本地历史，不是通用后台任务 |
| `starter.notify`                       | 无独立系统能力授权                                                         | 宿主界面 toast，不是操作系统通知                                   |
| 操作系统通知、系统剪贴板、通用后台任务 | 未开放                                                                     | 本轮没有实际调用者，不提供空壳接口或任意原生 IPC                   |

这些权限可以声明为必需或可选；没有授权时，相应操作拒绝调用，无关的离线功能仍可使用。`network:images` 不等于精确 origin 的文本 HTTP 授权，`wallpapers:manage` 也不隐含图片网络或外链授权。壁纸插件将新增网络、图片和外链能力声明为可选，可仅授权图库后使用本机图片；旧安装不自动获得新授权。宿主附加当前安装 ID、模块哈希、代次和原生窗口，Rust 在每次请求中复核启用、授权及窗口令牌，不相信插件自述身份。服务请求持有读门闩；替换、撤权、禁用和卸载持有写门闩，等待已开始的调用结束，再协调资源撤回，不提前报告撤权完成。

每项请求的 `ServicePermit` 在真实原生操作全程计入活动租约，关闭、退出、重启和更新流程等待下载、对话框及其他已开始工作完成，不因前端停止等待而释放。最终写入在短提交临界区复核窗口生命周期，关闭后的请求不得再提交。资源所有者还绑定原生窗口 epoch，同 label 重开产生新归属，旧窗口晚到的清理不能停止新窗口资源；这些规则不回滚已经完成的写入或发送。

### 局域网文本聊天

`lan` 使用受限 TCP 协议，提供 `status`、`start`、`stop`、`connect`、`send`、`markRead`、`nickname`、`clearHistory` 和 `forget` 动作。启动监听与连接均由用户明确操作，不扫描网段或自动发现，也不调整系统防火墙。地址仅接受私有 / 环回 IP 字面量及允许的本地链路地址，不解析任意主机名，不提供文件传输。实际地址、端口、文本、连接、帧与工作线程额度由 [extension_lan.rs](../src-tauri/src/extension_lan.rs) 校验。

首版通信为**明文、无账户认证**；昵称、节点标识与已送达回执不构成对端身份认证或加密保证。仅在用户信任的网络使用，不把它描述为 QQ / 微信连接、安全消息服务或互联网聊天。联系人、有限历史和未读状态按插件保存在 `extension-data/lan/`，使用独立 schema、原子写入与体积限制；它们不是私有 KV，不进入通用会话导出或笔记备份。损坏、未来版本或链接路径拒写并保留原件。

连接由原生服务持有，使用过该服务的原生窗口构成所有者集合。同一窗口切换页面、卸载 iframe 或暂停前端轮询，不会自动停止监听和接收；无需保留隐藏 iframe 或长期 Wasm 实例。用户可明确停止服务；最后一个使用窗口真正销毁、插件禁用 / 撤权 / 换安装身份 / 卸载，或应用退出时，宿主停止自己持有的连接并保留历史。多个窗口共享该插件服务，停止会影响其他窗口；关闭一个窗口不结束其他仍持有的使用窗口。原生关闭不冒充已发送消息回滚，业务需要核对回执并避免自动重发。

### 壁纸图库与图片搜索

`wallpaper` 复用宿主图库和设置，不另存应用背景偏好；它管理的是**应用背景**，不设置操作系统桌面壁纸。动作仅包括 `list`、本机 `import`、`import-resource`、`apply`、`rename`、`remove` 和 `open-settings`。本机图片通过原生对话框选择；导入资源接收 `resourceId` 和名称，其他管理操作使用图库内容 ID 与受校验参数，不接受系统路径或远程 URL。背景更新使用 settings revision CAS 并同步窗口，移除当前背景仍需确认并恢复纯色背景。

搜索 URL、请求参数、Bing / Commons 等供应商的响应解析和许可说明属于插件，宿主不再内置供应商解析器。壁纸包通过精确授权的 HTTP 效果取得搜索文本，界面将候选图片交给 `resources`。**宿主不再证明图片来自 Bing，也不认证供应商或许可**；来源解释由经过审核的插件承担，用户应按原站核对用途。供应商响应失败、验证码、页面改版和不支持结果由插件明确反馈，不能把空集合或旧图库冒充搜索成功。实际供应商行为见[壁纸插件说明](../marketplace/plugins/wallpaper-browser/README.md)。

`network:images` 明确允许任意公网 HTTPS 的 GET 图片来源，不要求把每个动态图片原站列入文本 HTTP 的精确 origin 清单。图片 URL 的路径和查询也可能向原站发送信息，因此必须独立审阅；不能把这个权限描述为仅访问某搜索供应商。宿主仍拒绝不安全 URL、非公网目标、重定向和错误内容，只返回经过校验的图片资源。`networkMode` 默认为 `direct`；选择 `system` 额外要求代理授权，并遵循前述代理信任边界，不能提交自定义代理或关闭 TLS。

| `resources` 动作 | 请求                      | 结果与行为                                                           |
| ---------------- | ------------------------- | -------------------------------------------------------------------- |
| `fetch-image`    | `url`、可选 `networkMode` | 返回 `resourceId`、真实 `mime`、`bytes`、`width`、`height`、`sha256` |
| `preview`        | `resourceId`              | 返回 `{ dataUrl }`，内容经过有界重绘，不让 iframe 直接访问原站       |
| `save`           | `resourceId`、可选 `name` | 用户在系统对话框选择路径；取消返回 `cancelled: true`，成功返回名称   |
| `release`        | `resourceId`              | 释放当前资源，返回 `null`                                            |

图片下载的 DNS、传输和读体整体最多 20 秒，原始字节最多 16 MiB，只接受真实 JPEG / PNG / WebP；单边最多 8192 像素、合计 1600 万像素、解码分配预算 128 MiB。资源缓存使用 `Arc` 持有原图，TTL 为 10 分钟；每个窗口所有者最多 8 个 / 32 MiB，全局最多 32 个 / 64 MiB，下载和图像处理最多 2 项并发。缓存预算不等于整个进程内存上限。资源绑定插件 ID、模块哈希、安装代次与窗口 epoch，跨窗口、换身份、过期或释放后的新请求拒绝使用；关闭和撤权会清理对应缓存。在途操作持有的资源保留到真实操作结束，最终写入仍须复核生命周期。`resourceId` 不是可导出的授权，重启或导入会话不会恢复资源，应重新下载。

**另存原图**保留已验证原图字节，由用户选择路径；**加入图库**通过 `import-resource` 重绘压缩，服从既有图库数量 / 单图额度。两项都在最终提交前复核生命周期，不把预览或缓存成功当作保存完成。显式 `release` 只阻止后续查找，已经取得 `Arc` 并进入保存或其他在途操作的资源保持到真实操作结束；关窗仍须等待原生活动，最终提交会拒绝已关闭窗口的写入。资源与图库共用图片处理名额，缩略图 CPU 工作不占用最终提交的窗口锁；图库预览忙或损坏时保留 `dataUrl: null`，不把缩略图失败报告成已经成功的图库写入失败。图库、背景设置和注册表 schema 没有迁移，不删除原始数据。

这是未正式发行的开发态协议调整，不在宿主保留旧 `search`、`resultId` 或 Commons `pageId` 供应商兼容入口。壁纸 1.0.2 的旧搜索需升级为 1.0.3 并使用 0.1.6 宿主；已有本机图库和背景设置保留。以后在已提供能力范围内修复供应商解析可只更新插件，新增宿主能力仍须配套升级。

### 来源外链

授予 `links:open` 后，可调用 `starter.services.request("links", { url })` 请求宿主安全打开外部 HTTPS 来源页。宿主校验公共域名和 URL 结构；最终连接由系统浏览器完成，不能声称控制浏览器的 DNS 或后续导航。该授权不允许文件、其他协议、任意命令或任意 IPC；打开来源页也不证明图片许可。它与 `network:https`、`network:images` 和图库权限独立，缺少外链授权不应阻塞已授权的本机图库操作。

## 界面能力与适用范围

通用视图适合表单、文本工具、数据展示与回合制操作。`fields/groups/blocks` 的布局由宿主固定组织，不能任意交错控件与内容，也不提供实时 Canvas、通用指针 / 拖拽或游戏方向键事件。需要这些交互时，作者在自定义 HTML 中组织界面和局部运行循环，不按每一帧调用 Wasm。

Wasm 继续负责业务逻辑与受控能力。需要自由布局的应用使用下文的 [自定义界面](#自定义界面)，简单工具可以继续选择通用视图；两者共享授权和执行服务。

## 开发带界面的应用插件

参考 [本地工作台](../examples/extensions/apps/) 或 [TypeScript notebook](../examples/extensions/typescript/)，在单条命令声明 JSON 输入、`view` 结果和需要的入口。采用通用视图时，插件返回描述字段、按钮、展示块和状态的 JSON，由 [宿主 React 渲染器](../src/features/extensions/extension-view.tsx) 生成 HTML / DOM 并应用主题样式，作者无需提供 HTML / CSS。采用自定义界面时，再声明本地 HTML 文档，使用同一视图与能力边界。普通文本命令可以只返回文本，不提供视图。

Rust / JavaScript / TypeScript 可编译为符合宿主 Extism ABI 的 Wasm；Wasm 中的 JavaScript 与隔离界面的网页脚本属于不同上下文。通用视图由宿主绘制，自定义界面可使用 HTML、CSS、DOM、Canvas 或框架构建结果；均不开放宿主 DOM、任意原生 IPC 或远程入口。

首次请求 `version: 2`、`action: null`、空 `state` / `fields` 和当前语言；后续动作交回不透明状态与当前字段。宿主添加 `host`（当前授权与可用存储快照），插件不能通过前端伪造它。只有用户点击“发送所选数据”时才额外附加 `data`，`action` 为 `host-data`；普通动作不会重新读取已选文件或重复发送这个输入。但插件可在拥有网络授权时返回 HTTP 效果，不能将“未点击发送所选数据”理解为禁止插件发起已授权效果。

插件可在视图响应的 `effects` 返回以下类型：

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

宿主先整批检查本轮效果 ID 的重复和全动作 16 项预算，再预检下一轮 state / fields 能否为宿主上下文和每项结果收据留出编码空间；不满足时，在本批效果执行前拒绝。通过预检后按顺序执行，保留上一视图的 state / fields 并刷新宿主上下文，使用 `action: "host-result"` 和 `results: [{ id, value, error }]` 再次调用同一导出。聚合结果过大时，已完成效果的超量 `value` 置为 `null`，对应错误为 `INPUT_TOO_LONG`，明确说明操作已完成、响应被省略、不要自动重试，并保留该项 ID 与其他结果收据；不能将响应省略解释为操作未执行。

整个动作最多 8 轮、合计 16 个效果，采用 60 秒合作取消预算，不包含调度排队；同步操作系统 I/O 不能硬性限时，租约仍保留到实际完成。效果批次不是事务，取消或插件下一轮返回无效仍可能导致整个动作报错，不能保证总能回传收据。插件应处理结构化失败 / 冲突，不解析错误文字，也不能自动重试有外部副作用的操作；已完成的网络或 KV 写入不会因之后失败或取消而回滚。准确规则见 [extension_execution.rs](../src-tauri/src/extension_execution.rs)。

视图基础字段为 `version/state/display/description/fields/groups`；页签、块、字段错误、效果和产物可选。当前通用控件与预算如下，完整 DTO 以 [extension_view.rs](../src-tauri/src/extension_view.rs) 为准：

| 能力       | 范围                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 表单       | 最多 24 项；文本、多行、数字、选择、复选、日期；值为字符串。默认单字段 64 KiB，可用 `maxBytes` 提高到 256 KiB，字段值合计 1 MiB；`errors` 按字段 ID 关联 |
| 页签与按钮 | 最多 12 页签，恰好一个激活；最多 16 组、合计 128 个动作，支持棋盘和独立无障碍标签                                                                        |
| 展示块     | 最多 24 块；安全 Markdown、指标、分页表格、折线 / 柱状图、有限进度和内嵌图片                                                                             |
| 表格与图表 | 表格最多 32 列、2000 行；图表最多 8 组序列、1000 个标签，数值须有限；宿主提供分页和可读替代内容                                                          |
| 图片       | 仅有界 PNG / JPEG / WebP base64 data URL，检查文件头和尺寸，不支持 SVG 或远程 URL                                                                        |
| 状态与响应 | 状态最多 256 KiB，完整请求与响应各最多 4 MiB；字段、显示文本和各块另有各自上限                                                                           |
| 结果产物   | 最多 8 个，每个解码后最多 2 MiB，仍受完整响应预算约束；文本、CSV / TSV、JSON、Markdown、PDF、ZIP、PNG / JPEG / WebP，文件名 / 后缀 / MIME / 编码匹配     |

请求串行，失败保留输入和上次视图。运行锁通过可访问的不可用状态阻止重复动作并保留焦点，逻辑上不可用的按钮仍禁用，纯展示棋盘格不作为按钮。页签按数量与可用宽度排布。Tab、Enter / Space 和页签方向键仍可操作；运行或排队时提供状态与停止入口。单独“保存结果”或保存产物只通过用户选择的原生路径写出，不自动执行、解压或导入生成文件；取消保存不清除会话未保存标记。安全 Markdown 不执行 HTML 或危险 URL。

同一窗口切换导航保留会话与数据草稿，离页请求停止本页运行。会话可导出和导入 JSON：保存和导入共用 32 MiB 文件预算，包含输入、结果和检查点的 JSON 转义开销；专用原生保存入口不扩大普通文本导出的 8 MiB 上限。要求插件 ID、命令、版本、模块哈希和视图 / 工具种类完全匹配，用户确认替换才恢复输入、状态与结果；不执行 Wasm、不恢复授权、不重新授予文件资源。只记录文件名，导入后需重新选择文件。会话不包含系统凭据，也不等同于私有 KV 的备份。

会话中的原始视图仍经 Rust 完整结构与预算校验；未提交字段草稿单独恢复，受每字段 256 KiB、合计 1 MiB 的硬额度约束。超过作者字段额度或尚不符合控件语义的草稿可保留，纠正前禁止业务运行，SDK 动作也不能绕过；超过恢复硬额度的内容在保存前拒绝并保留未保存状态，避免生成无法重导入的文件。语言刷新只合并草稿字段，不改写已经验证的原始视图。

嵌入页和独立窗口共用精简工具条，只保留扩展标识、必要状态与“扩展工具”菜单；低频的扩展中心、窗口打开、导入、导出与数据交付集中在菜单中，内容区不重复宿主面包屑。生成产物仍由用户明确选择保存。独立窗口提供语言和主题切换，复用宿主设置并跨窗口同步；主题的圆形切换同时覆盖宿主外壳与隔离文档，减少动效或不支持过渡时直接更新。初始逻辑尺寸复用主窗口配置，后续按入口独立记忆，统一适配 DPI 和显示器工作区。

结束有进度或仍在运行的会话时，先选择导出、放弃或取消；取消导出或中止确认不清空草稿。系统关闭继续使用统一的未保存工作协商，保存 / 放弃遵循 AbortSignal；原生停止真正完成后才释放占用。独立扩展窗口正常关闭，不采用主窗口关闭到托盘策略。窗口创建与退出 / 重启 / 更新协商互斥；窗口关闭会使该窗口旧运行和排队请求失效，同 label 重开也不恢复旧请求。长期桌面服务跟随原生窗口所有权，见 [桌面服务](#受控桌面服务)，不能用界面暂离推断连接已经停止。

## 构建 Rust 示例

示例使用官方 Extism PDK，宿主私有协议的辅助 DTO 位于示例源码；无需为每个平台编译一份插件。首次使用开发 CLI 会通过 Cargo 构建本机 `extension-tool`，不启动桌面窗口；它仍需要项目 Rust / 平台编译环境。

从仓库根运行：

```powershell
pnpm build
rustup target add wasm32-unknown-unknown
cargo build --manifest-path examples/extensions/rust/Cargo.toml --release --locked --target wasm32-unknown-unknown --target-dir src-tauri/target/extension-example
pnpm extension:validate --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm
pnpm extension:test --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm --fixture examples/extensions/rust/smoke.json
pnpm extension:pack --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm --out artifacts/extensions/rust-text-1.0.0.starter-extension.json
```

`validate` 复用 Rust 清单、导入 / 导出和模块编译校验，不创建实例、不运行 Wasm start；`test` 在真实无界面 worker 中执行离线 fixture，再按命令结果类型检查。`pack` 使用同一权威校验后包装包，不执行插件，不覆盖已有输出。打包不代表网络、凭据或多窗口工作流已经验收。

fixture 示例 `{ "command": "uppercase", "input": "Hello", "expectOutput": "HELLO" }`；JSON 输入可为对象，也可提供 1–32 个 fixture 的数组按顺序执行，以验证取消后重建等流程。`expectOutput`、`expectJson`、`expectJsonSubset`、`expectError` 必须且只能选一个，分别比较完整文本、JSON 等价、手写 JSON 对象子集或稳定错误码。子集断言需要非空对象，对象递归核对所列字段，数组与标量仍完全相等；视图在比较前始终经过 Rust 完整格式校验，可用 `{ "version": 2, "display": "Scientific Calculator", "effects": [] }` 核对稳定行为，不必复制整份不透明状态。`cancelAfterMs` 用于取消回归，通常预期 `USER_CANCELLED`，不等同于运行预算耗尽的 `EXTENSION_TIMEOUT`。离线 fixture 不执行宿主效果或 SDK 桌面服务，需要效果结果时提供合成请求，真实 broker / CAS / TCP 仍由服务测试覆盖。已编译开发工具可用 `STARTER_EXTENSION_TOOL` 指定绝对路径复用，避免每次 Cargo 启动。

## 构建 JavaScript 和 TypeScript 示例

[JavaScript](../examples/extensions/javascript/) 展示多条文本命令，[TypeScript](../examples/extensions/typescript/) 展示数据报告与私有 notebook。[示例 SDK](../examples/extensions/sdk.ts) 与 Rust 示例 DTO 帮助构造本宿主协议，模块 ABI 仍使用官方 Extism PDK。

安装官方 `extism-js` 与 Binaryen，将 `extism-js`、`wasm-merge`、`wasm-opt` 加入 PATH；`EXTISM_JS` 可指定编译器路径。示例和 CI 使用的工具版本以示例工程与工作流为准。然后从根目录执行：

```powershell
pnpm --dir examples/extensions install --frozen-lockfile
pnpm --dir examples/extensions typecheck
pnpm --dir examples/extensions build
pnpm extension:validate --manifest examples/extensions/javascript/extension.json --wasm examples/extensions/dist/javascript.wasm
pnpm extension:test --manifest examples/extensions/javascript/extension.json --wasm examples/extensions/dist/javascript.wasm --fixture examples/extensions/javascript/smoke.json
pnpm extension:pack --manifest examples/extensions/typescript/extension.json --wasm examples/extensions/dist/typescript.wasm --out artifacts/extensions/ts-report-1.0.0.starter-extension.json
```

TS 经 esbuild 输出 CommonJS，再由官方编译器生成包含 JavaScript 引擎的 Wasm。用户运行插件无需安装 Node、Rust 或开发工具；纯计算依赖可随构建打包，Node 内置模块、DOM、常驻异步任务需要适配。

内置本地工作台使用提交的预编译 [demo-apps.wasm](../resources/extensions/demo-apps.wasm)，普通应用构建无需交叉编译目标。修改源码、清单、依赖、HTML 或工具链后重建并提交模块与回执：

```powershell
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml
pnpm extension:demos:build
pnpm extension:demos:check --rebuild
```

不带 `--rebuild` 只核对源码、清单、锁文件、工具链及模块哈希回执，已纳入 `pnpm verify`；完整模式在锁定工具链下实际编译，比较提交的 Wasm，不覆盖分发资源。CI 使用完整模式，快速回执不代替源码编译比对。

## 执行、存储与生命周期

宿主最多同时执行 2 项，等待队列最多 16 项；同一窗口串行，按可运行窗口的队列顺序调度。排队可取消，关闭窗口使其旧请求失效。排队等待不计入 60 秒完整动作的合作取消预算；动作取得租约后包含显式数据 broker、Wasm 与最多 8 轮 / 16 项效果。到期或取消先请求停止并等待实际服务结束，同步文件 / 系统凭据等操作系统 I/O 不能保证在预算内返回，因此可能超过 60 秒，不提前释放租约，也不回滚已完成的副作用。

Wasm 在固定当前应用可执行文件的 `--extension-worker` 子进程执行，分派早于 Tauri 初始化；不加载插件原生程序。每次 worker 调用总预算 15 秒，包含槽等待、进程创建、通信、编译、初始化和执行，超时、取消或协议断连会终止并回收本次拥有的进程。两个无界面 worker 空闲时可复用，各自最多 4 条编译 LRU、源模块合计 32 MiB；这个额度不是 JIT 真实内存占用上限。每次调用仍创建新实例，线性内存 / 变量 / WASI 状态不共享，线性内存最多 256 MiB，初始化和调用分别有 fuel 预算。

worker 不继承宿主环境、预开目录或插件标准输出，不提供直接 Extism HTTP、文件注册、远程模块下载或系统命令，拒绝同步 WASI `poll_oneoff`。磁盘编译缓存、dump 和 profiler 关闭。进程分离用于终止与故障恢复，worker 仍以当前用户身份运行，不能称为额外的操作系统权限沙箱。

应用数据目录的 `extensions/registry.json` 使用 schema 3、revision CAS 与原子替换，最多 64 项；模块按内容哈希缓存，总量 128 MiB，并保留仍被运行租约使用的模块和前一包。运行租约先释放名额，缓存清理在阻塞线程执行；同一 Store 合并清理请求，最多保留一个排队或执行中的清理任务。注册表与私有 KV 复用路径检查，拒绝链接祖先和 Windows 重解析点；重复结构字段、未知或未来 schema 拒写并保留原件。每个已安装记录另有 `generation`：安装、替换与回退都会更换，启用 / 授权调整不更换；即使模块哈希相同，重装、不同清单或来源仍是新的安装身份。涉及该身份的 IPC 核对 generation 与模块哈希，避免晚到的旧管理请求操作新记录；注册表变更仍使用 revision CAS。运行前另核对当前授权，使用本次核验的模块字节。私有 KV 与凭据别名元数据分别保存在 `extension-data/storage/` 和 `extension-data/credential-slots/`；笔记备份 / 恢复归档不包含这些扩展数据。隔离恢复禁止扩展运行与安装，不以删除用户数据恢复。

## 官方插件市场

市场使用固定仓库、公钥与签名目录，支持发现、分类、推荐与版本提示。下载先进入审阅，明确确认后才安装；原生市场安装入口重新核对验签目录、完整包和来源收据，本地导入不能伪装市场来源。来源记录包括仓库、公钥指纹、目录 revision 和完整包哈希。

**当前客户端要求目录 schema 2。** 若线上 latest 仍为旧 schema 1 目录，维护者需要在独立市场仓库完成格式 3 / API 2 插件构建、验签和新目录发布，才可提供兼容的线上发现 / 下载；本地包与内置本地工作台可独立工作。实际状态应核对公开 Release，代码、离线 fixture 或 CI 配置更新不代表市场已在线完成升级。

从 0.1.6 起，同一已验签目录中的未来插件不会仅因未知清单正文阻断其他条目：只有严格有效且高于当前原生宿主的 `minHostVersion` 才允许隔离正文。目录和附件元数据、兼容头、全目录 ID 去重、UI 文档元数据及重复 JSON 字段仍严格检查；坏签名、时间、哈希、资产名等错误不会被隔离掩盖。无法理解的未来条目仅提供名称、ID、版本、最低宿主和分类的只读摘要，不进入下载或安装索引；能完整理解的未来条目保留预览，但原生在附件下载前拒绝不兼容版本，界面也不提供可执行的下载或升级操作。当前或更低最低宿主的未知清单仍拒绝整份目录。该修复不会倒改 0.1.5 及更旧二进制。

市场错误按可信校验结果区分：验签成功但目录协议不支持时提示“不兼容”；当前协议的有效签名目录到期时提示“已过期”，需维护者续签并发布更高修订；坏签名、无效时间范围或包完整性不一致仍提示“校验失败”。前两类也不允许安装，不通过接受旧协议、修改公钥或删除信任状态恢复。仅推送分支同样不会更新市场，需按市场发布流程生成新的已签名 Release 并设为 latest。刷新失败时可保留最后已验证目录作展示，但下载和安装仍由原生重新核验。

市场源码由 `marketplace/` Git 子模块引用，普通宿主构建不要求初始化：

```sh
git submodule update --init --recursive
```

`app.config.json` 的 `extensionMarket.repository` 与 `publicKey` 固定信任源，两项为空禁用市场。派生新应用身份 / 主仓库时默认清除继承的市场配置；单独更换市场仓库也清除旧公钥，配置不完整拒写。IPC 不接受任意下载 URL，目录和扩展包仅来自配置仓库的 GitHub Release，附件重定向逐跳受限。

目录 schema 2 的签名 payload 包含 `issuedAt` / `expiresAt`（UTC Unix 秒）、完整清单、模块与包哈希、大小、分类及附件位置。宿主最多接受 30 天有效期和 5 分钟签发时钟容差，当前发布工具生成 7 天有效期；到期前需发布更高 revision。验签后的进程缓存最多 5 分钟且不能超过签名截止；失败可显示该进程旧目录并标为过期，安装 / 下载不得依靠过期目录。目录内容缓存不跨重启恢复，已知最高 revision 和摘要则原子持久化到 `extension-market/trust.json`，按仓库与公钥指纹隔离，拒绝回退和同 revision 内容替换；摘要始终覆盖完整原始签名 payload，包含被隔离的未来正文，不因宿主产生不同可用条目投影而改变。损坏或未来 trust 存档拒写，不自动重置信任。

维护者通过 [市场仓库](https://github.com/YanChao001/tauri-desktop-starter-extensions#readme) 的收录清单和发布流程控制上架。本地市场收录科学计算器、贪吃蛇、局域网聊天和壁纸库，与内置本地工作台组成五个应用；计算器提供真实表达式解析、绘图和有界数值分析，贪吃蛇在本地运行游戏与合成音效，另两款分别使用 [LAN / 壁纸服务](#受控桌面服务)。入口见 [市场说明](../marketplace/README.md)，开发、测试、安全与发布操作见 [市场文档索引](../marketplace/docs/README.md)。旧市场应用移出收录和源码，不远程删除用户已安装包或历史。市场当前构建流程固定使用 Rust / Cargo，宿主的 JS / TS 示例并不自动接入市场构建。市场构建使用宿主开发 CLI 对真实模块进行权威校验和手写 fixture 验收；离线检查使用临时测试密钥，不代表已用生产公钥发布。

先审核源码、许可、权限和宿主实际运行，再构建、签名、核对所有附件并发布；私钥仅在仓库外临时文件和受控 Secret 中使用。下架通过移除收录项并发布更高 revision，停止新下载，不远程删除已安装包。用户显式回退上一包与目录防回退是不同操作，不能靠降低目录 revision 回滚分发。

## 依赖与分发

Extism 使用 BSD-3-Clause，Wasmtime 使用 Apache-2.0 WITH LLVM-exception，精确版本见 Cargo 锁文件。宿主关闭 Extism 默认 feature，复用 Wasmtime JIT 与现有 keyring、HTTP 和签名依赖。新增编译与 worker 成本应以目标安装包实测；macOS Hardened Runtime / 签名安装版的 JIT 仍需 [单独验收](./build-release.md#macos)。

扩展宿主窗口使用 [`capabilities/extensions.json`](../src-tauri/capabilities/extensions.json) 的有限事件、窗口、剪贴板写入与外链能力，不开放直接文件 / HTTP 插件权限。capability 不等同于自定义 Rust 命令或 Wasm 授权的 ACL。第三方许可原文保留于 [resources/third-party](../resources/third-party/)，随安装器资源和便携包分发。

## 验证

按 [Rust 检查](./testing.md#rust-测试) 准备前端产物并验证原生服务，再使用开发 CLI 对实际编译的 Rust / JS / TS 模块与固定 [上游 fixture](../examples/extensions/upstream/fixture.json) 执行 validate / 离线 smoke。上游模块下载后需核对固定 SHA-256，不以本项目模块代替互操作检查。

`pnpm extension:test:worker` 在开发工具可执行程序中检查真实 worker 的取消后重建、断连、实例隔离、帧与 I/O 超限，不启动 WebView；worker 期限单元测试另外检查整体超时。普通 `cargo test` 的进程内运行时测试不能替代这项进程边界检查。存储 / 网络 / 效果、调度、市场过期和跨重启防回退使用隔离数据的服务回归；前端检查授权、入口撤回、会话导入、单独保存与失败输入保留，无头浏览器检查布局与原生限制。

线上联通检查须使用实际已发布且仍有效的配套目录。正式安装版、系统 keyring、真实多窗口退出 / 更新、多机 LAN、防火墙与各目标平台 WebView 仍需独立环境验收；不能把源码中存在测试、CI 配置或浏览器 mock 写成这些项目已实测通过。

## 自定义界面

视图命令可在 ui 中增加 document（例如 main），作者将自包含 HTML 放在 ui/main.html，通过打包脚本的 --ui-dir 指定目录。HTML 可以内嵌 CSS、JavaScript、数据图片或框架构建结果，插件独立组织业务布局；普通工具仍可使用通用视图。清单、Wasm 和 uiDocuments 一起进入包，目录预览额外绑定文档 ID、SHA-256 与字节数，市场签名覆盖完整包。Rust 规则与资源服务见 [extension_ui.rs](../src-tauri/src/extension_ui.rs)，无需另写 UI 布局语言。

单文档最多 512 KiB、每包合计 2 MiB、最多 32 份，仅接受实际被引用的文档；ID 不包含路径。缓存以内容哈希命名，上限 64 MiB，不跟随链接。打开和回退都会核验内容，未知未来注册表或损坏资源不会被重建覆盖。包 / API / 视图版本保持不变，UI 字段是可选扩展；旧宿主拒绝带未知字段的新包，新宿主无需归档现有 schema 3 数据。

UI 在无同源权限的 sandbox frame 中运行。专用原生协议按宿主窗口和随机令牌读取文档，重新检查安装代次、启用和命令授权。子文档 CSP 禁止直接网络、外部脚本、子 frame、worker、表单与基址修改；宿主 CSP 仅开放专用 frame 来源，主界面脚本策略不放宽。原生传输使用 Tauri 的 invoke_system 入口，在创建任何带密钥的发送函数前检查顶层 frame；这是对 WebView2 仍向子框注入初始化脚本行为的显式防护。子框可能存在上游只读元数据，但没有可用的带密钥 IPC 发送入口。界面 SDK 通过原生全 frame 文档启动脚本，在作者脚本前锁定 WebRTC 传输构造器；不改写作者 HTML 的解析顺序、事件或模块语义。子界面仅获得 [界面 SDK](../sdk/README.md) 的 MessagePort；不共享宿主 DOM、凭据或原生对象。该机制不等于操作系统级 UI 进程资源沙箱。普通 DOM / Canvas 和包内脚本由浏览器执行，Wasm 的内存 / 时间预算不覆盖 UI 死循环。

桥绑定具体内容框实例、来源和安装身份，只接收已声明字段、当前命令动作、草稿检查点、当前视图产物索引或已注册的有限桌面服务。单请求最多 2 MiB、每秒最多 60 次、合计至多 4 个在途请求；宿主状态推送最多 12 MiB，以容纳原有完整视图、当前字段与检查点，请求序号递增；畸形、重放或超额消息关闭端口。Wasm、网络、文件与 KV 继续由 Rust 能力 broker 校验，Wasm 动作受现有执行及取消预算约束；长期桌面服务有独立资源与原生窗口生命周期，不占用 Wasm 工作进程维持连接。界面被卸载、禁用、替换或关闭后旧端口失效，晚到结果不操作新实例。

插件使用 checkpoint(value, dirty) 明确登记最多 256 KiB 的 JSON 草稿，并从后续快照恢复；局部动画、布局和焦点不调用 Wasm。通用导出包含检查点并绑定文档哈希，导入不执行插件，文件需重选，凭据不导出。插件可用自己的按钮保存业务数据，再将 dirty 设为 false；宿主生命周期中的保存仍明确表示导出会话。保存中不能改变草稿或把仍在运行的工作报告为已保存。

SDK 注入默认 CSS layer，提供与宿主一致的字体、控件、语义色、焦点、圆角和滚动条；普通作者样式可直接覆盖，无需复制组件库。主题 token、字体、动效偏好和语言来自宿主设置，插件不另存同一份偏好。主题圆形过渡会同步到隔离文档，减少动效或能力不足时直接应用。完整 API 和样式约定见 [界面 SDK](../sdk/README.md)。

首次加载按真实状态展示骨架，收到非空视图并完成 SDK 首轮主题 / DOM 呈现握手后显示内容框，不用人工延时凑加载时长；握手停滞显示可重试错误，后台或离屏不按前台等待误报，后续业务忙碌保持内容可见。这是呈现机会检查，不证明作者业务渲染成功。普通单选 select 默认渐进增强，保留原 DOM 的值、事件与表单语义，可明确退出为原生交互；具体支持范围和作者覆写方式统一见 [默认外观与动效](../sdk/README.md#默认外观与动效)。

语言变化立即推送新 `locale`，SDK 更新文档 `lang`，作者在 `onChange` 中重绘固定文案。宿主等待当前动作结束，再用 `action: null` 携带已有 state / fields 重新渲染 Wasm 视图，保留输入和检查点；插件应把它视为环境刷新，不能清空会话、自动保存或重复执行上次业务动作。

宿主正文顶部不再绘制扩展图标、名称、工具行或额外导航条。嵌入页面的“扩展工具”位于左侧当前扩展导航项的右端：侧栏展开时，导航链接与工具按钮同排且互为相邻元素，不将按钮嵌入链接；折叠为 56px 图标栏时，工具入口放在当前扩展图标下方。独立窗口在自定义标题栏显示清单图标与名称，长名称截断并以 title 保留全名，加载期间显示本地化的扩展标题；主题按钮之后是工具入口，再接最小化等窗口控制，不显示搜索入口。这里不改变操作系统窗口图标。工具入口保留悬停延迟 650 ms 的 Tooltip。

“扩展工具”使用紧凑 DropdownMenu，只显示图标、文字菜单项和分隔线，不放标题、分组标签、常驻说明或表单。菜单提供打开独立窗口、重新加载界面、导出 / 导入会话、发送数据等动作；业务持续忙碌到延迟阈值后提供停止项，结束会话标为危险操作。菜单不承担返回扩展中心导航。

发送数据使用独立 Dialog，复用当前授权与会话草稿，只有用户点击发送才调用插件；Esc 取消保留草稿并将焦点返回工具入口。导入的隐藏文件选择、审阅与校验由菜单外的会话持有，菜单关闭不会使晚到的校验结果失效。重新加载只重建界面连接，恢复本窗口字段与检查点，不重新执行 Wasm 初始化。界面响应失败会保留会话并提供重试；未上报检查点的纯局部状态无法恢复。

实现取舍与分层验收见 [ADR 0012](./adr/0012-extension-ui-surfaces.md)。浏览器 CSP / 布局回归、原生资源与真实 Wasm 回归、实际桌面 WebView 验收分别记录，不能互相替代。
