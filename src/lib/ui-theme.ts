import surfaceTokens from "@/styles/surface-tokens.css?raw";
import controlStyles from "@/styles/control-styles.css?raw";

/** 同一原生 CSS 原文同时供宿主、插件文档及显式接入的 ShadowRoot 使用。 */
export const UI_STYLES = `@layer starter-defaults {\n${surfaceTokens}\n${controlStyles}\n}`;

/** CSS 新增语义变量会自然进入快照，不另维护容易遗漏的变量名清单。 */
export function readUiTokens(styles: CSSStyleDeclaration) {
  const tokens: Record<string, string> = {};
  for (let index = 0; index < styles.length; index++) {
    const name = styles.item(index);
    if (name.startsWith("--") && !name.startsWith("--tw-"))
      tokens[name] = styles.getPropertyValue(name).trim();
  }
  tokens["--host-font-size"] = styles.fontSize;
  tokens["--host-font-family"] = styles.fontFamily;
  return tokens;
}
