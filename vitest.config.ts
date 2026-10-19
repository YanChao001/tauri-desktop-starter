import { defineConfig } from "vitest/config";

import { alias } from "./vite.config.ts";

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 不开启 globals：测试文件显式 import describe/it/expect，类型来源更清楚
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
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
