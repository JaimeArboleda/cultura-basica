import { borrarSolicitudAcceso, listarSolicitudesAcceso, marcarSolicitudAtendida } from "../../db";
import { json } from "../../http";
import type { Env } from "../../tipos";

export async function getSolicitudes(env: Env): Promise<Response> {
  return json(env, { solicitudes: await listarSolicitudesAcceso(env) });
}

export async function patchSolicitud(env: Env, id: number): Promise<Response> {
  await marcarSolicitudAtendida(env, id);
  return json(env, { ok: true });
}

export async function deleteSolicitud(env: Env, id: number): Promise<Response> {
  await borrarSolicitudAcceso(env, id);
  return json(env, { ok: true });
}
