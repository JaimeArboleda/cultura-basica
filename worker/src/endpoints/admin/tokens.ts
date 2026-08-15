import { borrarSesionesDeToken, borrarTokenCompleto, crearToken, listarTokens, obtenerToken, revocarToken } from "../../db";
import { error, json } from "../../http";
import { EXPIRA_EN_INFINITO, type Env } from "../../tipos";

// Validez de un token nuevo, en horas (issue #2: "p. ej. válidos 48h"). Solo se
// impone un mínimo (una invitación puntual no tiene sentido por debajo de esto);
// no hay máximo — quien quiera una remesa sin fecha de corte pide
// `sin_caducidad: true` en vez de un nº de horas enorme (ver EXPIRA_EN_INFINITO,
// tipos.ts).
const HORAS_VALIDEZ_POR_DEFECTO = 48;
const HORAS_VALIDEZ_MIN = 2;

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

  const sinCaducidad = b.sin_caducidad === true;
  const ahora = new Date();
  let expiraEn: string;
  if (sinCaducidad) {
    expiraEn = EXPIRA_EN_INFINITO;
  } else {
    const horas = b.horas_validez === undefined ? HORAS_VALIDEZ_POR_DEFECTO : b.horas_validez;
    if (typeof horas !== "number" || horas < HORAS_VALIDEZ_MIN) {
      return error(env, 400, `horas_validez debe ser un número >= ${HORAS_VALIDEZ_MIN}, o usa sin_caducidad: true`);
    }
    expiraEn = new Date(ahora.getTime() + horas * 60 * 60 * 1000).toISOString();
  }
  const id = crypto.randomUUID();
  // Remesa de pruebas (schema/schema.sql::tokens.es_prueba): el id sigue siendo
  // un UUID igual de impredecible que cualquier otro token, solo cambia que sus
  // sesiones se excluyen de los agregados sin filtro (worker/src/db.ts).
  const esPrueba = b.es_prueba === true;

  await crearToken(env, { id, descripcion, creadoPor, creadoEn: ahora.toISOString(), expiraEn, esPrueba });
  return json(
    env,
    { id, descripcion, creado_por: creadoPor, creado_en: ahora.toISOString(), expira_en: expiraEn, es_prueba: esPrueba ? 1 : 0 },
    201
  );
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
