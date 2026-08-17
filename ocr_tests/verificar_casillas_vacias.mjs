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
//      trabajo pendiente #1 — nueva).
//   4. Muestrea la densidad de tinta del interior de cada casilla (con un
//      margen para no coger el borde dibujado ni tinta de la casilla vecina).
//   5. Compara "¿hay tinta?" contra el ground truth EXACTO de qué casillas
//      dibujó generar.mjs con contenido (generar.mjs::construirPlan,
//      reproducido aquí con la misma semilla determinista — sin volver a
//      generar ninguna imagen).
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
        const casillas = geometriaPorPagina[i];
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

            return { densidades, produccion: produccion.map((c) => ({ itemId: c.itemId, lado: c.lado, posicion: c.posicion, tieneTinta: c.tieneTinta })) };
          },
          { baseUrl, jpegBase64, rects, destW: Math.round(PAGE_W * ESCALA_DIGITALIZACION), destH: Math.round(PAGE_H * ESCALA_DIGITALIZACION) }
        );

        if (salida.error) {
          fallosWarp.push({ persona: persona.id, pagina: i + 1, error: salida.error });
          console.log(`  [${persona.id}] página ${i + 1}: FALLO AL ENDEREZAR (${salida.error})`);
          continue;
        }

        const produccionPorClave = new Map(salida.produccion.map((c) => [`${c.itemId}:${c.lado}:${c.posicion}`, c.tieneTinta]));
        for (const dcasilla of salida.densidades) {
          const planItem = plan.planItems[dcasilla.itemId];
          const tieneTintaReal =
            dcasilla.lado === "respuesta"
              ? Boolean(planItem.respuesta[dcasilla.posicion])
              : planItem.correccion != null && Boolean(planItem.correccion[dcasilla.posicion]);
          const tieneTintaProduccion = produccionPorClave.get(`${dcasilla.itemId}:${dcasilla.lado}:${dcasilla.posicion}`);
          resultados.push({ persona: persona.id, ...dcasilla, tieneTintaReal, tieneTintaProduccion });
        }
      }
      console.log(`  [${persona.id}] procesada.`);
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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
