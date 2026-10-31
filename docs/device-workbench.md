# 虚拟会话与记录回放示例

当前示例提供内存虚拟会话、只读游标、发送仲裁与二进制记录回放，通过无头 CLI 使用同一套 Rust 模块。本文维护当前行为与操作；基础交付与可选方向见 [实施计划](./plans/device-workbench-foundation.md)，长期取舍见 [ADR 0024](./adr/0024-device-session-capture-boundaries.md)。

## 模块与责任

| 模块                               | 责任                                                      |
| ---------------------------------- | --------------------------------------------------------- |
| `src-tauri/src/device/model.rs`    | 会话 ID、连接事件、方向、二进制字节、偏移、缺口与共享校验 |
| `src-tauri/src/device/session.rs`  | 虚拟会话生命周期、连接代次、有界发送队列、显式推进及结算  |
| `src-tauri/src/device/stream.rs`   | 单份有限历史、独立只读游标、受限批次与淘汰缺口            |
| `src-tauri/src/capture/`           | 有界二进制记录、逐帧完整性、只读回放与显式前缀恢复        |
| `src-tauri/src/bin/device_tool.rs` | 无头组合虚拟会话、记录与回放，只访问显式文件参数          |

`device-tool` 同时调用设备和记录模块；记录模块仅依赖设备公共值类型，设备不反向依赖记录实现。设备模块不依赖文件、Tauri、React 或插件页面。当前仍与桌面应用在同一 Rust crate 中编译，不表示已经实现轻量独立运行时分发。没有新增自动后台线程、桌面 state、IPC、插件服务或 capability。

内部 API 供可信 Rust 调用方使用，句柄表示身份，不是用户授权。面向前端或插件开放服务时的边界见 [安全规范](./security.md#虚拟会话内部接口)。

## 会话、连接与显示

- `SessionId` 表示业务会话；每次连接的 token 绑定该会话与新的 epoch。断开／重连后拒绝旧 token 的发送、输入和推进；事件序号、Rx 与 Tx 字节偏移在会话内继续递增。
- 时间戳是会话开始后的主机观察单调微秒，不表示来源端的逐字节时间或跨来源同步保证。
- 读取者只有只读游标；销毁或重建读取者不关闭连接。关闭会话后可排空剩余历史，排空后才报告 EOF；未关闭的空批次不表示结束。
- 虚拟发送先入有限 FIFO 队列，由显式 `step_virtual` 推进为模拟 TX 和回显 RX。入队不表示发送完成，模拟完成仅表示事件已提交到会话历史。
- 断开／关闭／shutdown 不等待发送队列腾出位置，未执行 ticket 结算取消，重连不重发。最后一个引擎释放也会取消残留 ticket，但不生成关闭事件；需要关闭事件与 EOF 时应显式 shutdown。

## 有限历史与批次

历史同时限制项数和字节。落后的读取者先取得半开序号区间 `[from_sequence, to_sequence)` 的 `Gap`，再读取现存事件。Gap 只表示历史淘汰，不推断来源端的数据丢失数量。

批次项数包括 Gap，事件不拆分。下一事件超过整个字节预算时返回错误，游标不推进；只超出本批剩余额度时返回已读前缀，下次再读该事件。额度约束模块持有的历史、队列和单批数据，调用方须自行管理已返回批次；具体值见 [公共模型](../src-tauri/src/device/model.rs)、[会话限额](../src-tauri/src/device/session.rs) 与 [批次实现](../src-tauri/src/device/stream.rs)。

输入和状态转换先校验再提交，非法数据或计数溢出不产生半个 TX／RX，不推进历史。正常调用只持当前会话的短锁；不同会话不靠单一全局串行队列执行。shutdown 明确关闭并结算，之后不再创建会话。

## 记录格式与失败边界

一份文件对应一份会话，允许多个连接 epoch。v1 记录使用二进制头、长度前缀帧和原始字节，不将完整记录载入 JSON 或 base64。

- 头部包含 magic、版本、标志、会话、来源与起始序号；当前来源只有虚拟设备。
- 事件帧保存连接／字节或显式 Gap，逐帧 SHA-256 检查损坏。它不是发布者签名或来源认证。
- 完成尾帧绑定累计事件／字节／缺口统计与内容摘要；读取方重新累计核对，尾帧后必须 EOF。
- 帧／文件／事件预算同时约束读写，分配前检查长度和溢出；文件处理内存不随总日志线性增长。具体布局见 [记录格式实现](../src-tauri/src/capture/format.rs)，额度见 [记录模型](../src-tauri/src/capture/model.rs)。

记录开始于会话序号 1，已淘汰前缀用 Gap 表达。没有 Gap 时序号、已知连接状态及 Rx／Tx 偏移须连续合法；Gap 后允许未知状态和偏移向前跳，时间、代次与已知偏移仍不能回退。关闭后拒绝新事件；完整性校验不能证明缺口内的历史。

默认严格读取拒绝半帧、缺少完成尾帧、坏摘要、非法顺序及尾后垃圾。未来版本、未知必需标志／来源／帧类型明确拒绝，不当空文件或自动降级。

显式前缀恢复只读返回逐帧验证的部分，不修改原件或在 payload 内搜索 magic。`Incomplete` 报告实际 EOF 偏移，`Corrupt` 报告损坏帧或尾后垃圾起始偏移，`verified_offset()` 表示最后接纳的前缀边界。无法校验的头、未知格式与 I/O 失败仍报错。

无效输入在写入前拒绝，可修正后继续；写入 I/O 失败后写入器永久拒绝继续或完成。`finish` 只执行完成尾帧与 `Write::flush`，文件持有者还须明确处理 `sync_all` 与落盘结果。

回放没有真实连接 token、发送回调或 transport 依赖。历史 TX 只表示已记录的观察结果，不重新执行发送；完成记录不要求设备会话同时关闭。

## 无头工具

先从仓库根目录准备前端产物供当前 Rust crate 的 `generate_context!` 使用，再运行工具：

```powershell
pnpm build
pnpm device:tool --help
pnpm device:tool record-virtual --output "$env:TEMP/device-sample.dcap" --frames 16
pnpm device:tool replay --input "$env:TEMP/device-sample.dcap"
```

输出目录须已存在，文件名须未占用；工具不覆盖或追加既有文件，失败输出留在原处。文件路径来自显式参数，支持中文，不读取应用用户数据目录。输入须为普通文件，拒绝末级链接／Windows 重解析点；祖先路径由调用者控制，这不是同账户竞态沙箱。

`record-virtual` 每轮生成带 NUL／非 UTF-8 的固定二进制块，经虚拟接收、发送队列与回显后逐批写入；轮数通过 `--frames` 指定，可用参数见 `--help`。stdout 只给有限 JSON 摘要；完成尾帧、flush 和文件 `sync_all` 成功后才报告 `complete`／`synced`，`fileBytes` 为文件大小。失败保留可能未完成的前缀。

`replay` 默认严格校验，输出来源 `replay`、原始来源、会话、完成状态、统计与摘要；不将整份日志打印到终端。显式检查中断前缀：

```powershell
pnpm device:tool replay --input "$env:TEMP/interrupted.dcap" --recover-prefix
```

恢复模式的成功退出表示完成一次前缀检查，不表示原文件完整。必须同时读取 `complete`、`status`、`recoveredPrefix`、`failureOffset` 和 `verifiedOffset`；自动化不能只按退出码把前缀当完整记录。错误、未知格式和严格模式失败使用非零退出码。

## 验证与后续

按改动选择会话、记录或 CLI 集成检查，准备条件与命令见 [Rust 测试](./testing.md#rust-测试)。这些检查覆盖虚拟示例和文件链路；新增真实数据源或桌面入口时，再验证相应的授权、生命周期与目标平台行为。可选扩展的触发条件见 [实施计划](./plans/device-workbench-foundation.md#可选扩展方向)。
