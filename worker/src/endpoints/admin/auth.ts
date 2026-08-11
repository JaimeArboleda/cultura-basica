import {
  cookieState,
  cookieStateBorrada,
  firmarSesionAdmin,
  intercambiarCodigoPorEmail,
  leerCookieState,
  leerTokenAutorizacion,
  redirectUriDesde,
  urlAutorizacionGoogle,
  verificarSesionAdmin,
} from "../../adminAuth";
import { esAdmin } from "../../db";
import { error, json } from "../../http";
import type { Env } from "../../tipos";

export function getAdminLogin(request: Request, env: Env): Response {
  const state = crypto.randomUUID();
  const headers = new Headers();
  headers.append("Set-Cookie", cookieState(env, state));
  headers.set("Location", urlAutorizacionGoogle(env, state, redirectUriDesde(request)));
  return new Response(null, { status: 302, headers });
}

// Ante cualquier fallo, se redirige de vuelta a /admin/?error=... en vez de
// devolver el JSON de error crudo: quien llega aquí es un navegador real tras
// el redirect de Google, no un cliente de API (admin.js lee ese parámetro
// para mostrar un mensaje legible en la pantalla de login).
function redirigirConError(env: Env, motivo: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${env.ALLOWED_ORIGIN}/admin/?error=${motivo}` } });
}

export async function getAdminCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateEsperado = leerCookieState(request);

  if (!code || !state || !stateEsperado || state !== stateEsperado) {
    return redirigirConError(env, "state");
  }

  const email = await intercambiarCodigoPorEmail(env, code, redirectUriDesde(request));
  if (!email) {
    return redirigirConError(env, "google");
  }
  if (!(await esAdmin(env, email))) {
    return redirigirConError(env, "no_autorizado");
  }

  // El token de sesión viaja en el fragmento (#token=...) de la URL de
  // redirección, no en la query string: el fragmento nunca sale del
  // navegador en la petición HTTP (no llega a logs de servidor ni de CDN), y
  // admin.js lo retira de la barra de direcciones nada más leerlo.
  const tokenSesion = await firmarSesionAdmin(env, email);
  const headers = new Headers();
  headers.append("Set-Cookie", cookieStateBorrada(env));
  headers.set("Location", `${env.ALLOWED_ORIGIN}/admin/#token=${encodeURIComponent(tokenSesion)}`);
  return new Response(null, { status: 302, headers });
}

export async function getAdminYo(request: Request, env: Env): Promise<Response> {
  const token = leerTokenAutorizacion(request);
  const email = token ? await verificarSesionAdmin(env, token) : null;
  if (!email) return error(env, 401, "No autenticado");
  return json(env, { email });
}
