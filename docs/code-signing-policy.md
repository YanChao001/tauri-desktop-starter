# 代码签名策略（Code signing policy）

已申请 [SignPath Foundation](https://signpath.org/) 的开源签名服务，本次申请未获批准；当前未获得该基金会的免费签名资格。

## 状态

截至 2026-10-22，维护者反馈本次申请因项目知名度 / 可验证信誉不足未获批准。仓库保留可选 SignPath 集成，本页记录获批后拟启用的策略；后续资格变化与某次产物的签名状态，以服务配置、发布记录及实际签名验证为准，不从工作流存在推断签名已启用。

仓库默认不提供签名凭据。其他 Windows 签名方式及其配置边界见 [构建与发布](./build-release.md#代码签名)。

启用前按 [SignPath Foundation 条款](https://signpath.org/terms) 在仓库首页和下载 / Release 页面提供名为 “Code signing policy” 的入口，并在本页注明实际服务提供方：“Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/)”。这是启用前的署名要求，不表示当前已获得服务。

## 签名范围

- Windows x64 的 **NSIS 安装包**：`Tauri Desktop Starter_<version>_x64-setup.exe`；
- 当前配置只签 NSIS 安装包外层，安装后的应用二进制与 MSI 不在此签名范围；需要嵌套签名时须一并修改 artifact 配置、工作流产物收集和验证；
- WebView2、Rust / npm 依赖等第三方组件不使用本项目的签名额度。

## 角色与审批

单维护者项目，三种角色均由仓库所有者担任：

- 作者 / 提交者：[YanChao001](https://github.com/YanChao001)
- 评审：外部 PR 必须由 [YanChao001](https://github.com/YanChao001) 评审后合并
- 签名审批：[YanChao001](https://github.com/YanChao001)，每次签名请求在 SignPath 门户人工批准

签名服务启用前，维护者必须确认 SignPath 与 GitHub 账号均启用 MFA；账号设置不由本地仓库配置。

## 构建与签名流程

1. 在已合入 `main` 的发布提交打 tag（`v<version>`），触发 [`.github/workflows/release.yml`](../.github/workflows/release.yml)；手动触发的 ref 与版本要求见 [CI 多平台构建](./build-release.md#ci-多平台构建)；
2. GitHub Actions 在 `windows-latest` 上从选定 ref 的源码构建，产物进入 **draft Release**；
3. 构建任务直接上传未签名安装包 artifact；配置 SignPath 后，`sign-windows` job 使用本次运行的 artifact ID 提交签名请求并等待人工批准；
4. 用 `Get-AuthenticodeSignature` 校验签名有效后，重新生成签名文件清单并上传 `signed-installers-x86_64-pc-windows-msvc`；再次核对目标 tag 与 draft 状态后覆盖 draft 的未签名资产，已公开 Release 拒绝覆盖；
5. 人工确认 draft 内容后发布。

启用服务时须配置 SignPath 的 GitHub connector，校验仓库、工作流和 commit 的构建来源。签名请求只接受本仓库 GitHub Actions 的产物，不接受本地构建；门户配置由维护者核对，不由本地工作流文件自动完成。

build job 的 `build-installers-<target>` 是 SignPath 处理前的归档；最终 SignPath 签名文件以签名 job 的归档和更新后的 Release 为准。

## 元数据约束

`.signpath/artifact-configuration.xml` 强制安装包满足：

- `ProductName = Tauri Desktop Starter`
- `ProductVersion` 与 `FileVersion` 等于本次 tag 的版本号

版本号不一致时 SignPath 拒绝签名，避免签错包。

## 隐私

应用没有遥测，日志只写本地系统日志目录，位置见 [排障手册](./troubleshooting.md#先看日志)。诊断信息由用户主动复制，外链由用户触发后交给系统浏览器。

更新功能使用本项目独立生成的更新密钥，与 SignPath 的 Windows 发布者签名分别配置。默认启用启动检查，主窗口就绪后访问 GitHub Releases 更新端点；用户可在更新页关闭该偏好，下载和安装始终由用户确认。公钥未配置或受控部署显式禁用时不请求网络。配置与验签策略见 [自动更新](./build-release.md#自动更新)，服务的数据处理见 [GitHub 隐私声明](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)。WebView2 运行时由 Microsoft 提供，其数据处理见 [Microsoft 隐私声明](https://privacy.microsoft.com/privacystatement)。

## 变更

本策略随仓库一起评审；签名范围或流程变化时，在同一 PR 中更新本页。
