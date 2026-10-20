import config from "../../app.config.json";

/** 应用身份的前端入口；初始化脚本同步原生和安装器配置。 */
export const APP_CONFIG = {
  ...config,
  defaultMode: config.defaultMode === "minimal" ? "minimal" : "demo",
} as const;
