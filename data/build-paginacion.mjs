// Precalcula, UNA sola vez, cuántos bloques (ítems o campos de demografía)
// caben en cada página de la hoja de papel v1 y v2, y lo persiste en
// data/paginacion.json — README, "Paginado fiable".
//
// Por qué existe: comun.js::construirPaginas decidía la paginación midiendo
// alturas reales en el DOM (getBoundingClientRect) del navegador que la
// ejecutase en ese momento. Dos ejecuciones — una al imprimir la hoja, otra
// al reconstruir su layout para leerla, posiblemente en otro dispositivo u
// otro momento — podían medir esas alturas de forma ligerísimamente distinta
// (métricas de fuente entre motores de renderizado: hinting, subpíxel...)
// y acabar repartiendo los bloques en un número de páginas distinto, con lo
// que una foto de "página 11" dejaba de existir en la reconstrucción. Este
// script fija esa decisión de una vez, con el layout REAL ya usado para
// generar las hojas de piloto, y de ahí en adelante tanto imprimir como leer
// usan siempre estos mismos conteos (comun.js::agruparPorConteos) en vez de
// volver a medir.
//
// Uso: node data/build-paginacion.mjs (y commitear el data/paginacion.json
// resultante). Hay que volver a ejecutarlo si cambia el banco de ítems
// (data/items.json), el orden de presentación (data/orden-test.json) o el
// layout de la hoja (public/admin/papel/v{1,2}/hoja.js, comun.js).
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");

// ============================================================
// Servidor estático mínimo (mismo patrón que ocr_tests/generar.mjs: los
// módulos del pipeline de papel usan imports relativos entre public/ y
// data/, hace falta un único origen http para que el navegador los resuelva).
// ============================================================

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
};

function iniciarServidorEstatico() {
  const servidor = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rutaFs = path.join(RAIZ_REPO, urlPath);
      if (!rutaFs.startsWith(RAIZ_REPO)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const datos = await readFile(rutaFs);
      const ext = path.extname(rutaFs);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(datos);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

async function main() {
  // Mismo orden de presentación que usa la app real (worker/src/sorteo.ts
  // ::ordenarTest, a partir de data/orden-test.json) — duplicado aquí igual
  // que en ocr_tests/generar.mjs, a propósito: es justo el orden en el que
  // GET /api/admin/items-impresion sirve el banco, y por tanto en el que
  // construirHoja(items) reparte los bloques en páginas.
  const bancoSinOrdenar = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/items.json"), "utf8"));
  const ordenIds = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/orden-test.json"), "utf8"));
  const idsBanco = new Set(bancoSinOrdenar.map((it) => it.id));
  const orden = ordenIds.filter((id) => idsBanco.has(id));
  const vistos = new Set(orden);
  const faltantes = bancoSinOrdenar.map((it) => it.id).filter((id) => !vistos.has(id));
  const porId = new Map(bancoSinOrdenar.map((it) => [it.id, it]));
  const items = [...orden, ...faltantes].map((id) => porId.get(id));

  console.log(`Ítems cargados: ${items.length}. Iniciando servidor estático y Chromium…`);
  const servidor = await iniciarServidorEstatico();
  const puerto = servidor.address().port;
  const baseUrl = `http://127.0.0.1:${puerto}`;

  // executablePath fijo (README, "entorno remoto"): igual que en
  // ocr_tests/generar.mjs, usa el Chromium preinstalado si existe.
  const chromiumPreinstalado = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(fs.existsSync(chromiumPreinstalado) ? { executablePath: chromiumPreinstalado } : {});
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[harness]", msg.text());
  });

  await page.goto(`${baseUrl}/data/paginacion-harness.html`);
  await page.waitForFunction(() => window.__harnessListo === true);

  const resultado = {};
  for (const version of [1, 2]) {
    resultado[String(version)] = await page.evaluate(([v, its]) => window.__calcularConteos(v, its), [version, items]);
    const c = resultado[String(version)];
    console.log(
      `✓ v${version}: ${c.demografia.length} página(s) de datos (${c.demografia.join("+")}), ${c.items.length} página(s) de ítems (${c.items.join("+")})`
    );
  }

  await browser.close();
  servidor.close();

  const destino = path.join(RAIZ_REPO, "data/paginacion.json");
  await writeFile(destino, JSON.stringify(resultado, null, 2) + "\n");
  console.log(`Listo. Escrito ${destino}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
