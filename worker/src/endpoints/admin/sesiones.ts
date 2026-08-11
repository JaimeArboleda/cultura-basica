import { borrarSesion, listarSesiones, obtenerSesion } from "../../db";
import { error, json } from "../../http";
import type { Env } from "../../tipos";

export async function getSesiones(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const tokenId = url.searchParams.get("token_id") ?? undefined;
  const estadoParam = url.searchParams.get("estado");
  const estado = estadoParam === "completo" || estadoParam === "en_progreso" ? estadoParam : undefined;
  return json(env, { sesiones: await listarSesiones(env, { tokenId, estado }) });
}

// Borrado individual (README §4.5): la persona podrá repetir el test
// reabriendo su enlace original con el token, que no se toca aquí.
export async function deleteSesion(env: Env, id: string): Promise<Response> {
  const sesion = await obtenerSesion(env, id);
  if (!sesion) return error(env, 404, "Sesión no encontrada");
  await borrarSesion(env, id);
  return json(env, { ok: true });
}
