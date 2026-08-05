import { obtenerAsignaciones, obtenerRespuestasParaResultado, obtenerSesion } from "../db";
import { error, json } from "../http";
import { itemsPorId, paraCliente } from "../items";
import type { Env } from "../tipos";

interface Agregado {
  aciertos: number;
  total: number;
}

function agregadoVacio(): Agregado {
  return { aciertos: 0, total: 0 };
}

// Agregados por bloque y por dificultad, SIN sumar entre niveles de dificultad en una
// nota global (README §1.3: "son dos estudios distintos, se reportan por separado").
// Sumar aciertos dentro de un mismo bloque (que mezcla las 3 dificultades) sí es
// razonable para un resumen de "cómo te fue en Historia".
function agregarResultado(respuestas: { item_id: string; acierto: number }[]) {
  const porBloque = new Map<string, Agregado>();
  const porDificultad: Record<"facil" | "medio" | "dificil", Agregado> = {
    facil: agregadoVacio(),
    medio: agregadoVacio(),
    dificil: agregadoVacio(),
  };

  for (const r of respuestas) {
    const item = itemsPorId.get(r.item_id);
    if (!item) continue; // ítem retirado del banco tras el sorteo: se ignora, no rompe el resultado

    const bloque = porBloque.get(item.bloque) ?? agregadoVacio();
    bloque.total += 1;
    bloque.aciertos += r.acierto;
    porBloque.set(item.bloque, bloque);

    porDificultad[item.dificultad].total += 1;
    porDificultad[item.dificultad].aciertos += r.acierto;
  }

  return { por_bloque: Object.fromEntries(porBloque), por_dificultad: porDificultad };
}

export async function getResultado(sesionId: string, env: Env): Promise<Response> {
  const sesion = await obtenerSesion(env, sesionId);
  if (!sesion) return error(env, 404, "Sesión no encontrada");

  if (sesion.completo === 0) {
    const asignaciones = await obtenerAsignaciones(env, sesionId);
    const respondidos = new Set(
      (await obtenerRespuestasParaResultado(env, sesionId)).map((r) => r.item_id)
    );
    const pendientes = asignaciones
      .filter((a) => !respondidos.has(a.item_id))
      .map((a) => paraCliente(itemsPorId.get(a.item_id)!));
    return json(env, { estado: "en_progreso", items_pendientes: pendientes });
  }

  const respuestas = await obtenerRespuestasParaResultado(env, sesionId);

  return json(env, {
    estado: "completo",
    resultado: agregarResultado(respuestas),
  });
}
