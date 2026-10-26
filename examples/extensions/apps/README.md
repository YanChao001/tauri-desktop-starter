# 本地工作台

一个可安装的 Extism 应用示例，使用包格式 3、API 2 和视图 2。界面由 [ui/main.html](./ui/main.html) 提供，采用宿主默认控件与主题，只定制业务布局。协议与权限边界见[扩展指南](../../../docs/extensions.md)。

## 四个工具

- **文本**：默认进入空白编辑器。支持九种转换、Unicode 与 UTF-8 统计、结果预览和 TXT 导出；词频图表按需展开。粘贴文本后选择操作并处理，支持 Ctrl / Command + Enter。编辑器最多载入 64 KiB，截取时说明边界；预览最多显示 32000 字节，导出保留完整转换结果。
- **CSV / JSON**：粘贴或使用样例，预览表格并导出 CSV / JSON。CSV 支持引号、逗号和多行单元格；JSON 支持对象、对象数组及标量数组。输入最多 64 KiB，表格最多 16 列、200 行。数值图表按需展开。JSON 表格产物使用文本单元格；CSV 产物处理潜在表格公式。
- **待办**：最多 50 项，支持截止日期、完成 / 恢复、逐行删除、备份和清空确认。保存需单独授权私有存储；未授权时仍保留当前草稿。写入失败或冲突不会清空输入，也不会自动重试。旧窗口的行操作先检查当前 revision，避免误改另一项任务。
- **文件与网络**：通过宿主“扩展工具”主动发送文本或所选文件，查看文件名、类型提示和大小。发送到文本或数据工具时只更新当前工具；在能力页接收后，需点击按钮载入指定工具，不会连带替换其他草稿。HTTPS 样例只在用户点击后请求清单声明的公开服务，响应也需显式载入数据编辑器。

所有权限均可选，文本与数据工具无需授权即可离线使用。文件产物须由用户点击保存，取消保存不会报告成功。通用会话导入 / 导出和窗口操作位于宿主“扩展工具”，不会挤占初始工具界面。

## 源码职责

| 模块         | 职责                                                       |
| ------------ | ---------------------------------------------------------- |
| ui/main.html | 四工具导航、编辑区、结果、任务行、可折叠统计和安全文本节点 |
| src/app.rs   | 请求分派、四工具独立草稿、会话 schema 与协议响应           |
| src/view.rs  | 视图构造、翻译和 UTF-8 边界工具                            |
| src/text.rs  | 文本转换、统计和结果文件                                   |
| src/data.rs  | CSV / JSON、接收文件、网络回执与显式载入                   |
| src/tasks.rs | 私有存储、日期校验、冲突、确认和草稿                       |

界面输入通过 SDK 检查点报告，暂离恢复不会只依赖 iframe 的局部变量。工具切换保留各自输入；长期待办来自当轮私有存储快照，会话文件不代替业务备份。2.2.0 使用会话 schema 3，已移除游戏、总览、开发协议页与昵称偏好；旧会话被明确拒绝，原文件不会修改。

## 构建与验证

从仓库根目录执行：

```sh
cargo test --manifest-path examples/extensions/apps/Cargo.toml --locked
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml --check
node --test examples/extensions/apps/ui.test.mjs
pnpm extension:demos:build
pnpm extension:demos:check
pnpm extension:test --manifest examples/extensions/apps/extension.json --wasm resources/extensions/demo-apps.wasm --ui-dir examples/extensions/apps/ui --fixture examples/extensions/apps/smoke.json
```

原生单元测试验证业务行为；HTML 测试验证脚本语法、键盘和失败保留草稿，不代替实际 WebView 验收。smoke.json 通过真实 Wasm 校验中英视图、文件产物、可选权限和效果请求，不访问外部服务。宿主另有真实效果往返回归。
