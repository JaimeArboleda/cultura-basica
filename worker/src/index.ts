// Fase 2: Worker de Cloudflare (API). Endpoints según README §4.3:
//   POST /api/sesion
//   POST /api/respuesta
//   POST /api/extender
//   GET  /api/resultado/:id
//   GET  /api/export?token=…
//
// El sorteo de ítems y la corrección de respuestas ocurren aquí, nunca en el cliente.

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response("Fase 2: por implementar", { status: 501 });
  },
};
