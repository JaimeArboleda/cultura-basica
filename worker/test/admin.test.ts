import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { NOMBRE_COOKIE_SESION, firmarSesionAdmin } from "../src/adminAuth";
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

async function cookieAdmin(email = ADMIN_EMAIL): Promise<string> {
  const valor = await firmarSesionAdmin(env, email);
  return `${NOMBRE_COOKIE_SESION}=${valor}`;
}

async function fetchAdmin(path: string, opciones: RequestInit = {}, cookie?: string) {
  return SELF.fetch(`http://worker.test${path}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...opciones.headers,
    },
  });
}

async function sembrarAdmin(email = ADMIN_EMAIL) {
  await env.DB.prepare("INSERT OR IGNORE INTO admins (email, anadido_por, anadido_en) VALUES (?,?,?)")
    .bind(email, null, new Date().toISOString())
    .run();
}

async function crearTokenViaAdmin(cookie: string, descripcion = "familia de Gerardo") {
  const res = await fetchAdmin("/api/admin/tokens", { method: "POST", body: JSON.stringify({ descripcion }) }, cookie);
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
  return (await res.json()) as { sesion_id: string };
}

beforeEach(async () => {
  await sembrarAdmin();
});

describe("Autenticación del panel de admin", () => {
  it("401 en rutas protegidas sin cookie de sesión", async () => {
    const res = await fetchAdmin("/api/admin/tokens");
    expect(res.status).toBe(401);
  });

  it("401 con una cookie firmada pero cuyo email ya no está en admins", async () => {
    const cookie = await cookieAdmin("ya-no-es-admin@example.com");
    const res = await fetchAdmin("/api/admin/tokens", {}, cookie);
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/me devuelve el email autenticado", async () => {
    const cookie = await cookieAdmin();
    const res = await fetchAdmin("/api/admin/me", {}, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: ADMIN_EMAIL });
  });
});

describe("Gestión de tokens", () => {
  it("crea, lista y revoca un token", async () => {
    const cookie = await cookieAdmin();
    const token = await crearTokenViaAdmin(cookie);
    expect(token.id).toBeTruthy();

    const listado = await fetchAdmin("/api/admin/tokens", {}, cookie);
    const { tokens } = (await listado.json()) as { tokens: { id: string; n_sesiones: number }[] };
    expect(tokens.some((t) => t.id === token.id)).toBe(true);

    const revocar = await fetchAdmin(`/api/admin/tokens/${token.id}`, { method: "DELETE" }, cookie);
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
    const cookie = await cookieAdmin();
    const res = await fetchAdmin("/api/admin/tokens", { method: "POST", body: JSON.stringify({}) }, cookie);
    expect(res.status).toBe(400);
  });

  it("permite fijar horas_validez dentro de rango (2h-10 días) y rechaza fuera de rango", async () => {
    const cookie = await cookieAdmin();

    const valido = await fetchAdmin(
      "/api/admin/tokens",
      { method: "POST", body: JSON.stringify({ descripcion: "corto", horas_validez: 3 }) },
      cookie
    );
    expect(valido.status).toBe(201);

    const muyCorto = await fetchAdmin(
      "/api/admin/tokens",
      { method: "POST", body: JSON.stringify({ descripcion: "x", horas_validez: 1 }) },
      cookie
    );
    expect(muyCorto.status).toBe(400);

    const muyLargo = await fetchAdmin(
      "/api/admin/tokens",
      { method: "POST", body: JSON.stringify({ descripcion: "x", horas_validez: 241 }) },
      cookie
    );
    expect(muyLargo.status).toBe(400);
  });
});

describe("Sesiones: borrado individual y por remesa", () => {
  it("borra una sesión individual y libera al usuario para repetir el test con el mismo token", async () => {
    const cookie = await cookieAdmin();
    const token = await crearTokenViaAdmin(cookie);
    const { sesion_id } = await crearSesionConToken(token.id);

    const borrado = await fetchAdmin(`/api/admin/sesiones/${sesion_id}`, { method: "DELETE" }, cookie);
    expect(borrado.status).toBe(200);

    const resultado = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    expect(resultado.status).toBe(404);

    const repite = await crearSesionConToken(token.id);
    expect(repite.sesion_id).not.toBe(sesion_id);
  });

  it("borra todas las sesiones de una remesa (token) sin revocar el token", async () => {
    const cookie = await cookieAdmin();
    const token = await crearTokenViaAdmin(cookie);
    const s1 = await crearSesionConToken(token.id);
    const s2 = await crearSesionConToken(token.id);

    const borrado = await fetchAdmin(`/api/admin/tokens/${token.id}/sesiones`, { method: "DELETE" }, cookie);
    expect(borrado.status).toBe(200);

    expect((await SELF.fetch(`http://worker.test/api/resultado/${s1.sesion_id}`)).status).toBe(404);
    expect((await SELF.fetch(`http://worker.test/api/resultado/${s2.sesion_id}`)).status).toBe(404);

    // El token sigue vivo: se puede seguir creando sesiones con él.
    const nueva = await crearSesionConToken(token.id);
    expect(nueva.sesion_id).toBeTruthy();
  });

  it("lista sesiones filtrando por token y por estado", async () => {
    const cookie = await cookieAdmin();
    const token = await crearTokenViaAdmin(cookie);
    await crearSesionConToken(token.id);

    const res = await fetchAdmin(`/api/admin/sesiones?token_id=${token.id}&estado=en_progreso`, {}, cookie);
    const { sesiones } = (await res.json()) as { sesiones: { token_id: string; completo: number }[] };
    expect(sesiones.length).toBeGreaterThan(0);
    for (const s of sesiones) {
      expect(s.token_id).toBe(token.id);
      expect(s.completo).toBe(0);
    }
  });
});

describe("Estadísticas", () => {
  it("incluye el objetivo del piloto y agregados por token", async () => {
    const cookie = await cookieAdmin();
    const token = await crearTokenViaAdmin(cookie);
    await crearSesionConToken(token.id);

    const res = await fetchAdmin(`/api/admin/stats?token_id=${token.id}`, {}, cookie);
    const stats = (await res.json()) as { total: number; objetivo_min: number; objetivo_max: number };
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.objetivo_min).toBe(100);
    expect(stats.objetivo_max).toBe(150);
  });
});

describe("Solicitudes de acceso", () => {
  it("lista y marca como atendida una solicitud", async () => {
    await SELF.fetch("http://worker.test/api/solicitud-acceso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacto: "amigo@example.com" }),
    });

    const cookie = await cookieAdmin();
    const listado = await fetchAdmin("/api/admin/solicitudes", {}, cookie);
    const { solicitudes } = (await listado.json()) as { solicitudes: { id: number; atendida: number }[] };
    const solicitud = solicitudes.find((s) => s.atendida === 0);
    expect(solicitud).toBeTruthy();

    const marcar = await fetchAdmin(`/api/admin/solicitudes/${solicitud!.id}`, { method: "PATCH" }, cookie);
    expect(marcar.status).toBe(200);
  });
});

describe("Gestión de administradores", () => {
  it("añade un admin nuevo y lo lista", async () => {
    const cookie = await cookieAdmin();
    const res = await fetchAdmin(
      "/api/admin/admins",
      { method: "POST", body: JSON.stringify({ email: "nuevo@example.com" }) },
      cookie
    );
    expect(res.status).toBe(201);

    const listado = await fetchAdmin("/api/admin/admins", {}, cookie);
    const { admins } = (await listado.json()) as { admins: { email: string }[] };
    expect(admins.some((a) => a.email === "nuevo@example.com")).toBe(true);
  });

  it("no permite quitar al último administrador", async () => {
    // Aísla esta prueba: deja la tabla admins con un único email conocido.
    await env.DB.prepare("DELETE FROM admins").run();
    await sembrarAdmin("unico@example.com");
    const cookie = await cookieAdmin("unico@example.com");

    const res = await fetchAdmin("/api/admin/admins/unico@example.com", { method: "DELETE" }, cookie);
    expect(res.status).toBe(400);
  });
});
