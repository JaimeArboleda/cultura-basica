import type { Env } from "./tipos";

export function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // El panel de admin (worker/src/adminAuth.ts) se autentica con cookie
    // httpOnly: hace falta esta cabecera para que el navegador la envíe si
    // Pages y el Worker no comparten dominio (§4.6).
    "Access-Control-Allow-Credentials": "true",
  };
}

export function json(env: Env, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

export function error(env: Env, status: number, mensaje: string): Response {
  return json(env, { error: mensaje }, status);
}

export function ipDeRequest(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
}
