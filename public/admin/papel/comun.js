// Helpers compartidos del pipeline de digitalización en papel (README §4.7/
// §4.9): homografía, detección de fiduciales, decodificación de los 2 QR y
// carga de las librerías que solo hacen falta en el navegador (pdf-lib,
// fontkit, UPNG — para generar la hoja, ver ./hoja.js — y pdf.js, para la
// subida en bloque de PDFs ya escaneados).
//
// Todo lo que existía aquí SOLO para soportar OMR (clasificar QUÉ letra había
// en una casilla por oscuridad) o el recorte de una casilla de texto para
// Tesseract se ha retirado: ya no hay ningún motor que lea recortes — la hoja
// entera se manda a OCR-IA (worker/src/endpoints/admin/ocrIa.ts). El muestreo
// de densidad que queda (detección de fiduciales, y desde issue #35 también
// detectarTintaCasillas más abajo) resuelve un problema mucho más simple —
// tinta sí/no, nunca qué letra hay — y solo restringe el esquema de OCR-IA
// para las posiciones ya sabidas en blanco, nunca sustituye la lectura del
// modelo. Lo que de verdad hace falta leer de la FOTO en el navegador son los
// dos códigos QR (para saber a qué examen/página/remesa pertenece) y la
// homografía para producir una imagen bien enderezada que mandar al modelo.
// Lo mismo con el paginado por medición del DOM (antes aquí, con
// `data/build-paginacion.mjs` como parche para hacerlo determinista):
// sustituido por ./hoja.js (pdf-lib, aritmética pura sobre métricas de fuente
// reales), así que tampoco queda nada de eso.
import {
  cajaQrGrande,
  cajaQrPagina,
  ESCALA_DIGITALIZACION,
  fiducialesFijos,
  PADDING_MM,
  PAGE_H_MM,
  PAGE_W_MM,
  PT_POR_MM,
  PX_POR_MM,
} from "./geometria.js";
import { decodificarQr } from "./qr.js";

export { ESCALA_DIGITALIZACION };

// ============================================================
// Carga bajo demanda de las librerías que solo hacen falta en el navegador
// (mismo patrón que Tesseract.js/jsQR antes: CDN, no node_modules — este
// proyecto no tiene bundler para public/). "+esm" le pide a jsDelivr que
// sirva cada paquete ya convertido a ES module con exports nombrados
// (necesario para pdf-lib: PDFDocument, rgb...; para @pdf-lib/fontkit y
// @pdf-lib/upng, cuyo build solo trae un default, se toma ese).
// ============================================================

const VERSION_PDF_LIB = "1.17.1";
const VERSION_FONTKIT = "1.1.1";
const VERSION_UPNG = "1.0.1";

let promesaPdfLib = null;
export async function obtenerPdfLib() {
  if (!promesaPdfLib) promesaPdfLib = import(`https://cdn.jsdelivr.net/npm/pdf-lib@${VERSION_PDF_LIB}/+esm`);
  try {
    return await promesaPdfLib;
  } catch (e) {
    promesaPdfLib = null;
    throw e;
  }
}

let promesaFontkit = null;
export async function obtenerFontkit() {
  if (!promesaFontkit) {
    promesaFontkit = import(`https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@${VERSION_FONTKIT}/+esm`).then(
      (m) => m.default ?? m
    );
  }
  try {
    return await promesaFontkit;
  } catch (e) {
    promesaFontkit = null;
    throw e;
  }
}

let promesaUpng = null;
export async function obtenerUpng() {
  if (!promesaUpng) {
    promesaUpng = import(`https://cdn.jsdelivr.net/npm/@pdf-lib/upng@${VERSION_UPNG}/+esm`).then((m) => m.default ?? m);
  }
  try {
    return await promesaUpng;
  } catch (e) {
    promesaUpng = null;
    throw e;
  }
}

// Liberation Sans (public/admin/papel/fonts/, licencia OFL-1.1): la MISMA
// fuente que se incrusta en el PDF real, cargada aquí como bytes crudos para
// que pdf-lib la embeba — a diferencia del diseño anterior (donde hacía
// falta cargarla como @font-face para que el navegador MIDIERA con ella),
// ahora ni siquiera hace falta que estos bytes lleguen antes de "pintar":
// pdf-lib mide con las métricas del propio fichero, nunca con el motor de
// texto del navegador.
let promesaFuentes = null;
export async function cargarFuentesHoja() {
  if (!promesaFuentes) {
    const base = new URL("./fonts/", import.meta.url);
    promesaFuentes = Promise.all([
      fetch(new URL("LiberationSans-Regular.ttf", base)).then((r) => r.arrayBuffer()),
      fetch(new URL("LiberationSans-Bold.ttf", base)).then((r) => r.arrayBuffer()),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  try {
    return await promesaFuentes;
  } catch (e) {
    promesaFuentes = null;
    throw e;
  }
}

// Dispara la descarga del PDF ya generado (README §4.7): sustituye a la
// ventana de impresión de antes — ya no hace falta pasar por el diálogo de
// impresión del navegador para obtener un PDF, hoja.js genera los bytes
// directamente.
export function descargarPdf(bytes, nombreArchivo) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ============================================================
// Homografía (corrección de perspectiva sin librerías de visión)
// ============================================================

function resolverSistemaLineal(A, B) {
  const n = B.length;
  const M = A.map((fila, i) => [...fila, B[i]]);
  for (let col = 0; col < n; col++) {
    let pivote = col;
    for (let f = col + 1; f < n; f++) {
      if (Math.abs(M[f][col]) > Math.abs(M[pivote][col])) pivote = f;
    }
    [M[col], M[pivote]] = [M[pivote], M[col]];
    const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let f = 0; f < n; f++) {
      if (f === col) continue;
      const factor = M[f][col];
      for (let c = col; c <= n; c++) M[f][c] -= factor * M[col][c];
    }
  }
  return M.map((fila) => fila[n]);
}

export function calcularHomografia(src, dst) {
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    B.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    B.push(Y);
  }
  const h = resolverSistemaLineal(A, B);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function invertirHomografia([a, b, c, d, e, f, g, h, i]) {
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

export function aplicarHomografia([a, b, c, d, e, f, g, h, i], x, y) {
  const w = g * x + h * y + i;
  return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w };
}

// Deforma (warp) la región delimitada por las 4 esquinas (coordenadas de la
// imagen fuente) hacia un rectángulo destW x destH, por interpolación
// bilineal (o vecino más próximo si opciones.nearest, ver más abajo).
export function warpearImagen(canvasFuente, esquinas, destW, destH, dst, opciones = {}) {
  const { nearest = false, offsetX = 0, offsetY = 0 } = opciones;
  const sw = canvasFuente.width;
  const sh = canvasFuente.height;
  const srcData = canvasFuente.getContext("2d").getImageData(0, 0, sw, sh).data;

  const destino = document.createElement("canvas");
  destino.width = destW;
  destino.height = destH;
  const destCtx = destino.getContext("2d");
  const destImg = destCtx.createImageData(destW, destH);
  const destData = destImg.data;

  const dstFinal = dst ?? [
    { x: 0, y: 0 },
    { x: destW, y: 0 },
    { x: destW, y: destH },
    { x: 0, y: destH },
  ];
  const H = calcularHomografia(esquinas, dstFinal);
  const Hinv = invertirHomografia(H);

  for (let y = 0; y < destH; y++) {
    for (let x = 0; x < destW; x++) {
      const { x: sx, y: sy } = aplicarHomografia(Hinv, x + offsetX, y + offsetY);
      const di = (y * destW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        destData[di] = 255;
        destData[di + 1] = 255;
        destData[di + 2] = 255;
        destData[di + 3] = 255;
        continue;
      }
      if (nearest) {
        const xi = Math.round(sx);
        const yi = Math.round(sy);
        const si = (yi * sw + xi) * 4;
        destData[di] = srcData[si];
        destData[di + 1] = srcData[si + 1];
        destData[di + 2] = srcData[si + 2];
        destData[di + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const p00 = srcData[(y0 * sw + x0) * 4 + c];
        const p10 = srcData[(y0 * sw + x0 + 1) * 4 + c];
        const p01 = srcData[((y0 + 1) * sw + x0) * 4 + c];
        const p11 = srcData[((y0 + 1) * sw + x0 + 1) * 4 + c];
        const arriba = p00 * (1 - fx) + p10 * fx;
        const abajo = p01 * (1 - fx) + p11 * fx;
        destData[di + c] = arriba * (1 - fy) + abajo * fy;
      }
      destData[di + 3] = 255;
    }
  }
  destCtx.putImageData(destImg, 0, 0);
  return destino;
}

// Recorta una región (coordenadas canónicas 0..PAGE_W/PAGE_H) directamente de
// la foto FUENTE con vecino más próximo, con margen generoso alrededor —
// necesario para que jsQR encuentre los patrones de localización del QR
// (README histórico: recortar exacto a la caja teórica daba un QR
// indecodificable pese a verse nítido a ojo; con margen de sobra, jsQR lo
// localiza él solo dentro de la imagen). Único uso que queda de un recorte
// "de precisión": los dos QR — todo lo demás de la página se manda entera a
// OCR-IA, sin recortar nada.
export function recortarRegionNitida(canvasFuente, esquinas, dstFiduciales, caja, escala, margenRelativo = 0.35) {
  const margenX = caja.w * margenRelativo;
  const margenY = caja.h * margenRelativo;
  const destW = Math.round((caja.w + 2 * margenX) * escala);
  const destH = Math.round((caja.h + 2 * margenY) * escala);
  const offsetX = Math.round((caja.x - margenX) * escala);
  const offsetY = Math.round((caja.y - margenY) * escala);
  return warpearImagen(canvasFuente, esquinas, destW, destH, dstFiduciales, { nearest: true, offsetX, offsetY });
}

// ============================================================
// Lectura de los 2 QR de una página ya enderezada, en sus posiciones FIJAS
// (README §4.9, geometria.js — ya no hay que medir nada: la posición de
// cualquier QR es la misma en cualquier página/hoja, siempre). Sustituye a
// leerPagina(): ya no hay marcas OMR que muestrear ni casillas de texto que
// recortar, así que esto es todo lo que queda por leer de la foto en el
// navegador — el resto (respuestas, campos de demografía) lo lee OCR-IA
// sobre la imagen de página entera (digitalizar.js/subirLote.js).
export async function leerQrsDePagina(canvasFuente, esquinas, dstFiduciales, { esPrimeraPagina, avisar } = {}) {
  const escala = ESCALA_DIGITALIZACION;
  let qrPagina = null;
  let qrGrande = null;
  try {
    avisar?.("Leyendo QR de página…");
    const recorte = recortarRegionNitida(canvasFuente, esquinas, dstFiduciales, cajaQrPagina(), escala);
    const leido = await decodificarQr(recorte);
    if (leido) qrPagina = leido;
  } catch {
    // sin jsQR disponible (sin red, CDN caído…): el llamador cae a resolución manual
  }
  if (esPrimeraPagina) {
    try {
      avisar?.("Leyendo QR de la remesa…");
      const recorte = recortarRegionNitida(canvasFuente, esquinas, dstFiduciales, cajaQrGrande(), escala);
      const leido = await decodificarQr(recorte);
      if (leido) qrGrande = leido;
    } catch {
      // ídem
    }
  }
  return { qrGrandeTexto: qrGrande, qrPaginaTexto: qrPagina };
}

// ============================================================
// PDF -> una imagen por página (README §4.10): la subida en bloque acepta
// tanto fotos/escaneos sueltos como un PDF con varias páginas ya escaneadas.
// ============================================================

let promesaPdfJs = null;
async function obtenerPdfJs() {
  if (!promesaPdfJs) {
    promesaPdfJs = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";
      return mod;
    });
  }
  return promesaPdfJs;
}

// ============================================================
// Lectura de un .zip subido en "Digitalizar tests" (README §4.10, subida en
// bloque): puede traer una mezcla suelta de fotos y PDFs. Lector mínimo del
// formato PKZIP (misma referencia que el escritor de admin.js::construirZip,
// APPNOTE.TXT de PKWARE), sin ninguna librería nueva — el único método de
// compresión que hace falta soportar en LECTURA es DEFLATE (el que usan los
// zips normales de macOS/Windows/Linux; STORE, sin comprimir, también, es el
// que genera nuestro propio construirZip), inflado con el DecompressionStream
// nativo del navegador (soportado en Chrome/Edge/Firefox/Safari recientes) en
// vez de añadir una librería de compresión.
async function inflarDeflate(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// Busca la firma del End Of Central Directory (0x06054b50) desde el final del
// archivo hacia atrás — puede no estar en los últimos 22 bytes exactos si el
// zip lleva un comentario global (longitud variable, hasta 65535 bytes).
function buscarFinDirectorioCentral(vista) {
  const minimo = Math.max(0, vista.byteLength - 22 - 65535);
  for (let i = vista.byteLength - 22; i >= minimo; i--) {
    if (vista.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("No es un .zip válido (no se encontró el fin del directorio central)");
}

export async function leerZip(file) {
  const buffer = await file.arrayBuffer();
  const vista = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const finCentral = buscarFinDirectorioCentral(vista);
  const numEntradas = vista.getUint16(finCentral + 10, true);
  let offset = vista.getUint32(finCentral + 16, true);

  const decodificador = new TextDecoder();
  const entradas = [];
  for (let i = 0; i < numEntradas; i++) {
    if (vista.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("No es un .zip válido (cabecera del directorio central inesperada)");
    }
    const metodo = vista.getUint16(offset + 10, true);
    const tamComprimido = vista.getUint32(offset + 20, true);
    const longNombre = vista.getUint16(offset + 28, true);
    const longExtra = vista.getUint16(offset + 30, true);
    const longComentario = vista.getUint16(offset + 32, true);
    const offsetLocal = vista.getUint32(offset + 42, true);
    const nombre = decodificador.decode(bytes.subarray(offset + 46, offset + 46 + longNombre));

    if (!nombre.endsWith("/") && vista.getUint32(offsetLocal, true) === 0x04034b50) {
      const longNombreLocal = vista.getUint16(offsetLocal + 26, true);
      const longExtraLocal = vista.getUint16(offsetLocal + 28, true);
      const inicioDatos = offsetLocal + 30 + longNombreLocal + longExtraLocal;
      const comprimidos = bytes.subarray(inicioDatos, inicioDatos + tamComprimido);
      // 0 = sin comprimir (STORE), 8 = DEFLATE — los dos únicos métodos que
      // producen los compresores de zip habituales; cualquier otro (raro:
      // BZIP2, LZMA...) se descarta en vez de fallar todo el lote entero.
      if (metodo === 0) {
        entradas.push({ nombre, blob: new Blob([comprimidos]) });
      } else if (metodo === 8) {
        const datos = await inflarDeflate(comprimidos);
        entradas.push({ nombre, blob: new Blob([datos]) });
      }
    }
    offset += 46 + longNombre + longExtra + longComentario;
  }
  return entradas;
}

export async function cargarPaginasPdf(file) {
  const pdfjsLib = await obtenerPdfJs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paginas = [];
  const ANCHO_OBJETIVO = 2200;
  for (let i = 1; i <= doc.numPages; i++) {
    const pagina = await doc.getPage(i);
    const viewportBase = pagina.getViewport({ scale: 1 });
    const escala = ANCHO_OBJETIVO / viewportBase.width;
    const viewport = pagina.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await pagina.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    paginas.push(canvas);
  }
  return paginas;
}

// ============================================================
// Selector de 4 esquinas sobre la foto subida (respaldo manual)
// ============================================================

export function crearSelectorEsquinas(canvas, fuente, anchoNatural, altoNatural, puntosIniciales) {
  const ctx = canvas.getContext("2d");
  const escala = canvas.width / anchoNatural;
  const puntos = puntosIniciales
    ? puntosIniciales.map((p) => ({ ...p }))
    : [
        { x: anchoNatural * 0.06, y: altoNatural * 0.04 },
        { x: anchoNatural * 0.94, y: altoNatural * 0.04 },
        { x: anchoNatural * 0.94, y: altoNatural * 0.97 },
        { x: anchoNatural * 0.06, y: altoNatural * 0.97 },
      ];
  let arrastrando = -1;

  function repintar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2;
    ctx.beginPath();
    puntos.forEach((p, i) => {
      const x = p.x * escala;
      const y = p.y * escala;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    const etiquetas = ["1 (sup. izq.)", "2 (sup. der.)", "3 (inf. der.)", "4 (inf. izq.)"];
    puntos.forEach((p, i) => {
      const x = p.x * escala;
      const y = p.y * escala;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#e11d48";
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "11px sans-serif";
      ctx.fillText(etiquetas[i], x + 10, y - 10);
    });
  }
  repintar();

  function posicionDesdeEvento(ev) {
    const rect = canvas.getBoundingClientRect();
    const xCanvas = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const yCanvas = (ev.clientY - rect.top) * (canvas.height / rect.height);
    return { x: xCanvas / escala, y: yCanvas / escala };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    const pos = posicionDesdeEvento(ev);
    let masCercano = -1;
    let distMin = Infinity;
    puntos.forEach((p, i) => {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < distMin) {
        distMin = d;
        masCercano = i;
      }
    });
    if (distMin * escala < 30) {
      arrastrando = masCercano;
      canvas.setPointerCapture(ev.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (arrastrando < 0) return;
    puntos[arrastrando] = posicionDesdeEvento(ev);
    repintar();
  });
  canvas.addEventListener("pointerup", () => {
    arrastrando = -1;
  });
  canvas.style.touchAction = "none";

  return { obtenerEsquinas: () => puntos.map((p) => ({ ...p })) };
}

export async function prepararImagenFuente(file) {
  const bitmap = await createImageBitmap(file);
  const MAX_DIM = 2200;
  const factor = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * factor);
  const h = Math.round(bitmap.height * factor);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas;
}

// ============================================================
// Detección automática de los 4 fiduciales de esquina
// ============================================================
//
// No es visión por computador "de verdad". El cuadrante de búsqueda de cada
// esquina es generoso (para tolerar fotos mal encuadradas) y por tanto puede
// contener también contenido de la propia hoja cerca del margen — un bloque
// de texto en negrita puede ser tan oscuro en promedio como el fiducial. Para
// no confundirlos, cada candidato se exige AISLADO (un "foso" de blanco justo
// fuera de él) antes de aceptarlo, probando los candidatos de más a menos
// oscuro hasta encontrar uno que lo cumpla. Es solo el punto de partida del
// selector manual (crearSelectorEsquinas): si falla, se arrastra a mano.
// Exportada (issue #35): ocr_tests/verificar_casillas_vacias.mjs la reutiliza
// para recalibrar INSET_RELATIVO_CASILLA/UMBRAL_TINTA_CASILLA (más abajo)
// contra fixtures nuevas, en vez de mantener una segunda copia de esta
// aritmética en el script de test.
export function densidadPromedio(imageData, x0, y0, x1, y1) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const xi = Math.max(0, Math.round(x0));
  const xf = Math.min(w, Math.round(x1));
  const yi = Math.max(0, Math.round(y0));
  const yf = Math.min(h, Math.round(y1));
  let suma = 0;
  let n = 0;
  for (let y = yi; y < yf; y++) {
    for (let x = xi; x < xf; x++) {
      const i = (y * w + x) * 4;
      suma += 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      n++;
    }
  }
  return n > 0 ? suma / n : 0;
}

// Varianza de intensidad (misma luma 0-255 que densidadPromedio) dentro de
// una región — issue #37, idea adicional nº2: un trazo de tinta real tiene
// alto CONTRASTE local (línea oscura sobre fondo claro), mientras que una
// mancha, sombra o ruido uniforme puede tener una media de densidad parecida
// pero mucho menos variación interna. Señal secundaria a la densidad media
// para separar mejor la zona dudosa (ver zonaTintaCasilla más abajo). No es
// una transformada de Fourier (el issue también menciona "coeficientes de
// alta frecuencia" como alternativa) — la varianza es una proxy mucho más
// simple de calcular sobre una región pequeña (22% de inset de una casilla)
// sin arrastrar ninguna librería de DSP, y mide esencialmente lo mismo para
// este caso de uso: cuánto varía la intensidad punto a punto.
export function varianzaEnRegion(imageData, x0, y0, x1, y1) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const xi = Math.max(0, Math.round(x0));
  const xf = Math.min(w, Math.round(x1));
  const yi = Math.max(0, Math.round(y0));
  const yf = Math.min(h, Math.round(y1));
  let suma = 0;
  let n = 0;
  for (let y = yi; y < yf; y++) {
    for (let x = xi; x < xf; x++) {
      const i = (y * w + x) * 4;
      suma += 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      n++;
    }
  }
  if (n === 0) return 0;
  const media = suma / n;
  let sumaCuad = 0;
  for (let y = yi; y < yf; y++) {
    for (let x = xi; x < xf; x++) {
      const i = (y * w + x) * 4;
      const luma = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      sumaCuad += (luma - media) * (luma - media);
    }
  }
  return sumaCuad / n;
}

// Trazo coherente vs ruido estocástico (issue #37, seguimiento a la
// varianza de arriba): la varianza de intensidad no distingue la CAUSA del
// contraste — un artefacto de compresión JPEG (bloques de 8x8) o un ligero
// desalineamiento del warp que atrapa el borde impreso de la casilla pueden
// producir tanto contraste local como un trazo real; verificado contra
// escaneos reales (ocr_tests/README.md, ronda del 17 de agosto de 2026): la
// casilla EN BLANCO con más varianza de todo el dataset real superaba a
// varias casillas CON tinta real. La diferencia real entre un trazo y ruido
// no es solo cuánto contraste hay, sino su FORMA: un trazo de letra es una
// mancha COHERENTE que ocupa una fracción sustancial de la casilla, mientras
// que un artefacto de bloque o un borde mal recortado es más pequeño y no
// domina la región.
//
// 1. Umbral de Otsu (histograma de oscuridad de la propia región, sin
//    depender de ningún blanco muestreado fuera de ella): asume que la
//    región es bimodal (fondo + trazo) y busca el corte que maximiza la
//    varianza ENTRE las dos clases resultantes. Esa varianza entre clases
//    (normalizada a 0-1, otsuSeparabilidad) es ya una medida de "qué tan
//    bimodal es de verdad" la región: alta si hay una separación clara
//    fondo/trazo, baja si es solo ruido disperso sin una moda oscura clara.
// 2. Se binariza con ese umbral y se etiquetan las componentes conexas
//    (flood-fill de 4 vecinos con una pila — la región es tan pequeña, unos
//    pocos miles de píxeles, que ni siquiera hace falta un algoritmo más
//    sofisticado que O(nº píxeles)).
// 3. De la componente más grande se mide su EXTENSIÓN relativa al tamaño de
//    la región (cuánto ancho/alto de la casilla cubre su caja delimitadora)
//    y qué fracción de todos los píxeles "trazo" concentra — un trazo real
//    debería dominar ambas métricas más que ruido disperso o un artefacto
//    puntual, aunque el margen exacto hay que verificarlo con datos (ver
//    ocr_tests/verificar_casillas_vacias.mjs).
export function analizarComponentesCasilla(imageData, x0, y0, x1, y1) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const xi = Math.max(0, Math.round(x0));
  const xf = Math.min(w, Math.round(x1));
  const yi = Math.max(0, Math.round(y0));
  const yf = Math.min(h, Math.round(y1));
  const rw = xf - xi;
  const rh = yf - yi;
  const vacio = { otsuUmbral: 0, otsuSeparabilidad: 0, numComponentes: 0, extensionComponenteMayor: 0, fraccionComponenteMayor: 0 };
  if (rw <= 0 || rh <= 0) return vacio;

  // Un único recorrido: oscuridad de cada píxel en un buffer local (para no
  // volver a tocar imageData en los pasos siguientes) + histograma para Otsu.
  const n = rw * rh;
  const valores = new Uint8ClampedArray(n);
  const histograma = new Array(256).fill(0);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((yi + y) * w + (xi + x)) * 4;
      const oscuridad = Math.round(255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]));
      valores[y * rw + x] = oscuridad;
      histograma[oscuridad]++;
    }
  }

  let sumaTotal = 0;
  for (let v = 0; v < 256; v++) sumaTotal += v * histograma[v];

  // Otsu: barre los 256 cortes posibles buscando el que maximiza la varianza
  // entre clases (fondo/trazo) — clásico, O(256) tras el histograma.
  let mejorUmbral = 0;
  let mejorVarianzaEntre = 0;
  let pesoFondoAcum = 0;
  let sumaFondoAcum = 0;
  for (let t = 0; t < 255; t++) {
    pesoFondoAcum += histograma[t];
    sumaFondoAcum += t * histograma[t];
    const pesoTrazo = n - pesoFondoAcum;
    if (pesoFondoAcum === 0 || pesoTrazo === 0) continue;
    const mediaFondo = sumaFondoAcum / pesoFondoAcum;
    const mediaTrazo = (sumaTotal - sumaFondoAcum) / pesoTrazo;
    const varianzaEntre = pesoFondoAcum * pesoTrazo * (mediaFondo - mediaTrazo) * (mediaFondo - mediaTrazo);
    if (varianzaEntre > mejorVarianzaEntre) {
      mejorVarianzaEntre = varianzaEntre;
      mejorUmbral = t + 1; // píxeles con oscuridad >= t+1 son la clase "trazo"
    }
  }
  if (mejorUmbral === 0) return vacio; // región perfectamente uniforme, ni un corte mejora sobre 0

  // Varianza total de la región, para normalizar la varianza entre clases a
  // 0-1 (comparable entre casillas con distinto contraste absoluto).
  const media = sumaTotal / n;
  let varianzaTotal = 0;
  for (let v = 0; v < 256; v++) varianzaTotal += histograma[v] * (v - media) * (v - media);
  varianzaTotal /= n;
  const otsuSeparabilidad = varianzaTotal > 0 ? mejorVarianzaEntre / (n * n) / varianzaTotal : 0;

  // Componentes conexas (flood-fill, 4 vecinos) de los píxeles "trazo".
  const visitado = new Uint8Array(n);
  const dx4 = [-1, 1, 0, 0];
  const dy4 = [0, 0, -1, 1];
  let numComponentes = 0;
  let mayorArea = 0;
  let mayorBboxW = 0;
  let mayorBboxH = 0;
  let totalTrazo = 0;
  const pila = [];
  for (let start = 0; start < n; start++) {
    if (visitado[start] || valores[start] < mejorUmbral) continue;
    numComponentes++;
    pila.push(start);
    visitado[start] = 1;
    let area = 0;
    let minX = rw;
    let maxX = -1;
    let minY = rh;
    let maxY = -1;
    while (pila.length > 0) {
      const idx = pila.pop();
      const x = idx % rw;
      const y = (idx / rw) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let k = 0; k < 4; k++) {
        const nx = x + dx4[k];
        const ny = y + dy4[k];
        if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
        const v = ny * rw + nx;
        if (visitado[v] || valores[v] < mejorUmbral) continue;
        visitado[v] = 1;
        pila.push(v);
      }
    }
    totalTrazo += area;
    if (area > mayorArea) {
      mayorArea = area;
      mayorBboxW = maxX - minX + 1;
      mayorBboxH = maxY - minY + 1;
    }
  }

  return {
    otsuUmbral: mejorUmbral,
    otsuSeparabilidad,
    numComponentes,
    extensionComponenteMayor: numComponentes > 0 ? Math.max(mayorBboxW / rw, mayorBboxH / rh) : 0,
    fraccionComponenteMayor: totalTrazo > 0 ? mayorArea / totalTrazo : 0,
  };
}

function densidadEnAnillo(imageData, cx, cy, rInt, rExt) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const x0 = Math.max(0, Math.round(cx - rExt));
  const x1 = Math.min(w, Math.round(cx + rExt));
  const y0 = Math.max(0, Math.round(cy - rExt));
  const y1 = Math.min(h, Math.round(cy + rExt));
  let suma = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (dist < rInt || dist > rExt) continue;
      const i = (y * w + x) * 4;
      suma += 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      n++;
    }
  }
  return n > 0 ? suma / n : 0;
}

function refinarCentroide(imageData, cx, cy, radio) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const x0 = Math.max(0, Math.round(cx - radio));
  const x1 = Math.min(w, Math.round(cx + radio));
  const y0 = Math.max(0, Math.round(cy - radio));
  const y1 = Math.min(h, Math.round(cy + radio));
  let sumaPeso = 0;
  let sumaX = 0;
  let sumaY = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const oscuridad = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      if (oscuridad < 120) continue;
      sumaPeso += oscuridad;
      sumaX += x * oscuridad;
      sumaY += y * oscuridad;
    }
  }
  return sumaPeso > 0 ? { x: sumaX / sumaPeso, y: sumaY / sumaPeso } : null;
}

function medirExtensionEje(imageData, cx, cy, dx, dy, radioMaximo) {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const esTinta = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return false;
    const i = (yi * w + xi) * 4;
    return 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) >= 120;
  };
  let radio = 0;
  while (radio < radioMaximo && esTinta(cx + dx * radio, cy + dy * radio)) radio++;
  return radio;
}

const FIDUCIAL_BLOQUE = 12;
const FIDUCIAL_UMBRAL_CANDIDATO = 60;
const FIDUCIAL_UMBRAL_FOSO = 30;
const FIDUCIAL_MAX_CANDIDATOS = 20;

function localizarBlobEnRegion(imageData, x0, y0, x1, y1) {
  const candidatos = [];
  for (let by = y0; by < y1; by += FIDUCIAL_BLOQUE) {
    for (let bx = x0; bx < x1; bx += FIDUCIAL_BLOQUE) {
      const oscuridad = densidadPromedio(imageData, bx, by, bx + FIDUCIAL_BLOQUE, by + FIDUCIAL_BLOQUE);
      if (oscuridad >= FIDUCIAL_UMBRAL_CANDIDATO) {
        candidatos.push({ x: bx + FIDUCIAL_BLOQUE / 2, y: by + FIDUCIAL_BLOQUE / 2, oscuridad });
      }
    }
  }
  candidatos.sort((a, b) => b.oscuridad - a.oscuridad);

  const dimensionRegion = Math.max(x1 - x0, y1 - y0);
  for (const candidato of candidatos.slice(0, FIDUCIAL_MAX_CANDIDATOS)) {
    const refinado = refinarCentroide(imageData, candidato.x, candidato.y, FIDUCIAL_BLOQUE * 1.5);
    if (!refinado) continue;

    const radioMax = dimensionRegion * 0.3;
    const ext = medirExtensionEje(imageData, refinado.x, refinado.y, 1, 0, radioMax);
    const izq = medirExtensionEje(imageData, refinado.x, refinado.y, -1, 0, radioMax);
    const abajo = medirExtensionEje(imageData, refinado.x, refinado.y, 0, 1, radioMax);
    const arriba = medirExtensionEje(imageData, refinado.x, refinado.y, 0, -1, radioMax);
    const anchoBlob = ext + izq;
    const altoBlob = abajo + arriba;
    if (anchoBlob < 4 || altoBlob < 4) continue;
    const proporcion = anchoBlob / altoBlob;
    if (proporcion < 0.6 || proporcion > 1.7) continue;

    const radioBlob = Math.max(anchoBlob, altoBlob) / 2;
    const foso = densidadEnAnillo(imageData, refinado.x, refinado.y, radioBlob * 1.5, radioBlob * 3.5);
    if (foso < FIDUCIAL_UMBRAL_FOSO) return refinado;
  }
  return null;
}

// Busca los 4 fiduciales dentro de sus cuadrantes esperados en cada esquina
// (bug real encontrado y corregido durante issue #35: el cuadrante era 8% del
// ancho/alto de la foto, pero FIDUCIAL_INSET_MM pasó de 3mm a PADDING_MM
// (15mm) en un cambio de layout anterior sin actualizar este valor —
// geometria.js, "Antes 3mm... ahora coincide con el margen". El centro del
// fiducial queda a FIDUCIAL_INSET_MM + FIDUCIAL_SIZE_MM/2 = 17.5mm del borde,
// un 8.3% del ancho de la página YA SIN contar ningún margen de encuadre real
// (fuera de la página, dentro del encuadre de la foto) — con cualquier margen
// de encuadre (inevitable en una foto real, y confirmado contra las fixtures
// sintéticas de ocr_tests/, donde cae en 11-12%/8-9% del encuadre incluso con
// solo un 3% de margen simulado), el fiducial cae sistemáticamente FUERA del
// cuadrante de búsqueda: la autodetección fallaba siempre, cayendo en
// silencio al selector manual de 4 esquinas). 20% deja margen de sobra para
// fotos con más aire alrededor de la hoja sin llegar a solaparse con el
// fiducial opuesto (~88% del encuadre en las mismas fixtures).
export function detectarFiduciales(canvasFuente) {
  const ctx = canvasFuente.getContext("2d");
  const w = canvasFuente.width;
  const h = canvasFuente.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const fx = Math.round(w * 0.2);
  const fy = Math.round(h * 0.2);
  const tl = localizarBlobEnRegion(imageData, 0, 0, fx, fy);
  const tr = localizarBlobEnRegion(imageData, w - fx, 0, w, fy);
  const br = localizarBlobEnRegion(imageData, w - fx, h - fy, w, h);
  const bl = localizarBlobEnRegion(imageData, 0, h - fy, fx, h);
  const puntos = [tl, tr, br, bl];
  if (puntos.some((p) => !p)) return null;

  const cx = puntos.reduce((s, p) => s + p.x, 0) / 4;
  const cy = puntos.reduce((s, p) => s + p.y, 0) / 4;
  const distancias = puntos.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const distanciaMedia = distancias.reduce((s, d) => s + d, 0) / 4;
  if (distancias.some((d) => Math.abs(d - distanciaMedia) / distanciaMedia > 0.4)) return null;

  return puntos;
}

// Destino canónico de la homografía (los 4 fiduciales fijos, escalados a la
// resolución de trabajo) — el mismo para cualquier página de cualquier hoja,
// ya no depende de medir nada (geometria.js).
export function destinoFiducialesEscalado(escala = ESCALA_DIGITALIZACION) {
  const f = fiducialesFijos();
  return ["tl", "tr", "br", "bl"].map((esquina) => ({ x: f[esquina].cx * escala, y: f[esquina].cy * escala }));
}

// ============================================================
// Detección determinista de tinta por casilla (issue #35, ampliada en el
// #37 con baseline adaptativo + 3 zonas): sobre la imagen YA enderezada
// (post-warpearImagen, en coordenadas canónicas fijas — hoja.js::
// calcularGeometriaCasillas conoce la posición exacta de cada casilla),
// decide "tinta / dudoso / sin tinta" — mismo mecanismo que ya usa
// detectarFiduciales (densidadPromedio), aplicado a un problema mucho más
// simple (nunca "qué letra hay"). Umbral e inset calibrados y verificados
// contra las 4 instancias sintéticas de ocr_tests/
// (ocr_tests/verificar_casillas_vacias.mjs): separación limpia entre "con
// tinta" (mínimo de densidad 8.1) y "en blanco" (máximo 4.5) en las 312
// casillas evaluadas — ver ese script para volver a calibrar si hace falta.
export const INSET_RELATIVO_CASILLA = 0.22;
// Umbral absoluto histórico (issue #35) — se mantiene exportado por
// compatibilidad con quien lo importe directamente, pero detectarTintaCasillas
// ya NO lo usa como umbral fijo: en su lugar resta un baseline de blanco
// muestreado en la propia foto (ver UMBRAL_TINTA_CASILLA/UMBRAL_BLANCO_CASILLA
// más abajo, ahora relativos a ese baseline) — issue #37.
export const UMBRAL_TINTA_CASILLA = 8;

// pt (mismo sistema de coordenadas que hoja.js, origen arriba-izquierda de la
// página) -> px del canvas ya enderezado a ESCALA_DIGITALIZACION (el mismo
// destino que produce warpearImagen con destinoFiducialesEscalado()).
export function ptAPxCanonico(pt, escala = ESCALA_DIGITALIZACION) {
  return (pt / PT_POR_MM) * PX_POR_MM * escala;
}

// mm (mismo sistema que geometria.js) -> px del canvas ya enderezado, misma
// escala que ptAPxCanonico (destinoFiducialesEscalado usa fiducialesFijos(),
// en mm, multiplicado por PX_POR_MM * escala).
function mmAPxCanonico(mm, escala = ESCALA_DIGITALIZACION) {
  return mm * PX_POR_MM * escala;
}

// ============================================================
// Baseline de blanco adaptativo por foto (issue #37, "trabajo pendiente #4"
// del propio issue original #35): en vez de comparar la densidad de cada
// casilla contra un umbral absoluto fijo (calibrado solo contra las
// fixtures sintéticas, con fondo blanco casi perfecto), se muestrea la
// densidad del MARGEN DE PÁGINA de la MISMA foto — una franja que hoja.js
// garantiza SIEMPRE en blanco (nada se dibuja más cerca del borde que
// PADDING_MM, geometria.js) — y se usa ese valor como referencia de "blanco"
// para ESA foto concreta. Debería hacer la detección más robusta a
// variaciones de escaneado/foto (papel amarilleado, sombras, exposición,
// compresión JPEG distinta entre móviles) que un umbral absoluto no puede
// capturar.
//
// Franja de muestreo: entre BLANCO_MARGEN_INSET_MM y BLANCO_MARGEN_FIN_MM del
// borde de la página — dentro del margen de PADDING_MM (15mm) garantizado en
// blanco y con margen de sobra antes del fiducial (que empieza justo en
// PADDING_MM, geometria.js::FIDUCIAL_INSET_MM), así que ninguna de las 4
// bandas (arriba/abajo/izquierda/derecha) puede solaparse con un fiducial ni
// con los QR (ambos viven dentro del área de contenido, no en el margen).
const BLANCO_MARGEN_INSET_MM = 2;
const BLANCO_MARGEN_FIN_MM = 12;
const BLANCO_MARGEN_NUM_PARCHES = 6;

function medianaDe(valores) {
  const s = [...valores].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Reparte NUM_PARCHES rectángulos a lo largo de un eje (horizontal para las
// bandas superior/inferior, vertical para las laterales) y devuelve la
// densidad de cada uno — varios parches en vez de un único rectángulo grande
// para que una única mancha, pliegue o sombra puntual en el margen (posible
// en una foto real) no arrastre sola la mediana.
function densidadesEnBanda(imageData, escala, horizontal, ini, fin, cruzIni, cruzFin) {
  const valores = [];
  const paso = (fin - ini) / BLANCO_MARGEN_NUM_PARCHES;
  for (let k = 0; k < BLANCO_MARGEN_NUM_PARCHES; k++) {
    const a = mmAPxCanonico(ini + k * paso, escala);
    const b = mmAPxCanonico(ini + (k + 1) * paso, escala);
    const c0 = mmAPxCanonico(cruzIni, escala);
    const c1 = mmAPxCanonico(cruzFin, escala);
    valores.push(horizontal ? densidadPromedio(imageData, a, c0, b, c1) : densidadPromedio(imageData, c0, a, c1, b));
  }
  return valores;
}

// Densidad "de referencia" del blanco de ESTA foto concreta, muestreada en
// sus 4 márgenes — mediana de todos los parches (24 por defecto: 6 por
// banda x 4 bandas) para ser robusta a un parche contaminado por una sombra
// o mancha local. Exportada para que ocr_tests/verificar_casillas_vacias.mjs
// pueda reportarla junto al resto de estadísticas de calibración.
export function muestrearBlancoLocal(imageData, escala = ESCALA_DIGITALIZACION) {
  const anchoMm = PAGE_W_MM;
  const altoMm = PAGE_H_MM;
  const valores = [
    ...densidadesEnBanda(imageData, escala, true, BLANCO_MARGEN_INSET_MM, anchoMm - BLANCO_MARGEN_INSET_MM, BLANCO_MARGEN_INSET_MM, BLANCO_MARGEN_FIN_MM),
    ...densidadesEnBanda(
      imageData,
      escala,
      true,
      BLANCO_MARGEN_INSET_MM,
      anchoMm - BLANCO_MARGEN_INSET_MM,
      altoMm - BLANCO_MARGEN_FIN_MM,
      altoMm - BLANCO_MARGEN_INSET_MM
    ),
    ...densidadesEnBanda(imageData, escala, false, BLANCO_MARGEN_INSET_MM, altoMm - BLANCO_MARGEN_INSET_MM, BLANCO_MARGEN_INSET_MM, BLANCO_MARGEN_FIN_MM),
    ...densidadesEnBanda(
      imageData,
      escala,
      false,
      BLANCO_MARGEN_INSET_MM,
      altoMm - BLANCO_MARGEN_INSET_MM,
      anchoMm - BLANCO_MARGEN_FIN_MM,
      anchoMm - BLANCO_MARGEN_INSET_MM
    ),
  ];
  return medianaDe(valores);
}

// ============================================================
// Clasificación en 3 zonas (issue #37, seguimiento de #35): en vez de un
// único corte binario tinta/blanco, dos márgenes por ENCIMA del baseline de
// blanco local (muestrearBlancoLocal): por debajo de MARGEN_BLANCO_SEGURO ->
// "blanco" (mismo comportamiento que el diseño anterior: fuerza la posición
// a cadena vacía en el esquema de OCR-IA); por encima de MARGEN_TINTA_SEGURA
// -> "tinta" (zona nueva: candidata a exigir contenido no vacío en el
// esquema, issue #37 trabajo pendiente #3); entre medias -> "dudoso" (no se
// fuerza nada en el esquema, pero sí se informa al modelo por texto — issue
// #37 trabajo pendiente #2). Los valores de margen se calibraron primero para
// reproducir aproximadamente el umbral absoluto histórico (8, con blanco casi
// 0 en las fixtures sintéticas), pero verificarlos contra escaneos REALES
// (ocr_tests/05-escaneo-real/, ocr_tests/verificar_casillas_vacias.mjs) reveló
// que el baseline de blanco muestreado en el margen de página NO SIEMPRE es
// representativo de la densidad de fondo cerca de una casilla concreta —
// hallazgo real de esta ronda: en un escaneo de menor calidad, una letra fina
// ("I") midió una densidad relativa al margen de -3.5 (MÁS CLARA que el propio
// margen de la foto), mientras que casillas genuinamente en blanco llegaron
// hasta +3.6 — un solapamiento real que el margen [4, 7] original (calibrado
// solo con las fixtures sintéticas, donde el margen sí es un blanco casi
// perfecto) no cubría con seguridad: 2 casillas con tinta real habrían caído
// en zona "blanco" y forzado vacío sobre contenido real. Ampliado con margen
// de sobra a ambos lados de ese solapamiento observado — sacrifica algo de
// cobertura "segura" (más casillas caen en zona "dudosa" en escaneos
// ruidosos) a cambio de la garantía de seguridad (0 casos peligrosos
// verificados contra las 4 fixtures sintéticas + los 2 escaneos reales x 2
// personas). El muestreo de margen sigue siendo un baseline GLOBAL por foto —
// no descarta que un efecto de sombra/viñeteado LOCALIZADO (más oscuro cerca
// del borde de la página que cerca del centro, donde viven las casillas) siga
// sesgando este baseline; un baseline muestreado más cerca de cada bloque de
// casillas en vez de solo en el margen de página es candidato para una futura
// ronda de calibración (ver ocr_tests/README.md).
export const MARGEN_BLANCO_SEGURO = -5;
export const MARGEN_TINTA_SEGURA = 9;

export function zonaTintaCasilla(densidad, blancoLocal) {
  if (densidad < blancoLocal + MARGEN_BLANCO_SEGURO) return "blanco";
  if (densidad >= blancoLocal + MARGEN_TINTA_SEGURA) return "tinta";
  return "dudoso";
}

// casillas: array de {xPt, yTopPt, wPt, hPt, ...} en pt (hoja.js::
// calcularGeometriaCasillas) — cualquier otra propiedad (itemId, lado,
// posicion...) se conserva sin tocar. Devuelve el mismo array con `densidad`,
// `varianza`, `zona` ("blanco"/"dudoso"/"tinta") y `tieneTinta` (boolean,
// zona === "tinta" — se mantiene por compatibilidad con quien solo necesite
// el criterio binario anterior) añadidos a cada elemento.
//
// blancoLocal (opcional): si no se pasa, se muestrea de esta misma imagen
// (muestrearBlancoLocal) — permite al llamador reutilizar un único muestreo
// para varias llamadas sobre la misma página (varios ítems) sin repetir el
// recorrido de los 4 márgenes en cada una.
export function detectarTintaCasillas(canvasEnderezado, casillas, escala = ESCALA_DIGITALIZACION, blancoLocal) {
  const ctx = canvasEnderezado.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvasEnderezado.width, canvasEnderezado.height);
  const blanco = blancoLocal ?? muestrearBlancoLocal(imageData, escala);
  return casillas.map((c) => {
    const xPx = ptAPxCanonico(c.xPt, escala);
    const yPx = ptAPxCanonico(c.yTopPt, escala);
    const wPx = ptAPxCanonico(c.wPt, escala);
    const hPx = ptAPxCanonico(c.hPt, escala);
    const mx = wPx * INSET_RELATIVO_CASILLA;
    const my = hPx * INSET_RELATIVO_CASILLA;
    const densidad = densidadPromedio(imageData, xPx + mx, yPx + my, xPx + wPx - mx, yPx + hPx - my);
    const varianza = varianzaEnRegion(imageData, xPx + mx, yPx + my, xPx + wPx - mx, yPx + hPx - my);
    const componentes = analizarComponentesCasilla(imageData, xPx + mx, yPx + my, xPx + wPx - mx, yPx + hPx - my);
    const zona = zonaTintaCasilla(densidad, blanco);
    return { ...c, densidad, varianza, ...componentes, zona, tieneTinta: zona === "tinta" };
  });
}
