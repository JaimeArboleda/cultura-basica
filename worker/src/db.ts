// Acceso a D1. Sin lógica de negocio: cada función es una operación de lectura o
// escritura directa sobre el esquema de schema/schema.sql.
import { bancoItems, paraDataset } from "./items";
import type { FilaItemDataset } from "./items";
import type { AsignacionItem } from "./sorteo";
import type { Demografia, Env } from "./tipos";

// Condición SQL + bind para excluir las remesas de pruebas (tokens.es_prueba,
// schema/schema.sql) de un agregado SIN filtro explícito de token_id — ver
// obtenerEstadisticas/contarSesionesPorColumna/obtenerDatasetCompleto. El OR
// con IS NULL es necesario porque `NULL NOT IN (subconsulta)` es NULL (no
// verdadero) en SQL, lo que excluiría en silencio las sesiones sin token_id.
const CONDICION_EXCLUIR_PRUEBAS = "(token_id IS NULL OR token_id NOT IN (SELECT id FROM tokens WHERE es_prueba = 1))";

export interface FilaSesion {
  id: string;
  creada_en: string;
  consentimiento: number;
  compromiso_honestidad: number;
  completo: number;
  puntuacion_total: number | null;
}

// Fila completa de "sesiones", para las vistas del panel de admin (README §4.5):
// a diferencia de FilaSesion (uso interno del flujo del test), expone también
// token_id, origen y la demografía, para poder listar/filtrar/analizar desde el panel.
export interface FilaSesionAdmin {
  id: string;
  creada_en: string;
  actualizada_en: string | null;
  completo: number;
  puntuacion_total: number | null;
  user_agent_clase: string | null;
  token_id: string | null;
  // 'web' | 'papel' (README §4.7): de dónde viene esta sesión.
  origen: string;
  // Versión del pipeline de hoja/digitalización (README §4.9, historial de
  // rediseños: 1=OMR, 2=OCR por casillas+Tesseract/IA, 3=OCR-IA sobre PDF
  // generado con pdf-lib); NULL si origen='web'.
  version_papel: number | null;
  anio_nacimiento: number | null;
  sexo: string | null;
  ccaa_educacion_secundaria: string | null;
  nivel_estudios: string | null;
  area_estudios: string | null;
  estudios_mayor_progenitor: string | null;
  libros_en_casa: string | null;
}

export async function crearSesion(
  env: Env,
  args: {
    id: string;
    creadaEn: string;
    demografia: Demografia;
    // null solo para sesiones digitalizadas desde papel (origen='papel', README
    // §4.7): no hay user-agent real que clasificar.
    userAgentClase: "movil" | "escritorio" | null;
    asignaciones: AsignacionItem[];
    tokenId: string;
    // 'web' por defecto (vía DEFAULT de la columna, README §4.7): se omite en
    // todas las llamadas existentes (worker/src/endpoints/sesion.ts).
    origen?: "web" | "papel";
    // Versión del pipeline de hoja/digitalización (README §4.9); solo tiene
    // sentido cuando origen='papel', se ignora (queda NULL) en 'web'.
    versionPapel?: number | null;
    // Id de la hoja física de origen (README §4.10); solo tiene sentido
    // cuando origen='papel', se ignora (queda NULL) en 'web'.
    examenId?: string | null;
  }
): Promise<void> {
  const { id, creadaEn, demografia: d, userAgentClase, asignaciones, tokenId, origen, versionPapel, examenId } = args;

  const insertSesion = env.DB.prepare(
    `INSERT INTO sesiones (
       id, creada_en, consentimiento, compromiso_honestidad, user_agent_clase, token_id, origen, version_papel, examen_id,
       anio_nacimiento, sexo, ccaa_educacion_secundaria,
       nivel_estudios, area_estudios, estudios_mayor_progenitor, libros_en_casa
     ) VALUES (?,?,1,1,?,?,?,?,?, ?,?,?, ?,?,?,?)`
  ).bind(
    id,
    creadaEn,
    userAgentClase,
    tokenId,
    origen ?? "web",
    origen === "papel" ? versionPapel ?? null : null,
    origen === "papel" ? examenId ?? null : null,
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

// Evita digitalizar dos veces la misma hoja física (README §4.10): antes de
// crear una sesión con un examen_id concreto, se comprueba que no exista ya
// una — puede pasar si la misma hoja se digitaliza por el flujo secuencial Y
// por la subida en bloque, o si esta última se "Finaliza" dos veces por
// error de doble clic.
export async function buscarSesionPorExamenId(env: Env, examenId: string): Promise<{ id: string } | null> {
  const fila = await env.DB.prepare("SELECT id FROM sesiones WHERE examen_id = ?")
    .bind(examenId)
    .first<{ id: string }>();
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
  puntuacion: number;
  estadoCorreccion: string;
  tMs: number | null;
  ordenPresentacion: number;
  perdioFoco: boolean;
  enviadaEn: string;
}

export async function upsertRespuesta(env: Env, r: RespuestaInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO respuestas (
       sesion_id, item_id, respuesta_cruda, opcion_elegida, acierto, puntuacion,
       estado_correccion, t_ms, orden_presentacion, perdio_foco, enviada_en
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(sesion_id, item_id) DO UPDATE SET
       respuesta_cruda = excluded.respuesta_cruda,
       opcion_elegida = excluded.opcion_elegida,
       acierto = excluded.acierto,
       puntuacion = excluded.puntuacion,
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
      r.puntuacion,
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

// Borra la respuesta de UN ítem concreto (edición desde el panel de admin,
// README §4.8: dejar un campo en blanco en el formulario de edición borra la
// fila en vez de guardar una respuesta vacía, igual que "nunca se contestó").
export async function borrarRespuestaItem(env: Env, sesionId: string, itemId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM respuestas WHERE sesion_id = ? AND item_id = ?").bind(sesionId, itemId).run();
}

// Estado general tras una edición (README §4.8): a diferencia de marcarCompleto
// (que solo pasa a completa), esto también puede DEVOLVER una sesión a
// en_progreso si la edición deja algún ítem sin respuesta — la edición manual
// reemplaza el conjunto completo de respuestas, así que el estado se recalcula
// entero cada vez en vez de solo poder avanzar.
export async function actualizarEstadoSesion(
  env: Env,
  sesionId: string,
  completo: 0 | 1,
  puntuacionTotal: number | null,
  actualizadaEn: string
): Promise<void> {
  await env.DB.prepare("UPDATE sesiones SET completo = ?, puntuacion_total = ?, actualizada_en = ? WHERE id = ?")
    .bind(completo, puntuacionTotal, actualizadaEn, sesionId)
    .run();
}

// Reemplaza la demografía de una sesión ya creada (edición desde el panel,
// README §4.8): a diferencia de crearSesion, aquí consentimiento y
// compromiso_honestidad NO se tocan — son un hecho histórico del momento en
// que se hizo el test, no un dato demográfico a corregir.
export async function actualizarDemografiaSesion(
  env: Env,
  sesionId: string,
  d: Demografia,
  actualizadaEn: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE sesiones SET
       anio_nacimiento = ?, sexo = ?, ccaa_educacion_secundaria = ?,
       nivel_estudios = ?, area_estudios = ?, estudios_mayor_progenitor = ?, libros_en_casa = ?,
       actualizada_en = ?
     WHERE id = ?`
  )
    .bind(
      d.anio_nacimiento,
      d.sexo,
      d.ccaa_educacion_secundaria,
      d.nivel_estudios,
      d.area_estudios,
      d.estudios_mayor_progenitor,
      d.libros_en_casa,
      actualizadaEn,
      sesionId
    )
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

// --- Panel de admin (README §4.5, issue #2) ---
// A partir de aquí, operaciones exclusivas del panel: gestión de tokens de
// acceso, listado/borrado de sesiones, estadísticas agregadas, solicitudes de
// acceso sin token y gestión de la lista de administradores.

export async function listarSesiones(
  env: Env,
  filtros: { tokenId?: string; estado?: "completo" | "en_progreso" }
): Promise<FilaSesionAdmin[]> {
  const condiciones: string[] = [];
  const binds: unknown[] = [];
  if (filtros.tokenId) {
    condiciones.push("token_id = ?");
    binds.push(filtros.tokenId);
  }
  if (filtros.estado === "completo") condiciones.push("completo = 1");
  if (filtros.estado === "en_progreso") condiciones.push("completo = 0");
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const { results } = await env.DB.prepare(
    `SELECT id, creada_en, actualizada_en, completo, puntuacion_total, user_agent_clase, token_id, origen, version_papel,
            anio_nacimiento, sexo, ccaa_educacion_secundaria, nivel_estudios, area_estudios,
            estudios_mayor_progenitor, libros_en_casa
     FROM sesiones ${where} ORDER BY creada_en DESC`
  )
    .bind(...binds)
    .all<FilaSesionAdmin>();
  return results;
}

// Una sesión concreta con la forma "admin" (con token_id, origen y demografía),
// para la pantalla de edición (README §4.8) — a diferencia de obtenerSesion(),
// que solo expone lo que necesita el flujo público del test.
export async function obtenerSesionAdmin(env: Env, sesionId: string): Promise<FilaSesionAdmin | null> {
  const fila = await env.DB.prepare(
    `SELECT id, creada_en, actualizada_en, completo, puntuacion_total, user_agent_clase, token_id, origen, version_papel,
            anio_nacimiento, sexo, ccaa_educacion_secundaria, nivel_estudios, area_estudios,
            estudios_mayor_progenitor, libros_en_casa
     FROM sesiones WHERE id = ?`
  )
    .bind(sesionId)
    .first<FilaSesionAdmin>();
  return fila ?? null;
}

// Borra una sesión y todo lo que cuelga de ella (respuestas, sorteo de ítems).
// No hay ON DELETE CASCADE en el esquema (README §4.1), así que se hace a mano
// en un batch (D1 lo ejecuta como una única transacción atómica). Tras esto, el
// navegador de esa persona recibirá 404 en GET /api/resultado/:id la próxima
// vez, lo que limpia su localStorage y le permite repetir el test reabriendo
// el enlace original con el token, que sigue vigente (no se revoca aquí).
export async function borrarSesion(env: Env, sesionId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM respuestas WHERE sesion_id = ?").bind(sesionId),
    env.DB.prepare("DELETE FROM sesion_items WHERE sesion_id = ?").bind(sesionId),
    env.DB.prepare("DELETE FROM sesiones WHERE id = ?").bind(sesionId),
  ]);
}

// Igual que borrarSesion pero para todas las sesiones de una remesa (token) a
// la vez. El token en sí no se revoca ni se borra.
export async function borrarSesionesDeToken(env: Env, tokenId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM respuestas WHERE sesion_id IN (SELECT id FROM sesiones WHERE token_id = ?)"
    ).bind(tokenId),
    env.DB.prepare(
      "DELETE FROM sesion_items WHERE sesion_id IN (SELECT id FROM sesiones WHERE token_id = ?)"
    ).bind(tokenId),
    env.DB.prepare("DELETE FROM sesiones WHERE token_id = ?").bind(tokenId),
  ]);
}

// "Papelera" (distinto de borrarSesionesDeToken): borra el token en sí además
// de todas sus sesiones/respuestas. Irreversible — a diferencia de revocar,
// aquí no queda ni rastro del token para volver a usarlo.
export async function borrarTokenCompleto(env: Env, tokenId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM respuestas WHERE sesion_id IN (SELECT id FROM sesiones WHERE token_id = ?)"
    ).bind(tokenId),
    env.DB.prepare(
      "DELETE FROM sesion_items WHERE sesion_id IN (SELECT id FROM sesiones WHERE token_id = ?)"
    ).bind(tokenId),
    env.DB.prepare("DELETE FROM sesiones WHERE token_id = ?").bind(tokenId),
    env.DB.prepare("DELETE FROM tokens WHERE id = ?").bind(tokenId),
  ]);
}

// Fila de "respuestas" para el dataset del panel (§4.5, estadísticas avanzadas):
// una respuesta individual a un ítem, sin datos de sesión (se cruza con
// FilaSesionAdmin por sesion_id desde pandas, no aquí).
export interface FilaRespuestaAdmin {
  sesion_id: string;
  item_id: string;
  respuesta_cruda: string | null;
  opcion_elegida: number | null;
  acierto: number | null;
  puntuacion: number | null;
  estado_correccion: string;
  t_ms: number | null;
  orden_presentacion: number | null;
  perdio_foco: number;
  enviada_en: string;
}

// Dataset completo para la consola de estadísticas avanzadas (§4.5): sesiones,
// respuestas, tokens (solo id+descripción, para poder etiquetar remesas sin
// exponer nada más de la tabla tokens) e items (banco de ítems completo, con
// enunciado y respuesta correcta — para poder cruzar por item_id con
// "respuestas" y analizar en qué ítems/formatos hay más error). Deliberadamente
// NO incluye solicitudes_acceso: esa tabla guarda un dato de contacto
// voluntario y no forma parte del dataset anónimo del estudio (README §5,
// schema/schema.sql).
export interface DatasetCompleto {
  sesiones: FilaSesionAdmin[];
  respuestas: FilaRespuestaAdmin[];
  tokens: { id: string; descripcion: string }[];
  items: FilaItemDataset[];
}

export async function obtenerDatasetCompleto(env: Env, tokenId?: string): Promise<DatasetCompleto> {
  // Sin filtro explícito, se excluyen las remesas de pruebas (tokens.es_prueba)
  // del dataset del piloto — ver contarSesionesPorColumna.
  const condicionSesiones = tokenId ? "WHERE token_id = ?" : `WHERE ${CONDICION_EXCLUIR_PRUEBAS}`;
  const bindsSesiones = tokenId ? [tokenId] : [];
  const condicionRespuestas = tokenId
    ? "WHERE sesion_id IN (SELECT id FROM sesiones WHERE token_id = ?)"
    : `WHERE sesion_id IN (SELECT id FROM sesiones WHERE ${CONDICION_EXCLUIR_PRUEBAS})`;
  const bindsRespuestas = tokenId ? [tokenId] : [];

  const [sesiones, respuestas, tokens] = await Promise.all([
    env.DB.prepare(
      `SELECT id, creada_en, actualizada_en, completo, puntuacion_total, user_agent_clase, token_id, origen, version_papel,
              anio_nacimiento, sexo, ccaa_educacion_secundaria, nivel_estudios, area_estudios,
              estudios_mayor_progenitor, libros_en_casa
       FROM sesiones ${condicionSesiones} ORDER BY creada_en`
    )
      .bind(...bindsSesiones)
      .all<FilaSesionAdmin>(),
    env.DB.prepare(
      `SELECT sesion_id, item_id, respuesta_cruda, opcion_elegida, acierto, puntuacion, estado_correccion, t_ms,
              orden_presentacion, perdio_foco, enviada_en
       FROM respuestas ${condicionRespuestas} ORDER BY sesion_id, orden_presentacion`
    )
      .bind(...bindsRespuestas)
      .all<FilaRespuestaAdmin>(),
    env.DB.prepare("SELECT id, descripcion FROM tokens").all<{ id: string; descripcion: string }>(),
  ]);

  return {
    sesiones: sesiones.results,
    respuestas: respuestas.results,
    tokens: tokens.results,
    items: bancoItems.map(paraDataset),
  };
}

async function contarSesionesPorColumna(
  env: Env,
  columna: string,
  tokenId?: string
): Promise<{ valor: string; n: number }[]> {
  const condiciones = [`${columna} IS NOT NULL`];
  const binds: unknown[] = [];
  if (tokenId) {
    condiciones.push("token_id = ?");
    binds.push(tokenId);
  } else {
    // Sin filtro explícito de remesa, las remesas de pruebas (tokens.es_prueba)
    // no deben contaminar los agregados del piloto — siguen siendo visibles si
    // alguien filtra el panel por ese token a propósito.
    condiciones.push(CONDICION_EXCLUIR_PRUEBAS);
  }
  const { results } = await env.DB.prepare(
    `SELECT ${columna} AS valor, COUNT(*) AS n FROM sesiones WHERE ${condiciones.join(" AND ")} GROUP BY ${columna}`
  )
    .bind(...binds)
    .all<{ valor: string; n: number }>();
  return results;
}

export interface Estadisticas {
  total: number;
  completas: number;
  en_progreso: number;
  por_sexo: { valor: string; n: number }[];
  por_nivel_estudios: { valor: string; n: number }[];
  por_area_estudios: { valor: string; n: number }[];
  por_ccaa: { valor: string; n: number }[];
}

export async function obtenerEstadisticas(env: Env, tokenId?: string): Promise<Estadisticas> {
  // Sin filtro explícito, se excluyen las remesas de pruebas (tokens.es_prueba)
  // de los agregados del piloto — ver contarSesionesPorColumna.
  const where = tokenId ? "WHERE token_id = ?" : `WHERE ${CONDICION_EXCLUIR_PRUEBAS}`;
  const binds = tokenId ? [tokenId] : [];
  const totales = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(completo) AS completas FROM sesiones ${where}`
  )
    .bind(...binds)
    .first<{ total: number; completas: number | null }>();

  const [por_sexo, por_nivel_estudios, por_area_estudios, por_ccaa] = await Promise.all([
    contarSesionesPorColumna(env, "sexo", tokenId),
    contarSesionesPorColumna(env, "nivel_estudios", tokenId),
    contarSesionesPorColumna(env, "area_estudios", tokenId),
    contarSesionesPorColumna(env, "ccaa_educacion_secundaria", tokenId),
  ]);

  const total = totales?.total ?? 0;
  const completas = totales?.completas ?? 0;
  return { total, completas, en_progreso: total - completas, por_sexo, por_nivel_estudios, por_area_estudios, por_ccaa };
}

// --- Tokens de acceso ---

export interface FilaToken {
  id: string;
  descripcion: string;
  creado_por: string;
  creado_en: string;
  expira_en: string;
  es_prueba: number;
  expira_en_antes_de_revocar: string | null;
}

export interface FilaTokenConConteo extends FilaToken {
  n_sesiones: number;
  n_completas: number;
}

export async function crearToken(
  env: Env,
  args: { id: string; descripcion: string; creadoPor: string; creadoEn: string; expiraEn: string; esPrueba?: boolean }
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO tokens (id, descripcion, creado_por, creado_en, expira_en, es_prueba) VALUES (?,?,?,?,?,?)"
  )
    .bind(args.id, args.descripcion, args.creadoPor, args.creadoEn, args.expiraEn, args.esPrueba ? 1 : 0)
    .run();
}

export async function obtenerToken(env: Env, id: string): Promise<FilaToken | null> {
  const fila = await env.DB.prepare("SELECT * FROM tokens WHERE id = ?").bind(id).first<FilaToken>();
  return fila ?? null;
}

export async function listarTokens(env: Env): Promise<FilaTokenConConteo[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.descripcion, t.creado_por, t.creado_en, t.expira_en, t.es_prueba, t.expira_en_antes_de_revocar,
            COUNT(s.id) AS n_sesiones,
            SUM(CASE WHEN s.completo = 1 THEN 1 ELSE 0 END) AS n_completas
     FROM tokens t
     LEFT JOIN sesiones s ON s.token_id = t.id
     GROUP BY t.id
     ORDER BY t.creado_en DESC`
  ).all<FilaTokenConConteo>();
  return results;
}

// "Revocar" un token lo caduca de inmediato; no se borra la fila (queda como
// registro histórico de la remesa) ni las sesiones/respuestas creadas con él.
// Guarda el expira_en de ANTES de revocar en expira_en_antes_de_revocar (leído
// del valor de la propia fila, no de un segundo SELECT: una sola UPDATE en
// SQLite evalúa el lado derecho de todas las asignaciones contra la fila
// ORIGINAL, así que "expira_en_antes_de_revocar = expira_en" captura el valor
// previo aunque expira_en se sobrescriba en la misma sentencia) — es lo que
// permite a rehabilitarToken devolverle esa misma caducidad más adelante.
export async function revocarToken(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE tokens SET expira_en_antes_de_revocar = expira_en, expira_en = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
}

// "Rehabilitar": lo contrario de revocar (README §4.5) — devuelve a
// expira_en el valor que tenía justo antes de la última revocación, y limpia
// expira_en_antes_de_revocar (así una hipotética caducidad natural posterior
// ya no muestra el botón "Rehabilitar": ver comentario del schema). Solo
// tiene efecto si el token fue revocado explícitamente alguna vez — si nunca
// se revocó (caducó solo por el paso del tiempo), no hay una caducidad
// "original" distinta que restaurar, y esta consulta no actualiza nada.
export async function rehabilitarToken(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE tokens SET expira_en = expira_en_antes_de_revocar, expira_en_antes_de_revocar = NULL WHERE id = ? AND expira_en_antes_de_revocar IS NOT NULL"
  )
    .bind(id)
    .run();
}

// --- Subida en bloque de hojas en papel (README §4.10) ---
//
// A diferencia del flujo secuencial de siempre (README §4.7, que solo vive
// en memoria del navegador durante una única visita al panel), aquí cada
// página sube su resultado YA DECODIFICADO (nunca la foto) en cuanto se lee,
// identificada por exam_id (el QR de la propia hoja, no la remesa) y número
// de página — así se puede ir completando una misma hoja física en varias
// visitas, en cualquier orden, y el panel puede listar en cualquier momento
// qué exámenes están a medio subir.

export interface FilaExamenPapel {
  exam_id: string;
  token_id: string;
  version: number;
  creado_en: string;
  sesion_id: string | null;
}

export interface FilaExamenPapelPagina {
  pagina: number;
  marcas_json: string;
  miniatura_datauri: string | null;
  subida_en: string;
}

// Registra una página ya decodificada. Si es la primera página que se ve de
// este exam_id, crea también la fila de examenes_papel (token_id/version
// quedan fijados por la PRIMERA página que llegue; las siguientes no los
// vuelven a tocar, así que da igual que una página posterior traiga el QR
// grande y otra no — solo la primera en llegar decide). Volver a subir la
// MISMA página (mismo exam_id+pagina) sobrescribe lo que hubiera, para poder
// corregir una lectura mala sin tener que borrar nada a mano primero.
export async function upsertPaginaExamen(
  env: Env,
  args: {
    examId: string;
    tokenId: string;
    version: number;
    pagina: number;
    marcasJson: string;
    miniaturaDataUri: string | null;
    subidaEn: string;
  }
): Promise<void> {
  const { examId, tokenId, version, pagina, marcasJson, miniaturaDataUri, subidaEn } = args;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO examenes_papel (exam_id, token_id, version, creado_en) VALUES (?,?,?,?)
       ON CONFLICT(exam_id) DO NOTHING`
    ).bind(examId, tokenId, version, subidaEn),
    env.DB.prepare(
      `INSERT INTO examenes_papel_paginas (exam_id, pagina, marcas_json, miniatura_datauri, subida_en) VALUES (?,?,?,?,?)
       ON CONFLICT(exam_id, pagina) DO UPDATE SET
         marcas_json = excluded.marcas_json,
         miniatura_datauri = excluded.miniatura_datauri,
         subida_en = excluded.subida_en`
    ).bind(examId, pagina, marcasJson, miniaturaDataUri, subidaEn),
  ]);
}

// Listado para la pantalla "exámenes en progreso" (README §4.10): un examen
// por fila, con qué páginas tiene ya subidas (el total esperado lo calcula
// el propio navegador reconstruyendo el layout de esa versión, ver
// subirLote.js — el Worker no sabe nada de maquetación de hoja). Incluye los
// ya finalizados (sesion_id no NULL) para que el panel pueda distinguirlos
// en vez de que simplemente desaparezcan; que se filtren o no es cosa del
// frontend.
export async function listarExamenesPapel(
  env: Env
): Promise<(FilaExamenPapel & { paginas_subidas: number[] })[]> {
  const [{ results: examenes }, { results: paginas }] = await Promise.all([
    env.DB.prepare("SELECT exam_id, token_id, version, creado_en, sesion_id FROM examenes_papel ORDER BY creado_en DESC").all<FilaExamenPapel>(),
    env.DB.prepare("SELECT exam_id, pagina FROM examenes_papel_paginas ORDER BY exam_id, pagina").all<{ exam_id: string; pagina: number }>(),
  ]);
  const paginasPorExamen = new Map<string, number[]>();
  for (const p of paginas) {
    if (!paginasPorExamen.has(p.exam_id)) paginasPorExamen.set(p.exam_id, []);
    paginasPorExamen.get(p.exam_id)!.push(p.pagina);
  }
  return examenes.map((e) => ({ ...e, paginas_subidas: paginasPorExamen.get(e.exam_id) ?? [] }));
}

export async function obtenerExamenPapel(env: Env, examId: string): Promise<FilaExamenPapel | null> {
  const fila = await env.DB.prepare(
    "SELECT exam_id, token_id, version, creado_en, sesion_id FROM examenes_papel WHERE exam_id = ?"
  )
    .bind(examId)
    .first<FilaExamenPapel>();
  return fila ?? null;
}

// Detalle de un examen para la pantalla de confirmación al finalizar
// (README §4.10): todas sus páginas ya decodificadas, en orden.
export async function listarPaginasExamen(env: Env, examId: string): Promise<FilaExamenPapelPagina[]> {
  const { results } = await env.DB.prepare(
    "SELECT pagina, marcas_json, miniatura_datauri, subida_en FROM examenes_papel_paginas WHERE exam_id = ? ORDER BY pagina"
  )
    .bind(examId)
    .all<FilaExamenPapelPagina>();
  return results;
}

// Al finalizar (README §4.10): asocia el examen con la sesión recién creada,
// para no volver a ofrecerlo en el listado de "en progreso" ni permitir
// finalizarlo dos veces.
export async function marcarExamenPapelFinalizado(env: Env, examId: string, sesionId: string): Promise<void> {
  await env.DB.prepare("UPDATE examenes_papel SET sesion_id = ? WHERE exam_id = ?").bind(sesionId, examId).run();
}

// Borra una página suelta (para poder volver a subirla si salió mal, README
// §4.10) o el examen entero (abandonar una hoja que no se va a completar) —
// dos acciones separadas porque borrar el examen entero es más destructivo
// (pierde TODAS sus páginas) y la pantalla lo pide con una confirmación
// aparte.
export async function borrarPaginaExamen(env: Env, examId: string, pagina: number): Promise<void> {
  await env.DB.prepare("DELETE FROM examenes_papel_paginas WHERE exam_id = ? AND pagina = ?").bind(examId, pagina).run();
}

export async function borrarExamenPapel(env: Env, examId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM examenes_papel_paginas WHERE exam_id = ?").bind(examId),
    env.DB.prepare("DELETE FROM examenes_papel WHERE exam_id = ?").bind(examId),
  ]);
}

// --- Solicitudes de acceso sin token ---

export interface FilaSolicitud {
  id: number;
  contacto: string;
  motivo: string | null;
  creada_en: string;
  atendida: number;
}

export async function crearSolicitudAcceso(
  env: Env,
  args: { contacto: string; motivo: string | null; creadaEn: string }
): Promise<void> {
  await env.DB.prepare("INSERT INTO solicitudes_acceso (contacto, motivo, creada_en) VALUES (?,?,?)")
    .bind(args.contacto, args.motivo, args.creadaEn)
    .run();
}

export async function listarSolicitudesAcceso(env: Env): Promise<FilaSolicitud[]> {
  const { results } = await env.DB.prepare("SELECT * FROM solicitudes_acceso ORDER BY creada_en DESC").all<FilaSolicitud>();
  return results;
}

export async function marcarSolicitudAtendida(env: Env, id: number): Promise<void> {
  await env.DB.prepare("UPDATE solicitudes_acceso SET atendida = 1 WHERE id = ?").bind(id).run();
}

export async function borrarSolicitudAcceso(env: Env, id: number): Promise<void> {
  await env.DB.prepare("DELETE FROM solicitudes_acceso WHERE id = ?").bind(id).run();
}

// --- Administradores ---

export interface FilaAdmin {
  email: string;
  anadido_por: string | null;
  anadido_en: string;
}

export async function listarAdmins(env: Env): Promise<FilaAdmin[]> {
  const { results } = await env.DB.prepare("SELECT * FROM admins ORDER BY anadido_en").all<FilaAdmin>();
  return results;
}

export async function esAdmin(env: Env, email: string): Promise<boolean> {
  const fila = await env.DB.prepare("SELECT 1 FROM admins WHERE email = ?").bind(email).first();
  return fila !== null;
}

export async function agregarAdmin(
  env: Env,
  args: { email: string; anadidoPor: string; anadidoEn: string }
): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO admins (email, anadido_por, anadido_en) VALUES (?,?,?)")
    .bind(args.email, args.anadidoPor, args.anadidoEn)
    .run();
}

export async function quitarAdmin(env: Env, email: string): Promise<void> {
  await env.DB.prepare("DELETE FROM admins WHERE email = ?").bind(email).run();
}
