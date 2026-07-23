import { obtenerRespuestasParaResultado, obtenerSesion, obtenerSorteo } from "../db";
import { error, json } from "../http";
import { itemsPorId, paraCliente } from "../items";
import type { Env, Fase } from "../tipos";

interface Agregado {
  aciertos: number;
  total: number;
}

function agregadoVacio(): Agregado {
  return { aciertos: 0, total: 0 };
}

// Agregados por bloque y por dificultad para una fase, SIN sumar entre niveles de
// dificultad en una nota global (README §1.3: "son dos estudios distintos, se
// reportan por separado"). Sumar aciertos dentro de un mismo bloque (que mezcla las 3
// dificultades) sí es razonable para un resumen de "cómo te fue en Historia", y no es
// lo que la regla de §1.3 prohíbe.
function agregarResultado(respuestas: { item_id: string; acierto: number; fase: Fase }[], fase: Fase) {
  const porBloque = new Map<string, Agregado>();
  const porDificultad: Record<"facil" | "medio" | "dificil", Agregado> = {
    facil: agregadoVacio(),
    medio: agregadoVacio(),
    dificil: agregadoVacio(),
  };

  for (const r of respuestas) {
    if (r.fase !== fase) continue;
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

  if (sesion.completo_corto === 0) {
    const sorteoCorto = await obtenerSorteo(env, sesionId, "corto");
    const respondidos = new Set(
      (await obtenerRespuestasParaResultado(env, sesionId)).map((r) => r.item_id)
    );
    const pendientes = sorteoCorto
      .filter((a) => !respondidos.has(a.item_id))
      .map((a) => paraCliente(itemsPorId.get(a.item_id)!));
    return json(env, { estado: "en_progreso", fase_actual: "corto", items_pendientes: pendientes });
  }

  const respuestas = await obtenerRespuestasParaResultado(env, sesionId);

  if (sesion.acepto_extension === 1 && sesion.completo_largo === 0) {
    const sorteoExtension = await obtenerSorteo(env, sesionId, "extension");
    const respondidos = new Set(respuestas.map((r) => r.item_id));
    const pendientes = sorteoExtension
      .filter((a) => !respondidos.has(a.item_id))
      .map((a) => paraCliente(itemsPorId.get(a.item_id)!));
    return json(env, {
      estado: "en_progreso",
      fase_actual: "extension",
      items_pendientes: pendientes,
      resultado_corto: agregarResultado(respuestas, "corto"),
    });
  }

  const resultado: { corto: ReturnType<typeof agregarResultado>; extension?: ReturnType<typeof agregarResultado> } = {
    corto: agregarResultado(respuestas, "corto"),
  };
  if (sesion.completo_largo === 1) {
    resultado.extension = agregarResultado(respuestas, "extension");
  }

  return json(env, {
    estado: sesion.completo_largo === 1 ? "completo_largo" : "completo_corto",
    acepto_extension: sesion.acepto_extension,
    resultado,
  });
}
