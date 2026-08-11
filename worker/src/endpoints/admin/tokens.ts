import { borrarSesionesDeToken, borrarTokenCompleto, crearToken, listarTokens, obtenerToken, revocarToken } from "../../db";
import { error, json } from "../../http";
import type { Env } from "../../tipos";

// Validez de un token nuevo, en horas (issue #2: "p. ej. válidos 48h"). Rango
// pensado para poder ajustarlo desde el panel según la remesa: de una
// invitación puntual (mínimo 2h) a una campaña larga (máximo 10 días).
const HORAS_VALIDEZ_POR_DEFECTO = 48;
const HORAS_VALIDEZ_MIN = 2;
const HORAS_VALIDEZ_MAX = 24 * 10;

export async function getTokens(env: Env): Promise<Response> {
  return json(env, { tokens: await listarTokens(env) });
}

export async function postTokens(request: Request, env: Env, creadoPor: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const descripcion = typeof b.descripcion === "string" ? b.descripcion.trim() : "";
  if (!descripcion) {
    return error(env, 400, "La descripción es obligatoria (de dónde viene esta remesa)");
  }

  const horas = b.horas_validez === undefined ? HORAS_VALIDEZ_POR_DEFECTO : b.horas_validez;
  if (typeof horas !== "number" || horas < HORAS_VALIDEZ_MIN || horas > HORAS_VALIDEZ_MAX) {
    return error(
      env,
      400,
      `horas_validez debe estar entre ${HORAS_VALIDEZ_MIN} y ${HORAS_VALIDEZ_MAX} (2h - 10 días)`
    );
  }
  const ahora = new Date();
  const expiraEn = new Date(ahora.getTime() + horas * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();

  await crearToken(env, { id, descripcion, creadoPor, creadoEn: ahora.toISOString(), expiraEn });
  return json(env, { id, descripcion, creado_por: creadoPor, creado_en: ahora.toISOString(), expira_en: expiraEn }, 201);
}

// "Revocar": caduca el token de inmediato (README §4.5). No borra sesiones ni
// respuestas — para eso está deleteTokenSesiones, una acción distinta.
export async function deleteToken(env: Env, id: string): Promise<Response> {
  const token = await obtenerToken(env, id);
  if (!token) return error(env, 404, "Token no encontrado");
  await revocarToken(env, id);
  return json(env, { ok: true });
}

// Borra todas las sesiones (y sus respuestas) creadas con este token, dejando
// el token intacto: quienes lo usaron pueden reabrir el mismo enlace y
// repetir el test mientras el token siga sin caducar.
export async function deleteTokenSesiones(env: Env, id: string): Promise<Response> {
  const token = await obtenerToken(env, id);
  if (!token) return error(env, 404, "Token no encontrado");
  await borrarSesionesDeToken(env, id);
  return json(env, { ok: true });
}

// "Papelera": borra el token y todas sus sesiones/respuestas de forma
// definitiva (a diferencia de deleteToken, que solo revoca). Acción distinta
// y más destructiva, pensada sobre todo para limpiar datos de prueba.
export async function deleteTokenCompleto(env: Env, id: string): Promise<Response> {
  const token = await obtenerToken(env, id);
  if (!token) return error(env, 404, "Token no encontrado");
  await borrarTokenCompleto(env, id);
  return json(env, { ok: true });
}
