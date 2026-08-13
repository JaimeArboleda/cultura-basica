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
// Las mismas funciones que construyen el DOM para imprimir se usan para medir
// (getBoundingClientRect) dónde cae cada marca en la página en blanco: así el
// pipeline de digitalización sabe exactamente qué región de la foto ya
// enderezada corresponde a cada burbuja/casilla, sin tener que detectarlas por
// visión artificial.
import { CATALOGOS } from "../js/demografia.js";

// A4 a 96dpi "CSS px" (constante del propio spec de CSS: 1mm = 96/25.4px,
// siempre, independiente de la resolución real de la impresora/escáner —
// tanto al imprimir como al medir el DOM de referencia se parte de esta
// misma escala).
const PX_POR_MM = 96 / 25.4;
const PAGINA_PADDING_MM = 10; // ver ".hoja-pagina { padding: 10mm }" en CSS_HOJA
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

export const CSS_HOJA = `
  .hoja-pagina {
    width: ${PAGE_W_MM}mm;
    height: ${PAGE_H_MM}mm;
    box-sizing: border-box;
    padding: 10mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #000;
    background: #fff;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }
  .hoja-cabecera {
    display: flex;
    justify-content: space-between;
    border-bottom: 1.5px solid #000;
    padding-bottom: 3mm;
    margin-bottom: 4mm;
    font-size: 10px;
  }
  .hoja-cabecera strong { font-size: 13px; }
  .hoja-item { margin-bottom: 4mm; }
  .hoja-item-enunciado { font-weight: bold; margin-bottom: 1.5mm; }
  .hoja-item-numero { display: inline-block; min-width: 6mm; }
  .hoja-item-texto { font-style: italic; font-size: 10px; margin: 1mm 0 2mm; white-space: pre-wrap; }
  .hoja-fila-opcion { display: flex; align-items: center; gap: 2mm; margin: 0.8mm 0; }
  .hoja-marca-circulo, .hoja-marca-cuadrado {
    width: 3.6mm; height: 3.6mm; border: 0.4mm solid #000; flex: none;
  }
  .hoja-marca-circulo { border-radius: 50%; }
  .hoja-fila-elemento { display: flex; align-items: center; gap: 2mm; margin: 0.8mm 0; flex-wrap: wrap; }
  .hoja-elemento-etiqueta { min-width: 30mm; }
  .hoja-grid-burbujas { display: flex; gap: 1.5mm; }
  .hoja-burbuja-cel { display: flex; flex-direction: column; align-items: center; gap: 0.5mm; }
  .hoja-burbuja-cel-etiqueta { font-size: 8px; }
  .hoja-leyenda { font-size: 9px; color: #333; margin-bottom: 1.5mm; }
  .hoja-linea-casillas { display: flex; gap: 1mm; }
  .hoja-casilla-texto {
    width: 6mm; height: 7mm; border: 0.35mm solid #000; flex: none;
  }
  .hoja-nota-mayusculas { font-size: 9px; color: #333; margin-bottom: 1mm; }
`;

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
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

function filaCasillasTexto(clave, n) {
  const casillas = Array.from({ length: n }, () => `<span class="hoja-casilla-texto"></span>`).join("");
  return el(`<div class="hoja-linea-casillas" data-linea="${clave}">${casillas}</div>`);
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

// --- Bloque de un ítem (README §4.2: un formato distinto por tipo) ---

export function construirBloqueItem(item, numero) {
  const bloque = el(`<div class="hoja-item" data-item-id="${item.id}"></div>`);
  const enunciado = el(
    `<div class="hoja-item-enunciado"><span class="hoja-item-numero">${numero}.</span> ${escaparHtml(item.enunciado)}</div>`
  );
  bloque.appendChild(enunciado);

  if (item.texto) {
    bloque.appendChild(el(`<div class="hoja-item-texto">${escaparHtml(item.texto)}</div>`));
  }

  switch (item.formato) {
    case "abierto": {
      bloque.appendChild(el(`<div class="hoja-nota-mayusculas">Escribe en MAYÚSCULAS, una letra por casilla.</div>`));
      bloque.appendChild(filaCasillasTexto(`item:${item.id}:abierto`, 18));
      break;
    }
    case "opcion_multiple": {
      item.opciones.forEach((opcion, i) => {
        bloque.appendChild(
          marcaCirculo(`item:${item.id}:opcion:${i}`, `${LETRAS[i]}) ${escaparHtml(opcion)}`)
        );
      });
      break;
    }
    case "seleccion_multiple": {
      bloque.appendChild(el(`<div class="hoja-leyenda">Marca todas las que correspondan.</div>`));
      item.opciones.forEach((opcion, i) => {
        bloque.appendChild(
          marcaCuadrado(`item:${item.id}:opcion:${i}`, `${LETRAS[i]}) ${escaparHtml(opcion)}`)
        );
      });
      break;
    }
    case "ordenar": {
      const n = item.elementos.length;
      bloque.appendChild(
        el(`<div class="hoja-leyenda">Para cada elemento, rellena la burbuja de la posición que le corresponde (1 = más antiguo/primero).</div>`)
      );
      item.elementos.forEach((elemento, i) => {
        const claves = Array.from({ length: n }, (_, pos) => `item:${item.id}:orden:${i}:${pos}`);
        const etiquetas = Array.from({ length: n }, (_, pos) => String(pos + 1));
        bloque.appendChild(filaElementoConBurbujas(escaparHtml(elemento), claves, etiquetas));
      });
      break;
    }
    case "clasificar": {
      bloque.appendChild(el(`<div class="hoja-leyenda">Para cada elemento, rellena la burbuja de su categoría.</div>`));
      item.categorias.forEach((cat, i) => {
        bloque.appendChild(el(`<div class="hoja-burbuja-cel-etiqueta">${LETRAS[i]} = ${escaparHtml(cat)}</div>`));
      });
      item.elementos.forEach((elemento, i) => {
        const claves = item.categorias.map((_, catIdx) => `item:${item.id}:clasificar:${i}:${catIdx}`);
        const etiquetas = item.categorias.map((_, catIdx) => LETRAS[catIdx]);
        bloque.appendChild(filaElementoConBurbujas(escaparHtml(elemento), claves, etiquetas));
      });
      break;
    }
  }
  return bloque;
}

function escaparHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

// --- Bloques de demografía: consentimiento + compromiso de honestidad +
// datos demográficos (README §2, §5) --- igual que la pantalla previa al
// test en la web, pero en papel son las primeras páginas de la hoja, también
// resueltas con burbujas salvo el año de nacimiento (4 casillas de dígito,
// OCR con Tesseract.js). Cada catálogo es su propio bloque "empaquetable":
// con 7 campos + ~57 valores en total no cabe en una sola página A4 a un
// tamaño de letra legible, así que se reparte en tantas páginas como haga
// falta con el mismo empaquetado voraz que los ítems (paginarBloques).
function construirBloquesDemografia() {
  const consentimiento = el(`<div class="hoja-item"><div class="hoja-item-enunciado">Consentimiento y compromiso</div></div>`);
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

  const anio = el(`<div class="hoja-item"><div class="hoja-item-enunciado">Año de nacimiento</div></div>`);
  anio.appendChild(el(`<div class="hoja-leyenda">4 dígitos, en MAYÚSCULAS/números de imprenta:</div>`));
  anio.appendChild(filaCasillasTexto("demografia:anio_nacimiento", 4));

  const bloques = [consentimiento, anio];

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
    const bloque = el(`<div class="hoja-item"><div class="hoja-item-enunciado">${etiqueta}</div></div>`);
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
// total de página menos el padding vertical (10mm arriba + 10mm abajo,
// ".hoja-pagina" en CSS_HOJA), menos la cabecera, menos un margen de
// seguridad para no pegar el último bloque al borde inferior.
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
// { elemento, itemIds, marcas, lineas }, con marcas y líneas ya medidas en
// coordenadas de página (0..PAGE_W, 0..PAGE_H) — lo que necesita tanto la
// impresión (los .elemento) como el muestreo al digitalizar (marcas/lineas,
// reutilizadas contra el escaneo enderezado). itemIds está vacío en las
// páginas de demografía.
export function construirHoja(items) {
  const medida = crearContenedorMedida();
  try {
    const paginasDemografia = paginarBloques(medida, construirBloquesDemografia(), (n, total) =>
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
// las coordenadas de cada marca/línea relativas a la esquina superior
// izquierda de la propia página, en la escala PAGE_W x PAGE_H.
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
  return { marcas, lineas };
}
