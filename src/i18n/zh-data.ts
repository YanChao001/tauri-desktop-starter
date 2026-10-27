export const zhData = {
  "data.active": "全部笔记",
  "data.trash": "回收站",
  "data.sort": "排序",
  "data.newest": "最近修改优先",
  "data.oldest": "最早修改优先",
  "data.byTitle": "标题顺序",
  "data.selectNote": "选择 {title}",
  "data.selected": "已选择 {count} 条",
  "data.trashSelected": "移入回收站",
  "data.restoreSelected": "恢复选中笔记",
  "data.purge": "永久删除",
  "data.previous": "上一页",
  "data.next": "下一页",
  "data.pageCount": "{from}–{to} / {total}",
  "data.trashDescription": "笔记将移入回收站，可在回收站中恢复。",
  "data.batchHint":
    "将处理 {count} 条笔记。任一笔记已被其他窗口修改时，整批操作都会取消，请刷新后重试。",
  "data.purgeHint":
    "将永久删除 {count} 条笔记，此操作无法撤销。建议先创建备份。",
  "data.confirm": "确认操作",
  "data.conflict": "笔记已在其他窗口修改",
  "data.conflictHint":
    "当前编辑已保留。先查看笔记的最新保存内容，再决定继续编辑并保存，或另存为副本；不会自动覆盖其他窗口的修改。",
  "data.viewRemote": "查看已保存内容",
  "data.remoteUnavailable":
    "暂时无法读取已保存内容，或笔记已被移走。当前编辑仍保留，可以另存为副本。",
  "data.keepLocal": "保留当前编辑",
  "data.saveCopy": "另存为副本",
  "data.discardEdits": "放弃当前编辑",
  "data.draftRecovered":
    "已恢复此窗口上次未保存的草稿；点击保存后才会写入笔记。",
  "data.draftSaved": "草稿已保存在本机，可在此窗口下次启动时恢复。",
  "data.backups": "备份与恢复",
  "data.backupHint":
    "备份包含全部笔记、回收站和各窗口草稿，可在本机恢复或导出。外部文件导入限 16 MiB；较大的本机备份仍可在原备份目录中恢复。",
  "data.createBackup": "创建完整备份",
  "data.backupAction": "创建备份",
  "data.importBackup": "从文件导入备份",
  "data.importBackupAction": "导入备份",
  "data.backupHistory": "备份记录",
  "data.previewBackup": "预览备份",
  "data.exportBackup": "导出文件",
  "data.restoreBackup": "恢复此备份",
  "data.backupCreated": "已备份 {count} 条笔记",
  "data.backupCount":
    "{notes} 条笔记 · {trashed} 条回收站记录 · {drafts} 份草稿",
  "data.restoreHint":
    "恢复会替换当前全部笔记、回收站和已保存的草稿。系统会先完整备份现有数据；恢复失败时保留原数据。",
  "data.saveBeforeRestore":
    "请先保存或放弃当前编辑，再恢复备份。其他窗口的未保存编辑会继续受到版本冲突保护。",
  "data.restored": "已恢复 {count} 条记录；恢复前的数据已保存为新的安全备份。",
  "data.exported": "备份已导出",
} as const;

export type DataMessages = Record<keyof typeof zhData, string>;
