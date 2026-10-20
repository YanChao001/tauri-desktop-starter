import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === "web-demo"
      ? [
          {
            name: "browser-demo-csp",
            transformIndexHtml() {
              return [
                {
                  tag: "meta",
                  attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content:
                      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://httpbin.org https://jsonplaceholder.typicode.com wss://echo.websocket.events; object-src 'none'; base-uri 'self'",
                  },
                  injectTo: "head-prepend" as const,
                },
              ];
            },
          },
        ]
      : []),
  ],

  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },

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
