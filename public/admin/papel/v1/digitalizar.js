// Digitalización de tests en papel v1 (README §4.7/§4.9): pestaña
// "Digitalizar tests" del panel de admin. Dos flujos:
//   1. Imprimir la hoja OMR (./hoja.js construye el DOM; aquí solo se abre
//      una ventana de impresión — "Guardar como PDF" desde el diálogo del
//      propio navegador da la versión en PDF, sin añadir ninguna librería).
//   2. Subir fotos de una hoja ya rellenada, ajustar las 4 esquinas de cada
//      página (corrección de perspectiva casera, sin OpenCV — ver
//      ../comun.js), muestrear la oscuridad de cada burbuja/casilla (OMR,
//      específico de v1) y pasar los recuadros de texto libre por
//      Tesseract.js (OCR, ../comun.js). Todo corre en el navegador del
//      admin: nada de esto usa una API de pago.
//
// Lo que es específico de v1 y vive en este archivo: el umbral y la
// interpretación de marcas OMR (oscuridad de burbuja -> índice/conjunto/
// orden/clasificación) y la orquestación de la pantalla. Todo lo que no
// depende de cómo se marca una respuesta (homografía, OCR, QR, detección de
// fiduciales...) vive en ../comun.js, compartido con futuras versiones.
import { api, escaparHtml } from "../../admin.js";
import { bloqueCamposDemografia, leerDemografiaDelFormulario, renderEditarSesion } from "../../editarSesion.js";
import {
  abrirVentanaImpresion,
  detectarFiduciales,
  ESCALA_DIGITALIZACION,
  generarExamId,
  leerPagina,
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
// varias versiones (README §4.9). Exportada: la subida en bloque
// (../subirLote.js) necesita saber qué VERSION_PIPELINE corresponde a cada
// módulo para poder despachar al correcto una vez leído el QR.
export const VERSION_PIPELINE = 1;

// Whitelist de OCR por clave (README §4.9): en v1 el OCR solo se usa para
// 'abierto' y el año de nacimiento (todo lo demás es OMR de burbujas) — ver
// comun.js::leerPagina, que recibe esto para decidir cómo leer cada línea.
// Exportada para que la subida en bloque pueda reutilizar exactamente el
// mismo criterio sin duplicarlo.
export function opcionesOcrParaClave(clave) {
  // año de nacimiento: 4 claves independientes demografia:anio_nacimiento:0..3
  // (./hoja.js::construirBloquesDemografia), no una sola clave — de ahí
  // :\d+ al final en vez de endsWith(":anio_nacimiento").
  return /:anio_nacimiento:\d+$/.test(clave) ? { soloDigitos: true } : {};
}

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
export const UMBRAL_MARCA = 0.22;

// ============================================================
// Decodificación OMR/OCR -> respuestas listas para guardar (específico de
// v1; calcularOscuridad en sí es genérico y vive en ../comun.js)
// ============================================================

function ganadorDeGrupo(oscuridad, prefijo, umbral = UMBRAL_MARCA) {
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

function marcadasEnGrupo(oscuridad, prefijo, umbral = UMBRAL_MARCA) {
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
// Confirmación mínima antes de crear la sesión, y traspaso a la edición
// compartida (README §4.8) — "revisión instantánea": en vez de revisar aquí
// las 25 respuestas ítem a ítem, se confirma solo lo imprescindible para que
// el backend acepte crear la sesión (consentimiento, compromiso, demografía
// completa) y, en cuanto existe, se abre directamente la misma pantalla de
// edición que usa la pestaña Sesiones para cualquier otra sesión — así la
// revisión fina ocurre sobre datos ya guardados, sin un formulario aparte que
// mantener sincronizado con el de edición.
// ============================================================

// Exportada: la subida en bloque (../subirLote.js) reutiliza esta MISMA
// pantalla al finalizar un examen completo, para no mantener dos pantallas
// de confirmación por separado (README §4.10) — la única diferencia es de
// dónde vienen oscuridadGlobal/textosGlobal/paginasWarpeadas (aquí, de
// escanear en la propia visita; allí, de las páginas ya subidas y
// persistidas en el servidor) y que allí también se pasa examIdDetectado
// para poder mandarlo a api.digitalizar y así marcar esa hoja como
// digitalizada (examenes_papel.sesion_id).
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
    .map((i) => (textosGlobal.get(`demografia:anio_nacimiento:${i}`) ?? "").replace(/\D/g, ""))
    .join("");
  const demografiaSeed = {
    anio_nacimiento: anioLeido,
    sexo: ganadorDeGrupo(oscuridadGlobal, "demografia:sexo:"),
    ccaa_educacion_secundaria: ganadorDeGrupo(oscuridadGlobal, "demografia:ccaa_educacion_secundaria:"),
    nivel_estudios: ganadorDeGrupo(oscuridadGlobal, "demografia:nivel_estudios:"),
    area_estudios: ganadorDeGrupo(oscuridadGlobal, "demografia:area_estudios:"),
    estudios_mayor_progenitor: ganadorDeGrupo(oscuridadGlobal, "demografia:estudios_mayor_progenitor:"),
    libros_en_casa: ganadorDeGrupo(oscuridadGlobal, "demografia:libros_en_casa:"),
  };

  // paginasWarpeadas: canvas (flujo secuencial, foto recién enderezada) o ya
  // un data URL string (subida en bloque, README §4.10 — la miniatura viene
  // de examenes_papel_paginas.miniatura_datauri, no hay canvas en memoria).
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

function iniciarEscaneo(zona, { tokenIdInicial, tokens, items, paginas }) {
  const oscuridadGlobal = new Map();
  const textosGlobal = new Map();
  const paginasWarpeadas = [];
  // Token detectado por QR en alguna de las páginas escaneadas (README §4.9);
  // empieza con el que se haya seleccionado a mano ANTES de escanear (si
  // había uno), pero un QR leído con éxito lo sustituye — es más fiable que
  // una preselección hecha sin haber visto aún la hoja física.
  let tokenIdDetectado = tokenIdInicial || null;
  // exam_id detectado por el QR pequeño de página (README §4.10), presente
  // en todas las páginas — a diferencia del token, que solo se lee del QR
  // grande de la página 1. Se manda al crear la sesión para trazabilidad y
  // para que el backend pueda rechazar digitalizar dos veces la misma hoja.
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
    estado.textContent = "Generando hoja…";
    try {
      const examId = generarExamId();
      const { items, paginacion } = await api.itemsImpresion();
      const paginas = await construirHoja(items, { tokenId, examId, version: VERSION_PIPELINE }, paginacion?.[VERSION_PIPELINE]);
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
      const { items, paginacion } = await api.itemsImpresion();
      const paginas = await construirHoja(items, undefined, paginacion?.[VERSION_PIPELINE]);
      iniciarEscaneo(zona, { tokenIdInicial: selectToken.value || null, tokens, items, paginas });
    } catch (e) {
      zona.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
    } finally {
      botonEmpezar.disabled = false;
    }
  });
}
