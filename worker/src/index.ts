// Worker de Cloudflare (API). Endpoints según README §4.3 y §4.5. El sorteo de
// ítems y la corrección de respuestas ocurren aquí, nunca en el cliente.
import { manejarRutaAdmin } from "./adminRouter";
import { getExport } from "./endpoints/export";
import { postRespuesta } from "./endpoints/respuesta";
import { getResultado } from "./endpoints/resultado";
import { postSesion } from "./endpoints/sesion";
import { postSolicitudAcceso } from "./endpoints/solicitudAcceso";
import { getTokenValido } from "./endpoints/token";
import { corsHeaders, error } from "./http";
import type { Env } from "./tipos";

export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    try {
      if (url.pathname.startsWith("/api/admin/")) {
        return await manejarRutaAdmin(request, env, url.pathname);
      }
      if (request.method === "POST" && url.pathname === "/api/sesion") {
        return await postSesion(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/respuesta") {
        return await postRespuesta(request, env);
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/resultado/")) {
        const id = url.pathname.slice("/api/resultado/".length);
        return await getResultado(id, env);
      }
      if (request.method === "GET" && url.pathname === "/api/export") {
        return await getExport(request, env);
      }
      if (request.method === "GET" && url.pathname === "/api/token-valido") {
        return await getTokenValido(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/solicitud-acceso") {
        return await postSolicitudAcceso(request, env);
      }
    } catch (e) {
      console.error(e);
      return error(env, 500, "Error interno");
    }

    return error(env, 404, "No encontrado");
  },
};
