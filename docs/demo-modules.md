# 模块体验、扩展与裁剪

本文用于体验现有模块、跟做新增页面到原生命令的完整链路，并为派生项目移除不需要的能力。运行结构见 [架构说明](./architecture.md)，安全边界见 [安全规范](./security.md)，验证分层见 [测试规范](./testing.md)。

## 演示目标与验收边界

默认保留完整、可操作的功能样本。新增演示围绕实际工作流补齐成功与失败反馈，复用已有服务和控件，并说明数据属于页面样本、原生存储还是外部服务。按 [改动范围](./testing.md#日常验证范围) 选择验证层；浏览器交互、原生 IPC 和安装后的系统集成各自提供不同证据。

## 体验现有模块

设置中的 `minimal` 和初始化的 `--minimal` 只隐藏 `demoOnly` 页面的侧栏及页面导航命令入口，路由仍可直接打开，能力目录仍列出全部非隐藏模块。它们不删除源码、依赖、IPC、插件或权限，也不缩小安装包；真实移除见 [裁剪步骤](#实际裁剪模块)。

从首页或能力目录选择交互创作、文件到笔记、后台任务、数据可靠性或扩展路线，可按跨页步骤体验。导览提供可下载 CSV / 文本样例，不代替实际操作或标记成功；浏览器中的原生页面提供对应流程说明，真实结果需在桌面应用查看。

| 用户工作流                                                                       | 入口与源码                                                          | 数据与验证边界                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 预览、应用和撤销风格；拖动弹簧球、切换卡片布局、翻转倾斜卡和调整轨道             | `/`、`/components?stage=motion`；`showcase/`、`motion-lab/`         | 局部预览不写设置，应用后可撤销；减少动效、离屏与文档隐藏时降级或暂停                                    |
| 体验表单、反馈与收藏，检查只读 / 禁用 / 校验 / 部分选择及错误重试                | `/components`；`components/showcase/`                               | 页面内演示，无邮件投递或原生持久化；同页切换保留输入                                                    |
| 浏览资源树、右键重命名 / 复制 / 删除、撤销、拖放排序和跨目录移动、调整分栏       | `/components` 工作区；`workspace-studio.tsx`                        | 页面内样本，搜索多选过滤类型；支持键盘树导航、菜单与排序，不读写磁盘                                    |
| 搜索能力，打开页面、源码与文档                                                   | `/catalog`；`features/catalog/`                                     | 按本地、原生、外部服务区分；源码链接不是额外下载或执行入口                                              |
| 审阅 Wasm 包、按需授权、体验页面 / 窗口、存储、结果保存与会话导入                | `/extensions`；`features/extensions/`、`extension_runtime.rs`       | 真实 Extism、声明网络、私有 KV 与系统凭据；包与原生宿主须兼容，见 [扩展指南](./extensions.md)           |
| 在插件中组织画布节点、筛选数据图表、运行流程模拟并导出成果                       | 本地工作台；`examples/extensions/apps/`                             | 三场景本地即时交互、检查点恢复，Wasm 校验导出；流程模拟不代表后台任务                                   |
| 创建笔记，另开窗口制造版本冲突，回收 / 恢复，再导出和恢复备份                    | `/database`；`database.rs`、`data_commands.rs`                      | 真实 SQLite、按窗口持久草稿、全量逻辑 JSON；恢复前留安全备份                                            |
| 打开 / 拖入文本与图片，编辑后由外部程序改磁盘，再处理冲突                        | `/workbench`；`components/workbench/`、`workbench.rs`               | 原生授权、原子保存、草稿保留；文本可导入 SQLite 笔记副本，原文件与脏稿保留；图片只读，另存取消不丢编辑  |
| 选目录，提交扫描与 SHA-256，离页后查看，取消 / 重试 / 导出                       | `/tasks`；`workbench.rs`                                            | Rust 实际任务、2 执行 + 10 排队、合作取消；重启中断需重新运行                                           |
| 发送通知、读写剪贴板、登记冲突快捷键、恢复独立窗口                               | `/system`；`system_commands.rs`、`use-workspace.ts`                 | 实际系统能力，权限与 OS 服务可能拒绝；关联 / 深链需安装版验收                                           |
| 用本地 fixture 操作 GET / POST、缓存、超时、取消和离线，再切 HTTPS               | `/network`；`features/network/`                                     | fixture 明确为本地；真实端点受白名单限制；会话非 OAuth，凭据项独立存系统服务                            |
| 筛选万条记录、分页 / 虚拟滚动、调列宽 / 显隐列、详情与批量部分失败；切换条件表单 | `/data-studio`；`features/data-studio/`                             | 本地生成数据与故障示例，不写 SQLite，不代表服务端事务                                                   |
| 按内容 / 图表 / 连接标签体验 Markdown、媒体预览、图表、WSS 回显与固定 worker     | `/media`；`features/media/`                                         | 同页切换保留状态，离页释放资源；不执行 Markdown HTML，附件不上传，外部连接主动开启                      |
| 在隔离测试目录制造启动存储错误，预览备份并安排重启恢复                           | `/diagnostics?section=recovery`；`recovery.rs`、`recovery-gate.tsx` | 原件归档、临时工作区与恢复日志；未来版本拒绝降级覆盖，不在真实用户目录演练；旧 `/recovery` 路径保留兼容 |

窗口尺寸、登录启动、后台运行与多窗口统一位于设置中的“窗口与运行”，可通过 `/settings?section=desktop` 定位；应用更新位于设置中直接可见的“应用更新”，通过 `/settings?section=updates` 定位。旧 `/desktop` 与 `/updates` 链接兼容跳转并保留其他查询参数，有效的单项 `focus` 定位优先于区块定位，不再提供独立导航。交互控件和动效统一在“交互体验”中按标签切换；`/motion` 转到 `/components?stage=motion` 并保留导览等查询参数。功能导览从首页进入，简单的通信示例从导览页折叠的“开发者资料”打开，`/catalog`、`/bridge` 仍可直接访问；三者不再单独占用侧栏和页面导航命令。诊断位于 `/diagnostics`；应用内功能导览默认介绍用途与使用条件，各页源码、对应文档和新增页面教程统一收在页底默认折叠的“开发者资料”中。浏览器中的原生入口说明环境限制，不伪造 IPC 成功。

## 数据工作流与冲突比较

数据工作室打开“导入、校验与导出”，载入带错误样例或选择 UTF-8 CSV：最多 2 MiB、10000 行、32 列，支持带引号的逗号 / 换行和 BOM，拒绝重复或空表头。预览前 20 行并映射字段；名称与邮箱必选，团队、状态和预算未映射时使用说明中的默认值。逐行检查名称、邮箱、枚举、金额和列数，定位错误记录；报告最多预览 50 项，可导出全部错误的行号、字段及前 80 字符原值。

有错误时必须勾选“仅导入有效行”才可应用；导入只替换页面临时记录，不修改源文件或 SQLite。未导出的数据再次被替换前需要确认。CSV / JSON 完整导出包含全部记录，筛选 CSV 只包含当前筛选排序后的记录；隐藏列不改变导出字段。CSV 对可能被电子表格解释为公式的文本加单引号，导出是安全交换视图，重新导入该字段时会保留此前缀。取消原生保存或只导出筛选结果不会清除完整数据的未保存标记。

在工作台或笔记页制造外部版本冲突后，可以逐块比较本地与远端正文；笔记还可独立选择标题。默认保留本地，点击应用只更新编辑器，保存仍校验已审阅版本；远端再次改变会再次冲突。长文本预览截断，实际合并保留完整内容。需要复现时从文件路线下载两份文本到专用测试目录；下载不自动覆盖文件，用户主动将修改版本写到同一测试文件后再返回保存。

命令面板在桌面输入至少 2 字，还会搜索本地笔记标题 / 正文和已授权最近文件名，每类最多 8 项；打开结果复用现有加载与脏编辑确认，不扫描整个磁盘。扩展的文本提交、视图初始化、会话导入与结果保存，以及网络 / 私有数据授权，统一按 [扩展指南](./extensions.md#安装与体验) 体验。

## 依赖与加载

依赖及精确版本直接查阅 [package.json](../package.json)、[Cargo.toml](../src-tauri/Cargo.toml) 和对应锁文件；新增或移除依赖按 [评审标准](./development.md#新增依赖的评审标准) 核对调用方、许可和平台影响。

页面懒加载和导航预载统一维护于 [routes.tsx](../src/routes.tsx)。表格 / 表单、Query、Markdown 和图表随页面加载，门面中的 JS 插件按调用动态导入；Rust 插件仍在启动时组装，前端懒加载不会减少原生编译或安装包体积。WSS 使用标准 WebSocket，边界由门面与 CSP 定义。

需要区分三种插件优化：导航悬停只预载前端模块；[界面保留](./extensions.md#自定义界面) 复用最近使用的文档与草稿；[原生预编译](./extensions.md#执行存储与生命周期) 只准备 Wasm 代码，不执行初始化。工作台场景编辑留在界面，成果导出才运行 Wasm，数据格式见 [工作台说明](../examples/extensions/apps/README.md)。

文件工作台按需加载预览与差异合并；TypeScript 的 lowlight / highlight.js 仅在 `CodeBlock` 展示该语言时加载，等待或失败时保留原文。语法树转换为 React 文本 token，许可随 [前端资源](../public/licenses/code-highlighting.txt) 分发。

比较体积时使用同一配置的 `pnpm build` / `pnpm build:web`，区分入口、路由块、共享块和原始 / gzip 大小；首屏下载、常驻内存和启动耗时分别测量，方法见 [安装版与启动验收](./testing.md#安装版与启动验收)。

## 新增页面到 IPC 与测试

下面以“统计本地文本”作完整最小示例，文件名和键名均为待新增内容。它不需要新插件或权限；先在未修改前端时运行 `pnpm build` 准备原生编译需要的 `dist/`，然后先完成 Rust 与绑定，再接前端，避免尚未生成 DTO 的类型错误。

### 1. 服务、DTO 与边界测试

新增 `src-tauri/src/text_summary.rs`。输入上限按 UTF-8 字节计算，字符数按 Unicode scalar value 计算，行数沿用 Rust `lines()`，不是字节数或屏幕行数。

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

新增 `src-tauri/src/text_summary_commands.rs`：

```rust
use crate::{error::NativeResult, text_summary::{self, TextSummary}};

#[tauri::command]
#[specta::specta]
pub fn summarize_text(text: String) -> NativeResult<TextSummary> {
    text_summary::summarize(&text)
}
```

这是有界的纯计算；若改成文件、数据库或系统调用，使用 `blocking::run` / 异步 API，不能只加 `async` 后继续阻塞。涉及状态时在服务中定义归属、并发和持久化，不放进 `lib.rs`。

### 2. 注册、生成与门面

在 `lib.rs` 添加 `mod text_summary; mod text_summary_commands;`；在 `bindings.rs` 的 `collect_commands!` 添加 `crate::text_summary_commands::summarize_text`。DTO 已被命令返回类型引用，无需再手写一份 TypeScript。

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

新增 `src/pages/text-summary.tsx`，默认导出页面组件，通过 `@/lib/tauri` 调用 `summarizeText`。复用 `NativePage`、`Button`、`Textarea`、`nativeErrorText` 和 toast；中英词典加入标题、输入、运行与结果文案。页面在调用期间防止重复提交，失败保留输入，异步回执只更新仍挂载的页面。可参考 [通信页](../src/pages/bridge.tsx) 和相邻测试。

在 [routes.tsx](../src/routes.tsx) 的 `APP_ROUTES` 添加入口，复用 `lazyPage` 与图标：

```tsx
{
  path: "/text-summary",
  labelKey: "textSummary.title",
  group: "capabilities",
  icon: TerminalIcon,
  ...lazyPage(() => import("@/pages/text-summary")),
  demoOnly: true,
},
```

导航与页面命令由注册表产生。在 [能力目录](../src/features/catalog/model.ts) 补用途、源码与文档链接，在 [原生页面预览](../src/components/native-page.tsx) 的 `PREVIEWS` 补浏览器说明。需要从原生激活此页时，再补 `system_commands::allowed_route`；动作快捷键通过 `useRegisterCommands` 复用页面动作。

### 4. 页面失败回归与验证

为此示例新增 `src/pages/text-summary.test.tsx`，mock `@/lib/tauri`，验证原生失败后输入仍在且用户能再次操作；Rust 测试负责 Unicode 统计及输入字节上限。这样分别覆盖业务边界与页面恢复，不在组件测试重写原生规则。

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo test --manifest-path src-tauri/Cargo.toml --locked text_summary::tests --lib
pnpm test src/pages/text-summary.test.tsx
pnpm bindings:check
pnpm typecheck
pnpm lint
```

随后按 [日常验证范围](./testing.md#日常验证范围) 检查受影响的浏览器界面或实际 IPC。路由、Provider、权限和窗口生命周期的改动才扩大相应检查；前台原生操作遵循 [桌面干扰边界](./testing.md#避免干扰本机桌面)。

## 实际裁剪模块

在功能分支中先搜索调用方与共享服务；已有用户数据受影响时明确导出或迁移方式，保留用户目录。按调用链清理：路由 / 菜单 / 命令与能力目录 → 门面 / DTO / 事件 → Rust 注册 / 状态 / 服务 → 依赖 → capability / CSP / 系统关联 → 词典 / 文档 / 相关测试与 CI。IPC 改动后重新生成绑定，依赖改动后更新现有锁文件；两者各自检查。

### 删除 SQLite 笔记

1. 从 `routes.tsx` 移除 `/database`，清理首页 / 导览 / 命令 / 能力目录、系统页的笔记窗口入口，以及 `system_commands.rs` 的固定导航和工作区白名单。移除内容搜索的笔记查询和文件工作台的“导入笔记”调用方；旧工作区和链接应回落到有效页面。
2. 删除页面和笔记草稿状态 / 未保存工作注册；从 `tauri.ts`、`bindings.rs` 清理旧 CRUD、分页、批量、草稿与备份命令、Note DTO；移除 `data_commands.rs` 和 `database.rs` 的实际引用。
3. **先处理恢复依赖再删数据库状态。** `recovery.rs` 的初始化、临时工作区、备份验证、归档和重启替换依赖 SQLite；若整个移除，需替换 `lib.rs` 中的初始化流程并保留设置错误处理，再清理 RecoveryGate、恢复页面、门面 / 绑定和诊断中的数据库字段。若产品仍需要恢复，按新存储重写这条链路。
4. 在确认无调用方后移除 `rusqlite`，保留其他服务仍使用的 `serde`、`tempfile` 等共享依赖。数据库通过自定义命令访问，没有一项可简单删除的“SQL 插件权限”。同步备份 / 草稿词典及数据库、恢复、诊断和 E2E 的相关断言，不跳过无关测试。
5. 按实际删除范围检查绑定、相关前端 / Rust 测试与构建，重点验证首次启动、已有设置、工作区、诊断及旧链接回落；若调整恢复或退出链路，再验证对应原生流程。已有数据库文件的处置按数据迁移方案执行。

### 删除自动更新器

1. 移除设置页的 `UpdateSettings` 卡片、设置搜索索引、`/updates` 兼容别名、检查更新命令 / 菜单及 `DesktopEffects` 的更新订阅和 `useStartupUpdates`；清理 `updates-store.ts`、`autoCheckUpdates` 设置字段、门面更新函数 / DTO / 事件和对应词典、测试。
2. 从 `commands.rs` / `bindings.rs` 删除更新检查、快照、下载安装命令和显式 UpdateProgress 类型注册；从 `lib.rs` 移除 `UpdateManager` 状态、插件和 updater 模块，调整诊断与生命周期的安装更新分支。保留关闭 / 退出 / 重启和未保存工作协调。
3. 删除 Rust `tauri-plugin-updater` 及仅为更新验签使用的 `minisign-verify`、`update_signature.rs`、`verify-updater` binary 前先核对所有调用方。本项目没有前端 updater 插件依赖；不要删仍被系统能力使用的插件。清理 `tauri.conf.json` 的 updater 配置；品牌初始化 schema 若仍要求 `updates`，保留空端点 / 公钥，或同步修改其解析 / 测试，不能只删 JSON 字段。
4. 调整 `.github/workflows/release.yml`、`scripts/release-lib.mjs` 及相关测试：不再生成或上传更新元数据 / 签名，不调用更新验签 binary，移除 updater 专用 Secrets / 条件检查。Authenticode、macOS 签名公证、普通安装包归档和哈希清单仍是独立分发职责。
5. 重新生成绑定与锁文件，跑相关脚本 / Rust / 前端检查并构建目标安装包；验证托盘退出、重启、诊断与原有数据。确认 Release 不再承诺自动升级，提供手动下载安装路径。不要为“禁用更新”留下指向他人发布源的可执行入口。

其他模块遵循同样的引用检查；例如删除媒体图表后只有确认无引用才移除 Recharts，删除网络页还需核对媒体 WSS 使用的 CSP 端点。文件工作台的原生选择 / 文本保存同时服务备份导入导出，不能连同共享服务直接删除。

## 派生系统身份

`app.config.json` 的 `integration` 统一管理深链协议与应用专属扩展名，初始化脚本同步安装注册和 MIME，原生解析、文件工作台及界面示例直接消费配置，见 [项目初始化](./development.md#项目初始化)。专属文件仍使用 UTF-8 JSON；更改文件内容格式时同步工作台校验与回归。发布后更改协议或扩展名会影响已有系统登记与用户文件，需设计迁移或重新关联。

派生项目的签名、外部服务、生产数据恢复和平台安装关联按产品范围验收，记录实际结果。
