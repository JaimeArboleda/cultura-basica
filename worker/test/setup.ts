// Aplica schema/schema.sql (el DDL real, no una copia) a la D1 de test antes de
// que vitest-pool-workers tome la instantánea de almacenamiento aislado por test.
// Import "?raw": el runtime de Workers no tiene acceso al filesystem del host, así
// que el SQL se incrusta como texto en tiempo de build (igual que data/items.json).
import { env } from "cloudflare:test";
// @ts-expect-error -- sufijo ?raw resuelto por el bundler, no por TypeScript
import schemaSql from "../../schema/schema.sql?raw";

const sentencias = (schemaSql as string)
  .replace(/--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const sentencia of sentencias) {
  await env.DB.prepare(sentencia).run();
}
