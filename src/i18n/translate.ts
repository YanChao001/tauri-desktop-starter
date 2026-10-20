import { zhCN, type MessageKey, type Messages } from "./zh-CN";

export type MessageVariables = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: MessageVariables) => string;

/** 运行时也有默认语言兜底，替换一次占位符，保留未知变量。 */
export function createTranslator(messages: Partial<Messages>): Translate {
  return (key, vars) => {
    const template = messages[key] || zhCN[key];
    return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
      vars && Object.hasOwn(vars, name) ? String(vars[name]) : placeholder,
    );
  };
}
