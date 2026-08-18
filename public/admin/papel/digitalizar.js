// Digitalización de tests en papel (README §4.7/§4.9): ya NO es una pestaña
// propia del panel (el flujo secuencial de "subir página a página" que tenía
// su propia pestaña "Digitalizar tests" se retiró, legacy frente a la subida
// en bloque — ver git log) — este módulo ahora es la librería COMPARTIDA que
// usan tanto "Subir en bloque" (subirLote.js) como "Imprimir remesa"
// (admin.js): el contexto de fuentes/manifiesto, la decodificación de lo que
// devuelve OCR-IA (worker/src/endpoints/admin/ocrIa.ts, sobre la imagen de
// página entera) y la pantalla de confirmación al crear la sesión.
import { api, escaparHtml } from "../admin.js";
import { bloqueCamposDemografia, leerDemografiaDelFormulario, renderEditarSesion } from "../editarSesion.js";
import { cargarFuentesHoja, detectarTintaCasillas, obtenerFontkit, obtenerPdfLib } from "./comun.js";
import { CATALOGOS } from "../../js/demografia.js";
import { calcularGeometriaCasillas, calcularManifiesto, crearContextoFuentes, VERSION_PIPELINE } from "./hoja.js";

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
      // geometriaCasillas: array paralelo a `manifiesto` (una entrada por
      // página) con la posición de cada casilla de ordenar/clasificar — issue
      // #35, para la detección determinista de tinta en
      // construirEntradaPaginaIA más abajo.
      const geometriaCasillas = calcularGeometriaCasillas(ctx, items);
      return {
        ctx,
        items,
        manifiesto,
        geometriaCasillas,
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

// casillasPagina (opcional): la entrada de geometriaCasillas (obtenerManifiesto)
// correspondiente a ESTA página. issue #35 (ampliado a los 5 formatos, baseline
// de blanco adaptativo en el #37, y desde la ronda del 18 de agosto de 2026 de
// ese mismo issue, clasificación en 2 zonas densidad+varianza en vez de 3 con
// banda dudosa — ver el comentario grande junto a comun.js::zonaTintaCasilla):
// antes de mandar la página a OCR-IA, se muestrea la tinta de cada casilla
// sobre el propio warpCanvas (ya enderezado) y se manda al Worker CADA
// posición ya clasificada con certeza (zona "blanco" o "tinta", nunca una
// tercera opción intermedia), en la forma que necesita cada formato:
//   - ordenar/clasificar/opcion_multiple: qué posiciones concretas están en
//     zona "blanco" (1-based) — el Worker las fuerza a cadena vacía en el
//     esquema, y fuerza una LETRA (nunca cadena vacía) en el resto de
//     posiciones del bloque, ya que con 2 zonas "no está en blanco" ==
//     "tiene tinta" con la misma certeza. Si NINGUNA posición tiene tinta, el
//     Worker fuerza el bloque entero a null (equivalente a que todas estén en
//     la lista de blancas). opcion_multiple tiene una única casilla por lado,
//     así que "en blanco" == "el bloque entero está vacío", fuerza null; si
//     no, fuerza una letra.
//   - abierto/seleccion_multiple: cuántas casillas hay entre la primera y la
//     última con tinta (incluye huecos intermedios: en abierto son los
//     espacios entre palabras; en selección múltiple, las casillas de
//     opciones no marcadas entre dos que sí lo están) — el Worker fuerza esa
//     longitud EXACTA (ya no un techo con margen de seguridad: con el
//     desalineamiento de fiduciales corregido y la varianza como señal
//     principal, la detección es fiable de sobra); 0 (ninguna casilla con
//     tinta) fuerza null.
function conDeteccionDeTinta(itemManifiesto, warpCanvas, casillasPagina) {
  const casillasItem = casillasPagina.filter((c) => c.itemId === itemManifiesto.id);
  if (casillasItem.length === 0) return itemManifiesto;
  const conTinta = detectarTintaCasillas(warpCanvas, casillasItem);

  switch (itemManifiesto.formato) {
    case "ordenar":
    case "clasificar":
    case "opcion_multiple": {
      // Se manda SIEMPRE (incluso como array vacío) cuando hay casillas para
      // este ítem, nunca condicionado a que haya alguna posición en blanco:
      // con 2 zonas, un array vacío significa "todas las posiciones tienen
      // tinta", y el Worker necesita esa señal para forzar una letra en TODAS
      // ellas (tieneDeteccionDeTinta en ocrIa.ts) — omitir el campo aquí
      // dejaría ese caso (el más común: un bloque completamente relleno) sin
      // ninguna restricción, exactamente lo contrario de lo que pide esta
      // ronda del issue #37.
      const posicionesEnBlancoRespuesta = conTinta.filter((c) => c.lado === "respuesta" && c.zona === "blanco").map((c) => c.posicion + 1);
      const posicionesEnBlancoCorreccion = conTinta.filter((c) => c.lado === "correccion" && c.zona === "blanco").map((c) => c.posicion + 1);
      return { ...itemManifiesto, posicionesEnBlancoRespuesta, posicionesEnBlancoCorreccion };
    }
    case "seleccion_multiple":
    case "abierto": {
      const longitudDetectada = (lado) => {
        const inkadas = conTinta.filter((c) => c.lado === lado && c.tieneTinta).map((c) => c.posicion);
        if (inkadas.length === 0) return 0;
        return Math.max(...inkadas) - Math.min(...inkadas) + 1;
      };
      return {
        ...itemManifiesto,
        longitudDetectadaRespuesta: longitudDetectada("respuesta"),
        longitudDetectadaCorreccion: longitudDetectada("correccion"),
      };
    }
    default:
      return itemManifiesto;
  }
}

export function construirEntradaPaginaIA(paginaManifiesto, warpCanvas, paginaId, casillasPagina = []) {
  const items =
    paginaManifiesto.tipo === "items" ? paginaManifiesto.items.map((it) => conDeteccionDeTinta(it, warpCanvas, casillasPagina)) : undefined;
  return {
    id: paginaId,
    imagen: warpCanvas.toDataURL("image/jpeg", 0.85),
    tipo: paginaManifiesto.tipo,
    ...(paginaManifiesto.tipo === "demografia" ? { campos: paginaManifiesto.campos } : { items }),
  };
}
