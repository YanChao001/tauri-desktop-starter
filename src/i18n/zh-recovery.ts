export const zhRecovery = {
  "recovery.title": "启动故障恢复",
  "recovery.description":
    "在隔离空间检查备份与恢复数据，验证后安排下次启动替换。",
  "recovery.isolated": "已进入隔离恢复模式",
  "recovery.healthy": "存储正常",
  "recovery.noAction":
    "当前不需要执行启动恢复。日常备份与恢复可在本地数据库中管理。",
  "recovery.preserved":
    "正式设置与数据库未被丢弃。当前编辑和试恢复只影响隔离工作区；不要手动删除数据库或 WAL 文件。",
  "recovery.archive": "上次恢复的原件归档：{id}",
  "recovery.diagnostics": "复制脱敏诊断",
  "recovery.copied": "诊断已复制，分享前请再次检查敏感内容。",
  "recovery.choose": "1. 选择并检查备份",
  "recovery.chooseHint":
    "可选择本机备份或导入此前导出的 JSON。无效、超限和未来版本的备份会被拒绝，原件保持不变。",
  "recovery.import": "导入备份文件",
  "recovery.preview": "预览内容",
  "recovery.testRestore": "在隔离空间试恢复",
  "recovery.validated": "隔离恢复完成，可检查记录数并安排替换。",
  "recovery.schedule": "2. 安排下次启动恢复",
  "recovery.scheduleHint":
    "系统将验证完整候选数据库。下次启动时先归档原数据库及 WAL / SHM，再替换；中断或替换失败会恢复原件。来自更新版本的数据不会被降级覆盖。",
  "recovery.recordCount": "隔离空间已恢复 {count} 条记录",
  "recovery.resetSettings":
    "同时恢复默认偏好（保留原设置归档；未来版本偏好不会覆盖）",
  "recovery.pending":
    "恢复已排队。当前原件仍保持不变，重新启动后进行验证与安全替换。",
  "recovery.restart": "重新启动并应用恢复",
  "recovery.confirmTitle": "确认安排恢复？",
  "recovery.confirmDatabase":
    "将使用已验证的隔离数据库替换正式数据库。原数据库及相关日志文件会先保存在同级恢复归档中。",
  "recovery.confirmWithSettings":
    "将使用已验证的隔离数据库并恢复默认偏好。原设置、数据库及相关日志文件会先归档。",
  "recovery.confirm": "确认安排，暂不重启",
} as const;
export type RecoveryMessages = Record<keyof typeof zhRecovery, string>;
