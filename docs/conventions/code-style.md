# 代码风格与命名规范

> 本文档只写"工具管不了、需要人判断"的部分。缩进、引号、换行由 Prettier 决定，
> 类型错误由 `tsc` 决定，能用一条命令解决的问题不写进规范。

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

| 位置                       | 来源            | 规则                                                           |
| -------------------------- | --------------- | -------------------------------------------------------------- |
| `src/components/ui/`       | shadcn CLI 生成 | 可以改样式，**不改导出名、不改 props 签名**；升级时用 CLI 覆盖 |
| `src/components/<domain>/` | 自己写          | 命名导出，一个文件一个主组件                                   |
| `src/pages/`               | 自己写          | 默认导出，一个文件对应一条路由                                 |

- 组件超过 200 行，或同时处理数据和展示，就该拆。
- Props 类型命名为 `XxxProps`，紧贴组件定义，不放到文件末尾。
- 不写 `React.FC`，直接写函数并标注 props 类型。
- 组件文件名与组件名对应，`app-shell.tsx` → `export function AppShell`。
- `ui/` 下的组件不参与 ESLint 与 Prettier（见 `.prettierignore`、`eslint.config.js`），
  目的是保持与上游一致，避免每次 `shadcn add` 都产生冲突。

## TypeScript

- **禁止 `any`。** 未知类型用 `unknown`，在使用处收窄。
- 对象类型优先用 `type`，保持队内一种写法；需要声明合并（如扩展第三方类型）时用 `interface`，并在 PR 里说明原因。
- 导出的工具函数显式标注返回类型；组件返回值交给推断。
- 不用 `enum`，用 `as const` 对象 + 联合类型：

```ts
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
```

- 异步函数一律返回 `Promise<T>`，不要在 `async` 函数里混用同步返回。
- 非空断言 `!` 只在"运行到这里必然存在"且能一句话说清理由时使用，否则用可选链 + 默认值。
- 跨进程的数据（IPC 返回值）一律视为不可信，先校验再用。

## Rust

- 命令函数返回 `Result<T, String>` 或自定义错误类型，**不要 `unwrap()`/`expect()`**（启动阶段除外）。
- 命令函数名用动词开头：`read_config`、`save_settings`、`export_report`。
- 新增命令必须同时改两处：函数定义 + `generate_handler![]`，漏了会报 "command not found"。
- 阻塞操作（文件、网络、数据库）放进 `async` 命令或 `spawn_blocking`，不要卡住 UI 线程。
- 错误信息写给开发者看，日志里要带上下文（哪个文件、哪个参数）。
- `cargo fmt` + `cargo clippy -- -D warnings` 必须干净，CI 会卡这一条。

## 导入顺序

四组，组间空行，组内按字母序：

```ts
import path from "node:path"; // 1. Node 内置

import { useState } from "react"; // 2. 第三方

import { Button } from "@/components/ui/button"; // 3. 项目别名

import { localHelper } from "./local-helper"; // 4. 相对路径（尽量少用）
```

能用 `@/` 就别用 `../../`，超过两层的相对路径一律换别名。

## 注释

- 注释解释**为什么**，不解释**是什么**。`// 自增 1` 这种不要写。
- 决策性代码前面写一段说明取舍，例如 `lib/tauri.ts` 里对窗口显示时机的注释。
- 待办统一格式，必须带人和时间，否则半年后没人知道能不能删：

```ts
// TODO(张三, 2026-11): 接入 i18n 后移除硬编码文案
```

- 不保留被注释掉的代码，git 里有历史。

## 文案与排版

- 界面文案一律简体中文；技术名词保留英文原词（WebView、IPC、Rust）。
- 中英文之间加空格：`打开 WebView 设置`，不是 `打开WebView设置`。
- 中文标点用全角，代码与命令用半角。
- 按钮文案用动词开头：「保存」「新建项目」，不用「确定」这种无信息量的词（除非是系统约定的确认框）。
- 错误提示说清「发生了什么 + 该怎么办」，不要只抛一句「操作失败」。
