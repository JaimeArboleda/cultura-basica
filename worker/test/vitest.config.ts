import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const workerRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: workerRoot,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        kvNamespaces: ["RATE_LIMIT"],
        bindings: {
          EXPORT_TOKEN: "token-de-test",
          ALLOWED_ORIGIN: "http://localhost:8788",
          RATE_LIMIT_MAX: "1000",
          GOOGLE_CLIENT_ID: "client-id-de-test",
          GOOGLE_CLIENT_SECRET: "client-secret-de-test",
          ADMIN_SESSION_SECRET: "secreto-de-test-no-usar-en-produccion",
        },
      },
    }),
  ],
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
