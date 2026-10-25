# 扩展界面 SDK

协议、资源和权限的权威说明见 [扩展指南](../docs/extensions.md#自定义界面)。`extension-ui.js` 由宿主注入隔离的内容框，插件无需复制或远程加载它；`extension-ui.d.ts` 提供作者编辑器类型，视图 DTO 引用生成绑定。

清单的视图命令声明 `ui.document: "main"`，将自包含的 HTML 放在 `ui/main.html`，CSS、JavaScript 和图片内嵌。可以用普通 DOM，也可由自己的框架构建为单文件。打包时传入 `--ui-dir <目录>`；文档引用、大小和完整性由原生工具核验。

```html
<button id="refresh">刷新</button>
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

`checkpoint(value, dirty)` 保存最多 256 KiB 的 JSON 草稿，并明确报告未保存状态；不要只把输入保存在 iframe 的局部变量里。宿主暂离后重建界面时，从快照的 `checkpoint` 恢复。完成插件自己的业务保存后可报告 `dirty: false`；宿主通用“保存”导出会话 JSON，包含检查点，并不冒充插件业务保存。导入绑定文档哈希及原有插件身份，不自动执行代码或恢复文件授权。

`saveArtifact(index)` 请求保存当前视图已生成的产物，用户仍在系统对话框中选择路径，取消时返回 `false`。不存在任意路径写入、任意 IPC、凭据读取或绕过权限的通道。SDK 使用原生文档启动脚本，无需在 HTML 引用它，不改变正常 HTML / 模块的解析语义。原生 IPC 的密钥传输仅安装到顶层宿主；CSP 与 WebRTC 启动限制共同约束未声明网络。普通链接、网络请求、弹窗、下载、跨框 DOM 与浏览器存储不在界面 API 范围；需要服务访问时让 Wasm 返回已有受控效果。

消息大小、频率、在途调用和生命周期限制见扩展指南。界面应处理 `busy`、键盘、触控、减少动效和明暗主题；使用 `textContent` 或框架的文本节点处理外部字符串。真实 WebView 的隔离和平台交互必须另行验收，浏览器检查不代表已测全部桌面平台。
