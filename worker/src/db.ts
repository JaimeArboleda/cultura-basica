// Acceso a D1. Sin lógica de negocio: cada función es una operación de lectura o
// escritura directa sobre el esquema de schema/schema.sql.
import type { AsignacionItem } from "./sorteo";
import type { Demografia, Env, Fase } from "./tipos";

export interface FilaSesion {
  id: string;
  creada_en: string;
  consentimiento: number;
  compromiso_honestidad: number;
  completo_corto: number;
  acepto_extension: number | null;
  completo_largo: number;
}

export async function crearSesion(
  env: Env,
  args: {
    id: string;
    creadaEn: string;
    demografia: Demografia;
    userAgentClase: "movil" | "escritorio";
    asignacionesCorto: AsignacionItem[];
  }
): Promise<void> {
  const { id, creadaEn, demografia: d, userAgentClase, asignacionesCorto } = args;

  const insertSesion = env.DB.prepare(
    `INSERT INTO sesiones (
       id, creada_en, consentimiento, compromiso_honestidad, user_agent_clase,
       anio_nacimiento, sexo, pais_nacimiento, ccaa_nacimiento, ccaa_residencia,
       nivel_estudios, area_estudios, profesion, estudios_padre, estudios_madre,
       libros_en_casa, frecuencia_lectura, consumo_informativos, horas_redes_dia
     ) VALUES (?,?,1,1,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?)`
  ).bind(
    id,
    creadaEn,
    userAgentClase,
    d.anio_nacimiento,
    d.sexo,
    d.pais_nacimiento,
    d.ccaa_nacimiento,
    d.ccaa_residencia,
    d.nivel_estudios,
    d.area_estudios,
    d.profesion,
    d.estudios_padre,
    d.estudios_madre,
    d.libros_en_casa,
    d.frecuencia_lectura,
    d.consumo_informativos,
    d.horas_redes_dia
  );

  const insertsItems = asignacionesCorto.map((a) =>
    env.DB.prepare(
      `INSERT INTO sesion_items (sesion_id, item_id, fase, orden_presentacion) VALUES (?,?,?,?)`
    ).bind(id, a.item_id, a.fase, a.orden_presentacion)
  );

  await env.DB.batch([insertSesion, ...insertsItems]);
}

export async function obtenerSesion(env: Env, sesionId: string): Promise<FilaSesion | null> {
  const fila = await env.DB.prepare("SELECT * FROM sesiones WHERE id = ?")
    .bind(sesionId)
    .first<FilaSesion>();
  return fila ?? null;
}

export async function obtenerSorteo(
  env: Env,
  sesionId: string,
  fase: Fase
): Promise<{ item_id: string; orden_presentacion: number }[]> {
  const { results } = await env.DB.prepare(
    "SELECT item_id, orden_presentacion FROM sesion_items WHERE sesion_id = ? AND fase = ? ORDER BY orden_presentacion"
  )
    .bind(sesionId, fase)
    .all<{ item_id: string; orden_presentacion: number }>();
  return results;
}

export async function insertarSorteoExtension(
  env: Env,
  sesionId: string,
  asignaciones: AsignacionItem[]
): Promise<void> {
  const inserts = asignaciones.map((a) =>
    env.DB.prepare(
      `INSERT INTO sesion_items (sesion_id, item_id, fase, orden_presentacion) VALUES (?,?,?,?)`
    ).bind(sesionId, a.item_id, a.fase, a.orden_presentacion)
  );
  await env.DB.batch(inserts);
}

export async function marcarExtension(env: Env, sesionId: string, acepta: boolean): Promise<void> {
  await env.DB.prepare("UPDATE sesiones SET acepto_extension = ?, actualizada_en = ? WHERE id = ?")
    .bind(acepta ? 1 : 0, new Date().toISOString(), sesionId)
    .run();
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

export async function contarRespuestasFase(env: Env, sesionId: string, fase: Fase): Promise<number> {
  const fila = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM respuestas r
     JOIN sesion_items si ON si.sesion_id = r.sesion_id AND si.item_id = r.item_id
     WHERE r.sesion_id = ? AND si.fase = ?`
  )
    .bind(sesionId, fase)
    .first<{ n: number }>();
  return fila?.n ?? 0;
}

export async function marcarCompletoCorto(env: Env, sesionId: string): Promise<void> {
  await env.DB.prepare("UPDATE sesiones SET completo_corto = 1, actualizada_en = ? WHERE id = ?")
    .bind(new Date().toISOString(), sesionId)
    .run();
}

export async function marcarCompletoLargo(env: Env, sesionId: string): Promise<void> {
  await env.DB.prepare("UPDATE sesiones SET completo_largo = 1, actualizada_en = ? WHERE id = ?")
    .bind(new Date().toISOString(), sesionId)
    .run();
}

export interface FilaResultado {
  item_id: string;
  bloque: string;
  dificultad_declarada: string; // se recalcula con el banco real en el endpoint
  acierto: number;
  fase: Fase;
}

export async function obtenerRespuestasParaResultado(
  env: Env,
  sesionId: string
): Promise<{ item_id: string; acierto: number; fase: Fase }[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.item_id AS item_id, r.acierto AS acierto, si.fase AS fase
     FROM respuestas r
     JOIN sesion_items si ON si.sesion_id = r.sesion_id AND si.item_id = r.item_id
     WHERE r.sesion_id = ?`
  )
    .bind(sesionId)
    .all<{ item_id: string; acierto: number; fase: Fase }>();
  return results;
}

export async function obtenerAsignacion(
  env: Env,
  sesionId: string,
  itemId: string
): Promise<{ fase: Fase; orden_presentacion: number } | null> {
  const fila = await env.DB.prepare(
    "SELECT fase, orden_presentacion FROM sesion_items WHERE sesion_id = ? AND item_id = ? LIMIT 1"
  )
    .bind(sesionId, itemId)
    .first<{ fase: Fase; orden_presentacion: number }>();
  return fila ?? null;
}
