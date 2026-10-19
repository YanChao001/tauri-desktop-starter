# 测试规范

## 现状

工程目前**没有接入测试框架**——这是有意的取舍，模板阶段保持依赖精简。
但只要开始写业务逻辑，下面这套分层就该补上，不要等到出事故。

## 测试分层

| 层            | 工具                       | 覆盖什么                          | 优先级       |
| ------------- | -------------------------- | --------------------------------- | ------------ |
| Rust 单元测试 | `cargo test`               | 命令函数、纯逻辑、数据转换        | 高           |
| 前端单元测试  | Vitest                     | `lib/` 下的工具函数、校验、格式化 | 高           |
| 组件测试      | Vitest + Testing Library   | 关键交互（表单校验、状态切换）    | 中           |
| 端到端        | tauri-driver + WebdriverIO | 启动、窗口、IPC 主链路            | 低（成本高） |

**不要追求覆盖率数字。** 判断标准是：这段代码出错时，用户会不会感知到？

## 什么必须测

- 所有 `src-tauri` 里的 `#[tauri::command]`：入参边界、错误分支、返回值结构
- `src/lib/` 里被多处调用的函数
- 涉及金额、日期、文件路径的转换逻辑
- 修 bug 时先补一个能复现的测试，再改代码

**不用测**：纯展示组件、shadcn 生成的原子组件、样式。

## 接入前端测试

```bash
pnpm add -D vitest @vitest/coverage-v8 jsdom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

新建 `vitest.config.ts`（与 `vite.config.ts` 分开，避免污染构建配置）：

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

`src/test/setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

`package.json` 增加：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

## Mock Tauri API

组件测试跑在 jsdom 里，没有 Rust 进程，必须 mock：

```ts
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("你好，测试！"),
}));
```

测试里断言调用参数：

```ts
import { invoke } from "@tauri-apps/api/core";

expect(invoke).toHaveBeenCalledWith("greet", { name: "测试" });
```

**这也是为什么要统一走 `lib/tauri.ts`**：只需要 mock 一个地方。

## Rust 测试

命令函数就是普通函数，直接测：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_contains_name() {
        assert!(greet("世界").contains("世界"));
    }

    #[test]
    fn greet_handles_empty_name() {
        assert!(!greet("").is_empty());
    }
}
```

```bash
cd src-tauri
cargo test
```

涉及文件系统的测试用 `std::env::temp_dir()`，不要写死路径，也不要污染用户目录。

## 端到端（可选）

`tauri-driver` 只支持 Windows 与 Linux，macOS 不支持。接入成本较高，
建议只在主链路（启动 → 加载数据 → 关键操作 → 退出）上做一两条，多了维护不动。

```bash
cargo install tauri-driver --locked
```

## 覆盖率目标

| 范围                          | 目标                   |
| ----------------------------- | ---------------------- |
| `src-tauri` 命令层与业务逻辑  | ≥ 70%                  |
| `src/lib`                     | ≥ 70%                  |
| `src/pages`、`src/components` | 不设目标，只测关键交互 |

## CI 里跑什么

`.github/workflows/ci.yml` 目前执行：格式检查、ESLint、类型检查、前端构建、`cargo fmt`、`cargo clippy`、`cargo test`。

接入测试后，把 `pnpm test` 加进 `frontend` job；端到端测试单开一个 job 并设为允许失败，
避免偶发超时卡住合并。
