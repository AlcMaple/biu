import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __BIU_SENTRY_ENABLED__: "false",
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    // Node 自带的 Web Storage 会遮住 jsdom 为每个测试环境创建的浏览器存储。
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    restoreMocks: true,
    mockReset: true,
    clearMocks: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
