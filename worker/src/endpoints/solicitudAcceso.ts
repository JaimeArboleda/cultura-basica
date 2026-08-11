import { crearSolicitudAcceso } from "../db";
import { error, ipDeRequest, json } from "../http";
import { permitir } from "../ratelimit";
import type { Env } from "../tipos";

const CONTACTO_MAX = 200;
const MOTIVO_MAX = 500;

// Formulario "no tienes acceso al test" (issue #2): guarda un dato de contacto
// que la propia persona decide dar voluntariamente para pedir un token. No
// forma parte del dataset anónimo del estudio (README §5); solo lo ve el panel
// de admin. Reutiliza el mismo rate limit por IP que POST /api/sesion para
// evitar envíos automatizados.
export async function postSolicitudAcceso(request: Request, env: Env): Promise<Response> {
  const ip = ipDeRequest(request);
  if (!(await permitir(env, ip))) {
    return error(env, 429, "Demasiadas peticiones, inténtalo de nuevo en un minuto");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const contacto = typeof b.contacto === "string" ? b.contacto.trim() : "";
  const motivo = typeof b.motivo === "string" ? b.motivo.trim().slice(0, MOTIVO_MAX) : null;
  if (!contacto || contacto.length > CONTACTO_MAX) {
    return error(env, 400, "Indica un modo de contacto válido");
  }

  await crearSolicitudAcceso(env, { contacto, motivo, creadaEn: new Date().toISOString() });
  return json(env, { ok: true }, 201);
}
