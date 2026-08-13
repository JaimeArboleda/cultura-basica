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
// primer parámetro a tocar antes de complicar el resto del algoritmo.
const UMBRAL_MARCA = 0.35;

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
// evita los huecos que dejaría proyectar hacia delante).
export function warpearImagen(canvasFuente, esquinas, destW, destH) {
  const sw = canvasFuente.width;
  const sh = canvasFuente.height;
  const srcData = canvasFuente.getContext("2d").getImageData(0, 0, sw, sh).data;

  const destino = document.createElement("canvas");
  destino.width = destW;
  destino.height = destH;
  const destCtx = destino.getContext("2d");
  const destImg = destCtx.createImageData(destW, destH);
  const destData = destImg.data;

  const dst = [
    { x: 0, y: 0 },
    { x: destW, y: 0 },
    { x: destW, y: destH },
    { x: 0, y: destH },
  ];
  const H = calcularHomografia(esquinas, dst); // fuente -> destino
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

// Recorte de una única línea (una respuesta 'abierto' o el año de
// nacimiento, README §1.6/§4.7): PSM 7 = "línea única", más una lista blanca
// de caracteres que coincide con lo que se pide escribir en la hoja
// (MAYÚSCULAS de imprenta, o solo dígitos para el año).
export async function ocrLinea(canvas, { soloDigitos = false, avisar } = {}) {
  const worker = await obtenerWorkerTesseract(avisar);
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: soloDigitos ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑ0123456789 ",
  });
  const { data } = await worker.recognize(canvas);
  return (data.text || "").trim();
}

// ============================================================
// 4. Selector de 4 esquinas sobre la foto subida
// ============================================================

// canvas ya dimensionado por el llamador al tamaño de PRESENTACIÓN; fuente
// es el canvas/imagen de trabajo a resolución completa (anchoNatural x
// altoNatural). Los puntos se guardan en coordenadas de "fuente" (naturales),
// que es justo lo que necesita calcularHomografia más adelante.
function crearSelectorEsquinas(canvas, fuente, anchoNatural, altoNatural) {
  const ctx = canvas.getContext("2d");
  const escala = canvas.width / anchoNatural;
  const puntos = [
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

// Traduce la oscuridad/textos muestreados directamente a la forma que espera
// el backend por formato (README §4.2): abierto=string, opcion_multiple=índice,
// seleccion_multiple=[índices], ordenar=[nombres en orden], clasificar={elemento:categoría}.
// Un ítem sin marca/texto detectado simplemente no aparece en el resultado
// (igual que dejarlo en blanco en la web) — la revisión fina ocurre después,
// ya guardado, en la pantalla de edición (editarSesion.js).
export function decodificarRespuestas(items, oscuridad, textos) {
  const respuestas = {};
  for (const item of items) {
    switch (item.formato) {
      case "abierto": {
        const texto = (textos.get(`item:${item.id}:abierto`) ?? "").trim();
        if (texto) respuestas[item.id] = texto;
        break;
      }
      case "opcion_multiple": {
        const g = ganadorDeGrupo(oscuridad, `item:${item.id}:opcion:`);
        if (g != null) respuestas[item.id] = Number(g);
        break;
      }
      case "seleccion_multiple": {
        const marcadas = marcadasEnGrupo(oscuridad, `item:${item.id}:opcion:`)
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
          const g = ganadorDeGrupo(oscuridad, `item:${item.id}:orden:${i}:`);
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
          const g = ganadorDeGrupo(oscuridad, `item:${item.id}:clasificar:${i}:`);
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

function renderConfirmacionYCrear(zona, { tokenId, items, oscuridadGlobal, textosGlobal, paginasWarpeadas, alRecargar }) {
  const consentimientoSeed = (oscuridadGlobal.get("demografia:consentimiento") ?? 0) >= UMBRAL_MARCA;
  const honestidadSeed = (oscuridadGlobal.get("demografia:compromiso_honestidad") ?? 0) >= UMBRAL_MARCA;
  const demografiaSeed = {
    anio_nacimiento: (textosGlobal.get("demografia:anio_nacimiento") ?? "").replace(/\D/g, ""),
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

  zona.innerHTML = `
    <h3>Confirmar datos y crear la sesión</h3>
    <p class="nota-formato">
      Esto es solo lo imprescindible para poder crear la sesión (consentimiento, compromiso y
      demografía). Las 25 respuestas se revisan justo después, ya guardadas, en la misma pantalla de
      edición que el resto de sesiones del panel — así se corrige al momento sin perder lo digitalizado.
    </p>
    ${miniaturas}
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

function iniciarEscaneo(zona, { tokenId, items, paginas }) {
  const oscuridadGlobal = new Map();
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  let indice = 0;

  function renderPasoActual() {
    if (indice >= paginas.length) {
      renderConfirmacionYCrear(zona, {
        tokenId,
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
          Sube la foto o el escaneo de esta página. Después, ajusta las 4 esquinas rojas para que coincidan
          exactamente con los bordes de la hoja (arrastra cada punto).
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
      const zonaCanvas = zona.querySelector("#zona-canvas-esquinas");
      zonaCanvas.innerHTML = "";
      const canvas = document.createElement("canvas");
      const anchoPresentacion = Math.min(800, fuente.width);
      canvas.width = anchoPresentacion;
      canvas.height = Math.round((fuente.height / fuente.width) * anchoPresentacion);
      canvas.className = "canvas-esquinas";
      zonaCanvas.appendChild(canvas);
      const selector = crearSelectorEsquinas(canvas, fuente, fuente.width, fuente.height);
      esquinas = selector;
      estado.textContent = "";
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
        const warp = warpearImagen(fuente, esquinas.obtenerEsquinas(), destW, destH);
        paginasWarpeadas.push(warp);
        const imgData = warp.getContext("2d").getImageData(0, 0, destW, destH);

        for (const m of pagina.marcas) {
          oscuridadGlobal.set(
            m.clave,
            calcularOscuridad(imgData, m.cx * ESCALA_DIGITALIZACION, m.cy * ESCALA_DIGITALIZACION, m.radio * ESCALA_DIGITALIZACION)
          );
        }

        for (const l of pagina.lineas) {
          estado.textContent = `Leyendo texto (${l.clave})…`;
          const recorte = recortarLinea(warp, l, ESCALA_DIGITALIZACION);
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
        Genera la hoja de respuestas (formato OMR: casillas a rellenar) con los 25 ítems del banco actual
        y la abre lista para imprimir. Desde el diálogo de impresión del navegador, "Guardar como PDF" da
        la versión en PDF sin coste añadido.
      </p>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-generar-hoja">Generar e imprimir hoja</button>
      <p id="estado-hoja" class="nota-formato"></p>
    </section>
    <section class="digitalizar-bloque">
      <h3>2. Digitalizar una hoja rellenada</h3>
      <p class="nota-formato">
        Sube fotos de las páginas de una hoja ya rellenada; se interpretan en tu propio navegador
        (sin subir nada a ningún servicio externo salvo el Worker de este proyecto al guardar el resultado).
      </p>
      <label class="campo">
        <span>Token de la remesa a la que pertenece esta hoja</span>
        <select id="select-token-digitalizar">
          <option value="">Selecciona un token…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-empezar-escaneo" disabled>Empezar digitalización</button>
      <div id="zona-escaneo"></div>
    </section>`;

  contenedor.querySelector("#boton-generar-hoja").addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    const estado = contenedor.querySelector("#estado-hoja");
    boton.disabled = true;
    estado.textContent = "Generando hoja…";
    try {
      const { items } = await api.itemsImpresion();
      const paginas = construirHoja(items);
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
  selectToken.addEventListener("change", () => {
    botonEmpezar.disabled = !selectToken.value;
  });

  botonEmpezar.addEventListener("click", async () => {
    const tokenId = selectToken.value;
    if (!tokenId) return;
    botonEmpezar.disabled = true;
    const zona = contenedor.querySelector("#zona-escaneo");
    zona.innerHTML = "<p>Cargando el banco de ítems…</p>";
    try {
      const { items } = await api.itemsImpresion();
      const paginas = construirHoja(items);
      iniciarEscaneo(zona, { tokenId, items, paginas });
    } catch (e) {
      zona.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    } finally {
      botonEmpezar.disabled = false;
    }
  });
}
