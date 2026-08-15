// Subida en bloque de hojas en papel (README §4.10): pestaña "Subir en
// bloque" del panel de admin. A diferencia del flujo secuencial de siempre
// (public/admin/papel/v{1,2}/digitalizar.js, README §4.7 — sube las páginas
// de UNA hoja, en orden, en una sola visita), aquí se suben fotos o PDFs
// sueltos de páginas de CUALQUIER hoja, en cualquier orden y en cuantas
// visitas hagan falta: cada página se identifica sola por el QR pequeño que
// lleva en todas las páginas (comun.js::codificarPayloadQrPagina — exam_id +
// número de página) y el resultado ya decodificado se guarda en el Worker
// (worker/src/endpoints/admin/examenesPapel.ts) hasta que un examen tiene
// todas sus páginas y se puede "Finalizar" — momento en el que se reutiliza
// la MISMA pantalla de confirmación que el flujo secuencial
// (renderConfirmacionYCrear, exportada por v1/v2 digitalizar.js) para no
// mantener dos formularios de creación de sesión por separado.
//
// Motivación (README §4.10): permite desacoplar "escanear/fotografiar todas
// las hojas de una remesa" de "subirlas al panel", y hacer lo segundo página
// a página, sin depender de mantener el orden físico de las fotos.
import { api, escaparHtml } from "../admin.js";
import {
  cargarPaginasPdf,
  crearSelectorEsquinas,
  decodificarPayloadQr,
  decodificarPayloadQrPagina,
  decodificarQr,
  detectarFiduciales,
  ESCALA_DIGITALIZACION,
  leerPagina,
  medirGeometriaBaseEnBlanco,
  PAGE_H,
  PAGE_W,
  prepararImagenFuente,
  recortarRegionNitida,
  warpearImagen,
} from "./comun.js";
import { construirHoja as construirHojaV1 } from "./v1/hoja.js";
import { construirHoja as construirHojaV2 } from "./v2/hoja.js";
import * as pipelineV1 from "./v1/digitalizar.js";
import * as pipelineV2 from "./v2/digitalizar.js";

// Registro versión -> módulo (README §4.9/§4.10): a diferencia de
// admin.js::PIPELINES_PAPEL (que solo enruta la UI de imprimir/escanear de
// una versión elegida a mano), aquí hace falta poder despachar dinámicamente
// según la versión que traiga el QR de CADA página, sin saberla de antemano.
const PIPELINES = {
  1: { ...pipelineV1, construirHoja: construirHojaV1, etiqueta: "v1 — burbujas (OMR)" },
  2: { ...pipelineV2, construirHoja: construirHojaV2, etiqueta: "v2 — letras (OCR)" },
};

// --- Cachés: banco de ítems y layout por versión, calculados una sola vez
// por visita a la pestaña (son los mismos para todas las páginas/exámenes
// que se procesen, README §1.4: el banco es fijo). El layout (marcas/líneas
// de cada página) es justo lo que necesita leerPagina() para saber dónde
// mirar en la foto ya enderezada — se reconstruye llamando a construirHoja()
// SIN qr (no hace falta imprimir nada, solo medir), igual que el paso 2 del
// flujo secuencial. ---
let respuestaImpresionPromise = null;
function obtenerRespuestaImpresion() {
  if (!respuestaImpresionPromise) respuestaImpresionPromise = api.itemsImpresion();
  return respuestaImpresionPromise;
}
function obtenerItems() {
  return obtenerRespuestaImpresion().then((r) => r.items);
}
// Conteos de bloques por página ya precalculados (data/paginacion.json, ver
// comun.js::construirPaginas) — para que el layout reconstruido aquí tenga
// EXACTAMENTE el mismo número de páginas que el que se imprimió, sin volver
// a decidirlo midiendo el DOM de este navegador (README, "Paginado fiable").
function obtenerPaginacion(version) {
  return obtenerRespuestaImpresion().then((r) => r.paginacion?.[version]);
}

let itemsPorIdPromise = null;
function obtenerItemsPorId() {
  if (!itemsPorIdPromise) itemsPorIdPromise = obtenerItems().then((items) => new Map(items.map((it) => [it.id, it])));
  return itemsPorIdPromise;
}

let numeroPorIdPromise = null;
function obtenerNumeroPorId() {
  if (!numeroPorIdPromise) numeroPorIdPromise = obtenerItems().then((items) => new Map(items.map((it, i) => [it.id, i + 1])));
  return numeroPorIdPromise;
}

const layoutCache = new Map(); // version -> Promise<paginas>
function obtenerLayout(version) {
  if (!layoutCache.has(version)) {
    layoutCache.set(
      version,
      Promise.all([obtenerItems(), obtenerPaginacion(version)]).then(([items, paginacion]) =>
        PIPELINES[version].construirHoja(items, undefined, paginacion)
      )
    );
  }
  return layoutCache.get(version);
}

// Fiduciales + caja del QR de página: iguales para cualquier hoja (README
// §4.10), se miden una sola vez.
let geometriaBaseCache = null;
function obtenerGeometriaBase() {
  if (!geometriaBaseCache) geometriaBaseCache = medirGeometriaBaseEnBlanco();
  return geometriaBaseCache;
}

// token_id + versión de cada exam_id ya resuelto en esta visita (por QR, por
// el servidor o a mano) — evita volver a preguntar por cada página de la
// misma hoja física.
const examenesConocidos = new Map();

function generarMiniatura(warpCanvas) {
  const anchoDestino = 480;
  const altoDestino = Math.round((warpCanvas.height / warpCanvas.width) * anchoDestino);
  const mini = document.createElement("canvas");
  mini.width = anchoDestino;
  mini.height = altoDestino;
  mini.getContext("2d").drawImage(warpCanvas, 0, 0, anchoDestino, altoDestino);
  return mini.toDataURL("image/jpeg", 0.55);
}

// ============================================================
// Resolución manual (respaldos cuando algo no se puede leer solo): cada una
// pinta un formulario en la zona de intervención compartida y resuelve una
// promesa cuando el admin confirma — el bucle de procesamiento de la cola
// (procesarUnidad más abajo) se queda esperando ahí en medio.
// ============================================================

function pedirEsquinasManualmente(contenedor, canvasFuente) {
  return new Promise((resolve) => {
    contenedor.innerHTML = `
      <p class="nota-formato">
        No se detectaron los 4 cuadrados de esquina automáticamente en esta imagen: arrástralos a mano
        sobre los 4 cuadrados negros impresos en las esquinas de la hoja.
      </p>
      <div id="zona-canvas-manual-lote"></div>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-confirmar-esquinas-lote">Continuar</button>`;
    const zonaCanvas = contenedor.querySelector("#zona-canvas-manual-lote");
    const canvas = document.createElement("canvas");
    const anchoPresentacion = Math.min(800, canvasFuente.width);
    canvas.width = anchoPresentacion;
    canvas.height = Math.round((canvasFuente.height / canvasFuente.width) * anchoPresentacion);
    canvas.className = "canvas-esquinas";
    zonaCanvas.appendChild(canvas);
    const selector = crearSelectorEsquinas(canvas, canvasFuente, canvasFuente.width, canvasFuente.height, null);
    contenedor.querySelector("#boton-confirmar-esquinas-lote").addEventListener("click", () => {
      resolve(selector.obtenerEsquinas());
    });
  });
}

function pedirIdentificacionManual(contenedor) {
  return new Promise((resolve) => {
    const idsConocidos = [...examenesConocidos.keys()];
    contenedor.innerHTML = `
      <p class="nota-formato">
        No se pudo leer el código QR de página en esta imagen: identifica a mano a qué examen y a qué
        número de página pertenece (mira la hoja física o el ID que se mostró al imprimirla).
      </p>
      <label class="campo">
        <span>ID de examen</span>
        <input type="text" id="campo-exam-id-manual-lote" list="lista-examenes-conocidos-lote" autocomplete="off" />
        <datalist id="lista-examenes-conocidos-lote">
          ${idsConocidos.map((id) => `<option value="${escaparHtml(id)}"></option>`).join("")}
        </datalist>
      </label>
      <label class="campo">
        <span>Número de página (1 = primera página de la hoja)</span>
        <input type="number" id="campo-pagina-manual-lote" min="1" step="1" />
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-confirmar-manual-lote">Continuar</button>
      <p id="estado-manual-lote" class="mensaje-error"></p>`;
    contenedor.querySelector("#boton-confirmar-manual-lote").addEventListener("click", () => {
      const examId = contenedor.querySelector("#campo-exam-id-manual-lote").value.trim().toUpperCase();
      const pagina = Number(contenedor.querySelector("#campo-pagina-manual-lote").value);
      if (!examId || !Number.isInteger(pagina) || pagina < 1) {
        contenedor.querySelector("#estado-manual-lote").textContent =
          "Rellena el ID de examen y un número de página válido.";
        return;
      }
      resolve({ examId, pagina });
    });
  });
}

function pedirTokenYVersion(contenedor, { examId, tokens, motivoFallback }) {
  return new Promise((resolve) => {
    contenedor.innerHTML = `
      <p class="nota-formato">
        Examen <code>${escaparHtml(examId)}</code> nuevo para el servidor: dime a mano a qué remesa y a qué
        versión de hoja pertenece — se recuerda para el resto de páginas de este mismo examen, no hace falta
        repetirlo.
      </p>
      ${motivoFallback ? `<p class="nota-formato">(Motivo: ${escaparHtml(motivoFallback)})</p>` : ""}
      <label class="campo">
        <span>Remesa</span>
        <select id="select-token-manual-lote" required>
          <option value="">Selecciona un token…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <label class="campo">
        <span>Versión de la hoja</span>
        <select id="select-version-manual-lote" required>
          ${Object.entries(PIPELINES)
            .map(([v, p]) => `<option value="${v}">${escaparHtml(p.etiqueta)}</option>`)
            .join("")}
        </select>
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-confirmar-token-lote">Continuar</button>
      <p id="estado-token-manual-lote" class="mensaje-error"></p>`;
    contenedor.querySelector("#boton-confirmar-token-lote").addEventListener("click", () => {
      const tokenId = contenedor.querySelector("#select-token-manual-lote").value;
      const version = Number(contenedor.querySelector("#select-version-manual-lote").value);
      if (!tokenId) {
        contenedor.querySelector("#estado-token-manual-lote").textContent = "Falta elegir la remesa.";
        return;
      }
      resolve({ tokenId, version });
    });
  });
}

// ============================================================
// Procesamiento de una página suelta (foto o página de un PDF ya dividido):
// esquinas -> homografía -> QR de página -> resolver examen -> leer
// contenido -> subir al servidor. Cada paso que no se puede resolver solo
// cae en una de las funciones de arriba, que pausan aquí hasta que el admin
// lo resuelve a mano.
// ============================================================

async function procesarUnidad(unidad, { tokens, zonaIntervencion, log, motorOcr, modeloIA }) {
  log("Detectando esquinas…");
  const detectados = detectarFiduciales(unidad.canvas);
  let esquinas = detectados;
  if (!esquinas) {
    zonaIntervencion.hidden = false;
    log("Esquinas no detectadas: ajústalas arriba ↑ para continuar…");
    esquinas = await pedirEsquinasManualmente(zonaIntervencion, unidad.canvas);
    zonaIntervencion.hidden = true;
  }

  const geometriaBase = obtenerGeometriaBase();
  const destW = Math.round(PAGE_W * ESCALA_DIGITALIZACION);
  const destH = Math.round(PAGE_H * ESCALA_DIGITALIZACION);
  const dst = ["tl", "tr", "br", "bl"].map((esquina) => ({
    x: geometriaBase.fiduciales[esquina].cx * ESCALA_DIGITALIZACION,
    y: geometriaBase.fiduciales[esquina].cy * ESCALA_DIGITALIZACION,
  }));
  const warp = warpearImagen(unidad.canvas, esquinas, destW, destH, dst);

  log("Leyendo QR de página…");
  let identificacion = null;
  try {
    const recorteQr = recortarRegionNitida(unidad.canvas, esquinas, dst, geometriaBase.lineaQrPagina, ESCALA_DIGITALIZACION);
    const leido = await decodificarQr(recorteQr);
    if (leido) identificacion = decodificarPayloadQrPagina(leido);
  } catch {
    // sin jsQR disponible (sin red, CDN caído…): se cae a la resolución manual
  }
  if (!identificacion) {
    zonaIntervencion.hidden = false;
    log("QR de página no legible: identifica arriba ↑ a qué examen y página pertenece…");
    identificacion = await pedirIdentificacionManual(zonaIntervencion);
    zonaIntervencion.hidden = true;
  }
  const { examId, pagina } = identificacion;

  let info = examenesConocidos.get(examId);
  if (!info) {
    try {
      const detalle = await api.examenPapelDetalle(examId);
      info = { tokenId: detalle.token_id, version: detalle.version };
      examenesConocidos.set(examId, info);
    } catch (e) {
      if (e.status && e.status !== 404) throw e;
    }
  }
  // Primera página de un exam_id que el servidor todavía no conoce (README
  // §4.9): antes de pedirlo a mano, se intenta leer el QR GRANDE (remesa +
  // versión completos, solo en la página 1) — geometriaBase.lineaQrGrande es
  // la misma en cualquier versión (comun.js::medirGeometriaBaseEnBlanco), así
  // que se puede recortar y decodificar sin saber todavía qué versión es esta
  // hoja, igual que ya hace el flujo secuencial (v{1,2}/digitalizar.js) al
  // escanear. Si la página no es la 1, o el QR grande no se lee, o lee un
  // token_id/version que no cuadra con nada conocido, se cae a pedirlo a mano
  // (mismo respaldo de siempre).
  // motivoFallback: diagnóstico de por qué no se pudo fijar `info` solo, para
  // mostrarlo en el formulario manual (pedirTokenYVersion más abajo) — sin
  // esto, un QR grande ilegible/no coincidente y "no es la página 1" se veían
  // exactamente igual desde fuera (siempre "elige arriba a mano"), lo que
  // hacía imposible saber por qué no se detectó solo sin abrir devtools.
  let motivoFallback = null;
  if (!info && pagina === 1) {
    log("Leyendo QR de la remesa…");
    try {
      const recorteQrGrande = recortarRegionNitida(unidad.canvas, esquinas, dst, geometriaBase.lineaQrGrande, ESCALA_DIGITALIZACION);
      const leidoGrande = await decodificarQr(recorteQrGrande);
      if (leidoGrande) {
        const datosGrande = decodificarPayloadQr(leidoGrande);
        if (tokens.some((t) => t.id === datosGrande.tokenId) && PIPELINES[datosGrande.version]) {
          info = { tokenId: datosGrande.tokenId, version: datosGrande.version };
          examenesConocidos.set(examId, info);
        } else {
          motivoFallback = `El QR grande se leyó (token_id="${datosGrande.tokenId}", versión ${datosGrande.version}) pero no coincide con ningún token activo ni versión conocida.`;
        }
      } else {
        motivoFallback = "El QR grande de la remesa no se pudo decodificar en esta foto (jsQR no encontró nada legible en esa zona).";
      }
    } catch (e) {
      motivoFallback = `Error leyendo el QR grande: ${e.message}`;
    }
  } else if (!info) {
    motivoFallback = `Esta foto es la página ${pagina}, no la 1 — el QR grande de la remesa solo está impreso en la página 1.`;
  }
  if (!info) {
    zonaIntervencion.hidden = false;
    log("Hoja nueva: elige arriba ↑ a qué remesa y versión pertenece…");
    info = await pedirTokenYVersion(zonaIntervencion, { examId, tokens, motivoFallback });
    examenesConocidos.set(examId, info);
    zonaIntervencion.hidden = true;
  }

  const layout = await obtenerLayout(info.version);
  const paginaLayout = layout[pagina - 1];
  if (!paginaLayout) {
    throw new Error(
      `La página ${pagina} no existe en la hoja de la versión ${info.version} (¿ha cambiado el banco de ítems desde que se imprimió esta hoja?)`
    );
  }

  log(`Leyendo contenido (examen ${examId}, página ${pagina})…`);
  // Motor IA (README §4.7): solo tiene sentido para v2 (sobre todo casillas
  // de letra) — v1 es sobre todo burbujas OMR sin letra impresa al lado, así
  // que aquí se ignora el motor elegido y se usa Tesseract siempre que la
  // hoja sea v1 (PIPELINES[1] no tiene construirEntradaPaginaIA/
  // construirManifiestoItems, solo PIPELINES[2] los expone). Siempre "una
  // llamada por página" (a diferencia del flujo secuencial, que también
  // ofrece "examen completo"): las páginas de una misma hoja pueden llegar
  // en visitas o dispositivos distintos y cada una se persiste en cuanto se
  // lee (README §4.10), así que no existe un momento único de "hoja
  // completa" antes de guardar donde acumular varias páginas en una llamada.
  const motorIADisponible = motorOcr === "ia" && info.version === 2;
  const { oscuridad, textos } = await leerPagina(paginaLayout, warp, {
    opcionesOcrParaClave: PIPELINES[info.version].opcionesOcrParaClave,
    avisar: log,
    canvasFuente: unidad.canvas,
    esquinas,
    dstFiduciales: dst,
    omitirTextos: motorIADisponible,
  });

  if (motorIADisponible) {
    log("Leyendo la página con IA…");
    const [itemsPorId, numeroPorId] = await Promise.all([obtenerItemsPorId(), obtenerNumeroPorId()]);
    const entradaIA = PIPELINES[2].construirEntradaPaginaIA(paginaLayout, warp, itemsPorId, numeroPorId, `${examId}-${pagina}`);
    const { resultados } = await api.ocrIa({ modelo: modeloIA, paginas: [entradaIA] });
    Object.assign(textos, resultados[entradaIA.id] ?? {});
  }

  log("Guardando…");
  await api.examenPapelSubirPagina({
    exam_id: examId,
    token_id: info.tokenId,
    version: info.version,
    pagina,
    marcas: { oscuridad, textos },
    miniatura: generarMiniatura(warp),
  });

  return { examId, pagina, version: info.version };
}

// ============================================================
// Finalizar un examen completo: reutiliza tal cual la pantalla de
// confirmación del flujo secuencial (README §4.8, "revisión instantánea"),
// solo que oscuridadGlobal/textosGlobal/paginasWarpeadas vienen de las
// páginas ya subidas y persistidas, no de escanear en la propia visita.
// ============================================================

async function finalizarExamen(contenedorRaiz, examId, { tokens, items }) {
  const detalle = await api.examenPapelDetalle(examId);
  const oscuridadGlobal = new Map();
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  for (const p of [...detalle.paginas].sort((a, b) => a.pagina - b.pagina)) {
    const marcas = JSON.parse(p.marcas_json);
    for (const [clave, valor] of Object.entries(marcas.oscuridad ?? {})) oscuridadGlobal.set(clave, valor);
    for (const [clave, valor] of Object.entries(marcas.textos ?? {})) textosGlobal.set(clave, valor);
    if (p.miniatura_datauri) paginasWarpeadas.push(p.miniatura_datauri);
  }
  const pipeline = PIPELINES[detalle.version];
  contenedorRaiz.innerHTML = "";
  pipeline.renderConfirmacionYCrear(contenedorRaiz, {
    tokenIdDetectado: detalle.token_id,
    examIdDetectado: examId,
    tokens,
    items,
    oscuridadGlobal,
    textosGlobal,
    paginasWarpeadas,
    alRecargar: () => renderSubirLote(contenedorRaiz),
  });
}

// ============================================================
// Listado "exámenes en progreso"
// ============================================================

async function renderListaExamenes(zona, { contenedorRaiz, tokens, refrescar }) {
  const { examenes } = await api.examenesPapel();
  if (examenes.length === 0) {
    zona.innerHTML = "<p class='nota-formato'>Todavía no se ha subido ninguna página.</p>";
    return;
  }
  const items = await obtenerItems();
  const filas = await Promise.all(
    examenes.map(async (ex) => {
      const layout = await obtenerLayout(ex.version);
      const total = layout.length;
      const subidas = new Set(ex.paginas_subidas);
      const completo = total > 0 && subidas.size === total;
      const token = tokens.find((t) => t.id === ex.token_id);
      return { ex, total, subidas, completo, token };
    })
  );

  zona.innerHTML = filas
    .map(({ ex, total, subidas, completo, token }) => {
      const chips = Array.from({ length: total }, (_, i) => i + 1)
        .map((n) => `<span class="chip-pagina ${subidas.has(n) ? "chip-pagina-ok" : "chip-pagina-falta"}">${n}</span>`)
        .join("");
      const resumen = ex.sesion_id
        ? `ya digitalizado (${ex.paginas_subidas.length}/${total} páginas)`
        : `${ex.paginas_subidas.length}/${total} páginas`;
      // Idempotencia por hoja física (README §4.10): un examen ya
      // digitalizado se puede volver a "Finalizar" — sobrescribe la MISMA
      // sesión con lo que haya persistido ahora mismo, así que corregir una
      // página (p. ej. re-subir la 7 con una foto mejor) y volver a pulsar
      // este botón basta para que la sesión refleje la corrección, sin tener
      // que borrar nada primero (POST /api/admin/digitalizacion ya no
      // rechaza con 409 un examen_id repetido).
      const acciones = `
        ${
          ex.sesion_id
            ? `<p class="nota-formato">Ya digitalizado en la sesión <code>${escaparHtml(ex.sesion_id)}</code> — si corriges una página aquí abajo, vuelve a pulsar "Finalizar" para que la sesión recoja el cambio.</p>`
            : ""
        }
        <div class="botones-celda">
          <button type="button" class="boton-principal boton-ancho-auto" data-accion="finalizar" data-exam="${escaparHtml(ex.exam_id)}" ${completo ? "" : "disabled"}>
            ${ex.sesion_id ? "Volver a finalizar (sobrescribe la sesión)" : "Finalizar y crear sesión"}
          </button>
          ${
            ex.sesion_id
              ? ""
              : `<button type="button" class="boton-secundario boton-ancho-auto" data-accion="abandonar" data-exam="${escaparHtml(ex.exam_id)}">
                  Abandonar examen (borra sus páginas)
                </button>`
          }
        </div>`;
      return `
        <details class="examen-lote" ${!ex.sesion_id && completo ? "open" : ""}>
          <summary><code>${escaparHtml(ex.exam_id)}</code> — ${escaparHtml(token?.descripcion ?? ex.token_id)} — ${PIPELINES[ex.version]?.etiqueta ?? `v${ex.version}`} — ${resumen}</summary>
          <div class="examen-lote-chips">${chips}</div>
          ${acciones}
          <p class="estado-examen-lote mensaje-error" data-exam-estado="${escaparHtml(ex.exam_id)}"></p>
        </details>`;
    })
    .join("");

  zona.querySelectorAll('[data-accion="abandonar"]').forEach((boton) => {
    boton.addEventListener("click", async () => {
      const examId = boton.dataset.exam;
      if (!confirm(`¿Borrar todas las páginas subidas del examen ${examId}? No se puede deshacer.`)) return;
      boton.disabled = true;
      try {
        await api.examenPapelBorrar(examId);
        await refrescar();
      } catch (e) {
        const estado = zona.querySelector(`[data-exam-estado="${CSS.escape(examId)}"]`);
        if (estado) estado.textContent = `Error: ${e.message}`;
        boton.disabled = false;
      }
    });
  });

  zona.querySelectorAll('[data-accion="finalizar"]').forEach((boton) => {
    boton.addEventListener("click", async () => {
      const examId = boton.dataset.exam;
      boton.disabled = true;
      try {
        await finalizarExamen(contenedorRaiz, examId, { tokens, items });
      } catch (e) {
        const estado = zona.querySelector(`[data-exam-estado="${CSS.escape(examId)}"]`);
        if (estado) estado.textContent = `Error: ${e.message}`;
        boton.disabled = false;
      }
    });
  });
}

// ============================================================
// Entrada de la pestaña
// ============================================================

export async function renderSubirLote(contenedorRaiz) {
  const { tokens } = await api.tokens();
  contenedorRaiz.innerHTML = `
    <section class="digitalizar-bloque">
      <h3>Subir páginas sueltas (fotos o PDF), en cualquier orden</h3>
      <p class="nota-formato">
        Pensado para digitalizar en dos pasos: primero escanear o fotografiar TODAS las hojas rellenadas de
        una remesa (mezcladas, sin ordenar), y luego subir aquí las imágenes o PDFs sueltos — en el orden
        que sea, y en varias visitas si hace falta. Cada página se identifica sola por su código QR (examen
        + número de página) y se va colocando en su sitio. Si un PDF ya trae todas las páginas de una hoja,
        mejor: se procesa de una vez. Cuando un examen tenga todas sus páginas, aparece abajo listo para
        "Finalizar".
      </p>
      <label class="campo">
        <span>Motor de OCR para las respuestas</span>
        <select id="select-motor-ocr-lote">
          <option value="tesseract">Tesseract (local, sin coste)</option>
          <option value="ia">IA — gpt-mini (vía Worker, API de pago, solo hojas v2)</option>
        </select>
      </label>
      <div id="opciones-motor-ia-lote" hidden>
        <label class="campo">
          <span>Modelo</span>
          <select id="select-modelo-ia-lote">
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-5-mini">gpt-5-mini</option>
            <option value="gpt-5-nano">gpt-5-nano (más barato, menos capaz)</option>
          </select>
        </label>
        <p class="nota-formato">
          Manda la imagen de la página entera (no recortes) y le pide la respuesta definitiva de cada
          pregunta, página a página conforme se van subiendo (README §4.7): aquí no hay opción de "examen
          completo" porque cada página se guarda en cuanto se lee, y las páginas de una misma hoja pueden
          llegar en visitas o dispositivos distintos. Solo se aplica a hojas v2 (letras): las páginas de una
          hoja v1 (burbujas OMR) se leen con Tesseract igualmente, sea cual sea el motor elegido aquí — v1 no
          imprime letras junto a las burbujas, así que "dame la respuesta definitiva" no tiene sentido para
          ella. El código QR sigue leyéndose igual, sin IA, en cualquier caso.
        </p>
      </div>
      <input type="file" id="campo-archivos-lote" accept="image/*,application/pdf" multiple />
      <div id="zona-intervencion-lote" class="escaneo-paso" hidden></div>
      <ul id="lista-progreso-lote" class="lista-progreso"></ul>
    </section>
    <section class="digitalizar-bloque">
      <h3>Exámenes en progreso</h3>
      <div id="zona-examenes-lote"><p>Cargando…</p></div>
    </section>`;

  const zonaIntervencion = contenedorRaiz.querySelector("#zona-intervencion-lote");
  const listaProgreso = contenedorRaiz.querySelector("#lista-progreso-lote");
  const zonaExamenes = contenedorRaiz.querySelector("#zona-examenes-lote");
  const selectMotorOcr = contenedorRaiz.querySelector("#select-motor-ocr-lote");
  const opcionesMotorIA = contenedorRaiz.querySelector("#opciones-motor-ia-lote");
  const selectModeloIA = contenedorRaiz.querySelector("#select-modelo-ia-lote");

  selectMotorOcr.addEventListener("change", () => {
    opcionesMotorIA.hidden = selectMotorOcr.value !== "ia";
  });

  async function refrescarExamenes() {
    zonaExamenes.innerHTML = "<p>Cargando…</p>";
    try {
      await renderListaExamenes(zonaExamenes, { contenedorRaiz, tokens, refrescar: refrescarExamenes });
    } catch (e) {
      zonaExamenes.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    }
  }
  await refrescarExamenes();

  contenedorRaiz.querySelector("#campo-archivos-lote").addEventListener("change", async (ev) => {
    const archivos = [...ev.target.files];
    ev.target.value = ""; // permite volver a elegir los mismos archivos si hace falta reintentar
    if (archivos.length === 0) return;

    const unidades = [];
    for (const file of archivos) {
      const esPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const item = document.createElement("li");
      item.textContent = esPdf ? `${file.name}: dividiendo PDF en páginas…` : `${file.name}: en cola…`;
      listaProgreso.prepend(item);
      try {
        if (esPdf) {
          const paginas = await cargarPaginasPdf(file);
          item.remove(); // se sustituye por una fila propia por cada página del PDF
          paginas.forEach((canvas, i) => {
            const filaPagina = document.createElement("li");
            filaPagina.textContent = `${file.name} (página ${i + 1} de ${paginas.length}): en cola…`;
            listaProgreso.prepend(filaPagina);
            unidades.push({ etiqueta: `${file.name} (página ${i + 1})`, canvas, item: filaPagina });
          });
        } else {
          const canvas = await prepararImagenFuente(file);
          unidades.push({ etiqueta: file.name, canvas, item });
        }
      } catch (e) {
        item.textContent = `${file.name}: error al leer el archivo (${e.message})`;
        item.className = "progreso-error";
      }
    }

    for (const unidad of unidades) {
      try {
        const resultado = await procesarUnidad(unidad, {
          tokens,
          zonaIntervencion,
          log: (msg) => (unidad.item.textContent = `${unidad.etiqueta}: ${msg}`),
          motorOcr: selectMotorOcr.value,
          modeloIA: selectModeloIA.value,
        });
        unidad.item.textContent = `${unidad.etiqueta}: ✓ examen ${resultado.examId}, página ${resultado.pagina}`;
        unidad.item.className = "progreso-ok";
      } catch (e) {
        unidad.item.textContent = `${unidad.etiqueta}: error — ${e.message}`;
        unidad.item.className = "progreso-error";
      }
    }
    await refrescarExamenes();
  });
}
