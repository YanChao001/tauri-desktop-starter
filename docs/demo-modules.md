# 模块体验、扩展与裁剪

本文用于体验现有模块、跟做新增页面到原生命令的完整链路，并为派生项目移除不需要的能力。运行结构见 [架构说明](./architecture.md)，安全边界见 [安全规范](./security.md)，验证分层见 [测试规范](./testing.md)。

## 演示目标与验收边界

默认提供尽可能完整、可操作的功能样本，使用时按产品需求评估和裁剪。增加展示应补齐实际工作流或缺失状态，复用现有服务与控件；不以静态卡片宣称尚未实现的账户、云同步或后台能力。

页面内演示、原生存储与外部服务分别标明边界。退出协商、版本冲突、合作取消和未来版本拒写以 [架构说明](./architecture.md) 为准；权限与输入校验见 [安全规范](./security.md)。

按 [测试规范](./testing.md) 验证成功、空、加载、错误 / 重试、取消与输入保留。浏览器覆盖子路径、中英 / 明暗 / 窄屏、键盘与无障碍；原生 IPC、多窗口、恢复与重启需独立桌面验证。正式安装、卸载、系统授权、关联、签名与真实更新使用目标平台最终安装包验收。

## 体验现有模块

默认模式保留完整 demo。设置中的 `minimal` 和初始化的 `--minimal` 只过滤展示与命令，不删除路由源码、依赖、IPC、插件或权限，也不代表安装包已经缩小。

从首页或能力目录选择交互创作、文件到笔记、后台任务、数据可靠性路线，可按跨页步骤体验。导览不会代替实际操作或标记成功；浏览器中的原生页面提供对应流程说明，真实结果需在桌面应用查看。

| 用户工作流                                                                       | 入口与源码                                            | 数据与验证边界                                                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 预览、应用和撤销风格；拖动弹簧球、切换卡片布局、翻转倾斜卡和调整轨道             | `/`、`/motion`；`showcase/`、`motion-lab/`            | 局部预览不写设置，应用后可撤销；减少动效、离屏与文档隐藏时降级或暂停                                   |
| 体验表单、反馈与收藏，检查只读 / 禁用 / 校验 / 部分选择及错误重试                | `/components`；`components/showcase/`                 | 页面内演示，无邮件投递或原生持久化；同页切换保留输入                                                   |
| 浏览资源树、右键重命名 / 复制 / 删除、撤销、拖放排序和跨目录移动、调整分栏       | `/components` 工作区；`workspace-studio.tsx`          | 页面内样本，搜索多选过滤类型；支持键盘树导航、菜单与排序，不读写磁盘                                   |
| 搜索能力，打开页面、源码与文档                                                   | `/catalog`；`features/catalog/`                       | 按本地、原生、外部服务区分；源码链接不是额外下载或执行入口                                             |
| 创建笔记，另开窗口制造版本冲突，回收 / 恢复，再导出和恢复备份                    | `/database`；`database.rs`、`data_commands.rs`        | 真实 SQLite、按窗口持久草稿、全量逻辑 JSON；恢复前留安全备份                                           |
| 打开 / 拖入文本与图片，编辑后由外部程序改磁盘，再处理冲突                        | `/workbench`；`components/workbench/`、`workbench.rs` | 原生授权、原子保存、草稿保留；文本可导入 SQLite 笔记副本，原文件与脏稿保留；图片只读，另存取消不丢编辑 |
| 选目录，提交扫描与 SHA-256，离页后查看，取消 / 重试 / 导出                       | `/tasks`；`workbench.rs`                              | Rust 实际任务、2 执行 + 10 排队、合作取消；重启中断需重新运行                                          |
| 发送通知、读写剪贴板、登记冲突快捷键、恢复独立窗口                               | `/system`；`system_commands.rs`、`use-workspace.ts`   | 实际系统能力，权限与 OS 服务可能拒绝；关联 / 深链需安装版验收                                          |
| 用本地 fixture 操作 GET / POST、缓存、超时、取消和离线，再切 HTTPS               | `/network`；`features/network/`                       | fixture 明确为本地；真实端点受白名单限制；会话非 OAuth，凭据项独立存系统服务                           |
| 筛选万条记录、分页 / 虚拟滚动、调列宽 / 显隐列、详情与批量部分失败；切换条件表单 | `/data-studio`；`features/data-studio/`               | 本地生成数据与故障示例，不写 SQLite，不代表服务端事务                                                  |
| 按内容 / 图表 / 连接标签体验 Markdown、媒体预览、图表、WSS 回显与固定 worker     | `/media`；`features/media/`                           | 同页切换保留状态，离页释放资源；不执行 Markdown HTML，附件不上传，外部连接主动开启                     |
| 在隔离测试目录制造启动存储错误，预览备份并安排重启恢复                           | `/recovery`；`recovery.rs`、`recovery-gate.tsx`       | 原件归档、临时工作区与恢复日志；未来版本拒绝降级覆盖，不在真实用户目录演练                             |

窗口、IPC、设置、诊断和更新还分别位于 `/desktop`、`/bridge`、`/settings`、`/diagnostics`、`/updates`；应用内能力目录提供各页源码与文档链接。浏览器中的原生入口说明环境限制，不伪造 IPC 成功。

## 依赖与加载

精确版本以 [pnpm-lock.yaml](../pnpm-lock.yaml) / [Cargo.lock](../src-tauri/Cargo.lock) 为准，声明范围见 [package.json](../package.json) / [Cargo.toml](../src-tauri/Cargo.toml)。下表只维护用途与许可；分发时按实际包含内容核对义务。

| 依赖                              | 许可                                                | 用途                                                     |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| TanStack Query / Table / Virtual  | MIT                                                 | 缓存、表格状态与虚拟滚动                                 |
| React Hook Form / resolvers / Zod | MIT                                                 | 复杂表单与运行时 schema                                  |
| react-markdown / remark-gfm       | MIT                                                 | 安全 Markdown / GFM                                      |
| lowlight / highlight.js           | MIT / BSD-3-Clause                                  | TypeScript 文本高亮                                      |
| Recharts                          | MIT                                                 | 本地指标图表                                             |
| Tauri 系统插件                    | MIT OR Apache-2.0                                   | 原生文件、通知、剪贴板、快捷键、深链、HTTP 与固定 worker |
| walkdir / sha2 / keyring          | Unlicense/MIT；MIT OR Apache-2.0；MIT OR Apache-2.0 | 遍历、哈希与凭据                                         |
| Playwright / axe Playwright       | Apache-2.0 / MPL-2.0                                | 浏览器及无障碍检查                                       |

页面在 `routes.tsx` 中使用 `lazy`；表格 / 表单、Query、Markdown 和图表跟随对应页面加载，门面中的 JS 插件按调用动态导入。Rust 插件仍在应用启动组装，前端懒加载不会减少原生依赖编译或安装包体积。WSS 使用标准 WebSocket，由门面和 CSP 限制，没有额外安装 websocket 插件。

TypeScript 高亮使用 lowlight / highlight.js，仅引入核心和 TypeScript 语法，随使用 `CodeBlock` 的懒加载页面加载，不引入全语言包或自动扫描 DOM。它们只处理本地文本，没有原生权限或平台依赖；输出语法树转换为 React 文本 token。许可证原文保存在 [代码高亮许可](../public/licenses/code-highlighting.txt)，由 Vite 复制到网页与桌面内嵌前端资源中。

比较体积时执行同一配置的 `pnpm build` / `pnpm build:web`，区分入口、路由块、共享块、原始与 gzip 大小；不能把各块总和当作首屏下载量，也不能由压缩体积推导常驻内存或启动耗时。性能采样方法见 [安装版与启动验收](./testing.md#安装版与启动验收)。

## 新增页面到 IPC 与测试

下面以“统计本地文本”作完整最小示例，文件名和键名均为待新增内容。它不需要新插件或权限；先在未修改前端时运行 `pnpm build` 准备原生编译需要的 `dist/`，然后先完成 Rust 与绑定，再接前端，避免尚未生成 DTO 的类型错误。

### 1. 服务、DTO 与边界测试

新增 `src-tauri/src/text_tools.rs`。输入上限按 UTF-8 字节计算，字符数按 Unicode scalar value 计算，行数沿用 Rust `lines()`，不是字节数或屏幕行数。

```rust
use serde::Serialize;
use specta::Type;
use crate::error::{NativeResult, bounded_text};

#[derive(Debug, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextSummary {
    pub characters: u32,
    pub lines: u32,
}

pub fn summarize(text: &str) -> NativeResult<TextSummary> {
    bounded_text(text, 16 * 1024, "Text")?;
    Ok(TextSummary {
        characters: text.chars().count() as u32,
        lines: text.lines().count() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn counts_unicode_and_rejects_oversize_input() {
        assert_eq!(summarize("hello\n世界").unwrap(), TextSummary { characters: 8, lines: 2 });
        assert_eq!(summarize(&"x".repeat(16 * 1024 + 1)).unwrap_err().code, ErrorCode::InputTooLong);
    }
}
```

新增 `src-tauri/src/text_tools_commands.rs`：

```rust
use crate::{error::NativeResult, text_tools::{self, TextSummary}};

#[tauri::command]
#[specta::specta]
pub fn summarize_text(text: String) -> NativeResult<TextSummary> {
    text_tools::summarize(&text)
}
```

这是有界的纯计算；若改成文件、数据库或系统调用，使用 `blocking::run` / 异步 API，不能只加 `async` 后继续阻塞。涉及状态时在服务中定义归属、并发和持久化，不放进 `lib.rs`。

### 2. 注册、生成与门面

在 `lib.rs` 添加 `mod text_tools; mod text_tools_commands;`；在 `bindings.rs` 的 `collect_commands!` 添加 `crate::text_tools_commands::summarize_text`。DTO 已被命令返回类型引用，无需再手写一份 TypeScript。

```bash
pnpm bindings:generate
```

在 `src/lib/tauri.ts` 复用已有 `callNative`：

```ts
export type { TextSummary } from "./generated/bindings";
export function summarizeText(
  text: string,
): Promise<import("./generated/bindings").TextSummary> {
  return callNative((commands) => commands.summarizeText(text));
}
```

### 3. 页面、语言与路由

在中英词典入口分别补齐这些键；新增较大领域时按现有 `zh-*.ts` / `en-*.ts` 模式拆词典并在两入口组合。

| 键                      | 中文                                 | English                                        |
| ----------------------- | ------------------------------------ | ---------------------------------------------- |
| `textTools.title`       | 文本统计                             | Text summary                                   |
| `textTools.description` | 通过 Rust 统计本地文本，不上传内容。 | Count local text in Rust without uploading it. |
| `textTools.input`       | 文本内容                             | Text                                           |
| `textTools.run`         | 统计文本                             | Count text                                     |
| `textTools.counts`      | {characters} 个字符，{lines} 行      | {characters} characters, {lines} lines         |

新增 `src/pages/text-tools.tsx`：

```tsx
import { useEffect, useRef, useState } from "react";
import { NativePage } from "@/components/native-page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { nativeErrorText } from "@/lib/native-error";
import { summarizeText, type TextSummary } from "@/lib/tauri";
import { useI18n } from "@/providers/i18n";

export default function TextTools() {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [result, setResult] = useState<TextSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const next = await summarizeText(text);
      if (mounted.current) setResult(next);
    } catch (reason) {
      if (mounted.current) setError(reason);
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <NativePage
      title={t("textTools.title")}
      description={t("textTools.description")}
    >
      <form
        className="space-y-3"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Label htmlFor="summary-text">{t("textTools.input")}</Label>
        <textarea
          id="summary-text"
          rows={6}
          value={text}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" disabled={pending}>
          {t("textTools.run")}
        </Button>
        {error ? <p role="alert">{nativeErrorText(error, t)}</p> : null}
        {result ? (
          <output className="block">{t("textTools.counts", result)}</output>
        ) : null}
      </form>
    </NativePage>
  );
}
```

在 `routes.tsx` 添加懒加载 `const TextTools = lazy(() => import("@/pages/text-tools"));` 和 `APP_ROUTES` 项 `{ path: "/text-tools", labelKey: "textTools.title", group: "capabilities", icon: TerminalIcon, component: TextTools, demoOnly: true }`。该文件已有 `TerminalIcon`；导航和页面命令从同一注册表产生。给能力目录补描述、源码与文档链接；如支持原生激活导航，再同步 `system_commands::allowed_route`。需要动作快捷键时通过 `useRegisterCommands` 复用 `run`，不另装全局键盘监听。

### 4. 页面失败回归与验证

新增 `src/pages/text-tools.test.tsx`，组件测试只 mock 门面，验证真实输入与失败行为：

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { summarizeText } from "@/lib/tauri";
import TextTools from "./text-tools";

vi.mock("@/lib/tauri", () => ({ summarizeText: vi.fn() }));
vi.mock("@/components/native-page", () => ({
  NativePage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/providers/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

it("keeps input and exposes a recoverable native failure", async () => {
  vi.mocked(summarizeText).mockRejectedValue({ code: "STORAGE_IO" });
  render(<TextTools />);
  const input = screen.getByLabelText("textTools.input");
  fireEvent.change(input, { target: { value: "keep this text" } });
  fireEvent.click(screen.getByRole("button", { name: "textTools.run" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("errors.IO");
  expect(input).toHaveValue("keep this text");
  expect(summarizeText).toHaveBeenCalledExactlyOnceWith("keep this text");
});
```

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo test --manifest-path src-tauri/Cargo.toml --locked text_tools::tests --lib
pnpm test src/pages/text-tools.test.tsx
pnpm typecheck
pnpm lint
pnpm bindings:check
pnpm build:web
```

在独立环境或安排的前台时段运行桌面 `pnpm app:dev` 验证实际 IPC、输入保留、中英与键盘；日常先用无头浏览器确认环境说明。共享路由、Provider 或事件变化时按 [验证范围](./testing.md#日常验证范围) 扩大检查。不要把 mock 成功当作原生能力实测。

## 实际裁剪模块

在独立分支操作，先说明现有用户数据如何导出 / 迁移，再删调用方、原生命令和依赖；不要通过清理脚本删除用户目录。对每个模块执行同一闭环：路由 / 菜单 / 命令与能力目录 → 门面 / DTO / 事件 → Rust 注册 / 状态 / 服务 → Cargo / npm 依赖 → capability / CSP / 系统关联 → 词典 / 文档 / 测试 / CI；重新生成绑定和锁文件，检查没有未调用导出或失效入口。

### 删除 SQLite 笔记

1. 从 `routes.tsx` 移除 `/database`，清理首页 / 菜单 / 能力目录、系统页的笔记窗口入口，以及 `system_commands.rs` 的固定 `/database` 导航和工作区白名单。不要让旧工作区恢复到已删除页面。
2. 删除页面和笔记草稿状态 / 未保存工作注册；从 `tauri.ts`、`bindings.rs` 清理旧 CRUD、分页、批量、草稿与备份命令、Note DTO；移除 `data_commands.rs` 和 `database.rs` 的实际引用。
3. **先处理恢复依赖再删数据库状态。** `recovery.rs` 的初始化、临时工作区、备份验证、归档和重启替换依赖 SQLite；若整个移除，需替换 `lib.rs` 中的初始化流程并保留设置错误处理，再清理 RecoveryGate、恢复页面、门面 / 绑定和诊断中的数据库字段。若产品仍需要恢复，按新存储重写这条链路。
4. 在确认无调用方后移除 `rusqlite`，保留其他服务仍使用的 `serde`、`tempfile` 等共享依赖。数据库通过自定义命令访问，没有一项可简单删除的“SQL 插件权限”。同步备份 / 草稿词典及数据库、恢复、诊断和 E2E 的相关断言，不跳过无关测试。
5. 执行绑定生成 / 检查、类型与 lint、前端 / Rust / 脚本测试、桌面与浏览器构建，验证首次启动、已有设置、工作区、诊断、窗口退出及移除页面的旧链接回落；已有数据库文件如何处置属于明确的数据迁移方案。

### 删除自动更新器

1. 移除 `/updates`、检查更新命令 / 菜单 / 首页 / 能力目录入口及 `DesktopEffects` 的更新订阅和 `useStartupUpdates`；清理 `updates-store.ts`、`autoCheckUpdates` 设置字段、门面更新函数 / DTO / 事件和对应词典、测试。
2. 从 `commands.rs` / `bindings.rs` 删除更新检查、快照、下载安装命令和显式 UpdateProgress 类型注册；从 `lib.rs` 移除 `UpdateManager` 状态、插件和 updater 模块，调整诊断与生命周期的安装更新分支。保留关闭 / 退出 / 重启和未保存工作协调。
3. 删除 Rust `tauri-plugin-updater` 及仅为更新验签使用的 `minisign-verify`、`update_signature.rs`、`verify-updater` binary 前先核对所有调用方。本项目没有前端 updater 插件依赖；不要删仍被系统能力使用的插件。清理 `tauri.conf.json` 的 updater 配置；品牌初始化 schema 若仍要求 `updates`，保留空端点 / 公钥，或同步修改其解析 / 测试，不能只删 JSON 字段。
4. 调整 `.github/workflows/release.yml`、`scripts/release-lib.mjs` 及相关测试：不再生成或上传更新元数据 / 签名，不调用更新验签 binary，移除 updater 专用 Secrets / 条件检查。Authenticode、macOS 签名公证、普通安装包归档和哈希清单仍是独立分发职责。
5. 重新生成绑定与锁文件，跑相关脚本 / Rust / 前端检查并构建目标安装包；验证托盘退出、重启、诊断与原有数据。确认 Release 不再承诺自动升级，提供手动下载安装路径。不要为“禁用更新”留下指向他人发布源的可执行入口。

其他模块遵循同样的引用检查；例如删除媒体图表后只有确认无引用才移除 Recharts，删除网络页还需核对媒体 WSS 使用的 CSP 端点。文件工作台的原生选择 / 文本保存同时服务备份导入导出，不能连同共享服务直接删除。

## 派生系统身份

`app.config.json` 初始化品牌和应用标识后，还需为深链 scheme、文件扩展名、MIME 与文件格式选择独立名称：修改 `tauri.conf.json` 的 deep-link / fileAssociations、`system_commands.rs` 参数解析、`workbench.rs` 类型识别，并同步界面示例、词典、测试和文档。发布后更改会影响已有系统登记与用户文件，需设计迁移或重新关联；只修改应用名不能避免抢占原模板的 `tdemo` / `.tdemo`。

正式签名、远程 OAuth / 服务端权限、生产数据恢复、平台安装关联和性能均按实际验收记录；此处的可操作演示与自动测试不替代这些证据。
