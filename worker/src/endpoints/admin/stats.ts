import { obtenerEstadisticas } from "../../db";
import { json } from "../../http";
import type { Env } from "../../tipos";

// Objetivo de respuestas del piloto (README §6, Fase 3).
const OBJETIVO_MIN = 100;
const OBJETIVO_MAX = 150;

export async function getStats(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const tokenId = url.searchParams.get("token_id") ?? undefined;
  const stats = await obtenerEstadisticas(env, tokenId);
  return json(env, { ...stats, objetivo_min: OBJETIVO_MIN, objetivo_max: OBJETIVO_MAX });
}
