# 代码签名策略（Code signing policy）

本文公开 Windows SignPath 签名的资格、范围、审批和隐私约定。接入命令与其他签名方式见 [构建与发布](./build-release.md#代码签名)。

## 状态

截至 2026-10-22，维护者反馈本次 [SignPath Foundation](https://signpath.org/) 申请因项目知名度 / 可验证信誉不足未获批准，当前未获得其免费签名资格。仓库保留可选集成，下述 SignPath 策略仅在获批并配置后启用；后续资格与具体产物状态以服务配置、发布记录和实际验签为准，不能从 workflow 存在推断已签名。

仓库不提供签名凭据。启用前按 [服务条款](https://signpath.org/terms) 在首页和下载 / Release 页面公开名为 “Code signing policy” 的入口，并注明实际服务提供方：“Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/)”。此为启用条件，不表示当前已获得服务。

## 签名范围

- Windows x64 NSIS 安装包：`<产品名>_<version>_x64-setup.exe`，产品名来自 [`app.config.json`](../app.config.json)。
- 仅签安装包外层，安装后的 exe、MSI 及第三方组件不在此额度与配置范围。新增嵌套签名须同步 artifact 配置、收集和验证。
- 当前 SignPath 后签不能与更新签名组合，限制与签名顺序见 [更新服务端与签名顺序](./build-release.md#更新服务端与签名顺序)。

## 角色与审批

单维护者项目的作者、评审和签名审批均由仓库所有者 [YanChao001](https://github.com/YanChao001) 担任。外部 PR 经其评审后合并；每次签名请求在 SignPath 门户人工批准。

启用前维护者确认 SignPath 与 GitHub 账号均启用 MFA，门户来源约束和账号设置不由本地仓库自动完成。

## 构建与签名流程

发布触发、任务顺序、归档和失败恢复统一见 [CI 多平台构建](./build-release.md#ci-多平台构建)。SignPath 通过 GitHub connector 约束本仓库、工作流与 commit，仅接受本次 Actions 构建的 artifact ID；本地包不进入该签名流程。

`sign-windows` 等待门户人工审批，验证签名后重建清单，仅替换同 tag 的 draft 资产。最终文件以签名 job 归档和完成签名后的 Release 为准；自动公开不替代门户审批，目标平台安装 / 升级的实测范围随发布说明记录。

## 元数据约束

[artifact-configuration.xml](../.signpath/artifact-configuration.xml) 要求 `ProductName` 匹配品牌名称，`ProductVersion` 和 `FileVersion` 匹配本次 tag 版本；初始化同步名称，签名请求传入版本参数。不匹配时拒签，避免签错包。

## 隐私

应用没有遥测上传，日志只写本地；诊断由用户主动复制，反馈前复核脱敏，见 [日志](./security.md#日志)。外链交给系统浏览器；网络演示、市场和获授权插件访问对应来源，LAN 为明文服务，范围见 [安全规范](./security.md#能力最小化) 与 [扩展指南](./extensions.md#网络凭据与私有数据)。

更新使用独立密钥，与 Windows 发布者签名分别配置。默认启用启动检查，由主窗口就绪后请求 GitHub Releases；可在设置关闭，端点 / 公钥缺失或受控部署禁用时不联网，下载 / 安装须用户确认，详见 [自动更新](./build-release.md#自动更新)。服务数据处理见 [GitHub 隐私声明](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)；WebView2 由 Microsoft 提供，见 [Microsoft 隐私声明](https://privacy.microsoft.com/privacystatement)。

## 变更

本策略与仓库一起评审；签名资格、范围、服务提供方或流程变化时，在同一 PR 更新。
