import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { firmarSesionAdmin } from "../src/adminAuth";
import { bancoItems } from "../src/items";
import { AREA_ESTUDIOS, CCAA, LIBROS_EN_CASA, NIVEL_ESTUDIOS, SEXO } from "../src/tipos";

const ADMIN_EMAIL = "admin@example.com";

function demografiaValida(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    anio_nacimiento: 1990,
    sexo: SEXO[0],
    ccaa_educacion_secundaria: CCAA[0],
    nivel_estudios: NIVEL_ESTUDIOS[4],
    area_estudios: AREA_ESTUDIOS[2],
    estudios_mayor_progenitor: NIVEL_ESTUDIOS[3],
    libros_en_casa: LIBROS_EN_CASA[2],
    ...overrides,
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

async function crearTokenViaAdmin(auth: string, descripcion = "remesa de test") {
  const res = await fetchAdmin("/api/admin/tokens", { method: "POST", body: JSON.stringify({ descripcion }) }, auth);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function crearSesionWebConToken(tokenId: string) {
  const res = await fetchAdmin("/api/sesion", {
    method: "POST",
    body: JSON.stringify({
      token: tokenId,
      consentimiento: true,
      compromiso_honestidad: true,
      user_agent_clase: "escritorio",
      demografia: demografiaValida(),
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { sesion_id: string; items: { id: string; formato: string }[] };
}

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

async function crearSesionPapelViaDigitalizacion(auth: string, tokenId: string) {
  const res = await fetchAdmin(
    "/api/admin/digitalizacion",
    {
      method: "POST",
      body: JSON.stringify({
        token_id: tokenId,
        consentimiento: true,
        compromiso_honestidad: true,
        demografia: demografiaValida(),
        respuestas: todasLasRespuestasCorrectas(),
      }),
    },
    auth
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { sesion_id: string };
}

beforeEach(async () => {
  await sembrarAdmin();
});

describe("GET /api/admin/sesiones/:id (detalle para edición)", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/sesiones/no-existe");
    expect(res.status).toBe(401);
  });

  it("404 para una sesión inexistente", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/sesiones/no-existe", {}, auth);
    expect(res.status).toBe(404);
  });

  it("devuelve sesión + los 25 ítems (sin respuesta correcta) + respuestas ya dadas, para una sesión web", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id, items } = await crearSesionWebConToken(token.id);
    const itemPublico = items.find((i) => i.formato === "opcion_multiple")!;
    const itemReal = bancoItems.find((i) => i.id === itemPublico.id)!;
    await SELF.fetch("http://worker.test/api/respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sesion_id, item_id: itemReal.id, respuesta: itemReal.indice_correcto, t_ms: 500, perdio_foco: false }),
    });

    const res = await fetchAdmin(`/api/admin/sesiones/${sesion_id}`, {}, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sesion: { id: string; origen: string; token_id: string };
      items: { id: string; formato: string }[];
      respuestas: Record<string, unknown>;
    };
    expect(body.sesion.id).toBe(sesion_id);
    expect(body.sesion.origen).toBe("web");
    expect(body.items.length).toBe(bancoItems.length);
    for (const item of body.items) {
      expect(item).not.toHaveProperty("indice_correcto");
      expect(item).not.toHaveProperty("respuesta_canonica");
    }
    expect(body.respuestas[itemReal.id]).toBe(itemReal.indice_correcto);
  });

  it("también funciona para una sesión origen='papel'", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id } = await crearSesionPapelViaDigitalizacion(auth, token.id);

    const res = await fetchAdmin(`/api/admin/sesiones/${sesion_id}`, {}, auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sesion: { origen: string }; respuestas: Record<string, unknown> };
    expect(body.sesion.origen).toBe("papel");
    expect(Object.keys(body.respuestas).length).toBe(bancoItems.length);
  });
});

describe("PUT /api/admin/sesiones/:id (edición)", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/sesiones/no-existe", { method: "PUT", body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it("404 para una sesión inexistente", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin(
      "/api/admin/sesiones/no-existe",
      { method: "PUT", body: JSON.stringify({ demografia: demografiaValida(), respuestas: {} }) },
      auth
    );
    expect(res.status).toBe(404);
  });

  it("corrige la demografía y una respuesta de una sesión web ya completa, recalculando la puntuación", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id, items } = await crearSesionWebConToken(token.id);

    // Completa el test entero fallando todo (opcion_multiple con índice desplazado, resto vacío).
    for (const itemPublico of items) {
      const real = bancoItems.find((i) => i.id === itemPublico.id)!;
      const respuesta =
        real.formato === "opcion_multiple"
          ? (real.indice_correcto! + 1) % 6
          : real.formato === "seleccion_multiple"
            ? []
            : real.formato === "ordenar"
              ? [...real.elementos!].reverse()
              : real.formato === "clasificar"
                ? {}
                : "";
      await SELF.fetch("http://worker.test/api/respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sesion_id, item_id: real.id, respuesta, t_ms: 500, perdio_foco: false }),
      });
    }

    const antes = await env.DB.prepare("SELECT completo, puntuacion_total FROM sesiones WHERE id = ?")
      .bind(sesion_id)
      .first<{ completo: number; puntuacion_total: number }>();
    expect(antes?.completo).toBe(1);

    // Edita: pone TODAS las respuestas correctas + cambia la demografía.
    const nuevaDemografia = demografiaValida({ sexo: SEXO[1], anio_nacimiento: 1975 });
    const res = await fetchAdmin(
      `/api/admin/sesiones/${sesion_id}`,
      {
        method: "PUT",
        body: JSON.stringify({ demografia: nuevaDemografia, respuestas: todasLasRespuestasCorrectas() }),
      },
      auth
    );
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { ok: boolean; completo: boolean; puntuacion_total: number };
    expect(cuerpo.completo).toBe(true);
    expect(cuerpo.puntuacion_total).toBeCloseTo(bancoItems.length, 5);

    const despues = await env.DB.prepare(
      "SELECT completo, puntuacion_total, sexo, anio_nacimiento FROM sesiones WHERE id = ?"
    )
      .bind(sesion_id)
      .first<{ completo: number; puntuacion_total: number; sexo: string; anio_nacimiento: number }>();
    expect(despues?.completo).toBe(1);
    expect(despues?.puntuacion_total).toBeCloseTo(bancoItems.length, 5);
    expect(despues?.sexo).toBe(SEXO[1]);
    expect(despues?.anio_nacimiento).toBe(1975);
  });

  it("dejar un ítem fuera de 'respuestas' borra esa respuesta y puede devolver la sesión a en_progreso", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id } = await crearSesionPapelViaDigitalizacion(auth, token.id);

    const respuestasIncompletas = todasLasRespuestasCorrectas();
    const idAQuitar = bancoItems[0].id;
    delete respuestasIncompletas[idAQuitar];

    const res = await fetchAdmin(
      `/api/admin/sesiones/${sesion_id}`,
      { method: "PUT", body: JSON.stringify({ demografia: demografiaValida(), respuestas: respuestasIncompletas }) },
      auth
    );
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { completo: boolean; puntuacion_total: number | null };
    expect(cuerpo.completo).toBe(false);
    expect(cuerpo.puntuacion_total).toBeNull();

    const fila = await env.DB.prepare("SELECT completo, puntuacion_total FROM sesiones WHERE id = ?")
      .bind(sesion_id)
      .first<{ completo: number; puntuacion_total: number | null }>();
    expect(fila?.completo).toBe(0);
    expect(fila?.puntuacion_total).toBeNull();

    const filaRespuesta = await env.DB.prepare("SELECT COUNT(*) AS n FROM respuestas WHERE sesion_id = ? AND item_id = ?")
      .bind(sesion_id, idAQuitar)
      .first<{ n: number }>();
    expect(filaRespuesta?.n).toBe(0);
  });

  it("rechaza demografía inválida", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id } = await crearSesionWebConToken(token.id);

    const res = await fetchAdmin(
      `/api/admin/sesiones/${sesion_id}`,
      { method: "PUT", body: JSON.stringify({ demografia: { ...demografiaValida(), sexo: "invalido" }, respuestas: {} }) },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("no cambia el origen ni el token_id de la sesión al editarla", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id } = await crearSesionPapelViaDigitalizacion(auth, token.id);

    await fetchAdmin(
      `/api/admin/sesiones/${sesion_id}`,
      { method: "PUT", body: JSON.stringify({ demografia: demografiaValida(), respuestas: {} }) },
      auth
    );

    const fila = await env.DB.prepare("SELECT origen, token_id FROM sesiones WHERE id = ?")
      .bind(sesion_id)
      .first<{ origen: string; token_id: string }>();
    expect(fila?.origen).toBe("papel");
    expect(fila?.token_id).toBe(token.id);
  });
});
