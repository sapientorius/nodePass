import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "node --import tsx tests/browser-server.ts",
    url: "http://localhost:3100/health/live",
    reuseExistingServer: false,
    timeout: 60000,
  },
  outputDir: "output/playwright/results",
});
