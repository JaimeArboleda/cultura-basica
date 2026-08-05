import { obtenerAsignaciones, obtenerPuntuacionesCompletadas, obtenerRespuestasParaResultado, obtenerSesion } from "../db";
import { error, json } from "../http";
import { bancoItems, itemsPorId, paraCliente } from "../items";
import type { Dificultad, Env } from "../tipos";

export interface ResultadoBloque {
  facil: boolean;
  medio: boolean;
  dificil: boolean;
}

// Agregado por bloque y dificultad: con el banco fijo (12 bloques × 1 ítem por
// dificultad) basta un booleano de acierto por casilla, no hace falta sumar.
function agregarPorBloque(respuestas: { item_id: string; acierto: number }[]): Record<string, ResultadoBloque> {
  const porBloque: Record<string, ResultadoBloque> = {};

  for (const r of respuestas) {
    const item = itemsPorId.get(r.item_id);
    if (!item) continue; // ítem retirado del banco tras el sorteo: se ignora, no rompe el resultado

    const bloque = (porBloque[item.bloque] ??= { facil: false, medio: false, dificil: false });
    bloque[item.dificultad as Dificultad] = r.acierto === 1;
  }

  return porBloque;
}

// Percentil empírico (README §3): % de sesiones ya completadas con una puntuación
// estrictamente menor, más la mitad de las empatadas. No asume ninguna distribución,
// así que no se comporta mal con pocas muestras. Sin ninguna otra sesión completada,
// se asume el percentil 50 (ni por encima ni por debajo de nada).
function calcularPercentil(puntuacion: number, otras: number[]): number {
  if (otras.length === 0) return 50;
  const menores = otras.filter((p) => p < puntuacion).length;
  const iguales = otras.filter((p) => p === puntuacion).length;
  return Math.round(((menores + iguales / 2) / otras.length) * 100);
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
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
  const otras = await obtenerPuntuacionesCompletadas(env, sesionId);
  const puntuacion = sesion.puntuacion_ponderada ?? 0;

  return json(env, {
    estado: "completo",
    resultado: {
      por_bloque: agregarPorBloque(respuestas),
      puntuacion,
      puntuacion_maxima: bancoItems.length,
      percentil: calcularPercentil(puntuacion, otras),
      media: media(otras),
    },
  });
}
