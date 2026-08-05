import { crearSesion } from "../db";
import { error, ipDeRequest, json } from "../http";
import { bancoItems, paraCliente } from "../items";
import { permitir } from "../ratelimit";
import { ordenarTest } from "../sorteo";
import type { Env } from "../tipos";
import { validarDemografia } from "../validacion";

export async function postSesion(request: Request, env: Env): Promise<Response> {
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

  if (b.consentimiento !== true || b.compromiso_honestidad !== true) {
    return error(env, 400, "Se requiere consentimiento y compromiso de honestidad");
  }
  if (b.user_agent_clase !== "movil" && b.user_agent_clase !== "escritorio") {
    return error(env, 400, "user_agent_clase inválido");
  }
  const demografia = validarDemografia(b.demografia);
  if (!demografia) {
    return error(env, 400, "Demografía inválida o incompleta");
  }

  const id = crypto.randomUUID();
  const asignaciones = ordenarTest(bancoItems);

  await crearSesion(env, {
    id,
    creadaEn: new Date().toISOString(),
    demografia,
    userAgentClase: b.user_agent_clase,
    asignaciones,
  });

  const itemsPorId = new Map(bancoItems.map((i) => [i.id, i]));
  const items = asignaciones.map((a) => paraCliente(itemsPorId.get(a.item_id)!));

  return json(env, { sesion_id: id, items }, 201);
}
