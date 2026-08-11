import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function crearTokenDeTest(expiraEn: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tokens (id, descripcion, creado_por, creado_en, expira_en) VALUES (?,?,?,?,?)")
    .bind(id, "token de test", "admin@example.com", new Date().toISOString(), expiraEn)
    .run();
  return id;
}

describe("GET /api/token-valido", () => {
  it("valido:false, motivo ausente sin parámetro token", async () => {
    const res = await SELF.fetch("http://worker.test/api/token-valido");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valido: false, motivo: "ausente" });
  });

  it("valido:false, motivo invalido con un token que no existe", async () => {
    const res = await SELF.fetch("http://worker.test/api/token-valido?token=no-existe");
    expect(await res.json()).toEqual({ valido: false, motivo: "invalido" });
  });

  it("valido:false, motivo caducado con un token vencido", async () => {
    const id = await crearTokenDeTest(new Date(Date.now() - 1000).toISOString());
    const res = await SELF.fetch(`http://worker.test/api/token-valido?token=${id}`);
    expect(await res.json()).toEqual({ valido: false, motivo: "caducado" });
  });

  it("valido:true con un token vigente", async () => {
    const id = await crearTokenDeTest(new Date(Date.now() + 60_000).toISOString());
    const res = await SELF.fetch(`http://worker.test/api/token-valido?token=${id}`);
    expect(await res.json()).toEqual({ valido: true, descripcion: "token de test" });
  });
});
