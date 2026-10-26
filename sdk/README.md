# 扩展界面 SDK

协议、资源和权限的权威说明见 [扩展指南](../docs/extensions.md#自定义界面)。`extension-ui.js` 由宿主注入隔离的内容框，插件无需复制或远程加载它；`extension-ui.d.ts` 提供作者编辑器类型，视图 DTO 引用生成绑定。

SDK 脚本由 Rust 在编译时嵌入并于文档开始时注入；修改 SDK 后需重新构建并重启桌面进程，前端 HMR 不会替换已运行进程中的注入脚本。默认 CSS 内嵌在 SDK 中，插件不应另外加载一份 SDK 或依赖内部主题控制消息。

清单的视图命令声明 `ui.document: "main"`，将自包含的 HTML 放在 `ui/main.html`，CSS、JavaScript 和图片内嵌。可以用普通 DOM，也可由自己的框架构建为单文件。打包时传入 `--ui-dir <目录>`；文档引用、大小和完整性由原生工具核验。

```html
<button id="refresh" type="button">刷新</button>
<pre id="result"></pre>
<script>
  starter.onChange(({ view, busy }) => {
    document
      .querySelector("#refresh")
      .setAttribute("aria-disabled", String(busy));
    document.querySelector("#result").textContent = view?.display ?? "";
  });
  document.querySelector("#refresh").onclick = async () => {
    try {
      await starter.run("refresh");
    } catch {
      document.querySelector("#result").textContent = "刷新失败，请重试。";
    }
  };
</script>
```

`ready` 完成首次连接，`onChange` 订阅视图、当前字段、语言、主题 token、授权和忙碌状态。`run(action, fields)` 合并当前视图已声明字段后调用本命令的 Wasm 函数；`setFields` 只更新当前窗口中的输入，不执行 Wasm。操作失败会拒绝 Promise，应保留输入并给用户可理解的反馈。

隔离文档不开放表单提交；自定义交互使用 `type="button"` 的 click 与显式键盘事件调用 SDK，不依赖表单默认 submit、`requestSubmit()` 或 `onsubmit` 才阻止导航。

宿主语言变化时会立即发送新 `locale`，同时更新文档 `lang`。作者应在 `onChange` 中按 `locale` 重绘自己的固定文案，不用重新载入页面。Wasm 视图使用 `action: null` 携带已有 state / fields 重新渲染；插件应将这种请求视为纯渲染，不清空会话或触发业务写入。宿主等待当前动作结束再刷新，并保留字段草稿和检查点；新语言不会使正在运行的业务请求取消或重试。

## 默认外观与动效

SDK 自动注入 `starter-defaults` CSS layer，提供与宿主一致的 2rem 默认按钮 / 输入高度、字体、字号、语义色、圆角、焦点、禁用反馈和 8px 细滚动条。表格、图片与文本也有基础样式，页面默认内边距为 1rem。所有普通作者 CSS 都优先于该 layer；可以直接改变组件的字号、尺寸、颜色和布局，无需 `!important`，也无需复制宿主组件库。

普通单选 `select` 默认渐进增强为使用主题 token 和圆角的下拉弹层，原来的 DOM 节点仍是值与表单状态的来源。保留 `value`、`selectedIndex`、表单关联 / reset、`input` / `change` 事件、fieldset 禁用和 optgroup 语义，不改写原型或要求作者迁移事件处理。`multiple`、`size > 1` 和 `data-starter-select="native"` 保留原生交互；作者可用最后一个属性明确退出增强。普通作者 CSS 仍优先于默认样式层，增强不额外开放表单提交权限。

`theme.tokens` 提供背景、前景、卡片、弹层、主要 / 次要 / 强调 / 危险交互、边框、输入、焦点、图表与圆角变量，以及 `--host-font-family` / `--host-font-size`。Geist 的本地字体通过 data 字体提供给隔离文档；系统字体沿用宿主栈，不需要插件发起字体网络请求。令牌随跨窗口设置同步更新，SDK 不另存一份主题或语言偏好。

`theme.mode` 为 `light` / `dark`，对应根元素的同名 class；`theme.motion` 为 `full` / `reduced`，对应根元素 `data-motion`。SDK 同时遵循系统减少动效设置。作者自己的持续动画仍应在离屏、隐藏、卸载和 reduced motion 时停止；不要仅依靠 CSS 缩短动画时长来运行后台循环。

从宿主切换主题时，隔离内容框会在自己的文档中同步捕获旧画面，以同一圆心、半径、时间和 easing 展开圆形 View Transition。跨源隔离保持不变；不支持 API、用户减少动效、过渡跳过或窗口隐藏时直接应用新主题，不影响输入和操作结果。

首次显示前，宿主按真实加载状态显示骨架，内容框保持可测量。SDK 在收到首个非空 view、应用首轮主题且 DOM 就绪后，等待两次动画帧机会再通过内部握手通知宿主展示；这不是新增作者 API，不应手工发送内部消息。`ready` 表示连接和首个快照可用，不表示作者自己的异步业务已经完成；需要异步数据时仍由插件显示真实加载与失败状态。骨架不人为延长，后续忙碌不会重新隐藏已经展示的内容框。

首屏呈现握手停滞时，宿主显示可重试错误；文档后台或内容框离屏时不按前台等待误报。这只确认主题和渲染机会，不证明作者业务渲染成功，也不替代插件自己的错误处理。它与业务 RPC 不同，不为所有服务调用添加统一前端超时。

`checkpoint(value, dirty)` 保存最多 256 KiB 的 JSON 草稿，并明确报告未保存状态；不要只把输入保存在 iframe 的局部变量里。宿主暂离后重建界面时，从快照的 `checkpoint` 恢复。完成插件自己的业务保存后可报告 `dirty: false`；宿主通用“保存”导出会话 JSON，包含检查点，并不冒充插件业务保存。导入绑定文档哈希及原有插件身份，不自动执行代码或恢复文件授权。

`saveArtifact(index)` 请求保存当前视图已生成的产物，用户仍在系统对话框中选择路径，取消时返回 `false`。不存在任意路径写入、任意 IPC、凭据读取或绕过权限的通道。SDK 使用原生文档启动脚本，无需在 HTML 引用它，不改变正常 HTML / 模块的解析语义。原生 IPC 的密钥传输仅安装到顶层宿主；CSP 与 WebRTC 启动限制共同约束未声明网络。普通链接、直接网络、弹窗、下载、跨框 DOM 与浏览器存储不在界面 API 范围；通用 HTTP / KV 使用 Wasm 受控效果，固定桌面能力使用下述服务。

## 注册的宿主服务

`starter.services.request(service, request)` 调用已经注册的宿主服务，当前名称为 `lan` 和 `wallpaper`，返回 `Promise<unknown>`，使用方应收窄实际返回 DTO。请求不会自动执行 Wasm，也不会把状态查询冒充成整个插件忙碌；需要的界面工作状态由作者按该请求维护。具体请求和能力范围见 [扩展指南](../docs/extensions.md)。服务权限分别为 `messaging:lan`、`wallpapers:manage`，宿主每次核验当前安装身份和授权，不接受界面传入原生路径、安装代次或任意 IPC 名称。

后台状态读取应与用户操作分别管理在途状态，避免每轮查询都禁用输入、发送或连接按钮，也不要用旧快照覆盖等待期间的新草稿。手动操作结束后，忽略早于该操作发出的过期查询结果；保留焦点、选区和正在编辑的值。不要把静默轮询等同于业务提交。

服务请求与 `run` / 检查点等使用同一个受限通道：合计最多 4 项在途，消息大小与频率限制仍适用。失败 Promise 的 `code` 与 `retryable` 为稳定的结构化诊断；请按自己的语言显示反馈，不解析错误文本。原生再次校验启用、授权、模块哈希、安装代次和窗口令牌，读写门闩等待已开始的请求结束后再完成撤权或替换。ServicePermit 全程计入原生活动，关闭、退出、重启与更新等待真实操作结束，关闭后拒绝最终提交，窗口 epoch 隔离旧资源清理；服务调用不具备自动回滚语义。

SDK 不用统一的前端定时器截断全部请求：原生导入 / 保存对话框可以等待用户选择，完成后返回实际回执，界面关闭时通道失效。Wasm 和原生网络仍有各自预算；停止前端等待不能冒充原生取消，更不能报告尚未确认的写入成功或失败。

显式启动的 LAN 监听和接收属于原生服务；同一原生窗口切换页面或 iframe 重建不等于停止连接，最后一个使用窗口关闭、撤权、换安装身份或应用退出时才回收。多个窗口共享服务时，明确停止会影响其他窗口。不要为保持后台接收而保留隐藏 iframe，也不要让前端轮询冒充服务本身。LAN 为明文无账户的手动私有 IP 通信；壁纸服务只管理应用背景，Commons 原图另存与图库压缩导入分开。完整动作、数据位置和限制统一见 [受控桌面服务](../docs/extensions.md#受控桌面服务)。

消息大小、频率、在途调用和生命周期限制见扩展指南。界面应处理 `busy`、键盘、触控、减少动效和明暗主题；使用 `textContent` 或框架的文本节点处理外部字符串。真实 WebView 的隔离和平台交互必须另行验收，浏览器检查不代表已测全部桌面平台。
