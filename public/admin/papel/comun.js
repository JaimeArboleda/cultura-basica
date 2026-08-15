// Helpers compartidos por TODAS las versiones del pipeline de hoja en papel
// (README §4.7/§4.9): geometría de página, medida/paginado del DOM, homografía,
// OCR, QR y detección de fiduciales. Nada aquí sabe qué formato de marca usa
// cada versión (burbujas OMR en v1, casillas de letra en v2...) — eso vive en
// cada carpeta de versión (./v1/hoja.js, ./v1/digitalizar.js, ...), que
// importa de aquí lo que necesite.
//
// La corrección de respuestas en el worker (worker/src/correccion.ts) ya es
// agnóstica de cómo se capturó cada respuesta (opera sobre la forma
// normalizada: número, array o objeto), así que versionar el pipeline no
// duplica nada en el backend — solo esta capa de captura cambia entre
// versiones. Lo único que sí cruza al servidor es la propia versión
// (ver codificarPayloadQr/decodificarPayloadQr más abajo y
// worker/src/endpoints/admin/digitalizacion.ts), para poder comparar en el
// dataset qué pipeline funciona mejor.

// A4 a 96dpi "CSS px" (constante del propio spec de CSS: 1mm = 96/25.4px,
// siempre, independiente de la resolución real de la impresora/escáner —
// tanto al imprimir como al medir el DOM de referencia se parte de esta
// misma escala).
export const PX_POR_MM = 96 / 25.4;
// Hueco deliberadamente amplio entre los fiduciales (3-8mm del borde, ver
// CSS_HOJA_BASE más abajo) y el contenido (empieza en este padding): la
// detección automática de fiduciales (detectarFiduciales) busca en un
// cuadrante generoso cerca de cada esquina para tolerar fotos mal encuadradas,
// y un hueco estrecho hace que confunda el fiducial con el propio contenido.
export const PAGINA_PADDING_MM = 18; // ver ".hoja-pagina { padding: 18mm }"
export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;
export const PAGE_W = Math.round(PAGE_W_MM * PX_POR_MM); // ≈ 794
export const PAGE_H = Math.round(PAGE_H_MM * PX_POR_MM); // ≈ 1123

// Escala del canvas de referencia usado al digitalizar: cuanto mayor, más
// resolución para el muestreo de marcas y el recorte que se le pasa a
// Tesseract, a costa de más cómputo por warp. 3x da ~2382x3369px, de sobra
// para distinguir una marca rellena de una vacía y para OCR de letras de
// imprenta grandes.
export const ESCALA_DIGITALIZACION = 3;

// Color de acento único, sobrio y con buen contraste en fotocopia B/N (queda
// como un gris medio si se imprime sin color) — solo para cabeceras y
// separadores, nunca para el contenido que hay que leer/rellenar.
export const COLOR_ACENTO = "#2b4c7e";

export const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Nº de líneas y de casillas por línea por defecto para un bloque de texto
// (bloqueCasillasTexto): 1 línea de 20 casillas basta para respuestas breves
// tipo alias de un ítem 'abierto' (p. ej. "sigmund freud"); dos líneas
// resultaban excesivas para ese caso de uso.
export const LINEAS_TEXTO = 1;
export const CASILLAS_POR_LINEA = 20;

// --- CSS base: página, cabecera, contenedor de ítem, fiduciales, QR y
// casillas de texto — común a cualquier versión. Cada versión añade su propio
// CSS para cómo se marcan las respuestas (burbujas, casillas de letra...).
export const CSS_HOJA_BASE = `
  .hoja-pagina {
    width: ${PAGE_W_MM}mm;
    height: ${PAGE_H_MM}mm;
    box-sizing: border-box;
    padding: ${PAGINA_PADDING_MM}mm;
    font-family: "Helvetica Neue", Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #111;
    background: #fff;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }
  .hoja-cabecera {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 0.6mm solid ${COLOR_ACENTO};
    padding-bottom: 2.5mm;
    margin-bottom: 5mm;
  }
  .hoja-cabecera strong {
    font-size: 14px;
    letter-spacing: 0.2px;
    color: ${COLOR_ACENTO};
  }
  .hoja-cabecera span { font-size: 9px; color: #666; }

  .hoja-item { margin-bottom: 5mm; }
  .hoja-item-enunciado {
    font-weight: 700;
    margin-bottom: 2mm;
    display: flex;
    gap: 1.5mm;
  }
  .hoja-item-numero {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-width: 5.5mm;
    height: 5.5mm;
    border-radius: 50%;
    background: ${COLOR_ACENTO};
    color: #fff;
    font-size: 9px;
  }
  .hoja-item-texto {
    font-style: italic;
    font-size: 10px;
    color: #333;
    margin: 0 0 2.5mm;
    padding: 1.5mm 2.5mm;
    border-left: 0.5mm solid #ccc;
    white-space: pre-wrap;
  }

  .hoja-instruccion {
    font-size: 9px;
    color: ${COLOR_ACENTO};
    font-weight: 600;
    margin-bottom: 1.5mm;
  }

  .hoja-bloque-texto-titulo { font-size: 8.5px; color: #555; margin: 1mm 0 0.8mm; }
  .hoja-bloque-casillas-texto { width: fit-content; }
  .hoja-fila-casillas-individuales { display: flex; gap: 0.9mm; }
  .hoja-fila-casillas-individuales .hoja-linea-casillas { margin-bottom: 0; }
  .hoja-linea-casillas { display: flex; gap: 0.9mm; margin-bottom: 0.8mm; }
  .hoja-casilla-texto {
    width: 5.6mm; height: 6.6mm; border: 0.35mm solid #111; flex: none; background: #fff;
  }

  /* Casilla cuadrada simple con etiqueta (consentimiento/compromiso, README
     §2): la única marca OMR que sobrevive en cualquier versión, porque es un
     gesto binario (sí/no) sin ambigüedad de "cuál de varias opciones", no un
     "formato de pregunta" que necesite letras. */
  .hoja-fila-opcion { display: flex; align-items: center; gap: 2mm; margin: 0.7mm 0; }
  .hoja-marca-cuadrado {
    width: 3.6mm; height: 3.6mm; border: 0.4mm solid #111; flex: none; background: #fff;
  }

  /* Lista de opciones/categorías/elementos con su letra o número de
     referencia (README §4.9): una línea por entrada cuando el texto puede
     ser largo (opciones, elementos), o compacta en una sola línea cuando es
     corto (categorías de 'clasificar'). */
  .hoja-lista-etiquetada div { margin: 0.4mm 0; }
  .hoja-leyenda-categorias { font-size: 8px; color: #444; margin-bottom: 1.5mm; }

  /* Bloque de corrección (README §4.9): separado visualmente del de
     respuesta, más pequeño y compacto — nunca es la vía principal, solo se
     usa si hay que corregir. Cada versión añade su propio CSS para el
     contenido interno (burbujas, casillas...). */
  .hoja-correccion {
    margin-top: 2mm;
    padding-top: 1.5mm;
    border-top: 0.3mm dashed #aaa;
  }
  .hoja-correccion-titulo {
    font-size: 8px;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 1mm;
  }
  .hoja-correccion-blanco {
    font-size: 8.5px;
    font-style: italic;
    margin-top: 1mm;
    break-inside: avoid;
  }

  /* Marcas fiduciales: cuadrados sólidos cerca de cada esquina, fuera del
     área de contenido (dentro del padding de la página). Sirven de
     referencia geométrica para enderezar la foto (detectarFiduciales). */
  .hoja-fiducial { position: absolute; width: 5mm; height: 5mm; background: #111; }
  .hoja-fiducial-tl { top: 3mm; left: 3mm; }
  .hoja-fiducial-tr { top: 3mm; right: 3mm; }
  .hoja-fiducial-br { bottom: 3mm; right: 3mm; }
  .hoja-fiducial-bl { bottom: 3mm; left: 3mm; }

  /* Código QR con el token de la remesa + versión del pipeline (README §4.9):
     así una hoja fotocopiada y repartida por un colaborador se puede
     digitalizar sin que el admin tenga que recordar a mano de qué remesa (ni
     de qué versión de hoja) era cada foto. Solo en la primera página. */
  .hoja-qr { display: flex; align-items: flex-start; gap: 3mm; }
  .hoja-qr-caja { width: 22mm; height: 22mm; flex: none; }
  .hoja-qr-img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  .hoja-qr-texto { font-size: 7px; font-family: ui-monospace, monospace; color: #555; word-break: break-all; margin-top: 1mm; }

  /* Código QR pequeño de PÁGINA (README §4.10, exam_id + número de página),
     en TODAS las páginas: a diferencia de .hoja-qr de arriba (grande, solo en
     la página 1, con el detalle completo remesa+versión), este es un sello
     compacto que solo lleva {exam_id, página} — pensado para la subida en
     bloque, donde una foto suelta de cualquier página tiene que poder
     identificarse a qué hoja física pertenece y en qué posición va. Posición
     ABSOLUTA (no participa en el paginado voraz, igual que los fiduciales:
     por eso no desplaza ningún bloque de contenido) y deliberadamente FUERA
     de los cuadrantes de búsqueda de fiduciales (8% del ancho/alto desde cada
     esquina, comun.js::detectarFiduciales) — centrado en el borde derecho —
     para no confundir la detección automática de esquinas con un blob oscuro
     extra cerca de una de ellas. */
  .hoja-qr-pagina {
    position: absolute; top: 50%; right: 4mm; width: 10mm; height: 10mm; margin-top: -5mm;
  }
  .hoja-qr-pagina-img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
`;

export function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

export function escaparHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

// Bloque de N líneas de casillas de texto (README §4.9): todas las líneas se
// miden como UNA sola región rectangular (data-linea en el contenedor
// exterior), así el pipeline de digitalización recorta el bloque entero de
// una vez y lo pasa a Tesseract como un bloque de texto, no línea a línea.
// casillasPorLinea=1 da una única casilla, medida y leída de forma
// completamente independiente de cualquier otra — el bloque con el que
// versiones basadas en OCR de letras (v2 en adelante) construyen cada
// casilla de respuesta individual (una opción, un elemento, una instancia...).
export function bloqueCasillasTexto(clave, casillasPorLinea = CASILLAS_POR_LINEA, lineas = LINEAS_TEXTO) {
  const filas = Array.from({ length: lineas }, () => {
    const casillas = Array.from({ length: casillasPorLinea }, () => `<span class="hoja-casilla-texto"></span>`).join("");
    return `<div class="hoja-linea-casillas">${casillas}</div>`;
  }).join("");
  // width: fit-content en el contenedor exterior (el que mide medirMarcas):
  // sin esto es un <div> de bloque normal, que ocupa el ancho completo de la
  // página aunque casillasPorLinea sea 1 — el recorte que ve Tesseract salía
  // >90% blanco de sobra a la derecha de la(s) casilla(s) real(es), lo que
  // empeora la lectura del bloque entero de OCR (medido comparando contra
  // ocr_tests: recortar solo el contenido, sin ese sobrante, corrige lecturas
  // que salían vacías o con una letra equivocada). No afecta a la posición
  // impresa de las casillas (siguen ancladas a la izquierda dentro de un
  // flex sin justify-content), solo a qué región mide/recorta el pipeline.
  return el(`<div data-linea="${clave}" class="hoja-bloque-casillas-texto">${filas}</div>`);
}

// Fila de N casillas de texto INDEPENDIENTES (una clave, y por tanto una
// región medida/leída, por casilla) que se pintan juntas como una sola tira
// visual — a diferencia de bloqueCasillasTexto(clave, n, 1) a secas, que mide
// las N casillas como UN solo bloque (correcto cuando la posición dentro de
// la línea no importa, como en selección múltiple; incorrecto cuando cada
// casilla pertenece a una posición/dígito concreto y tiene que poder leerse
// aunque las demás queden en blanco — 'ordenar'/'clasificar' en v2/hoja.js,
// y el año de nacimiento en v1 y v2, ver construirBloquesDemografia de cada
// versión). Compartida aquí (en vez de solo en v2/hoja.js, donde nació) para
// que v1 la use también en el año de nacimiento sin duplicar la CSS.
export function filaCasillasIndividuales(claves) {
  const contenedor = el(`<div class="hoja-fila-casillas-individuales"></div>`);
  for (const clave of claves) contenedor.appendChild(bloqueCasillasTexto(clave, 1, 1));
  return contenedor;
}

// Casilla cuadrada simple con etiqueta, para un gesto binario tipo
// consentimiento/compromiso (README §2) — la única marca OMR que se
// mantiene en cualquier versión del pipeline, ver CSS_HOJA_BASE.
export function marcaCuadrado(clave, etiquetaHtml) {
  return el(`
    <label class="hoja-fila-opcion">
      <span class="hoja-marca-cuadrado" data-mark="${clave}"></span>
      <span>${etiquetaHtml}</span>
    </label>`);
}

// Bloque "Respuesta" + "Corrección" de un ítem 'abierto' (README §1.6/§4.9):
// idéntico en cualquier versión del pipeline (la doble línea de casillas
// tiene sentido para texto libre, a diferencia del resto de formatos, README
// §4.9) — vive aquí para no duplicarlo entre v1 y versiones posteriores.
export function agregarBloqueAbierto(bloque, claveRespuesta, claveCorreccion) {
  bloque.appendChild(el(`<div class="hoja-instruccion">Escribe en MAYÚSCULAS, una letra por casilla.</div>`));
  bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
  bloque.appendChild(bloqueCasillasTexto(claveRespuesta));
  bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`));
  bloque.appendChild(bloqueCasillasTexto(claveCorreccion));
}

// data-linea="meta:qr:pagina" en TODAS las páginas (README §4.10): se rellena
// después de paginar, cuando ya se conoce el número global de página de cada
// una (rellenarQrPaginas más abajo) — aquí solo se reserva el hueco, igual
// que el resto de líneas/marcas que se miden con el layout ya puesto.
function crearPagina(tituloDerecha) {
  return el(`
    <div class="hoja-pagina">
      <span class="hoja-fiducial hoja-fiducial-tl" data-fiducial="tl"></span>
      <span class="hoja-fiducial hoja-fiducial-tr" data-fiducial="tr"></span>
      <span class="hoja-fiducial hoja-fiducial-br" data-fiducial="br"></span>
      <span class="hoja-fiducial hoja-fiducial-bl" data-fiducial="bl"></span>
      <div class="hoja-qr-pagina" data-linea="meta:qr:pagina">
        <img class="hoja-qr-pagina-img" alt="" />
      </div>
      <div class="hoja-cabecera">
        <strong>Test de Cultura General — hoja de respuestas</strong>
        <span>${escaparHtml(tituloDerecha)}</span>
      </div>
    </div>`);
}

// Bloque del QR GRANDE (README §4.9): SIEMPRE el primer bloque de la página
// de demografía, en cualquier versión (v1/hoja.js y v2/hoja.js lo anteponen
// igual a construirBloquesDemografia) — de ahí que viva aquí, compartido, en
// vez de duplicado en cada versión. Crucial que estén SIEMPRE presentes,
// tanto al imprimir (con `qr.tokenId` real) como al reconstruir el layout
// solo para medir/digitalizar (llamando a construirHoja(items) sin `qr`,
// ../v{1,2}/digitalizar.js y ../subirLote.js): la hoja física impresa
// siempre lleva este bloque (el token es obligatorio para imprimir), así que
// si el layout de lectura lo omitiera, todo el contenido de debajo (casillas
// de consentimiento, año de nacimiento, catálogos...) quedaría desplazado
// respecto a la foto real y la lectura de esa página saldría mal — no es
// solo que no se pueda leer el QR, es que se desalinea la página entera.
// Por eso qr es opcional aquí: sin él se deja la caja vacía (measurement-only).
export function construirBloqueQrGrande(qr) {
  return el(`
    <div class="hoja-item hoja-qr">
      <div class="hoja-qr-caja" data-linea="meta:qr">
        <img alt="Código QR de la remesa" class="hoja-qr-img" />
      </div>
      <div>
        <div class="hoja-item-enunciado"><span>Código de la remesa</span></div>
        <div class="hoja-qr-texto">${escaparHtml(qr?.tokenId ?? "")}</div>
      </div>
    </div>`);
}

// Contenedor invisible pero con layout real (no display:none, que da
// getBoundingClientRect a cero): fuera de la pantalla en vez de oculto, para
// poder medir alturas y luego coordenadas de marcas con las mismas reglas
// exactas que se usan al imprimir.
//
// Lleva la clase "hoja-pagina" a propósito: así hereda exactamente el mismo
// ancho de CONTENIDO (210mm de página menos los 2×18mm de padding = 174mm,
// no los 210mm enteros) y la misma tipografía (font-family/tamaño/
// line-height) que tendrá cada bloque cuando de verdad esté dentro de una
// página — si se midiera en un contenedor más ancho y con la fuente por
// defecto del navegador, el texto envolvería en menos líneas de las que
// ocupa en la página real, subestimando la altura y desbordando
// silenciosamente el "overflow: hidden" de .hoja-pagina (recortado sin
// avisar). Se sobrescribe el alto fijo y el overflow:hidden propios de
// .hoja-pagina (aquí no interesa un A4 exacto, sino poder medir bloques de
// cualquier alto sin cortarlos).
function crearContenedorMedida() {
  const cont = document.createElement("div");
  cont.className = "hoja-pagina";
  cont.style.position = "fixed";
  cont.style.left = "-10000px";
  cont.style.top = "0";
  cont.style.height = "auto";
  cont.style.overflow = "visible";
  document.body.appendChild(cont);
  return cont;
}

// Alto que un nodo realmente OCUPA en el flujo (border-box + su propio
// margen vertical): getBoundingClientRect().height NUNCA incluye el margen
// (es parte del modelo de caja de CSS, no de la caja del propio elemento),
// así que sumar solo .height para decidir cuántos bloques caben en una
// página subestima sistemáticamente el espacio real — con
// ".hoja-item{margin-bottom:5mm}" y varios ítems por página el error se
// acumula rápido y acaba desbordando el "overflow:hidden" de .hoja-pagina
// (contenido recortado en silencio). Se usa tanto para medir cada bloque
// como la propia cabecera de la página.
function alturaConMargenes(nodo) {
  const cs = getComputedStyle(nodo);
  return nodo.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
}

// Altura disponible dentro de una página para bloques de contenido: alto
// total de página menos el padding vertical (arriba+abajo), menos la
// cabecera (con su propio margen), menos un margen de seguridad para no
// pegar el último bloque al borde inferior.
function alturaDisponiblePorPagina(medida) {
  const sonda = crearPagina("x");
  medida.appendChild(sonda);
  const altoCabecera = alturaConMargenes(sonda.querySelector(".hoja-cabecera"));
  sonda.remove();
  const paddingVerticalPx = 2 * PAGINA_PADDING_MM * PX_POR_MM;
  const MARGEN_SEGURIDAD_PX = 20;
  return Math.max(PAGE_H - paddingVerticalPx - altoCabecera - MARGEN_SEGURIDAD_PX, 200);
}

// Lee, para un elemento de página ya insertado en el DOM (con layout real),
// las coordenadas de cada marca/línea/fiducial relativas a la esquina
// superior izquierda de la propia página, en la escala PAGE_W x PAGE_H.
// Genérico: no le importa qué representa cada data-mark (burbuja, casilla de
// letra...), solo dónde cae.
export function medirMarcas(paginaEl) {
  const rectPagina = paginaEl.getBoundingClientRect();
  const marcas = [];
  paginaEl.querySelectorAll("[data-mark]").forEach((nodo) => {
    const r = nodo.getBoundingClientRect();
    marcas.push({
      clave: nodo.dataset.mark,
      cx: r.left + r.width / 2 - rectPagina.left,
      cy: r.top + r.height / 2 - rectPagina.top,
      radio: Math.max(r.width, r.height) / 2,
    });
  });
  const lineas = [];
  paginaEl.querySelectorAll("[data-linea]").forEach((nodo) => {
    const r = nodo.getBoundingClientRect();
    lineas.push({
      clave: nodo.dataset.linea,
      x: r.left - rectPagina.left,
      y: r.top - rectPagina.top,
      w: r.width,
      h: r.height,
    });
  });
  const fiduciales = {};
  paginaEl.querySelectorAll("[data-fiducial]").forEach((nodo) => {
    const r = nodo.getBoundingClientRect();
    fiduciales[nodo.dataset.fiducial] = {
      cx: r.left + r.width / 2 - rectPagina.left,
      cy: r.top + r.height / 2 - rectPagina.top,
    };
  });
  return { marcas, lineas, fiduciales };
}

// Empaquetado voraz por altura: mide cada nodo ya construido (ancho fijo =
// ancho de página, alto libre) y va llenando páginas sin partir nunca un
// bloque por la mitad — vale igual para bloques de ítem (con data-item-id)
// que para bloques de demografía (sin él). Si un único bloque no cupiera en
// una página vacía, se le deja su propia página y se desborda en vez de
// intentar partirlo. formatearTitulo(numeroPagina, totalPaginas) decide el
// texto de la cabecera de cada página resultante.
function paginarBloques(medida, nodos, formatearTitulo) {
  const altoDisponible = alturaDisponiblePorPagina(medida);
  const medidos = nodos.map((nodo) => {
    medida.appendChild(nodo);
    const alto = alturaConMargenes(nodo);
    nodo.remove();
    return { nodo, alto };
  });

  const grupos = [];
  let actual = [];
  let altoActual = 0;
  for (const m of medidos) {
    if (actual.length > 0 && altoActual + m.alto > altoDisponible) {
      grupos.push(actual);
      actual = [];
      altoActual = 0;
    }
    actual.push(m);
    altoActual += m.alto;
  }
  if (actual.length > 0) grupos.push(actual);

  return grupos.map((grupo, i) => {
    const pagina = crearPagina(formatearTitulo(i + 1, grupos.length));
    for (const { nodo } of grupo) pagina.appendChild(nodo);
    medida.appendChild(pagina);
    const medidaPagina = medirMarcas(pagina);
    pagina.remove();
    const itemIds = grupo.map(({ nodo }) => nodo.dataset.itemId).filter(Boolean);
    return { elemento: pagina, itemIds, ...medidaPagina };
  });
}

// Construye la hoja completa a partir de los bloques ya armados por la
// versión concreta (bloques de demografía + bloques de ítem): páginas de
// demografía seguidas de páginas de ítems, en ese orden, cada una ya medida
// (marcas/líneas/fiduciales en coordenadas de página). Cada versión define
// cómo es cada bloque (construirBloqueItem, construirBloquesDemografia); esto
// solo paginan y miden, con las mismas reglas para cualquier versión.
//
// css: el CSS_HOJA completo de la versión que llama (CSS_HOJA_BASE + el
// suyo propio). Se inyecta aquí, en un <style> temporal, ANTES de medir nada
// — el único otro sitio donde se usa CSS_HOJA es dentro de la ventana de
// impresión que abre abrirVentanaImpresion(), que no existe todavía en este
// punto. Sin este <style>, .hoja-pagina/.hoja-item/etc. no tienen NINGÚN
// estilo asociado en el documento del panel de admin (donde corre esta
// función) y la medición se haría con las reglas por defecto del navegador
// — ni el padding de 18mm, ni la tipografía de 11px, ni los márgenes reales
// — completamente desconectados de cómo se ve la página impresa. Se retira
// al terminar para no dejar reglas de la hoja flotando en el resto del panel.
export function construirPaginas(bloquesDemografia, bloquesItems, css) {
  const estiloTemporal = document.createElement("style");
  estiloTemporal.textContent = css;
  document.head.appendChild(estiloTemporal);
  const medida = crearContenedorMedida();
  try {
    const paginasDemografia = paginarBloques(medida, bloquesDemografia, (n, total) =>
      total > 1 ? `Página de datos ${n}/${total}` : "Página de datos"
    );
    const paginasItems = paginarBloques(medida, bloquesItems, (n, total) => `Página ${n} de ${total}`);
    return [...paginasDemografia, ...paginasItems];
  } finally {
    medida.remove();
    estiloTemporal.remove();
  }
}

// ============================================================
// Impresión
// ============================================================

// css: el CSS_HOJA completo de la versión (CSS_HOJA_BASE + el suyo propio).
export function abrirVentanaImpresion(paginas, css) {
  const cuerpo = paginas.map((p) => p.elemento.outerHTML).join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Hoja de respuestas — Cultura Básica</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; }
  ${css}
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
// Homografía (corrección de perspectiva sin librerías de visión)
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
// correspondencias de puntos planos.
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
// correspondiente y se muestrea por interpolación bilineal por defecto
// (warping inverso: evita los huecos que dejaría proyectar hacia delante).
// `dst` son las coordenadas destino de esas 4 esquinas (por defecto, las del
// propio rectángulo destW x destH); al digitalizar se pasan las posiciones
// canónicas de los 4 fiduciales en vez de los bordes exactos del rectángulo,
// porque los puntos de referencia (fuente Y destino) son los fiduciales, no
// el borde físico del papel.
//
// opciones.nearest: usa vecino más próximo en vez de bilineal — bilineal
// promedia 4 píxeles fuente en cada uno de destino, lo que difumina un poco
// cualquier borde (aceptable, incluso deseable, para la oscuridad de una
// burbuja OMR o para el OCR de una letra, ambos de varios mm). Un código QR
// no lo tolera igual de bien: sus módulos son mucho más pequeños y
// numerosos, y ese difuminado basta para que jsQR deje de encontrar los
// patrones de localización — más cuanto más denso el QR (el grande, con el
// UUID del token_id, es bastante más denso que el pequeño de página, README
// §4.9) — así que decodificarQr recorta el QR con nearest en vez de tomar el
// recorte del warp bilineal de toda la página (ver recortarRegionNitida).
// opciones.offsetX/offsetY: si se pasan, cada píxel de destino (x,y) se
// interpreta como (x+offsetX, y+offsetY) en el espacio canónico ANTES de
// aplicar la homografía inversa — permite generar solo una VENTANA pequeña
// del resultado (p. ej. solo la caja del QR) sin tener que materializar la
// página entera, con la MISMA homografía (misma esquinas/dst) que el warp
// completo, así el recorte cae exactamente en el mismo sitio.
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
  const H = calcularHomografia(esquinas, dstFinal); // fuente -> destino
  const Hinv = invertirHomografia(H); // destino -> fuente

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

// ============================================================
// Muestreo de una marca OMR sobre la imagen ya enderezada
// ============================================================
//
// Aunque a partir de v2 la mayoría de la hoja se resuelve por OCR de letras
// (data-linea), el consentimiento y el compromiso de honestidad (README §2)
// se quedan como una casilla OMR simple en cualquier versión (ver
// marcaCuadrado más arriba): un gesto binario sí/no no tiene "cuál de varias
// letras", así que umbralizar oscuridad sigue siendo lo más simple y fiable.
export function calcularOscuridad(imageData, cx, cy, radioPx) {
  const r = Math.max(2, radioPx * 0.55); // algo más pequeño que la marca: evita su propio borde impreso
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

// ============================================================
// Recorte + OCR sobre la imagen ya enderezada
// ============================================================

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

// Recorta una región (en las mismas coordenadas canónicas 0..PAGE_W/PAGE_H
// que cualquier `linea` medida) directamente de la foto FUENTE (sin pasar
// por el warp bilineal de toda la página), corrigiendo perspectiva con la
// MISMA homografía (esquinas/dstFiduciales) pero muestreando con vecino más
// próximo (warpearImagen({nearest:true}) — ver el porqué en su comentario) Y
// con un margen generoso alrededor de la caja teórica del QR (margenRelativo,
// fracción de su ancho/alto por cada lado). Nada de esto es cosmético:
// probando contra una hoja generada por el propio código (sin cámara ni
// escáner de por medio, para descartar ruido externo), recortar EXACTO a la
// caja medida (`.hoja-qr-caja`) daba sistemáticamente un QR indecodificable
// pese a verse perfectamente nítido a ojo — detectarFiduciales() localiza el
// centro de cada fiducial con precisión de sobra para una marca OMR o un
// bloque de OCR (varios mm), pero un error de solo un par de píxeles en la
// homografía resultante ya desplaza la rejilla de módulos de un QR lo
// bastante como para que jsQR no la reconozca. Con margen de sobra alrededor,
// jsQR encuentra los patrones de localización él solo dentro de la imagen —
// que es justo para lo que está diseñado (igual que localizar un QR en
// cualquier posición dentro del encuadre de una cámara) — así que un
// pequeño desalineamiento de la homografía deja de ser fatal. Verificado
// recortando con margen creciente hasta que jsQR decodificaba de forma
// fiable: por debajo de ~25% por lado, seguía fallando.
//
// Uso exclusivo de los QR (README §4.9): decodificarQr necesita módulos
// nítidos y margen de sobra, mientras que recortarLinea + el warp normal
// siguen siendo lo que usa el resto de leerPagina (oscuridad OMR / OCR), que
// no necesita ninguna de las dos cosas.
export function recortarRegionNitida(canvasFuente, esquinas, dstFiduciales, linea, escala, margenRelativo = 0.35) {
  const margenX = linea.w * margenRelativo;
  const margenY = linea.h * margenRelativo;
  const destW = Math.round((linea.w + 2 * margenX) * escala);
  const destH = Math.round((linea.h + 2 * margenY) * escala);
  const offsetX = Math.round((linea.x - margenX) * escala);
  const offsetY = Math.round((linea.y - margenY) * escala);
  return warpearImagen(canvasFuente, esquinas, destW, destH, dstFiduciales, { nearest: true, offsetX, offsetY });
}

let promesaTesseractWorker = null;
async function obtenerWorkerTesseract(avisar) {
  if (!promesaTesseractWorker) {
    promesaTesseractWorker = (async () => {
      avisar?.("Descargando Tesseract.js…");
      // El build ESM de tesseract.js@5 (a diferencia de jsQR/qrcode-generator,
      // scripts clásicos que cuelgan una global) solo trae un export
      // `default` que agrupa toda la API (createWorker, createScheduler...) —
      // NO exports nombrados. `const { createWorker } = await import(...)`
      // desestructura undefined del namespace del módulo (createWorker vive
      // dentro de `.default`, no al nivel superior) y falla más tarde con
      // "createWorker is not a function", no al importar.
      const { createWorker } = (await import(
        "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js"
      )).default;
      const worker = await createWorker("spa");
      return worker;
    })();
  }
  try {
    return await promesaTesseractWorker;
  } catch (e) {
    promesaTesseractWorker = null; // no dejar la caché envenenada para siempre: la siguiente página puede reintentarlo
    throw e;
  }
}

// Recorte de un recuadro de texto libre (letras de respuesta/corrección, año
// de nacimiento, letra de una opción/categoría elegida...): PSM 7 ("línea
// única") para bloques de una sola fila de caracteres (dígitos, o una letra
// de opción/categoría — a partir de v2, la mayoría de casillas de la hoja),
// PSM 6 ("bloque uniforme de texto") solo para bloques que pueden tener
// varias líneas de casillas (bloqueCasillasTexto con lineas>1, hoy solo
// 'abierto'). Lista blanca de caracteres acorde a lo que se pide escribir en
// la hoja: solo dígitos, solo letras mayúsculas, o alfanumérico (por
// defecto, para texto libre que puede llevar números).
export async function ocrLinea(canvas, { soloDigitos = false, soloLetras = false, avisar } = {}) {
  const worker = await obtenerWorkerTesseract(avisar);
  const whitelist = soloDigitos
    ? "0123456789"
    : soloLetras
      ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      : "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑ0123456789 ";
  await worker.setParameters({
    tessedit_pageseg_mode: soloDigitos || soloLetras ? "7" : "6",
    tessedit_char_whitelist: whitelist,
  });
  const { data } = await worker.recognize(canvas);
  return (data.text || "").trim();
}

// ============================================================
// Código QR: token de la remesa + versión del pipeline (README §4.9)
// ============================================================
//
// Ni qrcode-generator ni jsQR se publican como módulos ES en el CDN (son
// scripts clásicos que cuelgan una global de window) — a diferencia de
// Tesseract.js, aquí se cargan con una etiqueta <script> normal en vez de
// import() dinámico, y se lee la global una vez cargada.
//
// nombreGlobal (p. ej. "jsQR"): se comprueba ANTES de tocar el DOM (cubre
// tanto "ya cargado con éxito antes" como, tras un fallo previo, evita
// reintentar si por lo que sea la global ya está de todos modos) y timeoutMs
// asegura que esto nunca se quede colgado sin más si la red va lenta o el
// CDN no responde ni con éxito ni con error (un <script src> nunca tiene
// timeout propio) — sin esto, la subida en bloque (../subirLote.js) se
// quedaba indefinidamente en "Leyendo QR de página…" sin ningún error ni
// aviso con solo que la primera carga de esta librería se colgara.
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
      script.remove(); // no dejar una etiqueta rota que el próximo intento confunda con "ya cargando"
      reject(new Error(`No se pudo cargar ${src}`));
    });
    if (!yaEstaba) {
      script.src = src;
      document.head.appendChild(script);
    }
  });
}

let promesaQrGen = null;
async function obtenerQrGen() {
  if (!promesaQrGen) {
    promesaQrGen = cargarScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js", "qrcode").then(
      () => window.qrcode
    );
  }
  try {
    return await promesaQrGen;
  } catch (e) {
    promesaQrGen = null; // no dejar la caché envenenada para siempre: la siguiente página puede reintentarlo
    throw e;
  }
}

let promesaJsQr = null;
async function obtenerJsQr() {
  if (!promesaJsQr) {
    promesaJsQr = cargarScript("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js", "jsQR").then(() => window.jsQR);
  }
  try {
    return await promesaJsQr;
  } catch (e) {
    promesaJsQr = null; // no dejar la caché envenenada para siempre: la siguiente página puede reintentarlo
    throw e;
  }
}

// Genera el QR de un texto arbitrario como data URL, para incrustar en la
// hoja impresa. typeNumber 0 = tamaño automático según la longitud del
// texto; nivel de corrección M (equilibrio razonable entre tamaño del QR y
// tolerancia a manchas/dobleces del papel).
export async function generarQrDataUrl(texto) {
  const qrcodeLib = await obtenerQrGen();
  const qr = qrcodeLib(0, "M");
  qr.addData(texto);
  qr.make();
  return qr.createDataURL(8, 4);
}

// Decodifica el QR de un recorte ya enderezado. Devuelve el texto o null si
// no se pudo leer — la foto puede estar borrosa, mal encuadrada, etc.; el
// llamador cae entonces a que el admin elija el token a mano.
export async function decodificarQr(canvas) {
  const jsQR = await obtenerJsQr();
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const resultado = jsQR(imageData.data, imageData.width, imageData.height);
  return resultado ? resultado.data : null;
}

// Alfabeto sin caracteres ambiguos al leer a mano (sin 0/O, 1/I/L...) — el
// mismo criterio que Crockford Base32, usado tanto para exam_id como para
// que un admin pueda teclearlo sin dudar si algo falla al leer el QR
// (README §4.10: entrada manual de respaldo en la subida en bloque).
const ALFABETO_EXAM_ID = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// Identificador de una hoja física concreta (README §4.10), distinto del
// token_id de la remesa: una remesa se reparte en muchas hojas, cada una
// necesita su propio id para poder recomponerlas a partir de fotos sueltas
// subidas en cualquier orden. Deliberadamente CORTO (8 caracteres, ~2^39
// combinaciones — de sobra para los cientos/miles de hojas de un piloto,
// nunca miles de millones) en vez de un UUID v4 de 36 caracteres: cuanto más
// corto el payload del QR pequeño de página (codificarPayloadQrPagina), más
// grande puede ser cada módulo del QR impreso en los 10mm disponibles
// (.hoja-qr-pagina) y más fiable la lectura desde una foto de móvil — un
// UUID completo, repetido en las 10+ páginas de cada hoja a ese tamaño
// físico, arriesgaba quedar por debajo de los píxeles por módulo que jsQR
// necesita para decodificar con fiabilidad.
export function generarExamId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const b of bytes) id += ALFABETO_EXAM_ID[b % ALFABETO_EXAM_ID.length];
  return id;
}

// Payload del QR GRANDE (solo página 1, README §4.9/§4.10): token_id +
// versión del pipeline + exam_id + número de página, en JSON. Formato
// compartido por todas las versiones (para que el panel pueda leer un QR sin
// saber de antemano con qué versión se imprimió esa hoja y despachar al
// decodificador correcto). Si el texto no es JSON válido con esa forma, se
// asume una hoja de la primera versión (QR en plano con solo el token_id) —
// de antes de que existiera versión siquiera, sin exam_id ni página.
export function codificarPayloadQr({ tokenId, version, examId, pagina }) {
  return JSON.stringify({ token_id: tokenId, version, exam_id: examId ?? null, pagina: pagina ?? null });
}

export function decodificarPayloadQr(texto) {
  try {
    const obj = JSON.parse(texto);
    if (obj && typeof obj.token_id === "string" && typeof obj.version === "number") {
      return {
        tokenId: obj.token_id,
        version: obj.version,
        examId: typeof obj.exam_id === "string" ? obj.exam_id : null,
        pagina: typeof obj.pagina === "number" ? obj.pagina : null,
      };
    }
  } catch {
    // no era JSON: se asume un QR en plano con solo el token_id (v1, de antes
    // incluso de que existiera el campo "version")
  }
  return { tokenId: texto, version: 1, examId: null, pagina: null };
}

// Payload del QR PEQUEÑO de página (README §4.10, en TODAS las páginas):
// deliberadamente solo {exam_id, pagina} — ver generarExamId() para por qué
// no lleva también token_id/versión (esos solo hacen falta una vez, al ver
// la primera página de un exam_id nuevo; ../subirLote.js los resuelve
// entonces contra el servidor o, si ni siquiera la página 1 es legible, a
// mano). Claves de una letra a propósito, mismo motivo de tamaño.
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

// Rellena, DESPUÉS de paginar (cuando ya se sabe cuántas páginas tiene la
// hoja y qué número le toca a cada una), el QR grande de la página 1
// (payload completo) y el QR pequeño de TODAS las páginas (solo exam_id +
// página) — README §4.10. Recibe el array que devuelve construirPaginas
// (páginas de demografía + de ítems ya concatenadas) y lo muta in-place
// rellenando el <img> reservado en cada una (ver crearPagina más arriba);
// no hace falta reconstruir nada porque esos nodos siguen siendo los mismos
// que se acaban imprimiendo (abrirVentanaImpresion usa su outerHTML).
export async function rellenarQrPaginas(paginas, { tokenId, examId, version }) {
  for (let i = 0; i < paginas.length; i++) {
    const pagina = paginas[i];
    const numeroPagina = i + 1;
    const cajaGrande = pagina.elemento.querySelector('[data-linea="meta:qr"] .hoja-qr-img');
    if (cajaGrande) {
      cajaGrande.src = await generarQrDataUrl(codificarPayloadQr({ tokenId, version, examId, pagina: numeroPagina }));
      // decode() (no solo asignar .src) para que la imagen esté REALMENTE
      // pintada antes de seguir: sin esto, capturar la página justo después
      // de esta función (README de ocr_tests/generar.mjs) es una carrera con
      // la decodificación asíncrona del navegador — a veces gana, a veces no,
      // y el QR sale en blanco en la captura de forma no determinista.
      await cajaGrande.decode().catch(() => {});
    }
    const cajaPequena = pagina.elemento.querySelector('[data-linea="meta:qr:pagina"] .hoja-qr-pagina-img');
    if (cajaPequena) {
      cajaPequena.src = await generarQrDataUrl(codificarPayloadQrPagina({ examId, pagina: numeroPagina }));
      await cajaPequena.decode().catch(() => {});
    }
    pagina.numeroPagina = numeroPagina;
    pagina.totalPaginas = paginas.length;
  }
}

// Posición (coordenadas de página, 0..PAGE_W x 0..PAGE_H) de la caja del QR
// pequeño de página: FIJA, no depende de la versión del pipeline ni del
// contenido de la hoja (comparte crearPagina()/CSS_HOJA_BASE con v1 y v2, y
// está posicionada en absoluto, fuera del flujo). Por eso la subida en
// bloque (../subirLote.js) puede recortar y decodificar este QR ANTES de
// saber siquiera con qué versión se imprimió la hoja — necesario, porque la
// versión es precisamente uno de los datos que hace falta leer del QR
// grande (o consultar al servidor por exam_id) para poder interpretar el
// resto de la página.
// Lee UNA página ya enderezada (foto -> homografía -> canvas warp, hecho por
// el llamador): muestrea la oscuridad de cada marca OMR y OCR-ea cada línea
// de texto, más los dos QR posibles (grande en página 1, pequeño en todas,
// README §4.9/§4.10). Genérico entre v1 y v2 (toda la diferencia entre
// versiones está en qué whitelist de OCR usar por clave, que decide
// opcionesOcrParaClave) y entre el flujo secuencial de siempre
// (v{1,2}/digitalizar.js::iniciarEscaneo) y la subida en bloque
// (subirLote.js) — ambos llaman a esto por página, cambia solo qué hacen con
// el resultado (acumular en memoria vs. mandarlo al servidor).
//
// Devuelve { oscuridad, textos } como objetos planos (serializables con
// JSON.stringify, a diferencia de un Map) más qrGrande/qrPagina con lo
// decodificado de cada QR si estaba presente y se pudo leer (null si no).
//
// canvasFuente/esquinas/dstFiduciales (opcionales, los mismos que se le
// pasaron a warpearImagen() para producir warpCanvas): si se dan, los QR se
// recortan de NUEVO directamente de la foto fuente con vecino más próximo
// (recortarRegionNitida) en vez de recortarlos del propio warpCanvas
// (bilineal) — el suavizado bilineal del warp normal, aceptable para
// oscuridad OMR/OCR, difumina lo bastante los módulos de un QR como para que
// jsQR deje de encontrarlo, sobre todo en el QR grande (más denso, lleva el
// UUID del token_id — README §4.9). Sin estos tres parámetros se cae al
// recorte de siempre (compatibilidad, por si algún llamador no los tiene a
// mano), pero los tres llamadores actuales (v1/v2 digitalizar.js,
// subirLote.js) los pasan siempre.
//
// ocrLote (opcional, solo lo usa v2 con el motor IA — README §4.7, "Motor
// gpt-mini"): si se pasa, sustituye a ocrLinea/Tesseract para TODAS las
// líneas de texto de la página (nunca para los QR, que siguen leyéndose
// igual arriba, deterministas). En vez de llamar a ocrLinea línea a línea,
// se recortan primero TODAS las líneas de texto de la página y se llaman de
// una sola vez con ocrLote(lineasTexto), donde lineasTexto es
// [{clave, recorte, opciones}] (opciones = lo que devuelva
// opcionesOcrParaClave(clave), igual que se le pasaría a ocrLinea) — así
// quien orquesta el escaneo decide con una única llamada de red por página
// (o acumula recortes de varias páginas para una única llamada por examen
// completo, ver v2/digitalizar.js) en vez de una petición por casilla. Debe
// devolver {clave: texto}; una clave ausente en el resultado se trata como
// "no reconocido" (cadena vacía), igual que ocrLinea con un recorte en
// blanco.
export async function leerPagina(
  pagina,
  warpCanvas,
  { opcionesOcrParaClave, avisar, canvasFuente, esquinas, dstFiduciales, ocrLote } = {}
) {
  const escala = ESCALA_DIGITALIZACION;
  const imgData = warpCanvas.getContext("2d").getImageData(0, 0, warpCanvas.width, warpCanvas.height);

  const oscuridad = {};
  for (const m of pagina.marcas) {
    oscuridad[m.clave] = calcularOscuridad(imgData, m.cx * escala, m.cy * escala, m.radio * escala);
  }

  const textos = {};
  let qrGrande = null;
  let qrPagina = null;
  const lineasTexto = [];
  for (const l of pagina.lineas) {
    if (l.clave === "meta:qr" || l.clave === "meta:qr:pagina") {
      avisar?.("Leyendo QR…");
      try {
        const recorteQr =
          canvasFuente && esquinas && dstFiduciales
            ? recortarRegionNitida(canvasFuente, esquinas, dstFiduciales, l, escala)
            : recortarLinea(warpCanvas, l, escala);
        const leido = await decodificarQr(recorteQr);
        if (leido) {
          if (l.clave === "meta:qr") qrGrande = decodificarPayloadQr(leido);
          else qrPagina = decodificarPayloadQrPagina(leido);
        }
      } catch {
        // sin jsQR disponible (sin red, CDN caído…): se sigue sin el atajo
        // del QR, el llamador cae a resolución manual
      }
      continue;
    }
    const recorte = recortarLinea(warpCanvas, l, escala);
    if (ocrLote) {
      lineasTexto.push({ clave: l.clave, recorte, opciones: opcionesOcrParaClave?.(l.clave) });
      continue;
    }
    avisar?.(`Leyendo texto (${l.clave})…`);
    const texto = await ocrLinea(recorte, { ...opcionesOcrParaClave?.(l.clave), avisar });
    textos[l.clave] = texto;
  }

  if (ocrLote && lineasTexto.length > 0) {
    const resultado = await ocrLote(lineasTexto);
    for (const { clave } of lineasTexto) textos[clave] = resultado[clave] ?? "";
  }

  return { oscuridad, textos, qrGrande, qrPagina };
}

// ============================================================
// Motor de OCR-IA (README §4.7, "Motor gpt-mini"): construcción del callback
// `ocrLote` que consume leerPagina() de arriba, compartida por CUALQUIER
// orquestador de escaneo que quiera ofrecer el motor IA además de Tesseract
// (hoy v2/digitalizar.js — flujo secuencial — y subirLote.js — subida en
// bloque, README §4.10). Deliberadamente aquí y no duplicada en cada uno:
// ambos flujos arman el mismo manifiesto de casillas y llaman al mismo
// endpoint, solo cambia CUÁNDO se dispara la llamada (ver `agrupacion` más
// abajo) y de qué versión de hoja vienen las claves — que ya resuelve
// opcionesOcrParaClave de cada pipeline (v1/v2), no esta función.
//
// Nunca importa admin.js (comun.js se mantiene sin dependencias de red/framework,
// ver cabecera del fichero): quien llama pasa `llamarOcrIa` (normalmente
// admin.js::api.ocrIa) por inyección, en vez de que esto haga fetch() él solo.
// ============================================================

// Traduce lo que ya calculaba opcionesOcrParaClave (para la whitelist de
// Tesseract) al "tipo" que espera POST /api/admin/ocr-ia.
export function tipoCasillaOcrIA(opciones) {
  if (opciones?.soloDigitos) return "digito";
  if (opciones?.soloLetras) return "letra";
  return "texto";
}

// Fábrica del callback ocrLote: construye el manifiesto de casillas de UNA
// página (recortes ya codificados como data URL JPEG) y, según `agrupacion`:
// - "pagina" (o sin especificar): llama a llamarOcrIa una vez por página, en
//   cuanto esa página se lee — la única opción que tiene sentido cuando cada
//   página se persiste de forma independiente en cuanto se lee (subirLote.js:
//   páginas de un mismo examen pueden subirse en visitas o dispositivos
//   distintos, no hay un momento único de "hoja completa" antes de guardar).
// - "examen": NO llama a la API todavía — acumula el manifiesto en
//   `pendientes` (un array que el llamador comparte entre todas las páginas
//   de una misma hoja) y devuelve un resultado vacío; es responsabilidad de
//   quien orquesta hacer la llamada real con todo lo acumulado cuando
//   corresponda y volcar el resultado a sus propios textos (ver
//   v2/digitalizar.js::iniciarEscaneo, que sí conoce el momento en que la
//   hoja entera ya se ha escaneado).
export function crearOcrLote({ paginaId, modelo, agrupacion, pendientes, llamarOcrIa }) {
  return async (lineasTexto) => {
    const casillas = lineasTexto.map(({ clave, recorte, opciones }) => ({
      clave,
      tipo: tipoCasillaOcrIA(opciones),
      imagen: recorte.toDataURL("image/jpeg", 0.85),
    }));
    if (agrupacion === "examen" && pendientes) {
      pendientes.push({ id: paginaId, casillas });
      return {};
    }
    const { resultados } = await llamarOcrIa({ modelo, paginas: [{ id: paginaId, casillas }] });
    return resultados[paginaId] ?? {};
  };
}

// Devuelve { fiduciales, lineaQrPagina, lineaQrGrande }: la posición canónica
// de los 4 fiduciales de esquina, la caja del QR pequeño de página y la caja
// del QR grande de la remesa — ninguna de las tres depende de la versión del
// pipeline ni de qué items lleve la hoja. Fiduciales y QR de página son de
// comun.js::crearPagina, position absolute, compartidos tal cual por v1 y v2;
// el QR grande (comun.js::construirBloqueQrGrande) SÍ participa del flujo
// normal de contenido, pero al ser siempre el primer bloque justo después de
// la cabecera (misma cabecera, mismo padding, en cualquier versión — ver
// construirBloqueQrGrande), su posición tampoco depende de qué venga
// después. La subida en bloque (../subirLote.js) usa esto UNA vez para poder
// enderezar cualquier foto y leer su QR de página, y si es la página 1 de un
// examen nuevo, también el QR grande (remesa + versión), ANTES de saber
// siquiera con qué versión se imprimió esa hoja concreta — la versión es,
// precisamente, uno de los datos que hace falta para interpretar el resto
// del contenido de la página.
export function medirGeometriaBaseEnBlanco() {
  const estiloTemporal = document.createElement("style");
  estiloTemporal.textContent = CSS_HOJA_BASE;
  document.head.appendChild(estiloTemporal);
  const medida = crearContenedorMedida();
  try {
    const pagina = crearPagina("x");
    pagina.appendChild(construirBloqueQrGrande());
    medida.appendChild(pagina);
    const { lineas, fiduciales } = medirMarcas(pagina);
    return {
      fiduciales,
      lineaQrPagina: lineas.find((l) => l.clave === "meta:qr:pagina"),
      lineaQrGrande: lineas.find((l) => l.clave === "meta:qr"),
    };
  } finally {
    medida.remove();
    estiloTemporal.remove();
  }
}

// ============================================================
// PDF -> una imagen por página (README §4.10): la subida en bloque acepta
// tanto fotos/escaneos sueltos (image/*) como un PDF con varias páginas ya
// escaneadas (p. ej. un escáner de sobremesa que saca un único PDF de toda
// la hoja) — en ese caso, mejor: no hay que ir subiendo página a página.
// pdf.js no se publica como build ESM "de un solo fichero" tan simple como
// qrcode-generator/jsQR, pero sí tiene un build .mjs en el CDN; se carga bajo
// demanda igual que Tesseract.js, y necesita además fijar dónde está su
// propio worker (pdf.worker.min.mjs) antes de usarlo.
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

// Renderiza cada página del PDF a un canvas propio, a una resolución similar
// a la que usa prepararImagenFuente() para una foto (~2200px de ancho): así
// detectarFiduciales/warpearImagen trabajan con el mismo orden de magnitud
// de píxeles venga la página de una foto o de un PDF ya escaneado.
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
// Selector de 4 esquinas sobre la foto subida
// ============================================================

// canvas ya dimensionado por el llamador al tamaño de PRESENTACIÓN; fuente
// es el canvas/imagen de trabajo a resolución completa (anchoNatural x
// altoNatural). Los puntos se guardan en coordenadas de "fuente" (naturales),
// que es justo lo que necesita calcularHomografia más adelante.
// puntosIniciales (opcional): resultado de detectarFiduciales() cuando la
// detección automática tuvo éxito; si no se pasa, se usa una aproximación
// genérica cerca de cada esquina (a arrastrar a mano sobre el fiducial real).
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
// Detección automática de los 4 fiduciales de esquina
// ============================================================
//
// No es visión por computador "de verdad" (nada de conectados/contornos). El
// cuadrante de búsqueda de cada esquina es generoso (para tolerar fotos mal
// encuadradas) y por tanto puede contener también contenido de la propia
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
// de la foto en cada esquina). Devuelve null si falla alguna esquina; el
// llamador cae entonces a la posición por defecto del selector manual.
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
  // por esquina no bastó para descartar un falso positivo, esto lo detecta:
  // un vértice muy fuera de sitio dispara una distancia muy distinta a las
  // otras 3, y se descarta la detección entera en vez de devolver un punto
  // claramente malo.
  const cx = puntos.reduce((s, p) => s + p.x, 0) / 4;
  const cy = puntos.reduce((s, p) => s + p.y, 0) / 4;
  const distancias = puntos.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const distanciaMedia = distancias.reduce((s, d) => s + d, 0) / 4;
  if (distancias.some((d) => Math.abs(d - distanciaMedia) / distanciaMedia > 0.4)) return null;

  return puntos;
}
