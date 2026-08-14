// Motor de OCR-IA de v2 (README §4.7, "Motor gpt-mini",
// worker/src/endpoints/admin/ocrIa.ts): solo se testea aquí la validación de
// entrada y el caso "sin OPENAI_API_KEY configurada" — igual que el callback
// de OAuth de Google (worker/src/adminAuth.ts) no se testea contra la red
// real, no se mockea aquí la llamada real a la API de OpenAI (el binding de
// test en vitest.config.ts no define OPENAI_API_KEY a propósito, para poder
// probar ese camino sin tocar la red).
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { firmarSesionAdmin } from "../src/adminAuth";

const ADMIN_EMAIL = "admin@example.com";

async function tokenAdmin(email = ADMIN_EMAIL): Promise<string> {
  return firmarSesionAdmin(env, email);
}

async function fetchAdmin(path: string, opciones: RequestInit = {}, auth?: string) {
  return SELF.fetch(`http://worker.test${path}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...opciones.headers,
    },
  });
}

async function sembrarAdmin(email = ADMIN_EMAIL) {
  await env.DB.prepare("INSERT OR IGNORE INTO admins (email, anadido_por, anadido_en) VALUES (?,?,?)")
    .bind(email, null, new Date().toISOString())
    .run();
}

async function postOcrIa(body: unknown, auth: string) {
  return fetchAdmin("/api/admin/ocr-ia", { method: "POST", body: JSON.stringify(body) }, auth);
}

const CASILLA_VALIDA = { clave: "item:E:opcion", tipo: "letra", imagen: "data:image/jpeg;base64,AAA=" };

beforeEach(async () => {
  await sembrarAdmin();
});

describe("POST /api/admin/ocr-ia", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/ocr-ia", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it("400 con JSON inválido", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/ocr-ia", { method: "POST", body: "no es json" }, auth);
    expect(res.status).toBe(400);
  });

  it("400 sin paginas", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({}, auth);
    expect(res.status).toBe(400);
  });

  it("400 con paginas vacío", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [] }, auth);
    expect(res.status).toBe(400);
  });

  it("400 con una casilla sin tipo válido", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      { paginas: [{ id: "p1", casillas: [{ clave: "x", tipo: "invalido", imagen: "data:image/jpeg;base64,AAA=" }] }] },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con una casilla sin data URL de imagen", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", casillas: [{ clave: "x", tipo: "letra", imagen: "no-es-una-url" }] }] }, auth);
    expect(res.status).toBe(400);
  });

  it("400 si ninguna página trae casillas", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", casillas: [] }] }, auth);
    expect(res.status).toBe(400);
  });

  it("500 con mensaje claro si el Worker no tiene OPENAI_API_KEY configurada (aunque el body sea válido)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", casillas: [CASILLA_VALIDA] }] }, auth);
    expect(res.status).toBe(500);
    const cuerpo = (await res.json()) as { error: string };
    expect(cuerpo.error).toMatch(/OPENAI_API_KEY/);
  });
});
