export const zhSystem = {
  "lifecycle.title": "保存未完成的工作",
  "lifecycle.description":
    "此操作需要 {count} 个窗口就绪。先保存或处理未完成的工作；所有窗口准备好后才会继续。",
  "lifecycle.save": "保存并继续",
  "lifecycle.discard": "放弃并继续",
  "lifecycle.saving": "正在保存…",
  "lifecycle.executing": "所有窗口已准备好，正在执行操作。完成后会自动继续。",
  "lifecycle.waiting":
    "此窗口已准备好，正在等待其他窗口确认。你仍可取消整个操作。",
  "lifecycle.tasks": "后台任务：保存并继续会等待完成；放弃并继续会取消任务",
  "system.title": "系统集成",
  "system.description":
    "实际体验系统通知、全局快捷键、深链接、文件关联、剪贴板与多窗口工作区。",
  "system.notification": "发送系统通知",
  "system.notificationBody": "来自桌面演示的通知。后台任务可复用同一系统能力。",
  "system.shortcut": "全局快捷键",
  "system.register": "注册快捷键",
  "system.unregister": "解除快捷键",
  "system.shortcutHelp":
    "注册后，即使应用不在前台也可唤醒主窗口。被其他程序占用时会显示错误。",
  "system.clipboard": "系统剪贴板",
  "system.writeClipboard": "复制文本",
  "system.readClipboard": "读取文本",
  "system.deepLink": "深链接与文件关联",
  "system.deepLinkHelp":
    "安装版支持 tdemo://open?route=/database 链接和 .tdemo 文件。冷启动与重复启动的输入显示在下面；文件内容由文件工作台校验。",
  "system.events": "启动与激活记录",
  "system.empty": "尚未收到激活事件。",
  "system.window": "打开独立笔记窗口",
  "system.restore": "恢复上次工作区",
  "system.success": "操作完成",
  "system.denied": "系统通知权限未获允许，请检查系统通知设置。",
  "system.permission":
    "原生通知与文件关联请使用安装版验收，实际行为取决于目标系统。",
  "nav.system": "系统集成",
  "nativeError.userCancelled": "已取消操作，未保存的工作已保留。",
  "nativeError.credentialError":
    "无法访问系统凭据库，请解锁系统钥匙串或检查凭据服务后重试。",
} as const;
