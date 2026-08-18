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
      // Explicitly pinned so tests stay deterministic/offline regardless of
      // what's in .env — without this, dotenv fills AI_API_KEY from the
      // real .env (since nothing here already occupies it) and tests start
      // making live network calls to a real, billed AI provider.
      AI_API_KEY: "sk-test-not-a-real-key",
    },
  },
});
