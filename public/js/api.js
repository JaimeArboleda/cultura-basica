// Cliente HTTP contra el Worker (README §4.3). Idealmente el Worker se sirve bajo
// /api/* del mismo dominio que este front-end (same-origin, sin necesidad de CORS);
// eso requiere una route sobre un dominio propio en Cloudflare. Mientras el proyecto
// use los subdominios gratuitos *.workers.dev / *.pages.dev (dominios distintos),
// hace falta la URL absoluta del Worker y CORS (ver worker/wrangler.toml ALLOWED_ORIGIN).
const API_BASE = "https://cultura-basica.cultura-basica.workers.dev";

async function peticion(path, opciones = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...opciones.headers },
  });
  if (!res.ok) {
    let mensaje = `Error ${res.status}`;
    try {
      const cuerpo = await res.json();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      // sin cuerpo JSON, se mantiene el mensaje genérico
    }
    const error = new Error(mensaje);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export function crearSesion({ consentimiento, compromiso_honestidad, demografia, user_agent_clase }) {
  return peticion("/api/sesion", {
    method: "POST",
    body: JSON.stringify({ consentimiento, compromiso_honestidad, demografia, user_agent_clase }),
  });
}

export function enviarRespuesta({ sesion_id, item_id, respuesta, t_ms, perdio_foco }) {
  return peticion("/api/respuesta", {
    method: "POST",
    body: JSON.stringify({ sesion_id, item_id, respuesta, t_ms, perdio_foco }),
  });
}

export function obtenerResultado(sesionId) {
  return peticion(`/api/resultado/${encodeURIComponent(sesionId)}`);
}
