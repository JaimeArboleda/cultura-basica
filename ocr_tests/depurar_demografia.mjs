// Depuración/regresión de la lectura OCR de la demografía (año de
// nacimiento + catálogos de letra en v2): a diferencia de generar.mjs (que
// PINTA hojas de prueba), este script las LEE con el pipeline real
// (comun.js::detectarFiduciales/warpearImagen/recortarLinea, vía
// ./lectura_harness.html en un Chromium real) y compara el resultado del OCR
// contra respuestas-esperadas.json de cada instancia — el mismo tipo de
// comparación que el panel de admin muestra en la pantalla de confirmación
// (v{1,2}/digitalizar.js::renderConfirmacionYCrear), pero automatizada y con
// el recorte exacto que ve Tesseract volcado a disco en
// ocr_tests/_debug_output/, para ver a qué se debe cada fallo sin repetir el
// escaneo a mano en el navegador.
//
// El recorte/homografía se hace en el navegador (no necesita red: ver
// lectura_harness.html) y el reconocimiento con tesseract.js se hace aquí en
// Node, directamente sobre los PNG que devuelve el navegador — evita que
// Chromium en este entorno no herede HTTPS_PROXY (ver la nota en generar.mjs
// junto a qrcodeJsUrl) sin tener que interceptar rutas para el CDN de
// Tesseract.
//
// Uso: node ocr_tests/depurar_demografia.mjs [instancia...]
// Sin argumentos: las 3 instancias. Necesita NODE_USE_ENV_PROXY=1 si la red
// saliente solo está disponible vía HTTPS_PROXY (el fetch nativo de Node no
// lo respeta por defecto — a diferencia de Chromium, que en este script no
// necesita red en absoluto).
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWorker } from "tesseract.js";
import { CATALOGOS } from "../public/js/demografia.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");
const DIR_SALIDA = path.join(__dirname, "_debug_output");

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// [campo de demografía -> catálogo] igual que CAMPOS_CATALOGO en
// v2/digitalizar.js (v1 no OCR-ea catálogos, solo anio_nacimiento por OCR).
const CAMPO_A_CATALOGO = {
  sexo: "sexo",
  ccaa_educacion_secundaria: "ccaa",
  nivel_estudios: "nivel_estudios",
  area_estudios: "area_estudios",
  estudios_mayor_progenitor: "nivel_estudios",
  libros_en_casa: "libros_en_casa",
};

function primeraLetra(texto, limiteExclusivo) {
  for (const ch of texto) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) return idx;
  }
  return null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
};

function iniciarServidorEstatico() {
  const servidor = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rutaFs = path.join(RAIZ_REPO, urlPath);
      if (!rutaFs.startsWith(RAIZ_REPO)) return res.writeHead(403).end();
      const datos = await readFile(rutaFs);
      res.writeHead(200, { "Content-Type": MIME[path.extname(rutaFs)] || "application/octet-stream" });
      res.end(datos);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(servidor)));
}

async function main() {
  const instanciasPedidas = process.argv.slice(2);
  const todasInstancias = ["01-limpia", "02-con-correcciones", "03-descuidada-incompleta"];
  const instancias = instanciasPedidas.length ? instanciasPedidas : todasInstancias;

  await rm(DIR_SALIDA, { recursive: true, force: true });
  await mkdir(DIR_SALIDA, { recursive: true });

  const servidor = await iniciarServidorEstatico();
  const puerto = servidor.address().port;

  const chromiumPreinstalado = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(existsSync(chromiumPreinstalado) ? { executablePath: chromiumPreinstalado } : {});
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("[harness]", err.message));
  await page.goto(`http://127.0.0.1:${puerto}/ocr_tests/lectura_harness.html`);
  await page.waitForFunction(() => window.__harnessListo === true);

  const worker = await createWorker("spa");
  async function ocrLinea(dataUrl, { soloDigitos = false } = {}) {
    const whitelist = soloDigitos ? "0123456789" : LETRAS;
    await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: whitelist });
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    const { data } = await worker.recognize(buf);
    return { texto: (data.text || "").trim(), buf };
  }

  const filas = [];

  for (const version of [1, 2]) {
    for (const instancia of instancias) {
      const rutaEsperadas = path.join(RAIZ_REPO, "ocr_tests", `v${version}`, instancia, "respuestas-esperadas.json");
      let esperadas;
      try {
        esperadas = JSON.parse(await readFile(rutaEsperadas, "utf8"));
      } catch {
        continue; // instancia sin generar para esta versión
      }

      const recortes = await page.evaluate(([v, p]) => window.recortarDemografia(v, p), [version, instancia]);
      for (const k of Object.keys(recortes).filter((k) => k.startsWith("__error_"))) {
        console.error(`v${version}/${instancia}: ${k} -> ${recortes[k]}`);
      }

      for (const [campo, esperado] of Object.entries(esperadas.demografia)) {
        const dataUrl = recortes[`demografia:${campo}`];
        if (!dataUrl) continue; // campo no leído por OCR en esta versión (catálogo OMR en v1) o booleano (consentimiento/compromiso)

        const soloDigitos = campo === "anio_nacimiento";
        const { texto, buf } = await ocrLinea(dataUrl, { soloDigitos });

        let leido, ok;
        if (soloDigitos) {
          leido = texto.replace(/\D/g, "");
          ok = leido === String(esperado);
        } else {
          const catalogo = CATALOGOS[CAMPO_A_CATALOGO[campo]];
          const idx = primeraLetra(texto, catalogo.length);
          leido = idx != null ? catalogo[idx] : null;
          ok = leido === esperado;
        }

        const nombreArchivo = `v${version}-${instancia}-${campo}${ok ? "" : "-FALLO"}.png`;
        await writeFile(path.join(DIR_SALIDA, nombreArchivo), buf);

        filas.push({ version, instancia, campo, esperado, ocr_crudo: texto, leido, ok });
      }
    }
  }

  await worker.terminate();
  await browser.close();
  servidor.close();

  console.log("\n=== Resultado por campo ===");
  const anchoInstancia = Math.max(...filas.map((f) => f.instancia.length));
  const anchoCampo = Math.max(...filas.map((f) => f.campo.length));
  for (const f of filas) {
    const marca = f.ok ? "OK" : "FALLO";
    console.log(
      `${marca.padEnd(5)} v${f.version}  ${f.instancia.padEnd(anchoInstancia)}  ${f.campo.padEnd(anchoCampo)}  esperado=${JSON.stringify(f.esperado).padEnd(20)} ocr_crudo=${JSON.stringify(f.ocr_crudo).padEnd(8)} leido=${JSON.stringify(f.leido)}`
    );
  }
  const aciertos = filas.filter((f) => f.ok).length;
  console.log(`\n${aciertos}/${filas.length} campos correctos.`);
  console.log(`Recortes guardados en ${DIR_SALIDA} (uno por campo; los fallos llevan sufijo -FALLO en el nombre).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
