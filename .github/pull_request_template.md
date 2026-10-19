## 改了什么

<!-- 一段话说清这个 PR 做了什么 -->

## 为什么

<!-- 解决什么问题；关联 issue：Closes #123 -->

## 怎么验证

- [ ] 本地 `pnpm app:dev` 手动走通了改动路径
- [ ] `pnpm verify` 通过（格式 / lint / 类型 / 测试 / 构建）
- [ ] 涉及 Rust：在 `src-tauri/` 下运行 `cargo fmt --all -- --check`、`cargo clippy --locked --all-targets -- -D warnings`、`cargo test --locked` 通过

## 影响面

- [ ] 修改了 `src-tauri/capabilities/default.json`（权限变更，需要在下方说明理由）
- [ ] 修改了 `src-tauri/tauri.conf.json`（窗口 / 打包 / 标识符）
- [ ] 修改了 `Cargo.toml` 或新增依赖（需说明体积与许可证影响）
- [ ] 涉及数据结构或迁移
- [ ] 修改了对外行为（需要同步 `docs/` 里对应的说明）

## 截图

UI 改动必填，亮色与暗色各一张。

| 亮色 | 暗色 |
| ---- | ---- |
|      |      |

## 自查

- [ ] 普通 feature/fix 分支已 rebase 到最新 `origin/develop`；release/hotfix 按发布流程同步，未改写共享历史
- [ ] 提交信息符合 Conventional Commits
- [ ] 改动范围与 PR 描述符合 [Git 协作规范](../docs/conventions/git-workflow.md)
- [ ] 相关文档已同步更新
