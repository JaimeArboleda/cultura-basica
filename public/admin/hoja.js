// Hoja de respuestas imprimible en formato OMR (casillas a rellenar) para la
// digitalización de tests en papel (README §4.7). Módulo puramente de
// maquetación: construye el DOM de cada página (tanto para imprimir como para
// medir dónde cae cada marca) y no sabe nada de fetch/estado — eso vive en
// digitalizar.js.
//
// Decisión de diseño central: casi todo el test se reduce a "rellena una
// burbuja" (opción múltiple, selección múltiple, y también orden/clasificación
// mediante una rejilla de burbujas por elemento) en vez de pedir letra
// manuscrita — eso convierte la mayoría de la hoja en un problema de OMR
// (umbralizado de una región conocida), sin ambigüedad de interpretación.
// Solo los ~10 ítems 'abierto' y el año de nacimiento piden texto, y ahí se
// pide MAYÚSCULAS en casillas individuales para maximizar el acierto de
// Tesseract.js (ver digitalizar.js).
//
// Corrección sin depender NUNCA de oscuridad relativa entre intentos: cada
// ítem imprime un bloque "Respuesta" y, más pequeño y en dos columnas, un
// bloque "Corrección" (con una casilla "no responder" incluida). Si el
// bloque de Corrección tiene cualquier marca, digitalizar.js lo usa entero y
// descarta el de Respuesta — nunca se decide comparando qué tan oscura está
// una marca frente a otra.
//
// Las mismas funciones que construyen el DOM para imprimir se usan para medir
// (getBoundingClientRect) dónde cae cada marca en la página en blanco: así el
// pipeline de digitalización sabe exactamente qué región de la foto ya
// enderezada corresponde a cada burbuja/casilla, sin tener que detectarlas por
// visión artificial. Las 4 marcas fiduciales de esquina (cuadrados sólidos)
// se miden igual, y sirven de referencia geométrica para enderezar la foto
// (digitalizar.js las detecta solas en vez de exigir un clic manual).
import { CATALOGOS } from "../js/demografia.js";

// A4 a 96dpi "CSS px" (constante del propio spec de CSS: 1mm = 96/25.4px,
// siempre, independiente de la resolución real de la impresora/escáner —
// tanto al imprimir como al medir el DOM de referencia se parte de esta
// misma escala).
const PX_POR_MM = 96 / 25.4;
// Hueco deliberadamente amplio entre los fiduciales (3-8mm del borde, ver
// CSS_HOJA más abajo) y el contenido (empieza en este padding): la detección
// automática de fiduciales (digitalizar.js::detectarFiduciales) busca en un
// cuadrante generoso cerca de cada esquina para tolerar fotos mal encuadradas,
// y un hueco estrecho hace que confunda el fiducial con el propio contenido
// (p. ej. el enunciado en negrita del primer ítem de la página, muy cerca de
// la esquina superior izquierda). 18mm deja un margen de ~10mm libre de tinta
// alrededor del fiducial en vez de los ~2mm que había con 12mm de padding.
const PAGINA_PADDING_MM = 18; // ver ".hoja-pagina { padding: 18mm }" en CSS_HOJA
export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;
export const PAGE_W = Math.round(PAGE_W_MM * PX_POR_MM); // ≈ 794
export const PAGE_H = Math.round(PAGE_H_MM * PX_POR_MM); // ≈ 1123

// Escala del canvas de referencia usado al digitalizar (public/admin/digitalizar.js):
// cuanto mayor, más resolución para el muestreo de burbujas y el recorte que
// se le pasa a Tesseract, a costa de más cómputo por warp. 3x da ~2382x3369px,
// de sobra para distinguir una burbuja rellena de una vacía y para OCR de
// letras de imprenta grandes.
export const ESCALA_DIGITALIZACION = 3;

// Color de acento único, sobrio y con buen contraste en fotocopia B/N (queda
// como un gris medio si se imprime sin color) — solo para cabeceras y
// separadores, nunca para el contenido que hay que leer/rellenar.
const COLOR_ACENTO = "#2b4c7e";

export const CSS_HOJA = `
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
  .hoja-fila-opcion { display: flex; align-items: center; gap: 2mm; margin: 0.7mm 0; }
  .hoja-marca-circulo, .hoja-marca-cuadrado {
    width: 3.6mm; height: 3.6mm; border: 0.4mm solid #111; flex: none; background: #fff;
  }
  .hoja-marca-circulo { border-radius: 50%; }

  /* Rejilla elemento+burbujas de 'ordenar'/'clasificar': columna de etiqueta
     de ANCHO FIJO vía CSS grid (no min-width en flex), para que las burbujas
     de todas las filas del ítem caigan siempre en la misma posición
     horizontal, se lea o no fácil el nombre del elemento. */
  .hoja-fila-elemento {
    display: grid;
    grid-template-columns: 34mm 1fr;
    align-items: center;
    column-gap: 2mm;
    margin: 0.7mm 0;
  }
  .hoja-elemento-etiqueta { overflow-wrap: break-word; }
  .hoja-grid-burbujas { display: flex; gap: 1.3mm; flex-wrap: wrap; }
  .hoja-burbuja-cel { display: flex; flex-direction: column; align-items: center; gap: 0.4mm; }
  .hoja-burbuja-cel-etiqueta { font-size: 7.5px; color: #444; }
  .hoja-leyenda-categorias { font-size: 8px; color: #444; margin-bottom: 1.5mm; }

  .hoja-leyenda { font-size: 9px; color: #555; margin-bottom: 1.5mm; }
  .hoja-instruccion {
    font-size: 9px;
    color: ${COLOR_ACENTO};
    font-weight: 600;
    margin-bottom: 1.5mm;
  }

  .hoja-bloque-texto-titulo { font-size: 8.5px; color: #555; margin: 1mm 0 0.8mm; }
  .hoja-linea-casillas { display: flex; gap: 0.9mm; margin-bottom: 0.8mm; }
  .hoja-casilla-texto {
    width: 5.6mm; height: 6.6mm; border: 0.35mm solid #111; flex: none; background: #fff;
  }

  /* Bloque de corrección (README §4.9): separado visualmente del de
     respuesta, más pequeño y compacto — nunca es la vía principal, solo se
     usa si hay que corregir. */
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
  .hoja-correccion-columnas {
    column-count: 2;
    column-gap: 5mm;
    font-size: 8.5px;
  }
  .hoja-correccion-columnas .hoja-fila-opcion,
  .hoja-correccion-columnas .hoja-fila-elemento {
    break-inside: avoid;
    margin: 0.4mm 0;
  }
  .hoja-correccion-columnas .hoja-fila-elemento { grid-template-columns: 20mm 1fr; column-gap: 1mm; }
  .hoja-correccion-columnas .hoja-marca-circulo,
  .hoja-correccion-columnas .hoja-marca-cuadrado {
    width: 3.2mm; height: 3.2mm;
  }
  .hoja-correccion-columnas .hoja-grid-burbujas { gap: 0.6mm; }
  .hoja-correccion-columnas .hoja-burbuja-cel-etiqueta { font-size: 6px; }
  .hoja-correccion-blanco {
    font-size: 8.5px;
    font-style: italic;
    margin-top: 1mm;
    break-inside: avoid;
  }

  /* Marcas fiduciales: cuadrados sólidos cerca de cada esquina, fuera del
     área de contenido (dentro del padding de la página). Sirven de
     referencia geométrica para enderezar la foto (digitalizar.js). */
  .hoja-fiducial { position: absolute; width: 5mm; height: 5mm; background: #111; }
  .hoja-fiducial-tl { top: 3mm; left: 3mm; }
  .hoja-fiducial-tr { top: 3mm; right: 3mm; }
  .hoja-fiducial-br { bottom: 3mm; right: 3mm; }
  .hoja-fiducial-bl { bottom: 3mm; left: 3mm; }

  /* Código QR con el token de la remesa (README §4.9): así una hoja
     fotocopiada y repartida por un colaborador se puede digitalizar sin que
     el admin tenga que recordar a mano de qué remesa era cada foto. */
  .hoja-qr { display: flex; align-items: flex-start; gap: 3mm; }
  .hoja-qr-caja { width: 22mm; height: 22mm; flex: none; }
  .hoja-qr-img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  .hoja-qr-texto { font-size: 7px; font-family: ui-monospace, monospace; color: #555; word-break: break-all; margin-top: 1mm; }
`;

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function escaparHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function marcaCirculo(clave, etiquetaHtml) {
  return el(`
    <label class="hoja-fila-opcion">
      <span class="hoja-marca-circulo" data-mark="${clave}"></span>
      <span>${etiquetaHtml}</span>
    </label>`);
}

function marcaCuadrado(clave, etiquetaHtml) {
  return el(`
    <label class="hoja-fila-opcion">
      <span class="hoja-marca-cuadrado" data-mark="${clave}"></span>
      <span>${etiquetaHtml}</span>
    </label>`);
}

// Bloque de N líneas de casillas de texto (README §4.9): todas las líneas se
// miden como UNA sola región rectangular (data-linea en el contenedor
// exterior), así digitalizar.js recorta el bloque entero de una vez y lo
// pasa a Tesseract como un bloque de texto (varias líneas), no línea a línea.
const LINEAS_TEXTO = 2;
const CASILLAS_POR_LINEA = 20;

function bloqueCasillasTexto(clave, casillasPorLinea = CASILLAS_POR_LINEA, lineas = LINEAS_TEXTO) {
  const filas = Array.from({ length: lineas }, () => {
    const casillas = Array.from({ length: casillasPorLinea }, () => `<span class="hoja-casilla-texto"></span>`).join("");
    return `<div class="hoja-linea-casillas">${casillas}</div>`;
  }).join("");
  return el(`<div data-linea="${clave}">${filas}</div>`);
}

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Fila "elemento + rejilla de burbujas" común a 'ordenar' (burbujas = posición
// 1..N) y 'clasificar' (burbujas = categoría A..K): en ambos casos la persona
// rellena UNA burbuja por fila, así que la interpretación en digitalizar.js es
// idéntica (ganador por fila) aunque el significado de cada columna cambie.
function filaElementoConBurbujas(etiquetaElemento, claves, etiquetasColumna) {
  const burbujas = claves
    .map(
      (clave, i) => `
      <span class="hoja-burbuja-cel">
        <span class="hoja-marca-circulo" data-mark="${clave}"></span>
        <span class="hoja-burbuja-cel-etiqueta">${etiquetasColumna[i]}</span>
      </span>`
    )
    .join("");
  return el(`
    <div class="hoja-fila-elemento">
      <span class="hoja-elemento-etiqueta">${etiquetaElemento}</span>
      <span class="hoja-grid-burbujas">${burbujas}</span>
    </div>`);
}

// --- Bloque "Corrección" (README §4.9): duplica el bloque de Respuesta, más
// compacto (2 columnas, letra más pequeña) y con una casilla "no responder"
// para poder anular sin depender de comparar oscuridad entre intentos.
// prefijoClaves ya incluye el ":correccion" (ver claveCorreccion()).

function claveCorreccion(item) {
  return `item:${item.id}:correccion`;
}

function bloqueCorreccionOpciones(item, prefijoClaves, cuadrado) {
  const marca = cuadrado ? marcaCuadrado : marcaCirculo;
  const opciones = item.opciones
    .map((opcion, i) => marca(`${prefijoClaves}:opcion:${i}`, `${LETRAS[i]}) ${escaparHtml(opcion)}`).outerHTML)
    .join("");
  return el(`
    <div class="hoja-correccion">
      <div class="hoja-correccion-titulo">Corrección (solo si te equivocaste arriba)</div>
      <div class="hoja-correccion-columnas">${opciones}</div>
      ${marcaCuadrado(`${prefijoClaves}:blank`, "No quiero responder / dejar en blanco").outerHTML}
    </div>`);
}

function bloqueCorreccionGrid(item, prefijoClaves, construirClaves, etiquetasColumna) {
  const filas = item.elementos
    .map((elemento, i) => filaElementoConBurbujas(escaparHtml(elemento), construirClaves(i), etiquetasColumna(i)).outerHTML)
    .join("");
  return el(`
    <div class="hoja-correccion">
      <div class="hoja-correccion-titulo">Corrección (solo si te equivocaste arriba)</div>
      <div class="hoja-correccion-columnas">${filas}</div>
      ${marcaCuadrado(`${prefijoClaves}:blank`, "No quiero responder / dejar en blanco").outerHTML}
    </div>`);
}

// --- Bloque de un ítem (README §4.2: un formato distinto por tipo) ---

export function construirBloqueItem(item, numero) {
  const bloque = el(`<div class="hoja-item" data-item-id="${item.id}"></div>`);
  const enunciado = el(
    `<div class="hoja-item-enunciado"><span class="hoja-item-numero">${numero}</span><span>${escaparHtml(item.enunciado)}</span></div>`
  );
  bloque.appendChild(enunciado);

  if (item.texto) {
    bloque.appendChild(el(`<div class="hoja-item-texto">${escaparHtml(item.texto)}</div>`));
  }

  const prefCorreccion = claveCorreccion(item);

  switch (item.formato) {
    case "abierto": {
      bloque.appendChild(el(`<div class="hoja-instruccion">Escribe en MAYÚSCULAS, una letra por casilla.</div>`));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
      bloque.appendChild(bloqueCasillasTexto(`item:${item.id}:abierto`));
      bloque.appendChild(
        el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`)
      );
      bloque.appendChild(bloqueCasillasTexto(`${prefCorreccion}:abierto`));
      break;
    }
    case "opcion_multiple": {
      bloque.appendChild(el(`<div class="hoja-instruccion">Marca UNA sola respuesta.</div>`));
      item.opciones.forEach((opcion, i) => {
        bloque.appendChild(marcaCirculo(`item:${item.id}:opcion:${i}`, `${LETRAS[i]}) ${escaparHtml(opcion)}`));
      });
      bloque.appendChild(bloqueCorreccionOpciones(item, prefCorreccion, false));
      break;
    }
    case "seleccion_multiple": {
      bloque.appendChild(el(`<div class="hoja-instruccion">Marca TODAS las que correspondan (puede ser más de una).</div>`));
      item.opciones.forEach((opcion, i) => {
        bloque.appendChild(marcaCuadrado(`item:${item.id}:opcion:${i}`, `${LETRAS[i]}) ${escaparHtml(opcion)}`));
      });
      bloque.appendChild(bloqueCorreccionOpciones(item, prefCorreccion, true));
      break;
    }
    case "ordenar": {
      const n = item.elementos.length;
      bloque.appendChild(
        el(`<div class="hoja-instruccion">Para cada elemento, marca la burbuja de la posición que le corresponde (1 = más antiguo/primero). Una única burbuja por fila.</div>`)
      );
      item.elementos.forEach((elemento, i) => {
        const claves = Array.from({ length: n }, (_, pos) => `item:${item.id}:orden:${i}:${pos}`);
        const etiquetas = Array.from({ length: n }, (_, pos) => String(pos + 1));
        bloque.appendChild(filaElementoConBurbujas(escaparHtml(elemento), claves, etiquetas));
      });
      bloque.appendChild(
        bloqueCorreccionGrid(
          item,
          prefCorreccion,
          (i) => Array.from({ length: n }, (_, pos) => `${prefCorreccion}:orden:${i}:${pos}`),
          () => Array.from({ length: n }, (_, pos) => String(pos + 1))
        )
      );
      break;
    }
    case "clasificar": {
      bloque.appendChild(el(`<div class="hoja-instruccion">Para cada elemento, marca la burbuja de su categoría. Una única burbuja por fila.</div>`));
      bloque.appendChild(
        el(
          `<div class="hoja-leyenda-categorias">${item.categorias
            .map((cat, i) => `${LETRAS[i]} = ${escaparHtml(cat)}`)
            .join(" &nbsp;·&nbsp; ")}</div>`
        )
      );
      item.elementos.forEach((elemento, i) => {
        const claves = item.categorias.map((_, catIdx) => `item:${item.id}:clasificar:${i}:${catIdx}`);
        const etiquetas = item.categorias.map((_, catIdx) => LETRAS[catIdx]);
        bloque.appendChild(filaElementoConBurbujas(escaparHtml(elemento), claves, etiquetas));
      });
      bloque.appendChild(
        bloqueCorreccionGrid(
          item,
          prefCorreccion,
          (i) => item.categorias.map((_, catIdx) => `${prefCorreccion}:clasificar:${i}:${catIdx}`),
          () => item.categorias.map((_, catIdx) => LETRAS[catIdx])
        )
      );
      break;
    }
  }
  return bloque;
}

// --- Bloques de demografía: consentimiento + compromiso de honestidad +
// datos demográficos (README §2, §5) --- igual que la pantalla previa al
// test en la web, pero en papel son las primeras páginas de la hoja, también
// resueltas con burbujas salvo el año de nacimiento (casillas de dígito,
// OCR con Tesseract.js). Cada catálogo es su propio bloque "empaquetable":
// con 7 campos + ~57 valores en total no cabe en una sola página A4 a un
// tamaño de letra legible, así que se reparte en tantas páginas como haga
// falta con el mismo empaquetado voraz que los ítems (paginarBloques). No
// llevan bloque de Corrección duplicado (a diferencia de los ítems del
// test): son datos de contexto, no el objeto de medida del estudio, y
// duplicar aquí también los ~57 valores de los catálogos multiplicaría el
// tamaño de estas páginas sin aportar tanto.
// qr: { dataUrl, tokenId } opcional (README §4.9) — si se pasa, la hoja
// incluye el QR con el token de la remesa como primer bloque, para que
// digitalizar.js pueda leerlo solo al escanear en vez de que el admin tenga
// que elegir la remesa a mano.
function construirBloquesDemografia(qr) {
  const bloques = [];
  if (qr?.dataUrl) {
    bloques.push(
      el(`
        <div class="hoja-item hoja-qr">
          <div class="hoja-qr-caja" data-linea="meta:qr">
            <img src="${qr.dataUrl}" alt="Código QR de la remesa" class="hoja-qr-img" />
          </div>
          <div>
            <div class="hoja-item-enunciado"><span>Código de la remesa</span></div>
            <div class="hoja-leyenda">No lo rellenes: identifica a qué remesa pertenece esta hoja.</div>
            <div class="hoja-qr-texto">${escaparHtml(qr.tokenId ?? "")}</div>
          </div>
        </div>`)
    );
  }

  const consentimiento = el(`<div class="hoja-item"><div class="hoja-item-enunciado"><span>Consentimiento y compromiso</span></div></div>`);
  consentimiento.appendChild(
    marcaCuadrado(
      "demografia:consentimiento",
      "He leído la información del estudio y consiento participar de forma anónima."
    )
  );
  consentimiento.appendChild(
    marcaCuadrado(
      "demografia:compromiso_honestidad",
      "Me comprometo a responder con honestidad, sin buscar las respuestas."
    )
  );

  const anio = el(`<div class="hoja-item"><div class="hoja-item-enunciado"><span>Año de nacimiento</span></div></div>`);
  anio.appendChild(el(`<div class="hoja-instruccion">4 dígitos, en números de imprenta.</div>`));
  anio.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
  anio.appendChild(bloqueCasillasTexto("demografia:anio_nacimiento", 4, 1));
  anio.appendChild(el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`));
  anio.appendChild(bloqueCasillasTexto("demografia:correccion:anio_nacimiento", 4, 1));

  bloques.push(consentimiento, anio);

  // [campo del objeto Demografia (worker/src/tipos.ts), clave en CATALOGOS
  // (public/js/demografia.js — no siempre coincide: "estudios_mayor_progenitor"
  // reutiliza el catálogo "nivel_estudios", igual que en la web), etiqueta].
  const CAMPOS = [
    ["sexo", "sexo", "Sexo"],
    ["ccaa_educacion_secundaria", "ccaa", "CCAA donde cursaste la educación secundaria"],
    ["nivel_estudios", "nivel_estudios", "Nivel de estudios"],
    ["area_estudios", "area_estudios", "Área de estudios"],
    ["estudios_mayor_progenitor", "nivel_estudios", "Mayor nivel de estudios de tu padre o madre"],
    ["libros_en_casa", "libros_en_casa", "Libros en casa a los 15 años (aprox.)"],
  ];
  for (const [campo, claveCatalogo, etiqueta] of CAMPOS) {
    const bloque = el(`<div class="hoja-item"><div class="hoja-item-enunciado"><span>${etiqueta}</span></div></div>`);
    for (const valor of CATALOGOS[claveCatalogo]) {
      bloque.appendChild(marcaCirculo(`demografia:${campo}:${valor}`, escaparHtml(valor)));
    }
    bloques.push(bloque);
  }
  return bloques;
}

function crearPagina(tituloDerecha) {
  return el(`
    <div class="hoja-pagina">
      <span class="hoja-fiducial hoja-fiducial-tl" data-fiducial="tl"></span>
      <span class="hoja-fiducial hoja-fiducial-tr" data-fiducial="tr"></span>
      <span class="hoja-fiducial hoja-fiducial-br" data-fiducial="br"></span>
      <span class="hoja-fiducial hoja-fiducial-bl" data-fiducial="bl"></span>
      <div class="hoja-cabecera">
        <strong>Test de Cultura General — hoja de respuestas</strong>
        <span>${escaparHtml(tituloDerecha)}</span>
      </div>
    </div>`);
}

// Contenedor invisible pero con layout real (no display:none, que da
// getBoundingClientRect a cero): fuera de la pantalla en vez de oculto, para
// poder medir alturas y luego coordenadas de marcas con las mismas reglas
// exactas que se usan al imprimir.
function crearContenedorMedida() {
  const cont = document.createElement("div");
  cont.style.position = "fixed";
  cont.style.left = "-10000px";
  cont.style.top = "0";
  cont.style.width = `${PAGE_W_MM}mm`;
  document.body.appendChild(cont);
  return cont;
}

// Altura disponible dentro de una página para bloques de contenido: alto
// total de página menos el padding vertical (arriba+abajo, ".hoja-pagina" en
// CSS_HOJA), menos la cabecera, menos un margen de seguridad para no pegar
// el último bloque al borde inferior.
function alturaDisponiblePorPagina(medida) {
  const sonda = crearPagina("x");
  medida.appendChild(sonda);
  const altoCabecera = sonda.querySelector(".hoja-cabecera").getBoundingClientRect().height;
  sonda.remove();
  const paddingVerticalPx = 2 * PAGINA_PADDING_MM * PX_POR_MM;
  const MARGEN_SEGURIDAD_PX = 20;
  return Math.max(PAGE_H - paddingVerticalPx - altoCabecera - MARGEN_SEGURIDAD_PX, 200);
}

// Empaquetado voraz por altura: mide cada nodo ya construido (ancho fijo =
// ancho de página, alto libre) y va llenando páginas sin partir nunca un
// bloque por la mitad — vale igual para bloques de ítem (con
// data-item-id, README §4.2) que para bloques de demografía (sin él). Si un
// único bloque no cupiera en una página vacía (contenido inusualmente largo),
// se le deja su propia página y se desborda en vez de intentar partirlo — un
// caso a vigilar en las pruebas reales con papel, no algo que deba resolver
// el maquetador solo. formatearTitulo(numeroPagina, totalPaginas) decide el
// texto de la cabecera de cada página resultante.
function paginarBloques(medida, nodos, formatearTitulo) {
  const altoDisponible = alturaDisponiblePorPagina(medida);
  const medidos = nodos.map((nodo) => {
    medida.appendChild(nodo);
    const alto = nodo.getBoundingClientRect().height;
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

// Construye la hoja completa: páginas de demografía seguidas de las páginas
// de ítems, en ese orden. Cada entrada del array devuelto es
// { elemento, itemIds, marcas, lineas, fiduciales }, con marcas/líneas/
// fiduciales ya medidos en coordenadas de página (0..PAGE_W, 0..PAGE_H) — lo
// que necesita tanto la impresión (los .elemento) como el muestreo al
// digitalizar (reutilizadas contra el escaneo enderezado). itemIds está
// vacío en las páginas de demografía.
export function construirHoja(items, qr) {
  const medida = crearContenedorMedida();
  try {
    const paginasDemografia = paginarBloques(medida, construirBloquesDemografia(qr), (n, total) =>
      total > 1 ? `Página de datos ${n}/${total}` : "Página de datos"
    );
    const paginasItems = paginarBloques(
      medida,
      items.map((item, i) => construirBloqueItem(item, i + 1)),
      (n, total) => `Página ${n} de ${total}`
    );
    return [...paginasDemografia, ...paginasItems];
  } finally {
    medida.remove();
  }
}

// Lee, para un elemento de página ya insertado en el DOM (con layout real),
// las coordenadas de cada marca/línea/fiducial relativas a la esquina
// superior izquierda de la propia página, en la escala PAGE_W x PAGE_H.
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
