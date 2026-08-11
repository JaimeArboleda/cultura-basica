import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function postJson(path: string, body: unknown) {
  return SELF.fetch(`http://worker.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/solicitud-acceso", () => {
  it("guarda una solicitud con contacto válido", async () => {
    const res = await postJson("/api/solicitud-acceso", {
      contacto: "persona@example.com",
      motivo: "familia de Gerardo",
    });
    expect(res.status).toBe(201);

    const fila = await env.DB.prepare(
      "SELECT contacto, motivo, atendida FROM solicitudes_acceso WHERE contacto = ?"
    )
      .bind("persona@example.com")
      .first<{ contacto: string; motivo: string; atendida: number }>();
    expect(fila).toEqual({ contacto: "persona@example.com", motivo: "familia de Gerardo", atendida: 0 });
  });

  it("rechaza sin contacto", async () => {
    const res = await postJson("/api/solicitud-acceso", { motivo: "algo" });
    expect(res.status).toBe(400);
  });
});
