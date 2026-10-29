# 扩展界面 SDK

使用自包含 HTML 编写隔离的插件界面；清单的视图命令声明 `ui.document: "main"`，文档放在 `ui/main.html`，打包时传入 `--ui-dir <目录>`。CSS、JavaScript、图片和框架构建结果均内嵌。包、权限、隔离和消息限额统一见 [扩展指南](../docs/extensions.md#自定义界面)。

宿主在文档开始时注入 [extension-ui.js](./extension-ui.js)，插件无需复制或加载运行时 SDK。外部作者将 `sdk/` 复制到独立项目即可使用 [extension-ui.d.ts](./extension-ui.d.ts)；至少保留该文件和 [generated/protocol.d.ts](./generated/protocol.d.ts)，无需检出宿主 `src/` 或安装 Tauri。公开 DTO 仍以 Rust 为类型来源，从生成绑定提取传递依赖，不携带宿主命令实现。

SDK 编译进 Rust：修改后须重新构建并重启桌面进程，前端 HMR 不会更新它；新宿主会向已安装插件注入新 SDK，无需重新打包插件。维护者修改 Rust DTO 后运行 `pnpm bindings:generate`，它会同时更新 IPC 与 SDK 公共类型；仅调整 SDK 引用范围时可运行 `pnpm extension:sdk:generate`。`pnpm bindings:check`、`pnpm extension:sdk:check` 和 CI 检查生成结果是否漂移，不手改生成声明。

```html
<button id="refresh" type="button" aria-disabled="true">刷新</button>
<pre id="result"></pre>
<script>
  const refresh = document.querySelector("#refresh");
  let busy = true;
  starter.onChange((snapshot) => {
    busy = snapshot.busy || snapshot.active === false;
    refresh.setAttribute("aria-disabled", String(busy));
    document.querySelector("#result").textContent =
      snapshot.view?.display ?? "";
  });
  refresh.onclick = async () => {
    if (busy) return;
    try {
      await starter.run("refresh");
    } catch {
      await starter.notify("刷新失败，请重试。", { tone: "error" });
    }
  };
</script>
```

| API                                  | 作者应处理的行为                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `ready`                              | 首次连接和快照可用时完成；不代表插件自己的异步业务已完成                                             |
| `onChange(listener)`                 | 订阅完整快照，返回取消订阅函数；包含视图、字段、检查点、活动状态、语言、主题、授权、忙碌和未保存状态 |
| `run(action, fields?)`               | 将提供的字段合并到当前已声明字段，调用本命令的 Wasm 函数                                             |
| `setFields(fields)`                  | 更新当前窗口的字段草稿，不运行 Wasm                                                                  |
| `checkpoint(value, dirty)`           | 登记最多 256 KiB 的 JSON 草稿及未保存状态；界面重建后从快照恢复                                      |
| `saveArtifact(index)`                | 保存当前视图的指定产物，用户选择系统路径；取消返回 `false`                                           |
| `notify(message, { tone }?)`         | 在宿主右下角显示纯文本 toast；`tone` 为 `info`（默认）、`success` 或 `error`                         |
| `applyStyles(shadowRoot)`            | 为本插件文档内的 Shadow DOM 接入默认控件样式和 select 增强，返回清理函数                             |
| `services.request(service, request)` | 调用下文的固定原生服务，不运行 Wasm                                                                  |

`run` 与 `setFields` 可一起提交父字段和关联选择；新选择可能不在上一轮 `options` 中，插件须按新上下文校验或规范化。字段声明、类型、额度及返回视图的完整边界见[视图与字段契约](../docs/extensions.md#开发带界面的应用插件)。

快照相互隔离，内部增量传输由 SDK 合并，作者无需处理协议。首个快照前通道关闭或解码失败会拒绝 `ready`，这些故障也会拒绝未完成请求；发送失败会拒绝对应调用。宿主返回的错误带稳定 `code` / `retryable`，按 `code` 映射本地化反馈，同时处理本地编码或通道异常，不解析错误文本。失败应保留输入，成功提示应等待真实回执。

宿主可在启用时或启动后台提前编译 Wasm；编译不创建实例、不运行初始化或导出，不改变 `ready` / `run` 语义。每次真实运行仍使用新实例，作者不能依赖编译缓存保留 guest 内存、全局变量或 WASI 状态；触发与资源预算见 [扩展执行生命周期](../docs/extensions.md#执行存储与生命周期)。

`notify` 文本须非空、不含 NUL，UTF-8 最多 2 KiB；宿主标明插件名，同一会话的新提示替换上一条。这是应用 toast，不能发送操作系统通知。常驻说明、校验和重试入口遵循 [说明与布局稳定](../docs/conventions/ui-guidelines.md#说明与布局稳定)。

不要仅用 iframe 局部变量保存输入。通过检查点恢复界面草稿，完成业务保存后才报告 `dirty: false`；宿主“导出会话”包含检查点，不代替插件业务保存。会话导入绑定插件身份和文档哈希，不执行代码或恢复文件授权，见 [会话边界](../docs/extensions.md#开发带界面的应用插件)。

隔离文档禁止表单提交、直接网络、跳转、弹窗、直接下载和浏览器存储；使用 `type="button"`、显式键盘事件和 SDK，不依赖默认 submit 或 `requestSubmit()`。外部字符串使用 `textContent` 或框架文本节点。自定义右键菜单须阻止默认行为，并处理键盘、Esc 和焦点恢复；默认右键与文本编辑行为遵循 [组件约定](../docs/conventions/ui-guidelines.md#组件选择顺序)。

语言变化时，快照更新 `locale`，SDK 同步文档 `lang`；在 `onChange` 中重绘固定文案。宿主等待当前动作完成，再以 `action: null` 携带已有 state / fields 刷新活动页面的 Wasm 视图；隐藏页面延后到恢复时刷新。插件应纯渲染，不清空会话、写入或重复上次动作；字段和检查点继续保留。

## 活动状态与页面保留

宿主在最近使用的有界页面范围内保留插件文档；离页不一定卸载 iframe。`snapshot.active` 表示该页面当前可见且可交互，宿主发送布尔值；兼容旧宿主时用 `snapshot.active !== false`，缺省视为活动，不要求为这一可选字段提高最低宿主版本。独立窗口未参与页面切换时保持活动，窗口 / 文档可见性仍需另行判断。

`active: false` 时停止自行创建的 `requestAnimationFrame`、Web Animations、定时器、轮询及其他持续工作；恢复后从已有模型继续，卸载时释放监听和资源。SDK 将根元素 `data-active` 同步为 `"true"` / `"false"`，自动暂停文档及显式接入 Shadow DOM 的 CSS animation、关闭增强 select 而不提交尚未选择的候选，并停止主题过渡；不会接管作者自己的 JavaScript 循环。`data-motion` 继续表示原有 `full` / `reduced` 偏好，隐藏不会改写成 reduced。旧插件的 CSS 动画可自动暂停，已有 JavaScript 动画仍应增加活动状态处理。

隐藏时所有新 SDK 请求立即以 `code: "EXTENSION_UNAVAILABLE"` 拒绝；宿主消息桥也独立拒绝隐藏 frame 的新请求，不能通过手写消息绕过。已发出的请求继续接收真实回执，离页不表示原生取消或回滚。编辑发生时及时登记字段和检查点，不能依赖隐藏后再发起保存；在途失败保留输入，不自动重复具有副作用的操作。

超出保留范围、包身份失效或权限不再满足时，宿主释放旧文档和端口。重新打开从现有会话、字段与检查点重建；未登记的局部状态可能丢失，不能将页面保留代替草稿协议。具体预算、身份校验与恢复边界见 [自定义界面](../docs/extensions.md#自定义界面)，取舍见 [ADR 0016](../docs/adr/0016-retain-extension-surfaces.md)。

## 默认外观与动效

宿主与插件共同使用 [surface-tokens.css](../src/styles/surface-tokens.css) 和 [control-styles.css](../src/styles/control-styles.css)。前者是材质参数入口，后者统一标准 HTML 控件、语义角色和宿主 slot 的字体、尺寸、边框、焦点、禁用、选中和阅读状态。宿主把完整 CSS 作为 `theme.styles` 发送，SDK 放入 `starter-defaults` layer；不会按插件当前使用的控件裁剪，也不再另维护一段默认 CSS。宿主更新共享规则后，插件以后动态插入少见控件也会自动匹配，无需重新打包插件。普通作者 CSS 优先于该 layer，可直接覆盖，无需 `!important` 或复制宿主组件库。

标准单行按钮 / 输入使用同一尺寸规则，文档 padding 为 1rem，并提供基础表格 / 图片 / 文本样式和 8px 滚动条。`button` 与 `input[type="button"/"submit"/"reset"]` 使用共同按钮规则，`data-variant` 支持 default、outline、secondary、ghost、destructive、link。自定义多行卡片可声明材质角色并保留自身布局。复选与单选保留原生 input 的值、键盘和无障碍语义，通过共同 CSS 对齐宿主形态；强制颜色模式保留系统反馈。`kbd`、`pre/code`、`output`、`details/summary`、表头、日期 / 文件 / 颜色输入和进度类控件同样包含在完整规则中。

相关设置或表单参数可用原生 `fieldset` / `legend`，与宿主共用嵌边组标题：顶部 8px、其余 12px 内边距，标题 14px 中等字重。legend 不占组内的额外垂直间距，也无需添加背景遮挡边线。控件组、普通正文、输出列表与画布的选择原则见[界面规范](../docs/conventions/ui-guidelines.md#组件选择顺序)。

隔离文档沿用浏览器默认的按需滚动槽，不为无需整页滚动的内容预留空槽，避免自定义背景右侧露出宿主底色；实际溢出时仍由文档原生滚动条占位。宿主普通页面和侧栏的稳定滚动槽不受影响。

默认样式直接覆盖普通文档 DOM，不会穿透 Web Components 的 Shadow DOM。当前宿主提供 `starter.applyStyles(root)`，组件可在创建 shadow root 后显式接入，并在卸载时调用返回的清理函数；重复接入按引用计数释放。注册的 root 使用相同完整规则并随主题样式更新，其后新增控件无需再次接入。不改写 `attachShadow`、不扫描其他组件，也不增加原生能力。使用当前 SDK 的插件声明 `minHostVersion: "0.1.7"`，并随当前开发宿主一起验证；开发快照不维护旧 SDK 的适配分支或历史宿主验证矩阵。

```javascript
const root = element.attachShadow({ mode: "open" });
const disposeStyles = starter.applyStyles(root);
const button = document.createElement("button");
button.type = "button";
button.textContent = "Refresh";
root.append(button);
// 组件卸载时释放；重新挂载时重新接入。
disposeStyles();
```

一致性范围是共同 CSS 中的标准元素、材质与语义状态，不复制宿主 React / Radix 组件。第三方组件库的自绘结构、Canvas / SVG 像素和平台日期 / 文件子弹窗不能仅靠 CSS 自动推断，作者须显式接入或保留自己的内容配色。皮肤壁纸属于宿主窗口底层，扩展外壳、内容框和文档默认透明，背后沿用宿主的阅读保护；100% 是壁纸完整显现，前景控件仍保留可读底线。需要独立视觉风格的插件可通过作者 CSS 设置背景，并负责该背景下自己的文字与控件对比。

手写容器通过 `data-surface` 声明用途：`transparent` 用于布局和已受保护的内部区块，`panel` 用于含文卡片，`control` 用于一般控件 / 输出，`popover` 用于浮层，`reading` 用于代码 / 日志 / 吸顶表头，`solid` 用于关键错误，`artwork` 标识内容专用绘制。对应的 `.app-surface`、`.app-control-surface`、`.app-overlay-surface`、`.app-reading-surface` 类同样可用；完整分类见[界面规范](../docs/conventions/ui-guidelines.md#颜色只用语义-token)。不要给每个 div 加模糊，也不要用完全透明布局代替阅读面板。原生选项和语义状态图元保留明确配色，普通 hover / selected、placeholder 与弱说明由共同规则处理。纯色、0%、高对比度和不支持模糊时恢复实体降级。模糊只采样当前文档内背景，无法跨 iframe 模糊宿主壁纸。

内容框占满侧栏右侧或独立窗口标题栏下的可用空间，宿主不叠加阅读宽度和外层 padding。以文档承担整页滚动，普通区块自然排版；需要居中时在内部容器设置 `max-width`、自动外边距和 padding，避免固定高度、嵌套滚动或视口最小高度叠加 padding 撑出第二条滚动条。

游戏等需要独立视觉风格的界面可用作者 CSS 覆盖默认字体、颜色、控件和页面 padding，并继续处理宿主语言、活动状态与减少动效。独立窗口的默认逻辑尺寸可在清单声明 `ui.windowSize`，其范围、最低宿主和尺寸记忆规则见 [应用窗口](../docs/extensions.md#开发带界面的应用插件)；插件文档不能直接修改宿主 DOM 或调用原生窗口 API。

普通单选 `select` 默认增强为主题下拉弹层，原 DOM 仍提供值和表单状态，保留 `value`、`selectedIndex`、reset、`input` / `change`、fieldset 禁用和 optgroup 语义。`multiple`、`size > 1` 或 `data-starter-select="native"` 使用原生交互；增强不开放表单提交权限。

`theme.tokens` 自动收集计算后的根元素主题变量并排除实现内部的 `--tw-*`，新增材质或语法色无需同步手写名字清单；同时提供 `--host-font-family` / `--host-font-size` 与响应式文本输入规则。根元素的自定义变量属于公开外观契约，业务数据留在组件或存储中。`theme.styles` 提供当前宿主的完整共享 CSS，仅在主题引用更新时随主题发送，普通字段编辑不重新复制样式或字体。本地 Geist 通过 data 字体注入，系统字体沿用宿主栈；输入字号断点以宿主窗口为准，不以较窄 iframe 重算。正文与控件继承应用字体，代码输出按需使用等宽字体。主题、字体和语言随宿主设置同步，不另存同一份偏好。

`theme.mode` 为 `light` / `dark`，对应根元素同名 class；`theme.motion` 为 `full` / `reduced`，对应 `data-motion`。SDK 同时遵循系统减少动效设置。作者持续动画须消费 [活动状态](#活动状态与页面保留)，并在离屏、文档隐藏、卸载和 reduced motion 时停止。宿主主题圆形过渡会同步到活动内容框；API 不可用、减少动效、页面不活动或窗口隐藏时直接应用主题。

首次加载由宿主显示骨架，SDK 完成非空视图、主题和 DOM 的首轮呈现握手后显示内容框；握手停滞时提供重试，后台或离屏不按前台等待误报。此过程没有固定等待时间，后续忙碌保持内容可见，作者无需发送内部消息。`ready` 和握手均不证明业务渲染成功，插件自己的异步数据仍需真实加载与失败反馈。

## 注册的宿主服务

`starter.services.request(service, request)` 调用固定注册的服务。图片资源、外链和自身窗口有具体返回类型；`lan` / `wallpaper` 返回 `unknown`，须自行收窄。完整能力矩阵、动作、授权和额度见 [受控桌面服务](../docs/extensions.md#受控桌面服务)。

| 服务        | 调用方式与界面责任                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `resources` | `fetch-image` 传 `url` 和可选 `networkMode`；返回图片元数据与 `resourceId`，供 `preview` / `save` / `release` 使用 |
| `wallpaper` | 管理应用背景图库：`list`、本机 `import`、`import-resource`、`apply`、`rename`、`remove`、`open-settings`           |
| `links`     | `{ url }` 请求打开 HTTPS 来源页，成功返回 `null`                                                                   |
| `lan`       | 手动连接、消息与受控附件传输、真实本机回环测试；多个窗口共享服务，明确停止会影响其他窗口                           |
| `window`    | `get-state` 读取自身独立原生窗口状态；`set-always-on-top` 传 `enabled` 切换置顶，均返回 `{ alwaysOnTop }`          |

图片 `preview` 返回 `{ dataUrl }`；`save` 可传建议文件名 `name`，系统对话框决定路径，返回 `{ cancelled: true }` 或 `{ cancelled: false, name }`。另存保留已验证原图，`wallpaper` 的 `{ action: "import-resource", resourceId, name }` 会重绘压缩后加入图库。图库缩略图可能为 `dataUrl: null`，不能把缩略图缺失当作列表或写入失败。

自身窗口服务需独立授权 `window:control`，只控制当前插件的独立原生窗口，不接受任意 label。嵌入主界面的插件与浏览器环境不能置顶宿主窗口；入口应保持其他功能可用，并按拒绝结果反馈。完整边界见 [插件自身窗口](../docs/extensions.md#插件自身窗口)。

LAN 需 `messaging:lan`，包括文字、Unicode 大表情、图片和文件收发。`start` 的 `mode` 区分局域网与本机回环监听；`loopback` 启动真实 TCP 回环助手，状态带 `mode` / `loopbackPeerId`。`sendAttachment` 传 `peerId` 和 `kind: "image" | "file"`，由原生对话框选择文件，普通文件在服务内流式传输，不把字节经 SDK / Wasm / 检查点传递；`previewAttachment`、`saveAttachment` 传 `messageId`，分别获取受控预览或弹出系统另存对话框。消息附件元数据包含 `name`、`mime`、`bytes`、`sha256`，没有系统路径。取消对话框不代表已发送或保存，不自动打开收到的文件；精确请求、额度、明文与协议版本边界见 [局域网通信](../docs/extensions.md#局域网通信)。

资源 ID 仅对当前插件安装和原生窗口短期有效，及时 `release`，过期、关闭、撤权或重启后重新获取，不作为持久下载资格导出。`network:images` 允许任意公网 HTTPS GET 图片来源，URL 查询可能发送数据；搜索文本仍走 Wasm 的精确 origin HTTP 效果。来源和许可由插件解释。

HTTP 效果和图片请求通常省略可选 `networkMode`，继承宿主“设置 → 网络”的连接方式；使用系统代理仍须独立的 `network:system-proxy` 授权，缺少授权的缺省请求直连。本机 HTTP 缺省始终直连，旧显式模式的兼容与拒绝规则见 [网络授权](../docs/extensions.md#来源与授权)。不另存一份宿主连接偏好。

服务请求不自动改变整个插件的 `busy`。将后台查询与用户操作分别管理，忽略早于业务操作的过期查询结果，保留新草稿、焦点和选区。按[消息桥额度与背压](../docs/extensions.md#自定义界面)限制请求并发；桥或 SDK 因超额返回 `EXTENSION_BUSY` 时该请求未执行，恢复容量后可重新发起，SDK 不自动重试。

原生对话框可等待用户选择，SDK 没有统一前端请求超时。停止等待不等于原生取消，失败也不保证副作用回滚；未获回执时不能断言写入结果或自动重试发送。LAN 连接由原生持有，同一窗口切页或重建 iframe 不停止接收，无需隐藏 iframe。更完整的原生活动与回收规则见 [服务生命周期](../docs/extensions.md#受控桌面服务)。真实 WebView 的隔离和平台交互仍需按 [验证范围](../docs/extensions.md#验证) 验收。
