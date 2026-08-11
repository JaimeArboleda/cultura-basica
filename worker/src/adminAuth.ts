// Autenticación del panel de admin (README §4.5, issue #2): OAuth de Google
// como único medio, sin login propio. La sesión de admin es una cookie
// httpOnly firmada con HMAC-SHA256 (sin dependencias externas, con Web
// Crypto), no un JWT de librería: solo lleva email + expiración, y su validez
// se revalida contra la tabla `admins` en cada petición (revocar un admin
// surte efecto de inmediato, no hay que esperar a que caduque la cookie).
import type { Env } from "./tipos";

export const NOMBRE_COOKIE_SESION = "cb_admin_sesion";
const NOMBRE_COOKIE_STATE = "cb_admin_oauth_state";
const DURACION_SESION_SEG = 7 * 24 * 60 * 60; // 7 días
const DURACION_STATE_SEG = 10 * 60; // 10 minutos: solo dura lo que tarda el login

function base64UrlCodificar(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodificar(s: string): Uint8Array {
  const relleno = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const binario = atob(s.replace(/-/g, "+").replace(/_/g, "/") + relleno);
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

async function claveHmac(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function firmarSesionAdmin(env: Env, email: string): Promise<string> {
  const payload = base64UrlCodificar(
    new TextEncoder().encode(JSON.stringify({ email, exp: Date.now() + DURACION_SESION_SEG * 1000 }))
  );
  const clave = await claveHmac(env.ADMIN_SESSION_SECRET);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlCodificar(new Uint8Array(firma))}`;
}

// Devuelve el email si la cookie es válida (firma correcta y no caducada), o
// null en cualquier otro caso. No comprueba aquí que el email siga en la
// tabla `admins`: eso lo hace cada endpoint protegido, para que revocar un
// admin surta efecto sin esperar a que expire su cookie.
export async function verificarSesionAdmin(env: Env, cookieValue: string): Promise<string | null> {
  const [payload, firma] = cookieValue.split(".");
  if (!payload || !firma) return null;

  const clave = await claveHmac(env.ADMIN_SESSION_SECRET);
  let firmaValida: boolean;
  try {
    firmaValida = await crypto.subtle.verify(
      "HMAC",
      clave,
      base64UrlDecodificar(firma),
      new TextEncoder().encode(payload)
    );
  } catch {
    return null;
  }
  if (!firmaValida) return null;

  try {
    const datos = JSON.parse(new TextDecoder().decode(base64UrlDecodificar(payload)));
    if (typeof datos.email !== "string" || typeof datos.exp !== "number" || datos.exp < Date.now()) {
      return null;
    }
    return datos.email;
  } catch {
    return null;
  }
}

function leerCookie(request: Request, nombre: string): string | null {
  const cabecera = request.headers.get("Cookie");
  if (!cabecera) return null;
  for (const parte of cabecera.split(";")) {
    const [k, ...resto] = parte.trim().split("=");
    if (k === nombre) return resto.join("=");
  }
  return null;
}

export function leerCookieSesion(request: Request): string | null {
  return leerCookie(request, NOMBRE_COOKIE_SESION);
}

export function leerCookieState(request: Request): string | null {
  return leerCookie(request, NOMBRE_COOKIE_STATE);
}

// Solo Secure en producción (https); en `wrangler dev` local (http) rechazaría
// la cookie si se marca Secure siempre.
function atributosCookie(env: Env): string {
  const segura = env.ALLOWED_ORIGIN.startsWith("https://") ? "; Secure" : "";
  return `Path=/api/admin; HttpOnly${segura}; SameSite=Lax`;
}

export function cookieSesion(env: Env, valor: string): string {
  return `${NOMBRE_COOKIE_SESION}=${valor}; ${atributosCookie(env)}; Max-Age=${DURACION_SESION_SEG}`;
}

export function cookieSesionBorrada(env: Env): string {
  return `${NOMBRE_COOKIE_SESION}=; ${atributosCookie(env)}; Max-Age=0`;
}

export function cookieState(env: Env, valor: string): string {
  return `${NOMBRE_COOKIE_STATE}=${valor}; ${atributosCookie(env)}; Max-Age=${DURACION_STATE_SEG}`;
}

export function cookieStateBorrada(env: Env): string {
  return `${NOMBRE_COOKIE_STATE}=; ${atributosCookie(env)}; Max-Age=0`;
}

// --- OAuth de Google (Authorization Code), sin librerías ---

export function urlRedireccionCallback(env: Env): string {
  return `${env.ALLOWED_ORIGIN}/api/admin/auth/callback`;
}

export function urlAutorizacionGoogle(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: urlRedireccionCallback(env),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Intercambia el "code" del callback por el email verificado de la cuenta de
// Google. Usa el endpoint userinfo con el access_token en vez de validar la
// firma del id_token a mano, para no tener que implementar verificación JWK.
export async function intercambiarCodigoPorEmail(env: Env, code: string): Promise<string | null> {
  const resToken = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: urlRedireccionCallback(env),
      grant_type: "authorization_code",
    }),
  });
  if (!resToken.ok) return null;
  const { access_token } = (await resToken.json()) as { access_token?: string };
  if (!access_token) return null;

  const resInfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!resInfo.ok) return null;
  const info = (await resInfo.json()) as { email?: string; email_verified?: boolean | string };
  if (!info.email || info.email_verified === false || info.email_verified === "false") return null;
  return info.email.toLowerCase();
}
