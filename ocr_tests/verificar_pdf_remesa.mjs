// Test de regresión para generarPdfRemesa (public/admin/admin.js, "Imprimir
// remesa", issue #31): verifica el algoritmo real de merge de PDFs SIN pasar
// por el navegador (pdf-lib instalado localmente, sin necesitar CDN ni red)
// replicando exactamente lo que hace admin.js.
//
// Bug real encontrado con este mismo script antes de corregirlo: la primera
// versión de generarPdfRemesa reutilizaba el `ctx` (y por tanto el
// PDFDocument subyacente) cacheado de obtenerManifiesto() en cada vuelta del
// bucle — construirHoja añade sus páginas a ctx.pdfDoc y lo vuelca ENTERO
// con pdfDoc.save(), así que la hoja i-ésima devolvía TAMBIÉN las páginas de
// las hojas 1..i-1 ya generadas. El PDF combinado de 3 hojas de 7 páginas
// salía con 42 páginas en vez de 21, con las primeras hojas repetidas varias
// veces — nunca se habría visto en `npm test` (no hay test de UI en este
// proyecto para public/admin/) ni se pudo probar en un navegador real en
// este entorno headless (Chromium no puede cargar pdf-lib desde jsdelivr a
// través del proxy de este sandbox). Corregido creando un ctx nuevo por
// hoja (crearContextoFuentes reutiliza PDFLib/fontkit/bytes de fuente ya
// cacheados, así que el coste extra es solo volver a incrustar 2 fuentes en
// un documento nuevo, no red).
//
// Se ejecuta como parte de `npm test` (a diferencia de generar.mjs/
// probar_ocr_ia.mjs): no necesita red ni una API key, solo los ficheros
// locales del repo — tan rápido y determinista como cualquier otro test.
import { readFile } from "node:fs/promises";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import UPNGmod from "@pdf-lib/upng";
import qrGenLib from "qrcode-generator";
import { crearContextoFuentes, construirHoja, calcularManifiesto } from "../public/admin/papel/hoja.js";
import { generarExamId } from "../public/admin/papel/qr.js";

const UPNG = UPNGmod.default ?? UPNGmod;

async function nuevoContexto() {
  const fontRegularBytes = await readFile("public/admin/papel/fonts/LiberationSans-Regular.ttf");
  const fontBoldBytes = await readFile("public/admin/papel/fonts/LiberationSans-Bold.ttf");
  return crearContextoFuentes({ PDFDocument, rgb }, fontkit, UPNG, qrGenLib, fontRegularBytes, fontBoldBytes);
}

async function main() {
  const items = JSON.parse(await readFile("data/items.json", "utf8"));
  const paginasPorHoja = calcularManifiesto(await nuevoContexto(), items).length;

  const CANTIDAD = 3;
  const tokenId = "verificacion-local";
  const examIds = [];

  // Réplica exacta de generarPdfRemesa (public/admin/admin.js): un ctx
  // NUEVO por hoja, combinadas con PDFDocument.copyPages/addPage.
  const combinado = await PDFDocument.create();
  for (let i = 0; i < CANTIDAD; i++) {
    const ctxHoja = await nuevoContexto();
    const examId = generarExamId();
    examIds.push(examId);
    const { pdfBytes } = await construirHoja(ctxHoja, items, { tokenId, examId });
    const hoja = await PDFDocument.load(pdfBytes);
    const paginasCopiadas = await combinado.copyPages(hoja, hoja.getPageIndices());
    paginasCopiadas.forEach((pagina) => combinado.addPage(pagina));
  }
  const bytesCombinados = await combinado.save();

  const reabierto = await PDFDocument.load(bytesCombinados);
  const numPaginas = reabierto.getPageCount();
  const esperado = CANTIDAD * paginasPorHoja;

  if (numPaginas !== esperado) {
    console.error(
      `FALLO: el PDF combinado de ${CANTIDAD} hojas tiene ${numPaginas} páginas, se esperaban ${esperado} ` +
        `(${CANTIDAD} x ${paginasPorHoja} páginas/hoja). exam_ids: ${examIds.join(", ")}.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK: generarPdfRemesa combina ${CANTIDAD} hojas (${paginasPorHoja} páginas/hoja) en un único PDF de ` +
      `${numPaginas} páginas, sin duplicados. exam_ids: ${examIds.join(", ")}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
