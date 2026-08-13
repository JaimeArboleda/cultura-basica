// Digitalización de tests en papel (README §4.7): pestaña "Digitalizar tests"
// del panel de admin. Dos flujos:
//   1. Imprimir la hoja OMR (hoja.js construye el DOM; aquí solo se abre una
//      ventana de impresión — "Guardar como PDF" desde el diálogo del propio
//      navegador da la versión en PDF, sin añadir ninguna librería).
//   2. Subir fotos de una hoja ya rellenada, ajustar las 4 esquinas de cada
//      página (corrección de perspectiva casera, sin OpenCV: se resuelve la
//      homografía a partir de las 4 correspondencias y se genera un canvas
//      "enderezado" del tamaño exacto de la página de referencia), muestrear
//      la oscuridad de cada burbuja/casilla (OMR) y pasar los recuadros de
//      texto libre por Tesseract.js (OCR, cargado bajo demanda desde CDN,
//      igual que Pyodide en la pestaña de Estadísticas avanzadas). Todo
//      corre en el navegador del admin: nada de esto usa una API de pago.
import { api, escaparHtml } from "./admin.js";
import { bloqueCamposDemografia, leerDemografiaDelFormulario, renderEditarSesion } from "./editarSesion.js";
import { construirHoja, CSS_HOJA, ESCALA_DIGITALIZACION, PAGE_H, PAGE_W } from "./hoja.js";

// Fracción de oscuridad (0=blanco, 1=negro) a partir de la cual una
// burbuja/casilla se considera rellena. Ajustable durante las pruebas reales
// con papel (README §4.7): si el pipeline lee de más o de menos, este es el
// primer parámetro a tocar antes de complicar el resto del algoritmo. Fijado
// bajo (comparado con lo que parecería razonable para una burbuja rellena
// del todo, oscuridad≈1) porque un error de registro de la homografía de
// solo un puñado de píxeles ya diluye bastante la medida en las burbujas más
// pequeñas del bloque de Corrección — con datos reales conviene revisar el
// margen entre "vacía" y "rellena" (validarlo con hojas de prueba) antes de
// tocar este número a ciegas.
const UMBRAL_MARCA = 0.22;

// ============================================================
// 1. Flujo de impresión
// ============================================================

function abrirVentanaImpresion(paginas) {
  const cuerpo = paginas.map((p) => p.elemento.outerHTML).join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Hoja de respuestas — Cultura Básica</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; }
  ${CSS_HOJA}
</style>
</head><body>${cuerpo}<script>window.addEventListener("load", () => window.print());<\/script></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const ventana = window.open(url, "_blank");
  if (!ventana) {
    alert("El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.");
  }
}

// ============================================================
// 2. Homografía (corrección de perspectiva sin librerías de visión)
// ============================================================

// Resuelve un sistema lineal n×n por eliminación gaussiana con pivote parcial.
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

// Homografía 3x3 (8 grados de libertad, la 9ª entrada fija a 1) a partir de 4
// correspondencias de puntos planos. Referencia: forma estándar de resolver
// una transformación proyectiva 2D con un sistema lineal 8x8 en vez de SVD.
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

// Deforma (warp) la región delimitada por las 4 esquinas (en coordenadas de
// la imagen fuente) hacia un rectángulo destW x destH: para cada píxel de
// destino se calcula, vía la homografía inversa, el píxel fuente
// correspondiente y se muestrea por interpolación bilineal (warping inverso:
// evita los huecos que dejaría proyectar hacia delante). `dst` son las
// coordenadas destino de esas 4 esquinas (por defecto, las del propio
// rectángulo destW x destH); al digitalizar se pasan las posiciones
// canónicas de los 4 fiduciales de hoja.js en vez de los bordes exactos del
// rectángulo, porque los puntos de referencia (fuente Y destino) son los
// fiduciales, no el borde físico del papel.
export function warpearImagen(canvasFuente, esquinas, destW, destH, dst) {
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
  const H = calcularHomografia(esquinas, dstFinal); // fuente -> destino
  const Hinv = invertirHomografia(H); // destino -> fuente

  for (let y = 0; y < destH; y++) {
    for (let x = 0; x < destW; x++) {
      const { x: sx, y: sy } = aplicarHomografia(Hinv, x, y);
      const di = (y * destW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        destData[di] = 255;
        destData[di + 1] = 255;
        destData[di + 2] = 255;
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

// ============================================================
// 3. Muestreo OMR + OCR sobre la imagen ya enderezada
// ============================================================

export function calcularOscuridad(imageData, cx, cy, radioPx) {
  const r = Math.max(2, radioPx * 0.55); // algo más pequeño que la burbuja: evita su propio borde impreso
  const x0 = Math.max(0, Math.round(cx - r));
  const x1 = Math.min(imageData.width - 1, Math.round(cx + r));
  const y0 = Math.max(0, Math.round(cy - r));
  const y1 = Math.min(imageData.height - 1, Math.round(cy + r));
  const d = imageData.data;
  let suma = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * imageData.width + x) * 4;
      const luminancia = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      suma += 255 - luminancia;
      n++;
    }
  }
  return n > 0 ? suma / n / 255 : 0;
}

export function recortarLinea(canvasWarp, linea, escala) {
  const x = Math.max(0, Math.round(linea.x * escala));
  const y = Math.max(0, Math.round(linea.y * escala));
  const w = Math.round(linea.w * escala);
  const h = Math.round(linea.h * escala);
  const recorte = document.createElement("canvas");
  recorte.width = w;
  recorte.height = h;
  recorte.getContext("2d").drawImage(canvasWarp, x, y, w, h, 0, 0, w, h);
  return recorte;
}

let promesaTesseractWorker = null;
async function obtenerWorkerTesseract(avisar) {
  if (!promesaTesseractWorker) {
    promesaTesseractWorker = (async () => {
      avisar?.("Descargando Tesseract.js…");
      const { createWorker } = await import(
        "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js"
      );
      const worker = await createWorker("spa");
      return worker;
    })();
  }
  return promesaTesseractWorker;
}

// Recorte de un recuadro de texto libre ('abierto', su bloque de Corrección,
// o el año de nacimiento — README §1.6/§4.9): PSM 7 ("línea única") para el
// año, que son siempre 4 dígitos en una sola fila; PSM 6 ("bloque uniforme de
// texto") para 'abierto', cuyo recorte puede tener 1 o 2 líneas de casillas
// (hoja.js::bloqueCasillasTexto). Lista blanca de caracteres acorde a lo que
// se pide escribir en la hoja (MAYÚSCULAS de imprenta, o solo dígitos).
export async function ocrLinea(canvas, { soloDigitos = false, avisar } = {}) {
  const worker = await obtenerWorkerTesseract(avisar);
  await worker.setParameters({
    tessedit_pageseg_mode: soloDigitos ? "7" : "6",
    tessedit_char_whitelist: soloDigitos ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑ0123456789 ",
  });
  const { data } = await worker.recognize(canvas);
  return (data.text || "").trim();
}

// ============================================================
// 3b. Código QR con el token de la remesa (README §4.9)
// ============================================================
//
// Ni qrcode-generator ni jsQR se publican como módulos ES en el CDN (son
// scripts clásicos que cuelgan una global de window) — a diferencia de
// Tesseract.js/Pyodide, aquí se cargan con una etiqueta <script> normal en
// vez de import() dinámico, y se lee la global una vez cargada.
function cargarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
}

let promesaQrGen = null;
async function obtenerQrGen() {
  if (!promesaQrGen) {
    promesaQrGen = cargarScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js").then(
      () => window.qrcode
    );
  }
  return promesaQrGen;
}

let promesaJsQr = null;
async function obtenerJsQr() {
  if (!promesaJsQr) {
    promesaJsQr = cargarScript("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js").then(() => window.jsQR);
  }
  return promesaJsQr;
}

// Genera el QR de un token como data URL, para incrustar en la hoja impresa
// (hoja.js::construirBloquesDemografia). typeNumber 0 = tamaño automático
// según la longitud del texto; nivel de corrección M (equilibrio razonable
// entre tamaño del QR y tolerancia a manchas/dobleces del papel).
export async function generarQrDataUrl(texto) {
  const qrcodeLib = await obtenerQrGen();
  const qr = qrcodeLib(0, "M");
  qr.addData(texto);
  qr.make();
  return qr.createDataURL(8, 4);
}

// Decodifica el QR de un recorte ya enderezado (recortarLinea sobre la
// región "meta:qr"). Devuelve el texto (el token_id) o null si no se pudo
// leer — la foto puede estar borrosa, mal encuadrada, etc.; el llamador cae
// entonces a que el admin elija el token a mano.
export async function decodificarQr(canvas) {
  const jsQR = await obtenerJsQr();
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const resultado = jsQR(imageData.data, imageData.width, imageData.height);
  return resultado ? resultado.data : null;
}

// ============================================================
// 4. Selector de 4 esquinas sobre la foto subida
// ============================================================

// canvas ya dimensionado por el llamador al tamaño de PRESENTACIÓN; fuente
// es el canvas/imagen de trabajo a resolución completa (anchoNatural x
// altoNatural). Los puntos se guardan en coordenadas de "fuente" (naturales),
// que es justo lo que necesita calcularHomografia más adelante.
// puntosIniciales (opcional): resultado de detectarFiduciales() cuando la
// detección automática tuvo éxito; si no se pasa, se usa una aproximación
// genérica cerca de cada esquina (a arrastrar a mano sobre el fiducial real).
function crearSelectorEsquinas(canvas, fuente, anchoNatural, altoNatural, puntosIniciales) {
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
  canvas.style.touchAction = "none"; // evita el scroll táctil mientras se arrastra una esquina

  return { obtenerEsquinas: () => puntos.map((p) => ({ ...p })) };
}

// Reduce la foto subida a una resolución de trabajo manejable (evita fotos
// de 12+ Mpx innecesarias para esto) y la deja en un canvas normal.
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
// 4b. Detección automática de los 4 fiduciales de esquina (hoja.js)
// ============================================================
//
// No es visión por computador "de verdad" (nada de conectados/contornos).
// El cuadrante de búsqueda de cada esquina es generoso (para tolerar fotos
// mal encuadradas) y por tanto puede contener también contenido de la propia
// hoja cerca del margen (p. ej. el título de la cabecera cerca de la esquina
// superior izquierda) — un bloque de texto en negrita puede ser tan oscuro en
// promedio como el fiducial. Para no confundirlos, no basta con "el bloque
// más oscuro": un fiducial es un cuadrado impreso SOLO, con un margen de
// blanco alrededor; el texto, aunque sea denso puntualmente, casi siempre
// tiene más tinta cerca (otra letra, otra línea). Por eso cada candidato se
// exige AISLADO (un "foso" de blanco justo fuera de él) antes de aceptarlo,
// probando los candidatos de más a menos oscuro hasta encontrar uno que lo
// cumpla. Es solo el punto de partida del selector manual
// (crearSelectorEsquinas): si falla, el admin arrastra cada esquina a mano.
function densidadPromedio(imageData, x0, y0, x1, y1) {
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

// Densidad media dentro de un anillo cuadrado (distancia de Chebyshev) entre
// rInt y rExt alrededor de (cx,cy) — el "foso" que debe estar mayormente en
// blanco alrededor de un fiducial aislado.
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

// Extensión real del blob oscuro centrado en (cx,cy) en una única dirección
// (a lo largo de +eje/-eje) hasta salir de la tinta. No asume ningún tamaño
// de fiducial en píxeles (que depende del zoom/encuadre de la foto,
// desconocido de antemano) — lo mide directamente en esta imagen concreta.
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

const FIDUCIAL_BLOQUE = 12; // px de la rejilla gruesa de la primera pasada
const FIDUCIAL_UMBRAL_CANDIDATO = 60; // oscuridad mínima (0-255) para considerar un bloque
const FIDUCIAL_UMBRAL_FOSO = 30; // oscuridad máxima (0-255) admitida en el "foso" alrededor
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

    // Extensión horizontal y vertical medidas por separado: un fiducial es
    // (aprox.) cuadrado, mientras que un trazo o palabra de texto suele ser
    // claramente más ancho que alto (o al revés, para una sola letra alta) —
    // esto descarta candidatos alargados antes incluso de mirar el foso.
    const radioMax = dimensionRegion * 0.3;
    const ext = medirExtensionEje(imageData, refinado.x, refinado.y, 1, 0, radioMax);
    const izq = medirExtensionEje(imageData, refinado.x, refinado.y, -1, 0, radioMax);
    const abajo = medirExtensionEje(imageData, refinado.x, refinado.y, 0, 1, radioMax);
    const arriba = medirExtensionEje(imageData, refinado.x, refinado.y, 0, -1, radioMax);
    const anchoBlob = ext + izq;
    const altoBlob = abajo + arriba;
    if (anchoBlob < 4 || altoBlob < 4) continue; // ruido puntual
    const proporcion = anchoBlob / altoBlob;
    if (proporcion < 0.6 || proporcion > 1.7) continue; // nada cuadrado

    const radioBlob = Math.max(anchoBlob, altoBlob) / 2;
    const foso = densidadEnAnillo(imageData, refinado.x, refinado.y, radioBlob * 1.5, radioBlob * 3.5);
    if (foso < FIDUCIAL_UMBRAL_FOSO) return refinado;
  }
  return null;
}

// Busca los 4 fiduciales dentro de sus cuadrantes esperados (8% del ancho/alto
// de la foto en cada esquina — frente al ~2%/210mm real del centro del
// fiducial con el padding de hoja.js, deja margen para encuadres razonables
// sin llegar a alcanzar respuestas marcadas que, en un ítem largo, puedan
// caer relativamente cerca del borde inferior de la página (p. ej. la
// casilla "no responder" del bloque de Corrección de un ítem con muchas
// opciones) — un cuadrado sólido más ese sí puede confundirse con un
// fiducial real si el cuadrante de búsqueda llega tan lejos. El
// aislamiento/cuadratura de arriba vuelve a filtrar lo que caiga dentro
// igualmente. Devuelve null si falla alguna esquina; el llamador cae
// entonces a la posición por defecto del selector manual.
export function detectarFiduciales(canvasFuente) {
  const ctx = canvasFuente.getContext("2d");
  const w = canvasFuente.width;
  const h = canvasFuente.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const fx = Math.round(w * 0.08);
  const fy = Math.round(h * 0.08);
  const tl = localizarBlobEnRegion(imageData, 0, 0, fx, fy);
  const tr = localizarBlobEnRegion(imageData, w - fx, 0, w, fy);
  const br = localizarBlobEnRegion(imageData, w - fx, h - fy, w, h);
  const bl = localizarBlobEnRegion(imageData, 0, h - fy, fx, h);
  const puntos = [tl, tr, br, bl];
  if (puntos.some((p) => !p)) return null;

  // Comprobación de cordura global: en las 4 esquinas de un rectángulo
  // (aunque esté fotografiado con cierta perspectiva) cada vértice queda a
  // una distancia parecida del centro del cuadrilátero. Si el aislamiento
  // por esquina no bastó para descartar un falso positivo (p. ej. texto de
  // la cabecera confundido con el fiducial), esto lo detecta: un vértice muy
  // fuera de sitio dispara una distancia muy distinta a las otras 3, y se
  // descarta la detección entera en vez de devolver un punto claramente malo.
  const cx = puntos.reduce((s, p) => s + p.x, 0) / 4;
  const cy = puntos.reduce((s, p) => s + p.y, 0) / 4;
  const distancias = puntos.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const distanciaMedia = distancias.reduce((s, d) => s + d, 0) / 4;
  if (distancias.some((d) => Math.abs(d - distanciaMedia) / distanciaMedia > 0.4)) return null;

  return puntos;
}

// ============================================================
// 5. Decodificación OMR/OCR -> respuestas listas para guardar
// ============================================================

export function ganadorDeGrupo(oscuridad, prefijo, umbral = UMBRAL_MARCA) {
  let mejorSufijo = null;
  let mejorValor = -1;
  for (const [clave, valor] of oscuridad) {
    if (!clave.startsWith(prefijo)) continue;
    if (valor > mejorValor) {
      mejorValor = valor;
      mejorSufijo = clave.slice(prefijo.length);
    }
  }
  return mejorValor >= umbral ? mejorSufijo : null;
}

export function marcadasEnGrupo(oscuridad, prefijo, umbral = UMBRAL_MARCA) {
  const resultado = [];
  for (const [clave, valor] of oscuridad) {
    if (clave.startsWith(prefijo) && valor >= umbral) resultado.push(clave.slice(prefijo.length));
  }
  return resultado;
}

function huboActividadEnGrupo(oscuridad, prefijo, umbral = UMBRAL_MARCA) {
  for (const [clave, valor] of oscuridad) {
    if (clave.startsWith(prefijo) && valor >= umbral) return true;
  }
  return false;
}

// Traduce la oscuridad/textos muestreados directamente a la forma que espera
// el backend por formato (README §4.2): abierto=string, opcion_multiple=índice,
// seleccion_multiple=[índices], ordenar=[nombres en orden], clasificar={elemento:categoría}.
//
// Precedencia Respuesta/Corrección (README §4.9): para los 4 formatos de
// burbuja, si el bloque "item:<id>:correccion:" tiene CUALQUIER marca
// (incluida la casilla "no responder"), se decodifica ENTERO desde ahí y se
// ignora el bloque de Respuesta — nunca se decide comparando qué tan oscura
// quedó una marca frente a otra. Para 'abierto', el mismo criterio pero por
// presencia de texto: si la línea de Corrección tiene algo reconocido, gana
// esa; si no, la de Respuesta.
//
// Un ítem sin marca/texto detectado (en ningún bloque) simplemente no
// aparece en el resultado, igual que dejarlo en blanco en la web — la
// revisión fina ocurre después, ya guardado, en la pantalla de edición
// (editarSesion.js).
export function decodificarRespuestas(items, oscuridad, textos) {
  const respuestas = {};
  for (const item of items) {
    if (item.formato === "abierto") {
      const correccion = (textos.get(`item:${item.id}:correccion:abierto`) ?? "").trim();
      const principal = (textos.get(`item:${item.id}:abierto`) ?? "").trim();
      const texto = correccion || principal;
      if (texto) respuestas[item.id] = texto;
      continue;
    }

    const prefijoCorreccion = `item:${item.id}:correccion:`;
    const corrigio = huboActividadEnGrupo(oscuridad, prefijoCorreccion);
    if (corrigio && (oscuridad.get(`${prefijoCorreccion}blank`) ?? 0) >= UMBRAL_MARCA) {
      continue; // anulado explícitamente en la Corrección: sin respuesta, a propósito
    }
    const base = corrigio ? prefijoCorreccion : `item:${item.id}:`;

    switch (item.formato) {
      case "opcion_multiple": {
        const g = ganadorDeGrupo(oscuridad, `${base}opcion:`);
        if (g != null) respuestas[item.id] = Number(g);
        break;
      }
      case "seleccion_multiple": {
        const marcadas = marcadasEnGrupo(oscuridad, `${base}opcion:`)
          .map(Number)
          .sort((a, b) => a - b);
        if (marcadas.length > 0) respuestas[item.id] = marcadas;
        break;
      }
      case "ordenar": {
        const n = item.elementos.length;
        const arr = new Array(n).fill(null);
        let alguna = false;
        item.elementos.forEach((elemento, i) => {
          const g = ganadorDeGrupo(oscuridad, `${base}orden:${i}:`);
          if (g != null) {
            arr[Number(g)] = elemento;
            alguna = true;
          }
        });
        if (alguna) respuestas[item.id] = arr;
        break;
      }
      case "clasificar": {
        const asign = {};
        let alguna = false;
        item.elementos.forEach((elemento, i) => {
          const g = ganadorDeGrupo(oscuridad, `${base}clasificar:${i}:`);
          if (g != null) {
            asign[elemento] = item.categorias[Number(g)];
            alguna = true;
          }
        });
        if (alguna) respuestas[item.id] = asign;
        break;
      }
    }
  }
  return respuestas;
}

// ============================================================
// 6. Confirmación mínima antes de crear la sesión, y traspaso a la edición
// compartida (README §4.8) — "revisión instantánea": en vez de revisar aquí
// las 25 respuestas ítem a ítem, se confirma solo lo imprescindible para que
// el backend acepte crear la sesión (consentimiento, compromiso, demografía
// completa) y, en cuanto existe, se abre directamente la misma pantalla de
// edición que usa la pestaña Sesiones para cualquier otra sesión — así la
// revisión fina ocurre sobre datos ya guardados, sin un formulario aparte que
// mantener sincronizado con el de edición.
// ============================================================

function renderConfirmacionYCrear(
  zona,
  { tokenIdDetectado, tokens, items, oscuridadGlobal, textosGlobal, paginasWarpeadas, alRecargar }
) {
  const consentimientoSeed = (oscuridadGlobal.get("demografia:consentimiento") ?? 0) >= UMBRAL_MARCA;
  const honestidadSeed = (oscuridadGlobal.get("demografia:compromiso_honestidad") ?? 0) >= UMBRAL_MARCA;
  const anioCorreccion = (textosGlobal.get("demografia:correccion:anio_nacimiento") ?? "").replace(/\D/g, "");
  const anioPrincipal = (textosGlobal.get("demografia:anio_nacimiento") ?? "").replace(/\D/g, "");
  const demografiaSeed = {
    anio_nacimiento: anioCorreccion || anioPrincipal,
    sexo: ganadorDeGrupo(oscuridadGlobal, "demografia:sexo:"),
    ccaa_educacion_secundaria: ganadorDeGrupo(oscuridadGlobal, "demografia:ccaa_educacion_secundaria:"),
    nivel_estudios: ganadorDeGrupo(oscuridadGlobal, "demografia:nivel_estudios:"),
    area_estudios: ganadorDeGrupo(oscuridadGlobal, "demografia:area_estudios:"),
    estudios_mayor_progenitor: ganadorDeGrupo(oscuridadGlobal, "demografia:estudios_mayor_progenitor:"),
    libros_en_casa: ganadorDeGrupo(oscuridadGlobal, "demografia:libros_en_casa:"),
  };

  const miniaturas = paginasWarpeadas
    .map(
      (canvas, i) => `
      <details class="revision-miniatura">
        <summary>Ver foto enderezada — página ${i + 1}</summary>
        <img src="${canvas.toDataURL("image/jpeg", 0.7)}" alt="Página ${i + 1} enderezada" />
      </details>`
    )
    .join("");

  // Remesa (README §4.9): si el QR de la página de datos se leyó y coincide
  // con un token real, se usa directamente sin pedir nada — así se puede
  // digitalizar un montón de fotos de remesas distintas sin tener que saber
  // de antemano cuál es cuál. Si no se pudo leer (o no coincide con ningún
  // token existente), hace falta elegirlo aquí a mano antes de poder crear
  // la sesión, con las mismas opciones que en la pestaña Tokens.
  const tokenDetectado = tokenIdDetectado ? tokens.find((t) => t.id === tokenIdDetectado) : null;
  const bloqueToken = tokenDetectado
    ? `<div class="revision-item">
        <div class="revision-item-enunciado">Remesa</div>
        <p class="nota-formato">Detectada automáticamente por el QR: <strong>${escaparHtml(tokenDetectado.descripcion)}</strong></p>
      </div>`
    : `<div class="revision-item">
        <div class="revision-item-enunciado">Remesa</div>
        <p class="nota-formato">${
          tokenIdDetectado
            ? "El QR se leyó pero no corresponde a ningún token existente — elige la remesa a mano."
            : "No se pudo leer el QR de la remesa en ninguna página — elige la remesa a mano."
        }</p>
        <label class="campo">
          <span>Token de la remesa a la que pertenece esta hoja</span>
          <select id="select-token-confirmacion" required>
            <option value="">Selecciona un token…</option>
            ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
          </select>
        </label>
      </div>`;

  zona.innerHTML = `
    <h3>Confirmar datos y crear la sesión</h3>
    <p class="nota-formato">
      Esto es solo lo imprescindible para poder crear la sesión (remesa, consentimiento, compromiso y
      demografía). Las 25 respuestas se revisan justo después, ya guardadas, en la misma pantalla de
      edición que el resto de sesiones del panel — así se corrige al momento sin perder lo digitalizado.
    </p>
    ${miniaturas}
    ${bloqueToken}
    <div class="revision-item">
      <div class="revision-item-enunciado">Consentimiento y compromiso</div>
      <label class="revision-checkbox">
        <input type="checkbox" data-campo="demografia:consentimiento" ${consentimientoSeed ? "checked" : ""} />
        Consiente participar
      </label>
      <label class="revision-checkbox">
        <input type="checkbox" data-campo="demografia:compromiso_honestidad" ${honestidadSeed ? "checked" : ""} />
        Compromiso de honestidad
      </label>
    </div>
    ${bloqueCamposDemografia(demografiaSeed)}
    <div class="botones-celda">
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-crear-sesion">Crear sesión y revisar respuestas</button>
      <button type="button" class="boton-secundario boton-ancho-auto" id="boton-cancelar-escaneo">Cancelar</button>
    </div>
    <p id="estado-crear" class="nota-formato"></p>`;

  zona.querySelector("#boton-cancelar-escaneo").addEventListener("click", () => alRecargar());

  zona.querySelector("#boton-crear-sesion").addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    const estado = zona.querySelector("#estado-crear");
    const tokenId = tokenDetectado ? tokenDetectado.id : zona.querySelector("#select-token-confirmacion")?.value;
    if (!tokenId) {
      estado.textContent = "Falta elegir la remesa (token).";
      return;
    }
    boton.disabled = true;
    estado.textContent = "Creando sesión…";
    try {
      const consentimiento = zona.querySelector('[data-campo="demografia:consentimiento"]').checked;
      const compromiso_honestidad = zona.querySelector('[data-campo="demografia:compromiso_honestidad"]').checked;
      const demografia = leerDemografiaDelFormulario(zona);
      const respuestas = decodificarRespuestas(items, oscuridadGlobal, textosGlobal);
      const resultado = await api.digitalizar({ token_id: tokenId, consentimiento, compromiso_honestidad, demografia, respuestas });
      await renderEditarSesion(zona, resultado.sesion_id, { onVolver: () => alRecargar() });
    } catch (e) {
      estado.textContent = `Error: ${e.message}`;
      boton.disabled = false;
    }
  });
}

// ============================================================
// 7. Orquestación del escaneo página a página
// ============================================================

function iniciarEscaneo(zona, { tokenIdInicial, tokens, items, paginas }) {
  const oscuridadGlobal = new Map();
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  // Token detectado por QR en alguna de las páginas escaneadas (README §4.9);
  // empieza con el que se haya seleccionado a mano ANTES de escanear (si
  // había uno), pero un QR leído con éxito lo sustituye — es más fiable que
  // una preselección hecha sin haber visto aún la hoja física.
  let tokenIdDetectado = tokenIdInicial || null;
  let indice = 0;

  function renderPasoActual() {
    if (indice >= paginas.length) {
      renderConfirmacionYCrear(zona, {
        tokenIdDetectado,
        tokens,
        items,
        oscuridadGlobal,
        textosGlobal,
        paginasWarpeadas,
        alRecargar: () => (zona.innerHTML = ""),
      });
      return;
    }
    const pagina = paginas[indice];
    const esDemografia = pagina.itemIds.length === 0;
    zona.innerHTML = `
      <div class="escaneo-paso">
        <h3>${esDemografia ? "Página de datos" : "Página de ítems"} (${indice + 1} de ${paginas.length})</h3>
        <p class="nota-formato">
          Sube la foto o el escaneo de esta página. Los 4 puntos rojos deben quedar sobre el CENTRO de los
          4 cuadrados negros impresos en las esquinas de la hoja — se detectan solos si la foto es clara;
          si no, arrástralos a mano.
        </p>
        <input type="file" accept="image/*" id="campo-foto-pagina" />
        <div id="zona-canvas-esquinas"></div>
        <div class="botones-celda" id="botones-paso" hidden>
          <button type="button" class="boton-principal boton-ancho-auto" id="boton-confirmar-pagina">Leer esta página</button>
          <button type="button" class="boton-secundario boton-ancho-auto" id="boton-saltar-pagina">Saltar página (dejar en blanco)</button>
        </div>
        <p id="estado-paso" class="nota-formato"></p>
      </div>`;

    let fuente = null;
    let esquinas = null;

    zona.querySelector("#campo-foto-pagina").addEventListener("change", async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const estado = zona.querySelector("#estado-paso");
      estado.textContent = "Cargando imagen…";
      fuente = await prepararImagenFuente(file);
      const detectados = detectarFiduciales(fuente);
      const zonaCanvas = zona.querySelector("#zona-canvas-esquinas");
      zonaCanvas.innerHTML = "";
      const canvas = document.createElement("canvas");
      const anchoPresentacion = Math.min(800, fuente.width);
      canvas.width = anchoPresentacion;
      canvas.height = Math.round((fuente.height / fuente.width) * anchoPresentacion);
      canvas.className = "canvas-esquinas";
      zonaCanvas.appendChild(canvas);
      const selector = crearSelectorEsquinas(canvas, fuente, fuente.width, fuente.height, detectados);
      esquinas = selector;
      estado.textContent = detectados
        ? "Esquinas detectadas automáticamente — comprueba que coinciden y ajusta si no."
        : "No se detectaron las esquinas automáticamente: arrástralas a mano sobre los 4 cuadrados negros.";
      zona.querySelector("#botones-paso").hidden = false;
    });

    zona.querySelector("#boton-saltar-pagina").addEventListener("click", () => {
      indice++;
      renderPasoActual();
    });

    zona.querySelector("#boton-confirmar-pagina").addEventListener("click", async () => {
      const boton = zona.querySelector("#boton-confirmar-pagina");
      const estado = zona.querySelector("#estado-paso");
      if (!fuente || !esquinas) return;
      boton.disabled = true;
      try {
        estado.textContent = "Enderezando imagen…";
        const destW = Math.round(PAGE_W * ESCALA_DIGITALIZACION);
        const destH = Math.round(PAGE_H * ESCALA_DIGITALIZACION);
        // Destino de la homografía: la posición CANÓNICA de los 4 fiduciales
        // (medida en hoja.js, no los bordes exactos del rectángulo) — los
        // puntos de referencia fuente Y destino son los fiduciales.
        const dst = ["tl", "tr", "br", "bl"].map((esquina) => ({
          x: pagina.fiduciales[esquina].cx * ESCALA_DIGITALIZACION,
          y: pagina.fiduciales[esquina].cy * ESCALA_DIGITALIZACION,
        }));
        const warp = warpearImagen(fuente, esquinas.obtenerEsquinas(), destW, destH, dst);
        paginasWarpeadas.push(warp);
        const imgData = warp.getContext("2d").getImageData(0, 0, destW, destH);

        for (const m of pagina.marcas) {
          oscuridadGlobal.set(
            m.clave,
            calcularOscuridad(imgData, m.cx * ESCALA_DIGITALIZACION, m.cy * ESCALA_DIGITALIZACION, m.radio * ESCALA_DIGITALIZACION)
          );
        }

        for (const l of pagina.lineas) {
          const recorte = recortarLinea(warp, l, ESCALA_DIGITALIZACION);
          if (l.clave === "meta:qr") {
            estado.textContent = "Leyendo QR de la remesa…";
            try {
              const leido = await decodificarQr(recorte);
              if (leido && tokens.some((t) => t.id === leido)) tokenIdDetectado = leido;
            } catch {
              // sin jsQR disponible (sin red, CDN caído…): se sigue sin el
              // atajo del QR, el admin elige la remesa a mano en la confirmación
            }
            continue;
          }
          estado.textContent = `Leyendo texto (${l.clave})…`;
          const soloDigitos = l.clave.endsWith(":anio_nacimiento");
          const texto = await ocrLinea(recorte, {
            soloDigitos,
            avisar: (msg) => (estado.textContent = msg),
          });
          textosGlobal.set(l.clave, texto);
        }

        indice++;
        renderPasoActual();
      } catch (e) {
        estado.textContent = `Error leyendo la página: ${e.message}`;
        boton.disabled = false;
      }
    });
  }

  renderPasoActual();
}

// ============================================================
// 8. Entrada de la pestaña
// ============================================================

export async function renderDigitalizar(contenedor) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <section class="digitalizar-bloque">
      <h3>1. Imprimir hoja de respuestas</h3>
      <p class="nota-formato">
        Genera la hoja de respuestas (formato OMR: casillas a rellenar) con los 25 ítems del banco actual,
        con un código QR de la remesa elegida — así al digitalizarla más tarde no hace falta recordar de
        qué remesa era cada foto. Se abre lista para imprimir; desde el diálogo de impresión del navegador,
        "Guardar como PDF" da la versión en PDF sin coste añadido.
      </p>
      <label class="campo">
        <span>Remesa para el QR de esta hoja</span>
        <select id="select-token-imprimir">
          <option value="">Selecciona un token…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-generar-hoja" disabled>Generar e imprimir hoja</button>
      <p id="estado-hoja" class="nota-formato"></p>
    </section>
    <section class="digitalizar-bloque">
      <h3>2. Digitalizar una hoja rellenada</h3>
      <p class="nota-formato">
        Sube fotos de las páginas de una hoja ya rellenada; se interpretan en tu propio navegador
        (sin subir nada a ningún servicio externo salvo el Worker de este proyecto al guardar el resultado).
        La remesa se detecta sola por el QR de la página de datos — el token de aquí abajo es solo un
        respaldo por si la foto de esa página no se pudo leer.
      </p>
      <label class="campo">
        <span>Token de la remesa (opcional: se detecta por QR)</span>
        <select id="select-token-digitalizar">
          <option value="">Se detectará por QR…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-empezar-escaneo">Empezar digitalización</button>
      <div id="zona-escaneo"></div>
    </section>`;

  const selectTokenImprimir = contenedor.querySelector("#select-token-imprimir");
  const botonGenerar = contenedor.querySelector("#boton-generar-hoja");
  selectTokenImprimir.addEventListener("change", () => {
    botonGenerar.disabled = !selectTokenImprimir.value;
  });

  botonGenerar.addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    const estado = contenedor.querySelector("#estado-hoja");
    const tokenId = selectTokenImprimir.value;
    if (!tokenId) return;
    boton.disabled = true;
    estado.textContent = "Generando código QR…";
    try {
      const dataUrl = await generarQrDataUrl(tokenId);
      estado.textContent = "Generando hoja…";
      const { items } = await api.itemsImpresion();
      const paginas = construirHoja(items, { dataUrl, tokenId });
      abrirVentanaImpresion(paginas);
      estado.textContent = `Hoja generada: ${paginas.length} páginas.`;
    } catch (e) {
      estado.textContent = `Error: ${e.message}`;
    } finally {
      boton.disabled = false;
    }
  });

  const selectToken = contenedor.querySelector("#select-token-digitalizar");
  const botonEmpezar = contenedor.querySelector("#boton-empezar-escaneo");

  botonEmpezar.addEventListener("click", async () => {
    botonEmpezar.disabled = true;
    const zona = contenedor.querySelector("#zona-escaneo");
    zona.innerHTML = "<p>Cargando el banco de ítems…</p>";
    try {
      const { items } = await api.itemsImpresion();
      const paginas = construirHoja(items);
      iniciarEscaneo(zona, { tokenIdInicial: selectToken.value || null, tokens, items, paginas });
    } catch (e) {
      zona.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    } finally {
      botonEmpezar.disabled = false;
    }
  });
}
