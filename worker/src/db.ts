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

// Fila completa de "sesiones", para las vistas del panel de admin (README §4.5):
// a diferencia de FilaSesion (uso interno del flujo del test), expone también
// token_id y la demografía, para poder listar/filtrar/analizar desde el panel.
export interface FilaSesionAdmin {
  id: string;
  creada_en: string;
  actualizada_en: string | null;
  completo: number;
  puntuacion_total: number | null;
  user_agent_clase: string | null;
  token_id: string | null;
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
    userAgentClase: "movil" | "escritorio";
    asignaciones: AsignacionItem[];
    tokenId: string;
  }
): Promise<void> {
  const { id, creadaEn, demografia: d, userAgentClase, asignaciones, tokenId } = args;

  const insertSesion = env.DB.prepare(
    `INSERT INTO sesiones (
       id, creada_en, consentimiento, compromiso_honestidad, user_agent_clase, token_id,
       anio_nacimiento, sexo, ccaa_educacion_secundaria,
       nivel_estudios, area_estudios, estudios_mayor_progenitor, libros_en_casa
     ) VALUES (?,?,1,1,?,?, ?,?,?, ?,?,?,?)`
  ).bind(
    id,
    creadaEn,
    userAgentClase,
    tokenId,
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
    `SELECT id, creada_en, actualizada_en, completo, puntuacion_total, user_agent_clase, token_id,
            anio_nacimiento, sexo, ccaa_educacion_secundaria, nivel_estudios, area_estudios,
            estudios_mayor_progenitor, libros_en_casa
     FROM sesiones ${where} ORDER BY creada_en DESC`
  )
    .bind(...binds)
    .all<FilaSesionAdmin>();
  return results;
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
  const where = tokenId ? "WHERE token_id = ?" : "";
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
}

export interface FilaTokenConConteo extends FilaToken {
  n_sesiones: number;
  n_completas: number;
}

export async function crearToken(
  env: Env,
  args: { id: string; descripcion: string; creadoPor: string; creadoEn: string; expiraEn: string }
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO tokens (id, descripcion, creado_por, creado_en, expira_en) VALUES (?,?,?,?,?)"
  )
    .bind(args.id, args.descripcion, args.creadoPor, args.creadoEn, args.expiraEn)
    .run();
}

export async function obtenerToken(env: Env, id: string): Promise<FilaToken | null> {
  const fila = await env.DB.prepare("SELECT * FROM tokens WHERE id = ?").bind(id).first<FilaToken>();
  return fila ?? null;
}

export async function listarTokens(env: Env): Promise<FilaTokenConConteo[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.descripcion, t.creado_por, t.creado_en, t.expira_en,
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
export async function revocarToken(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE tokens SET expira_en = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
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
