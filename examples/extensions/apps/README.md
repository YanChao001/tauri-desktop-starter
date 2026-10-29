# 本地工作台

可安装的 Extism 应用示例，使用包格式 3、API 2 和视图 2；版本与最低宿主见 [extension.json](./extension.json)。[ui/main.html](./ui/main.html) 复用宿主默认控件与主题。协议和授权见 [扩展指南](../../../docs/extensions.md)，界面调用见 [SDK](../../../sdk/README.md)。

## 交互工作台

- **创意画布**：在节点与连线中组织想法，直接调整画布内容与布局；界面中的状态变化即时完成。
- **数据透镜**：通过图表和筛选探索本地样例，比较不同分类与时间的数据，导出当前可见结果。
- **流程编排**：组合本地处理步骤并运行模拟，查看阶段与输出；模拟由当前界面驱动，不代表后台服务或原生任务。

三个场景的编辑、筛选和切换都在隔离界面中处理，不为每次交互执行 Wasm。工作成果导出才调用 Wasm 校验并生成产物。场景模型通过 SDK 检查点恢复；检查点不是长期业务存储，宿主会话导出包含相应草稿。

普通工作区面板、属性区和页脚跟随宿主皮肤强度；画布对象、图表、输入与数据阅读区保留各自底色。主题规则复用 [SDK](../../../sdk/README.md#默认外观与动效) 的表面 token。

数据透镜单独保留尚未应用的 JSON 原稿及编辑器展开状态，包括未完成或校验失败的内容；切换场景、成果导出和会话重建不会覆盖原稿。“应用数据”校验成功后替换当前数据，“放弃编辑”清除原稿并保留已应用的数据。输入最多 48000 个 UTF-8 字节，超出时明确提示并保留前段内容；登记失败继续保留页面输入。旧检查点缺少编辑元数据时仍可恢复，损坏或未来检查点保留原值并停止写入。

工作台无需文本、文件、网络或私有存储权限，三个场景均可离线使用。当前 Wasm 会话为 schema 4，仅保存工作台协议状态；场景草稿保存在 SDK 检查点中。旧版、损坏或未来会话拒绝导入并保留原文件，不读取或清除已有插件私有存储。产物由用户主动保存，取消不报告成功；会话和窗口操作由宿主“扩展工具”提供。

## 工作成果导出

通用视图提供工作台导出入口。自定义界面将当前场景扁平化为文本表格，通过 `workspace-export` 动作提交已声明的 `workspace` 多行字段和 `workspace-format` 选择字段。前者最多 64 KiB，后者为 `json`（默认）或 `csv`；Wasm 会话不保存这份 payload，失败时保留原输入供手动修正或重试。

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

| 模块                             | 职责                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| [ui/main.html](./ui/main.html)   | 交互场景、导航、检查点和动效；安全文本节点，增量更新保留焦点、选区和滚动 |
| [src/app.rs](./src/app.rs)       | 请求分派、会话 schema 和响应                                             |
| [src/studio.rs](./src/studio.rs) | 工作成果的有界校验、JSON / CSV 导出与通用视图入口                        |
| [src/view.rs](./src/view.rs)     | 视图、翻译与 UTF-8 边界                                                  |

场景切换保留各自模型；减少动效、隐藏或离屏时停止持续动效，卸载时清理监听与帧调度。

## 构建与验证

从仓库根目录执行：

```sh
cargo test --manifest-path examples/extensions/apps/Cargo.toml --locked
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml --check
node --test examples/extensions/apps/ui.test.mjs
pnpm extension:demos:check
pnpm extension:test --manifest examples/extensions/apps/extension.json --wasm resources/extensions/demo-apps.wasm --ui-dir examples/extensions/apps/ui --fixture examples/extensions/apps/smoke.json
```

源码变更后先按 [内置资源流程](../../../docs/extensions.md#内置应用资源) 在参考平台重建，其他平台使用 `--compile`。单元测试覆盖会话拒写、已移除动作拒绝、导出边界及 CSV 公式防护，HTML 测试覆盖三个场景、草稿保持、键盘、导出和动效清理，真实 Wasm fixture 核对中英视图与产物；不访问外网，不代替真实效果往返或 WebView 验收。
