/** 临时运行锁保留控件外观；真正不可用的操作仍使用默认禁用样式。 */
export const LOCKED_CONTROL_CLASS =
  "data-[operation-locked=true]:disabled:opacity-100";

export const LOCKED_INPUT_CLASS = `${LOCKED_CONTROL_CLASS} data-[operation-locked=true]:disabled:bg-transparent dark:data-[operation-locked=true]:disabled:bg-input/30`;
