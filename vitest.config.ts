import { defineConfig } from "vitest/config";

import { alias } from "./vite.config.ts";

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 不开启 globals：测试文件显式 import describe/it/expect，类型来源更清楚
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // 每个 jsdom worker 都有独立运行时；限制并发，避免与原生构建争抢内存。
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
