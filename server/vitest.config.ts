import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: {
      DB_PATH: ":memory:",
      JWT_SECRET: "test-secret-min-32-characters-long!!",
      PORT: "0",
      VITEST: "true",
    },
  },
});
