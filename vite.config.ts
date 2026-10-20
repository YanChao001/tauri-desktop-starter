import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

/** 路径别名，`vitest.config.ts` 复用这一份，避免两处各写一遍。 */
export const alias = {
  "@": path.resolve(import.meta.dirname, "./src"),
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  resolve: { alias },

  // 演示与桌面共用入口；相对资源地址同时适用于 Pages 项目子路径和独立域名。
  base: mode === "web-demo" ? "./" : "/",
  build: { outDir: mode === "web-demo" ? "dist-web" : "dist" },

  // 保留终端输出，便于查看 Tauri 开发与构建过程中的 Rust 错误。
  clearScreen: false,
  // Tauri 使用固定开发端口，端口被占用时直接报错。
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 生成目录不参与 HMR；Windows 上目录监听可能阻止归档时的原子重命名。
      ignored: [
        "**/src-tauri/**",
        "**/artifacts/**",
        "**/dist/**",
        "**/dist-web/**",
        "**/coverage/**",
      ],
    },
  },
}));
