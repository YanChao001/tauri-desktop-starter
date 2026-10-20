import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "jsdom",
    // 每个文件仍有独立的 window 和模块作用域，复用 worker 内的 jsdom 加载。
    pool: "vmThreads",
    setupFiles: ["./src/test/setup.ts"],
    // 不开启 globals：测试文件显式 import describe/it/expect，类型来源更清楚
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // 限制并发，避免与原生构建争抢内存。
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/components/ui/**",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
      ],
    },
  },
});
