# 内置扩展实验室

一个实际安装并运行的 Extism 应用，使用包格式 3、API 2 和视图 2。清单中的权限均为可选；未授权网络或存储时，文本、数据预览和六关点灯游戏仍可离线使用。协议及宿主边界见[扩展指南](../../../docs/extensions.md)。

## 体验

- **文本工坊**：九种文本转换、Unicode 字符与 UTF-8 大小统计、词频图表，以及可单独保存的结果文件。JSON 格式错误定位到行列；去重保留首次出现顺序。编辑器最多载入 64 KiB，截取时明确提示，统计与导出使用同一份已载入文本。
- **数据连接**：CSV / JSON 样例、表格预览、自动数值图表和 JSON / CSV 产物。CSV 支持引号、逗号和多行单元格；JSON 支持对象、对象数组和标量数组。输入最多 64 KiB，预览最多 16 列、200 行。JSON 表格导出使用文本单元格；CSV 导出中可能触发表格公式的内容增加单引号。
- **文件与网络**：用户主动发送文件后展示名称、大小和类型提示，文本进入工坊；二进制不会冒充 UTF-8。真实 HTTPS 请求仅在用户点击后产生，只访问清单声明的公共样例服务。
- **待办与偏好**：最多 50 个任务、真实日期检查、完成 / 恢复 / 删除、JSON 备份、昵称与重启持久化。写入失败保留草稿，不自动重试；跨窗口列表变更后旧行按钮停止执行，避免误改其他任务。清空全部任务需要再次确认。
- **点灯解谜**：六个可解的 5 × 5 关卡、撤销、重玩和实际执行一步的提示；提示给出可行解，不宣称最优。关卡、胜负和提示算法全部位于插件中。

## 源码职责

| 模块            | 职责                                         |
| --------------- | -------------------------------------------- |
| `src/app.rs`    | 请求分派、会话版本、页签和协议响应           |
| `src/view.rs`   | 简单视图构造、翻译和 UTF-8 边界工具          |
| `src/text.rs`   | 文本转换、统计和结果文件                     |
| `src/data.rs`   | 有界 CSV / JSON 解析、文件元数据和 HTTP 回执 |
| `src/tasks.rs`  | 私有存储效果、日期、冲突和草稿               |
| `src/puzzle.rs` | 棋盘规则、解法、撤销和历史重放校验           |

每次调用都能在新 Wasm 实例中独立完成。状态只保存输入、草稿和可校验的游戏历史；表格、统计和图表由输入重算，不信任导入会话里的预计算结果。长期任务读取宿主当轮注入的私有存储快照，不把会话文件当作业务备份。

## 构建与验证

从仓库根目录执行：

```sh
cargo test --manifest-path examples/extensions/apps/Cargo.toml --locked
cargo fmt --manifest-path examples/extensions/apps/Cargo.toml --check
pnpm extension:demos:build
pnpm extension:demos:check
pnpm extension:test --manifest examples/extensions/apps/extension.json --wasm resources/extensions/demo-apps.wasm --fixture examples/extensions/apps/smoke.json
```

原生单元测试编译纯业务逻辑；Extism 导出入口只在 Wasm 目标启用。`smoke.json` 通过真实 Wasm 校验中英视图、文件产物、可选权限和效果请求，不访问外部服务。宿主的真实 Wasm 与效果往返回归另在 Rust 扩展测试中维护。
