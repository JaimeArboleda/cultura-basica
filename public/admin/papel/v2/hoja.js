// Hoja de respuestas imprimible v2 (README §4.7/§4.9): TODO se resuelve por
// OCR de letras/números en casillas individuales, en vez de burbujas OMR
// (v1, ../v1/hoja.js). Módulo puramente de maquetación — igual que v1, no
// sabe nada de fetch/estado (eso vive en ./digitalizar.js) y comparte con v1
// toda la geometría/paginado/CSS base de ../comun.js.
//
// Decisión de diseño central de v2: cada pregunta se reduce a "escribe la(s)
// letra(s)/número(s) en una casilla", con el mismo mecanismo de casillas +
// OCR que v1 ya usaba solo para 'abierto' y el año de nacimiento
// (comun.js::bloqueCasillasTexto). Motivación (frente a v1): un bloque de
// Corrección en v1 duplica ENTERA la rejilla de burbujas de la Respuesta
// (con el texto de cada opción repetido) — aquí basta una fila más de
// casillas del mismo ancho, sin repetir ningún enunciado, así que ocupa
// mucho menos espacio en ítems con muchas opciones/elementos y el propio
// mecanismo de corrección es el mismo en los 4 formatos en vez de tener una
// variante distinta por tipo de rejilla.
//
// Qué NO cambia respecto a v1: el ítem 'abierto' (la doble línea de casillas
// ya tenía sentido para texto libre, README §4.9 — se reutiliza tal cual vía
// comun.js::agregarBloqueAbierto) y el consentimiento/compromiso de
// honestidad, que se quedan como una casilla OMR simple (gesto binario, no
// "una letra entre varias", ver comun.js::marcaCuadrado).
//
// Por formato:
// - opción única: 1 casilla, se escribe la letra de la opción elegida.
// - selección múltiple: N casillas (N = nº de opciones) en una sola línea;
//   se escriben, en cualquiera de ellas, las letras de TODAS las opciones
//   elegidas (el orden/posición no importa: es un conjunto, no una
//   secuencia) — de ahí que, a diferencia de 'ordenar'/'clasificar' más
//   abajo, aquí SÍ vale recortar la línea entera como un único bloque de OCR
//   (igual que 'abierto'), en vez de una casilla por opción.
// - ordenar: cada elemento se imprime con una letra de referencia fija
//   (A, B, C...) y las POSICIONES se numeran (1 = primero, 2 = segundo...);
//   debajo de cada número de posición, una casilla donde se escribe la letra
//   del elemento que va ahí. Es más natural escribir "en qué orden van las
//   letras" que "qué número le toca a cada elemento", y así casa con
//   'clasificar' (mismo patrón: cabecera numerada fija + casilla con una
//   letra debajo) — la diferencia es que aquí las letras NO se repiten (es
//   una permutación), mientras que en 'clasificar' sí pueden repetirse
//   (varios elementos pueden compartir categoría). Cada casilla de posición
//   pertenece a una posición concreta, así que se mide y se lee de forma
//   INDEPENDIENTE (bloqueCasillasTexto con 1 sola casilla por clave), no
//   como bloque.
// - clasificar: los elementos (instancias) se numeran (1, 2, 3...) y las
//   categorías se etiquetan con letras (A, B, C...); debajo de cada número
//   de instancia, una casilla donde se escribe la letra de su categoría —
//   mismo mecanismo de casilla independiente que 'ordenar'.
import { CATALOGOS } from "../../../js/demografia.js";
import {
  agregarBloqueAbierto,
  bloqueCasillasTexto,
  COLOR_ACENTO,
  construirPaginas,
  CSS_HOJA_BASE,
  el,
  escaparHtml,
  LETRAS,
  marcaCuadrado,
} from "../comun.js";

// --- CSS específico de v2: fila de casillas individuales alineadas (para
// que N casillas de bloqueCasillasTexto(clave, 1, 1) consecutivas se vean
// como una sola tira) y su cabecera de letras/números encima. El resto
// (página, cabecera, fiduciales, QR, casillas de texto, listas etiquetadas,
// casilla cuadrada de consentimiento) viene de CSS_HOJA_BASE. ---
const CSS_HOJA_V2 = `
  .hoja-fila-casillas-individuales { display: flex; gap: 0.9mm; }
  .hoja-fila-casillas-individuales .hoja-linea-casillas { margin-bottom: 0; }
  .hoja-cabecera-casilla {
    width: 5.6mm; flex: none; border: none; background: transparent;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; font-weight: 600; color: ${COLOR_ACENTO};
  }
`;

export const CSS_HOJA = CSS_HOJA_BASE + CSS_HOJA_V2;

// Lista "A) texto" / "1) texto", una entrada por línea — para opciones y
// elementos, cuyo texto puede ser largo (a diferencia de las categorías de
// 'clasificar', ver leyendaCompacta más abajo).
function listaEtiquetada(entradas, etiquetas) {
  const filas = entradas.map((texto, i) => `<div>${escaparHtml(etiquetas[i])}) ${escaparHtml(texto)}</div>`).join("");
  return el(`<div class="hoja-lista-etiquetada">${filas}</div>`);
}

// Leyenda compacta en una sola línea "A = texto · B = texto" — para las
// categorías de 'clasificar', normalmente palabras cortas.
function leyendaCompacta(entradas, etiquetas) {
  const texto = entradas.map((e, i) => `${etiquetas[i]} = ${escaparHtml(e)}`).join(" &nbsp;·&nbsp; ");
  return el(`<div class="hoja-leyenda-categorias">${texto}</div>`);
}

// Fila de cabecera puramente visual (sin data-mark/data-linea: no se mide ni
// se lee) con una etiqueta por casilla, del mismo ancho que
// .hoja-casilla-texto para que quede alineada justo encima de la fila de
// casillas real de debajo.
function filaCabecera(etiquetas) {
  const contenedor = el(`<div class="hoja-fila-casillas-individuales"></div>`);
  for (const etiqueta of etiquetas) {
    contenedor.appendChild(el(`<span class="hoja-casilla-texto hoja-cabecera-casilla">${escaparHtml(etiqueta)}</span>`));
  }
  return contenedor;
}

// Fila de N casillas de texto INDEPENDIENTES (una clave, y por tanto una
// región medida/leída, por casilla) que se pintan juntas como una sola tira
// visual — a diferencia de bloqueCasillasTexto(clave, n, 1) a secas, que
// mide las N casillas como UN solo bloque (correcto cuando la posición
// dentro de la línea no importa, como en selección múltiple; incorrecto
// aquí, donde cada casilla pertenece a un elemento/instancia concreto y
// tiene que poder leerse aunque las demás queden en blanco).
function filaCasillasIndividuales(claves) {
  const contenedor = el(`<div class="hoja-fila-casillas-individuales"></div>`);
  for (const clave of claves) contenedor.appendChild(bloqueCasillasTexto(clave, 1, 1));
  return contenedor;
}

function claveCorreccion(item) {
  return `item:${item.id}:correccion`;
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
      bloque.appendChild(el(`<div class="hoja-instruccion">Marca UNA sola respuesta: escribe su letra en la casilla.</div>`));
      bloque.appendChild(listaEtiquetada(item.opciones, item.opciones.map((_, i) => LETRAS[i])));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
      bloque.appendChild(bloqueCasillasTexto(`item:${item.id}:opcion`, 1, 1));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`));
      bloque.appendChild(bloqueCasillasTexto(`${prefCorreccion}:opcion`, 1, 1));
      break;
    }
    case "seleccion_multiple": {
      const n = item.opciones.length;
      bloque.appendChild(
        el(`<div class="hoja-instruccion">Marca TODAS las que correspondan: escribe sus letras, una por casilla, en el orden que quieras.</div>`)
      );
      bloque.appendChild(listaEtiquetada(item.opciones, item.opciones.map((_, i) => LETRAS[i])));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
      bloque.appendChild(bloqueCasillasTexto(`item:${item.id}:seleccion`, n, 1));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`));
      bloque.appendChild(bloqueCasillasTexto(`${prefCorreccion}:seleccion`, n, 1));
      break;
    }
    case "ordenar": {
      const n = item.elementos.length;
      const letrasElementos = item.elementos.map((_, i) => LETRAS[i]);
      const posiciones = Array.from({ length: n }, (_, i) => String(i + 1));
      bloque.appendChild(
        el(`<div class="hoja-instruccion">Escribe los elementos en orden: debajo de cada número de posición (1 = primero), la letra del elemento que va ahí.</div>`)
      );
      bloque.appendChild(listaEtiquetada(item.elementos, letrasElementos));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
      bloque.appendChild(filaCabecera(posiciones));
      bloque.appendChild(filaCasillasIndividuales(posiciones.map((_, i) => `item:${item.id}:orden:${i}`)));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`));
      bloque.appendChild(filaCabecera(posiciones));
      bloque.appendChild(filaCasillasIndividuales(posiciones.map((_, i) => `${prefCorreccion}:orden:${i}`)));
      break;
    }
    case "clasificar": {
      const numerosElementos = item.elementos.map((_, i) => String(i + 1));
      bloque.appendChild(
        el(`<div class="hoja-instruccion">Escribe, debajo del número de cada elemento, la letra de su categoría.</div>`)
      );
      bloque.appendChild(leyendaCompacta(item.categorias, item.categorias.map((_, i) => LETRAS[i])));
      bloque.appendChild(listaEtiquetada(item.elementos, numerosElementos));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
      bloque.appendChild(filaCabecera(numerosElementos));
      bloque.appendChild(filaCasillasIndividuales(item.elementos.map((_, i) => `item:${item.id}:clasificar:${i}`)));
      bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Corrección (solo si te equivocaste arriba)</div>`));
      bloque.appendChild(filaCabecera(numerosElementos));
      bloque.appendChild(filaCasillasIndividuales(item.elementos.map((_, i) => `${prefCorreccion}:clasificar:${i}`)));
      break;
    }
  }
  return bloque;
}

// --- Bloques de demografía: igual reparto que v1 (README §2, §5), pero los
// 6 catálogos de opción única (sexo, ccaa...) pasan de burbuja OMR a la
// misma casilla de letra que opción_multiple, por consistencia con el resto
// de la hoja. Consentimiento/compromiso se quedan en OMR (ver cabecera del
// archivo) y el año de nacimiento sigue siendo solo dígitos, sin bloque de
// Corrección (igual que v1: un error ahí se resuelve en la revisión manual
// posterior, editarSesion.js).
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
    const valores = CATALOGOS[claveCatalogo];
    const bloque = el(`<div class="hoja-item"><div class="hoja-item-enunciado"><span>${etiqueta}</span></div></div>`);
    bloque.appendChild(listaEtiquetada(valores, valores.map((_, i) => LETRAS[i])));
    bloque.appendChild(el(`<div class="hoja-bloque-texto-titulo">Respuesta</div>`));
    bloque.appendChild(bloqueCasillasTexto(`demografia:${campo}`, 1, 1));
    bloques.push(bloque);
  }
  return bloques;
}

// Construye la hoja completa v2: misma estructura que v1 (páginas de
// demografía + páginas de ítems, medidas y paginadas por
// comun.js::construirPaginas), solo cambia cómo se pinta cada bloque.
export function construirHoja(items, qr) {
  return construirPaginas(
    construirBloquesDemografia(qr),
    items.map((item, i) => construirBloqueItem(item, i + 1)),
    CSS_HOJA
  );
}
