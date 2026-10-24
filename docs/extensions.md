# Extism 扩展开发与安装

扩展中心位于 `/extensions`。宿主使用 [Extism](https://extism.org/docs/overview/) 的 Rust SDK 运行 Wasm 模块，支持内置扩展、本地包导入和官方市场发现、下载与更新。扩展以带图标的卡片呈现，点击打开应用视图或文本工具。设计取舍见 [ADR 0007](./adr/0007-extism-extensions.md)、[ADR 0008](./adr/0008-extension-app-views.md)、[ADR 0009](./adr/0009-extension-surfaces.md) 与 [ADR 0010](./adr/0010-curated-extension-market.md)。

## 架构与兼容范围

插件使用官方 PDK 开发，宿主复用 Extism ABI、WASI、资源限制与取消，不加载原生程序、动态库或 Node.js。命令声明映射到 Wasm 导出函数，启用后注册到既有命令面板。文本工具需主动提交数据并运行，结果为文本、JSON 或安全 Markdown；应用命令打开声明式视图，首次加载和后续按钮点击均调用实际 Wasm 函数，只提交本视图的数据。

采用同一运行框架仍需匹配输入、导出函数和宿主能力。对于只依赖 Extism 标准能力的模块，可以不改源码，只补充本应用的安装清单。需要其他应用专有 Host Functions 的模块需要适配；完整 Node API、常驻服务、任意 HTML / React 页面及 VS Code API 不在本实现中。浏览器仅展示流程，不安装或运行原生存档中的模块。

旧的原生程序扩展是本分支未发布原型，已删除执行器、进程 SDK 与兼容分支。当前只接收包格式 2、API 1 和注册表 schema 2；旧版本或未来存档拒写并保留原件，不静默执行、迁移或清除旧程序。

若曾使用旧原型，先退出应用，将应用数据目录中的 `extensions/` 改名归档，再启动并重新安装 Wasm 包。保留归档，不删除设置或数据库。

如果扩展列表无法读取，先查看页面顶部的结构化错误。安装器升级会保留应用数据，重装不会清除旧扩展记录。确认是旧原型 schema 1 后按上述方法归档，再点击刷新；未来版本或损坏存档仍应保留原件，不能一律当作旧原型清除。

## 安装与体验

桌面版首次读取扩展列表时，将 **扩展实验室** 安装到“已安装扩展”，初始禁用且没有任何授权。确认信任及三项数据用途后启用；这一步不会执行 Wasm。页面没有第二份内置应用画廊。

实验室是实际 Rust PDK 插件，完整源码位于 [apps](../examples/extensions/apps/)，包含五个页签：

- 总览：能力说明、运行时与入口指标。
- 文本工坊：文本域、下拉框、复选框、大小写 / 空白转换、Unicode 字符统计、高频词表与安全预览。
- 数据连接：用户选择的文本文件与有界 HTTPS GET 响应；解析 JSON 表格，保留文件名与内容统计。
- 点灯解谜：5 × 5 棋盘、三关、撤销、重开、提示和胜负判断，全部规则在 Wasm 内。
- 开发协议：清单片段、宿主能力及源码入口。

启用后可从左侧导航、扩展卡片或命令面板打开普通页面；点击“在独立窗口打开”创建真正的系统窗口，复用主窗口皮肤、语言、主题与窗口按钮，保留最小化、最大化、关闭和拖动缩放。主窗口继续使用，没有模态遮罩。每个窗口拥有独立会话；重复打开同一扩展命令聚焦该系统窗口。

默认安装只发生一次，用户卸载后不自动重装；可在安装区域点击“恢复内置实验室”，审阅后手动安装。已有同 ID 包不覆盖、不自动启用或信任，达到安装上限时不强制插入；失败保留原记录。旧计算器 / 井字棋的已安装 Wasm 包可继续使用旧视图协议，用户可自行卸载，宿主不删除其会话或用户数据。

也可选择 `.starter-extension.json` 文件安装第三方插件。开发者的小型文本 / JSON 工具仍提供在 [多语言示例](../examples/extensions/)，使用相同的包审阅、安装与授权流程。

预览、安装和启用本身不执行插件；打开应用视图会执行其初始化函数。外部包继续默认禁用并要求确认信任。作者为包内自述；市场目录签名表示维护者发布该目录，SHA-256 标识内容，均不认证包内作者。升级需提高数字版本，清空授权并禁用，正在运行的旧实例收到停止请求。禁用和卸载先撤回入口并请求停止，运行租约直到实际执行结束才释放，退出也等待运行停止；已经发出的 HTTPS 请求不会被取消操作撤回。

## 官方插件市场

“已安装扩展”保留本地文件导入、内置实验室恢复和运行；“发现插件”读取维护者控制的签名目录，支持按名称 / 简介 / 作者 / ID 搜索、分类与推荐。市场版本高于本机版本时，在已安装卡片与市场卡片提供更新入口。下载只进入包审阅，用户明确确认后才安装，随后仍需授权启用。

市场仓库由主项目根目录的 `marketplace/` Git submodule 引用，源码、收录清单、发布工具和 Actions 独立维护。普通宿主构建不依赖子模块初始化；内置实验室继续由主仓库编译进应用。开发者需要市场源码时执行：

```sh
git submodule update --init --recursive
```

发布规则由 [独立市场仓库](https://github.com/YanChao001/tauri-desktop-starter-extensions#readme) 维护。先审核插件源码、许可、权限和宿主实际运行，再合并收录清单；在该仓库 Actions 手动运行“发布市场”。构建与签名使用独立任务，流程计算完整包与模块的独立哈希、签名并核对目录，先上传草稿 Release 的全部附件，成功后才发布为 latest。下架通过移除收录项并发布更高目录 revision 完成，已安装的用户数据保留。

市场仓库与 minisign 公钥集中在 `app.config.json` 的 `extensionMarket`；两项留空可禁用市场，派生新应用身份或主仓库时默认清除继承的市场信任；单独更换市场仓库时也清除旧公钥，需显式提供新源可信的公钥，初始化拒绝不完整配置。用户不能通过 IPC 指定另一个源或任意下载 URL。目录来自该仓库 latest Release 的 `catalog.json`，扩展包只来自签名目录所指向的同仓库 Release 附件。签名使用 Node 内置 Ed25519 / BLAKE2b 与既有 Rust `minisign-verify`，没有新增应用依赖。私钥只用于仓库外临时文件与受控 Actions Secret，不随客户端分发。

Rust 对下载实施 HTTPS、同仓库路径与 GitHub 附件重定向白名单、超时、目录 / 包大小和并发限制；目录验签后再次校验清单、ID 唯一性、revision、附件名、完整包哈希、模块哈希及完整元数据一致性。当前宿主进程缓存已验证目录五分钟；刷新失败保留该进程的旧目录并标明过期，重启不恢复缓存。每次下载都重新确认目标仍在上架，失败不修改安装记录。本地文件导入不依赖市场联网。浏览器仍展示原生能力边界，不模拟下载安装成功。

## 构建 Rust 示例

完整示例位于 [examples/extensions/rust](../examples/extensions/rust/)。它直接使用官方 `extism-pdk`，不依赖本项目私有 SDK；复制目录、修改导出函数和清单即可开始开发。

从仓库根运行：

```powershell
rustup target add wasm32-unknown-unknown
cargo build --manifest-path examples/extensions/rust/Cargo.toml --release --locked --target wasm32-unknown-unknown --target-dir src-tauri/target/extension-example
pnpm extension:pack --manifest examples/extensions/rust/extension.json --wasm src-tauri/target/extension-example/wasm32-unknown-unknown/release/starter_extism_text.wasm --out artifacts/extensions/rust-text-1.0.0.starter-extension.json
```

这是 Wasm 编译目标，同一模块可交给不同桌面平台上的兼容 Extism 宿主，不需要分别打包 Windows / macOS / Linux 原生程序。目标平台的宿主仍需实际验收。

## 构建 JavaScript 和 TypeScript 示例

[JavaScript 示例](../examples/extensions/javascript/) 展示普通文本与多个导出命令，[TypeScript 示例](../examples/extensions/typescript/) 展示 JSON 输入、选中文件与结构化结果。独立的 [示例工程](../examples/extensions/package.json) 使用官方 PDK 类型和 esbuild，不向应用前端增加运行时依赖。

先按 [官方 JS PDK](https://github.com/extism/js-pdk#install) 安装 `extism-js` 和 Binaryen，将 `extism-js`、`wasm-merge`、`wasm-opt` 加入 PATH。当前示例使用的编译器版本为 extism-js 1.7.0 / Binaryen 133；开发依赖由示例锁文件固定。

```powershell
pnpm --dir examples/extensions install --frozen-lockfile
pnpm --dir examples/extensions typecheck
pnpm --dir examples/extensions build
pnpm extension:pack --manifest examples/extensions/javascript/extension.json --wasm examples/extensions/dist/javascript.wasm --out artifacts/extensions/js-text-1.0.0.starter-extension.json
pnpm extension:pack --manifest examples/extensions/typescript/extension.json --wasm examples/extensions/dist/typescript.wasm --out artifacts/extensions/ts-report-1.0.0.starter-extension.json
```

TS 先由 esbuild 输出 ES2020 / CommonJS，再由官方编译器生成含 JavaScript 引擎的 Wasm。用户运行插件不需要安装 Node、Rust 或上述编译工具。纯计算 npm 包可随构建打包；依赖 Node 内置模块、DOM 或异步后台任务的包需要适配。本宿主没有直接联网能力，示例只接收本次 HTTPS broker 返回的数据。

打包脚本不执行模块，不覆盖已有输出。再次打包使用新文件名；完整的元数据、权限和命令校验由安装时的 Rust 边界执行。

## 包与输入契约

UTF-8 JSON 文件，推荐后缀 `.starter-extension.json`：

```json
{
  "manifest": {
    "formatVersion": 2,
    "apiVersion": 1,
    "id": "example.text-tool",
    "version": "1.0.0",
    "name": "Text tool",
    "author": "Example author",
    "description": "Transforms explicitly submitted text",
    "inputFormat": "text",
    "resultFormat": "text",
    "commands": [
      { "id": "uppercase", "title": "Uppercase", "function": "uppercase" }
    ],
    "permissions": ["text:read"],
    "allowedHosts": []
  },
  "wasm": "<standard base64 of the Wasm core module>"
}
```

`manifest` 是安装与界面元数据，`wasm` 中的模块仍使用标准 Extism ABI；这不是要求其他应用都采用的通用安装包格式。原始模块不被重写。可以指定已有模块的真实导出函数，使用文本输入传入其要求的 UTF-8 内容（包括插件自行约定的 JSON 字符串）。

Rust 的 DTO 和校验是契约来源，前端消费生成绑定。未知字段拒绝。包最多 24 MiB，模块最多 16 MiB，必须是 Wasm 核心模块；安装只检查格式和元数据，语义、导出与运行能力在执行时由 Extism 检查。ID 为不超过 80 字节的小写反向域名式标识，版本为三段 `0..65535` 数字；名称、作者、说明分别最多 120 / 120 / 1000 UTF-8 字节。支持 1–8 个命令，局部 ID 唯一，函数名最多 128 字节且仅含 ASCII 字母、数字、下划线、连字符或点。

| 字段                  | 作用                                                                                |
| --------------------- | ----------------------------------------------------------------------------------- |
| `inputFormat: "text"` | 将本次文本直接交给函数，不添加本项目请求包装；仅能声明文本用途                      |
| `inputFormat: "json"` | 文本工具接收下面的宿主请求；`view` 应用接收下节的视图请求                           |
| `resultFormat`        | `text`、`json`、`markdown`，或返回有版本声明式响应的 `view`                         |
| `icon`                | 可选：`puzzle`、`calculator`、`gamepad`、`notebook`、`terminal`；缺省使用拼图       |
| `ui`                  | 可选 `{ "sidebar": true, "window": true }`，仅适用于 `view`；声明侧栏和独立窗口入口 |
| `commands`            | 命令 ID、纯文本标题与实际 Wasm 导出函数名                                           |
| `permissions`         | 必须唯一，启用时逐项确认；每次运行仍需用户主动提交数据                              |

JSON 输入示例：

```json
{
  "apiVersion": 1,
  "inputText": "explicit text",
  "files": [{ "name": "sample.txt", "content": "saved text" }],
  "network": [
    { "url": "https://httpbin.org/get", "status": 200, "body": "response" }
  ]
}
```

| 用途            | 交付边界                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `text:read`     | 本次主动输入的文本，最多 64 KiB UTF-8                                                                   |
| `files:read`    | 最多 3 个工作台已授权资源，重新读取已保存版本，内容合计 64 KiB，只传文件名和内容                        |
| `network:https` | 本次主动填写的 HTTPS GET；manifest 同时声明 `httpbin.org` / `jsonplaceholder.typicode.com` 中的允许主机 |

未选择的数据为空数组。HTTPS broker 禁止凭据、其他主机、自定义端口与重定向，不使用宿主代理或凭据，最多 3 秒、64 KiB 严格 UTF-8；HTTP 状态由插件处理。它是演示用的有限数据接口，不能据此声称支持任意外部服务。

请求编码后最多 512 KiB，函数返回最多 64 KiB，拒绝 NUL 与无效 UTF-8。JSON 结果先在 Rust 验证；Markdown 复用既有安全组件，禁止原始 HTML、可执行 URL 和远程图片。结果不自动写入用户文件或笔记。

## 开发带界面的应用插件

复制 [apps 示例](../examples/extensions/apps/)，或在任意官方 PDK 工程中声明 `inputFormat: "json"`、`resultFormat: "view"`，将 `commands[].function` 指向处理视图的导出。图标使用宿主已有图标名，不加载外部图片或 SVG。页面、窗口、命令统一由同一份清单贡献：

```json
{
  "inputFormat": "json",
  "resultFormat": "view",
  "icon": "puzzle",
  "ui": { "sidebar": true, "window": true },
  "commands": [{ "id": "open", "title": "打开应用", "function": "app" }]
}
```

省略 `ui` 的旧视图包仍可在扩展中心打开普通页面。启用的 `sidebar` 命令进入侧栏“已安装扩展”组；窗口只由宿主 Rust 创建，仅加载本地页面，不接受插件 URL 或系统路径。禁用、卸载或升级会撤回入口，已打开页面显示不可用状态，旧运行收到停止请求；未保存会话仍可在关闭协商时导出或放弃。

首次打开发送 `action: null`、空 `state` 与 `fields`。后续操作传回上一次响应中的不透明状态、当前字段与语言。例如：

```json
{
  "version": 1,
  "action": "analyze",
  "state": "plugin-owned state",
  "fields": { "text": "hello", "mode": "upper" },
  "locale": "zh-CN"
}
```

仅当用户点击“发送所选数据”时，宿主额外附加 `data`，内容与上面的 `ExtensionRequest` JSON 相同，`action` 约定为 `host-data`。它经过相同的权限、文件资源 ID、主机、体积和超时检查；插件不能通过响应要求宿主自动读文件或联网。普通动作不附加 `data`，也不重新发送请求。插件应仅在本次包含 `data` 时更新对应结果。

输出是 Extism 的 UTF-8 JSON 字符串：

```json
{
  "version": 1,
  "state": "next plugin-owned state",
  "display": "文本工坊",
  "description": "由插件计算，宿主绘制",
  "fields": [
    { "id": "text", "label": "文本", "value": "hello", "kind": "textarea" }
  ],
  "groups": [
    {
      "columns": 1,
      "actions": [
        { "id": "analyze", "label": "分析", "disabled": false, "primary": true }
      ]
    }
  ],
  "blocks": [
    { "kind": "metrics", "items": [{ "label": "字符数", "value": "5" }] }
  ]
}
```

基础字段 `version/state/display/description/fields/groups` 必需，旧包不必增加新字段。以下为可选的通用视图能力；准确字段定义与校验以 [Rust 视图协议](../src-tauri/src/extension_view.rs) 为准，前端类型由此生成：

| 能力     | 字段与限制                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 页签     | `tabs: [{id,label,active}]`，最多 6 个，必须恰好一个激活；点击时 `action` 为页签 ID。页签与按钮动作 ID 不得冲突                    |
| 表单     | 最多 8 项；`kind` 为 `text`（默认）、`textarea`、`number`、`select` 或 `checkbox`；所有值均为字符串，复选值为 `"true"` / `"false"` |
| 选择项   | `options: [{value,label}]`，最多 20 个且 value 唯一；select 的值必须存在于选项中                                                   |
| 操作     | 最多 4 组，合计 36 个动作，列数 1–6；`board: true` 使用方格布局，`ariaLabel` 可提供独立的无障碍标签                                |
| Markdown | `blocks: [{kind:"markdown",text}]`，每块最多 8192 UTF-8 字节；复用安全 Markdown，不接受 HTML、可执行 URL 或远程图片                |
| 指标     | `{kind:"metrics",items:[{label,value}]}`，最多 8 项                                                                                |
| 表格     | `{kind:"table",columns:["列名"],rows:[["内容"]]}`，最多 8 列、100 行，行宽必须一致；单元格最多 512 UTF-8 字节                      |

状态最多 8192 UTF-8 字节；显示文本 512、说明 1000；字段值 2048、标签 120；每个视图最多 8 块、完整响应最多 64 KiB。ID 长度 1–80，只含 ASCII 字母、数字、下划线与连字符，字段和动作各自唯一。语言为 `zh-CN` 或 `en`。插件须校验自己的状态和动作，控件禁用只提供交互反馈，不构成安全边界。

宿主通过通用渲染器绘制上述组件，不执行插件 HTML、CSS、脚本或 React。可用 Tab、Enter / Space 操作；页签支持方向键。请求串行，失败保留输入和上次视图，不自动重试有副作用的动作。执行期间的临时锁定保留控件透明度与输入底色，避免每次点击都出现整片明暗闪动；插件声明的不可用操作仍正常置灰。运行状态和停止按钮保持布局位置，结果区有高度上限；页面允许收缩和滚动，不根据每次响应调整系统窗口大小。

同一窗口切换导航会保留会话与数据草稿；离页停止当时的运行，原生租约仍等待实际结束。会话可导出 JSON，目前不提供导入或跨重启恢复；导出期间离页再返回，操作锁仍保留到保存完成或取消，避免新编辑被旧导出错误标为已保存。“请求停止”取消当前操作并等待实际结束，保留输入与上次结果；“结束会话”清空输入、进度和结果后退出，不禁用或卸载扩展。系统关闭按钮走既有未保存工作协商，保存 / 放弃遵循 AbortSignal。页面停止与窗口关闭仅取消该窗口发起的执行，关闭等待停止后销毁；扩展窗口不采用主窗口“关闭到托盘”策略。退出、重启和更新协商覆盖扩展窗口。

内置模块是预编译的分发资源 [demo-apps.wasm](../resources/extensions/demo-apps.wasm)，普通宿主构建不依赖交叉编译目标。修改 Rust 示例后先格式化，再重建并提交模块与哈希清单：

```powershell
rustup target add wasm32-unknown-unknown
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml
pnpm extension:demos:build
pnpm extension:demos:check --rebuild
pnpm extension:pack --manifest examples/extensions/apps/extension.json --wasm resources/extensions/demo-apps.wasm --out artifacts/extensions/extension-lab-1.0.0.starter-extension.json
```

`pnpm extension:demos:check` 只核对源码、锁文件、工具链与已提交模块的哈希回执，不启动 Rust 编译；该快速检查已纳入 `pnpm verify`。`--rebuild` 在此基础上使用锁定工具链与 `wasm32-unknown-unknown` 实际编译，逐字节比较提交的 Wasm，不覆盖分发资源；CI Rust 矩阵执行这一模式。源码、依赖或工具链变化后都要重建资源，不能通过同时修改模块与哈希回执来替代编译比对。Rust 回归直接执行分发模块的文本分析、数据解析、全部页签和三关解谜规则。第三方也可用 JS / TS 官方 PDK 接收同样的 JSON，通过 `Host.outputString(JSON.stringify(view))` 返回视图。此视图协议是本应用的 UI 契约，Extism 本身通用的是模块 ABI，其他应用的专有界面协议仍需适配。该方案适合表单、计算器和回合制小游戏，不提供实时画布或任意网页界面。

## 执行、存储与生命周期

每次运行创建新的 Extism 实例，无常驻插件或跨运行变量持久化。进程内只保留最近一个 Extism `CompiledPlugin`，按实际模块 SHA-256、时限和 fuel 预算匹配；切换模块或预算会替换它。只复用不可变代码，内存、WASI、变量与执行额度每次重新创建。Wasm 线性内存最多 256 MiB，表最多 65536 项，Extism 变量最多 64 KiB；初始化和调用各有 fuel 预算，调用最多 5 秒。首次编译在阻塞线程执行，执行时限不包含 JIT 编译，编译本身不能被 Wasm 中断取消。停止后持有租约直到编译 / 执行真实结束，不把停止等待冒充回滚。

为支持 JS PDK 启用基础 WASI，不预开目录、不继承宿主环境或参数，不提供系统进程和网络 socket；同步 `poll_oneoff` 被拒绝，避免长时间阻塞调用逃过执行中断。直接 Extism HTTP、远程模块加载、文件注册和磁盘编译缓存均关闭；调试 dump / profiler 关闭。正常环境不继承标准输出；宿主设置 `EXTISM_ENABLE_WASI_OUTPUT` 会按上游行为启用调试输出，不应在正式分发环境设置。

全应用共享一个运行租约，无排队。禁用、升级、卸载、正常退出 / 重启和更新安装复用同一停止与等待机制。页面卸载请求停止本页运行，未导出内容使用已有未保存工作登记。命令面板的导航请求不覆盖尚未导出的会话。

注册表位于应用数据目录 `extensions/registry.json`（schema 2），模块位于 `extensions/packages/<sha256>/module.wasm`。最多 24 项、注册表 1 MiB、模块缓存 128 MiB。写入采用 revision CAS 和原子替换，跨窗口发变更事件；运行前核对启用状态、授权和哈希，并执行本次核验过的内存字节。启动恢复隔离时禁止使用扩展，未知存档拒写。卸载仅清理已知模块和空目录，不跟随链接或递归删除未知文件。

笔记备份和恢复归档不包含扩展注册表与模块，恢复后按可信来源重新安装。源码入口为 `extensions.rs`、`extension_runtime.rs`、`extension_commands.rs`、`extension_view.rs`、`extension_windows.rs` 和 `features/extensions/`；原生门面、命令注册与错误处理沿用项目约定。

## 依赖与分发

Extism 使用 BSD-3-Clause，Wasmtime 使用 Apache-2.0 WITH LLVM-exception。宿主关闭 Extism 默认 feature；直接声明 Wasmtime 仅用于设置池与表上限，复用同一锁定版本。它们增加原生编译时间和安装体积，不增加前端 Wasm 引擎依赖或 CSP 来源。扩展系统窗口单独使用 `capabilities/extensions.json`，只允许宿主事件、窗口控制、用户触发的剪贴板写入及受限外链，不开放直接文件、HTTP、通知或快捷键插件权限；这不是 Wasm 或自定义 Rust 命令的 ACL。新增运行时许可原文保留于 [resources/third-party](../resources/third-party/)，由安装器资源和便携打包一并分发；其余依赖清单以 Cargo 锁文件和各自许可为准。

## 验证

按 [Rust 检查](./testing.md#rust-测试) 验证宿主，按上面命令构建示例。真实包测试使用临时注册表完成安装、授权、执行与卸载，不启动应用窗口：

```powershell
$env:STARTER_TEST_EXTENSION_PACKAGE = (Resolve-Path artifacts/extensions/rust-text-1.0.0.starter-extension.json).Path
cargo test --manifest-path src-tauri/Cargo.toml --locked external_extism_package_roundtrip -- --ignored
```

JS 包同样使用默认输入 `hello` 和预期片段 `HELLO`；TS JSON 模式由测试构造文件 fixture。可用 `STARTER_TEST_EXTENSION_INPUT` / `STARTER_TEST_EXTENSION_EXPECT` 指定其他插件的输入和预期片段。

[upstream fixture](../examples/extensions/upstream/fixture.json) 固定官方 `count_vowels.wasm` 的发布 URL 和 SHA-256，下载后必须核对哈希，再使用相邻清单打包。输入 `hello`、预期 `"count":2`，用于证明未修改的外部 Extism 模块可以运行；不得用本项目自己编译的示例替代这个互操作验证。CI 覆盖 Rust 示例和此固定 fixture，JS / TS 编译依赖另行准备官方工具。

单元测试覆盖格式、权限、版本、未来存档、内存 / 表额度、初始化与调用预算、取消、租约和卸载。前端回归覆盖命令注册撤销、过期快照、安全展示、输入保留和晚到订阅；无头浏览器覆盖演示边界。它们不替代正式安装包、真实窗口、多窗口退出和各目标平台验收。
