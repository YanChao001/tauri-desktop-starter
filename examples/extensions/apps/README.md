# 本地工作台

可安装的 Extism 应用示例，使用包格式 3、API 2 和视图 2；版本与最低宿主见 [extension.json](./extension.json)。[ui/main.html](./ui/main.html) 复用宿主默认控件与主题。协议和授权见 [扩展指南](../../../docs/extensions.md)，界面调用见 [SDK](../../../sdk/README.md)。

## 交互工作台

- **创意画布**：在节点与连线中组织想法，直接调整画布内容与布局；界面中的状态变化即时完成。
- **数据透镜**：通过图表和筛选探索本地样例，比较不同分类与时间的数据，导出当前可见结果。
- **流程编排**：组合本地处理步骤并运行模拟，查看阶段与输出；模拟由当前界面驱动，不代表后台服务或原生任务。
- **工具箱**：保留原有的文本、CSV / JSON、待办及文件与网络工具，按需要展开使用。

前三个场景的编辑、筛选和切换都在隔离界面中处理，不为每次交互执行 Wasm。工作成果导出才调用 Wasm 校验并生成产物。场景模型通过 SDK 检查点恢复；检查点不是长期业务存储，宿主会话导出包含相应草稿。

数据透镜单独保留尚未应用的 JSON 原稿及编辑器展开状态，包括未完成或校验失败的内容；切换场景、成果导出和会话重建不会覆盖原稿。“应用数据”校验成功后替换当前数据，“放弃编辑”清除原稿并保留已应用的数据。输入最多 48000 个 UTF-8 字节，超出时明确提示并保留前段内容；登记失败继续保留页面输入。旧检查点缺少编辑元数据时仍可恢复，损坏或未来检查点保留原值并停止写入。

## 工具箱

- **文本**：空白编辑器，九种转换、Unicode / UTF-8 统计、按需词频图表和 TXT 导出；Ctrl / Command + Enter 执行。输入最多 64 KiB，截取时提示；预览最多 32000 字节，导出保留完整结果。
- **CSV / JSON**：粘贴或载入样例，预览表格、按需数值图表并导出。输入最多 64 KiB、16 列、200 行；CSV 支持引号 / 多行单元格，JSON 支持对象、对象数组和标量数组。JSON 表格产物使用文本单元格，CSV 处理潜在公式。
- **待办**：最多 50 项，支持日期、完成 / 恢复、删除、备份和清空确认。保存需私有存储授权；写入失败 / revision 冲突保留草稿且不自动重试，行操作先核对 revision。
- **文件与网络**：从宿主“扩展工具”主动接收文本 / 文件，或点击请求已声明 HTTPS 样例；显式载入指定编辑器，不替换其他工具草稿。

权限全部可选，交互场景、文本和数据工具可离线使用。各工具独立保留输入；长期待办取自私有存储，会话不代替业务备份。当前 Wasm 会话仍为 schema 3，已有 schema 3 工具草稿继续可读；更旧、损坏或未来会话拒绝并保留原文件。新会话默认打开交互工作台，不请求网络、存储或其他宿主效果。产物需用户点击保存，取消不报告成功；会话和窗口操作由宿主“扩展工具”提供。

工具页签切换期间保留当前面板和控件亮度，完成后直接更新内容，不播放整块面板淡入或位移动画。等待时保留忙碌语义并阻止重复操作，原本不可用的操作继续显示禁用样式；各工具的选区、滚动位置及导航焦点继续保留。

## 工作成果导出

通用视图的交互工作台页签提供导出入口。自定义界面将当前场景扁平化为文本表格，通过 `workspace-export` 动作提交已声明的 `workspace` 多行字段和 `workspace-format` 选择字段。前者最多 64 KiB，后者为 `json`（默认）或 `csv`；Wasm 会话不保存这份 payload，失败时保留原输入供手动修正或重试。

`workspace` 使用以下结构，不接受额外属性：

```json
{
  "schema": 1,
  "name": "Canvas",
  "columns": ["id", "title"],
  "rows": [["node-1", "Orbit"]]
}
```

名称非空且最多 80 个 UTF-8 字节；1–16 个唯一、非空列名，每列最多 120 字节；最多 200 行，每行宽度与列数一致，每格为字符串且最多 8 KiB。名称、列名和单元格不接受 NUL。JSON 产物 `workspace.json` 保留该结构和文本类型；CSV 产物 `workspace.csv` 包含表头和行，对所有单元格进行引号转义及潜在公式防护。导出只生成待保存产物，不自动写文件。

## 源码职责

| 模块                             | 职责                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| [ui/main.html](./ui/main.html)   | 交互场景、工具导航、检查点和动效；安全文本节点，增量更新保留焦点、选区和滚动 |
| [src/app.rs](./src/app.rs)       | 分派、独立草稿、会话 schema 和响应                                           |
| [src/studio.rs](./src/studio.rs) | 工作成果的有界校验、JSON / CSV 导出与通用视图入口                            |
| [src/view.rs](./src/view.rs)     | 视图、翻译与 UTF-8 边界                                                      |
| [src/text.rs](./src/text.rs)     | 文本转换、统计与产物                                                         |
| [src/data.rs](./src/data.rs)     | CSV / JSON、接收数据、网络回执与显式载入                                     |
| [src/tasks.rs](./src/tasks.rs)   | 存储、日期、冲突与确认                                                       |

场景和工具切换保留各自模型；减少动效、隐藏或离屏时停止持续动效，卸载时清理监听与帧调度。

## 构建与验证

从仓库根目录执行：

```sh
cargo test --manifest-path examples/extensions/apps/Cargo.toml --locked
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml --check
node --test examples/extensions/apps/ui.test.mjs
pnpm extension:demos:check
pnpm extension:test --manifest examples/extensions/apps/extension.json --wasm resources/extensions/demo-apps.wasm --ui-dir examples/extensions/apps/ui --fixture examples/extensions/apps/smoke.json
```

源码变更后先按 [内置资源流程](../../../docs/extensions.md#内置应用资源) 在参考平台重建，其他平台使用 `--compile`。单元测试覆盖既有 schema 3 草稿、导出边界、失败后输入保留及 CSV 公式防护，HTML 测试覆盖导航、输入保持、键盘、切换和动效清理，真实 Wasm fixture 核对中英视图、产物与可选效果请求；不访问外网，不代替真实效果往返或 WebView 验收。
