import {
  actualizarDemografiaSesion,
  actualizarEstadoSesion,
  borrarRespuestaItem,
  borrarSesion,
  listarSesiones,
  obtenerAsignaciones,
  obtenerRespuestasParaResultado,
  obtenerRespuestasParaRevision,
  obtenerSesion,
  obtenerSesionAdmin,
  upsertRespuesta,
} from "../../db";
import { corregirRespuesta } from "../../correccion";
import { error, json } from "../../http";
import { itemsPorId, paraCliente } from "../../items";
import { puntuarItem, puntuarSesion } from "../../puntuacion";
import type { Env } from "../../tipos";
import { validarDemografia } from "../../validacion";

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

// --- Edición desde el panel (README §4.8): editar demografía y respuestas de
// CUALQUIER sesión ya existente, sea origen='web' o 'papel' — para el flujo
// web, corregir un dato mal tecleado; para 'papel', la revisión tras
// digitalizar (§4.7). Nunca expone la respuesta correcta (igual que
// paraCliente(), no paraRevision()): lo que se edita es lo que la persona
// escribió de verdad, no lo que "debería" haber puesto.

export async function getSesionDetalle(env: Env, sesionId: string): Promise<Response> {
  const sesion = await obtenerSesionAdmin(env, sesionId);
  if (!sesion) return error(env, 404, "Sesión no encontrada");

  const asignaciones = await obtenerAsignaciones(env, sesionId);
  const items = asignaciones
    .map((a) => itemsPorId.get(a.item_id))
    .filter((item) => item !== undefined)
    .map((item) => paraCliente(item));

  const filasRespuesta = await obtenerRespuestasParaRevision(env, sesionId);
  const respuestas: Record<string, unknown> = {};
  for (const fila of filasRespuesta) {
    if (fila.respuesta_cruda == null) continue;
    try {
      respuestas[fila.item_id] = JSON.parse(fila.respuesta_cruda);
    } catch {
      // respuesta_cruda corrupta o de un formato viejo: se omite en vez de reventar la edición
    }
  }

  return json(env, { sesion, items, respuestas });
}

export async function putSesionEdicion(request: Request, env: Env, sesionId: string): Promise<Response> {
  const sesion = await obtenerSesionAdmin(env, sesionId);
  if (!sesion) return error(env, 404, "Sesión no encontrada");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const demografia = validarDemografia(b.demografia);
  if (!demografia) return error(env, 400, "Demografía inválida o incompleta");

  const respuestasEntrada = b.respuestas;
  if (typeof respuestasEntrada !== "object" || respuestasEntrada === null || Array.isArray(respuestasEntrada)) {
    return error(env, 400, "respuestas debe ser un objeto item_id -> respuesta");
  }
  const mapaRespuestas = respuestasEntrada as Record<string, unknown>;

  const ahora = new Date().toISOString();
  await actualizarDemografiaSesion(env, sesionId, demografia, ahora);

  // Reemplazo completo: el formulario de edición siempre manda el estado
  // entero de los 25 ítems, así que un ítem ausente del mapa significa "se ha
  // dejado en blanco" y borra la fila existente, no que no se toque.
  const asignaciones = await obtenerAsignaciones(env, sesionId);
  const escrituras: Promise<void>[] = [];
  let totalRespondidas = 0;
  for (const a of asignaciones) {
    const item = itemsPorId.get(a.item_id);
    if (!item) continue; // ítem retirado del banco actual: no se puede reeditar

    if (!(a.item_id in mapaRespuestas)) {
      escrituras.push(borrarRespuestaItem(env, sesionId, a.item_id));
      continue;
    }
    const respuesta = mapaRespuestas[a.item_id];
    const resultado = corregirRespuesta(item, respuesta);
    if (!resultado) {
      escrituras.push(borrarRespuestaItem(env, sesionId, a.item_id));
      continue;
    }
    totalRespondidas++;
    escrituras.push(
      upsertRespuesta(env, {
        sesionId,
        itemId: a.item_id,
        respuestaCruda: JSON.stringify(respuesta),
        opcionElegida: item.formato === "opcion_multiple" ? (respuesta as number) : null,
        acierto: resultado.acierto,
        puntuacion: puntuarItem(item, respuesta),
        estadoCorreccion: resultado.estado_correccion,
        tMs: null,
        ordenPresentacion: a.orden_presentacion,
        perdioFoco: false,
        enviadaEn: ahora,
      })
    );
  }
  await Promise.all(escrituras);

  const completo = totalRespondidas >= asignaciones.length ? 1 : 0;
  let puntuacionTotal: number | null = null;
  if (completo) {
    const respuestasParaResultado = await obtenerRespuestasParaResultado(env, sesionId);
    puntuacionTotal = puntuarSesion(respuestasParaResultado, (id) => itemsPorId.get(id));
  }
  await actualizarEstadoSesion(env, sesionId, completo, puntuacionTotal, ahora);

  return json(env, { ok: true, completo: completo === 1, puntuacion_total: puntuacionTotal });
}
