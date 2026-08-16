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
          // Vacío A PROPÓSITO, aunque exista worker/.dev.vars con una API key
          // real para desarrollo local (miniflare/vitest-pool-workers carga
          // .dev.vars automáticamente y, si no se pisara aquí, una key real
          // de desarrollo se colaría en los tests — que harían llamadas
          // reales de pago a OpenAI sin que nadie lo pidiera). Esta entrada
          // explícita gana siempre sobre lo que traiga .dev.vars, así los
          // tests de ocrIa.test.ts que dependen de "sin API key" siguen
          // siendo ciertos pase lo que pase en el entorno de quien los corre.
          OPENAI_API_KEY: "",
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
