// Digitalización de tests en papel v2 (README §4.7/§4.9): pestaña
// "Digitalizar tests" del panel de admin, pipeline alternativo a v1
// (../v1/digitalizar.js) que resuelve todo por OCR de letras/números en vez
// de burbujas OMR (ver ./hoja.js para el porqué). Comparte con v1 toda la
// mecánica de bajo nivel de ../comun.js (impresión, homografía, OCR, QR,
// fiduciales, selector de esquinas) — lo único específico de aquí es cómo se
// interpreta el texto ya reconocido en cada casilla y la orquestación de la
// pantalla, que sigue el mismo patrón que v1 (imprimir / escanear página a
// página / confirmar y crear sesión con revisión instantánea en
// editarSesion.js, README §4.8).
import { api, escaparHtml } from "../../admin.js";
import { bloqueCamposDemografia, leerDemografiaDelFormulario, renderEditarSesion } from "../../editarSesion.js";
import { CATALOGOS } from "../../../js/demografia.js";
import {
  abrirVentanaImpresion,
  detectarFiduciales,
  ESCALA_DIGITALIZACION,
  generarExamId,
  leerPagina,
  LETRAS,
  PAGE_H,
  PAGE_W,
  prepararImagenFuente,
  crearSelectorEsquinas,
  warpearImagen,
} from "../comun.js";
import { construirHoja, CSS_HOJA } from "./hoja.js";

// Versión de este pipeline: viaja en el QR de la hoja y se envía al backend
// (worker/src/endpoints/admin/digitalizacion.ts) al crear la sesión, para
// poder comparar en el dataset qué pipeline funciona mejor si conviven
// varias versiones (README §4.9). Exportada por el mismo motivo que en v1:
// ../subirLote.js necesita el mapa versión -> módulo.
export const VERSION_PIPELINE = 2;

// Umbral de oscuridad (0=blanco, 1=negro) para las 2 únicas marcas OMR que
// quedan en v2: consentimiento y compromiso de honestidad (ver ./hoja.js).
// Mismo valor que v1 porque es el mismo tipo de marca (casilla cuadrada
// simple); si las pruebas reales muestran que conviene un umbral distinto
// para v2, es independiente del de v1 a propósito.
export const UMBRAL_MARCA = 0.22;

// [campo del objeto Demografia (worker/src/tipos.ts), clave en CATALOGOS
// (public/js/demografia.js)] — mismo mapeo que ./hoja.js, necesario aquí
// para traducir la letra leída de vuelta al valor del catálogo.
const CAMPOS_CATALOGO = {
  sexo: "sexo",
  ccaa_educacion_secundaria: "ccaa",
  nivel_estudios: "nivel_estudios",
  area_estudios: "area_estudios",
  estudios_mayor_progenitor: "nivel_estudios",
  libros_en_casa: "libros_en_casa",
};

// ============================================================
// Decodificación de texto OCR -> respuestas listas para guardar
// ============================================================

function leerTexto(textos, clave) {
  return (textos.get(clave) ?? "").trim().toUpperCase();
}

// Precedencia Respuesta/Corrección por CASILLA, no por bloque entero (a
// diferencia de v1, README §4.9): como cada casilla es su propia región de
// texto, "en blanco" es simplemente "no se reconoció ningún carácter" — no
// hace falta una marca explícita de "no responder" para poder anular. Si la
// Corrección tiene algo, gana; si no, se usa la Respuesta.
function leerConCorreccion(textos, claveRespuesta, claveCorreccion) {
  return leerTexto(textos, claveCorreccion) || leerTexto(textos, claveRespuesta);
}

// Primera letra de LETRAS que aparece en el texto reconocido (ignora
// cualquier otro carácter que el OCR haya colado) — null si no hay ninguna.
function primeraLetra(texto, limiteExclusivo) {
  for (const ch of texto) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) return idx;
  }
  return null;
}

// Todas las letras de LETRAS distintas que aparecen en el texto (para
// selección múltiple: el orden/posición no importa, es un conjunto).
function letrasValidas(texto, limiteExclusivo) {
  const indices = new Set();
  for (const ch of texto) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) indices.add(idx);
  }
  return [...indices].sort((a, b) => a - b);
}

// Traduce el texto ya reconocido en cada casilla a la forma que espera el
// backend por formato (README §4.2): abierto=string, opcion_multiple=índice,
// seleccion_multiple=[índices], ordenar=[nombres en orden], clasificar={elemento:categoría}.
// Un ítem sin nada reconocido (en ninguna casilla) simplemente no aparece en
// el resultado, igual que en v1 y que dejarlo en blanco en la web.
export function decodificarRespuestas(items, textos) {
  const respuestas = {};
  for (const item of items) {
    const prefCorreccion = `item:${item.id}:correccion`;
    switch (item.formato) {
      case "abierto": {
        const texto = leerConCorreccion(textos, `item:${item.id}:abierto`, `${prefCorreccion}:abierto`);
        if (texto) respuestas[item.id] = texto;
        break;
      }
      case "opcion_multiple": {
        const texto = leerConCorreccion(textos, `item:${item.id}:opcion`, `${prefCorreccion}:opcion`);
        const idx = primeraLetra(texto, item.opciones.length);
        if (idx != null) respuestas[item.id] = idx;
        break;
      }
      case "seleccion_multiple": {
        const texto = leerConCorreccion(textos, `item:${item.id}:seleccion`, `${prefCorreccion}:seleccion`);
        const indices = letrasValidas(texto, item.opciones.length);
        if (indices.length > 0) respuestas[item.id] = indices;
        break;
      }
      case "ordenar": {
        // Cabecera fija = posición (1, 2, 3...); en la casilla de cada
        // posición se escribe la letra del elemento que va ahí (ver
        // ./hoja.js) — el reverso de 'clasificar' (cabecera fija =
        // instancia, casilla = letra de categoría), mismo mecanismo.
        const n = item.elementos.length;
        const arr = new Array(n).fill(null);
        let alguna = false;
        for (let pos = 0; pos < n; pos++) {
          const texto = leerConCorreccion(textos, `item:${item.id}:orden:${pos}`, `${prefCorreccion}:orden:${pos}`);
          const idx = primeraLetra(texto, n);
          // Si la misma letra se lee en dos posiciones (error de OCR o del
          // propio participante), el elemento se repite en el array y falla
          // la comparación de permutación en worker/src/correccion.ts (no es
          // una validación explícita, es la consecuencia natural de no ser
          // igual a la respuesta correcta) — no hay desambiguación. Pendiente
          // de revisar con datos reales, mismo espíritu que UMBRAL_MARCA en
          // v1: mejor un criterio simple documentado que una regla de
          // desambiguación inventada sin casos reales delante.
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
          const texto = leerConCorreccion(textos, `item:${item.id}:clasificar:${i}`, `${prefCorreccion}:clasificar:${i}`);
          const idx = primeraLetra(texto, item.categorias.length);
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
// compartida (README §4.8) — mismo patrón "revisión instantánea" que v1: ver
// ../v1/digitalizar.js para la justificación completa.
// ============================================================

// Exportada: la subida en bloque (../subirLote.js) reutiliza esta misma
// pantalla al finalizar un examen completo — ver la nota equivalente en
// ../v1/digitalizar.js.
export function renderConfirmacionYCrear(
  zona,
  { tokenIdDetectado, examIdDetectado, tokens, items, oscuridadGlobal, textosGlobal, paginasWarpeadas, alRecargar }
) {
  const consentimientoSeed = (oscuridadGlobal.get("demografia:consentimiento") ?? 0) >= UMBRAL_MARCA;
  const honestidadSeed = (oscuridadGlobal.get("demografia:compromiso_honestidad") ?? 0) >= UMBRAL_MARCA;
  // 4 claves independientes (demografia:anio_nacimiento:0..3, ./hoja.js), no
  // una sola línea de 4 caracteres: un dígito no reconocido deja solo ESE
  // hueco en vez de arriesgarse a que Tesseract lea mal el bloque entero.
  const anioLeido = [0, 1, 2, 3]
    .map((i) => leerTexto(textosGlobal, `demografia:anio_nacimiento:${i}`).replace(/\D/g, ""))
    .join("");
  const demografiaSeed = { anio_nacimiento: anioLeido };
  for (const [campo, claveCatalogo] of Object.entries(CAMPOS_CATALOGO)) {
    const catalogo = CATALOGOS[claveCatalogo];
    const idx = primeraLetra(leerTexto(textosGlobal, `demografia:${campo}`), catalogo.length);
    demografiaSeed[campo] = idx != null ? catalogo[idx] : null;
  }

  // paginasWarpeadas: canvas (flujo secuencial) o ya un data URL string
  // (subida en bloque, README §4.10) — ver la nota equivalente en
  // ../v1/digitalizar.js.
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

  // Remesa (README §4.9): igual que v1 — se detecta sola por el QR si se
  // pudo leer y coincide con un token real; si no, hace falta elegirla aquí.
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
      const respuestas = decodificarRespuestas(items, textosGlobal);
      const resultado = await api.digitalizar({
        token_id: tokenId,
        version_papel: VERSION_PIPELINE,
        examen_id: examIdDetectado ?? null,
        consentimiento,
        compromiso_honestidad,
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
// Orquestación del escaneo página a página
// ============================================================

// Qué lista blanca/modo de OCR usar según la clave de la región (README
// §4.9): dígitos solo para el año de nacimiento, alfanumérico por defecto
// para 'abierto' (texto libre, puede llevar números), y letras para todo lo
// demás — que en v2 es casi todo, incluido el orden de 'ordenar' (la casilla
// de cada posición lleva la letra del elemento, no un número, ver ./hoja.js).
export function opcionesOcrParaClave(clave) {
  // año de nacimiento: 4 claves independientes demografia:anio_nacimiento:0..3
  // (./hoja.js::construirBloquesDemografia), no una sola clave — de ahí
  // :\d+ al final en vez de endsWith(":anio_nacimiento").
  if (/:anio_nacimiento:\d+$/.test(clave)) return { soloDigitos: true };
  if (clave.endsWith(":abierto")) return {};
  return { soloLetras: true };
}

function iniciarEscaneo(zona, { tokenIdInicial, tokens, items, paginas }) {
  const oscuridadGlobal = new Map();
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  // Token detectado por QR en alguna de las páginas escaneadas (README §4.9);
  // empieza con el que se haya seleccionado a mano ANTES de escanear (si
  // había uno), pero un QR leído con éxito lo sustituye — es más fiable que
  // una preselección hecha sin haber visto aún la hoja física.
  let tokenIdDetectado = tokenIdInicial || null;
  // exam_id detectado por el QR pequeño de página (README §4.10) — ver la
  // nota equivalente en ../v1/digitalizar.js.
  let examIdDetectado = null;
  let indice = 0;

  function renderPasoActual() {
    if (indice >= paginas.length) {
      renderConfirmacionYCrear(zona, {
        tokenIdDetectado,
        examIdDetectado,
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
        const esquinasFuente = esquinas.obtenerEsquinas();
        const warp = warpearImagen(fuente, esquinasFuente, destW, destH, dst);
        paginasWarpeadas.push(warp);

        const { oscuridad, textos, qrGrande, qrPagina } = await leerPagina(pagina, warp, {
          opcionesOcrParaClave,
          avisar: (msg) => (estado.textContent = msg),
          canvasFuente: fuente,
          esquinas: esquinasFuente,
          dstFiduciales: dst,
        });
        // Solo consentimiento/compromiso siguen siendo marcas OMR en v2 (ver
        // cabecera de ./hoja.js) — pagina.marcas está vacío en páginas de
        // ítems y tiene como mucho esas 2 entradas en la página de datos.
        for (const [clave, valor] of Object.entries(oscuridad)) oscuridadGlobal.set(clave, valor);
        for (const [clave, valor] of Object.entries(textos)) textosGlobal.set(clave, valor);
        if (qrGrande) {
          if (tokens.some((t) => t.id === qrGrande.tokenId)) tokenIdDetectado = qrGrande.tokenId;
          if (qrGrande.examId) examIdDetectado = qrGrande.examId;
        }
        if (qrPagina?.examId) examIdDetectado = qrPagina.examId;

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
// Entrada de la pestaña
// ============================================================

export async function renderDigitalizar(contenedor) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <section class="digitalizar-bloque">
      <h3>1. Imprimir hoja de respuestas (v2, OCR de letras)</h3>
      <p class="nota-formato">
        Genera la hoja de respuestas (v2: todo se rellena escribiendo letras/números en casillas, en vez de
        sombrear burbujas) con los 25 ítems del banco actual, con un código QR de la remesa elegida — así al
        digitalizarla más tarde no hace falta recordar de qué remesa era cada foto. Se abre lista para
        imprimir; desde el diálogo de impresión del navegador, "Guardar como PDF" da la versión en PDF sin
        coste añadido.
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
      <h3>2. Digitalizar una hoja rellenada (v2)</h3>
      <p class="nota-formato">
        Sube fotos de las páginas de una hoja v2 ya rellenada; se interpretan en tu propio navegador
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
    estado.textContent = "Generando hoja…";
    try {
      const examId = generarExamId();
      const { items } = await api.itemsImpresion();
      const paginas = await construirHoja(items, { tokenId, examId, version: VERSION_PIPELINE });
      abrirVentanaImpresion(paginas, CSS_HOJA);
      estado.textContent = `Hoja generada: ${paginas.length} páginas. ID de examen: ${examId}`;
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
      const paginas = await construirHoja(items);
      iniciarEscaneo(zona, { tokenIdInicial: selectToken.value || null, tokens, items, paginas });
    } catch (e) {
      zona.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    } finally {
      botonEmpezar.disabled = false;
    }
  });
}
