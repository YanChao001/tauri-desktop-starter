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
| `checkpoint(value, dirty)`           | 登记 JSON 草稿及未保存状态；界面重建后从快照恢复，额度见[草稿契约](../docs/extensions.md#自定义界面) |
| `saveArtifact(index)`                | 保存当前视图的指定产物，用户选择系统路径；取消返回 `false`                                           |
| `notify(message, { tone }?)`         | 在宿主右下角显示纯文本 toast；`tone` 为 `info`（默认）、`success` 或 `error`                         |
| `applyStyles(shadowRoot)`            | 为本插件文档内的 Shadow DOM 接入默认控件样式和 select 增强，返回清理函数                             |
| `services.request(service, request)` | 调用下文的固定原生服务，不运行 Wasm                                                                  |

`run` 与 `setFields` 可一起提交父字段和关联选择；新选择可能不在上一轮 `options` 中，插件须按新上下文校验或规范化。字段声明、类型、额度及返回视图的完整边界见[视图与字段契约](../docs/extensions.md#开发带界面的应用插件)。

快照相互隔离，内部增量传输由 SDK 合并，作者无需处理协议。首个快照前通道关闭或解码失败会拒绝 `ready`，这些故障也会拒绝未完成请求；发送失败会拒绝对应调用。宿主返回的错误带稳定 `code` / `retryable`，按 `code` 映射本地化反馈，同时处理本地编码或通道异常，不解析错误文本。失败应保留输入，成功提示应等待真实回执。

每次 `run` 使用新的 Wasm 实例；跨动作状态通过协议传递。预编译触发与资源预算见 [执行生命周期](../docs/extensions.md#执行存储与生命周期)。

`notify` 文本须非空、不含 NUL，UTF-8 最多 2 KiB；宿主标明插件名，同一会话的新提示替换上一条。这是应用 toast，不能发送操作系统通知。常驻说明、校验和重试入口遵循 [说明与布局稳定](../docs/conventions/ui-guidelines.md#说明与布局稳定)。

通过字段和检查点登记需要恢复的输入，业务保存完成后才报告 `dirty: false`。宿主导出会话包含检查点，身份校验和授权边界见 [会话契约](../docs/extensions.md#开发带界面的应用插件)。

隔离文档禁止表单提交、直接网络、跳转、弹窗、直接下载和浏览器存储；使用 `type="button"`、显式键盘事件和 SDK，不依赖默认 submit 或 `requestSubmit()`。外部字符串使用 `textContent` 或框架文本节点。自定义右键菜单须阻止默认行为，并处理键盘、Esc 和焦点恢复；默认右键与文本编辑行为遵循 [组件约定](../docs/conventions/ui-guidelines.md#组件选择顺序)。

原生宿主允许图片 / 画布控件消费捏合输入，同时在所有原生文档的捕获阶段取消 Ctrl + `wheel`、`gesturestart` / `gesturechange` / `gestureend` 与页面缩放快捷键的默认动作。作者仍收到这些事件，可用自己的比例模型缩放局部内容；不要仅因 `defaultPrevented` 已为 `true` 就忽略手势。普通 `wheel` 滚动不受影响，业务通道关闭后页面默认缩放仍被禁止；浏览器 fixture 保留浏览器默认动作。Windows 的创建与设置时序、重建要求和硬件验收边界见 [宿主自定义界面](../docs/extensions.md#自定义界面)。

语言变化时，快照更新 `locale`，SDK 同步文档 `lang`；在 `onChange` 中重绘固定文案。宿主等待当前动作完成，再以 `action: null` 携带已有 state / fields 刷新活动页面的 Wasm 视图；隐藏页面延后到恢复时刷新。插件应纯渲染，不清空会话、写入或重复上次动作；字段和检查点继续保留。

## 活动状态与页面保留

离页可能保留 iframe。`snapshot.active` 表示页面当前可见且可交互，使用 `snapshot.active !== false` 处理可选字段；独立窗口仍需结合文档可见性暂停工作。

页面不活动时，作者停止自己的动画帧、Web Animations、定时器和轮询；恢复后沿用模型继续，卸载时释放资源。SDK 同步根元素 `data-active`，自动暂停普通 DOM 与已登记 Shadow DOM 的 CSS animation、关闭增强 select 并停止主题过渡；作者的 JavaScript 循环由作者管理。`data-motion` 继续表示减少动效偏好。

隐藏时 SDK 和宿主桥均拒绝新请求，返回 `EXTENSION_UNAVAILABLE`；在途请求继续收到真实回执。编辑发生时及时登记字段 / 检查点，失败保留输入，恢复后由用户决定是否重试有副作用的操作。

超出保留范围或安装身份 / 权限失效时释放文档，重开从已登记状态恢复。宿主的保留额度、租约和回收规则见 [自定义界面](../docs/extensions.md#自定义界面)，取舍见 [ADR 0016](../docs/adr/0016-retain-extension-surfaces.md)。

## 默认外观与动效

通用界面复用宿主的 [共同外观规范](../docs/conventions/ui-guidelines.md#宿主与插件的共同外观)；业务专用视觉区域按该规范确定范围。作者维护布局与内容，共享控件 CSS 由宿主提供。

[surface-tokens.css](../src/styles/surface-tokens.css) 和 [control-styles.css](../src/styles/control-styles.css) 经 [ui-theme.ts](../src/lib/ui-theme.ts) 装配为 `theme.styles`，SDK 注入 `starter-defaults` layer。完整规则也适用于后插入的标准元素，普通作者 CSS 在该 layer 之上；共享样式更新随宿主交付，无需重打插件包。标准按钮支持 `data-variant`，材质容器使用 `data-surface`；具体角色见 [语义 token](../docs/conventions/ui-guidelines.md#颜色只用语义-token)，尺寸和选择规则直接复用共享 CSS。

默认样式覆盖普通 DOM；Web Components 在创建 ShadowRoot 后调用 `starter.applyStyles(root)`，卸载时调用返回的清理函数，重复登记按引用计数释放。登记的 root 同步共享样式、主题和 select 增强，后插入控件无需重新登记。使用当前 SDK 的插件声明 `minHostVersion: "0.1.7"` 并配套当前宿主验证。

```javascript
const root = element.attachShadow({ mode: "open" });
const disposeStyles = starter.applyStyles(root);
const button = document.createElement("button");
button.type = "button";
button.textContent = "Refresh";
root.append(button);
// 组件卸载时调用 disposeStyles()。
```

第三方自绘控件、Canvas / SVG 和平台子弹窗由作者负责接入。扩展外壳与文档默认透明，沿用宿主阅读保护；使用独立背景的业务区域负责文字和控件对比，iframe 模糊只能采样当前文档。

内容框占满侧栏右侧或独立窗口标题栏下的空间，文档默认 padding 为 1rem，以文档承担整页滚动。居中布局在内部容器设置 `max-width`、自动外边距和 padding；隔离文档按需出现滚动槽。独立窗口默认尺寸通过清单 `ui.windowSize` 声明，范围与记忆规则见 [应用窗口](../docs/extensions.md#开发带界面的应用插件)。

普通单选 `select` 默认增强为主题弹层，原 DOM 继续提供值、表单状态、reset、`input` / `change`、fieldset 禁用与 optgroup 语义。`multiple`、`size > 1` 或 `data-starter-select="native"` 使用原生交互。

`theme.tokens` 收集根元素公开主题变量并排除内部 `--tw-*`，同时提供 `--host-font-family` / `--host-font-size`；公开根变量用于外观，业务数据放模型或存储。`theme.styles` 仅随主题引用变化传递。字体、字号和语言继承宿主设置，输入字号断点以宿主窗口为准；代码输出可用等宽字体。

`theme.mode` 为 `light` / `dark` 并同步根 class，`theme.motion` 为 `full` / `reduced` 并同步 `data-motion`，SDK 同时遵循系统减少动效。活动界面及已登记 ShadowRoot 接收实时外观更新，隐藏页恢复时同步最新设置。持续动画还须处理 [活动状态](#活动状态与页面保留)、离屏、文档隐藏和卸载；主题过渡不可用或不适合播放时直接应用主题。

首次加载的骨架在非空视图、主题和 DOM 首轮呈现握手后解除，握手停滞时宿主提供重试，后台 / 离屏暂停等待计时。后续忙碌保持内容可见。作者的异步业务另外显示真实加载与失败反馈；样式检查入口见 [自定义扩展界面](../docs/testing.md#自定义扩展界面)。

## 注册的宿主服务

`starter.services.request(service, request)` 调用固定注册的服务。图片资源、图库单图预览、应用背景设置回执、外链和自身窗口有具体返回类型；`lan` 及其他 `wallpaper` 动作返回 `unknown`，须自行收窄。完整能力矩阵、动作、授权和额度见 [受控桌面服务](../docs/extensions.md#受控桌面服务)。

| 服务        | 调用方式与界面责任                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources` | `fetch-image` 传 `url` 和可选 `networkMode` / `preview` / `requestId`；返回元数据与句柄，供 `preview` / `save` / `release` 使用；`cancel-fetch` 合作取消 |
| `wallpaper` | 管理应用背景图库：元数据 `list`、按项 `preview`、本机 `import`、`import-resource`、`apply`、`rename`、`remove`、`open-settings`                          |
| `links`     | `{ url }` 请求打开 HTTPS 来源页，成功返回 `null`                                                                                                         |
| `lan`       | 局域网公告发现、手动连接、消息与受控附件传输、真实本机回环测试；多个窗口共享服务，明确停止会影响其他窗口                                                 |
| `window`    | `get-state` 读取自身独立原生窗口状态；`set-always-on-top` 传 `enabled` 切换置顶，均返回 `{ alwaysOnTop }`                                                |

应用背景使用宿主 0.1.10 的轻量回执接口，返回类型从 Rust DTO 生成：

```ts
const result = await starter.services.request("wallpaper", {
  action: "apply",
  id: selected.id,
  expectedRevision: gallery.revision,
  fit: "cover",
});
// 使用 result.activeId 与 result.revision 更新已有图库的当前项，保留缩略图。
// 通过独立的 list 动作按需读取图库，回执自身不触发预览加载。
```

请求类型为 `ExtensionWallpaperApplyRequest`，返回 `ExtensionWallpaperApplyResult`；无效 fit、缺少 ID / revision 的静态已知 apply 请求不能绕过类型重载。完整回执、并发与兼容要求见 [壁纸服务契约](../docs/extensions.md#壁纸图库与图片搜索)。

宿主 0.1.11 的图库 `list` 只返回元数据。按可见卡片传 `{ action: "preview", id, previewKey }`，返回类型 `ExtensionWallpaperPreviewResult`，核对 ID / 封面摘要后逐项更新；图库缩略图可能为 `dataUrl: null`，不能把缩略图缺失当作列表或写入失败。

图片 `preview` 返回 `{ dataUrl }`；默认缩略图，用户主动查看大图时传 `{ action: "preview", resourceId, size: "large" }`。也可在 `fetch-image` 传 `preview: "thumbnail"` / `"large"`，在同一次校验解码中返回元数据、句柄及必需的 `dataUrl`，减少往返和重复解码。可选 `requestId` 配合 `{ action: "cancel-fetch", requestId }` 停止旧下载；`cancelled: true` 表示标记了匹配任务，已开始的同步 CPU 工作仍需真实结束。具体额度与归属见[图片资源契约](../docs/extensions.md#壁纸图库与图片搜索)。`save` 可传建议文件名 `name`，系统对话框决定路径，返回 `{ cancelled: true }` 或 `{ cancelled: false, name }`。另存保留已验证原图，`wallpaper` 的 `{ action: "import-resource", resourceId, name }` 会重绘压缩后加入图库。

按 [服务能力矩阵](../docs/extensions.md#受控桌面服务) 声明并取得授权。`window` 只控制当前插件的独立窗口；`lan` 附件通过原生对话框选择 / 另存，传消息 ID 与元数据，不经 SDK 传文件字节。LAN 连接由原生窗口持有，切页或重建 iframe 不停止接收；多个窗口共享服务，明确停止会影响其他窗口。

LAN `status` 的 `discoveredPeers` 返回临时附近设备 `{ id, nickname, address, port, lastSeen }`，`discoveryError` 为独立发现错误或 `null`。局域网 `start` 同时启动有界 UDP 公告，附近设备不会自动建立 TCP 连接或写入联系人；用户选择设备后仍调用 `connect`。仅有 `messaging:lan` 授权和 `status` 不启动监听，回环模式不公告；发现失败时保留手动 IP 连接。

LAN 消息列表按可见范围请求 `{ action: "thumbnailAttachment", messageId }`，主动查看大图再使用 `previewAttachment`；两者返回 `{ dataUrl }`，缩略图缺失可为 `null`。校验和缩略图缓存由宿主管理，UI 不在状态轮询中请求完整大图。

LAN 附件进度通过 `{ action: "transferStatus" }` 独立查询，返回 `{ transfers: [{ id, peerId, direction, kind, name, bytes, phase, completedBytes, totalBytes, startedAt }] }`。`direction` 为 `outgoing` / `incoming`，`id` 与后续消息 ID 相同；`phase` 为 `preparing`、`verifying`、`sending`、`receiving`、`awaitingReceipt`、`completed` 或 `failed`。字节进度来自当前复制、散列或 TCP 读写阶段，阶段切换后重新计数，`totalBytes` 为文件大小；写入 TCP 完成不代表已送达。轮询不等待历史、缓存和发送锁，可与待完成的 `sendAttachment` 并行，但仍占普通服务请求容量；使用独立在途标记并限制为一个进度查询。快照和终态保留、停止清理的精确规则见 [LAN 契约](../docs/extensions.md#局域网通信)。

`{ action: "clearHistory", peerId }` 清空本机指定会话全部消息、未读和不再被其他消息引用的图片 / 文件缓存；省略 `peerId` 时清空所有会话。保留联系人、其他会话共享附件、在途引用、原始源文件、另存输出和对方记录；在途传输不会被取消，其进度在后续所有窗口快照中隐藏，完成或回执不会让已清空的附件气泡再次出现。后续实际写入历史的新接收消息仍正常显示。界面应在用户确认清理范围后调用。

图片句柄应及时 `release`，到期、关闭、撤权或重启后重新获取；句柄不是持久下载资格。搜索文本走 Wasm 的精确 origin HTTP 效果，图片来源和许可由插件解释。HTTP 与图片请求通常省略 `networkMode`，继承宿主网络偏好，代理授权及模式规则见 [网络契约](../docs/extensions.md#来源与授权)。

服务请求不自动改变整个插件的 `busy`。将后台查询与用户操作分别管理，忽略早于业务操作的过期查询结果，保留新草稿、焦点和选区。按[消息桥额度与背压](../docs/extensions.md#自定义界面)限制请求并发；桥或 SDK 因超额返回 `EXTENSION_BUSY` 时该请求未执行，恢复容量后可重新发起，SDK 不自动重试。

原生对话框可等待用户选择，SDK 没有统一前端请求超时。停止等待不等于原生取消；未获回执时先核对操作结果，再决定是否显式重试。原生活动与回收见 [服务生命周期](../docs/extensions.md#受控桌面服务)，测试选择见 [验证入口](../docs/extensions.md#验证)。
