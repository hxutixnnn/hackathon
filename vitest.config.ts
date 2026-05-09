import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["convex/lib/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
