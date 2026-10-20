export const zhCatalog = {
  "nav.catalog": "能力目录与上手",
  "catalog.title": "从体验到自己的桌面应用",
  "catalog.description":
    "按真实路由浏览能力、运行边界和源码。先选择一条体验路线，再通过页面、门面与 Rust 命令完成一次小改动。",
  "catalog.runtimeBrowser":
    "当前为浏览器预览：本地交互可直接体验，原生页面提供桌面入口说明。",
  "catalog.runtimeNative":
    "当前为桌面应用：原生功能使用当前用户环境；外部网络、权限和发布配置仍可能不可用。",
  "catalog.native": "真实原生能力",
  "catalog.local": "本地界面 / fixture",
  "catalog.external": "需要外部服务或配置",
  "catalog.inspect": "以模块说明为准",
  "catalog.statusHint":
    "本地标记包括浏览器界面和明确标记的 fixture，不代表真实账号或系统操作。外部标记的服务需要主动选择，默认不发送演示请求。",
  "catalog.search": "搜索能力、页面或说明",
  "catalog.filter": "能力类型",
  "catalog.all": "全部能力",
  "catalog.open": "打开体验",
  "catalog.source": "页面源码",
  "catalog.docs": "对应文档",
  "catalog.hidden": "精简模式隐藏的演示入口",
  "catalog.empty": "没有匹配的能力。",
  "catalog.journey": "选择体验路线",
  "catalog.journeyHint":
    "路线复用应用导航分组；每个入口都打开当前应用中的实际页面。",
  "catalog.modules": "模块与能力边界",
  "catalog.overview": "预览、应用与撤销窗口风格，观察受控动效。",
  "catalog.components": "操作表单、反馈、筛选与收藏场景；数据属于当前页面。",
  "catalog.motion": "调节弹簧、布局、路径与倾斜；支持减少动效与暂停。",
  "catalog.bridge": "调用真实 Rust 命令，观察成功结果和结构化错误。",
  "catalog.desktop": "测试窗口、托盘、后台运行和多窗口设置同步。",
  "catalog.database": "原生笔记查询、版本冲突、草稿、批量操作与备份恢复。",
  "catalog.diagnostics": "读取运行状态和脱敏日志；导出前仍需确认内容范围。",
  "catalog.recovery":
    "隔离故障启动、预览备份并恢复原生数据；保留原始文件用于排查。",
  "catalog.updates": "签名更新链路；需要维护者配置公钥、更新源与可用发行物。",
  "catalog.settings":
    "浏览器本地偏好与桌面原生存档；语言、主题和布局即时反馈。",
  "catalog.workbench": "通过原生选择器导入有界文件和目录，编辑并处理保存冲突。",
  "catalog.tasks": "运行受控后台任务，观察进度、取消、失败与重试。",
  "catalog.system": "主动测试系统剪贴板、通知、全局快捷键和桌面集成。",
  "catalog.network":
    "本地请求故障场景、缓存与会话；可选 HTTPS 和系统凭据存储。",
  "catalog.dataStudio": "一万条本地记录的虚拟化、批量部分失败和复杂表单。",
  "catalog.media": "安全 Markdown、本地媒体和图表；可选 WSS 与受控 worker。",
  "catalog.catalog":
    "按当前路由发现功能，查看源码，并完成页面到 IPC 的上手练习。",
  "catalog.generic": "查看当前页面与架构文档确认运行边界。",
  "catalog.tutorial": "上手练习：新增页面 → 调用 Rust",
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
