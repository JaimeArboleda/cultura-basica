import type { Env } from "./tipos";

export function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    // Authorization: el panel de admin (worker/src/adminAuth.ts) manda su
    // token de sesión como `Authorization: Bearer …`, no como cookie — Pages
    // y el Worker viven en dominios distintos (*.pages.dev / *.workers.dev).
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
