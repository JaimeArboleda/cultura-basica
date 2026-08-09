import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

describe("entorno de test", () => {
  it("arranca Miniflare con el binding DB y el schema aplicado", async () => {
    const tablas = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    const nombres = tablas.results.map((r) => (r as { name: string }).name);
    expect(nombres).toEqual(
      expect.arrayContaining(["sesiones", "respuestas", "sesion_items"])
    );
  });
});
