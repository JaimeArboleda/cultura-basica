// Códigos QR de la hoja (README §4.9/§4.10): generación (para incrustar en el
// PDF, hoja.js) y lectura (para identificar una foto al digitalizar,
// comun.js/digitalizar.js/subirLote.js) — agrupadas aquí porque son la
// contrapartida exacta una de otra (mismo payload en los dos sentidos).
//
// qrcode-generator y jsQR no se publican como módulos ES en el CDN (son
// scripts clásicos que cuelgan una global de window) — se cargan con una
// etiqueta <script> normal en vez de import() dinámico, y se lee la global
// una vez cargada. En Node (scripts de generación de fixtures, ocr_tests/)
// se cargan como paquetes npm normales — ver el `cargador` inyectado por el
// llamador en generarQrPngBytes/decodificarQr.

// nombreGlobal (p. ej. "jsQR"): se comprueba ANTES de tocar el DOM y
// timeoutMs asegura que esto nunca se quede colgado sin más si la red va
// lenta o el CDN no responde ni con éxito ni con error.
function cargarScript(src, nombreGlobal, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (window[nombreGlobal]) return resolve();
    const script = document.querySelector(`script[src="${src}"]`) ?? document.createElement("script");
    const yaEstaba = script.isConnected;
    const temporizador = setTimeout(() => {
      script.remove();
      reject(new Error(`Tiempo de espera agotado cargando ${src} (¿sin red o el CDN no responde?)`));
    }, timeoutMs);
    script.addEventListener("load", () => {
      clearTimeout(temporizador);
      resolve();
    });
    script.addEventListener("error", () => {
      clearTimeout(temporizador);
      script.remove();
      reject(new Error(`No se pudo cargar ${src}`));
    });
    if (!yaEstaba) {
      script.src = src;
      document.head.appendChild(script);
    }
  });
}

let promesaQrGen = null;
async function obtenerQrGenNavegador() {
  if (!promesaQrGen) {
    promesaQrGen = cargarScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js", "qrcode").then(
      () => window.qrcode
    );
  }
  try {
    return await promesaQrGen;
  } catch (e) {
    promesaQrGen = null;
    throw e;
  }
}

let promesaJsQr = null;
async function obtenerJsQrNavegador() {
  if (!promesaJsQr) {
    promesaJsQr = cargarScript("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js", "jsQR").then(() => window.jsQR);
  }
  try {
    return await promesaJsQr;
  } catch (e) {
    promesaJsQr = null;
    throw e;
  }
}

// Matriz de módulos (booleanos) del QR de `texto`, sin depender de ningún
// canvas/DOM — sirve tanto para pintar en un <canvas> (navegador) como para
// escribir directamente píxeles en un PNG (hoja.js con pdf-lib, Node o
// navegador). typeNumber 0 = tamaño automático; nivel M = equilibrio
// razonable entre tamaño y tolerancia a manchas/dobleces del papel.
export async function generarMatrizQr(texto, qrGenInyectado) {
  const qrcodeLib = qrGenInyectado ?? (await obtenerQrGenNavegador());
  const qr = qrcodeLib(0, "M");
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const modulos = [];
  for (let y = 0; y < n; y++) {
    const fila = [];
    for (let x = 0; x < n; x++) fila.push(qr.isDark(y, x));
    modulos.push(fila);
  }
  return modulos;
}

// PNG en crudo (1 byte por canal, sin compresión) de una matriz de módulos,
// escalada a `pxPorModulo` — implementación mínima propia (sin depender de
// pdf-lib, que solo sabe DECODIFICAR PNG, no crear uno) usando UPNG.js, que
// pdf-lib ya trae como dependencia transitiva (`node_modules/pdf-lib` usa
// `@pdf-lib/upng` internamente) — se reutiliza aquí en vez de añadir una
// dependencia nueva solo para esto.
export async function matrizQrAPng(modulos, pxPorModulo, UPNG) {
  const n = modulos.length;
  const lado = n * pxPorModulo;
  const datos = new Uint8Array(lado * lado * 4);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const oscuro = modulos[Math.floor(y / pxPorModulo)][Math.floor(x / pxPorModulo)];
      const i = (y * lado + x) * 4;
      const v = oscuro ? 0 : 255;
      datos[i] = v;
      datos[i + 1] = v;
      datos[i + 2] = v;
      datos[i + 3] = 255;
    }
  }
  return UPNG.encode([datos.buffer], lado, lado, 0);
}

// Decodifica el QR de un recorte ya enderezado (ImageData o {data,width,height}
// equivalente). Devuelve el texto o null si no se pudo leer.
export async function decodificarQr(imageDataOCanvas, jsQrInyectado) {
  const jsQR = jsQrInyectado ?? (await obtenerJsQrNavegador());
  const imageData =
    "getContext" in imageDataOCanvas
      ? imageDataOCanvas.getContext("2d").getImageData(0, 0, imageDataOCanvas.width, imageDataOCanvas.height)
      : imageDataOCanvas;
  const resultado = jsQR(imageData.data, imageData.width, imageData.height);
  return resultado ? resultado.data : null;
}

// Alfabeto sin caracteres ambiguos al leer a mano (sin 0/O, 1/I/L...) — mismo
// criterio que Crockford Base32, para exam_id y para que un admin pueda
// teclearlo sin dudar si falla la lectura del QR (README §4.10).
const ALFABETO_EXAM_ID = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// Identificador de una hoja física concreta (README §4.10), distinto del
// token_id de la remesa. Deliberadamente corto (8 caracteres, ~2^39
// combinaciones — de sobra para un piloto) para que el QR pequeño de página
// (codificarPayloadQrPagina) quede con módulos grandes y legibles a ese
// tamaño físico (10mm).
export function generarExamId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const b of bytes) id += ALFABETO_EXAM_ID[b % ALFABETO_EXAM_ID.length];
  return id;
}

// Payload del QR GRANDE (solo página 1, README §4.9/§4.10): SOLO el token_id
// de la remesa, en texto plano (sin JSON, sin versión, sin exam_id/página —
// eso viaja en el QR pequeño de página, en todas las páginas). Antes incluía
// también versión/exam_id/página; se simplificó porque lo único que hace
// falta resolver desde el QR grande es la remesa (README §4.9, "por qué dos
// QR y no uno solo").
export function codificarPayloadQr({ tokenId }) {
  return tokenId;
}

export function decodificarPayloadQr(texto) {
  return { tokenId: texto };
}

// Payload del QR PEQUEÑO de página (README §4.10, en TODAS las páginas):
// deliberadamente solo {exam_id, pagina} — token_id/versión solo hacen falta
// una vez, al ver la primera página de un exam_id nuevo. Claves de una letra
// a propósito, mismo motivo de tamaño que generarExamId().
export function codificarPayloadQrPagina({ examId, pagina }) {
  return JSON.stringify({ u: examId, p: pagina });
}

export function decodificarPayloadQrPagina(texto) {
  try {
    const obj = JSON.parse(texto);
    if (obj && typeof obj.u === "string" && typeof obj.p === "number") {
      return { examId: obj.u, pagina: obj.p };
    }
  } catch {
    // QR ilegible o de formato inesperado: el llamador cae a resolución manual
  }
  return null;
}
