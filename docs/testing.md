# 测试规范

## 现状

前端已接入 Vitest（jsdom + Testing Library），Rust 用内置的 `cargo test`，CI 两边都会跑。

模板带有回归用例，覆盖路由匹配、错误边界、剪贴板降级链路、浏览器预览守卫、外链拦截、窗口显示、外观设置与主题切换。
**这是骨架，不是覆盖率目标。** 写业务时按下面的分层往上加。

## 测试分层

| 层               | 工具                       | 覆盖什么                          | 优先级         |
| ---------------- | -------------------------- | --------------------------------- | -------------- |
| Rust 单元测试    | `cargo test`               | 命令函数、纯逻辑、数据转换        | 高             |
| 前端单元测试     | Vitest                     | `lib/` 下的工具函数、校验、格式化 | 高             |
| 组件测试         | Vitest + Testing Library   | 关键交互（表单校验、状态切换）    | 中             |
| 构建脚本测试     | Node 内置测试器            | 版本解析、同步与打包边界          | 高             |
| 端到端（未接入） | tauri-driver + WebdriverIO | 启动、窗口、IPC 主链路            | 按发布风险选择 |

**不要追求覆盖率数字。** 判断标准是：这段代码出错时，用户会不会感知到？

## 什么必须测

- 所有 `src-tauri` 里的 `#[tauri::command]`：入参边界、错误分支、返回值结构
- `src/lib/` 里被多处调用的函数
- 涉及金额、日期、文件路径的转换逻辑
- 修 bug 时先补一个能复现的测试，再改代码

纯展示组件、shadcn 生成的原子组件与样式通常由人工检查；关键无障碍行为或历史缺陷可按风险补回归测试。

## 前端测试怎么跑

配置已经就位，不用再做接入：

| 文件                | 作用                                           |
| ------------------- | ---------------------------------------------- |
| `vitest.config.ts`  | jsdom 环境；alias 复用 `vite.config.ts` 的导出 |
| `src/test/setup.ts` | 注册 jest-dom 的 DOM 断言                      |

测试文件与被测代码同目录，命名 `*.test.ts(x)`：

```
src/routes.test.ts
src/components/error-boundary.test.tsx
src/hooks/use-external-links.test.tsx
```

```bash
pnpm test           # 跑一遍，CI 用这个
pnpm test:watch     # 监听模式，边写边跑
pnpm test:coverage  # 覆盖率报告
pnpm test:scripts   # 版本、便携包与清理脚本的回归测试（Node 内置测试器）
```

覆盖率只统计 `src/`，已排除 `components/ui/`（shadcn 原子组件）和测试自身，具体范围以 [`vitest.config.ts`](../vitest.config.ts) 为准。
**不要为了数字去测 getter。**

## Mock Tauri API

组件测试跑在 jsdom 里，没有 Rust 进程，必须 mock。**优先 mock 自己封装的能力**，
测试就不会绑死 Tauri 的内部实现：

```ts
import { vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
  invokeGreet: vi.fn().mockResolvedValue("你好，测试！"),
}));
```

断言调用参数：

```ts
import { invokeGreet } from "@/lib/tauri";

expect(vi.mocked(invokeGreet)).toHaveBeenCalledWith("测试", "zh");
```

只有一件事值得直接 mock `@tauri-apps/api/core`——验证命令名、参数名有没有写错。
那是「IPC 契约」层面的测试，数量应该很少：

```ts
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

expect(vi.mocked(invoke)).toHaveBeenCalledWith("greet", {
  name: "测试",
  language: "zh",
});
```

**这也是为什么要统一走 `lib/tauri.ts`**：常规测试只需要 mock 一个地方。
ESLint 的边界规则对 `*.test.*` / `*.spec.*` 开了例外，第二种写法不会被拦。

## Rust 测试

命令函数就是普通函数，直接测。`src-tauri/src/commands.rs` 里有现成的写法：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_returns_greeting() {
        assert_eq!(greet("世界", None).unwrap(), "你好，世界！这条消息来自 Rust。");
    }

    #[test]
    fn greet_rejects_blank_name() {
        assert!(greet("", None).is_err());
        assert!(greet("   ", Some("en")).is_err());
    }
}
```

关键点：`#[tauri::command]` 标注的函数可以直接调用，不需要构造窗口或 App 实例。
只有参数里带 `AppHandle`、`State` 的命令才需要 `tauri::test::mock_builder()` 搭环境。

```bash
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

以上命令从仓库根目录运行。先构建前端，确保 `generate_context!` 需要的 `dist` 存在。涉及文件系统的测试应在临时目录中创建独立子目录并清理，避免并行用例互相污染或写入用户数据目录。

## 端到端（可选）

`tauri-driver` 只支持 Windows 与 Linux，macOS 不支持。接入成本较高，
建议只在主链路（启动 → 加载数据 → 关键操作 → 退出）上做一两条，多了维护不动。

```bash
cargo install tauri-driver --locked
```

覆盖率报告用于查找未覆盖的风险分支，当前 CI 不设置百分比门槛；Rust 覆盖率工具尚未接入。

## CI 里跑什么

`.github/workflows/ci.yml` 的 `frontend` job 执行：版本一致性、脚本测试、格式检查、ESLint、类型检查（覆盖源码与 vite/vitest 配置文件）、单元测试、前端构建。
`rust` job 在 Windows、Ubuntu、macOS 三个平台执行 `cargo clippy` 与 `cargo test`，`cargo fmt` 只在 Windows 跑一次。

端到端测试当前**没有**进 CI。接入时单开 job，明确目标平台、超时和失败日志；作为发布或合并门槛的关键链路不能静默忽略失败。
