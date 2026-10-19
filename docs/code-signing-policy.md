# Code signing policy

拟申请 [SignPath Foundation](https://signpath.org/) 的开源签名服务；申请状态与签名结果以实际发布记录为准。

## 状态

Windows 产物目前**尚未签名**。本页是提交 SignPath Foundation 申请所需的签名策略，
申请通过后按此执行；在拿到证书之前，不对外声称产物已签名。

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

1. 打 tag（`v<version>`）触发 [`.github/workflows/release.yml`](../.github/workflows/release.yml)；
2. GitHub Actions 在 `windows-latest` 上从该 tag 的源码构建，产物进入 **draft Release**；
3. 构建任务直接上传未签名安装包 artifact；配置 SignPath 后，`sign-windows` job 使用本次运行的 artifact ID 提交签名请求并等待人工批准；
4. 用 `Get-AuthenticodeSignature` 校验签名有效后，以签名文件覆盖 draft 中的未签名资产；
5. 人工确认 draft 内容后发布。

二进制与源码的对应关系由 SignPath 的 GitHub connector 校验（仓库、工作流、commit）：
签名请求只能来自本仓库的 GitHub Actions，本地构建的安装包不接受。

## 元数据约束

`.signpath/artifact-configuration.xml` 强制安装包满足：

- `ProductName = Tauri Desktop Starter`
- `ProductVersion` 与 `FileVersion` 等于本次 tag 的版本号

版本号不一致时 SignPath 拒绝签名，避免签错包。

## 隐私

本程序不会向其他联网系统传输信息，除非用户明确要求（当前版本没有遥测，也没有启用自动更新）。
应用日志只写本地系统日志目录，位置见 [排障手册](./troubleshooting.md#先看日志)。外链由用户触发后交给系统浏览器；应用未接入遥测或自动更新。WebView2 运行时由 Microsoft 提供，其数据处理由 Microsoft 的隐私声明说明。

## 变更

本策略随仓库一起评审；签名范围或流程变化时，在同一 PR 中更新本页。
