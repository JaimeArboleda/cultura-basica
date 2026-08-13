// Enrutador de /api/admin/* (issue #2): centraliza aquí la exigencia de sesión
// de admin válida para no repetirla en cada endpoint. Las rutas de
// autenticación (login/callback/me) son la única excepción, porque son las
// que establecen esa sesión. No hay endpoint de logout: el token de sesión es
// stateless (nada que invalidar en el servidor), así que "salir" es un simple
// borrado en el propio navegador (public/admin/admin.js).
import { leerTokenAutorizacion, verificarSesionAdmin } from "./adminAuth";
import { deleteAdmin, getAdmins, postAdmins } from "./endpoints/admin/admins";
import { getAdminCallback, getAdminLogin, getAdminYo } from "./endpoints/admin/auth";
import { getDataset } from "./endpoints/admin/dataset";
import { getItemsImpresion, postDigitalizacion } from "./endpoints/admin/digitalizacion";
import { deleteSesion, getSesionDetalle, getSesiones, putSesionEdicion } from "./endpoints/admin/sesiones";
import { deleteSolicitud, getSolicitudes, patchSolicitud } from "./endpoints/admin/solicitudes";
import { getStats } from "./endpoints/admin/stats";
import { deleteToken, deleteTokenCompleto, deleteTokenSesiones, getTokens, postTokens } from "./endpoints/admin/tokens";
import { esAdmin } from "./db";
import { error } from "./http";
import type { Env } from "./tipos";

export async function manejarRutaAdmin(request: Request, env: Env, pathname: string): Promise<Response> {
  const method = request.method;

  if (method === "GET" && pathname === "/api/admin/auth/login") return getAdminLogin(request, env);
  if (method === "GET" && pathname === "/api/admin/auth/callback") return getAdminCallback(request, env);
  if (method === "GET" && pathname === "/api/admin/me") return getAdminYo(request, env);

  const token = leerTokenAutorizacion(request);
  const email = token ? await verificarSesionAdmin(env, token) : null;
  if (!email || !(await esAdmin(env, email))) {
    return error(env, 401, "No autenticado");
  }

  if (method === "GET" && pathname === "/api/admin/tokens") return getTokens(env);
  if (method === "POST" && pathname === "/api/admin/tokens") return postTokens(request, env, email);

  const mTokenSesiones = pathname.match(/^\/api\/admin\/tokens\/([^/]+)\/sesiones$/);
  if (method === "DELETE" && mTokenSesiones) return deleteTokenSesiones(env, decodeURIComponent(mTokenSesiones[1]));

  // Papelera (distinta de la revocación de más abajo): borra el token entero
  // más todas sus sesiones/respuestas, sin dejar rastro.
  const mTokenCompleto = pathname.match(/^\/api\/admin\/tokens\/([^/]+)\/completo$/);
  if (method === "DELETE" && mTokenCompleto) return deleteTokenCompleto(env, decodeURIComponent(mTokenCompleto[1]));

  const mToken = pathname.match(/^\/api\/admin\/tokens\/([^/]+)$/);
  if (method === "DELETE" && mToken) return deleteToken(env, decodeURIComponent(mToken[1]));

  if (method === "GET" && pathname === "/api/admin/sesiones") return getSesiones(request, env);

  const mSesion = pathname.match(/^\/api\/admin\/sesiones\/([^/]+)$/);
  if (method === "DELETE" && mSesion) return deleteSesion(env, decodeURIComponent(mSesion[1]));
  // Edición de demografía/respuestas de una sesión ya existente, cualquiera
  // que sea su origen (README §4.8).
  if (method === "GET" && mSesion) return getSesionDetalle(env, decodeURIComponent(mSesion[1]));
  if (method === "PUT" && mSesion) return putSesionEdicion(request, env, decodeURIComponent(mSesion[1]));

  if (method === "GET" && pathname === "/api/admin/stats") return getStats(request, env);

  if (method === "GET" && pathname === "/api/admin/dataset") return getDataset(request, env);

  // Digitalización de tests en papel (README §4.7).
  if (method === "GET" && pathname === "/api/admin/items-impresion") return getItemsImpresion(env);
  if (method === "POST" && pathname === "/api/admin/digitalizacion") return postDigitalizacion(request, env);

  if (method === "GET" && pathname === "/api/admin/solicitudes") return getSolicitudes(env);

  const mSolicitud = pathname.match(/^\/api\/admin\/solicitudes\/(\d+)$/);
  if (method === "PATCH" && mSolicitud) return patchSolicitud(env, Number(mSolicitud[1]));
  if (method === "DELETE" && mSolicitud) return deleteSolicitud(env, Number(mSolicitud[1]));

  if (method === "GET" && pathname === "/api/admin/admins") return getAdmins(env);
  if (method === "POST" && pathname === "/api/admin/admins") return postAdmins(request, env, email);

  const mAdmin = pathname.match(/^\/api\/admin\/admins\/([^/]+)$/);
  if (method === "DELETE" && mAdmin) return deleteAdmin(env, decodeURIComponent(mAdmin[1]));

  return error(env, 404, "No encontrado");
}
