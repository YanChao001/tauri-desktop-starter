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
    "发送通知、设置快捷键、复制文本，或打开多个窗口一起工作。",
  "system.notification": "发送系统通知",
  "system.notificationBody": "这是一条来自桌面应用的示例通知。",
  "system.shortcut": "全局快捷键",
  "system.register": "启用快捷键",
  "system.unregister": "停用快捷键",
  "system.shortcutHelp":
    "启用后，即使正在使用其他应用，也可用此快捷键打开主窗口。被其他程序占用时会提示。",
  "system.clipboard": "系统剪贴板",
  "system.writeClipboard": "复制文本",
  "system.readClipboard": "读取文本",
  "system.deepLink": "通过链接或文件打开",
  "system.deepLinkHelp":
    "安装版可通过 {deepLink} 链接或 .{extension} 文件打开。收到的链接和文件会显示在下方；文件内容由文件工作台检查。",
  "system.events": "启动与激活记录",
  "system.empty": "尚未收到新的打开记录。",
  "system.workspace": "多窗口工作区",
  "system.window": "打开独立笔记窗口",
  "system.restore": "恢复上次工作区",
  "system.success": "操作完成",
  "system.denied": "系统通知权限未获允许，请检查系统通知设置。",
  "system.permission":
    "请在安装后体验系统通知和通过文件打开应用，具体表现取决于你的操作系统。",
  "nav.system": "系统集成",
  "nativeError.userCancelled": "已取消操作，未保存的工作已保留。",
  "nativeError.httpTimeout": "网络请求超时，请检查连接或代理设置后重试。",
  "nativeError.credentialError":
    "无法访问系统凭据库，请解锁系统钥匙串或检查凭据服务后重试。",
} as const;
