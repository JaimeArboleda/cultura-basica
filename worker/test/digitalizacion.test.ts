import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { firmarSesionAdmin } from "../src/adminAuth";
import { bancoItems } from "../src/items";
import { AREA_ESTUDIOS, CCAA, LIBROS_EN_CASA, NIVEL_ESTUDIOS, SEXO } from "../src/tipos";

const ADMIN_EMAIL = "admin@example.com";

function demografiaValida() {
  return {
    anio_nacimiento: 1958,
    sexo: SEXO[0],
    ccaa_educacion_secundaria: CCAA[0],
    nivel_estudios: NIVEL_ESTUDIOS[4],
    area_estudios: AREA_ESTUDIOS[2],
    estudios_mayor_progenitor: NIVEL_ESTUDIOS[3],
    libros_en_casa: LIBROS_EN_CASA[2],
  };
}

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

// Respuesta correcta de cada ítem, tal cual espera el formato de
// respuesta_cruda de ese ítem (README §4.2/§4.3) -- lo que en teoría
// produciría un pipeline de OMR/OCR perfecto sobre una hoja rellenada con
// todo correcto.
function respuestaCorrectaDe(item: (typeof bancoItems)[number]): unknown {
  switch (item.formato) {
    case "abierto":
      return item.respuesta_canonica;
    case "opcion_multiple":
      return item.indice_correcto;
    case "seleccion_multiple":
      return item.opciones_correctas;
    case "ordenar":
      return item.elementos_ordenados;
    case "clasificar":
      return item.clasificacion_correcta;
  }
}

function todasLasRespuestasCorrectas(): Record<string, unknown> {
  const mapa: Record<string, unknown> = {};
  for (const item of bancoItems) mapa[item.id] = respuestaCorrectaDe(item);
  return mapa;
}

beforeEach(async () => {
  await sembrarAdmin();
});

describe("GET /api/admin/items-impresion", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/items-impresion");
    expect(res.status).toBe(401);
  });

  it("devuelve los 25 ítems en el orden fijo de presentación, sin respuestas correctas", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/items-impresion", {}, auth);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Record<string, unknown>[] };
    expect(items.length).toBe(bancoItems.length);
    for (const item of items) {
      expect(item).not.toHaveProperty("respuesta_canonica");
      expect(item).not.toHaveProperty("indice_correcto");
      expect(item).not.toHaveProperty("opciones_correctas");
      expect(item).not.toHaveProperty("elementos_ordenados");
      expect(item).not.toHaveProperty("clasificacion_correcta");
    }
  });

  it("no sirve ninguna paginación precalculada (el cliente la calcula solo, hoja.js::calcularManifiesto)", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/items-impresion", {}, auth);
    const cuerpo = (await res.json()) as Record<string, unknown>;
    expect(cuerpo).not.toHaveProperty("paginacion");
  });
});

describe("POST /api/admin/digitalizacion", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/digitalizacion", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it("crea una sesión completa con origen='papel', corrige y puntúa igual que el flujo web", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas: todasLasRespuestasCorrectas(),
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
    const { sesion_id } = (await res.json()) as { sesion_id: string };
    expect(sesion_id).toMatch(/^[0-9a-f-]{36}$/);

    const fila = await env.DB.prepare("SELECT * FROM sesiones WHERE id = ?").bind(sesion_id).first<{
      origen: string;
      completo: number;
      puntuacion_total: number;
      token_id: string;
      user_agent_clase: string | null;
      version_papel: number | null;
    }>();
    expect(fila?.origen).toBe("papel");
    expect(fila?.completo).toBe(1);
    expect(fila?.token_id).toBe(token.id);
    expect(fila?.user_agent_clase).toBeNull();
    expect(fila?.puntuacion_total).toBeCloseTo(bancoItems.length, 5);
    // Sin version_papel en el body (hoja de antes de que existiera este
    // campo, o pipeline que no lo manda): se asume la versión actual (3).
    expect(fila?.version_papel).toBe(3);

    const conteoRespuestas = await env.DB.prepare("SELECT COUNT(*) AS n FROM respuestas WHERE sesion_id = ?")
      .bind(sesion_id)
      .first<{ n: number }>();
    expect(conteoRespuestas?.n).toBe(bancoItems.length);

    // Se ve también desde el resultado público, como cualquier otra sesión completa.
    const resultado = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    const cuerpo = (await resultado.json()) as { estado: string };
    expect(cuerpo.estado).toBe("completo");

    // Y aparece marcada como 'papel' en el listado de sesiones del panel.
    const listado = await fetchAdmin(`/api/admin/sesiones?token_id=${token.id}`, {}, auth);
    const { sesiones } = (await listado.json()) as { sesiones: { id: string; origen: string }[] };
    const sesionListada = sesiones.find((s) => s.id === sesion_id);
    expect(sesionListada?.origen).toBe("papel");
  });

  it("guarda la version_papel enviada por el cliente, para poder comparar pipelines en el dataset", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          version_papel: 2,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas: todasLasRespuestasCorrectas(),
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
    const { sesion_id } = (await res.json()) as { sesion_id: string };

    const fila = await env.DB.prepare("SELECT version_papel FROM sesiones WHERE id = ?")
      .bind(sesion_id)
      .first<{ version_papel: number | null }>();
    expect(fila?.version_papel).toBe(2);
  });

  it("deja en blanco (sin fila) un ítem ausente de 'respuestas', y la sesión queda en progreso", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const respuestas = todasLasRespuestasCorrectas();
    const primerId = bancoItems[0].id;
    delete respuestas[primerId];

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas,
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
    const { sesion_id } = (await res.json()) as { sesion_id: string };

    const fila = await env.DB.prepare("SELECT completo FROM sesiones WHERE id = ?")
      .bind(sesion_id)
      .first<{ completo: number }>();
    expect(fila?.completo).toBe(0);

    const filaRespuesta = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM respuestas WHERE sesion_id = ? AND item_id = ?"
    )
      .bind(sesion_id, primerId)
      .first<{ n: number }>();
    expect(filaRespuesta?.n).toBe(0);
  });

  it("rechaza sin token_id", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas: {},
        }),
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("rechaza un token_id que no existe", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: "no-existe",
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas: {},
        }),
      },
      auth
    );
    expect(res.status).toBe(404);
  });

  it("acepta un token ya caducado (a diferencia de POST /api/sesion): la hoja se pudo rellenar antes", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    await fetchAdmin(`/api/admin/tokens/${token.id}`, { method: "DELETE" }, auth); // revocar = caducar ya

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas: todasLasRespuestasCorrectas(),
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
  });

  it("rechaza sin consentimiento o sin compromiso de honestidad marcados", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          consentimiento: true,
          compromiso_honestidad: false,
          demografia: demografiaValida(),
          respuestas: {},
        }),
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("rechaza demografía inválida", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: { ...demografiaValida(), sexo: "invalido" },
          respuestas: {},
        }),
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("guarda examen_id (README §4.10) cuando viene en el body", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          examen_id: "TESTEXAM1",
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          respuestas: todasLasRespuestasCorrectas(),
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
    const { sesion_id } = (await res.json()) as { sesion_id: string };
    const fila = await env.DB.prepare("SELECT examen_id FROM sesiones WHERE id = ?")
      .bind(sesion_id)
      .first<{ examen_id: string | null }>();
    expect(fila?.examen_id).toBe("TESTEXAM1");
  });

  it("digitalizar dos veces la misma hoja física (mismo examen_id) sobrescribe la sesión en vez de rechazar (idempotencia, README §4.10)", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const respuestasCorrectas = todasLasRespuestasCorrectas();
    const itemAbierto = bancoItems.find((i) => i.formato === "abierto")!;
    const body = {
      token_id: token.id,
      examen_id: "TESTEXAM-DUP",
      consentimiento: true,
      compromiso_honestidad: true,
      demografia: demografiaValida(),
      respuestas: respuestasCorrectas,
    };

    const primera = await fetchAdmin("/api/admin/digitalizacion", { method: "POST", body: JSON.stringify(body) }, auth);
    expect(primera.status).toBe(201);
    const { sesion_id: idPrimera } = (await primera.json()) as { sesion_id: string };

    // Re-digitalizar la misma hoja (p. ej. tras corregir la lectura de una
    // página): distinta demografía y una respuesta menos (deja UN ítem en
    // blanco) — debe sobrescribir la MISMA sesión, no crear una nueva ni
    // rechazar con 409.
    const { [itemAbierto.id]: _omitido, ...respuestasSinAbierto } = respuestasCorrectas;
    const segundoBody = {
      ...body,
      demografia: { ...demografiaValida(), anio_nacimiento: 1970 },
      respuestas: respuestasSinAbierto,
    };
    const segunda = await fetchAdmin(
      "/api/admin/digitalizacion",
      { method: "POST", body: JSON.stringify(segundoBody) },
      auth
    );
    expect(segunda.status).toBe(200);
    const { sesion_id: idSegunda } = (await segunda.json()) as { sesion_id: string };
    expect(idSegunda).toBe(idPrimera);

    const fila = await env.DB.prepare("SELECT anio_nacimiento, completo FROM sesiones WHERE id = ?")
      .bind(idPrimera)
      .first<{ anio_nacimiento: number; completo: number }>();
    expect(fila?.anio_nacimiento).toBe(1970);
    expect(fila?.completo).toBe(0); // ya no están las 25 respuestas

    const respuestaAbierto = await env.DB.prepare("SELECT 1 AS x FROM respuestas WHERE sesion_id = ? AND item_id = ?")
      .bind(idPrimera, itemAbierto.id)
      .first();
    expect(respuestaAbierto).toBeNull(); // se borró al no venir en la segunda digitalización
  });

  it("descarta (sin reventar) una respuesta con forma inválida para su formato", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const itemOpcionMultiple = bancoItems.find((i) => i.formato === "opcion_multiple")!;

    const res = await fetchAdmin(
      "/api/admin/digitalizacion",
      {
        method: "POST",
        body: JSON.stringify({
          token_id: token.id,
          consentimiento: true,
          compromiso_honestidad: true,
          demografia: demografiaValida(),
          // string en vez del índice numérico esperado por 'opcion_multiple'
          respuestas: { [itemOpcionMultiple.id]: "no-es-un-indice" },
        }),
      },
      auth
    );
    expect(res.status).toBe(201);
    const { sesion_id } = (await res.json()) as { sesion_id: string };
    const filaRespuesta = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM respuestas WHERE sesion_id = ? AND item_id = ?"
    )
      .bind(sesion_id, itemOpcionMultiple.id)
      .first<{ n: number }>();
    expect(filaRespuesta?.n).toBe(0);
  });
});
