# Extism 扩展开发与安装

扩展中心位于 `/extensions`。宿主使用 Extism 运行 Rust / JavaScript / TypeScript 编译的 Wasm，通过清单登记命令、侧栏与独立窗口，用类型化效果连接已授权的网络和私有数据，统一绘制声明式界面。长期取舍见 [ADR 0011](./adr/0011-capability-extension-host.md)。浏览器演示提供限制说明，安装、运行和系统凭据需要桌面环境。

## 架构与兼容范围

当前契约为 **包格式 3、API 2、视图版本 2、注册表 schema 3**。每条命令分别声明输入、结果、入口和所需能力；同一插件可以同时提供普通文本工具与应用视图。宿主复用 Extism ABI，不加载插件原生程序、动态库、Node.js 或任意网页，不提供 VS Code API 兼容层。

只依赖标准 Extism 能力的模块可保留原始 Wasm，补充本应用清单后调用真实导出函数；其他应用的专用 Host Functions 或界面协议仍需适配。插件的业务状态、动作和数据格式由插件自行校验；生成的 TypeScript 类型不能代替 Rust 和插件边界校验。

本轮属于开发阶段重构，**不兼容旧扩展包、视图、注册表和市场目录**。遇到旧版、未来版或损坏存档明确拒绝并保留原件，不自动迁移或清空。已知旧开发版可通过下面的归档入口重新建立当前扩展环境；未来版本或原因不明的损坏继续保留现场。重装应用会保留用户数据，不能代替存档处理。

## 旧开发版告警与恢复

“扩展包、API 或存档版本不兼容，原数据已保留”可能来自已安装的旧开发版注册表。读取注册表发生在登记内置包之前，因此更新 Wasm、重新编译或重新安装应用都不能单独解除旧存档的阻塞。

在扩展中心确认检测结果后，使用“归档旧扩展并重建”。原生只允许识别出的旧 schema 1 / 2，按确认时的原始摘要核对，且要求扩展没有活动任务、不在恢复隔离、暂停或退出期间。操作将整个 `extensions/` 原子改名到同级唯一归档位置，随后重新读取列表，按当前协议安装默认禁用且没有授权的内置实验室。归档位置会显示在界面中；原安装包与注册表完整保留，`extension-data/` 私有数据、系统凭据、设置、笔记及外部文件均不在此操作范围。

归档不是旧插件迁移。其他插件需重新安装当前协议的包，并重新审阅权限。原始内容在确认期间变化时返回冲突，应重新检测；移动失败时原目录不变，归档成功但后续初始化失败时仍保留归档，可重试读取。未来版本、损坏或不明结构、目录链接不提供重建按钮，不把它们自动认作旧开发版。不要在另一进程仍使用数据时从外部搬动目录。

## 安装与体验

桌面版首次读取扩展列表时安装 **扩展实验室**，默认禁用且没有授权。审阅包来源、命令和用途，确认信任后启用；必需能力需要全部同意，可选能力可以拒绝或随后在“管理权限”调整。实验室的文本、文件、网络与私有存储均为可选能力，可先启用体验离线页签。

实验室源码位于 [apps](../examples/extensions/apps/)，包含总览、文本工坊、数据连接、待办与偏好、点灯解谜和开发协议六个页签：

- 文本工坊提供九种转换、Unicode 统计、词频图表与独立文本产物，载入内容、统计和导出保持一致。
- 数据连接保留显式发送的文本 / 二进制文件与声明来源的 HTTPS 效果，增加 CSV / JSON 表格预览、数值图表和安全导出。
- 待办与偏好演示私有存储、revision 冲突、日期、字段错误、完成进度与备份导出；列表在其他窗口被修改后拒绝按旧行索引写入。不授予存储时其他离线功能仍可使用。
- 点灯解谜有六关、撤销、重玩和提示，导入状态按操作历史重放校验；宿主只绘制通用棋盘控件。

启用且满足命令能力要求后，从卡片、命令面板或清单声明的侧栏入口打开。应用视图首次加载会执行初始化函数；预览、安装、启用本身不执行 Wasm。声明独立窗口入口的命令可创建本地宿主系统窗口，同一入口重复打开聚焦既有窗口，每个窗口保留自己的会话。默认安装只发生一次，卸载后不会自动重装；“恢复内置实验室”需要重新审阅和手动安装，同 ID 包不被默认资源覆盖。

本地导入使用 `.starter-extension.json`。作者来自包内自述，内容 SHA-256 标识模块，市场签名表示维护者发布目录，均不能认证包内作者。安装升级要求更高的数字版本，并保留前一包供显式回退；回退撤销授权并禁用，需重新确认后启用，不是市场目录降级。

只有来自同一内置来源或同仓库 / 公钥的已验证市场来源、major / minor 不变、必需能力不超出已有授权且网络来源 / 方法不扩大的 patch 升级，才保留启用状态和仍声明的已有授权。新增可选能力不会自动授予。本地包、换来源、扩大权限或网络范围及 major / minor 升级均重新确认并默认禁用。

禁用、升级、卸载和权限变更撤回不可用入口并请求停止旧调用；租约在原生执行真正结束后释放。卸载撤销该插件的系统凭据，私有数据保留，重装同 ID 后可重新授权访问。需要清除私有数据时，在卸载前进入详情中的存储概况，确认后清空；清空不结束当前会话。系统凭据删除失败会阻止卸载并保留重试信息。

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

| 声明                                       | 用途                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| 命令 `inputFormat`                         | `text` 原样交付本次 UTF-8 文本；`json` 接收宿主请求或视图请求                        |
| 命令 `resultFormat`                        | `text`、`json`、`markdown` 或版本化声明式 `view`；视图必须配合 JSON 输入             |
| 命令 `ui`                                  | 仅视图可声明 `{ "sidebar": true, "window": true }`；省略时仍可在扩展中心打开普通页面 |
| 命令 `permissions`                         | 该命令的必需能力门槛，必须来自插件已声明能力；不满足时撤回或禁用入口                 |
| 插件 `permissions` / `optionalPermissions` | 必需与可选能力集合，唯一且互不重叠；调整授权会停止旧调用                             |
| 插件 `network`                             | 精确 origin 和允许的 HTTP 方法，必须与声明的网络能力对应                             |

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

origin 必须是标准化的精确协议 / 主机 / 端口，不带路径、凭据、查询、片段或通配符。公网 HTTPS 的所有解析地址必须通过公网地址检查，并固定到本次连接；拒绝私网、环回、映射、隧道与保留地址。本机 HTTP 仅接受 `localhost` 或字面环回地址，全部解析结果仍需为环回；它不开放局域网或任意内网。宿主禁止重定向、代理和 Cookie，不因插件声明服务而增加 WebView CSP 来源。

支持 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`，逐次检查清单的方法集合和当前授权。请求正文最多 1 MiB，响应正文最多 2 MiB 严格 UTF-8，HTTP 请求最多 15 秒；头部数量和总字节另有限额。插件不能自行设置 Authorization、Cookie、代理和连接控制头。完整限制见 [extension_network.rs](../src-tauri/src/extension_network.rs)。

### 系统凭据

扩展详情中按清单 origin 配置凭据别名和密钥，最多 32 个别名，单个密钥最多 8 KiB。秘密进入系统 keyring，按应用、插件 ID、origin 与别名隔离，普通 JSON 仅保留可删除的配置位置。插件在 HTTP 效果中用 `credential` 引用别名，宿主只向匹配来源注入 Bearer 头；没有读取密钥的 IPC，宿主不直接把秘密作为字段返回插件或写入会话、私有 KV、日志；受信服务仍可能在响应中回显自己收到的数据，不能把引用机制当成对服务端的保密措施。

卸载、换来源替换、本地包替换与回退会清除旧凭据；同一已验证来源的允许保留授权升级继续使用对应别名。设置 / 删除失败明确报告，不用空值冒充成功。别名列表表示已登记的位置，不保证操作系统中仍可读取秘密；配置失败可重试或删除登记，运行时取不到会提示重新配置。隔离恢复与 E2E 构建不操作真实系统凭据，目标平台的 keyring 可用性需单独验收。

### 私有 JSON 存储

授予 `storage` 后，视图请求的 `host.storage` 提供该插件的 `{ revision, values }` 快照。插件通过 storage 效果提交 `expectedRevision` 和 `changes`，与当前修订不一致时返回冲突，不静默覆盖其他窗口。每插件最多 1 MiB、128 个键；使用原子替换，未知版本、损坏存档和链接路径拒写。存储文件自身使用 schema 1，与扩展注册表 schema 3 分开。

`changes` 的顶层 `null` 表示删除该键；需要保存 JSON null 时放入对象，例如 `{ "item": { "value": null } }`。嵌套 null 保持普通 JSON 语义。卸载保留 KV，显式清空使用同样的 revision CAS；它不属于笔记备份或应用会话文件。实现与更多额度见 [extension_storage.rs](../src-tauri/src/extension_storage.rs)。

## 界面能力与适用范围

当前视图适合表单、文本工具、数据展示与回合制操作。`fields/groups/blocks` 的布局由宿主固定组织，尚不能任意交错控件与内容，也没有通用方向键、指针 / 拖拽事件或实时渲染能力。2048 和故事骰子能运行，不表示界面已达到独立应用的交互水平。

Wasm 是业务逻辑与宿主能力边界，不要求 UI 必须使用固定表单。为复杂应用提供隔离的本地自定义界面、同时保留简单工具视图的方案见 [ADR 0012（提议中）](./adr/0012-extension-ui-surfaces.md)。该能力尚未实现，不能把 HTML / CSS 放入当前包后直接运行，也不通过放开宿主 DOM 或任意 IPC 临时实现。

## 开发带界面的应用插件

复制 [apps 示例](../examples/extensions/apps/) 或 [TypeScript notebook](../examples/extensions/typescript/)，在单条命令声明 JSON 输入、`view` 结果和需要的入口。插件返回描述字段、按钮、展示块和状态的 JSON，由 [宿主 React 渲染器](../src/features/extensions/extension-view.tsx) 生成 HTML / DOM 并应用主题样式，因此插件作者不需要单独提供 HTML 或 CSS。普通文本命令可以只返回文本，不提供视图。

Rust / JavaScript / TypeScript 是插件逻辑的实现语言，编译结果均为符合宿主 Extism ABI 的 Wasm；这里的 JavaScript 运行在 Wasm 内的引擎中，不作为网页脚本执行。宿主不加载插件自定义 HTML、CSS、React 组件或远程页面，不开放 DOM、Canvas 与任意 WebView。需要自由网页布局的功能超出当前视图协议，不能通过在包中添加 `index.html` 获得支持。

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

同一窗口切换导航保留会话与数据草稿，离页请求停止本页运行。会话可导出和导入 JSON：导入上限 8 MiB，要求插件 ID、命令、版本、模块哈希和视图 / 工具种类完全匹配，经结构和 Rust 视图预算校验后，用户确认替换才恢复输入、状态与结果；不执行 Wasm、不恢复授权、不重新授予文件资源。只记录文件名，导入后需重新选择文件。会话不包含系统凭据，也不等同于私有 KV 的备份。

导入、导出与数据交付收在默认折叠的“会话工具”，生成产物的保存入口保持可见。结束有进度或仍在运行的会话时，先选择导出、放弃或取消；取消导出或中止确认不清空草稿。系统关闭继续使用统一的未保存工作协商，保存 / 放弃遵循 AbortSignal；原生停止真正完成后才释放占用。独立扩展窗口正常关闭，不采用主窗口关闭到托盘策略。窗口创建与退出 / 重启 / 更新协商互斥；窗口关闭会使该窗口旧运行和排队请求失效，同 label 重开也不恢复旧请求。

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

fixture 示例 `{ "command": "uppercase", "input": "Hello", "expectOutput": "HELLO" }`；JSON 输入可为对象，也可提供 1–32 个 fixture 的数组按顺序执行，以验证取消后重建等流程。`expectOutput`、`expectJson`、`expectJsonSubset`、`expectError` 必须且只能选一个，分别比较完整文本、JSON 等价、手写 JSON 对象子集或稳定错误码。子集断言需要非空对象，对象递归核对所列字段，数组与标量仍完全相等；视图在比较前始终经过 Rust 完整格式校验，可用 `{ "version": 2, "display": "2048", "effects": [] }` 核对稳定行为，不必复制整份不透明状态。`cancelAfterMs` 用于取消回归。离线 fixture 不执行宿主效果，需要效果结果时提供合成请求，真实 broker / CAS 仍由服务测试覆盖。已编译开发工具可用 `STARTER_EXTENSION_TOOL` 指定绝对路径复用，避免每次 Cargo 启动。

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

内置实验室使用提交的预编译 [demo-apps.wasm](../resources/extensions/demo-apps.wasm)，普通应用构建无需交叉编译目标。修改源码、清单、依赖或工具链后重建并提交模块与回执：

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

应用数据目录的 `extensions/registry.json` 使用 schema 3、revision CAS 与原子替换，最多 64 项；模块按内容哈希缓存，总量 128 MiB，并保留仍被运行租约使用的模块和前一包。每个已安装记录另有 `generation`：安装、替换与回退都会更换，启用 / 授权调整不更换；即使模块哈希相同，重装、不同清单或来源仍是新的安装身份。涉及该身份的 IPC 核对 generation 与模块哈希，避免晚到的旧管理请求操作新记录；注册表变更仍使用 revision CAS。运行前另核对当前授权，使用本次核验的模块字节。私有 KV 与凭据别名元数据分别保存在 `extension-data/storage/` 和 `extension-data/credential-slots/`；笔记备份 / 恢复归档不包含这些扩展数据。隔离恢复禁止扩展运行与安装，不以删除用户数据恢复。

## 官方插件市场

市场使用固定仓库、公钥与签名目录，支持发现、分类、推荐与版本提示。下载先进入审阅，明确确认后才安装；原生市场安装入口重新核对验签目录、完整包和来源收据，本地导入不能伪装市场来源。来源记录包括仓库、公钥指纹、目录 revision 和完整包哈希。

**当前客户端要求目录 schema 2。** 若线上 latest 仍为旧 schema 1 目录，维护者需要在独立市场仓库完成格式 3 / API 2 插件构建、验签和新目录发布，才可提供兼容的线上发现 / 下载；本地包与内置实验室可独立工作。实际状态应核对公开 Release，代码、离线 fixture 或 CI 配置更新不代表市场已在线完成升级。

市场错误按可信校验结果区分：验签成功但目录协议不支持时提示“不兼容”；当前协议的有效签名目录到期时提示“已过期”，需维护者续签并发布更高修订；坏签名、无效时间范围或包完整性不一致仍提示“校验失败”。前两类也不允许安装，不通过接受旧协议、修改公钥或删除信任状态恢复。仅推送分支同样不会更新市场，需按市场发布流程生成新的已签名 Release 并设为 latest。刷新失败时可保留最后已验证目录作展示，但下载和安装仍由原生重新核验。

市场源码由 `marketplace/` Git 子模块引用，普通宿主构建不要求初始化：

```sh
git submodule update --init --recursive
```

`app.config.json` 的 `extensionMarket.repository` 与 `publicKey` 固定信任源，两项为空禁用市场。派生新应用身份 / 主仓库时默认清除继承的市场配置；单独更换市场仓库也清除旧公钥，配置不完整拒写。IPC 不接受任意下载 URL，目录和扩展包仅来自配置仓库的 GitHub Release，附件重定向逐跳受限。

目录 schema 2 的签名 payload 包含 `issuedAt` / `expiresAt`（UTC Unix 秒）、完整清单、模块与包哈希、大小、分类及附件位置。宿主最多接受 30 天有效期和 5 分钟签发时钟容差，当前发布工具生成 7 天有效期；到期前需发布更高 revision。验签后的进程缓存最多 5 分钟且不能超过签名截止；失败可显示该进程旧目录并标为过期，安装 / 下载不得依靠过期目录。目录内容缓存不跨重启恢复，已知最高 revision 和摘要则原子持久化到 `extension-market/trust.json`，按仓库与公钥指纹隔离，拒绝回退和同 revision 内容替换；损坏或未来 trust 存档拒写，不自动重置信任。

维护者通过 [市场仓库](https://github.com/YanChao001/tauri-desktop-starter-extensions#readme) 的收录清单和发布流程控制上架。本地市场源码包含文字工坊、2048、数织和创作骰子，入口见 [市场说明](../marketplace/README.md)，开发、测试、安全与发布操作见 [市场文档索引](../marketplace/docs/README.md)。市场当前构建流程固定使用 Rust / Cargo，宿主的 JS / TS 示例并不自动接入市场构建。市场构建使用宿主开发 CLI 对真实模块进行权威校验和手写 fixture 验收；离线检查使用临时测试密钥，不代表已用生产公钥发布。

先审核源码、许可、权限和宿主实际运行，再构建、签名、核对所有附件并发布；私钥仅在仓库外临时文件和受控 Secret 中使用。下架通过移除收录项并发布更高 revision，停止新下载，不远程删除已安装包。用户显式回退上一包与目录防回退是不同操作，不能靠降低目录 revision 回滚分发。

## 依赖与分发

Extism 使用 BSD-3-Clause，Wasmtime 使用 Apache-2.0 WITH LLVM-exception，精确版本见 Cargo 锁文件。宿主关闭 Extism 默认 feature，复用 Wasmtime JIT 与现有 keyring、HTTP 和签名依赖。新增编译与 worker 成本应以目标安装包实测；macOS Hardened Runtime / 签名安装版的 JIT 仍需 [单独验收](./build-release.md#macos)。

扩展宿主窗口使用 [`capabilities/extensions.json`](../src-tauri/capabilities/extensions.json) 的有限事件、窗口、剪贴板写入与外链能力，不开放直接文件 / HTTP 插件权限。capability 不等同于自定义 Rust 命令或 Wasm 授权的 ACL。第三方许可原文保留于 [resources/third-party](../resources/third-party/)，随安装器资源和便携包分发。

## 验证

按 [Rust 检查](./testing.md#rust-测试) 准备前端产物并验证原生服务，再使用开发 CLI 对实际编译的 Rust / JS / TS 模块与固定 [上游 fixture](../examples/extensions/upstream/fixture.json) 执行 validate / 离线 smoke。上游模块下载后需核对固定 SHA-256，不以本项目模块代替互操作检查。

`pnpm extension:test:worker` 在开发工具可执行程序中检查真实 worker 的取消后重建、断连、实例隔离、帧与 I/O 超限，不启动 WebView；worker 期限单元测试另外检查整体超时。普通 `cargo test` 的进程内运行时测试不能替代这项进程边界检查。存储 / 网络 / 效果、调度、市场过期和跨重启防回退使用隔离数据的服务回归；前端检查授权、入口撤回、会话导入、单独保存与失败输入保留，无头浏览器检查布局与原生限制。

当前线上旧目录与新协议不兼容，线上联通检查须等市场配套发布后执行。正式安装版、系统 keyring、真实多窗口退出 / 更新及各目标平台仍需独立环境验收；不能把源码中存在测试、CI 配置或浏览器 mock 写成这些项目已实测通过。
