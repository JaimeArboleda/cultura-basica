import { insertarSorteoExtension, marcarExtension, obtenerSesion, obtenerSorteo } from "../db";
import { error, json } from "../http";
import { bancoItems, paraCliente } from "../items";
import { sortearExtension } from "../sorteo";
import type { Env } from "../tipos";

export async function postExtender(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const sesionId = b.sesion_id;
  if (typeof sesionId !== "string" || typeof b.acepta !== "boolean") {
    return error(env, 400, "sesion_id y acepta son obligatorios");
  }

  const sesion = await obtenerSesion(env, sesionId);
  if (!sesion) return error(env, 404, "Sesión no encontrada");
  if (sesion.completo_corto === 0) {
    return error(env, 400, "El modo corto todavía no se ha completado");
  }

  // Idempotencia: si ya hay sorteo de extensión persistido, no se resortea.
  const sorteoExistente = await obtenerSorteo(env, sesionId, "extension");
  if (sorteoExistente.length > 0) {
    const itemsPorId = new Map(bancoItems.map((i) => [i.id, i]));
    const items = sorteoExistente.map((a) => paraCliente(itemsPorId.get(a.item_id)!));
    return json(env, { items });
  }

  if (!b.acepta) {
    await marcarExtension(env, sesionId, false);
    return json(env, { items: [] });
  }

  const sorteoCorto = await obtenerSorteo(env, sesionId, "corto");
  const idsUsados = new Set(sorteoCorto.map((a) => a.item_id));
  const asignacionesExtension = sortearExtension(bancoItems, idsUsados);

  await marcarExtension(env, sesionId, true);
  await insertarSorteoExtension(env, sesionId, asignacionesExtension);

  const itemsPorId = new Map(bancoItems.map((i) => [i.id, i]));
  const items = asignacionesExtension.map((a) => paraCliente(itemsPorId.get(a.item_id)!));
  return json(env, { items });
}
