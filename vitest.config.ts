import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    // Live-API smoke scripts in test/smoke are standalone (npm run smoke:*),
    // cost real credits, and must never run as part of the offline suite.
    exclude: ["test/smoke/**", "node_modules/**"],
  },
});
