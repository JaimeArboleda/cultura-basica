import { error } from "../http";
import type { Env } from "../tipos";

function tiempoConstanteIgual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

function aCsv(filas: Record<string, unknown>[]): string {
  if (filas.length === 0) return "";
  const columnas = Object.keys(filas[0]);
  const escapar = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.join(",")];
  for (const fila of filas) {
    lineas.push(columnas.map((c) => escapar(fila[c])).join(","));
  }
  return lineas.join("\n");
}

export async function getExport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!tiempoConstanteIgual(token, env.EXPORT_TOKEN)) {
    return error(env, 401, "Token inválido");
  }

  const formato = url.searchParams.get("formato") === "json" ? "json" : "csv";

  const [sesiones, respuestas, sesionItems] = await Promise.all([
    env.DB.prepare("SELECT * FROM sesiones").all(),
    env.DB.prepare("SELECT * FROM respuestas").all(),
    env.DB.prepare("SELECT * FROM sesion_items").all(),
  ]);

  const datos = {
    sesiones: sesiones.results,
    respuestas: respuestas.results,
    sesion_items: sesionItems.results,
  };

  if (formato === "json") {
    return new Response(JSON.stringify(datos), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // CSV: una tabla por sección, separadas por una línea en blanco y un encabezado.
  const partes = [
    "# sesiones",
    aCsv(datos.sesiones as Record<string, unknown>[]),
    "",
    "# respuestas",
    aCsv(datos.respuestas as Record<string, unknown>[]),
    "",
    "# sesion_items",
    aCsv(datos.sesion_items as Record<string, unknown>[]),
  ];

  return new Response(partes.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="export.csv"',
    },
  });
}
