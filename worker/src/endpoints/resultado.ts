import { obtenerAsignaciones, obtenerPuntuacionesCompletadas, obtenerRespuestasParaResultado, obtenerSesion } from "../db";
import { error, json } from "../http";
import { itemsPorId, paraCliente } from "../items";
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

  // La puntuación ponderada en bruto (worker/src/puntuacion.ts) nunca se expone al
  // cliente: solo sirve como métrica interna para calcular el percentil, que es la
  // única cifra que se enseña al terminar el test.
  const otras = await obtenerPuntuacionesCompletadas(env, sesionId);
  const puntuacion = sesion.puntuacion_ponderada ?? 0;

  return json(env, {
    estado: "completo",
    resultado:
      otras.length === 0
        ? { primera: true }
        : { primera: false, percentil: calcularPercentil(puntuacion, otras) },
  });
}
