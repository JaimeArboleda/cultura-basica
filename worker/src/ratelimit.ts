// Rate limiting básico por IP sin almacenar la IP (README §3: "la IP no se
// almacena"). La clave en KV es un hash de IP+ventana temporal, no reversible, con
// TTL nativo — no hace falta ningún job de limpieza.
import type { Env } from "./tipos";

async function hashClave(ip: string, ventana: string): Promise<string> {
  const datos = new TextEncoder().encode(`${ip}:${ventana}`);
  const digest = await crypto.subtle.digest("SHA-256", datos);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rl:${hex}`;
}

function ventanaActual(): string {
  // ventana fija de 1 minuto
  return Math.floor(Date.now() / 60_000).toString();
}

// Devuelve true si la petición está permitida (y la registra); false si supera el
// límite. limite/ventana pensados para uso doméstico normal (varias personas detrás
// del mismo NAT) pero restrictivos para scripts.
export async function permitir(env: Env, ip: string): Promise<boolean> {
  const limite = env.RATE_LIMIT_MAX ? parseInt(env.RATE_LIMIT_MAX, 10) : 5;
  const clave = await hashClave(ip, ventanaActual());
  const actualStr = await env.RATE_LIMIT.get(clave);
  const actual = actualStr ? parseInt(actualStr, 10) : 0;
  if (actual >= limite) {
    return false;
  }
  await env.RATE_LIMIT.put(clave, String(actual + 1), { expirationTtl: 120 });
  return true;
}
