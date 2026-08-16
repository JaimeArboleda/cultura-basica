// Digitalización de tests en papel en bloque (README §4.10): pestaña
// "Digitalizar tests" del panel de admin (antes "Subir en bloque" — el flujo
// secuencial que subía las páginas de UNA hoja, en orden, en una sola visita,
// se retiró por legacy frente a este, ver git log). Aquí se suben fotos,
// PDFs, o un .zip con cualquier mezcla de ambos, de páginas de CUALQUIER
// hoja, en cualquier orden y en cuantas visitas hagan falta: cada página se
// identifica sola por el QR pequeño que lleva en todas las páginas
// (qr.js::codificarPayloadQrPagina — exam_id + número de página) y el
// resultado ya decodificado se guarda en el Worker
// (worker/src/endpoints/admin/examenesPapel.ts) hasta que un examen tiene
// todas sus páginas y se puede "Finalizar" — momento en el que se reutiliza
// la MISMA pantalla de confirmación que usaba el flujo secuencial retirado
// (renderConfirmacionYCrear, ./digitalizar.js) para no mantener dos
// formularios de creación de sesión por separado.
//
// Con un único pipeline (v1/v2 retirados, ver git log) ya no hace falta
// despachar dinámicamente "qué versión es esta hoja" — solo qué remesa
// (token_id), para poder resolverla y crear la sesión.
import { api, escaparHtml } from "../admin.js";
import {
  cargarPaginasPdf,
  crearSelectorEsquinas,
  destinoFiducialesEscalado,
  detectarFiduciales,
  ESCALA_DIGITALIZACION,
  leerQrsDePagina,
  leerZip,
  prepararImagenFuente,
  warpearImagen,
} from "./comun.js";
import { PAGE_H, PAGE_W } from "./geometria.js";
import { decodificarPayloadQr, decodificarPayloadQrPagina } from "./qr.js";
import { construirEntradaPaginaIA, obtenerManifiesto, renderConfirmacionYCrear } from "./digitalizar.js";
import { VERSION_PIPELINE } from "./hoja.js";

// exam_id + versión de cada hoja ya resuelto en esta visita (por QR, por el
// servidor o a mano) — evita volver a preguntar por cada página de la misma
// hoja física. version se guarda solo por compatibilidad histórica con hojas
// v1/v2 ya repartidas antes de este cambio (README §4.9): si una foto trae
// una version antigua en el QR grande, se sigue asociando igual a la remesa,
// pero el layout que se usa para leerla es siempre el actual.
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
// Resolución manual (respaldos cuando algo no se puede leer solo)
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

function pedirTokenManualmente(contenedor, { examId, tokens, motivoFallback }) {
  return new Promise((resolve) => {
    contenedor.innerHTML = `
      <p class="nota-formato">
        Examen <code>${escaparHtml(examId)}</code> nuevo para el servidor: dime a mano a qué remesa
        pertenece — se recuerda para el resto de páginas de este mismo examen, no hace falta repetirlo.
      </p>
      ${motivoFallback ? `<p class="nota-formato">(Motivo: ${escaparHtml(motivoFallback)})</p>` : ""}
      <label class="campo">
        <span>Remesa</span>
        <select id="select-token-manual-lote" required>
          <option value="">Selecciona un token…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-confirmar-token-lote">Continuar</button>
      <p id="estado-token-manual-lote" class="mensaje-error"></p>`;
    contenedor.querySelector("#boton-confirmar-token-lote").addEventListener("click", () => {
      const tokenId = contenedor.querySelector("#select-token-manual-lote").value;
      if (!tokenId) {
        contenedor.querySelector("#estado-token-manual-lote").textContent = "Falta elegir la remesa.";
        return;
      }
      resolve({ tokenId });
    });
  });
}

// ============================================================
// Procesamiento de una página suelta (foto o página de un PDF ya dividido):
// esquinas -> homografía -> QR de página -> resolver examen -> leer con
// OCR-IA -> subir al servidor. Cada paso que no se puede resolver solo cae en
// una de las funciones de arriba, que pausan aquí hasta que el admin lo
// resuelve a mano.
// ============================================================

async function procesarUnidad(unidad, { tokens, zonaIntervencion, log, manifiesto }) {
  log("Detectando esquinas…");
  const detectados = detectarFiduciales(unidad.canvas);
  let esquinas = detectados;
  if (!esquinas) {
    zonaIntervencion.hidden = false;
    log("Esquinas no detectadas: ajústalas arriba ↑ para continuar…");
    esquinas = await pedirEsquinasManualmente(zonaIntervencion, unidad.canvas);
    zonaIntervencion.hidden = true;
  }

  const destW = Math.round(PAGE_W * ESCALA_DIGITALIZACION);
  const destH = Math.round(PAGE_H * ESCALA_DIGITALIZACION);
  const dst = destinoFiducialesEscalado();
  const warp = warpearImagen(unidad.canvas, esquinas, destW, destH, dst);

  log("Leyendo QR de página…");
  const { qrGrandeTexto, qrPaginaTexto } = await leerQrsDePagina(unidad.canvas, esquinas, dst, {
    esPrimeraPagina: true, // no se sabe todavía si es la 1: se intenta leer siempre, es barato y determinista
    avisar: log,
  });
  let identificacion = qrPaginaTexto ? decodificarPayloadQrPagina(qrPaginaTexto) : null;
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
      info = { tokenId: detalle.token_id };
      examenesConocidos.set(examId, info);
    } catch (e) {
      if (e.status && e.status !== 404) throw e;
    }
  }
  // Primera página de un exam_id que el servidor todavía no conoce (README
  // §4.9): antes de pedirlo a mano, se aprovecha el QR grande si esta foto
  // era la página 1 y se pudo leer (remesa completa, sin recortar de nuevo).
  let motivoFallback = null;
  if (!info && pagina === 1 && qrGrandeTexto) {
    const datosGrande = decodificarPayloadQr(qrGrandeTexto);
    if (tokens.some((t) => t.id === datosGrande.tokenId)) {
      info = { tokenId: datosGrande.tokenId };
      examenesConocidos.set(examId, info);
    } else {
      motivoFallback = `El QR grande se leyó (token_id="${datosGrande.tokenId}") pero no coincide con ningún token activo.`;
    }
  } else if (!info) {
    motivoFallback =
      pagina === 1
        ? "El QR grande de la remesa no se pudo decodificar en esta foto."
        : `Esta foto es la página ${pagina}, no la 1 — el QR grande de la remesa solo está impreso en la página 1.`;
  }
  if (!info) {
    zonaIntervencion.hidden = false;
    log("Hoja nueva: elige arriba ↑ a qué remesa pertenece…");
    info = await pedirTokenManualmente(zonaIntervencion, { examId, tokens, motivoFallback });
    examenesConocidos.set(examId, info);
    zonaIntervencion.hidden = true;
  }

  const paginaManifiesto = manifiesto[pagina - 1];
  if (!paginaManifiesto) {
    throw new Error(
      `La página ${pagina} no existe en la hoja actual (¿ha cambiado el banco de ítems desde que se imprimió esta hoja?)`
    );
  }

  log(`Leyendo contenido con IA (examen ${examId}, página ${pagina})…`);
  const entradaIA = construirEntradaPaginaIA(paginaManifiesto, warp, `${examId}-${pagina}`);
  // Sin `modelo`: el Worker usa siempre su modelo por defecto (gpt-5-mini,
  // wrangler.toml OPENAI_MODEL) — el panel ya no ofrece elegir otro (issue
  // #31): la comparativa contra la API real mostró que es la mejor relación
  // precisión/coste con diferencia, así que dar a elegir solo invitaba a un
  // resultado peor sin ningún beneficio real.
  const { resultados } = await api.ocrIa({ paginas: [entradaIA] });
  const textos = resultados[entradaIA.id] ?? {};

  log("Guardando…");
  await api.examenPapelSubirPagina({
    exam_id: examId,
    token_id: info.tokenId,
    version: VERSION_PIPELINE, // worker/src/db.ts lo guarda tal cual (README §4.9)
    pagina,
    marcas: { textos },
    miniatura: generarMiniatura(warp),
  });

  return { examId, pagina };
}

// ============================================================
// Finalizar un examen completo: reutiliza tal cual la pantalla de
// confirmación del flujo secuencial (README §4.8, "revisión instantánea"),
// solo que textosGlobal/las miniaturas vienen de las páginas ya subidas y
// persistidas, no de escanear en la propia visita.
// ============================================================

async function finalizarExamen(contenedorRaiz, examId, { tokens, items }) {
  const detalle = await api.examenPapelDetalle(examId);
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  for (const p of [...detalle.paginas].sort((a, b) => a.pagina - b.pagina)) {
    const marcas = JSON.parse(p.marcas_json);
    for (const [clave, valor] of Object.entries(marcas.textos ?? {})) textosGlobal.set(clave, valor);
    if (p.miniatura_datauri) paginasWarpeadas.push(p.miniatura_datauri);
  }
  contenedorRaiz.innerHTML = "";
  renderConfirmacionYCrear(contenedorRaiz, {
    tokenIdDetectado: detalle.token_id,
    examIdDetectado: examId,
    tokens,
    items,
    textosGlobal,
    paginasWarpeadas,
    alRecargar: () => renderSubirLote(contenedorRaiz),
  });
}

// ============================================================
// Listado "exámenes en progreso"
// ============================================================

async function renderListaExamenes(zona, { contenedorRaiz, tokens, items, totalPaginas, refrescar }) {
  const { examenes } = await api.examenesPapel();
  if (examenes.length === 0) {
    zona.innerHTML = "<p class='nota-formato'>Todavía no se ha subido ninguna página.</p>";
    return;
  }

  zona.innerHTML = examenes
    .map((ex) => {
      const subidas = new Set(ex.paginas_subidas);
      const completo = totalPaginas > 0 && subidas.size === totalPaginas;
      const token = tokens.find((t) => t.id === ex.token_id);
      const chips = Array.from({ length: totalPaginas }, (_, i) => i + 1)
        .map((n) => `<span class="chip-pagina ${subidas.has(n) ? "chip-pagina-ok" : "chip-pagina-falta"}">${n}</span>`)
        .join("");
      const resumen = ex.sesion_id
        ? `ya digitalizado (${ex.paginas_subidas.length}/${totalPaginas} páginas)`
        : `${ex.paginas_subidas.length}/${totalPaginas} páginas`;
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
          <summary><code>${escaparHtml(ex.exam_id)}</code> — ${escaparHtml(token?.descripcion ?? ex.token_id)} — ${resumen}</summary>
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
// Clasificación de un archivo subido (foto, PDF, o .zip con cualquier mezcla
// de ambos, README §4.10) en "unidades" (una por página, {etiqueta, canvas,
// item}) — recursiva, así un .zip dentro de un .zip (raro, pero no cuesta
// nada admitirlo) se abre igual. Entradas del zip que no son ni imagen ni PDF
// (metadatos de macOS, .DS_Store...) se descartan en silencio.
// ============================================================

const EXTENSION_IMAGEN = /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff?)$/i;
const EXTENSION_PDF = /\.pdf$/i;
const EXTENSION_ZIP = /\.zip$/i;

function esZip(file) {
  return file.type === "application/zip" || file.type === "application/x-zip-compressed" || EXTENSION_ZIP.test(file.name);
}
function esPdf(file) {
  return file.type === "application/pdf" || EXTENSION_PDF.test(file.name);
}
function esImagen(file) {
  return file.type.startsWith("image/") || EXTENSION_IMAGEN.test(file.name);
}

async function agregarUnidadesDeArchivo(file, etiqueta, unidades, listaProgreso) {
  if (esZip(file)) {
    const item = document.createElement("li");
    item.textContent = `${etiqueta}: abriendo .zip…`;
    listaProgreso.prepend(item);
    try {
      const entradas = await leerZip(file);
      item.remove();
      for (const { nombre, blob } of entradas) {
        const nombreBase = nombre.split("/").pop() ?? nombre;
        // Metadatos de macOS al comprimir con Finder (carpeta __MACOSX/,
        // ficheros "._nombre.ext" con la MISMA extensión que el archivo real
        // que acompañan — el filtro por extensión de más abajo no los
        // descarta solo, hace falta este aparte) — no son ni imagen ni PDF,
        // aunque lo parezcan por el nombre.
        if (nombre.startsWith("__MACOSX/") || nombreBase.startsWith("._")) continue;
        if (!esPdf({ type: blob.type, name: nombre }) && !esImagen({ type: blob.type, name: nombre }) && !esZip({ type: blob.type, name: nombre })) {
          continue; // ni imagen, ni PDF, ni zip anidado: metadatos/basura del propio zip, se ignora
        }
        await agregarUnidadesDeArchivo(new File([blob], nombre), `${etiqueta} > ${nombre}`, unidades, listaProgreso);
      }
    } catch (e) {
      item.textContent = `${etiqueta}: error al leer el .zip (${e.message})`;
      item.className = "progreso-error";
    }
    return;
  }

  if (esPdf(file)) {
    const item = document.createElement("li");
    item.textContent = `${etiqueta}: dividiendo PDF en páginas…`;
    listaProgreso.prepend(item);
    try {
      const paginas = await cargarPaginasPdf(file);
      item.remove();
      paginas.forEach((canvas, i) => {
        const filaPagina = document.createElement("li");
        filaPagina.textContent = `${etiqueta} (página ${i + 1} de ${paginas.length}): en cola…`;
        listaProgreso.prepend(filaPagina);
        unidades.push({ etiqueta: `${etiqueta} (página ${i + 1})`, canvas, item: filaPagina });
      });
    } catch (e) {
      item.textContent = `${etiqueta}: error al leer el archivo (${e.message})`;
      item.className = "progreso-error";
    }
    return;
  }

  const item = document.createElement("li");
  item.textContent = `${etiqueta}: en cola…`;
  listaProgreso.prepend(item);
  try {
    const canvas = await prepararImagenFuente(file);
    unidades.push({ etiqueta, canvas, item });
  } catch (e) {
    item.textContent = `${etiqueta}: error al leer el archivo (${e.message})`;
    item.className = "progreso-error";
  }
}

// ============================================================
// Entrada de la pestaña
// ============================================================

export async function renderSubirLote(contenedorRaiz) {
  const { tokens } = await api.tokens();
  contenedorRaiz.innerHTML = `
    <section class="digitalizar-bloque">
      <h3>Subir páginas sueltas (fotos, PDF o un .zip con varios), en cualquier orden</h3>
      <p class="nota-formato">
        Pensado para digitalizar en dos pasos: primero escanear o fotografiar TODAS las hojas rellenadas de
        una remesa (mezcladas, sin ordenar), y luego subir aquí las imágenes o PDFs — sueltos, en un único
        .zip con cualquier mezcla de ambos, o combinando varias subidas — en el orden que sea, y en varias
        visitas si hace falta. Cada página se identifica sola por su código QR (examen + número de página) y
        se va colocando en su sitio. Si un PDF ya trae todas las páginas de una hoja, mejor: se procesa de
        una vez. Cuando un examen tenga todas sus páginas, aparece abajo listo para "Finalizar".
      </p>
      <input type="file" id="campo-archivos-lote" accept="image/*,application/pdf,application/zip,.zip" multiple />
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

  const { items, manifiesto } = await obtenerManifiesto();

  async function refrescarExamenes() {
    zonaExamenes.innerHTML = "<p>Cargando…</p>";
    try {
      await renderListaExamenes(zonaExamenes, {
        contenedorRaiz,
        tokens,
        items,
        totalPaginas: manifiesto.length,
        refrescar: refrescarExamenes,
      });
    } catch (e) {
      zonaExamenes.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    }
  }
  await refrescarExamenes();

  contenedorRaiz.querySelector("#campo-archivos-lote").addEventListener("change", async (ev) => {
    const archivos = [...ev.target.files];
    ev.target.value = "";
    if (archivos.length === 0) return;

    const unidades = [];
    for (const file of archivos) {
      await agregarUnidadesDeArchivo(file, file.name, unidades, listaProgreso);
    }

    for (const unidad of unidades) {
      try {
        const resultado = await procesarUnidad(unidad, {
          tokens,
          zonaIntervencion,
          log: (msg) => (unidad.item.textContent = `${unidad.etiqueta}: ${msg}`),
          manifiesto,
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
