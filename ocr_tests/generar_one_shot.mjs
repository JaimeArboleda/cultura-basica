// Genera el EJEMPLO de una sola vez (one-shot / few-shot) que se manda junto
// al prompt real en cada llamada de OCR-IA a páginas de tipo "items" (issue
// #31, sección "Si hay todavía alucinaciones, podemos probar a mandar un
// ejemplo de muestra"): una página ficticia con 6 preguntas — abierto,
// opción múltiple, selección múltiple, ordenar, clasificar y un segundo
// abierto — pensada para enseñarle al modelo, con un ejemplo YA RESUELTO, no
// solo con texto, los casos concretos donde seguía alucinando pese al
// refuerzo del prompt (ver ocr_tests/README.md para el historial completo de
// rondas de este mismo issue):
//
//   1. Abierto: la respuesta correcta es "JOSE DE ARIMATEA", pero Respuesta
//      lleva un nombre DISTINTO y TAMBIÉN CORTADO A MEDIAS ("JUAN EL
//      BAUTIS", sin terminar en "-TA") — el mismo patrón que "PLUSV" →
//      "PLUSVALIA" en las corridas reales (README) — mientras que Corrección
//      lleva el nombre correcto y COMPLETO ("JOSE DE ARIMATEA"). El
//      contraste entre los dos bloques (uno cortado, el otro entero) refuerza
//      que la transcripción es SIEMPRE literal carácter a carácter, tanto si
//      la palabra está completa como si no — nunca completar lo que está a
//      medias, nunca acortar lo que está entero.
//   2. Opción múltiple: ambos bloques (Respuesta y Corrección) están
//      COMPLETAMENTE en blanco — enseña que la salida correcta es null en
//      los dos, nunca una letra inventada (el patrón de alucinación más
//      claro encontrado en las corridas anteriores).
//   3. Selección múltiple: una casilla vacía en medio de la selección, en
//      ambos bloques — enseña a transcribir el espacio literal en vez de
//      "cerrar el hueco" o completar hacia el conjunto que se supone
//      correcto.
//   4. Ordenar: Respuesta y Corrección son dos secuencias COMPLETAS pero
//      ambas incorrectas y distintas entre sí — enseña a transcribir cada
//      secuencia tal cual está, sin intentar "arreglarla" hacia el orden que
//      se supone correcto.
//   5. Clasificar: un elemento (posición 3) queda SIN clasificar en los DOS
//      bloques (ni Respuesta ni Corrección le asignan categoría) — enseña
//      que un elemento salteado es cadena vacía en esa posición del
//      diccionario, no una letra inventada, mismo principio que la pregunta
//      3 (selección múltiple) pero aplicado a "clasificar". Otro elemento
//      (posición 4) SÍ tiene una corrección real y distinta entre bloques
//      (Ave -> Reptil), para que el ejemplo también enseñe una corrección
//      genuina en este formato, no solo blancos o coincidencias.
//   6. Abierto (segundo): Respuesta tiene contenido pero Corrección está
//      COMPLETAMENTE en blanco — enseña que correccion es null cuando no hay
//      nada escrito ahí, sin inventar una corrección ni "arreglar" lo que
//      dice Respuesta aunque parezca incorrecto.
//
// Las 6 preguntas usan contenido DISTINTO al banco real (data/items.json,
// issue #31: "una página de ejemplo con preguntas diferentes a las del
// test") y se numeran 1-6 en la propia imagen — números que SÍ coinciden con
// los de una página real del examen, pero el texto de acompañamiento
// (USER_PROMPT_EJEMPLO, el mensaje que rodea la imagen, no lo que está
// impreso en ella) dice explícitamente que es un ejemplo aparte (mismo
// patrón de separación por turnos de conversación que cualquier few-shot:
// ver worker/src/endpoints/admin/ocrIaEjemplo.ts, que es quien realmente lo
// inyecta en la llamada a la API). Los enunciados NO llevan ninguna etiqueta
// "(EJEMPLO)" ni aclaración de ese estilo IMPRESA en la página — cuanto más
// se parezca a una página real, mejor transfiere el ejemplo.
//
// Este script deja los artefactos en ocr_tests/one_shot_example/ (imagen,
// prompt de usuario, respuesta esperada, definición de los ítems) para poder
// inspeccionarlos/iterar sin tener que decodificar el módulo TS generado, y
// además regenera ese módulo TS que sí usa el Worker en producción
// (worker/src/endpoints/admin/ocrIaEjemplo.ts) — los dos SIEMPRE deben venir
// de la misma corrida de este script, nunca editados a mano por separado.
//
// Uso: node ocr_tests/generar_one_shot.mjs
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import UPNGmod from "@pdf-lib/upng";
import qrGenLib from "qrcode-generator";
import { crearContextoFuentes, construirHoja } from "../public/admin/papel/hoja.js";

const UPNG = UPNGmod.default ?? UPNGmod;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");
const DIR_SALIDA = path.join(RAIZ_REPO, "ocr_tests", "one_shot_example");
const RUTA_MODULO_WORKER = path.join(RAIZ_REPO, "worker/src/endpoints/admin/ocrIaEjemplo.ts");

// Misma fuente "clara" que la persona 01-letra-clara de generar.mjs: letra
// fácil de leer a propósito — este ejemplo enseña un COMPORTAMIENTO
// (transcripción literal, null en blancos), no pone a prueba la robustez de
// lectura, así que no interesa mezclar ambas cosas.
const FUENTE_INK_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf";

// ============================================================
// Las 6 preguntas del ejemplo (ver cabecera del fichero para el porqué de
// cada una) — contenido deliberadamente distinto al banco real.
// ============================================================
const ITEMS_EJEMPLO = [
  {
    id: "ejemplo-abierto-1",
    formato: "abierto",
    enunciado: "¿Quién, según los evangelios, cedió su propia tumba para el entierro de Jesús de Nazaret?",
    casillas_abierto: 20,
  },
  {
    id: "ejemplo-opcion-multiple",
    formato: "opcion_multiple",
    enunciado: "¿Cuál de estos NO es un océano?",
    opciones: ["Pacífico", "Atlántico", "Índico", "Ártico", "Amazonas"],
  },
  {
    id: "ejemplo-seleccion-multiple",
    formato: "seleccion_multiple",
    enunciado: "Marca TODAS las capitales de país entre estas ciudades:",
    opciones: ["Madrid", "Lisboa", "Barcelona", "Múnich", "Roma"],
    num_correctas: 3, // A=Madrid, B=Lisboa, E=Roma — el alumno del ejemplo no acierta el conjunto completo en ninguno de los dos bloques (ver más abajo), a propósito.
  },
  {
    id: "ejemplo-ordenar",
    formato: "ordenar",
    enunciado: "Ordena estos países de mayor a menor superficie:",
    elementos: ["Rusia", "Canadá", "España", "Francia"],
  },
  {
    id: "ejemplo-clasificar",
    formato: "clasificar",
    enunciado: "Clasifica estos animales según su clase: mamífero, ave o reptil:",
    elementos: ["Águila", "Delfín", "Murciélago", "Serpiente"],
    categorias: ["Mamífero", "Ave", "Reptil"],
  },
  {
    id: "ejemplo-abierto-2",
    formato: "abierto",
    enunciado: "¿Cuál es la capital de Australia?",
    casillas_abierto: 16,
  },
];

// sintetico.respuesta/correccion: string para abierto/opcion_multiple/
// seleccion_multiple (se expande carácter a carácter, un espacio = casilla
// en blanco), array para ordenar/clasificar (una entrada por posición/
// elemento, "" = en blanco) — misma forma que ocr_tests/generar.mjs, ver
// hoja.js::construirBloqueItem.
const RESPUESTAS_SINTETICAS = {
  items: {
    "ejemplo-abierto-1": { respuesta: "JUAN EL BAUTIS", correccion: "JOSE DE ARIMATEA" },
    "ejemplo-opcion-multiple": { respuesta: "", correccion: "" },
    "ejemplo-seleccion-multiple": { respuesta: "A E", correccion: "A B" },
    "ejemplo-ordenar": { respuesta: ["C", "D", "B", "A"], correccion: ["D", "A", "C", "B"] },
    // Águila y Delfín coinciden en ambos bloques (Ave/Mamífero, sin cambios);
    // Murciélago (posición 3) queda SIN clasificar en los dos bloques
    // (elemento salteado, no un error a corregir) — enseña que un elemento
    // sin clasificar es cadena vacía, no una letra inventada, igual que una
    // casilla vacía en medio de una selección múltiple (pregunta 3).
    // Serpiente (posición 4) SÍ tiene una corrección real y distinta entre
    // bloques (Ave -> Reptil) — para que el ejemplo también muestre una
    // corrección genuina en "clasificar", no solo casos que coinciden o que
    // quedan en blanco.
    "ejemplo-clasificar": { respuesta: ["B", "A", "", "B"], correccion: ["B", "A", "", "C"] },
    "ejemplo-abierto-2": { respuesta: "SYDNEY", correccion: "" },
  },
};

// La respuesta que DEBE devolver el modelo para este ejemplo — es lo que se
// manda como turno "assistant" (few-shot), en el mismo formato exacto que
// SYSTEM_PROMPT_ITEMS pide para la respuesta real (worker/src/endpoints/
// admin/ocrIa.ts). Construida a mano (no desde RESPUESTAS_SINTETICAS) para
// que quede explícito y auditable qué se le está enseñando al modelo.
const RESPUESTA_ESPERADA = {
  1: { respuesta_inicial: "JUAN EL BAUTIS", correccion: "JOSE DE ARIMATEA" },
  2: { respuesta_inicial: null, correccion: null },
  3: { respuesta_inicial: "A E", correccion: "A B" },
  4: {
    respuesta_inicial: { 1: "C", 2: "D", 3: "B", 4: "A" },
    correccion: { 1: "D", 2: "A", 3: "C", 4: "B" },
  },
  5: {
    respuesta_inicial: { 1: "B", 2: "A", 3: "", 4: "B" },
    correccion: { 1: "B", 2: "A", 3: "", 4: "C" },
  },
  6: { respuesta_inicial: "SYDNEY", correccion: null },
};

// Mismo texto que construirContenidoPagina/describirFormatoItemBreve
// (worker/src/endpoints/admin/ocrIa.ts) para las páginas reales, pero
// duplicado a propósito aquí (igual que LETRAS/CATALOGOS entre worker/ y
// public/, README §2): este script es Node/ESM fuera del Worker y genera el
// prompt UNA VEZ, guardado en disco — no necesita importar TypeScript en
// caliente, solo que el texto describa fielmente lo que de verdad dibuja
// hoja.js para estos 4 ítems concretos.
const USER_PROMPT_EJEMPLO =
  "Este es un EJEMPLO ya resuelto, de una hoja distinta e independiente a la que vas a leer después (con su propia " +
  "numeración 1-6, sin relación con los números de la página real) — solo sirve para que veas exactamente cómo se " +
  "transcribe cada caso, incluida la respuesta correcta que sigue en este mismo turno. Fíjate especialmente en:\n" +
  '- Pregunta 1 (abierto): Respuesta lleva un nombre DISTINTO y TAMBIÉN CORTADO A MEDIAS ("JUAN EL BAUTIS", sin ' +
  'terminar), y Corrección lleva el nombre correcto y COMPLETO ("JOSE DE ARIMATEA") — ninguna de las dos palabras ' +
  "se completa ni se acorta: la de Respuesta se queda a medias tal cual está, y la de Corrección se transcribe " +
  "entera tal cual está. La transcripción es SIEMPRE literal, letra a letra, tanto si la palabra está completa " +
  "como si no — nunca completar lo que está cortado, nunca acortar lo que está entero.\n" +
  "- Pregunta 2 (opción múltiple): las dos casillas, Respuesta y Corrección, están COMPLETAMENTE en blanco — la " +
  "respuesta correcta es null en ambas, nunca una letra inventada.\n" +
  "- Pregunta 3 (selección múltiple): hay una casilla vacía en medio de la selección, en los dos bloques — se " +
  "transcribe como un espacio literal en esa posición, sin cerrar el hueco ni añadir la letra que falta.\n" +
  "- Pregunta 4 (ordenar): Respuesta y Corrección son dos secuencias COMPLETAS, pero ninguna de las dos es la " +
  'ordenación correcta ni coinciden entre sí — se transcribe cada una tal cual está, sin "arreglarla" hacia el ' +
  "orden que se supone correcto.\n" +
  "- Pregunta 5 (clasificar): el elemento de la posición 3 (Murciélago) queda SIN clasificar en los DOS bloques — " +
  "ni Respuesta ni Corrección le asignan ninguna categoría. Esa posición es cadena vacía en el diccionario de las " +
  "dos respuestas, nunca una categoría inventada — mismo principio que la casilla vacía de la pregunta 3, " +
  "aplicado aquí a \"clasificar\". El elemento de la posición 4 (Serpiente), en cambio, SÍ tiene una corrección " +
  "real: Respuesta dice \"B\" (Ave) y Corrección lo cambia a \"C\" (Reptil) — dos valores distintos, cada uno " +
  "transcrito tal cual está en su propio bloque, sin copiar el valor de uno al otro.\n" +
  "- Pregunta 6 (abierto): Respuesta tiene contenido pero Corrección está COMPLETAMENTE en blanco — Corrección es " +
  "null, sin inventar una corrección ni cambiar lo escrito en Respuesta aunque te parezca incorrecto: tu trabajo " +
  "es transcribir, no corregir.\n\n" +
  "Debes digitalizar esta página EJEMPLO, en el JSON ya especificado, que contiene los siguientes ítems:\n" +
  "- Pregunta 1: Abierto.\n" +
  "- Pregunta 2: Opción múltiple, entre A y E.\n" +
  "- Pregunta 3: Selección múltiple, con opciones entre A y E.\n" +
  "- Pregunta 4: Ordenar 4 elementos (letras A-D) en las posiciones 1-4.\n" +
  "- Pregunta 5: Clasificar 4 elementos (números 1-4) en categorías entre A y C.\n" +
  "- Pregunta 6: Abierto.\n\n" +
  'Para cada pregunta debes transcribir tanto "Respuesta" como "Corrección", exactamente como en la respuesta que ' +
  "sigue a continuación — luego te tocará hacer lo mismo con la página real.";

async function descargarFuenteInk() {
  const resp = await fetch(FUENTE_INK_URL);
  if (!resp.ok) throw new Error(`No se pudo descargar la fuente de tinta: HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// Duplicado de ocr_tests/generar.mjs (mismo motivo de siempre: script Node
// aparte, sin módulo compartido entre scripts de generación).
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

async function rasterizarPdf(page, baseUrl, pdfBytesBase64, escala) {
  return page.evaluate(
    async ({ baseUrl, pdfBytesBase64, escala }) => {
      const pdfjsLib = await import(`${baseUrl}/node_modules/pdfjs-dist/build/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${baseUrl}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`;
      const binario = atob(pdfBytesBase64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      const dataUrls = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pagina = await doc.getPage(i);
        const viewport = pagina.getViewport({ scale: escala });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await pagina.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        dataUrls.push(canvas.toDataURL("image/png"));
      }
      return dataUrls;
    },
    { baseUrl, pdfBytesBase64, escala }
  );
}

// Efecto de escaneo/foto MUY leve (mismos parámetros que la persona
// "01-letra-clara" de generar.mjs) — este ejemplo enseña un comportamiento,
// no pone a prueba la robustez de lectura, así que interesa que quede
// legible, pero tampoco un render digital perfecto que nunca se parecería a
// una foto real (la distribución de las imágenes reales SIEMPRE tiene algo
// de ruido/inclinación).
async function capturarConEfecto(page, dataUrlEntrada, opciones) {
  return page.evaluate(
    async ({ dataUrl, opciones }) => {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      const margen = Math.ceil(Math.max(img.width, img.height) * 0.03);
      canvas.width = img.width + margen * 2;
      canvas.height = img.height + margen * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.filter = `blur(${opciones.blur}px)`;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((opciones.angulo * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      ctx.filter = "none";

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const ruido = (Math.random() - 0.5) * opciones.ruido * 255;
        d[i] = Math.min(255, Math.max(0, d[i] + ruido));
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + ruido));
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + ruido));
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/jpeg", opciones.calidad);
    },
    { dataUrl: dataUrlEntrada, opciones }
  );
}

function tsEscaparCadena(s) {
  return JSON.stringify(s);
}

async function main() {
  await mkdir(DIR_SALIDA, { recursive: true });

  const fontRegularBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Regular.ttf"));
  const fontBoldBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Bold.ttf"));
  console.log("Descargando fuente de tinta manuscrita…");
  const fuenteInkBytes = await descargarFuenteInk();

  const PDFLib = { PDFDocument, rgb };
  const ctx = await crearContextoFuentes(PDFLib, fontkit, UPNG, qrGenLib, fontRegularBytes, fontBoldBytes);
  ctx.fontInk = await ctx.pdfDoc.embedFont(fuenteInkBytes, { subset: true });
  ctx.colorInk = rgb(0.08, 0.1, 0.5);

  // tokenId/examId ficticios (nunca se usan para nada real, esta página no
  // pasa por el pipeline de escaneo/QR — se manda directa a la API), solo
  // para que construirHoja tenga algo que codificar en los QR de la imagen.
  const { pdfBytes, manifiesto } = await construirHoja(
    ctx,
    ITEMS_EJEMPLO,
    { tokenId: "EJEMPLO-ONE-SHOT", examId: "EJEMPLO0" },
    undefined,
    RESPUESTAS_SINTETICAS
  );

  // construirHoja siempre antepone la(s) página(s) de demografía (aunque
  // vayan vacías) antes de las de ítems (hoja.js::calcularManifiesto) — nos
  // quedamos solo con la ÚLTIMA página (las 4 preguntas caben en una sola
  // página de sobra), que es la de ítems; se descarta la de demografía.
  const indicePagina = manifiesto.length - 1;
  if (manifiesto[indicePagina].tipo !== "items") {
    throw new Error(`Se esperaba que la última página fuera de tipo "items", fue "${manifiesto[indicePagina].tipo}"`);
  }

  const chromiumPreinstalado = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(fs.existsSync(chromiumPreinstalado) ? { executablePath: chromiumPreinstalado } : {});
  const servidor = await iniciarServidorEstatico();
  let jpegBytes;
  try {
    const puerto = servidor.address().port;
    const baseUrl = `http://127.0.0.1:${puerto}`;
    const paginaRender = await browser.newPage();
    await paginaRender.goto(`${baseUrl}/__vacio.html`);
    const pdfBytesBase64 = Buffer.from(pdfBytes).toString("base64");
    const pngDataUrls = await rasterizarPdf(paginaRender, baseUrl, pdfBytesBase64, 2.5);
    await paginaRender.close();

    const efectoPage = await browser.newPage();
    const jpegDataUrl = await capturarConEfecto(efectoPage, pngDataUrls[indicePagina], {
      angulo: 0.3,
      ruido: 0.03,
      blur: 0.12,
      calidad: 0.92,
    });
    await efectoPage.close();
    jpegBytes = Buffer.from(jpegDataUrl.split(",")[1], "base64");
  } finally {
    await browser.close();
    servidor.close();
  }

  await writeFile(path.join(DIR_SALIDA, "pagina.jpg"), jpegBytes);
  await writeFile(path.join(DIR_SALIDA, "user_prompt.txt"), USER_PROMPT_EJEMPLO);
  await writeFile(path.join(DIR_SALIDA, "respuesta_esperada.json"), JSON.stringify(RESPUESTA_ESPERADA, null, 2));
  await writeFile(
    path.join(DIR_SALIDA, "items.json"),
    JSON.stringify({ items: ITEMS_EJEMPLO, respuestas_sinteticas: RESPUESTAS_SINTETICAS }, null, 2)
  );
  console.log(`Escrito ${DIR_SALIDA}/ (pagina.jpg, user_prompt.txt, respuesta_esperada.json, items.json)`);

  const dataUrlBase64 = `data:image/jpeg;base64,${jpegBytes.toString("base64")}`;
  const moduloTs = `// GENERADO por ocr_tests/generar_one_shot.mjs — no editar a mano.
// Reejecuta \`node ocr_tests/generar_one_shot.mjs\` para regenerar este fichero
// junto con ocr_tests/one_shot_example/ (imagen + prompt + respuesta en
// texto plano, para poder inspeccionar/iterar sin decodificar el base64 de
// aquí abajo). Ver ocr_tests/one_shot_example/ y el propio script para el
// razonamiento de cada una de las 4 preguntas de este ejemplo (issue #31).
//
// Inyectado por postOcrIa (worker/src/endpoints/admin/ocrIa.ts) como un
// turno user+assistant adicional ANTES de la página real, solo en
// peticiones que incluyen alguna página de tipo "items" (el ejemplo no
// aplica a demografía, que ya mide 100% de acierto sin él).

export const EJEMPLO_UNO_DISPARO_USER_PROMPT = ${tsEscaparCadena(USER_PROMPT_EJEMPLO)};

export const EJEMPLO_UNO_DISPARO_IMAGEN_DATA_URL = ${tsEscaparCadena(dataUrlBase64)};

export const EJEMPLO_UNO_DISPARO_RESPUESTA_JSON = ${tsEscaparCadena(JSON.stringify(RESPUESTA_ESPERADA))};
`;
  await writeFile(RUTA_MODULO_WORKER, moduloTs);
  console.log(`Escrito ${RUTA_MODULO_WORKER}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
