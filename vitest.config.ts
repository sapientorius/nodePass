import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    // Bound simultaneous Argon2 work and database fixtures on CI runners.
    maxWorkers: 2,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["packages/server/src/**/*.ts"],
      exclude: ["packages/server/src/index.ts", "packages/server/src/cli.ts"],
      reporter: ["text-summary", "lcov", "json-summary", "json"],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
        "packages/server/src/security/**": { lines: 95, branches: 95 },
        "packages/server/src/compat/**": { lines: 95, branches: 95 },
        "packages/server/src/migration/**": { lines: 95, branches: 95 },
      },
    },
  },
});
