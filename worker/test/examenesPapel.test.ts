// Subida en bloque de hojas en papel (README §4.10): worker/src/endpoints/admin/examenesPapel.ts.
// Nunca se sube una foto de verdad aquí (eso vive en el navegador,
// public/admin/papel/subirLote.js) — estos tests mandan directamente los
// mismos fragmentos ya decodificados que mandaría leerPagina().
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

async function crearTokenViaAdmin(auth: string, descripcion = "piloto en papel") {
  const res = await fetchAdmin("/api/admin/tokens", { method: "POST", body: JSON.stringify({ descripcion }) }, auth);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

// Cada `it()` comparte el mismo almacenamiento D1 con el resto del fichero
// (a diferencia de estar aislado por test), así que un exam_id fijo repetido
// entre varios `it()` colisionaría con el examen que dejó registrado uno
// anterior. Igual que los tokens (id generado por el propio endpoint), cada
// test genera el suyo.
let contador = 0;
function examIdUnico() {
  contador++;
  return `EXAM${String(contador).padStart(4, "0")}`;
}

function paginaValida(examId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    exam_id: examId,
    token_id: "",
    version: 1,
    pagina: 1,
    marcas: { oscuridad: { "demografia:consentimiento": 0.9 }, textos: { "demografia:anio_nacimiento": "1994" } },
    miniatura: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await sembrarAdmin();
});

describe("POST /api/admin/examenes-papel/paginas", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/examenes-papel/paginas", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it("400 si faltan campos obligatorios", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify({ exam_id: "X" }) },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("404 si el token no existe", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examIdUnico(), { token_id: "no-existe" })) },
      auth
    );
    expect(res.status).toBe(404);
  });

  it("crea el examen y la página al recibir la primera página de un exam_id nuevo", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();

    const res = await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id })) },
      auth
    );
    expect(res.status).toBe(201);

    const examen = await env.DB.prepare("SELECT * FROM examenes_papel WHERE exam_id = ?")
      .bind(examId)
      .first<{ token_id: string; version: number; sesion_id: string | null }>();
    expect(examen?.token_id).toBe(token.id);
    expect(examen?.version).toBe(1);
    expect(examen?.sesion_id).toBeNull();

    const pagina = await env.DB.prepare("SELECT * FROM examenes_papel_paginas WHERE exam_id = ? AND pagina = ?")
      .bind(examId, 1)
      .first<{ marcas_json: string }>();
    expect(JSON.parse(pagina!.marcas_json)).toEqual(paginaValida(examId).marcas);
  });

  it("volver a subir la MISMA página (mismo exam_id+pagina) sobrescribe, no duplica", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id })) },
      auth
    );
    const segunda = await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      {
        method: "POST",
        body: JSON.stringify(
          paginaValida(examId, { token_id: token.id, marcas: { oscuridad: {}, textos: { corregido: "SI" } } })
        ),
      },
      auth
    );
    expect(segunda.status).toBe(200); // 200, no 201: ya existía el examen

    const conteo = await env.DB.prepare("SELECT COUNT(*) AS n FROM examenes_papel_paginas WHERE exam_id = ?")
      .bind(examId)
      .first<{ n: number }>();
    expect(conteo?.n).toBe(1);

    const pagina = await env.DB.prepare("SELECT marcas_json FROM examenes_papel_paginas WHERE exam_id = ? AND pagina = ?")
      .bind(examId, 1)
      .first<{ marcas_json: string }>();
    expect(JSON.parse(pagina!.marcas_json)).toEqual({ oscuridad: {}, textos: { corregido: "SI" } });
  });

  it("409 si el mismo exam_id ya tenía páginas con otro token_id/version", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const otroToken = await crearTokenViaAdmin(auth, "otra remesa");
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id })) },
      auth
    );

    const res = await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: otroToken.id, pagina: 2 })) },
      auth
    );
    expect(res.status).toBe(409);
  });

  it("acumula varias páginas del mismo examen", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    for (const pagina of [3, 1, 2]) {
      const res = await fetchAdmin(
        "/api/admin/examenes-papel/paginas",
        { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id, pagina })) },
        auth
      );
      expect(res.status).toBeLessThan(300);
    }
    const conteo = await env.DB.prepare("SELECT COUNT(*) AS n FROM examenes_papel_paginas WHERE exam_id = ?")
      .bind(examId)
      .first<{ n: number }>();
    expect(conteo?.n).toBe(3);
  });
});

describe("GET /api/admin/examenes-papel", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/examenes-papel");
    expect(res.status).toBe(401);
  });

  it("lista los exámenes con las páginas ya subidas", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id, pagina: 1 })) },
      auth
    );
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id, pagina: 2 })) },
      auth
    );

    const res = await fetchAdmin("/api/admin/examenes-papel", {}, auth);
    expect(res.status).toBe(200);
    const { examenes } = (await res.json()) as {
      examenes: { exam_id: string; token_id: string; paginas_subidas: number[] }[];
    };
    const examen = examenes.find((e) => e.exam_id === examId);
    expect(examen?.token_id).toBe(token.id);
    expect(examen?.paginas_subidas.sort()).toEqual([1, 2]);
  });
});

describe("GET /api/admin/examenes-papel/:exam_id", () => {
  it("404 si no existe", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/examenes-papel/NO-EXISTE", {}, auth);
    expect(res.status).toBe(404);
  });

  it("devuelve el detalle con sus páginas", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id })) },
      auth
    );

    const res = await fetchAdmin(`/api/admin/examenes-papel/${examId}`, {}, auth);
    expect(res.status).toBe(200);
    const detalle = (await res.json()) as { exam_id: string; paginas: { pagina: number }[] };
    expect(detalle.exam_id).toBe(examId);
    expect(detalle.paginas).toHaveLength(1);
  });
});

describe("DELETE /api/admin/examenes-papel/:exam_id/paginas/:pagina", () => {
  it("borra solo esa página", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id, pagina: 1 })) },
      auth
    );
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id, pagina: 2 })) },
      auth
    );

    const res = await fetchAdmin(`/api/admin/examenes-papel/${examId}/paginas/1`, { method: "DELETE" }, auth);
    expect(res.status).toBe(200);

    const restantes = await env.DB.prepare("SELECT pagina FROM examenes_papel_paginas WHERE exam_id = ?")
      .bind(examId)
      .all<{ pagina: number }>();
    expect(restantes.results.map((r) => r.pagina)).toEqual([2]);
  });
});

describe("DELETE /api/admin/examenes-papel/:exam_id", () => {
  it("borra el examen entero y todas sus páginas", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id })) },
      auth
    );

    const res = await fetchAdmin(`/api/admin/examenes-papel/${examId}`, { method: "DELETE" }, auth);
    expect(res.status).toBe(200);

    const examen = await env.DB.prepare("SELECT 1 FROM examenes_papel WHERE exam_id = ?").bind(examId).first();
    expect(examen).toBeNull();
    const paginas = await env.DB.prepare("SELECT 1 FROM examenes_papel_paginas WHERE exam_id = ?")
      .bind(examId)
      .first();
    expect(paginas).toBeNull();
  });
});

describe("Finalizar un examen (POST /api/admin/digitalizacion con examen_id)", () => {
  it("marca examenes_papel.sesion_id al crear la sesión desde ese examen", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const examId = examIdUnico();
    await fetchAdmin(
      "/api/admin/examenes-papel/paginas",
      { method: "POST", body: JSON.stringify(paginaValida(examId, { token_id: token.id })) },
      auth
    );

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          examen_id: examId,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: {
            anio_nacimiento: 1994,
            sexo: "Mujer",
            ccaa_educacion_secundaria: "Andalucía",
            nivel_estudios: "Grado o licenciatura",
            area_estudios: "Ciencias sociales y jurídicas",
            estudios_mayor_progenitor: "Bachillerato",
            libros_en_casa: "26-100",
          },
          respuestas: {},
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
    const { sesion_id } = (await res.json()) as { sesion_id: string };

    const examen = await env.DB.prepare("SELECT sesion_id FROM examenes_papel WHERE exam_id = ?")
      .bind(examId)
      .first<{ sesion_id: string | null }>();
    expect(examen?.sesion_id).toBe(sesion_id);
  });
});
