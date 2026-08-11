import {
  cookieSesion,
  cookieSesionBorrada,
  cookieState,
  cookieStateBorrada,
  firmarSesionAdmin,
  intercambiarCodigoPorEmail,
  leerCookieSesion,
  leerCookieState,
  urlAutorizacionGoogle,
  verificarSesionAdmin,
} from "../../adminAuth";
import { esAdmin } from "../../db";
import { error, json } from "../../http";
import type { Env } from "../../tipos";

export function getAdminLogin(env: Env): Response {
  const state = crypto.randomUUID();
  const headers = new Headers();
  headers.append("Set-Cookie", cookieState(env, state));
  headers.set("Location", urlAutorizacionGoogle(env, state));
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

  const email = await intercambiarCodigoPorEmail(env, code);
  if (!email) {
    return redirigirConError(env, "google");
  }
  if (!(await esAdmin(env, email))) {
    return redirigirConError(env, "no_autorizado");
  }

  const cookieValor = await firmarSesionAdmin(env, email);
  const headers = new Headers();
  headers.append("Set-Cookie", cookieSesion(env, cookieValor));
  headers.append("Set-Cookie", cookieStateBorrada(env));
  headers.set("Location", `${env.ALLOWED_ORIGIN}/admin/`);
  return new Response(null, { status: 302, headers });
}

export function postAdminLogout(env: Env): Response {
  const headers = new Headers();
  headers.append("Set-Cookie", cookieSesionBorrada(env));
  return new Response(null, { status: 204, headers });
}

export async function getAdminYo(request: Request, env: Env): Promise<Response> {
  const cookie = leerCookieSesion(request);
  const email = cookie ? await verificarSesionAdmin(env, cookie) : null;
  if (!email) return error(env, 401, "No autenticado");
  return json(env, { email });
}
