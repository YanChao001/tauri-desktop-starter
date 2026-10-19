# 代码风格与命名规范

本文说明命名、分层、组件与评审约定。格式由 Prettier / rustfmt 负责，类型由 `tsc` / Rust 编译器检查；未配置自动检查的约定在 review 时确认。

## 总原则

1. **一致性优先于个人偏好。** 同一件事在代码库里只有一种写法。
2. **可读性优先于技巧。** 不要为了少写两行而使用冷门语法。
3. **边界处严谨，内部宽松。** 来自外部的数据必须校验；模块内部的类型可以信任。
4. **代码即文档。** 命名说清楚的东西不要用注释重复一遍。

## 文件与目录命名

| 对象                 | 规则                            | 示例                                |
| -------------------- | ------------------------------- | ----------------------------------- |
| 目录                 | `kebab-case`                    | `src/components/settings-panel/`    |
| React 组件文件       | `kebab-case`                    | `app-shell.tsx`、`theme-toggle.tsx` |
| React 组件名         | `PascalCase`                    | `AppShell`、`ThemeToggle`           |
| Hook 文件            | `use-*.ts`                      | `use-window-state.ts`               |
| Hook 函数            | `useXxx`                        | `useWindowState`                    |
| 普通工具模块         | `kebab-case`                    | `format-date.ts`                    |
| 类型定义             | 跟随所在模块，不单开 `types.ts` | `UpdatePayload`                     |
| Rust 文件 / 模块     | `snake_case`                    | `window_state.rs`                   |
| 常量（模块级真常量） | `UPPER_SNAKE_CASE`              | `MAX_RETRY_COUNT`                   |

布尔变量统一加前缀：`isVisible`、`hasChanges`、`canSubmit`、`shouldRetry`。
事件处理器：组件内部 `handleXxx`，作为 prop 传出去时叫 `onXxx`。

## 组件约定

三类组件，三种对待方式：

| 位置                       | 来源            | 规则                                                          |
| -------------------------- | --------------- | ------------------------------------------------------------- |
| `src/components/ui/`       | shadcn CLI 生成 | 可以改样式；维持调用方兼容，升级前审查 CLI 差异并保留本地定制 |
| `src/components/<domain>/` | 自己写          | 命名导出，一个文件一个主组件                                  |
| `src/pages/`               | 自己写          | 默认导出，一个文件对应一条路由                                |

- 组件难以独立理解、测试或复用时拆分；行数只作提示，不为满足数字拆出空壳。
- Props 类型命名为 `XxxProps`，紧贴组件定义，不放到文件末尾。
- 不写 `React.FC`，直接写函数并标注 props 类型。
- 组件文件名与组件名对应，`app-shell.tsx` → `export function AppShell`。
- `ui/` 下的组件不参与 ESLint 与 Prettier（见 `.prettierignore`、`eslint.config.js`），
  目的是保持与上游一致，避免每次 `shadcn add` 都产生冲突；内置的 `src/styles/shadcn.css` 同理。

## TypeScript

- **手写业务代码禁止 `any`。** 未知类型用 `unknown`，在使用处收窄；`lib/generated/` 保留导出工具的运行时代码，不手改生成的断言。
- 对象类型优先用 `type`，保持队内一种写法；需要声明合并（如扩展第三方类型）时用 `interface`，并在 PR 里说明原因。
- 导出的工具函数显式标注返回类型；组件返回值交给推断。
- 不用 `enum`，用 `as const` 对象 + 联合类型：

```ts
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
```

- 异步函数一律返回 `Promise<T>`，不要在 `async` 函数里混用同步返回。
- 非空断言 `!` 只在"运行到这里必然存在"且能一句话说清理由时使用，否则显式处理缺失分支。
- Rust DTO 与命令从 `bindings.rs` 生成 TypeScript，页面通过 `lib/tauri.ts` 调用；边界输入和存储数据仍须运行时校验，不能把生成类型当作校验器。

## 重复与抽象

代码膨胀通常不是因为写得长，而是因为同一件事写了三遍。反过来，抽象太早也会膨胀——
多一个用不上的参数，就多一条没人测的分支。

### 先写三遍，再抽象

- 同一段逻辑**出现第三次**时再抽公共函数。第二次出现往往是巧合，这时抽象会为了兼容两个场景写出一堆开关。
- 抽出来的函数要能用一句话说清它做什么。说不清，说明抽象层级错了。
- 不为"将来可能要用"预留参数、模式开关、扩展点。真到要用时再改，比维护一条死分支便宜。

### 什么算重复

算：

- 同一段业务规则在两处各写一遍（校验、计算、状态判断）。这类重复最危险，改一处漏一处就是线上事故。
- 同一个常量值硬编码在两处。
- 同一段 JSX 结构复制到第三处。

不算：

- 两处代码长得像，但改一个不会影响另一个。这种"形似"合并后往往要靠 `if (mode === "a")` 分叉，比分开写更难读。
- 三五行以内的简单表达式。
- 两个组件碰巧用了同样的样式类名。

### 抽到哪

| 重复的东西        | 放哪                                      |
| ----------------- | ----------------------------------------- |
| 纯逻辑、格式化    | `lib/`                                    |
| 带状态的 UI 逻辑  | `hooks/`                                  |
| 展示结构          | `components/`                             |
| 跨进程的调用      | `lib/tauri.ts`                            |
| Rust 侧的公共逻辑 | `src-tauri/src/` 下独立模块，不要塞进命令 |

### 不要做的抽象

- 不写"万能组件"（一个组件用 props 支持六种形态）。真需要时拆成几个小单元组合。
- 不建空的 `utils/`、`helpers/`、`services/` 目录等着往里填。空目录会吸引不合适的代码。
- 不为了消除一处三行重复，引入一个新依赖。

## Rust

- 命令函数统一返回 `NativeResult<T>`，使用 `NativeError { code, message, retryable }`；**不要 `unwrap()`/`expect()`**（启动阶段除外）。错误码表达稳定语义，前端不解析字符串。
- 命令函数名用动词开头：`read_config`、`save_settings`、`export_report`。
- 新增命令实现并标注 `#[tauri::command]` / `#[specta::specta]`，在 `bindings.rs` 的 `collect_commands!` 注册，再运行 `pnpm bindings:generate`；CI 用 `bindings:check` 检查漂移。前端新增门面函数，不另写字符串命令或 DTO。
- 文件、网络、数据库操作使用异步 API；同步阻塞调用放进 `spawn_blocking`，不要仅加 `async` 关键字就直接执行阻塞调用。
- 内部日志记录必要上下文并脱敏；返回前端的错误按用户可采取的动作组织，避免暴露敏感路径、令牌或请求内容。
- `cargo fmt` + `cargo clippy -- -D warnings` 必须干净，CI 会卡这一条。

## 导入顺序

保持现有文件的导入顺序；新模块可按以下分组组织。当前未安装导入排序插件，不为了排序产生无关 diff：

```ts
import path from "node:path"; // 1. Node 内置

import { useState } from "react"; // 2. 第三方

import { Button } from "@/components/ui/button"; // 3. 项目别名

import { localHelper } from "./local-helper"; // 4. 相对路径（尽量少用）
```

能用 `@/` 就别用 `../../`，超过两层的相对路径一律换别名。

## 注释

一条底线：**注释解释为什么，不解释是什么。**

```ts
// 差：把名字拼进问候语
// 好：Rust 始终校验名称；前端可提前提示，但不能替代命令边界校验
```

### 三档，按需选

**1. 文件头——只给"边界文件"写**

`lib/tauri.ts`、`commands.rs`、`routes.tsx` 这类入口或边界文件写文件头，
说明它是什么、边界在哪。普通页面和组件不写。

```ts
/**
 * 系统能力的唯一出口。
 *
 * 手写应用代码只从这里调用 Tauri；lib/generated/ 是生成工具的底层例外。
 * 页面、组件、hooks 依赖门面函数，不直接碰 Tauri API。
 */
```

```rust
//! 前端可调用的命令。
//!
//! 命令实现放在这里，`lib.rs` 只负责组装（注册插件、挂上 handler）。
```

**2. 导出 API——一句话说清契约**

导出的函数、Hook、组件用 doc comment 写"做什么 + 什么情况下失败"，不列参数类型（签名里有）。

```ts
/** 显示并聚焦主窗口。窗口初始为隐藏，见 tauri.conf.json。 */
export async function revealWindow(): Promise<void> {}
```

```rust
/// 名称由 Rust 边界校验；失败返回稳定错误码。
#[tauri::command]
#[specta::specta]
pub fn greet(name: &str, language: Option<&str>) -> NativeResult<String> {
    // 具体实现见 src-tauri/src/commands.rs
    todo!()
}
```

**3. 行内——只写"读到这里会疑惑"的地方**

决策、反直觉的写法、为绕过某个坑而做的妥协。数量应该很少：
如果每行都有注释，说明代码本身没写清楚。

```ts
// 等两帧而不是在 effect 里直接调用：useEffect 不保证在 paint 之后执行，
// 提前 show() 仍会闪一下空白窗口
requestAnimationFrame(() => {});
```

### 格式

- TS/TSX 用 `/** */`，Rust 用 `///`，Rust 模块级用 `//!`。
- 行内注释写在被解释代码的**上一行**，不做行尾对齐。
- 中文注释，单句不加句号；成段时正常标点。

### 不要写

- 复述代码的注释：`// 把 pending 设为 true`。
- 被注释掉的代码——git 里有历史，不需要现场留档。
- 作者签名、修改日期、`@author`：`git blame` 比这准确。
- 大段分隔线（`// ===== 工具函数 =====`）。需要分隔线，说明文件该拆了。

### 待办

统一格式，必须带人和时间，否则半年后没人知道能不能删：

```ts
// TODO(张三, 2026-11): 接入 i18n 后移除硬编码文案
```

## 文案与排版

- 界面文案通过 `src/i18n/zh-CN.ts` 与 `en.ts` 维护，两份入口分别组合基础和功能词典；新键同时补齐中英，新语言在 `registry.ts` 注册。技术名词保留原词（WebView、IPC、Rust）。
- 中英文之间加空格：`打开 WebView 设置`，不是 `打开WebView设置`。
- 中文标点用全角，代码与命令用半角。
- 按钮文案用动词开头：「保存」「新建项目」，不用「确定」这种无信息量的词（除非是系统约定的确认框）。
- 错误提示说清「发生了什么 + 该怎么办」，不要只抛一句「操作失败」。
