# Wasmtime 缓存依赖补丁

本目录是 `wasmtime-internal-cache 49.0.4` 的定向安全补丁，由宿主 [`Cargo.toml`](../../Cargo.toml) 的 `[patch.crates-io]` 引用。保留 Extism / Wasmtime 版本和缓存功能，仅将该 crate 的 `zstd` 依赖下限从 `0.13.0` 提升到 `0.14.3`，继续关闭其默认特性。

## 来源与完整性

- 来源：[crates.io 官方发布包](https://static.crates.io/crates/wasmtime-internal-cache/wasmtime-internal-cache-49.0.4.crate)，版本和校验值可由[官方 API](https://crates.io/api/v1/crates/wasmtime-internal-cache/49.0.4)复核。
- 原始 `.crate` 的 SHA-256：`96e4469e885ac50f8dc06337245f9905b22c68d55416267f9afd07f7f76687be`。
- 保留发布包的 `build.rs`、`src/`、`tests/`、`LICENSE` 和两份 Cargo 清单。`Cargo.toml.orig` 是未修改的上游工作区清单；实际构建使用已归一化的 `Cargo.toml`。
- 不保留原包的 `Cargo.lock` 和 `.cargo_vcs_info.json`；宿主统一使用 [`src-tauri/Cargo.lock`](../../Cargo.lock)。本文件是唯一新增的来源说明。
- 保留文件中，除 `Cargo.toml` 外均与原包逐字一致；不对上游源码批量格式化或修改注释。

`Cargo.toml` 顶部增加本地修改声明，其唯一依赖差异如下：

```diff
 [dependencies.zstd]
-version = "0.13.0"
+version = "0.14.3"
 default-features = false
```

复核来源时下载上述归档，先校验整个归档的 SHA-256，再解包到仓库外的临时目录，逐文件比较保留内容及这份差异；不要直接覆盖本目录或本机 Cargo registry 缓存。

## 影响与验证

上游 49.0.4 限定 `zstd 0.13`，不能通过兼容补丁更新取得修复版本；本补丁让锁文件解析到 `zstd 0.14.3` 和 `zstd-safe 8.2.0`。对应安全公告与其余仍需跟踪的告警见[安全规范](../../../docs/security.md#wasmtime-缓存依赖补丁)。

Extism 显式启用 Wasmtime 的缓存编译特性。应用的 `.with_cache_disabled()` 只关闭运行时磁盘缓存，不能从依赖图中移除压缩库；本补丁保留该运行时设置和应用自己的有界内存编译缓存。

本地来源增加约 130 KiB 的上游文本，不增加前端依赖；生产 Rust 源码、IPC、权限与缓存接口均未改变。压缩库跨兼容版本的编译和目标平台影响仍须验证，不能用依赖解析成功代替构建或运行测试。

从仓库根目录检查当前解析结果：

```sh
cargo tree --manifest-path src-tauri/Cargo.toml --locked -e features -i zstd-safe
cargo audit --file src-tauri/Cargo.lock
pnpm test:wasmtime-cache
```

`test:wasmtime-cache` 在独立临时源码副本中运行保留的上游单元和集成测试，验证压缩写入、解压读取及缓存更新；以宿主锁文件为解析起点，测试依赖只补入临时锁文件。宿主的 Rust 检查、真实 worker 验证和此命令的隔离范围见[测试规范](../../../docs/testing.md#rust-测试)。验证必须覆盖实际支持的目标平台，不能将某一平台通过写成三平台实测。

## 许可证与维护

沿用上游 [Apache-2.0 WITH LLVM-exception](./LICENSE)，保留原文。该许可证与仓库已有 [`wasmtime.LICENSE`](../../../resources/third-party/wasmtime.LICENSE) 完全一致，安装包和便携分发继续使用现有 Wasmtime 许可证资源。

此处只维护上述依赖差异。不要改写包名或版本来冒充已发布的修复，也不要添加 audit 忽略项。升级 Wasmtime 时重新审查补丁是否仍适用，不将旧源码套到新版本。

当 Extism 支持的正式 Wasmtime 版本已允许 `zstd >=0.14.3`、`zstd-safe >=8.2.0`，且对应构建、缓存单测、宿主扩展和 worker 验证通过时，删除宿主 `[patch.crates-io]` 条目及本目录，定向更新锁文件并重新审计。撤销时同步更新安全规范，保留其余依赖告警的处理状态。
