export const zhCatalog = {
  "nav.catalog": "功能导览",
  "catalog.title": "探索应用功能",
  "catalog.description":
    "选择感兴趣的功能，了解使用条件，再直接打开体验。演示内容与需要桌面应用或联网的功能会分别标明。",
  "catalog.runtimeBrowser": "浏览器预览中，系统功能需在桌面应用中使用。",
  "catalog.native": "含桌面专用功能",
  "catalog.local": "浏览器可体验",
  "catalog.external": "需要联网或额外设置",
  "catalog.inspect": "查看使用条件",
  "catalog.statusHint":
    "浏览器体验包括界面操作和明确标记的演示内容，不代表真实账号或系统操作。连接外部服务需要你主动选择，默认不会发送演示请求。",
  "catalog.search": "搜索功能或说明",
  "catalog.filter": "使用条件",
  "catalog.all": "全部功能",
  "catalog.open": "打开体验",
  "catalog.source": "页面源码",
  "catalog.docs": "对应文档",
  "catalog.hidden": "精简模式隐藏的演示入口",
  "catalog.empty": "没有匹配的功能。",
  "catalog.modules": "功能与使用条件",
  "catalog.overview": "选择体验路线，预览、应用或撤销窗口外观。",
  "catalog.components":
    "试用表单、提示、收藏，以及文件树、拖放和分栏。示例内容仅在当前页面使用。",
  "catalog.motion":
    "拖动、翻转或切换互动卡片，体验动画效果；可暂停或减少动效。",
  "catalog.bridge": "发送问候，查看应用返回的结果与错误提示；需要桌面环境。",
  "catalog.desktop": "调整窗口、托盘和后台运行方式，在多个窗口之间同步设置。",
  "catalog.database":
    "在本机保存、搜索和编辑笔记，保留未保存草稿，并按需备份或恢复。",
  "catalog.diagnostics":
    "查看运行与存储状态、复制问题报告；启动异常时检查备份并恢复，原文件仍会保留。",
  "catalog.recovery":
    "隔离故障启动、预览备份并恢复原生数据；保留原始文件用于排查。",
  "catalog.updates": "检查并安装经过签名验证的更新；需要可用的更新服务。",
  "catalog.settings":
    "调整语言、外观、布局与窗口尺寸；在桌面应用中管理登录启动、后台运行、多窗口和签名更新。偏好保存在当前浏览器或桌面应用中。",
  "catalog.workbench":
    "选择本机文件或文件夹，预览、编辑和保存内容；文件被其他程序修改时会提示。",
  "catalog.tasks": "对选定文件夹运行扫描或校验，查看进度，按需停止或重试。",
  "catalog.system": "主动测试系统剪贴板、通知、全局快捷键和桌面集成。",
  "catalog.network":
    "体验请求、缓存和会话操作。默认使用本地演示；联网和保存凭据需主动选择。",
  "catalog.dataStudio":
    "使用万条示例记录练习筛选、调整列、查看详情、导入导出和填写表单；记录仅用于当前演示。",
  "catalog.media":
    "编辑或预览文档、图片和图表。实时连接默认使用本地演示；联网与后台处理需选择对应功能。",
  "catalog.catalog": "浏览功能用途与使用条件，选择感兴趣的页面开始体验。",
  "catalog.generic": "打开页面查看功能说明与使用条件。",
  "catalog.developerResources": "开发者资料",
  "catalog.moduleResources": "各功能的源码与文档",
  "catalog.tutorial": "上手练习：新增页面 → 调用 Rust",
  "catalog.rustExample": "Rust 命令",
  "catalog.typescriptExample": "TypeScript 门面与页面调用",
  "catalog.tutorialHint":
    "以下代码是待你实现的示例，不会直接执行。复用现有项目结构，避免另建一套路由、命令或错误协议。",
  "catalog.step.page": "建立页面与词典",
  "catalog.step.pageBody":
    "在 src/pages/ 新建默认导出的页面，复用现有 UI 组件，并在中英词典中加入页面与按钮文案。先用本地状态验证输入、加载和失败反馈。",
  "catalog.step.route": "注册一个路由",
  "catalog.step.routeBody":
    "在 src/routes.tsx 增加 lazy 页面和 APP_ROUTES 条目。导航、命令入口及本能力目录随同一份路由更新；补充该页面的运行边界说明。",
  "catalog.step.command": "在 Rust 边界校验输入",
  "catalog.step.commandBody":
    "在 commands.rs 增加命令，校验大小与格式，返回 NativeResult；业务逻辑进入对应服务，在 bindings.rs 的 collect_commands! 注册。按实际需要增加最小权限。",
  "catalog.step.bindings": "生成契约并经过门面调用",
  "catalog.step.bindingsBody":
    "运行绑定生成，在 src/lib/tauri.ts 增加命名能力，再由页面调用。浏览器预览明确说明限制；不手写字符串 invoke 或重复 DTO。",
  "catalog.step.verify": "验证可感知行为",
  "catalog.step.verifyBody":
    "补输入边界、成功/失败和取消的针对性回归。按改动跑类型与测试；涉及原生生命周期时补 Rust 与真实桌面验证。",
  "catalog.guide": "开发指南",
  "catalog.architecture": "架构与边界",
  "catalog.testing": "验证范围",
} as const;
