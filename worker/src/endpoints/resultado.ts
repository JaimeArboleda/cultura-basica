import {
  obtenerAsignaciones,
  obtenerPuntuacionesCompletadas,
  obtenerRespuestasParaResultado,
  obtenerRespuestasParaRevision,
  obtenerSesion,
} from "../db";
import { error, json } from "../http";
import { itemsPorId, paraCliente, paraRevision } from "../items";
import type { Env } from "../tipos";

// Percentil empírico (README §3): % de sesiones ya completadas con una puntuación
// estrictamente menor, más la mitad de las empatadas. No asume ninguna distribución,
// así que no se comporta mal con pocas muestras. Sin ninguna otra sesión completada,
// no hay percentil que calcular (se lo indicamos al cliente con `primera: true`).
function calcularPercentil(puntuacion: number, otras: number[]): number {
  const menores = otras.filter((p) => p < puntuacion).length;
  const iguales = otras.filter((p) => p === puntuacion).length;
  return Math.round(((menores + iguales / 2) / otras.length) * 100);
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

  // Puntuación total (worker/src/puntuacion.ts): suma fraccionaria [0, N] de todos
  // los ítems del banco. Se muestra al usuario como nota global 0-10 (resultado
  // destacado) y alimenta el percentil (dato secundario).
  const otras = await obtenerPuntuacionesCompletadas(env, sesionId);
  const puntuacionTotal = sesion.puntuacion_total ?? 0;
  const totalItems = itemsPorId.size;
  const notaGlobal = Math.round((puntuacionTotal / totalItems) * 10 * 10) / 10;

  // Revisión completa (README §3, pantalla "ver respuestas"): a diferencia del
  // percentil, esto solo se calcula bajo demanda del cliente, no cambia el
  // cálculo de puntuación ni se usa para nada más.
  const respuestas = await obtenerRespuestasParaRevision(env, sesionId);
  const revision = respuestas
    .map((r) => {
      const item = itemsPorId.get(r.item_id);
      return item ? paraRevision(item, r) : null;
    })
    .filter((r) => r !== null);

  return json(env, {
    estado: "completo",
    resultado:
      otras.length === 0
        ? { primera: true, puntuacion_total: puntuacionTotal, nota_global: notaGlobal }
        : {
            primera: false,
            puntuacion_total: puntuacionTotal,
            nota_global: notaGlobal,
            percentil: calcularPercentil(puntuacionTotal, otras),
          },
    revision,
  });
}
