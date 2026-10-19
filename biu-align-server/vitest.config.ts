import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { JWT_SECRET: "test-secret", ADMIN_MIDS: "900", DATA_DIR: "/nonexistent-should-be-overridden" },
  },
});
