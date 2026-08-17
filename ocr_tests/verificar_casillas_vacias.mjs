// Verificación previa a implementar la detección determinista de tinta por
// casilla (issue #35): antes de tocar el esquema de OCR-IA
// (posicionesEnBlancoRespuesta/posicionesEnBlancoCorreccion, prototipado en
// worker/src/endpoints/admin/ocrIa.ts), hay que saber con certeza si se puede
// distinguir "casilla en blanco" de "casilla con tinta" de forma determinista
// (sin LLM) sobre la imagen ya enderezada — la propuesta del issue.
//
// Reproduce, sin llamar a ninguna API ni gastar cuota, el mismo camino que
// seguiría el cliente en producción:
//   1. Toma las fotos "crudas" ya generadas por generar.mjs (ocr_tests/<persona>/
//      pagina-NN.jpg — rotadas, con ruido/desenfoque, SIN enderezar).
//   2. Las endereza con el mismo mecanismo que subirLote.js/digitalizar.js
//      (comun.js::detectarFiduciales + warpearImagen, a la escala canónica
//      ESCALA_DIGITALIZACION) — ejecutado en un Chromium real vía Playwright,
//      porque ese código usa <canvas>/ImageData, no hay DOM en Node.
//   3. Calcula la geometría de cada casilla de ordenar/clasificar sobre esa
//      imagen ya enderezada (hoja.js::calcularGeometriaCasillas, issue #35
//      trabajo pendiente #1 — nueva). calcularGeometriaCasillas devuelve
//      geometría de los 5 formatos (ampliado en una ronda posterior del
//      mismo issue), pero este script se queda deliberadamente solo con
//      ordenar/clasificar: su ground truth (plan.planItems[id].respuesta[i])
//      solo tiene sentido como "casilla i-ésima" para esos dos formatos —
//      para seleccion_multiple es una lista de letras SELECCIONADAS (no una
//      casilla por posición) y para abierto/opcion_multiple ya se compara
//      distinto (ver ocr_tests/probar_ocr_ia.mjs, que sí verifica los 5
//      contra la API real).
//   4. Muestrea la densidad de tinta del interior de cada casilla (con un
//      margen para no coger el borde dibujado ni tinta de la casilla vecina).
//   5. Compara "¿hay tinta?" contra el ground truth EXACTO de qué casillas
//      dibujó generar.mjs con contenido (generar.mjs::construirPlan,
//      reproducido aquí con la misma semilla determinista — sin volver a
//      generar ninguna imagen).
//
// Ampliado en el issue #37 con una segunda fuente de datos: además de las 4
// fixtures sintéticas de arriba, procesa también los 2 PDFs con efecto de
// escaneado REAL de ocr_tests/05-escaneo-real/ (ver HOJAS_REALES más abajo)
// — necesarios porque las fixtures sintéticas, con un fondo casi
// perfectamente blanco, nunca ejercitaron el caso borderline que motivó el
// #37 (una casilla con tinta real midiendo 7.9, justo por debajo del umbral
// 8 antiguo). Comparte el mismo criterio (comparación pura de imagen contra
// ground truth, sin LLM) y añade el reporte de las 3 zonas de
// comun.js::zonaTintaCasilla (blanco/dudoso/tinta) en vez del único umbral
// binario original.
//
// Uso: node ocr_tests/verificar_casillas_vacias.mjs
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { crearContextoFuentes, calcularManifiesto, calcularGeometriaCasillas } from "../public/admin/papel/hoja.js";
import { PERSONAS, hashCadena, construirPlan, conCasillasAbierto } from "./generar.mjs";
import { PAGE_W, PAGE_H, ESCALA_DIGITALIZACION } from "../public/admin/papel/geometria.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");

// Servidor estático mínimo para servir los módulos ES del navegador (mismo
// motivo/patrón que generar.mjs::iniciarServidorEstatico, duplicado aquí
// porque esa función no está exportada y es solo un puñado de líneas): hace
// falta un origen http real para que el import() dinámico de comun.js dentro
// del navegador se resuelva (con about:blank, origen opaco, falla CORS).
const MIME = { ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function iniciarServidorEstatico() {
  const servidor = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/__vacio.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!DOCTYPE html><html><body></body></html>");
        return;
      }
      const rutaFs = path.join(RAIZ_REPO, urlPath);
      if (!rutaFs.startsWith(RAIZ_REPO)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const datos = await readFile(rutaFs);
      res.writeHead(200, { "Content-Type": MIME[path.extname(rutaFs)] || "application/octet-stream" });
      res.end(datos);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(servidor)));
}

// Varios umbrales de oscuridad media (misma escala 0-255 que
// comun.js::densidadPromedio) para ver dónde cae el punto de corte real entre
// "blanco" y "con tinta" antes de fijar uno solo en el código de producción.
const UMBRALES_A_PROBAR = [8, 12, 16, 20, 25, 30, 40, 55, 70, 90];

// ============================================================
// Escaneos reales (issue #37, seguimiento de #35 "trabajo pendiente #3":
// calibrar contra fotos/escaneos reales, no solo estas fixtures sintéticas).
// ocr_tests/05-escaneo-real/escaneo-{1,2}.pdf: dos PDFs con efecto de
// escaneado real (obtenidos con una herramienta online, issue #37, comentario
// del propio autor) sobre el MISMO par de hojas físicas ya impresas por este
// sistema y rellenadas a mano por dos personas distintas — cada PDF es una
// pasada de escaneado distinta (misma tinta, calidad/artefactos distintos:
// justo la variabilidad que un umbral absoluto fijo no puede capturar), 12
// páginas cada uno (2 hojas de 6 páginas: datos + 5 páginas de ítems).
//
// No hay generar.mjs ni respuestas-esperadas.json para contenido real — el
// ground truth de qué posiciones tienen tinta se estableció leyendo las
// imágenes a mano (ver ocr_tests/README.md para el detalle), limitado a los
// 2 ÚNICOS ítems ordenar/clasificar del banco actual (mismo criterio que el
// resto de este script: son los únicos formatos donde "posición i-ésima"
// tiene ground truth exacto sin ambigüedad, ver la cabecera del fichero):
// ítem impreso nº4 ("Ordena estas figuras históricas", id "03", ordenar, 10
// posiciones) e ítem nº7 ("Clasifica estos compositores", id "22",
// clasificar, 10 posiciones) — ambos en las páginas "1 de 5"/"2 de 5" de
// cada hoja (índice de página 1 y 2 dentro de sus 6 páginas). En las 4
// observaciones reales leídas, las posiciones con tinta son siempre un
// PREFIJO contiguo desde la posición 1 (nunca un hueco a mitad de rejilla),
// así que el ground truth se codifica como "nº de posiciones con tinta desde
// la 1ª" por bloque.
const HOJAS_REALES = [
  {
    archivo: "escaneo-1.pdf",
    personas: [
      { id: "real-A-letra-clara", paginaInicial: 0, groundTruth: { "03": { respuesta: 10, correccion: 0 }, "22": { respuesta: 10, correccion: 0 } } },
      {
        id: "real-B-letra-descuidada",
        paginaInicial: 6,
        groundTruth: { "03": { respuesta: 0, correccion: 0 }, "22": { respuesta: 6, correccion: 0 } },
      },
    ],
  },
  {
    archivo: "escaneo-2.pdf",
    personas: [
      { id: "real-A-letra-clara", paginaInicial: 0, groundTruth: { "03": { respuesta: 10, correccion: 0 }, "22": { respuesta: 10, correccion: 0 } } },
      {
        id: "real-B-letra-descuidada",
        paginaInicial: 6,
        groundTruth: { "03": { respuesta: 0, correccion: 0 }, "22": { respuesta: 6, correccion: 0 } },
      },
    ],
  },
];
// Offset (dentro de las 6 páginas de una hoja) de la página de ítems que
// contiene cada uno de los 2 ítems ordenar/clasificar — página de datos es el
// índice 0, así que "página 1 de 5" es índice 1 y "página 2 de 5" es índice 2.
const OFFSET_PAGINA_ITEM = { "03": 1, "22": 2 };

async function main() {
  const items = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/items.json"), "utf8"));
  const ordenIds = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/orden-test.json"), "utf8"));
  const porId = new Map(items.map((it) => [it.id, it]));
  const idsBanco = new Set(items.map((it) => it.id));
  const orden = ordenIds.filter((id) => idsBanco.has(id));
  const faltantes = items.map((it) => it.id).filter((id) => !orden.includes(id));
  const itemsOrdenados = [...orden, ...faltantes].map((id) => conCasillasAbierto(porId.get(id)));

  const fontRegularBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Regular.ttf"));
  const fontBoldBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Bold.ttf"));
  const ctx = await crearContextoFuentes({ PDFDocument, rgb }, fontkit, null, null, fontRegularBytes, fontBoldBytes);
  const manifiesto = calcularManifiesto(ctx, itemsOrdenados);
  const geometriaPorPagina = calcularGeometriaCasillas(ctx, itemsOrdenados);

  const totalCasillasEnManifiesto = geometriaPorPagina.reduce((s, c) => s + c.length, 0);
  console.log(
    `Manifiesto: ${manifiesto.length} páginas, ${totalCasillasEnManifiesto} casillas de ordenar/clasificar en total ` +
      `(${geometriaPorPagina.filter((c) => c.length > 0).length} páginas con al menos una).`
  );

  const chromiumPreinstalado = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(fs.existsSync(chromiumPreinstalado) ? { executablePath: chromiumPreinstalado } : {});
  const servidor = await iniciarServidorEstatico();
  const puerto = servidor.address().port;
  const baseUrl = `http://127.0.0.1:${puerto}`;

  const resultados = []; // { persona, itemId, lado, posicion, densidad, tieneTintaReal }
  const resultadosReales = []; // { persona, itemId, lado, posicion, densidad, varianza, zona, blancoLocal, tieneTintaReal } — escaneos reales, issue #37
  const fallosWarp = [];
  let insetRelativoProduccion;

  try {
    const pagina = await browser.newPage();
    await pagina.goto(`${baseUrl}/__vacio.html`);
    // Leído de comun.js (no duplicado aquí): el inset que de verdad se está
    // probando es el que ya usa detectarTintaCasillas en producción.
    insetRelativoProduccion = await pagina.evaluate(
      async ({ baseUrl }) => (await import(`${baseUrl}/public/admin/papel/comun.js`)).INSET_RELATIVO_CASILLA,
      { baseUrl }
    );

    for (const persona of PERSONAS) {
      const dir = path.join(RAIZ_REPO, "ocr_tests", persona.id);
      if (!fs.existsSync(path.join(dir, "respuestas-esperadas.json"))) {
        console.log(`  [${persona.id}] sin fixtures generadas (ejecuta antes node ocr_tests/generar.mjs) — se salta.`);
        continue;
      }
      const semilla = hashCadena(persona.id);
      const plan = construirPlan(itemsOrdenados, persona, semilla);

      for (let i = 0; i < manifiesto.length; i++) {
        const casillas = geometriaPorPagina[i].filter((c) => c.formato === "ordenar" || c.formato === "clasificar");
        if (casillas.length === 0) continue;
        const jpegPath = path.join(dir, `pagina-${String(i + 1).padStart(2, "0")}.jpg`);
        const jpegBase64 = await readFile(jpegPath, "base64");

        // Se manda la geometría en pt (sin convertir aquí): la conversión a px
        // del canvas enderezado (ptAPxCanonico) vive en comun.js — un único
        // sitio, el mismo que usa la función de producción, para que este
        // script no pueda desincronizarse silenciosamente de ella.
        const rects = casillas.map((c) => ({ itemId: c.itemId, lado: c.lado, posicion: c.posicion, xPt: c.xPt, yTopPt: c.yTopPt, wPt: c.wPt, hPt: c.hPt }));

        const salida = await pagina.evaluate(
          async ({ baseUrl, jpegBase64, rects, destW, destH }) => {
            const mod = await import(`${baseUrl}/public/admin/papel/comun.js`);
            const img = await new Promise((resolve, reject) => {
              const im = new Image();
              im.onload = () => resolve(im);
              im.onerror = reject;
              im.src = `data:image/jpeg;base64,${jpegBase64}`;
            });
            const canvasFuente = document.createElement("canvas");
            canvasFuente.width = img.width;
            canvasFuente.height = img.height;
            canvasFuente.getContext("2d").drawImage(img, 0, 0);

            const detectados = mod.detectarFiduciales(canvasFuente);
            if (!detectados) return { error: "fiduciales-no-detectados" };
            const dst = mod.destinoFiducialesEscalado();
            const warp = mod.warpearImagen(canvasFuente, detectados, destW, destH, dst);
            const imageData = warp.getContext("2d").getImageData(0, 0, destW, destH);

            // Densidad "cruda" del interior de cada casilla, con el mismo
            // inset que usa la función de producción (mod.INSET_RELATIVO_CASILLA)
            // — se recalcula aquí (en vez de llamar directo a
            // detectarTintaCasillas) para poder barrer varios umbrales sobre
            // el mismo dato y no solo el umbral ya fijado en producción.
            const densidades = rects.map((r) => {
              const xPx = mod.ptAPxCanonico(r.xPt);
              const yPx = mod.ptAPxCanonico(r.yTopPt);
              const wPx = mod.ptAPxCanonico(r.wPt);
              const hPx = mod.ptAPxCanonico(r.hPt);
              const mx = wPx * mod.INSET_RELATIVO_CASILLA;
              const my = hPx * mod.INSET_RELATIVO_CASILLA;
              const densidad = mod.densidadPromedio(imageData, xPx + mx, yPx + my, xPx + wPx - mx, yPx + hPx - my);
              return { itemId: r.itemId, lado: r.lado, posicion: r.posicion, densidad };
            });

            // Función de producción tal cual (mismo camino que ejecutará
            // digitalizar.js/subirLote.js en real) — para confirmar que el
            // umbral ya fijado en comun.js (no solo el mejor umbral teórico
            // de este barrido) acierta en las 4 fixtures.
            const produccion = mod.detectarTintaCasillas(warp, rects);
            const blancoLocal = mod.muestrearBlancoLocal(imageData);

            return {
              densidades,
              blancoLocal,
              produccion: produccion.map((c) => ({
                itemId: c.itemId,
                lado: c.lado,
                posicion: c.posicion,
                tieneTinta: c.tieneTinta,
                zona: c.zona,
                varianza: c.varianza,
                otsuSeparabilidad: c.otsuSeparabilidad,
                numComponentes: c.numComponentes,
                extensionComponenteMayor: c.extensionComponenteMayor,
                fraccionComponenteMayor: c.fraccionComponenteMayor,
              })),
            };
          },
          { baseUrl, jpegBase64, rects, destW: Math.round(PAGE_W * ESCALA_DIGITALIZACION), destH: Math.round(PAGE_H * ESCALA_DIGITALIZACION) }
        );

        if (salida.error) {
          fallosWarp.push({ persona: persona.id, pagina: i + 1, error: salida.error });
          console.log(`  [${persona.id}] página ${i + 1}: FALLO AL ENDEREZAR (${salida.error})`);
          continue;
        }

        const produccionPorClave = new Map(salida.produccion.map((c) => [`${c.itemId}:${c.lado}:${c.posicion}`, c]));
        for (const dcasilla of salida.densidades) {
          const planItem = plan.planItems[dcasilla.itemId];
          const tieneTintaReal =
            dcasilla.lado === "respuesta"
              ? Boolean(planItem.respuesta[dcasilla.posicion])
              : planItem.correccion != null && Boolean(planItem.correccion[dcasilla.posicion]);
          const produccionCasilla = produccionPorClave.get(`${dcasilla.itemId}:${dcasilla.lado}:${dcasilla.posicion}`);
          resultados.push({
            persona: persona.id,
            ...dcasilla,
            blancoLocal: salida.blancoLocal,
            tieneTintaReal,
            tieneTintaProduccion: produccionCasilla?.tieneTinta,
            zona: produccionCasilla?.zona,
            varianza: produccionCasilla?.varianza,
            otsuSeparabilidad: produccionCasilla?.otsuSeparabilidad,
            numComponentes: produccionCasilla?.numComponentes,
            extensionComponenteMayor: produccionCasilla?.extensionComponenteMayor,
            fraccionComponenteMayor: produccionCasilla?.fraccionComponenteMayor,
          });
        }
      }
      console.log(`  [${persona.id}] procesada.`);
    }

    console.log("\nProcesando escaneos reales (issue #37)...");
    for (const hoja of HOJAS_REALES) {
      const rutaPdf = path.join(RAIZ_REPO, "ocr_tests/05-escaneo-real", hoja.archivo);
      if (!fs.existsSync(rutaPdf)) {
        console.log(`  [${hoja.archivo}] no encontrado — se salta.`);
        continue;
      }
      const pdfBase64 = await readFile(rutaPdf, "base64");

      const peticiones = [];
      for (const persona of hoja.personas) {
        for (const [itemId, gt] of Object.entries(persona.groundTruth)) {
          // geometriaPorPagina está indexado dentro de UNA hoja de 6 páginas
          // (el layout es el mismo para cualquier instancia); pageIndex, en
          // cambio, es el índice ABSOLUTO dentro del PDF de 12 páginas (2
          // hojas), así que hace falta sumar paginaInicial solo para éste.
          const pageIndex = persona.paginaInicial + OFFSET_PAGINA_ITEM[itemId];
          const casillas = geometriaPorPagina[OFFSET_PAGINA_ITEM[itemId]].filter((c) => c.itemId === itemId);
          const rects = casillas.map((c) => ({ itemId: c.itemId, lado: c.lado, posicion: c.posicion, xPt: c.xPt, yTopPt: c.yTopPt, wPt: c.wPt, hPt: c.hPt }));
          peticiones.push({ personaId: persona.id, itemId, gt, pageIndex, rects });
        }
      }

      // No se usa mod.cargarPaginasPdf (comun.js) aquí: esa función importa
      // pdfjs-dist desde jsdelivr DENTRO del navegador, y a diferencia de
      // Node (que sí pasa por el proxy HTTPS del entorno, ver
      // generar.mjs::FUENTES_INK, descargado con fetch de Node, nunca desde
      // dentro de la página) el Chromium que lanza Playwright en este sandbox
      // no hereda esa configuración de proxy — falla con "Failed to fetch
      // dynamically imported module". Se sirve el pdfjs-dist YA instalado en
      // node_modules/ (devDependency del propio repo) como blobs locales en
      // vez de red — solo un detalle de este script de test, comun.js sigue
      // usando el CDN en producción (un navegador real de un usuario sí tiene
      // su propia red, sin este problema).
      const pdfjsMjs = await readFile(path.join(RAIZ_REPO, "node_modules/pdfjs-dist/build/pdf.mjs"), "utf8");
      const pdfjsWorker = await readFile(path.join(RAIZ_REPO, "node_modules/pdfjs-dist/build/pdf.worker.mjs"), "utf8");

      const salida = await pagina.evaluate(
        async ({ baseUrl, pdfBase64, peticiones, destW, destH, pdfjsMjs, pdfjsWorker }) => {
          const mod = await import(`${baseUrl}/public/admin/papel/comun.js`);
          const workerBlobUrl = URL.createObjectURL(new Blob([pdfjsWorker], { type: "text/javascript" }));
          const mjsBlobUrl = URL.createObjectURL(new Blob([pdfjsMjs], { type: "text/javascript" }));
          const pdfjsLib = await import(mjsBlobUrl);
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;

          const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
          const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
          const ANCHO_OBJETIVO = 2200; // igual que comun.js::cargarPaginasPdf
          const paginasPdf = [];
          for (let i = 1; i <= doc.numPages; i++) {
            const paginaPdf = await doc.getPage(i);
            const viewportBase = paginaPdf.getViewport({ scale: 1 });
            const escalaPdf = ANCHO_OBJETIVO / viewportBase.width;
            const viewport = paginaPdf.getViewport({ scale: escalaPdf });
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            await paginaPdf.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            paginasPdf.push(canvas);
          }

          return peticiones.map(({ personaId, itemId, gt, pageIndex, rects }) => {
            const canvasFuente = paginasPdf[pageIndex];
            if (!canvasFuente) return { personaId, itemId, gt, error: `pdf sin página ${pageIndex}` };
            const detectados = mod.detectarFiduciales(canvasFuente);
            if (!detectados) return { personaId, itemId, gt, error: "fiduciales-no-detectados" };
            const dst = mod.destinoFiducialesEscalado();
            const warp = mod.warpearImagen(canvasFuente, detectados, destW, destH, dst);
            const produccion = mod.detectarTintaCasillas(warp, rects);
            const imageData = warp.getContext("2d").getImageData(0, 0, destW, destH);
            const blancoLocal = mod.muestrearBlancoLocal(imageData);
            return {
              personaId,
              itemId,
              gt,
              blancoLocal,
              casillas: produccion.map((c) => ({
                lado: c.lado,
                posicion: c.posicion,
                densidad: c.densidad,
                varianza: c.varianza,
                zona: c.zona,
                otsuSeparabilidad: c.otsuSeparabilidad,
                numComponentes: c.numComponentes,
                extensionComponenteMayor: c.extensionComponenteMayor,
                fraccionComponenteMayor: c.fraccionComponenteMayor,
              })),
            };
          });
        },
        {
          baseUrl,
          pdfBase64,
          peticiones,
          destW: Math.round(PAGE_W * ESCALA_DIGITALIZACION),
          destH: Math.round(PAGE_H * ESCALA_DIGITALIZACION),
          pdfjsMjs,
          pdfjsWorker,
        }
      );

      for (const resultado of salida) {
        if (resultado.error) {
          fallosWarp.push({ persona: `${hoja.archivo}/${resultado.personaId}`, item: resultado.itemId, error: resultado.error });
          console.log(`  [${hoja.archivo}/${resultado.personaId}] ítem ${resultado.itemId}: FALLO (${resultado.error})`);
          continue;
        }
        for (const c of resultado.casillas) {
          const nRelleno = c.lado === "respuesta" ? resultado.gt.respuesta : resultado.gt.correccion;
          const tieneTintaReal = c.posicion < nRelleno;
          resultadosReales.push({
            persona: `${hoja.archivo}/${resultado.personaId}`,
            itemId: resultado.itemId,
            lado: c.lado,
            posicion: c.posicion,
            densidad: c.densidad,
            varianza: c.varianza,
            zona: c.zona,
            otsuSeparabilidad: c.otsuSeparabilidad,
            numComponentes: c.numComponentes,
            extensionComponenteMayor: c.extensionComponenteMayor,
            fraccionComponenteMayor: c.fraccionComponenteMayor,
            blancoLocal: resultado.blancoLocal,
            tieneTintaReal,
          });
        }
      }
      console.log(`  [${hoja.archivo}] procesado (blanco local por página: ver detalle abajo).`);
    }
  } finally {
    await browser.close();
    servidor.close();
  }

  if (fallosWarp.length > 0) {
    console.log(`\n${fallosWarp.length} página(s) no se pudieron enderezar (detección de fiduciales falló) — excluidas del cómputo.`);
  }

  console.log(`\nTotal casillas evaluadas: ${resultados.length}`);
  const conTinta = resultados.filter((r) => r.tieneTintaReal);
  const sinTinta = resultados.filter((r) => !r.tieneTintaReal);
  console.log(`  Con tinta (ground truth): ${conTinta.length}`);
  console.log(`  En blanco (ground truth): ${sinTinta.length}`);

  function percentil(arr, p) {
    if (arr.length === 0) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }
  const densCon = conTinta.map((r) => r.densidad);
  const densSin = sinTinta.map((r) => r.densidad);
  console.log(
    `\nDistribución de densidad (0-255, oscuridad media del interior de la casilla, tras inset ${(insetRelativoProduccion * 100).toFixed(0)}%):`
  );
  console.log(
    `  Con tinta: min=${percentil(densCon, 0).toFixed(1)} p10=${percentil(densCon, 0.1).toFixed(1)} mediana=${percentil(densCon, 0.5).toFixed(1)} p90=${percentil(densCon, 0.9).toFixed(1)} max=${percentil(densCon, 1).toFixed(1)}`
  );
  console.log(
    `  En blanco: min=${percentil(densSin, 0).toFixed(1)} p10=${percentil(densSin, 0.1).toFixed(1)} mediana=${percentil(densSin, 0.5).toFixed(1)} p90=${percentil(densSin, 0.9).toFixed(1)} max=${percentil(densSin, 1).toFixed(1)}`
  );

  console.log(`\nAcierto por umbral (umbral = oscuridad media mínima para considerar "con tinta"):`);
  let mejor = null;
  for (const umbral of UMBRALES_A_PROBAR) {
    let tp = 0;
    let tn = 0;
    let fp = 0; // blanco real, detectado como tinta (peligroso: fuerza la casilla a "" en el esquema pese a tener contenido real)
    let fn = 0; // con tinta real, detectado como blanco (inocuo para el esquema: el modelo sigue libre de leer esa casilla)
    for (const r of resultados) {
      const detectaTinta = r.densidad >= umbral;
      if (r.tieneTintaReal && detectaTinta) tp++;
      else if (!r.tieneTintaReal && !detectaTinta) tn++;
      else if (!r.tieneTintaReal && detectaTinta) fp++;
      else fn++;
    }
    const total = tp + tn + fp + fn;
    const acc = ((tp + tn) / total) * 100;
    const fila = { umbral, acc, tp, tn, fp, fn };
    if (!mejor || acc > mejor.acc) mejor = fila;
    console.log(
      `  umbral=${String(umbral).padStart(3)}: acierto=${acc.toFixed(1)}%  TP=${tp} TN=${tn} FP(peligroso)=${fp} FN(inocuo)=${fn}`
    );
  }
  console.log(`\nMejor umbral de los probados: ${mejor.umbral} (${mejor.acc.toFixed(1)}% de acierto, ${mejor.fp} falsos positivos peligrosos).`);

  if (mejor.fp === 0 && densCon.length > 0 && densSin.length > 0 && percentil(densSin, 1) < percentil(densCon, 0)) {
    console.log(
      "\nSeparación LIMPIA: el máximo de 'en blanco' queda por debajo del mínimo de 'con tinta' — existe un umbral con 0 falsos " +
        "positivos peligrosos y 0 falsos negativos en este set. Candidato sólido para restringir el esquema de OCR-IA con certeza."
    );
  } else if (mejor.fp === 0) {
    console.log(
      "\n0 falsos positivos peligrosos con el mejor umbral (aunque las distribuciones se solapen algo) — se puede fijar el " +
        "umbral en el extremo seguro (más alto, prioriza no confundir tinta real con blanco) sin arriesgar borrar contenido real."
    );
  } else {
    console.log(
      "\nHay falsos positivos peligrosos incluso con el mejor umbral: alguna casilla en blanco se está detectando como 'con " +
        "tinta' (o viceversa, con umbrales altos) — antes de restringir el esquema de OCR-IA con esto, revisar esos casos concretos."
    );
  }

  // Chequeo final: no solo "existe un buen umbral teórico" sino que la propia
  // función que va a correr en producción (comun.js::detectarTintaCasillas,
  // con su umbral/inset ya fijados) acierta en las 4 fixtures.
  let prodOk = 0;
  let prodFp = 0;
  let prodFn = 0;
  for (const r of resultados) {
    if (r.tieneTintaProduccion === r.tieneTintaReal) prodOk++;
    else if (!r.tieneTintaReal && r.tieneTintaProduccion) prodFp++;
    else prodFn++;
  }
  console.log(
    `\ncomun.js::detectarTintaCasillas (umbral de producción, sin barrer nada): ${prodOk}/${resultados.length} correcto` +
      ` (${((prodOk / resultados.length) * 100).toFixed(1)}%), ${prodFp} falsos positivos peligrosos, ${prodFn} falsos negativos inocuos.`
  );
  if (prodFp > 0) {
    console.error("ATENCIÓN: la función de producción tiene falsos positivos peligrosos en estas fixtures — no desplegar sin revisar.");
    process.exitCode = 1;
  }

  // ============================================================
  // Zonas (issue #37): mismo chequeo que arriba, pero con la clasificación en
  // 3 zonas de comun.js::zonaTintaCasilla en vez del umbral binario. El único
  // caso PELIGROSO bajo el diseño ya implementado (digitalizar.js/
  // probar_ocr_ia.mjs solo fuerzan vacío para zona "blanco", nunca para
  // "dudoso") es tinta real clasificada como "blanco" — "dudoso" nunca fuerza
  // nada, así que caer ahí nunca puede borrar contenido real, solo renuncia a
  // restringir el esquema para esa posición (igual que si no hubiera
  // detección).
  function informeZonas(nombre, datos) {
    if (datos.length === 0) {
      console.log(`\n[${nombre}] sin datos.`);
      return;
    }
    let blancoOk = 0;
    let dudosoTinta = 0;
    let dudosoBlanco = 0;
    let tintaOk = 0;
    let peligroso = 0; // tinta real -> zona "blanco" (se fuerza vacío sobre contenido real)
    let desaprovechado = 0; // blanco real -> zona "tinta" (inocuo hoy, no forzamos nada en esa dirección)
    for (const r of datos) {
      if (r.zona === "blanco") {
        if (r.tieneTintaReal) peligroso++;
        else blancoOk++;
      } else if (r.zona === "tinta") {
        if (r.tieneTintaReal) tintaOk++;
        else desaprovechado++;
      } else {
        if (r.tieneTintaReal) dudosoTinta++;
        else dudosoBlanco++;
      }
    }
    const total = datos.length;
    const dudoso = dudosoTinta + dudosoBlanco;
    console.log(`\n[${nombre}] ${total} casillas — zona blanco=${blancoOk + peligroso} (${peligroso} peligrosas), zona dudoso=${dudoso} (${dudosoTinta} con tinta real / ${dudosoBlanco} en blanco real), zona tinta=${tintaOk + desaprovechado} (${desaprovechado} en blanco real, inocuo).`);
    if (peligroso > 0) {
      console.error(`  ATENCIÓN: ${peligroso} casilla(s) con tinta real cayeron en zona "blanco" — se forzaría vacío sobre contenido real.`);
      process.exitCode = 1;
    } else {
      console.log(`  0 casos peligrosos (tinta real -> zona "blanco").`);
    }
    if (dudoso > 0) {
      const dudosos = datos.filter((r) => r.zona === "dudoso");
      const FEATURES = [
        { campo: "varianza", etiqueta: "varianza" },
        { campo: "otsuSeparabilidad", etiqueta: "separabilidad de Otsu (0-1)" },
        { campo: "extensionComponenteMayor", etiqueta: "extensión de la componente mayor (0-1)" },
        { campo: "fraccionComponenteMayor", etiqueta: "fracción de píxeles en la componente mayor (0-1)" },
      ];
      for (const { campo, etiqueta } of FEATURES) {
        const conTinta = dudosos.filter((r) => r.tieneTintaReal).map((r) => r[campo]);
        const enBlanco = dudosos.filter((r) => !r.tieneTintaReal).map((r) => r[campo]);
        if (conTinta.length === 0 || enBlanco.length === 0) continue;
        const medTinta = medianaSimple(conTinta);
        const medBlanco = medianaSimple(enBlanco);
        const minTinta = Math.min(...conTinta);
        const maxTinta = Math.max(...conTinta);
        const minBlanco = Math.min(...enBlanco);
        const maxBlanco = Math.max(...enBlanco);
        const limpia = maxBlanco < minTinta || maxTinta < minBlanco;
        console.log(
          `  [dudoso] ${etiqueta} — con tinta: min=${minTinta.toFixed(4)} mediana=${medTinta.toFixed(4)} max=${maxTinta.toFixed(4)}; ` +
            `en blanco: min=${minBlanco.toFixed(4)} mediana=${medBlanco.toFixed(4)} max=${maxBlanco.toFixed(4)}` +
            (limpia ? " — SEPARACIÓN LIMPIA dentro de la banda dudosa (0 solapamiento con esta muestra)." : " — se solapan.")
        );
      }
    }
  }

  function medianaSimple(arr) {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  informeZonas("Fixtures sintéticas (ordenar/clasificar, 4 instancias)", resultados);
  informeZonas("Escaneos reales (issue #37, 2 personas x 2 escaneados)", resultadosReales);

  if (resultadosReales.length > 0) {
    const blancosLocales = [...new Set(resultadosReales.map((r) => r.blancoLocal))];
    console.log(
      `\nBlanco local muestreado por página en los escaneos reales: ${blancosLocales.map((v) => v.toFixed(1)).join(", ")} ` +
        `(en las fixtures sintéticas, para comparar: ~0, fondo casi perfectamente blanco).`
    );
    const densConReal = resultadosReales.filter((r) => r.tieneTintaReal).map((r) => r.densidad);
    const densSinReal = resultadosReales.filter((r) => !r.tieneTintaReal).map((r) => r.densidad);
    const relConReal = resultadosReales.filter((r) => r.tieneTintaReal).map((r) => r.densidad - r.blancoLocal);
    const relSinReal = resultadosReales.filter((r) => !r.tieneTintaReal).map((r) => r.densidad - r.blancoLocal);
    if (densConReal.length > 0 && densSinReal.length > 0) {
      console.log(
        `Densidad ABSOLUTA en escaneos reales — con tinta: min=${Math.min(...densConReal).toFixed(1)} max=${Math.max(...densConReal).toFixed(1)}; ` +
          `en blanco: min=${Math.min(...densSinReal).toFixed(1)} max=${Math.max(...densSinReal).toFixed(1)}.`
      );
      console.log(
        `Densidad RELATIVA al blanco local (densidad - blancoLocal, lo que de verdad compara zonaTintaCasilla) — con tinta: ` +
          `min=${Math.min(...relConReal).toFixed(1)} max=${Math.max(...relConReal).toFixed(1)}; en blanco: ` +
          `min=${Math.min(...relSinReal).toFixed(1)} max=${Math.max(...relSinReal).toFixed(1)}.`
      );
      const varConReal = resultadosReales.filter((r) => r.tieneTintaReal).map((r) => r.varianza);
      const varSinReal = resultadosReales.filter((r) => !r.tieneTintaReal).map((r) => r.varianza);
      console.log(
        `Varianza en escaneos reales — con tinta: min=${Math.min(...varConReal).toFixed(0)} max=${Math.max(...varConReal).toFixed(0)}; ` +
          `en blanco: min=${Math.min(...varSinReal).toFixed(0)} max=${Math.max(...varSinReal).toFixed(0)}.`
      );
      const separacionLimpia = Math.max(...relSinReal) < Math.min(...relConReal);
      console.log(
        separacionLimpia
          ? "Separación LIMPIA también en escaneos reales con densidad relativa al baseline adaptativo: un único corte (2 zonas) ya " +
              "bastaría para este dataset, sin necesitar una banda dudosa — aunque con muestra pequeña (2 personas), conviene ampliar " +
              "el dataset antes de decidir eliminar la zona dudosa (ver comentario del propio issue #37)."
          : "Las distribuciones se SOLAPAN incluso en densidad RELATIVA al blanco local (a diferencia de las fixtures sintéticas): la " +
              "zona dudosa de 3 zonas sigue aportando valor real sobre un único corte — consistente con el caso de producción que " +
              "motivó el issue (7.9 de densidad, justo en esta banda)."
      );
    }
    const peligrosos = resultadosReales.filter((r) => r.zona === "blanco" && r.tieneTintaReal);
    if (peligrosos.length > 0) {
      console.log("\nDetalle de los casos peligrosos (tinta real -> zona blanco):");
      for (const r of peligrosos) {
        console.log(
          `  ${r.persona} ítem ${r.itemId} ${r.lado} posición ${r.posicion + 1}: densidad=${r.densidad.toFixed(1)} ` +
            `blancoLocal=${r.blancoLocal.toFixed(1)} (relativo=${(r.densidad - r.blancoLocal).toFixed(1)}) varianza=${r.varianza.toFixed(1)}`
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
