// Digitalización de tests en papel (README §4.7/§4.9): pestaña "Digitalizar
// tests" del panel de admin — pipeline único (v1 y v2 retirados, ver git log)
// que resuelve TODO por OCR-IA (visión de OpenAI, worker/src/endpoints/admin/
// ocrIa.ts) sobre la imagen de página entera, incluidas las casillas de
// consentimiento/compromiso (antes las únicas marcas OMR que quedaban) — ya
// no hay ningún recorte por casilla ni ningún motor local que elegir.
import { api, escaparHtml } from "../admin.js";
import { bloqueCamposDemografia, leerDemografiaDelFormulario, renderEditarSesion } from "../editarSesion.js";
import {
  cargarFuentesHoja,
  crearSelectorEsquinas,
  descargarPdf,
  destinoFiducialesEscalado,
  detectarFiduciales,
  leerQrsDePagina,
  obtenerFontkit,
  obtenerPdfLib,
  obtenerUpng,
  prepararImagenFuente,
  warpearImagen,
} from "./comun.js";
import { CATALOGOS } from "../../js/demografia.js";
import { ESCALA_DIGITALIZACION, PAGE_H, PAGE_W } from "./geometria.js";
import { decodificarPayloadQr, decodificarPayloadQrPagina, generarExamId } from "./qr.js";
import { calcularManifiesto, construirHoja, crearContextoFuentes, VERSION_PIPELINE } from "./hoja.js";

// [campo del objeto Demografia (worker/src/tipos.ts), clave en CATALOGOS
// (public/js/demografia.js)] — necesario para traducir la letra que devolvió
// OCR-IA de vuelta al valor real del catálogo.
const CAMPOS_CATALOGO = {
  sexo: "sexo",
  ccaa_educacion_secundaria: "ccaa",
  nivel_estudios: "nivel_estudios",
  area_estudios: "area_estudios",
  estudios_mayor_progenitor: "nivel_estudios",
  libros_en_casa: "libros_en_casa",
};

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ============================================================
// Contexto de fuentes + manifiesto: se cargan una sola vez por visita a la
// pestaña (mismos items para cualquier examen, README §1.4) — el manifiesto
// (hoja.js::calcularManifiesto) es aritmética pura sobre métricas de fuente,
// así que calcularlo aquí da EXACTAMENTE el mismo resultado (mismo nº de
// páginas, mismo reparto) que al generar el PDF de verdad para imprimir.
// ============================================================

let promesaContexto = null;
async function obtenerContextoFuentes() {
  if (!promesaContexto) {
    promesaContexto = (async () => {
      const [PDFLib, fontkit, fuentes] = await Promise.all([obtenerPdfLib(), obtenerFontkit(), cargarFuentesHoja()]);
      return crearContextoFuentes(PDFLib, fontkit, null, null, fuentes.regular, fuentes.bold);
    })();
  }
  try {
    return await promesaContexto;
  } catch (e) {
    promesaContexto = null;
    throw e;
  }
}

let promesaManifiesto = null;
export function obtenerManifiesto() {
  if (!promesaManifiesto) {
    promesaManifiesto = (async () => {
      const ctx = await obtenerContextoFuentes();
      const { items } = await api.itemsImpresion();
      const manifiesto = calcularManifiesto(ctx, items);
      return {
        ctx,
        items,
        manifiesto,
        itemsPorId: new Map(items.map((it) => [it.id, it])),
        numeroPorId: new Map(items.map((it, i) => [it.id, i + 1])),
      };
    })();
  }
  return promesaManifiesto;
}

// ============================================================
// Decodificación de la respuesta de OCR-IA -> respuestas listas para guardar
// ============================================================

function leerTexto(textos, clave) {
  return (textos.get(clave) ?? "").trim().toUpperCase();
}

function primeraLetra(texto, limiteExclusivo) {
  for (const ch of texto) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) return idx;
  }
  return null;
}

function letrasValidas(texto, limiteExclusivo) {
  const indices = new Set();
  for (const ch of texto) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) indices.add(idx);
  }
  return [...indices].sort((a, b) => a - b);
}

// Traduce el texto ya devuelto por OCR-IA (una clave `item:<id>:<sufijo>` por
// campo/casilla, README §4.9 — el propio Worker ya resolvió la precedencia
// Respuesta/Corrección, ocrIa.ts::volcarRespuestaItem) a la forma que espera
// el backend por formato (README §4.2).
export function decodificarRespuestas(items, textos) {
  const respuestas = {};
  for (const item of items) {
    switch (item.formato) {
      case "abierto": {
        const texto = leerTexto(textos, `item:${item.id}:abierto`);
        if (texto) respuestas[item.id] = texto;
        break;
      }
      case "opcion_multiple": {
        const idx = primeraLetra(leerTexto(textos, `item:${item.id}:opcion`), item.opciones.length);
        if (idx != null) respuestas[item.id] = idx;
        break;
      }
      case "seleccion_multiple": {
        const indices = letrasValidas(leerTexto(textos, `item:${item.id}:seleccion`), item.opciones.length);
        if (indices.length > 0) respuestas[item.id] = indices;
        break;
      }
      case "ordenar": {
        const n = item.elementos.length;
        const arr = new Array(n).fill(null);
        let alguna = false;
        for (let pos = 0; pos < n; pos++) {
          const idx = primeraLetra(leerTexto(textos, `item:${item.id}:orden:${pos}`), n);
          if (idx != null) {
            arr[pos] = item.elementos[idx];
            alguna = true;
          }
        }
        if (alguna) respuestas[item.id] = arr;
        break;
      }
      case "clasificar": {
        const asign = {};
        let alguna = false;
        item.elementos.forEach((elemento, i) => {
          const idx = primeraLetra(leerTexto(textos, `item:${item.id}:clasificar:${i}`), item.categorias.length);
          if (idx != null) {
            asign[elemento] = item.categorias[idx];
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
// Confirmación mínima antes de crear la sesión, y traspaso a la edición
// compartida (README §4.8): tras leer todas las páginas, la única pantalla
// propia de este flujo pide confirmar lo imprescindible (remesa,
// consentimiento, compromiso, demografía) — las 25 respuestas se revisan
// justo después, ya guardadas, en la misma pantalla de edición que el resto
// de sesiones del panel.
// ============================================================

// Exportada: la subida en bloque (../subirLote.js) reutiliza esta misma
// pantalla al finalizar un examen completo.
export function renderConfirmacionYCrear(
  zona,
  { tokenIdDetectado, examIdDetectado, tokens, items, textosGlobal, paginasWarpeadas, alRecargar }
) {
  // 4 claves independientes (demografia:anio_nacimiento:0..3, ocrIa.ts): el
  // Worker ya reparte el año de 4 dígitos que devuelve el modelo en una clave
  // por dígito, mismo formato que el resto de casillas individuales.
  const anioLeido = [0, 1, 2, 3]
    .map((i) => leerTexto(textosGlobal, `demografia:anio_nacimiento:${i}`).replace(/\D/g, ""))
    .join("");
  const demografiaSeed = { anio_nacimiento: anioLeido };
  for (const [campo, claveCatalogo] of Object.entries(CAMPOS_CATALOGO)) {
    const catalogo = CATALOGOS[claveCatalogo];
    const idx = primeraLetra(leerTexto(textosGlobal, `demografia:${campo}`), catalogo.length);
    demografiaSeed[campo] = idx != null ? catalogo[idx] : null;
  }

  const miniaturas = paginasWarpeadas
    .map((canvasODataUrl, i) => {
      const src = typeof canvasODataUrl === "string" ? canvasODataUrl : canvasODataUrl.toDataURL("image/jpeg", 0.7);
      return `
      <details class="revision-miniatura">
        <summary>Ver foto enderezada — página ${i + 1}</summary>
        <img src="${src}" alt="Página ${i + 1} enderezada" />
      </details>`;
    })
    .join("");

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
      Esto es solo lo imprescindible para poder crear la sesión (remesa y demografía). Las casillas de
      consentimiento y compromiso se imprimen en la hoja como recordatorio para quien la rellena, pero no
      se piden aquí: una sesión digitalizada siempre se da por consentida. Las 25 respuestas se revisan
      justo después, ya guardadas, en la misma pantalla de edición que el resto de sesiones del panel —
      así se corrige al momento sin perder lo digitalizado.
    </p>
    ${miniaturas}
    ${bloqueToken}
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
      const demografia = leerDemografiaDelFormulario(zona);
      const respuestas = decodificarRespuestas(items, textosGlobal);
      const resultado = await api.digitalizar({
        token_id: tokenId,
        version_papel: VERSION_PIPELINE,
        examen_id: examIdDetectado ?? null,
        // Las casillas de la hoja son un recordatorio para quien la rellena
        // (README §4.7), no una condición que se compruebe al digitalizar —
        // una sesión ya rellenada en papel y presentada para digitalizar
        // siempre se considera consentida.
        consentimiento: true,
        compromiso_honestidad: true,
        demografia,
        respuestas,
      });
      await renderEditarSesion(zona, resultado.sesion_id, { onVolver: () => alRecargar() });
    } catch (e) {
      estado.textContent = `Error: ${e.message}`;
      boton.disabled = false;
    }
  });
}

// ============================================================
// Construcción de la entrada de OCR-IA para una página ya enderezada — id +
// formato de cada ítem (o campos de demografía) impreso en ESA página; el
// enunciado/opciones/elementos los lee el modelo directamente de la imagen.
// Las casillas de consentimiento/compromiso se imprimen igual pero nunca
// entran aquí (hoja.js::construirBloquesDemografia no las incluye en
// camposDemografia): la digitalización siempre las da por buenas, ver
// worker/src/endpoints/admin/digitalizacion.ts.
// ============================================================

export function construirEntradaPaginaIA(paginaManifiesto, warpCanvas, paginaId) {
  return {
    id: paginaId,
    imagen: warpCanvas.toDataURL("image/jpeg", 0.85),
    tipo: paginaManifiesto.tipo,
    ...(paginaManifiesto.tipo === "demografia" ? { campos: paginaManifiesto.campos } : { items: paginaManifiesto.items }),
  };
}

// ============================================================
// Orquestación del escaneo página a página
// ============================================================

function iniciarEscaneo(zona, { tokenIdInicial, tokens, items, manifiesto, modeloIA, agrupacionIA }) {
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  let tokenIdDetectado = tokenIdInicial || null;
  let examIdDetectado = null;
  let indice = 0;
  const pendientesIA = []; // solo con agrupacionIA === "examen"

  async function renderPasoActual() {
    if (indice >= manifiesto.length) {
      if (agrupacionIA === "examen" && pendientesIA.length > 0) {
        zona.innerHTML = `<p>Leyendo todas las páginas con IA (examen completo)…</p>`;
        try {
          const { resultados } = await api.ocrIa({ modelo: modeloIA, paginas: pendientesIA });
          for (const pag of pendientesIA) {
            for (const [clave, texto] of Object.entries(resultados[pag.id] ?? {})) textosGlobal.set(clave, texto);
          }
          pendientesIA.length = 0;
        } catch (e) {
          zona.innerHTML = `<p class="mensaje-error">Error leyendo con IA: ${escaparHtml(e.message)}</p>`;
          return;
        }
      }
      renderConfirmacionYCrear(zona, {
        tokenIdDetectado,
        examIdDetectado,
        tokens,
        items,
        textosGlobal,
        paginasWarpeadas,
        alRecargar: () => (zona.innerHTML = ""),
      });
      return;
    }
    const paginaManifiesto = manifiesto[indice];
    zona.innerHTML = `
      <div class="escaneo-paso">
        <h3>${paginaManifiesto.tipo === "demografia" ? "Página de datos" : "Página de ítems"} (${indice + 1} de ${manifiesto.length})</h3>
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

    zona.querySelector("#boton-saltar-pagina").addEventListener("click", async () => {
      indice++;
      await renderPasoActual();
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
        const dst = destinoFiducialesEscalado();
        const esquinasFuente = esquinas.obtenerEsquinas();
        const warp = warpearImagen(fuente, esquinasFuente, destW, destH, dst);
        paginasWarpeadas.push(warp);

        const { qrGrandeTexto, qrPaginaTexto } = await leerQrsDePagina(fuente, esquinasFuente, dst, {
          esPrimeraPagina: indice === 0,
          avisar: (msg) => (estado.textContent = msg),
        });
        if (qrGrandeTexto) {
          const qrGrande = decodificarPayloadQr(qrGrandeTexto);
          if (tokens.some((t) => t.id === qrGrande.tokenId)) tokenIdDetectado = qrGrande.tokenId;
          if (qrGrande.examId) examIdDetectado = qrGrande.examId;
        }
        if (qrPaginaTexto) {
          const qrPagina = decodificarPayloadQrPagina(qrPaginaTexto);
          if (qrPagina?.examId) examIdDetectado = qrPagina.examId;
        }

        estado.textContent = "Leyendo la página con IA…";
        const entradaIA = construirEntradaPaginaIA(paginaManifiesto, warp, `pagina-${indice}`);
        if (agrupacionIA === "examen") {
          pendientesIA.push(entradaIA);
        } else {
          const { resultados } = await api.ocrIa({ modelo: modeloIA, paginas: [entradaIA] });
          for (const [clave, texto] of Object.entries(resultados[entradaIA.id] ?? {})) textosGlobal.set(clave, texto);
        }

        indice++;
        await renderPasoActual();
      } catch (e) {
        estado.textContent = `Error leyendo la página: ${e.message}`;
        boton.disabled = false;
      }
    });
  }

  renderPasoActual();
}

// ============================================================
// Entrada de la pestaña
// ============================================================

export async function renderDigitalizar(contenedor) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <section class="digitalizar-bloque">
      <h3>1. Imprimir hoja de respuestas</h3>
      <p class="nota-formato">
        Genera el PDF de la hoja de respuestas con los 25 ítems del banco actual y un código QR de la
        remesa elegida — así al digitalizarla más tarde no hace falta recordar de qué remesa era cada
        foto. El PDF se genera siempre igual (mismo contenido, mismo maquetado), sin pasar por el diálogo
        de impresión del navegador.
      </p>
      <label class="campo">
        <span>Remesa para el QR de esta hoja</span>
        <select id="select-token-imprimir">
          <option value="">Selecciona un token…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-generar-hoja" disabled>Generar PDF</button>
      <p id="estado-hoja" class="nota-formato"></p>
    </section>
    <section class="digitalizar-bloque">
      <h3>2. Digitalizar una hoja rellenada</h3>
      <p class="nota-formato">
        Sube fotos de las páginas de una hoja ya rellenada; se interpretan en tu propio navegador salvo la
        lectura de cada página, que pasa por el Worker (API de OpenAI, README §4.7). La remesa se detecta
        sola por el QR de la página de datos — el token de aquí abajo es solo un respaldo por si esa foto
        no se pudo leer.
      </p>
      <label class="campo">
        <span>Token de la remesa (opcional: se detecta por QR)</span>
        <select id="select-token-digitalizar">
          <option value="">Se detectará por QR…</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <label class="campo">
        <span>Modelo de OCR-IA</span>
        <select id="select-modelo-ia">
          <option value="gpt-5-mini" selected>gpt-5-mini</option>
          <option value="gpt-5-nano">gpt-5-nano (más barato, menos capaz)</option>
        </select>
      </label>
      <label class="campo">
        <span>Agrupación de las llamadas a la API</span>
        <select id="select-agrupacion-ia">
          <option value="pagina">Una llamada por página</option>
          <option value="examen">Una sola llamada con la hoja completa</option>
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
    estado.textContent = "Generando PDF…";
    try {
      const examId = generarExamId();
      const [ctx, upng] = await Promise.all([obtenerContextoFuentes(), obtenerUpng()]);
      ctx.UPNG = upng;
      const { items } = await api.itemsImpresion();
      const { pdfBytes, manifiesto } = await construirHoja(ctx, items, { tokenId, examId });
      descargarPdf(pdfBytes, `hoja-${examId}.pdf`);
      estado.textContent = `PDF generado: ${manifiesto.length} páginas. ID de examen: ${examId}`;
    } catch (e) {
      estado.textContent = `Error: ${e.message}`;
    } finally {
      boton.disabled = false;
    }
  });

  const selectToken = contenedor.querySelector("#select-token-digitalizar");
  const selectModeloIA = contenedor.querySelector("#select-modelo-ia");
  const selectAgrupacionIA = contenedor.querySelector("#select-agrupacion-ia");
  const botonEmpezar = contenedor.querySelector("#boton-empezar-escaneo");

  botonEmpezar.addEventListener("click", async () => {
    botonEmpezar.disabled = true;
    const zona = contenedor.querySelector("#zona-escaneo");
    zona.innerHTML = "<p>Cargando el banco de ítems…</p>";
    try {
      const { items, manifiesto } = await obtenerManifiesto();
      iniciarEscaneo(zona, {
        tokenIdInicial: selectToken.value || null,
        tokens,
        items,
        manifiesto,
        modeloIA: selectModeloIA.value,
        agrupacionIA: selectAgrupacionIA.value,
      });
    } catch (e) {
      zona.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    } finally {
      botonEmpezar.disabled = false;
    }
  });
}
