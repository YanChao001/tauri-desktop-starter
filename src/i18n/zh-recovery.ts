export const zhRecovery = {
  "recovery.title": "启动故障恢复",
  "recovery.description":
    "先在单独的空间试恢复备份，确认后在下次启动时替换原数据。",
  "recovery.isolated": "正在单独的恢复空间中操作",
  "recovery.healthy": "存储正常",
  "recovery.noAction":
    "当前不需要执行启动恢复。日常备份与恢复可在本地笔记中管理。",
  "recovery.preserved":
    "原设置和笔记数据仍保留。当前编辑和试恢复只影响单独的恢复空间；请勿手动删除应用数据或相关文件。",
  "recovery.archive": "上次恢复的原件归档：{id}",
  "recovery.diagnostics": "复制问题报告",
  "recovery.copied": "诊断已复制，分享前请再次检查敏感内容。",
  "recovery.choose": "1. 选择并检查备份",
  "recovery.chooseHint":
    "可选择本机备份或导入此前导出的 JSON。无效、超限和未来版本的备份会被拒绝，原件保持不变。",
  "recovery.import": "导入备份文件",
  "recovery.backups": "本机恢复备份",
  "recovery.backupsLoading": "正在读取本机备份…",
  "recovery.backupsEmpty": "没有找到本机备份。可导入此前导出的备份文件。",
  "recovery.preview": "预览内容",
  "recovery.testRestore": "在单独的空间试恢复",
  "recovery.validated": "试恢复已完成，请核对记录数，再安排替换原数据。",
  "recovery.schedule": "2. 安排下次启动恢复",
  "recovery.scheduleHint":
    "应用会检查恢复数据的完整性。下次启动时先归档原数据及相关文件，再进行替换；中断或替换失败会恢复原件。来自更新版本的数据不会被旧版本覆盖。",
  "recovery.recordCount": "试恢复已还原 {count} 条记录",
  "recovery.resetSettings":
    "同时恢复默认偏好（保留原设置归档；不覆盖来自更新版本的设置）",
  "recovery.pending":
    "恢复已排队。当前原件仍保持不变，重新启动后进行验证与安全替换。",
  "recovery.restart": "重新启动并应用恢复",
  "recovery.confirmTitle": "确认安排恢复？",
  "recovery.confirmDatabase":
    "将用检查通过的恢复数据替换现有笔记数据。原数据及相关文件会先保存到恢复归档。",
  "recovery.confirmWithSettings":
    "将用检查通过的恢复数据替换现有笔记数据，并恢复默认偏好。原设置、数据及相关文件会先归档。",
  "recovery.confirm": "确认安排，暂不重启",
} as const;
export type RecoveryMessages = Record<keyof typeof zhRecovery, string>;
