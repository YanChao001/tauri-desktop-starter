# 仓库托管配置

本文维护项目自身的仓库链接、下载来源和平台接线入口。应用身份与初始化操作见 [开发指南](./development.md#项目初始化)，签名与交付见 [构建与发布](./build-release.md)。当前实现保留 GitHub，不自动识别平台，也未实现 GitLab / Gitee 发布适配器。

## 修改入口

| 配置                                                                          | 维护内容                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`app.config.json`](../app.config.json)                                       | 应用的 `repositoryUrl`、`docsUrl`、`homepageUrl`、更新端点 / 公钥，以及市场仓库身份 / 公钥                                                                  |
| [`repository.config.json`](../repository.config.json)                         | 源码与发行页链接模板、文档默认分支、发布来源分支、发布适配器 / API 地址、市场子模块地址、目录 / 包地址模板和下载目录前缀                                    |
| [`marketplace/repository.config.json`](../marketplace/repository.config.json) | 独立市场的托管链接、配套宿主仓库与默认 ref、跨仓库文档 ref 和壁纸 User-Agent 模板；详见其 [开发指南](../marketplace/docs/development.md#仓库来源与平台入口) |

`repository.generated.json` 保存上次同步的公开配置，用于识别旧链接；它是受版本管理的同步状态，不是第二份手改入口。市场维护自己的同名状态文件，签名目录身份仍以 `marketplace/listings.json.repository` 为准。

应用身份继续使用 JSON 补丁初始化，避免直接修改主配置后丢失旧品牌信息。更换主仓库会默认清空继承的更新和市场信任；同一产品迁移时，应在补丁中显式提供需要保留的端点和可信公钥。

```sh
pnpm init:project --config ../my-app.json --dry-run
pnpm init:project --config ../my-app.json
pnpm repository:sync
pnpm config:check
```

`repository:sync` 更新根目录及 `docs/` 中已知的本项目链接、`.gitmodules` 的市场地址、现有 GitHub CI / Pages / Dependabot 分支配置，并维护同步状态。市场已初始化时，同一命令继续调用市场自己的同步入口；未初始化时只处理宿主。只读的 `repository:check` 与 `config:check` 会检查漂移及可执行自有源码中再次出现的项目仓库 URL 字面量，已纳入 `verify` / CI。修改链接后重复同步应无变化。固定第三方来源、许可证和测试样本不会被全局替换。

同步使用原子替换和并发编辑检查；失败时按错误报告核对文件，不删除用户改动或签名产物。它不修改本地 `origin`、平台项目设置、Secrets、保护分支、必需检查、Pages 域名或签名门户。这些外部设置仍须随实际迁移配置。

## 模板与下载规则

`hosting.repositoryUrlTemplate` 使用 `{repository}`，将受控仓库身份映射为 HTTPS 源码地址。`hosting.links` 的 `file` / `commit` / `commits` / `compare` / `releases` / `release` / `releaseAsset` / `latestAsset` 定义各类链接。前端与 Node 共用 [模板函数](../src/config/repository-links.mjs)，不再由页面或发布脚本拼接平台路径。

链接模板使用 `{repositoryUrl}` 和相应的 `{ref}`、`{path}`、`{base}`、`{tag}`、`{asset}`。分支、标签、资产名作为单个片段编码，文件路径逐段编码；未知或缺失占位符拒绝。应用内文档入口 `docsUrl` 和产品主页 `homepageUrl` 是完整 URL，可以与源码托管站点不同，不从平台名称推导。

市场传输由同一份根配置编译进入 Rust：`catalogUrlTemplate` 定义目录位置，`packageUrlTemplate` 通过已签名条目的 tag / asset 构造包位置，`downloadUrlPrefixes` 同时约束初始请求与逐跳重定向。前缀必须是以 `/` 结尾的 HTTPS 目录，无凭据、查询参数或 fragment，仅允许默认 443 端口。按规范化 origin 与目录前缀匹配；任一前缀无效时整个策略拒绝。实际下载 URL 可保留 CDN 的签名查询参数。

这些配置是安装包内的受控来源，不接受前端传入任意 URL。更改传输位置不更改市场仓库 / 公钥身份、防降级记录、目录验签、包哈希或权限规则。当前市场仓库身份仍使用原有两段约束，其他平台身份与 API 要在具体迁移时实现。

## 平台适配边界

| 入口                                                              | 当前职责                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`scripts/hosting/`](../scripts/hosting/)                         | GitHub API 请求、PR / Release 元数据、草稿与附件处理、Actions 事件 / 输出 / 环境变量、签名 artifact 选择和最终公开        |
| [`scripts/release-lib.mjs`](../scripts/release-lib.mjs)           | 保留稳定的发布命令入口，按显式 `hosting.provider` 检查适配器；未知平台在远端操作前失败                                    |
| [`.github/`](../.github/) 与 [`.signpath/`](../.signpath/)        | GitHub Actions、Pages、Dependabot、模板和可选 SignPath connector 的平台文件；上游 action 地址及凭据键名属于这些集成的协议 |
| [`marketplace/scripts/hosting/`](../marketplace/scripts/hosting/) | 独立市场的 GitHub 发布操作与源码 tag 复核                                                                                 |

修改 URL 或页面路径时优先改配置；改变 Release / MR API、认证或 CI 产品时，在上述适配入口实现并验证。仅把 `provider` 改成另一个名字不会获得对应平台支持。GitHub 环境变量与工作流文件本身仍按其平台协议维护，移植时不在应用业务代码中增加兼容分支。

更新客户端已经支持配置 HTTPS 清单；发布端按配置模板检查当前仓库、tag 与资产名。源平台原生 Release JSON 不能直接替代 Tauri 更新清单。迁移时保留旧客户端可访问的更新入口与既有签名信任，必要时先发布过渡版本，流程见 [自动更新](./build-release.md#自动更新)。
