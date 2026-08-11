// Enrutador de /api/admin/* (issue #2): centraliza aquí la exigencia de sesión
// de admin válida para no repetirla en cada endpoint. Las rutas de
// autenticación (login/callback/logout/me) son la única excepción, porque son
// las que establecen esa sesión.
import { leerCookieSesion, verificarSesionAdmin } from "./adminAuth";
import { deleteAdmin, getAdmins, postAdmins } from "./endpoints/admin/admins";
import { getAdminCallback, getAdminLogin, getAdminYo, postAdminLogout } from "./endpoints/admin/auth";
import { deleteSesion, getSesiones } from "./endpoints/admin/sesiones";
import { getSolicitudes, patchSolicitud } from "./endpoints/admin/solicitudes";
import { getStats } from "./endpoints/admin/stats";
import { deleteToken, deleteTokenSesiones, getTokens, postTokens } from "./endpoints/admin/tokens";
import { esAdmin } from "./db";
import { error } from "./http";
import type { Env } from "./tipos";

export async function manejarRutaAdmin(request: Request, env: Env, pathname: string): Promise<Response> {
  const method = request.method;

  if (method === "GET" && pathname === "/api/admin/auth/login") return getAdminLogin(env);
  if (method === "GET" && pathname === "/api/admin/auth/callback") return getAdminCallback(request, env);
  if (method === "POST" && pathname === "/api/admin/auth/logout") return postAdminLogout(env);
  if (method === "GET" && pathname === "/api/admin/me") return getAdminYo(request, env);

  const cookie = leerCookieSesion(request);
  const email = cookie ? await verificarSesionAdmin(env, cookie) : null;
  if (!email || !(await esAdmin(env, email))) {
    return error(env, 401, "No autenticado");
  }

  if (method === "GET" && pathname === "/api/admin/tokens") return getTokens(env);
  if (method === "POST" && pathname === "/api/admin/tokens") return postTokens(request, env, email);

  const mTokenSesiones = pathname.match(/^\/api\/admin\/tokens\/([^/]+)\/sesiones$/);
  if (method === "DELETE" && mTokenSesiones) return deleteTokenSesiones(env, decodeURIComponent(mTokenSesiones[1]));

  const mToken = pathname.match(/^\/api\/admin\/tokens\/([^/]+)$/);
  if (method === "DELETE" && mToken) return deleteToken(env, decodeURIComponent(mToken[1]));

  if (method === "GET" && pathname === "/api/admin/sesiones") return getSesiones(request, env);

  const mSesion = pathname.match(/^\/api\/admin\/sesiones\/([^/]+)$/);
  if (method === "DELETE" && mSesion) return deleteSesion(env, decodeURIComponent(mSesion[1]));

  if (method === "GET" && pathname === "/api/admin/stats") return getStats(request, env);

  if (method === "GET" && pathname === "/api/admin/solicitudes") return getSolicitudes(env);

  const mSolicitud = pathname.match(/^\/api\/admin\/solicitudes\/(\d+)$/);
  if (method === "PATCH" && mSolicitud) return patchSolicitud(env, Number(mSolicitud[1]));

  if (method === "GET" && pathname === "/api/admin/admins") return getAdmins(env);
  if (method === "POST" && pathname === "/api/admin/admins") return postAdmins(request, env, email);

  const mAdmin = pathname.match(/^\/api\/admin\/admins\/([^/]+)$/);
  if (method === "DELETE" && mAdmin) return deleteAdmin(env, decodeURIComponent(mAdmin[1]));

  return error(env, 404, "No encontrado");
}
