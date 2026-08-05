import {
  contarRespuestas,
  marcarCompleto,
  obtenerAsignacion,
  obtenerAsignaciones,
  obtenerSesion,
  upsertRespuesta,
} from "../db";
import {
  corregirAbierto,
  corregirClasificar,
  corregirOpcionMultiple,
  corregirOrdenar,
  type ResultadoCorreccion,
} from "../correccion";
import { error, json } from "../http";
import { obtenerItem } from "../items";
import type { Env, Item } from "../tipos";

function corregir(item: Item, respuesta: unknown): ResultadoCorreccion | null {
  switch (item.formato) {
    case "abierto":
      return typeof respuesta === "string" ? corregirAbierto(item, respuesta) : null;
    case "opcion_multiple":
      return typeof respuesta === "number" ? corregirOpcionMultiple(item, respuesta) : null;
    case "ordenar":
      return Array.isArray(respuesta) ? corregirOrdenar(item, respuesta) : null;
    case "clasificar":
      return typeof respuesta === "object" && respuesta !== null && !Array.isArray(respuesta)
        ? corregirClasificar(item, respuesta as Record<string, string>)
        : null;
  }
}

export async function postRespuesta(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const sesionId = b.sesion_id;
  const itemId = b.item_id;
  if (typeof sesionId !== "string" || typeof itemId !== "string") {
    return error(env, 400, "sesion_id e item_id son obligatorios");
  }

  const sesion = await obtenerSesion(env, sesionId);
  if (!sesion) return error(env, 404, "Sesión no encontrada");

  const asignacion = await obtenerAsignacion(env, sesionId, itemId);
  if (!asignacion) return error(env, 403, "Este ítem no pertenece al sorteo de esta sesión");

  const item = obtenerItem(itemId);
  if (!item) return error(env, 404, "Ítem no encontrado en el banco actual");

  const resultado = corregir(item, b.respuesta);
  if (!resultado) {
    return error(env, 400, `Respuesta con formato inválido para un ítem '${item.formato}'`);
  }

  const tMs = typeof b.t_ms === "number" ? b.t_ms : null;
  const perdioFoco = b.perdio_foco === true;
  const opcionElegida = item.formato === "opcion_multiple" ? (b.respuesta as number) : null;

  await upsertRespuesta(env, {
    sesionId,
    itemId,
    respuestaCruda: JSON.stringify(b.respuesta),
    opcionElegida,
    acierto: resultado.acierto,
    estadoCorreccion: resultado.estado_correccion,
    tMs,
    ordenPresentacion: asignacion.orden_presentacion,
    perdioFoco,
    enviadaEn: new Date().toISOString(),
  });

  if (sesion.completo === 0) {
    const totalAsignados = (await obtenerAsignaciones(env, sesionId)).length;
    const totalRespondidas = await contarRespuestas(env, sesionId);
    if (totalRespondidas >= totalAsignados) {
      await marcarCompleto(env, sesionId);
    }
  }

  return json(env, resultado);
}
