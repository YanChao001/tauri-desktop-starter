## 改了什么

<!-- 一段话说清这个 PR 做了什么 -->

## 为什么

<!-- 解决什么问题；关联 issue：Closes #123 -->

## 怎么验证

- [ ] 本地 `pnpm app:dev` 手动走通了改动路径
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck` 通过
- [ ] 涉及 Rust：`cargo fmt --check`、`cargo clippy`、`cargo test` 通过

## 影响面

- [ ] 修改了 `src-tauri/capabilities/default.json`（权限变更，需要在下方说明理由）
- [ ] 修改了 `src-tauri/tauri.conf.json`（窗口 / 打包 / 标识符）
- [ ] 修改了 `Cargo.toml` 或新增依赖（需说明体积与许可证影响）
- [ ] 涉及数据结构或迁移
- [ ] 修改了对外行为（需要同步文档或 CHANGELOG）

## 截图

UI 改动必填，亮色与暗色各一张。

| 亮色 | 暗色 |
| ---- | ---- |
|      |      |

## 自查

- [ ] 分支已 rebase 到最新 `origin/develop`，历史中没有 merge 提交
- [ ] 提交信息符合 Conventional Commits
- [ ] 单个 PR 的 diff 在 400 行以内（超出已说明原因）
- [ ] 相关文档已同步更新
