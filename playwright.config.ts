import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:1435/desktop-demo/";

export default defineConfig({
  testDir: "./e2e/browser",
  testMatch: "**/*.spec.ts",
  // 不同文件并行执行；同一文件内的场景仍按顺序运行。
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: "artifacts/browser",
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    locale: "en-US",
    reducedMotion: "reduce",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 预先运行 build:web；这里预览真实产物，并刻意挂在项目子路径下。
    command:
      "node node_modules/vite/bin/vite.js preview --outDir dist-web --base /desktop-demo/ --host 127.0.0.1 --port 1435 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
