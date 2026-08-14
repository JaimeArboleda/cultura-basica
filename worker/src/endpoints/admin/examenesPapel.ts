// Subida en bloque de hojas en papel (README §4.10): endpoints para que
// public/admin/papel/subirLote.js pueda ir guardando el progreso de cada
// hoja física (identificada por exam_id, leído del QR de cada página) según
// se suben sus páginas, en cualquier orden y posiblemente en varias visitas
// al panel. A diferencia de POST /api/admin/digitalizacion (digitalizacion.ts,
// README §4.7), aquí nunca llega la hoja completa de una vez: cada request
// es UNA página ya decodificada en el navegador (nada de fotos ni de OCR/OMR
// corre en el Worker, igual que el resto de la digitalización).
import {
  borrarExamenPapel,
  borrarPaginaExamen,
  listarExamenesPapel,
  listarPaginasExamen,
  obtenerExamenPapel,
  obtenerToken,
  upsertPaginaExamen,
} from "../../db";
import { error, json } from "../../http";
import type { Env } from "../../tipos";

export async function postExamenPapelPagina(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const examId = typeof b.exam_id === "string" ? b.exam_id : "";
  const tokenId = typeof b.token_id === "string" ? b.token_id : "";
  const version = typeof b.version === "number" ? b.version : NaN;
  const pagina = typeof b.pagina === "number" ? b.pagina : NaN;
  if (!examId || !tokenId || !Number.isInteger(version) || !Number.isInteger(pagina) || pagina < 1) {
    return error(env, 400, "Faltan o son inválidos exam_id, token_id, version o pagina");
  }
  if (typeof b.marcas !== "object" || b.marcas === null) {
    return error(env, 400, "Falta marcas (lo que devuelve leerPagina() en el navegador)");
  }
  const miniatura = typeof b.miniatura === "string" ? b.miniatura : null;

  // No hace falta que el token siga sin caducar (igual que en
  // POST /api/admin/digitalizacion, README §4.7): la hoja se pudo rellenar
  // dentro de su ventana de validez y subirse después.
  const token = await obtenerToken(env, tokenId);
  if (!token) return error(env, 404, "Token no encontrado");

  // Si este exam_id ya existe con otro token_id/version (por ejemplo, una
  // página posterior con el QR grande corrupto que el admin resolvió a mano
  // con datos distintos a los de la primera página), se avisa en vez de
  // dejar que la primera página "gane" en silencio — evita mezclar páginas
  // de dos hojas distintas bajo el mismo exam_id por error humano.
  const existente = await obtenerExamenPapel(env, examId);
  if (existente && (existente.token_id !== tokenId || existente.version !== version)) {
    return error(
      env,
      409,
      `Este exam_id ya tiene páginas subidas con otra remesa/versión (${existente.token_id}, v${existente.version}) — revisa si es la hoja correcta.`
    );
  }

  await upsertPaginaExamen(env, {
    examId,
    tokenId,
    version,
    pagina,
    marcasJson: JSON.stringify(b.marcas),
    miniaturaDataUri: miniatura,
    subidaEn: new Date().toISOString(),
  });

  return json(env, { ok: true }, existente ? 200 : 201);
}

export async function getExamenesPapel(env: Env): Promise<Response> {
  const examenes = await listarExamenesPapel(env);
  return json(env, { examenes });
}

export async function getExamenPapelDetalle(env: Env, examId: string): Promise<Response> {
  const examen = await obtenerExamenPapel(env, examId);
  if (!examen) return error(env, 404, "Examen no encontrado");
  const paginas = await listarPaginasExamen(env, examId);
  return json(env, { ...examen, paginas });
}

export async function deleteExamenPapelPagina(env: Env, examId: string, pagina: number): Promise<Response> {
  await borrarPaginaExamen(env, examId, pagina);
  return json(env, { ok: true });
}

export async function deleteExamenPapel(env: Env, examId: string): Promise<Response> {
  await borrarExamenPapel(env, examId);
  return json(env, { ok: true });
}
