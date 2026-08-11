// Acceso a D1. Sin lógica de negocio: cada función es una operación de lectura o
// escritura directa sobre el esquema de schema/schema.sql.
import type { AsignacionItem } from "./sorteo";
import type { Demografia, Env } from "./tipos";

export interface FilaSesion {
  id: string;
  creada_en: string;
  consentimiento: number;
  compromiso_honestidad: number;
  completo: number;
  puntuacion_total: number | null;
}

export async function crearSesion(
  env: Env,
  args: {
    id: string;
    creadaEn: string;
    demografia: Demografia;
    userAgentClase: "movil" | "escritorio";
    asignaciones: AsignacionItem[];
  }
): Promise<void> {
  const { id, creadaEn, demografia: d, userAgentClase, asignaciones } = args;

  const insertSesion = env.DB.prepare(
    `INSERT INTO sesiones (
       id, creada_en, consentimiento, compromiso_honestidad, user_agent_clase,
       anio_nacimiento, sexo, ccaa_educacion_secundaria,
       nivel_estudios, area_estudios, estudios_mayor_progenitor, libros_en_casa
     ) VALUES (?,?,1,1,?, ?,?,?, ?,?,?,?)`
  ).bind(
    id,
    creadaEn,
    userAgentClase,
    d.anio_nacimiento,
    d.sexo,
    d.ccaa_educacion_secundaria,
    d.nivel_estudios,
    d.area_estudios,
    d.estudios_mayor_progenitor,
    d.libros_en_casa
  );

  const insertsItems = asignaciones.map((a) =>
    env.DB.prepare(
      `INSERT INTO sesion_items (sesion_id, item_id, orden_presentacion) VALUES (?,?,?)`
    ).bind(id, a.item_id, a.orden_presentacion)
  );

  await env.DB.batch([insertSesion, ...insertsItems]);
}

export async function obtenerSesion(env: Env, sesionId: string): Promise<FilaSesion | null> {
  const fila = await env.DB.prepare("SELECT * FROM sesiones WHERE id = ?")
    .bind(sesionId)
    .first<FilaSesion>();
  return fila ?? null;
}

export async function obtenerAsignaciones(
  env: Env,
  sesionId: string
): Promise<{ item_id: string; orden_presentacion: number }[]> {
  const { results } = await env.DB.prepare(
    "SELECT item_id, orden_presentacion FROM sesion_items WHERE sesion_id = ? ORDER BY orden_presentacion"
  )
    .bind(sesionId)
    .all<{ item_id: string; orden_presentacion: number }>();
  return results;
}

export interface RespuestaInput {
  sesionId: string;
  itemId: string;
  respuestaCruda: string; // ya serializada con JSON.stringify por el endpoint
  opcionElegida: number | null;
  acierto: 0 | 1;
  estadoCorreccion: string;
  tMs: number | null;
  ordenPresentacion: number;
  perdioFoco: boolean;
  enviadaEn: string;
}

export async function upsertRespuesta(env: Env, r: RespuestaInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO respuestas (
       sesion_id, item_id, respuesta_cruda, opcion_elegida, acierto,
       estado_correccion, t_ms, orden_presentacion, perdio_foco, enviada_en
     ) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(sesion_id, item_id) DO UPDATE SET
       respuesta_cruda = excluded.respuesta_cruda,
       opcion_elegida = excluded.opcion_elegida,
       acierto = excluded.acierto,
       estado_correccion = excluded.estado_correccion,
       t_ms = excluded.t_ms,
       orden_presentacion = excluded.orden_presentacion,
       perdio_foco = excluded.perdio_foco,
       enviada_en = excluded.enviada_en`
  )
    .bind(
      r.sesionId,
      r.itemId,
      r.respuestaCruda,
      r.opcionElegida,
      r.acierto,
      r.estadoCorreccion,
      r.tMs,
      r.ordenPresentacion,
      r.perdioFoco ? 1 : 0,
      r.enviadaEn
    )
    .run();
}

export async function contarRespuestas(env: Env, sesionId: string): Promise<number> {
  const fila = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM respuestas WHERE sesion_id = ?`
  )
    .bind(sesionId)
    .first<{ n: number }>();
  return fila?.n ?? 0;
}

export async function marcarCompleto(
  env: Env,
  sesionId: string,
  puntuacionTotal: number
): Promise<void> {
  await env.DB.prepare(
    "UPDATE sesiones SET completo = 1, actualizada_en = ?, puntuacion_total = ? WHERE id = ?"
  )
    .bind(new Date().toISOString(), puntuacionTotal, sesionId)
    .run();
}

// Puntuaciones de otras sesiones ya completadas, para el percentil empírico del
// resultado (README §3): no asume ninguna distribución, solo compara contra los
// datos reales que haya en ese momento.
export async function obtenerPuntuacionesCompletadas(
  env: Env,
  excluirSesionId: string
): Promise<number[]> {
  const { results } = await env.DB.prepare(
    "SELECT puntuacion_total AS p FROM sesiones WHERE completo = 1 AND id != ? AND puntuacion_total IS NOT NULL"
  )
    .bind(excluirSesionId)
    .all<{ p: number }>();
  return results.map((r) => r.p);
}

export async function obtenerRespuestasParaResultado(
  env: Env,
  sesionId: string
): Promise<{ item_id: string; respuesta_cruda: string | null }[]> {
  const { results } = await env.DB.prepare(
    `SELECT item_id, respuesta_cruda FROM respuestas WHERE sesion_id = ?`
  )
    .bind(sesionId)
    .all<{ item_id: string; respuesta_cruda: string | null }>();
  return results;
}

// Para la pantalla "ver respuestas" (README §3): la respuesta cruda tal cual la
// mandó el cliente, en el orden en que se presentaron las preguntas.
export async function obtenerRespuestasParaRevision(
  env: Env,
  sesionId: string
): Promise<{ item_id: string; respuesta_cruda: string | null; acierto: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT item_id, respuesta_cruda, acierto FROM respuestas WHERE sesion_id = ? ORDER BY orden_presentacion`
  )
    .bind(sesionId)
    .all<{ item_id: string; respuesta_cruda: string | null; acierto: number }>();
  return results;
}

export async function obtenerAsignacion(
  env: Env,
  sesionId: string,
  itemId: string
): Promise<{ orden_presentacion: number } | null> {
  const fila = await env.DB.prepare(
    "SELECT orden_presentacion FROM sesion_items WHERE sesion_id = ? AND item_id = ? LIMIT 1"
  )
    .bind(sesionId, itemId)
    .first<{ orden_presentacion: number }>();
  return fila ?? null;
}
