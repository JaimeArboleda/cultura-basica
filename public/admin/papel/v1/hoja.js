// Hoja de respuestas imprimible v1 (README §4.7/§4.9): formato OMR (casillas a
// rellenar). Módulo puramente de maquetación: construye el DOM de cada
// página (tanto para imprimir como para medir dónde cae cada marca) y no
// sabe nada de fetch/estado — eso vive en ./digitalizar.js. La geometría de
// página, el paginado y el resto de piezas que no dependen de cómo se marca
// una respuesta viven en ../comun.js, compartidas con futuras versiones.
//
// Decisión de diseño central de v1: casi todo el test se reduce a "rellena
// una burbuja" (opción múltiple, selección múltiple, y también orden/
// clasificación mediante una rejilla de burbujas por elemento) en vez de
// pedir letra manuscrita — eso convierte la mayoría de la hoja en un
// problema de OMR (umbralizado de una región conocida), sin ambigüedad de
// interpretación. Solo los ítems 'abierto' y el año de nacimiento piden
// texto, y ahí se pide MAYÚSCULAS en casillas individuales para maximizar el
// acierto de Tesseract.js (ver ./digitalizar.js).
//
// Corrección sin depender NUNCA de oscuridad relativa entre intentos: cada
// ítem imprime un bloque "Respuesta" y, más pequeño y en dos columnas, un
// bloque "Corrección" (con una casilla "no responder" incluida). Si el
// bloque de Corrección tiene cualquier marca, ./digitalizar.js lo usa entero
// y descarta el de Respuesta — nunca se decide comparando qué tan oscura
// está una marca frente a otra. El año de nacimiento, en cambio, NO lleva
// bloque de Corrección: un error ahí se corrige en la revisión manual
// posterior (editarSesion.js), igual que el resto de demografía.
//
// Las mismas funciones que construyen el DOM para imprimir se usan para medir
// (getBoundingClientRect) dónde cae cada marca en la página en blanco: así el
// pipeline de digitalización sabe exactamente qué región de la foto ya
// enderezada corresponde a cada burbuja/casilla, sin tener que detectarlas por
// visión artificial.
import { CATALOGOS } from "../../../js/demografia.js";
import {
  agregarBloqueAbierto,
  bloqueCasillasTexto,
  construirPaginas,
  CSS_HOJA_BASE,
  el,
  escaparHtml,
  LETRAS,
  marcaCuadrado,
  rellenarQrPaginas,
} from "../comun.js";

// --- CSS específico de v1: cómo se pintan las burbujas OMR y su bloque de
// corrección en dos columnas. El resto (página, cabecera, fiduciales, QR,
// casillas de texto, casilla cuadrada de consentimiento) viene de
// CSS_HOJA_BASE. ---
const CSS_HOJA_V1 = `
  .hoja-marca-circulo {
    width: 3.6mm; height: 3.6mm; border: 0.4mm solid #111; flex: none; background: #fff;
    border-radius: 50%;
  }

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
`;

export const CSS_HOJA = CSS_HOJA_BASE + CSS_HOJA_V1;

function marcaCirculo(clave, etiquetaHtml) {
  return el(`
    <label class="hoja-fila-opcion">
      <span class="hoja-marca-circulo" data-mark="${clave}"></span>
      <span>${etiquetaHtml}</span>
    </label>`);
}

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
      agregarBloqueAbierto(bloque, `item:${item.id}:abierto`, `${prefCorreccion}:abierto`);
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
// falta con el mismo empaquetado voraz que los ítems (construirPaginas). No
// llevan bloque de Corrección duplicado (a diferencia de los ítems del
// test): son datos de contexto, no el objeto de medida del estudio, y
// duplicar aquí también los ~57 valores de los catálogos multiplicaría el
// tamaño de estas páginas sin aportar tanto. El año de nacimiento tampoco
// lleva Corrección: un error ahí se resuelve en la revisión manual
// posterior, igual que el resto de demografía.
// qr: { tokenId } opcional (README §4.9/§4.10) — si se pasa, la hoja incluye
// una caja para el QR grande (token de la remesa + versión + exam_id) como
// primer bloque de la página 1, para que ./digitalizar.js pueda leerlo solo
// al escanear en vez de que el admin tenga que elegir la remesa a mano. La
// imagen en sí se rellena DESPUÉS de paginar (construirHoja más abajo,
// vía comun.js::rellenarQrPaginas) porque el payload necesita saber en qué
// página global cae cada cosa, algo que solo se conoce una vez paginado.
function construirBloquesDemografia(qr) {
  const bloques = [];
  if (qr?.tokenId) {
    bloques.push(
      el(`
        <div class="hoja-item hoja-qr">
          <div class="hoja-qr-caja" data-linea="meta:qr">
            <img alt="Código QR de la remesa" class="hoja-qr-img" />
          </div>
          <div>
            <div class="hoja-item-enunciado"><span>Código de la remesa</span></div>
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
  anio.appendChild(bloqueCasillasTexto("demografia:anio_nacimiento", 4, 1));

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

// Construye la hoja completa v1: páginas de demografía seguidas de las
// páginas de ítems, en ese orden. Cada entrada del array devuelto es
// { elemento, itemIds, marcas, lineas, fiduciales, numeroPagina, totalPaginas },
// con marcas/líneas/fiduciales ya medidos en coordenadas de página
// (0..PAGE_W, 0..PAGE_H) — lo que necesita tanto la impresión (los
// .elemento) como el muestreo al digitalizar. itemIds está vacío en las
// páginas de demografía.
//
// qr: { tokenId, examId, version } opcional (README §4.9/§4.10) — si se
// pasa, además de token+versión, esta hoja recibe un exam_id (identificador
// individual de ESTA hoja física, distinto de la remesa) y cada página
// recibe su propio QR pequeño con {exam_id, número de página} — necesario
// para la subida en bloque, README §4.10. Async porque rellenarQrPaginas usa
// generarQrDataUrl (carga qrcode-generator bajo demanda). Cuando se llama
// sin qr (../digitalizar.js al reconstruir el layout para digitalizar, no
// para imprimir) no se genera ningún QR y la función es efectivamente
// inmediata.
export async function construirHoja(items, qr) {
  const paginas = construirPaginas(
    construirBloquesDemografia(qr),
    items.map((item, i) => construirBloqueItem(item, i + 1)),
    CSS_HOJA
  );
  if (qr?.examId) await rellenarQrPaginas(paginas, qr);
  return paginas;
}
