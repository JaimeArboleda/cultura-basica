import { obtenerDatasetCompleto } from "../../db";
import { json } from "../../http";
import type { Env } from "../../tipos";

// Dataset crudo para la consola de estadísticas avanzadas del panel (§4.5):
// alimenta los DataFrames de pandas que carga public/admin/admin.js vía
// Pyodide en el propio navegador. Sin agregar ni redondear nada aquí — eso lo
// hace quien analiza, en Python.
export async function getDataset(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const tokenId = url.searchParams.get("token_id") ?? undefined;
  return json(env, await obtenerDatasetCompleto(env, tokenId));
}
