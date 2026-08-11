import { agregarAdmin, listarAdmins, quitarAdmin } from "../../db";
import { error, json } from "../../http";
import type { Env } from "../../tipos";

export async function getAdmins(env: Env): Promise<Response> {
  return json(env, { admins: await listarAdmins(env) });
}

export async function postAdmins(request: Request, env: Env, anadidoPor: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return error(env, 400, "Email inválido");
  }

  await agregarAdmin(env, { email, anadidoPor, anadidoEn: new Date().toISOString() });
  return json(env, { ok: true }, 201);
}

// Red de seguridad: no permite quitar al último administrador (§ bootstrap), para
// que un borrado accidental no deje el panel sin nadie que pueda entrar.
export async function deleteAdmin(env: Env, email: string): Promise<Response> {
  const admins = await listarAdmins(env);
  if (admins.length <= 1) {
    return error(env, 400, "No se puede quitar al último administrador");
  }
  await quitarAdmin(env, email.toLowerCase());
  return json(env, { ok: true });
}
