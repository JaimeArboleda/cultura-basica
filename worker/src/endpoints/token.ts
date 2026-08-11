import { obtenerToken } from "../db";
import { json } from "../http";
import type { Env } from "../tipos";

// Comprobación previa a mostrar la pantalla de consentimiento (issue #2): permite
// distinguir "token caducado" de "sin acceso / token inválido" antes de que la
// persona rellene la demografía, en vez de descubrirlo al enviar POST /api/sesion.
export async function getTokenValido(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("token") ?? "";

  if (!id) {
    return json(env, { valido: false, motivo: "ausente" });
  }

  const token = await obtenerToken(env, id);
  if (!token) {
    return json(env, { valido: false, motivo: "invalido" });
  }
  if (new Date(token.expira_en).getTime() < Date.now()) {
    return json(env, { valido: false, motivo: "caducado" });
  }

  return json(env, { valido: true, descripcion: token.descripcion });
}
