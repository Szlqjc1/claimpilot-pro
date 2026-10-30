import path from "node:path";
import { defineConfig } from "vitest/config";

export const TEST_DATABASE_URL = "file:./test.db";
export const TEST_RECEIPTS_DIR = path.resolve(__dirname, "storage-test/receipts");

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "src/tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["src/tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      RECEIPTS_DIR: TEST_RECEIPTS_DIR,
      AI_MODE: "mock",
      OCR_MODE: "fixture",
    },
  },
});
