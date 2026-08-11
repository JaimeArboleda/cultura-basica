import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { firmarSesionAdmin } from "../src/adminAuth";
import { bancoItems } from "../src/items";
import { AREA_ESTUDIOS, CCAA, LIBROS_EN_CASA, NIVEL_ESTUDIOS, SEXO } from "../src/tipos";

const ADMIN_EMAIL = "admin@example.com";

function demografiaValida() {
  return {
    anio_nacimiento: 1990,
    sexo: SEXO[0],
    ccaa_educacion_secundaria: CCAA[0],
    nivel_estudios: NIVEL_ESTUDIOS[4],
    area_estudios: AREA_ESTUDIOS[2],
    estudios_mayor_progenitor: NIVEL_ESTUDIOS[3],
    libros_en_casa: LIBROS_EN_CASA[2],
  };
}

// El panel se autentica con `Authorization: Bearer <token firmado>`, no con
// cookie (worker/src/adminAuth.ts): Pages y el Worker viven en dominios
// distintos a efectos de cookies.
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

async function crearTokenViaAdmin(auth: string, descripcion = "familia de Gerardo") {
  const res = await fetchAdmin("/api/admin/tokens", { method: "POST", body: JSON.stringify({ descripcion }) }, auth);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function crearSesionConToken(tokenId: string) {
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

beforeEach(async () => {
  await sembrarAdmin();
});

describe("Autenticación del panel de admin", () => {
  it("401 en rutas protegidas sin token de sesión", async () => {
    const res = await fetchAdmin("/api/admin/tokens");
    expect(res.status).toBe(401);
  });

  it("401 con un token firmado pero cuyo email ya no está en admins", async () => {
    const auth = await tokenAdmin("ya-no-es-admin@example.com");
    const res = await fetchAdmin("/api/admin/tokens", {}, auth);
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/me devuelve el email autenticado", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/me", {}, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: ADMIN_EMAIL });
  });
});

describe("Gestión de tokens", () => {
  it("crea, lista y revoca un token", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    expect(token.id).toBeTruthy();

    const listado = await fetchAdmin("/api/admin/tokens", {}, auth);
    const { tokens } = (await listado.json()) as { tokens: { id: string; n_sesiones: number }[] };
    expect(tokens.some((t) => t.id === token.id)).toBe(true);

    const revocar = await fetchAdmin(`/api/admin/tokens/${token.id}`, { method: "DELETE" }, auth);
    expect(revocar.status).toBe(200);

    // Revocado = caducado de inmediato: ya no sirve para crear una sesión nueva.
    const intento = await fetchAdmin("/api/sesion", {
      method: "POST",
      body: JSON.stringify({
        token: token.id,
        consentimiento: true,
        compromiso_honestidad: true,
        user_agent_clase: "escritorio",
        demografia: demografiaValida(),
      }),
    });
    expect(intento.status).toBe(403);
  });

  it("rechaza crear un token sin descripción", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/tokens", { method: "POST", body: JSON.stringify({}) }, auth);
    expect(res.status).toBe(400);
  });

  it("permite fijar horas_validez dentro de rango (2h-10 días) y rechaza fuera de rango", async () => {
    const auth = await tokenAdmin();

    const valido = await fetchAdmin(
      "/api/admin/tokens",
      { method: "POST", body: JSON.stringify({ descripcion: "corto", horas_validez: 3 }) },
      auth
    );
    expect(valido.status).toBe(201);

    const muyCorto = await fetchAdmin(
      "/api/admin/tokens",
      { method: "POST", body: JSON.stringify({ descripcion: "x", horas_validez: 1 }) },
      auth
    );
    expect(muyCorto.status).toBe(400);

    const muyLargo = await fetchAdmin(
      "/api/admin/tokens",
      { method: "POST", body: JSON.stringify({ descripcion: "x", horas_validez: 241 }) },
      auth
    );
    expect(muyLargo.status).toBe(400);
  });
});

describe("Sesiones: borrado individual y por remesa", () => {
  it("borra una sesión individual y libera al usuario para repetir el test con el mismo token", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id } = await crearSesionConToken(token.id);

    const borrado = await fetchAdmin(`/api/admin/sesiones/${sesion_id}`, { method: "DELETE" }, auth);
    expect(borrado.status).toBe(200);

    const resultado = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    expect(resultado.status).toBe(404);

    const repite = await crearSesionConToken(token.id);
    expect(repite.sesion_id).not.toBe(sesion_id);
  });

  it("borra todas las sesiones de una remesa (token) sin revocar el token", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const s1 = await crearSesionConToken(token.id);
    const s2 = await crearSesionConToken(token.id);

    const borrado = await fetchAdmin(`/api/admin/tokens/${token.id}/sesiones`, { method: "DELETE" }, auth);
    expect(borrado.status).toBe(200);

    expect((await SELF.fetch(`http://worker.test/api/resultado/${s1.sesion_id}`)).status).toBe(404);
    expect((await SELF.fetch(`http://worker.test/api/resultado/${s2.sesion_id}`)).status).toBe(404);

    // El token sigue vivo: se puede seguir creando sesiones con él.
    const nueva = await crearSesionConToken(token.id);
    expect(nueva.sesion_id).toBeTruthy();
  });

  it("lista sesiones filtrando por token y por estado", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    await crearSesionConToken(token.id);

    const res = await fetchAdmin(`/api/admin/sesiones?token_id=${token.id}&estado=en_progreso`, {}, auth);
    const { sesiones } = (await res.json()) as { sesiones: { token_id: string; completo: number }[] };
    expect(sesiones.length).toBeGreaterThan(0);
    for (const s of sesiones) {
      expect(s.token_id).toBe(token.id);
      expect(s.completo).toBe(0);
    }
  });

  it("papelera: borra el token entero junto con sus sesiones, sin dejar rastro", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id } = await crearSesionConToken(token.id);

    const borrado = await fetchAdmin(`/api/admin/tokens/${token.id}/completo`, { method: "DELETE" }, auth);
    expect(borrado.status).toBe(200);

    expect((await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`)).status).toBe(404);

    // El token ya no existe: ni siquiera sirve para el mensaje de "caducado".
    const listado = await fetchAdmin("/api/admin/tokens", {}, auth);
    const { tokens } = (await listado.json()) as { tokens: { id: string }[] };
    expect(tokens.some((t) => t.id === token.id)).toBe(false);

    const intento = await fetchAdmin("/api/sesion", {
      method: "POST",
      body: JSON.stringify({
        token: token.id,
        consentimiento: true,
        compromiso_honestidad: true,
        user_agent_clase: "escritorio",
        demografia: demografiaValida(),
      }),
    });
    expect(intento.status).toBe(403);
  });
});

describe("Estadísticas", () => {
  it("incluye el objetivo del piloto y agregados por token", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    await crearSesionConToken(token.id);

    const res = await fetchAdmin(`/api/admin/stats?token_id=${token.id}`, {}, auth);
    const stats = (await res.json()) as { total: number; objetivo_min: number; objetivo_max: number };
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.objetivo_min).toBe(100);
    expect(stats.objetivo_max).toBe(150);
  });
});

describe("Dataset para la consola de estadísticas avanzadas", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/dataset");
    expect(res.status).toBe(401);
  });

  it("devuelve sesiones, respuestas y tokens, filtrable por token_id", async () => {
    const auth = await tokenAdmin();
    const token = await crearTokenViaAdmin(auth);
    const { sesion_id, items } = await crearSesionConToken(token.id);
    const itemPublico = items.find((i) => i.formato === "opcion_multiple")!;
    const itemReal = bancoItems.find((i) => i.id === itemPublico.id)!;
    await SELF.fetch("http://worker.test/api/respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sesion_id,
        item_id: itemReal.id,
        respuesta: itemReal.indice_correcto,
        t_ms: 1000,
        perdio_foco: false,
      }),
    });

    const res = await fetchAdmin(`/api/admin/dataset?token_id=${token.id}`, {}, auth);
    expect(res.status).toBe(200);
    const dataset = (await res.json()) as {
      sesiones: { id: string; token_id: string | null }[];
      respuestas: { sesion_id: string; item_id: string; acierto: number | null }[];
      tokens: { id: string; descripcion: string }[];
    };

    expect(dataset.sesiones.some((s) => s.id === sesion_id && s.token_id === token.id)).toBe(true);
    expect(dataset.respuestas.some((r) => r.sesion_id === sesion_id && r.item_id === itemReal.id)).toBe(true);
    expect(dataset.tokens.some((t) => t.id === token.id && t.descripcion === "familia de Gerardo")).toBe(true);

    // Sin token_id: incluye sesiones de otras remesas también.
    const otroToken = await crearTokenViaAdmin(auth, "otra remesa");
    await crearSesionConToken(otroToken.id);
    const sinFiltro = await fetchAdmin("/api/admin/dataset", {}, auth);
    const datasetCompleto = (await sinFiltro.json()) as { sesiones: { token_id: string | null }[] };
    expect(datasetCompleto.sesiones.some((s) => s.token_id === otroToken.id)).toBe(true);
    expect(datasetCompleto.sesiones.some((s) => s.token_id === token.id)).toBe(true);
  });

  it("no incluye solicitudes de acceso (no forman parte del dataset anónimo)", async () => {
    await SELF.fetch("http://worker.test/api/solicitud-acceso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacto: "alguien@example.com" }),
    });
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/dataset", {}, auth);
    const cuerpo = (await res.json()) as Record<string, unknown>;
    expect(cuerpo).not.toHaveProperty("solicitudes");
  });
});

describe("Solicitudes de acceso", () => {
  it("lista y marca como atendida una solicitud", async () => {
    await SELF.fetch("http://worker.test/api/solicitud-acceso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacto: "amigo@example.com" }),
    });

    const auth = await tokenAdmin();
    const listado = await fetchAdmin("/api/admin/solicitudes", {}, auth);
    const { solicitudes } = (await listado.json()) as { solicitudes: { id: number; atendida: number }[] };
    const solicitud = solicitudes.find((s) => s.atendida === 0);
    expect(solicitud).toBeTruthy();

    const marcar = await fetchAdmin(`/api/admin/solicitudes/${solicitud!.id}`, { method: "PATCH" }, auth);
    expect(marcar.status).toBe(200);
  });

  it("borra una solicitud", async () => {
    await SELF.fetch("http://worker.test/api/solicitud-acceso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacto: "para-borrar@example.com" }),
    });

    const auth = await tokenAdmin();
    const listado = await fetchAdmin("/api/admin/solicitudes", {}, auth);
    const { solicitudes } = (await listado.json()) as { solicitudes: { id: number; contacto: string }[] };
    const solicitud = solicitudes.find((s) => s.contacto === "para-borrar@example.com");
    expect(solicitud).toBeTruthy();

    const borrado = await fetchAdmin(`/api/admin/solicitudes/${solicitud!.id}`, { method: "DELETE" }, auth);
    expect(borrado.status).toBe(200);

    const listadoTras = await fetchAdmin("/api/admin/solicitudes", {}, auth);
    const { solicitudes: solicitudesTras } = (await listadoTras.json()) as { solicitudes: { id: number }[] };
    expect(solicitudesTras.some((s) => s.id === solicitud!.id)).toBe(false);
  });
});

describe("Gestión de administradores", () => {
  it("añade un admin nuevo y lo lista", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin(
      "/api/admin/admins",
      { method: "POST", body: JSON.stringify({ email: "nuevo@example.com" }) },
      auth
    );
    expect(res.status).toBe(201);

    const listado = await fetchAdmin("/api/admin/admins", {}, auth);
    const { admins } = (await listado.json()) as { admins: { email: string }[] };
    expect(admins.some((a) => a.email === "nuevo@example.com")).toBe(true);
  });

  it("no permite quitar al último administrador", async () => {
    // Aísla esta prueba: deja la tabla admins con un único email conocido.
    await env.DB.prepare("DELETE FROM admins").run();
    await sembrarAdmin("unico@example.com");
    const auth = await tokenAdmin("unico@example.com");

    const res = await fetchAdmin("/api/admin/admins/unico@example.com", { method: "DELETE" }, auth);
    expect(res.status).toBe(400);
  });
});
