export const zhExtensions = {
  "ext.error.networkBlocked":
    "请求目标解析到了受保护的网络地址。请检查宿主网络设置及代理授权。",
  "ext.error.imageRedirect": "图源返回了跳转地址，请重试或切换图源。",
  "ext.error.imageSourceRejected":
    "图源暂时拒绝了图片请求，请稍后重试或切换图源。",
  "ext.error.imageInvalid": "图片格式不受支持或内容损坏，请换一张图片。",
  "ext.error.imageTooLarge": "图片超出大小或解码额度，请换一张图片。",
  "ext.error.attachmentTooLarge": "附件超过允许的大小，请选择较小的文件。",
  "ext.error.attachmentCacheFull":
    "本机附件缓存已满，请清理不需要的聊天记录后重试。",
  "ext.error.transferInterrupted":
    "附件传输中断或完整性校验失败，请检查连接后重试。",
  "ext.prepareFailedDescription":
    "插件预编译未完成。你仍可打开插件，届时会按需编译。",
  "ext.uiUnavailable": "扩展界面暂时无法打开，会话内容已保留。",
  "ext.recovery.title": "扩展存档恢复",
  "ext.checkBundledUpdate": "检查内置更新",
  "ext.bundledCurrent": "内置工作台已是当前版本。",
  "ext.bundledNewerInstalled": "本机工作台比内置版本更新，已保留本机安装包。",
  "ext.bundledDifferent":
    "本机工作台与内置包版本相同但内容不同，已保留本机安装包。替换需要使用更高的包版本。",
  "ext.recovery.checking": "正在检查扩展存档…",
  "ext.recovery.checkHint":
    "重建扩展前，先确认是否为可识别的开发期旧存档。检查不会修改数据。",
  "ext.recovery.checkAgain": "重新检查存档",
  "ext.recovery.legacy":
    "检测到 {count} 条旧版扩展安装记录。可先完整归档，再初始化当前内置扩展。",
  "ext.recovery.current":
    "当前存档已使用受支持的版本。请刷新扩展列表并检查具体扩展包，无需归档。",
  "ext.recovery.future":
    "此存档由更高版本创建，请使用支持它的应用版本。原存档会保留。",
  "ext.recovery.invalid":
    "无法安全识别此存档，请保留原目录以便诊断和恢复，暂不提供自动归档。",
  "ext.recovery.unavailable":
    "启动恢复、更新安装或退出期间不能修改扩展存档。完成当前操作后可重新检查。",
  "ext.recovery.archive": "归档旧扩展并重建",
  "ext.recovery.confirmTitle": "归档旧版扩展安装？",
  "ext.recovery.confirmHint":
    "将旧扩展目录完整移到归档位置，再重新加载当前内置扩展，默认保持禁用。应用设置、笔记和插件私有数据会保留。旧扩展会话仍需使用原包版本恢复。完成后会显示归档位置。",
  "ext.recovery.confirm": "确认归档并重建",
  "ext.recovery.archiving": "正在归档…",
  "ext.recovery.archived": "旧扩展目录已完整归档。",
  "ext.recovery.archiveLocation": "归档位置：",
  "ext.recovery.afterArchive":
    "扩展列表会单独重新加载。若仍有错误，请保留此归档并重试刷新；新的内置扩展默认禁用，请重新审阅并授权后启用。",
  "ext.market.discover": "发现插件",
  "ext.market.title": "官方插件市场",
  "ext.market.hint":
    "浏览维护者审核上架的插件。下载后审阅详情与权限，确认后一次完成授权、安装和启用。",
  "ext.market.repository": "市场仓库与源码",
  "ext.market.refresh": "刷新市场",
  "ext.market.loading": "正在读取签名市场目录…",
  "ext.market.stale":
    "市场暂时无法刷新，当前显示上次验证的目录。下载前会重新确认版本仍在上架。",
  "ext.market.search": "搜索插件",
  "ext.market.searchHint": "名称、简介、作者或 ID",
  "ext.market.category": "分类",
  "ext.market.category.all": "全部分类",
  "ext.market.category.text": "文本处理",
  "ext.market.category.data": "数据处理",
  "ext.market.category.tools": "实用工具",
  "ext.market.category.games": "游戏",
  "ext.market.featured": "推荐",
  "ext.market.currentVersion": "本机版本：{version}",
  "ext.market.installHint": "下载后审阅并安装",
  "ext.market.download": "下载并审阅",
  "ext.market.hostRequired": "需要应用 {version} 或更高版本",
  "ext.market.preparing": "正在准备下载…",
  "ext.market.downloadProgress": "正在下载 {percent}%",
  "ext.market.verifying": "正在校验…",
  "ext.market.installing": "正在安装…",
  "ext.market.update": "下载更新",
  "ext.market.updateTo": "更新至 {version}",
  "ext.market.installed": "已安装此版本",
  "ext.market.newerInstalled": "本机版本较新",
  "ext.market.noMatches": "没有符合搜索条件的插件。",
  "ext.market.empty": "市场暂未上架插件。",
  "ext.market.revision": "已验证市场目录 · 修订 {revision}",
  "ext.market.notConfigured": "此应用尚未配置官方市场，请使用本地扩展包导入。",
  "ext.market.unavailable":
    "暂时无法连接插件市场，请检查网络后刷新。已安装扩展仍可使用。",
  "ext.market.invalid": "市场目录或扩展包校验失败，未安装或修改任何扩展。",
  "ext.market.incompatible":
    "已验签的市场目录协议与当前应用不兼容。需要市场维护者发布匹配的目录，或使用支持该目录的应用版本。已安装扩展和本地扩展包导入仍可使用。",
  "ext.market.expired":
    "已验签的市场目录已过期。需要市场维护者续签并发布更高修订号的目录，再刷新市场。已安装扩展和本地扩展包导入仍可使用。",
  "ext.market.changed": "该市场版本已变更或下架，请刷新目录后重新选择。",
  "ext.fieldInvalid": "请先修正此字段的值，再运行扩展。",
  "ext.fieldLimit":
    "每个字段最多输入 {bytes} 个 UTF-8 字节，请缩短内容后再执行。",
  "nav.extensions": "扩展中心",
  "catalog.extensions":
    "添加常用工具与应用，按需要管理每个插件可以访问的数据和功能。",
  "ext.title": "扩展中心",
  "ext.description": "安装和管理扩展，打开你常用的工具与应用。",
  "ext.dataBoundary": "权限与数据说明",
  "ext.installed": "已安装扩展",
  "ext.open": "打开",
  "ext.openNamed": "打开 {name}",
  "ext.details": "关于与权限",
  "ext.actionsFor": "{name}的更多操作",
  "ext.otherFeatures": "其他功能",
  "ext.permissionNeeded": "需要授权",
  "ext.advancedSettings": "高级设置",
  "ext.advancedSettingsFor": "{name} · 高级设置",
  "ext.advancedSettingsHint":
    "需要时再调整此扩展保存的本机数据或网络服务连接。",
  "ext.technicalInfo": "技术信息",
  "ext.identifier": "扩展标识",
  "ext.technicalCommands": "功能调用格式",
  "ext.features": "提供的功能",
  "ext.appSessionHint":
    "同一窗口切换导航会保留进度；导出会话后，可在相同包版本中导入恢复。插件私有存储在重启后保留；结束会话仅清空本次输入、进度和结果。",
  "ext.noPermissions": "没有必需权限，可自行决定是否允许可选项目。",
  "ext.appLoad": "加载应用",
  "ext.appWorking": "正在处理…",
  "ext.appStatus": "运行状态",
  "ext.appExport": "导出会话",
  "ext.appClose": "结束会话",
  "ext.sessionTools": "扩展工具",
  "ext.tools.interface": "窗口与界面",
  "ext.tools.help": "关于{name}",
  "ext.tools.session": "会话文件",
  "ext.tools.lifecycle": "会话管理",
  "ext.reloadUi": "重新加载界面",
  "ext.appCloseTitle": "结束当前会话？",
  "ext.appCloseDescription":
    "当前输入、进度和结果尚未导出。结束会话会清空这些内容；已保存的插件私有数据会保留。可以先导出会话，或放弃本次进度。",
  "ext.appDiscardClose": "放弃进度并结束",
  "ext.appSaveClose": "导出会话并结束",
  "ext.appExportHint":
    "将当前输入、状态和结果保存为 JSON，可在同一命令和完全相同的包版本中导入恢复。文件需重新选择，凭据不会导出。",
  "ext.appStopHint": "请求取消当前操作并等待实际停止，保留输入与上次结果。",
  "ext.appCloseHint": "清空本次会话并退出，不会禁用或卸载扩展。",
  "ext.boundary":
    "你可以查看并管理插件的访问权限。插件只接收你确认提供的文件，联网仅限声明的服务，每个插件的本机数据相互独立。",
  "ext.installFile": "选择扩展包",
  "ext.installLocal": "安装本地扩展",
  "ext.openPackageFile": "打开文件",
  "ext.selectedPackageFile": "{name}，点击更换文件",
  "ext.packageHint":
    "选择 .starter-extension.json 包（最多 24 MiB），审阅权限后安装并启用。预览、安装和启用均不执行插件程序。",
  "ext.docs": "开发文档",
  "ext.host": "运行框架",
  "ext.empty": "还没有安装扩展。可以恢复内置工作台，或从文件安装你信任的扩展。",
  "ext.review": "审阅扩展包",
  "ext.author": "作者（自行声明）",
  "ext.version": "版本",
  "ext.permissions": "声明用途与宿主数据访问",
  "ext.hash": "Wasm 模块 SHA-256",
  "ext.hashHint": "内容哈希用于识别文件与发现修改，不证明作者身份或程序可信。",
  "ext.bytes": "Wasm 模块：{bytes} 字节",
  "ext.install": "安装并启用",
  "ext.installConsent":
    "确认后即启用扩展，并授予上方列出的必需权限及你勾选的可选权限。你可以随时修改授权或停用。",
  "ext.upgrade": "升级并启用",
  "ext.upgradeHint":
    "当前版本 {version}。请审阅新版本来源及权限；确认后原子地更新并启用，旧版本保留用于回退。",
  "ext.enable": "启用",
  "ext.disable": "禁用",
  "ext.enabled": "已启用",
  "ext.disabled": "已禁用",
  "ext.enableTitle": "确认信任与用途",
  "ext.trust":
    "我信任此扩展的来源，并同意向它提供已授权的内容。我了解作者身份尚未经过核实。",
  "ext.grantHint":
    "查看扩展需要哪些权限，再选择你愿意允许的项目。以后可以在更多操作中更改权限。",
  "ext.permission.files:read":
    "读取你分享的文件：仅接收你主动选择并确认发送的文件内容。",
  "ext.permission.network:https":
    "访问指定网络服务：与扩展声明的互联网服务获取或发送数据。",
  "ext.allowedHosts": "声明的网络来源与方法",
  "ext.uninstall": "卸载",
  "ext.uninstallTitle": "卸载此扩展？",
  "ext.uninstallHint":
    "停止扩展、撤销已保存的服务凭据，并移除安装记录与 Wasm 缓存。用户文件与私有存储会保留；不再需要私有数据时，请在卸载前显式清空。",
  "ext.cancel": "取消",
  "ext.refresh": "刷新扩展列表",
  "ext.running": "运行中：{id}",
  "ext.runner": "运行工具",
  "ext.choose": "选择扩展命令",
  "ext.noEnabled": "先安装并启用一个扩展。",
  "ext.input": "输入文本",
  "ext.inputTooLong": "文本超过 1 MiB UTF-8 上限，请删减内容后继续。",
  "ext.inputHint": "最多 1 MiB UTF-8，作为数据交给所选 Wasm 导出函数。",
  "ext.files": "选择本次发送的文件",
  "ext.filesHint":
    "最多 16 个用户选择的文件，合计 2 MiB。仅交付文件名、媒体类型和磁盘内容，二进制使用 base64。",
  "ext.clearFiles": "清除文件选择",
  "ext.url": "本次 URL（可选）",
  "ext.urlHint":
    "发送 URL 后，宿主向已声明来源发起一次 GET。插件还可通过受控 HTTP 能力发起已授权请求；凭据仅按配置的来源与别名使用。",
  "ext.run": "运行扩展",
  "ext.stop": "请求停止",
  "ext.stopping": "正在等待扩展停止…",
  "ext.output": "运行结果",
  "ext.noOutput": "尚无结果",
  "ext.export": "导出本次输入与结果",
  "ext.sessionHint":
    "可导出会话，在完全相同的包版本中导入恢复。文件名仅作参考，需重新选择文件；凭据不会包含在会话中。",
  "ext.error.incompatible": "扩展包、API 或存档版本不兼容，原数据已保留。",
  "ext.error.failed":
    "扩展运行、资源预算、HTTPS 请求或返回格式检查失败。输入与上次结果已保留。",
  "ext.error.timeout": "扩展超过执行时限，正在等待实际停止。",
  "ext.error.busy": "扩展队列已满，或本会话仍有操作尚未结束；请等待后重试。",
  "ext.error.unavailable": "启动恢复、更新安装或退出期间不能使用扩展。",
  "ext.packageError": "无法读取扩展包，请检查 UTF-8 格式及 24 MiB 大小限制。",
  "experience.extensions": "安装与运行扩展",
  "experience.extensionsHint":
    "审阅包 → 授权启用 → 执行 Wasm 命令 → 停止与卸载。",
  "experience.extensions.1": "检查内置工作台",
  "experience.extensions.1Hint":
    "在已安装扩展中查看工作台的命令、权限和哈希；也可导入第三方 Wasm 包，安装不会执行插件。",
  "experience.extensions.2": "确认信任并启用",
  "experience.extensions.2Hint":
    "审阅后点击“安装并启用”完成授权。内置工作台首次预置时需单独启用；命令随后出现在命令面板中。",
  "experience.extensions.3": "运行并检查结果",
  "experience.extensions.3Hint":
    "从侧栏打开工作台，处理文本、CSV / JSON 和待办；主动发送文件或请求网络数据，也可另开窗口或导出会话。",
  "experience.extensions.4": "禁用或卸载",
  "experience.extensions.4Hint":
    "禁用会撤回宿主数据访问并停止当前运行；卸载只清理应用管理的安装记录和 Wasm 模块。",
  "experience.preview.extensions.1": "审阅本地 Wasm 扩展包与导出命令",
  "experience.preview.extensions.2": "授权启用后，主动选择本次输入",
  "experience.preview.extensions.3": "运行、停止、禁用与卸载 Extism 插件",
  "ext.inputFormat": "输入格式",
  "ext.resultFormat": "结果格式",
  "ext.commands": "扩展命令",
  "ext.permission.text:read":
    "读取你发送的文字：接收你为本次操作输入并发送的文字。",
  "ext.bundledHint":
    "应用自带的本地工作台已安装，启用后可从侧栏打开，也可使用独立窗口。卸载后不会自动重装。",
  "ext.hostData": "宿主数据 · 显式发送",
  "ext.hostDataHint":
    "点击“发送所选数据”交付这些内容。插件可在普通操作中使用另行授权的网络或私有存储能力。",
  "ext.sendData": "发送所选数据",
  "ext.sendDataTitle": "发送数据",
  "ext.sendDataMenu": "发送数据…",
  "ext.openWindow": "在独立窗口打开",
  "ext.windowHint":
    "标题栏可切换语言、主题，或最小化、最大化和关闭。主窗口可以继续使用，此窗口拥有独立会话。",
  "ext.entryUnavailable":
    "扩展未启用、已卸载，或这个应用命令已失效。请在扩展中心检查状态。",
  "ext.restoreLab": "恢复内置工作台",
  "ext.minHostVersion": "最低宿主版本",
  "ext.requiredPermissions": "使用时需要的权限",
  "ext.optionalPermissions": "你可以选择允许",
  "ext.optionalPermissionsHint":
    "按需开启；未允许的相关功能将不可用，以后可以更改。",
  "ext.selectAllOptionalPermissions": "允许所有可选权限",
  "ext.permissionAllowed": "已允许",
  "ext.permissionNotAllowed": "未允许",
  "ext.permissionScopeHint":
    "权限适用于整个扩展。允许联网后，扩展可以将你交给它的内容发送到获准访问的服务。",
  "ext.managePermissions": "管理权限",
  "ext.savePermissions": "保存权限",
  "ext.limitedCommands": "当前可使用 {total} 项功能中的 {available} 项。",
  "ext.permission.network:local":
    "连接本机服务：仅连接在这台电脑上运行的指定服务，不访问其他局域网设备。",
  "ext.permission.storage":
    "保存扩展数据：在这台电脑上保存，重启后仍保留。数据不加密，卸载时不会自动删除。",
  "ext.queueSummary": "共 {count} 项操作正在排队或运行",
  "ext.queued": "正在排队，等待运行名额…",
  "ext.storage": "插件私有存储",
  "ext.storageHint": "数据按插件隔离，卸载后保留；不再需要时可显式清空。",
  "ext.storageUsage": "{entries} 条数据 · {bytes} 字节",
  "ext.clearStorage": "清空私有存储",
  "ext.clearStorageHint":
    "永久删除此插件的私有数据，保留当前会话和所选文件。请先停止运行中的操作，避免写入冲突。",
  "ext.credentials": "服务凭据",
  "ext.credentialsHint":
    "填写插件约定的别名。宿主仅向所选的精确来源附加 Bearer 令牌，插件与会话导出不能读取密钥。保存相同别名会替换密钥。",
  "ext.credentialOrigin": "服务来源",
  "ext.credentialAlias": "凭据别名",
  "ext.credentialSecret": "密钥 / 访问令牌",
  "ext.saveCredential": "保存凭据",
  "ext.deleteCredential": "删除凭据",
  "ext.deleteCredentialNamed": "删除凭据 {alias}",
  "ext.deleteCredentialHint":
    "删除 {origin} 的凭据 {alias}？此处无法恢复；扩展后续需要时，须重新填写。",
  "ext.disabledPermissionsHint":
    "禁用的扩展不保留有效授权。请先显式启用扩展，再调整权限。",
  "ext.viewPermissions": "查看权限",
  "ext.rollback": "恢复至 {version}",
  "ext.rollbackTitle": "恢复上一版本的扩展包？",
  "ext.rollbackHint":
    "用上一版本替换当前包并禁用扩展，恢复后需要重新审阅权限。私有存储会保留，其数据可能使用较新版本的格式。",
  "ext.rollbackConfirm": "恢复上一版本",
  "ext.importSession": "导入会话 JSON",
  "ext.importSessionHint":
    "用所选会话替换此命令的输入、进度与结果。导入不会自动执行，私有存储不受影响。",
  "ext.replaceSession": "替换当前会话",
  "ext.importFileHint": "发送数据前请重新选择这些文件：",
  "ext.sessionInvalid": "会话文件无效、超过 8 MiB，或不属于相同命令及包版本。",
  "ext.artifacts": "生成的文件",
  "ext.saveArtifact": "保存 {name}",
  "ext.saveResult": "单独保存结果",
  "ext.switchCommand": "切换命令",
  "ext.switchCommandHint":
    "放弃当前命令尚未导出的输入和结果？如需保留，请先导出会话。",
  "ext.source": "安装来源",
  "ext.source.market": "来自扩展市场",
  "ext.source.bundled": "随应用提供",
  "ext.source.local": "从本机文件安装",
  "ext.source.marketHint":
    "已核对与市场发布的扩展包一致。作者信息由发布者填写，来源核对不代表安全保证。",
  "ext.source.bundledHint":
    "此扩展随应用提供。作者信息为扩展自行声明，请只授予需要的权限。",
  "ext.source.localHint": "文件来源和作者身份未经核实，请仅使用你信任的扩展。",
  "ext.source.key": "市场签名公钥指纹：",
  "ext.permission.messaging:lan":
    "内网通信：由你主动开启或连接，与本地网络设备收发文字、图片和文件并保存记录；文件由你选择发送或另存。通信不加密，也不验证对方身份。",
  "ext.permission.wallpapers:manage":
    "管理图库和应用背景：导入、改名或删除本机图库图片，更换本应用背景；不更改电脑桌面壁纸，也不包含联网。",
  "ext.permission.network:images":
    "下载互联网图片：从任意公开的 HTTPS 地址下载、预览或另存图片。图片网址本身也可能向网站发送信息。",
  "ext.permission.network:system-proxy":
    "使用电脑的代理设置：让已允许的网络请求通过代理中转。代理可能在本机或内网，应用无法核实它最终连接的地址。",
  "ext.permission.links:open":
    "在浏览器打开网页：允许扩展在默认浏览器打开公开的 HTTPS 网页。",
  "ext.permission.window:control":
    "插件窗口置顶：读取或更改此插件自身独立窗口的置顶状态。",
} as const;
