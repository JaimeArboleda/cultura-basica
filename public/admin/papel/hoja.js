// Generador de la hoja de respuestas en papel (README §4.7/§4.9), reescrito
// sobre pdf-lib: construye el PDF directamente por aritmética de métricas de
// fuente reales (font.widthOfTextAtSize), sin DOM, sin `window.print()` y sin
// depender de ningún motor de renderizado del navegador — el mismo PDF sale
// byte a byte igual en Node, en Chrome, en Firefox o en cualquier
// dispositivo. Sustituye a la v2 anterior (maquetado HTML/CSS + medición con
// getBoundingClientRect + `data/build-paginacion.mjs` precalculado con
// Playwright, ya retirados) y a v1 (burbujas OMR, retirada del todo).
//
// Este módulo NO importa pdf-lib/fontkit directamente (evita un import
// "desnudo" que no resolvería en el navegador sin bundler, mismo motivo que
// el resto de public/admin/papel/*.js con CDNs): recibe ambos ya cargados —
// crearContextoFuentes(PDFLib, fontkit, ...) — así funciona igual desde el
// panel de admin (carga por CDN, ver comun.js) que desde un script Node
// (ocr_tests/, import normal de los paquetes npm).
import { CATALOGOS } from "../../js/demografia.js";
import {
  cajaQrGrande,
  cajaQrPagina,
  CABECERA_ALTO_MM,
  FIDUCIAL_INSET_MM,
  FIDUCIAL_SIZE_MM,
  PADDING_MM,
  PAGE_H_MM,
  PAGE_W_MM,
  PX_POR_MM,
  QR_GRANDE_SIZE_MM,
  QR_PAGINA_SIZE_MM,
} from "./geometria.js";
import { altoLineaPt, distribuirEnRejilla, elegirColumnas, envolverTexto, mmAPt } from "./pdfLayout.js";
import { codificarPayloadQr, codificarPayloadQrPagina, generarMatrizQr, matrizQrAPng } from "./qr.js";

// v1 = burbujas OMR, v2 = casillas de letra + Tesseract/OCR-IA, v3 = pdf-lib +
// 100% OCR-IA, v4 = este (mismo v3, pero el payload del QR de página pasa de
// JSON a un string compacto "examId:pagina" — README §4.9, para que quepa en
// una versión de QR más pequeña y el módulo impreso salga más grande a igual
// tamaño físico) — se sigue guardando en sesiones.version_papel para poder
// distinguir en el dataset de qué diseño de hoja viene cada sesión si se
// vuelve a rediseñar en el futuro, aunque hoy solo exista un pipeline activo.
export const VERSION_PIPELINE = 4;

export const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const CONFIG_POR_DEFECTO = {
  tamanoTextoPt: 8.5,
  tamanoInstruccionPt: 7,
  tamanoEnunciadoPt: 8.5,
  maxColumnas: 3,
  // "casillas": una letra/dígito por casilla (fuerza mayúsculas de imprenta,
  // más fácil de leer para el modelo pero ocupa más alto). "linea": una raya
  // para escribir en natural, más compacta — el modelo de visión ya no
  // necesita la disciplina de una letra por casilla como la necesitaba
  // Tesseract (README §4.7).
  estiloAbierto: "casillas",
  casillasAbierto: 18,
};

const PAGE_W_PT = mmAPt(PAGE_W_MM);
const PAGE_H_PT = mmAPt(PAGE_H_MM);
const PADDING_PT = mmAPt(PADDING_MM);
const CABECERA_ALTO_PT = mmAPt(CABECERA_ALTO_MM);
const ANCHO_CONTENIDO_PT = PAGE_W_PT - 2 * PADDING_PT;
// El QR de página (README §4.9) va centrado abajo, pegado al margen inferior,
// en TODAS las páginas: se reserva su alto + un pequeño hueco de separación
// para que el flujo de contenido nunca lo invada, sea cual sea la altura que
// ocupe el último bloque de esa página.
const GAP_QR_PAGINA_PT = mmAPt(3);
const ALTURA_RESERVA_QR_PAGINA_PT = mmAPt(QR_PAGINA_SIZE_MM) + GAP_QR_PAGINA_PT;
// Contenido: desde el final de la cabecera (que ya empieza tras el margen
// superior, PADDING_MM) hasta el margen inferior, menos la reserva del QR de
// página — así el margen es PADDING_MM en los 4 lados a la vez (arriba, abajo,
// izquierda y derecha), simétrico.
const ALTURA_DISPONIBLE_PT = PAGE_H_PT - 2 * PADDING_PT - CABECERA_ALTO_PT - ALTURA_RESERVA_QR_PAGINA_PT;
// La página 1 de la sección de demografía reserva además el hueco del QR
// grande (fijo, README §4.9) antes de que empiece el flujo de bloques.
const ALTURA_QR_GRANDE_PT = mmAPt(QR_GRANDE_SIZE_MM + 3);

const CASILLA_W_PT = mmAPt(5.4);
const CASILLA_H_PT = mmAPt(6.2);
const CASILLA_GAP_PT = mmAPt(0.8);
const CASILLA_BORDE_PT = mmAPt(0.35);
const GAP_COLUMNAS_PT = mmAPt(4);

// Separación entre las columnas "Respuesta"/"Corrección" cuando van lado a
// lado (construirBloqueCasillasDoble): el equivalente a 2 casillas, para que
// se lean claramente como dos bloques distintos y no como una fila continua
// de casillas. Misma separación para TODOS los formatos que usan este
// layout (opción única, selección múltiple, ordenar, clasificar) — así el
// hueco entre Respuesta y Corrección no cambia de un formato a otro.
const GAP_DOBLE_CORRECCION_PT = 2 * (CASILLA_W_PT + CASILLA_GAP_PT);

// Columna reservada para el QR grande + la etiqueta con el token_id, en la
// cabecera de la página 1 — ancho fijo (en vez de "todo lo que sobre", como
// antes) para dejar sitio a las instrucciones generales de al lado, a la
// derecha (ver construirInstruccionesGenerales).
const ANCHO_ETIQUETA_TOKEN_PT = mmAPt(55);
const GAP_INSTRUCCIONES_PT = mmAPt(8);

// Apila sub-bloques verticalmente: la primitiva compositiva de todo este
// módulo — cada builder de más abajo devuelve {altoPt, dibujar(...)} y esta
// función los combina en uno solo del mismo tipo, así un bloque de ítem es
// "apilar(enunciado, instrucción, opciones, respuesta, corrección)" sin que
// cada builder necesite saber nada de sus vecinos.
function apilar(subBloques, margenInferiorPt = 0) {
  const altoPt = subBloques.reduce((s, b) => s + b.altoPt, 0) + margenInferiorPt;
  return {
    altoPt,
    dibujar(lienzo, xPt, yTopPt) {
      let y = yTopPt;
      for (const b of subBloques) {
        b.dibujar(lienzo, xPt, y);
        y += b.altoPt;
      }
    },
  };
}

function bloqueVacio() {
  return { altoPt: 0, dibujar() {} };
}

export async function crearContextoFuentes(PDFLib, fontkit, UPNG, qrGenLib, fontRegularBytes, fontBoldBytes) {
  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontRegular = await pdfDoc.embedFont(fontRegularBytes, { subset: true });
  const fontBold = await pdfDoc.embedFont(fontBoldBytes, { subset: true });
  return {
    PDFLib,
    pdfDoc,
    fontRegular,
    fontBold,
    UPNG,
    qrGenLib,
    colorAcento: PDFLib.rgb(0x2b / 255, 0x4c / 255, 0x7e / 255),
    colorTexto: PDFLib.rgb(0.07, 0.07, 0.07),
    colorTextoSuave: PDFLib.rgb(0.33, 0.33, 0.33),
    colorNegro: PDFLib.rgb(0, 0, 0),
    colorGris: PDFLib.rgb(0.6, 0.6, 0.6),
  };
}

// "Lienzo": traduce el sistema de coordenadas de este módulo (x/yTop desde la
// esquina superior izquierda de la PÁGINA, y creciendo hacia abajo, igual que
// el CSS/DOM del diseño anterior) al de pdf-lib (origen abajo-izquierda,
// y creciendo hacia arriba) — así el resto del código nunca tiene que pensar
// en el flip, solo en "esto va a tantos puntos del borde superior".
function crearLienzo(ctx, page) {
  return {
    texto(xPt, yTopPt, texto, { font, tamanoPt, color }) {
      page.drawText(texto, {
        x: xPt,
        y: PAGE_H_PT - yTopPt - tamanoPt * 0.82,
        size: tamanoPt,
        font: font ?? ctx.fontRegular,
        color: color ?? ctx.colorTexto,
      });
    },
    textoCentrado(cxPt, yTopPt, texto, opts) {
      const ancho = (opts.font ?? ctx.fontRegular).widthOfTextAtSize(texto, opts.tamanoPt);
      this.texto(cxPt - ancho / 2, yTopPt, texto, opts);
    },
    rect(xPt, yTopPt, wPt, hPt, opts = {}) {
      page.drawRectangle({ x: xPt, y: PAGE_H_PT - yTopPt - hPt, width: wPt, height: hPt, ...opts });
    },
    circulo(cxPt, cyTopPt, radioPt, opts) {
      page.drawCircle({ x: cxPt, y: PAGE_H_PT - cyTopPt, size: radioPt, ...opts });
    },
    linea(x1, y1Top, x2, y2Top, opts) {
      page.drawLine({ start: { x: x1, y: PAGE_H_PT - y1Top }, end: { x: x2, y: PAGE_H_PT - y2Top }, ...opts });
    },
    async imagenQr(xPt, yTopPt, ladoPt, texto) {
      const modulos = await generarMatrizQr(texto, ctx.qrGenLib);
      const png = await matrizQrAPng(modulos, 6, ctx.UPNG);
      const embebida = await ctx.pdfDoc.embedPng(png);
      page.drawImage(embebida, { x: xPt, y: PAGE_H_PT - yTopPt - ladoPt, width: ladoPt, height: ladoPt });
    },
  };
}

// ============================================================
// Sub-bloques de texto/instrucción
// ============================================================

function construirParrafo(ctx, texto, tamanoPt, anchoPt, { negrita = false, color, margenInferiorPt = 0 } = {}) {
  const font = negrita ? ctx.fontBold : ctx.fontRegular;
  const lineas = envolverTexto(font, tamanoPt, texto, anchoPt);
  const altoLinea = altoLineaPt(tamanoPt);
  return {
    altoPt: lineas.length * altoLinea + margenInferiorPt,
    dibujar(lienzo, xPt, yTopPt) {
      lineas.forEach((linea, i) => lienzo.texto(xPt, yTopPt + i * altoLinea, linea, { font, tamanoPt, color }));
    },
  };
}

function construirInstruccion(ctx, texto, anchoPt, config) {
  return construirParrafo(ctx, texto, config.tamanoInstruccionPt, anchoPt, {
    negrita: true,
    color: ctx.colorAcento,
    margenInferiorPt: mmAPt(1),
  });
}

function construirTitulo(ctx, texto, anchoPt, config) {
  return construirParrafo(ctx, texto, config.tamanoEnunciadoPt, anchoPt, { negrita: true, margenInferiorPt: mmAPt(0.5) });
}

// Enunciado numerado: círculo con el número + texto en negrita, con sangría
// francesa (todas las líneas alineadas con el texto, no con el círculo).
function construirEnunciado(ctx, numero, texto, anchoPt, config) {
  const DIAM_PT = mmAPt(5.5);
  const GAP_PT = mmAPt(1.8);
  const anchoTexto = anchoPt - DIAM_PT - GAP_PT;
  const tamanoPt = config.tamanoEnunciadoPt;
  const font = ctx.fontBold;
  const lineas = envolverTexto(font, tamanoPt, texto, anchoTexto);
  const altoLinea = altoLineaPt(tamanoPt);
  const alturaTexto = lineas.length * altoLinea;
  // Mismo criterio de centrado óptico que el número dentro del círculo (más
  // abajo: centro - tamanoPt*0.36): antes la primera línea se centraba según
  // la ALTURA DE LÍNEA tipográfica (factor ~0.64), no según ese mismo
  // criterio óptico — quedaban a un nivel ligeramente distinto (bug real,
  // número y primera línea del enunciado a distinta altura). Con la misma
  // fórmula para los dos, quedan al mismo nivel.
  const offsetTextoPt = Math.max(0, DIAM_PT / 2 - tamanoPt * 0.36);
  const numeroTxt = String(numero);
  return {
    altoPt: Math.max(offsetTextoPt + alturaTexto, DIAM_PT) + mmAPt(1.5),
    dibujar(lienzo, xPt, yTopPt) {
      lienzo.circulo(xPt + DIAM_PT / 2, yTopPt + DIAM_PT / 2, DIAM_PT / 2, { color: ctx.colorAcento });
      const tamNumero = 7.5;
      lienzo.textoCentrado(xPt + DIAM_PT / 2, yTopPt + DIAM_PT / 2 - tamNumero * 0.36, numeroTxt, {
        font: ctx.fontBold,
        tamanoPt: tamNumero,
        color: ctx.PDFLib.rgb(1, 1, 1),
      });
      lineas.forEach((linea, i) =>
        lienzo.texto(xPt + DIAM_PT + GAP_PT, yTopPt + offsetTextoPt + i * altoLinea, linea, { font, tamanoPt })
      );
    },
  };
}

// Pasaje de texto (tipo comentario_texto): tamaño algo menor + regla vertical
// a la izquierda, en vez de cursiva (no hay variante itálica incrustada).
function construirPasaje(ctx, texto, anchoPt, config) {
  const tamanoPt = config.tamanoTextoPt - 0.5;
  const MARGEN_IZQ_PT = mmAPt(2.5);
  const parrafos = texto.split("\n\n");
  const bloques = parrafos.map((p, i) =>
    construirParrafo(ctx, p, tamanoPt, anchoPt - MARGEN_IZQ_PT, {
      color: ctx.colorTextoSuave,
      margenInferiorPt: i < parrafos.length - 1 ? mmAPt(1.5) : 0,
    })
  );
  const interior = apilar(bloques, mmAPt(2));
  return {
    altoPt: interior.altoPt,
    dibujar(lienzo, xPt, yTopPt) {
      lienzo.linea(xPt, yTopPt, xPt, yTopPt + interior.altoPt, { thickness: mmAPt(0.5), color: ctx.colorGris });
      interior.dibujar(lienzo, xPt + MARGEN_IZQ_PT, yTopPt);
    },
  };
}

// ============================================================
// Lista de opciones/elementos etiquetados (A) texto / 1) texto): multi-
// columna cuando la longitud máxima lo permite (elegirColumnas, pdfLayout.js)
// — el propio banco de ítems real fue el que fijó los umbrales por defecto.
// ============================================================

function construirListaEtiquetada(ctx, entradas, etiquetas, anchoPt, config) {
  const tamanoPt = config.tamanoTextoPt;
  const font = ctx.fontRegular;
  const textos = entradas.map((e, i) => `${etiquetas[i]}) ${e}`);
  const nCols = elegirColumnas(font, tamanoPt, textos, anchoPt, { maxColumnas: config.maxColumnas, gapPt: GAP_COLUMNAS_PT });
  const altoLinea = altoLineaPt(tamanoPt);

  if (nCols === 1) {
    const lineasPorEntrada = textos.map((t) => envolverTexto(font, tamanoPt, t, anchoPt));
    return {
      altoPt: lineasPorEntrada.reduce((s, l) => s + l.length * altoLinea, 0),
      dibujar(lienzo, xPt, yTopPt) {
        let y = yTopPt;
        for (const lineas of lineasPorEntrada) {
          for (const linea of lineas) {
            lienzo.texto(xPt, y, linea, { font, tamanoPt });
            y += altoLinea;
          }
        }
      },
    };
  }

  const { filas, anchoColPt } = distribuirEnRejilla(textos, nCols, anchoPt, GAP_COLUMNAS_PT);
  return {
    altoPt: filas.length * altoLinea,
    dibujar(lienzo, xPt, yTopPt) {
      filas.forEach((fila, fi) => {
        fila.forEach((celda) => {
          lienzo.texto(xPt + celda.col * (anchoColPt + GAP_COLUMNAS_PT), yTopPt + fi * altoLinea, celda.texto, { font, tamanoPt });
        });
      });
    },
  };
}

// Leyenda compacta en una sola línea "A = texto · B = texto" (categorías de
// 'clasificar', normalmente palabras cortas).
function construirLeyendaCompacta(ctx, entradas, etiquetas, anchoPt, config) {
  const texto = entradas.map((e, i) => `${etiquetas[i]} = ${e}`).join("   ·   ");
  return construirParrafo(ctx, texto, config.tamanoInstruccionPt + 0.5, anchoPt, {
    color: ctx.colorTextoSuave,
    margenInferiorPt: mmAPt(1),
  });
}

// ============================================================
// Casillas de respuesta
// ============================================================

// Fila de `n` casillas idénticas, con una cabecera opcional (letra o número
// de referencia) encima de cada una — usada tanto para una única casilla
// (opción única) como para una fila entera (selección múltiple, año de
// nacimiento) o una rejilla de posiciones/instancias (ordenar/clasificar).
// Dibuja `texto` centrado dentro de una casilla, con la fuente/color de tinta
// sintética (ctx.fontInk/ctx.colorInk, ver crearContextoFuentes) — solo lo
// usan los generadores de fixtures de prueba (ocr_tests/), nunca la hoja real
// que se imprime para rellenar a mano. Cae a fontRegular si no hay fontInk
// (sigue siendo útil sin una fuente de "letra manuscrita" concreta).
function dibujarInk(lienzo, ctx, texto, xCasillaPt, yCasillaPt, tamanoPt = 9) {
  if (!texto) return;
  const font = ctx.fontInk ?? ctx.fontRegular;
  const color = ctx.colorInk ?? ctx.colorNegro;
  const ancho = font.widthOfTextAtSize(texto, tamanoPt);
  const x = xCasillaPt + (CASILLA_W_PT - ancho) / 2;
  const y = yCasillaPt + CASILLA_H_PT / 2 - tamanoPt * 0.36;
  lienzo.texto(x, y, texto, { font, tamanoPt, color });
}

// Fila de `n` casillas idénticas, con una cabecera opcional (letra o número
// de referencia) encima de cada una — usada tanto para una única casilla
// (opción única) como para una fila entera (selección múltiple, año de
// nacimiento) o una rejilla de posiciones/instancias (ordenar/clasificar).
// valores (opcional, longitud n, ocr_tests/ únicamente): texto de tinta
// sintética a dibujar en la casilla i-ésima, o null/undefined para dejarla
// en blanco.
// anchoPt determina cuántas casillas caben por fila — si n las excede, se
// envuelve a varias filas (necesario para respuestas abiertas largas, ver
// construirBloqueItem: un ítem con respuesta_canonica larga pide más
// casillas de las que caben en una sola línea). El resto de formatos
// (opción/selección/ordenar/clasificar/año) nunca llegan a necesitarlo — n
// ahí es como mucho el nº de opciones u elementos del ítem (≤26 letras),
// siempre cabe en una fila — pero la función es genérica por si acaso.
// Nº de casillas que caben en una sola fila del ancho dado, sin desbordar el
// margen (usado tanto para decidir el ajuste de "abierto" más abajo como
// dentro de construirFilaCasillas).
function casillasPorFila(anchoPt) {
  return Math.max(1, Math.floor((anchoPt + CASILLA_GAP_PT) / (CASILLA_W_PT + CASILLA_GAP_PT)));
}

// Ajusta el nº de casillas de una respuesta "abierta" para que cada fila
// llegue siempre hasta el margen y todas las filas tengan el MISMO nº de
// casillas: una respuesta de una sola línea antes se quedaba con solo las
// casillas mínimas necesarias (hueco sin usar hasta el margen); una de dos
// líneas repartía el resto en una segunda fila más corta que la primera
// (asimétrico). Redondea `n` hacia arriba al múltiplo de `casillasPorFila`
// más cercano, así todas las filas quedan completas y de igual tamaño.
function casillasAbiertoAjustadas(n, anchoPt) {
  const porFila = casillasPorFila(anchoPt);
  const numFilas = Math.max(1, Math.ceil(n / porFila));
  return porFila * numFilas;
}

// posicionCasilla: geometría compartida entre dibujar() y casillas() — misma
// aritmética, una sola vez (issue #35: la lectura necesita las mismas
// coordenadas que la impresión, nunca una segunda fuente de verdad).
function construirFilaCasillas(ctx, n, anchoPt, { etiquetasCabecera, valores } = {}) {
  const porFila = casillasPorFila(anchoPt);
  const numFilas = Math.ceil(n / porFila);
  const altoCabecera = etiquetasCabecera ? altoLineaPt(6) : 0;
  const altoFila = altoCabecera + CASILLA_H_PT;
  const gapEntreFilas = mmAPt(1.5);
  function posicionCasilla(i, xPt, yTopPt) {
    const fila = Math.floor(i / porFila);
    const col = i % porFila;
    const x = xPt + col * (CASILLA_W_PT + CASILLA_GAP_PT);
    const yFila = yTopPt + fila * (altoFila + gapEntreFilas);
    return { x, yFila };
  }
  return {
    altoPt: numFilas * altoFila + (numFilas - 1) * gapEntreFilas,
    dibujar(lienzo, xPt, yTopPt) {
      for (let i = 0; i < n; i++) {
        const { x, yFila } = posicionCasilla(i, xPt, yTopPt);
        if (etiquetasCabecera) {
          lienzo.textoCentrado(x + CASILLA_W_PT / 2, yFila, etiquetasCabecera[i], {
            font: ctx.fontBold,
            tamanoPt: 6,
            color: ctx.colorAcento,
          });
        }
        lienzo.rect(x, yFila + altoCabecera, CASILLA_W_PT, CASILLA_H_PT, {
          borderColor: ctx.colorNegro,
          borderWidth: CASILLA_BORDE_PT,
        });
        dibujarInk(lienzo, ctx, valores?.[i], x, yFila + altoCabecera);
      }
    },
    // Geometría de cada casilla en pt absolutos (mismo sistema de coordenadas
    // que dibujar: origen arriba-izquierda de la PÁGINA), reutilizable al leer
    // (calcularGeometriaCasillas más abajo) sin tener que generar ningún PDF.
    casillas(xPt, yTopPt) {
      const resultado = [];
      for (let i = 0; i < n; i++) {
        const { x, yFila } = posicionCasilla(i, xPt, yTopPt);
        resultado.push({ xPt: x, yTopPt: yFila + altoCabecera, wPt: CASILLA_W_PT, hPt: CASILLA_H_PT, posicion: i });
      }
      return resultado;
    },
  };
}

// Bloque "Respuesta"/"Corrección" con etiqueta + fila de casillas — usado por
// todos los formatos salvo 'abierto' (que tiene su propio estilo, ver abajo).
function construirBloqueCasillas(ctx, etiqueta, n, anchoPt, config, opts) {
  const titulo = construirParrafo(ctx, etiqueta, config.tamanoInstruccionPt, anchoPt, {
    color: ctx.colorTextoSuave,
    margenInferiorPt: mmAPt(0.6),
  });
  const fila = construirFilaCasillas(ctx, n, anchoPt, opts);
  return {
    ...apilar([titulo, fila], mmAPt(1.5)),
    // apilar([titulo, fila]) coloca fila justo debajo de titulo, sin hueco
    // entre ambos (el margen de apilar se aplica DESPUÉS de fila) — por eso
    // el offset de fila es exactamente titulo.altoPt.
    casillas(xPt, yTopPt) {
      return fila.casillas(xPt, yTopPt + titulo.altoPt);
    },
  };
}

// Como construirBloqueCasillas, pero dos bloques de UNA sola casilla cada
// uno, lado a lado en vez de apilados — usado por "opción única" (item.js,
// formato opcion_multiple): con una sola casilla por bloque, apilar
// "Respuesta" encima de "Corrección" gasta el doble de alto del que hace
// falta; puestos en la misma fila, ocupan la misma altura que un solo bloque.
// n casillas por lado (no solo 1): usado por opción única (n=1), selección
// múltiple, ordenar y clasificar — todos salvo "abierto" (que sigue apilado,
// tiene demasiadas casillas para caber lado a lado sin envolver). opts
// admite etiquetasCabecera (posiciones/números de ordenar y clasificar), la
// misma para ambos lados.
function construirBloqueCasillasDoble(ctx, etiquetaIzq, etiquetaDer, n, anchoPt, config, { valoresIzq, valoresDer, etiquetasCabecera } = {}) {
  const anchoMitad = (anchoPt - GAP_DOBLE_CORRECCION_PT) / 2;
  const bloqueIzq = construirBloqueCasillas(ctx, etiquetaIzq, n, anchoMitad, config, { valores: valoresIzq, etiquetasCabecera });
  const bloqueDer = construirBloqueCasillas(ctx, etiquetaDer, n, anchoMitad, config, { valores: valoresDer, etiquetasCabecera });
  return {
    altoPt: Math.max(bloqueIzq.altoPt, bloqueDer.altoPt),
    dibujar(lienzo, xPt, yTopPt) {
      bloqueIzq.dibujar(lienzo, xPt, yTopPt);
      bloqueDer.dibujar(lienzo, xPt + anchoMitad + GAP_DOBLE_CORRECCION_PT, yTopPt);
    },
    // lado: "respuesta"/"correccion" — issue #35, para que el detector de
    // tinta determinista sepa a qué bloque (y por tanto a qué campo del
    // esquema de OCR-IA, posicionesEnBlancoRespuesta/posicionesEnBlancoCorreccion)
    // pertenece cada casilla.
    casillas(xPt, yTopPt) {
      return [
        ...bloqueIzq.casillas(xPt, yTopPt).map((c) => ({ ...c, lado: "respuesta" })),
        ...bloqueDer.casillas(xPt + anchoMitad + GAP_DOBLE_CORRECCION_PT, yTopPt).map((c) => ({ ...c, lado: "correccion" })),
      ];
    },
  };
}

// Números en letras para instrucciones de "selección múltiple con nº fijo"
// (README, ver ItemPublico.num_correctas): solo aplica al ítem "09" hoy
// (opciones_correctas.length === 2), pero el mecanismo es genérico por si en
// el futuro hay otro ítem con esta misma excepción y otro nº de opciones.
const NUMERO_EN_LETRAS = { 2: "DOS", 3: "TRES", 4: "CUATRO", 5: "CINCO", 6: "SEIS" };
function numeroEnLetras(n) {
  return NUMERO_EN_LETRAS[n] ?? String(n);
}

// Ítem 'abierto': estilo "casillas" (una letra por casilla, más fácil de
// forzar mayúsculas de imprenta) o "linea" (una raya para escribir en
// natural, más compacta) — config.estiloAbierto, ver checkpoint de layout.
// valorInk (opcional, ocr_tests/ únicamente): texto de tinta sintética.
// numCasillas (opcional): nº de casillas a dibujar en estilo "casillas" —
// por defecto config.casillasAbierto, pero construirBloqueItem lo eleva
// cuando la respuesta_canonica del ítem es más larga que eso (si no, la
// respuesta correcta y completa no cabría físicamente en la hoja — bug real
// encontrado con la respuesta canónica del ítem "02", 40 caracteres con
// espacios contra solo 18 casillas fijas).
function construirRespuestaAbierta(ctx, etiqueta, anchoPt, config, valorInk, numCasillas = config.casillasAbierto) {
  if (config.estiloAbierto === "linea") {
    const alto = mmAPt(6);
    const titulo = construirParrafo(ctx, etiqueta, config.tamanoInstruccionPt, anchoPt, {
      color: ctx.colorTextoSuave,
      margenInferiorPt: mmAPt(0.6),
    });
    const linea = {
      altoPt: alto,
      dibujar(lienzo, xPt, yTopPt) {
        lienzo.linea(xPt, yTopPt + alto - mmAPt(1), xPt + anchoPt, yTopPt + alto - mmAPt(1), {
          thickness: CASILLA_BORDE_PT,
          color: ctx.colorNegro,
        });
        if (valorInk) {
          const font = ctx.fontInk ?? ctx.fontRegular;
          lienzo.texto(xPt + mmAPt(1), yTopPt + alto - mmAPt(2.3), valorInk, {
            font,
            tamanoPt: 9,
            color: ctx.colorInk ?? ctx.colorNegro,
          });
        }
      },
    };
    return apilar([titulo, linea], mmAPt(1.5));
  }
  const valores = valorInk ? [...valorInk].slice(0, numCasillas) : undefined;
  return construirBloqueCasillas(ctx, etiqueta, numCasillas, anchoPt, config, { valores });
}

// ============================================================
// Consentimiento/compromiso: casillas cuadradas simples (README §2) — ya no
// se leen por oscuridad (OMR): el modelo de OCR-IA las ve marcadas/vacías
// como parte de la misma imagen de la página de demografía (README §4.7).
// ============================================================

// marcado (opcional, ocr_tests/ únicamente): si es true, rellena la casilla
// (tinta sintética) simulando que la persona la marcó.
function construirCasillaConEtiqueta(ctx, etiqueta, anchoPt, config, marcado) {
  const LADO_PT = mmAPt(3.6);
  const tamanoPt = config.tamanoTextoPt;
  const anchoTexto = anchoPt - LADO_PT - mmAPt(2.5);
  const lineas = envolverTexto(ctx.fontRegular, tamanoPt, etiqueta, anchoTexto);
  const altoLinea = altoLineaPt(tamanoPt);
  const altoPt = Math.max(lineas.length * altoLinea, LADO_PT) + mmAPt(1.3);
  return {
    altoPt,
    dibujar(lienzo, xPt, yTopPt) {
      lienzo.rect(xPt, yTopPt, LADO_PT, LADO_PT, { borderColor: ctx.colorNegro, borderWidth: mmAPt(0.4) });
      if (marcado) {
        const margen = mmAPt(0.7);
        lienzo.rect(xPt + margen, yTopPt + margen, LADO_PT - 2 * margen, LADO_PT - 2 * margen, {
          color: ctx.colorInk ?? ctx.colorNegro,
        });
      }
      lineas.forEach((linea, i) =>
        lienzo.texto(xPt + LADO_PT + mmAPt(2.5), yTopPt + i * altoLinea, linea, { tamanoPt })
      );
    },
  };
}

// ============================================================
// Instrucciones generales (solo página 1, arriba a la derecha, junto al QR
// grande): breves a propósito, para que la página de datos censales no crezca
// a una segunda hoja. Un ejemplo "Bien" (letra centrada en la casilla) y uno
// "Mal" (letra pequeña/descentrada) bastan — el texto ya pide mayúsculas de
// imprenta, los ejemplos son solo refuerzo visual.
// ============================================================

function construirInstruccionesGenerales(ctx, anchoPt) {
  const colorError = ctx.PDFLib.rgb(0.72, 0.16, 0.16);
  const titulo = construirParrafo(ctx, "Cómo rellenar", 8, anchoPt, {
    negrita: true,
    color: ctx.colorAcento,
    margenInferiorPt: mmAPt(1),
  });
  const texto = construirParrafo(ctx, "Mayúsculas y letra de imprenta, bien centrada en la casilla:", 6.8, anchoPt, {
    color: ctx.colorTextoSuave,
    margenInferiorPt: mmAPt(1.8),
  });

  const LADO_PT = mmAPt(8);
  const GAP_PT = mmAPt(5);
  const ejemplos = {
    altoPt: LADO_PT + mmAPt(0.8) + altoLineaPt(6),
    dibujar(lienzo, xPt, yTopPt) {
      lienzo.rect(xPt, yTopPt, LADO_PT, LADO_PT, { borderColor: ctx.colorNegro, borderWidth: CASILLA_BORDE_PT });
      lienzo.textoCentrado(xPt + LADO_PT / 2, yTopPt + LADO_PT / 2 - 9 * 0.36, "A", {
        font: ctx.fontBold,
        tamanoPt: 9,
        color: ctx.colorNegro,
      });
      lienzo.texto(xPt, yTopPt + LADO_PT + mmAPt(0.8), "Bien", { font: ctx.fontBold, tamanoPt: 6, color: ctx.colorAcento });

      const x2 = xPt + LADO_PT + GAP_PT;
      lienzo.rect(x2, yTopPt, LADO_PT, LADO_PT, { borderColor: ctx.colorNegro, borderWidth: CASILLA_BORDE_PT });
      // La "A" del ejemplo incorrecto es la MISMA letra que el ejemplo
      // correcto (para que la comparación sea directa), pero más grande y a
      // caballo del borde derecho de la casilla — mitad dentro, mitad fuera —
      // en vez de simplemente pequeña o minúscula.
      const tamanoMalPt = 13;
      const anchoLetraMal = ctx.fontBold.widthOfTextAtSize("A", tamanoMalPt);
      lienzo.texto(x2 + LADO_PT - anchoLetraMal / 2, yTopPt + LADO_PT / 2 - tamanoMalPt * 0.36, "A", {
        font: ctx.fontBold,
        tamanoPt: tamanoMalPt,
        color: ctx.colorNegro,
      });
      lienzo.texto(x2, yTopPt + LADO_PT + mmAPt(0.8), "Mal", { font: ctx.fontBold, tamanoPt: 6, color: colorError });
    },
  };
  return apilar([titulo, texto, ejemplos]);
}

// ============================================================
// Bloque completo de un ítem del banco (README §4.2: un formato por tipo)
// ============================================================

function contarNecesitaN(formato) {
  return formato === "ordenar" || formato === "clasificar";
}

// sintetico (opcional, ocr_tests/ únicamente): { respuesta, correccion } con
// la tinta a dibujar en cada bloque de casillas — la forma de cada campo
// depende del formato (string para abierto/opcion_multiple/seleccion_multiple,
// array de longitud n para ordenar/clasificar). Nunca lo pasa el panel de
// admin real (la hoja para imprimir/rellenar a mano siempre va sin esto).
function construirBloqueItem(ctx, item, numero, anchoPt, config, sintetico) {
  const partes = [construirEnunciado(ctx, numero, item.enunciado, anchoPt, config)];
  if (item.texto) partes.push(construirPasaje(ctx, item.texto, anchoPt, config));
  const resp = sintetico?.respuesta;
  const corr = sintetico?.correccion;
  // Declarado fuera del switch: el bloque itemManifiesto de más abajo (fuera
  // del switch) también lo necesita para "abierto", para pasárselo al motor
  // de OCR-IA como numCasillas.
  let numCasillasAbierto;
  // Acumula, para CUALQUIER formato, cada sub-bloque de casillas que aparece
  // en el ítem junto con el desplazamiento vertical (relativo al origen del
  // ítem) al que quedó — es el único momento en que se conoce ese offset,
  // antes de que `partes` se apile en un solo bloque (issue #35, ampliado de
  // ordenar/clasificar a los 5 formatos: la detección determinista de tinta
  // necesita la geometría de cualquier casilla, no solo las de posiciones).
  // `lado` solo hace falta para "abierto" (Respuesta/Corrección son dos
  // bloques SEPARADOS, apilados, cada uno sin lado propio) — para el resto
  // de formatos ya viene incluido en las casillas que devuelve el propio
  // construirBloqueCasillasDoble (bloqueIzq/bloqueDer con lado "respuesta"/
  // "correccion"), así que aquí se deja sin definir y no se pisa nada.
  const bloquesCasillas = []; // { bloque, offsetPt, lado? }
  function offsetActualPt() {
    return partes.reduce((s, p) => s + p.altoPt, 0);
  }

  switch (item.formato) {
    case "abierto": {
      // La respuesta correcta completa tiene que caber físicamente en la
      // hoja — 18 casillas se quedan cortas para respuestas largas de varias
      // palabras (p. ej. "Isabel de Castilla y Fernando de Aragón", 40
      // caracteres con espacios). item.casillas_abierto lo calcula el
      // servidor a partir de la longitud de la respuesta canónica (+2 de
      // margen, nunca menos que el mínimo por defecto) — worker/src/
      // items.ts::casillasAbiertoPara; ItemPublico nunca expone la propia
      // respuesta_canonica (README §4.3), así que no se puede calcular aquí
      // a partir de ella (antes lo intentaba y siempre caía al mínimo fijo:
      // bug real, la hoja en producción nunca dibujaba más de 18 casillas).
      numCasillasAbierto = casillasAbiertoAjustadas(item.casillas_abierto ?? config.casillasAbierto, anchoPt);

      // Ejemplo opcional (item.ejemplo_abierto, p. ej. "1/2" en data/items/
      // 10.json, el único ítem "abierto" que pide un formato con símbolos
      // especiales): además del propio texto del enunciado ("por ejemplo,
      // escribe..."), un bloque de casillas YA RELLENAS con ese ejemplo —
      // sobre todo para dejar claro con las mismas casillas reales que un
      // símbolo como "/" ocupa su PROPIA casilla, no comparte una con el
      // dígito de al lado. Nunca se añade a bloquesCasillas: son casillas
      // decorativas fijas, no algo que la persona rellene ni que el motor de
      // OCR-IA necesite leer.
      if (item.ejemplo_abierto) {
        partes.push(
          construirBloqueCasillas(
            ctx,
            "Ejemplo de formato (no es la respuesta correcta)",
            [...item.ejemplo_abierto].length,
            anchoPt,
            config,
            { valores: [...item.ejemplo_abierto] }
          )
        );
      }

      const offsetResp = offsetActualPt();
      const bloqueResp = construirRespuestaAbierta(ctx, "Respuesta", anchoPt, config, resp, numCasillasAbierto);
      partes.push(bloqueResp);
      // Sin casillas() en estilo "linea" (config.estiloAbierto): no hay
      // casillas discretas que muestrear, solo una raya continua.
      if (bloqueResp.casillas) bloquesCasillas.push({ bloque: bloqueResp, offsetPt: offsetResp, lado: "respuesta" });

      const offsetCorr = offsetActualPt();
      const bloqueCorr = construirRespuestaAbierta(
        ctx,
        "Corrección (solo si te equivocaste antes)",
        anchoPt,
        config,
        corr,
        numCasillasAbierto
      );
      partes.push(bloqueCorr);
      if (bloqueCorr.casillas) bloquesCasillas.push({ bloque: bloqueCorr, offsetPt: offsetCorr, lado: "correccion" });
      break;
    }
    case "opcion_multiple": {
      const letras = item.opciones.map((_, i) => LETRAS[i]);
      partes.push(construirInstruccion(ctx, "Marca UNA sola respuesta: escribe su letra en la casilla.", anchoPt, config));
      partes.push(construirListaEtiquetada(ctx, item.opciones, letras, anchoPt, config));
      const offset = offsetActualPt();
      const bloqueDoble = construirBloqueCasillasDoble(ctx, "Respuesta", "Corrección (solo si te equivocaste antes)", 1, anchoPt, config, {
        valoresIzq: resp ? [resp] : undefined,
        valoresDer: corr ? [corr] : undefined,
      });
      partes.push(bloqueDoble);
      bloquesCasillas.push({ bloque: bloqueDoble, offsetPt: offset });
      break;
    }
    case "seleccion_multiple": {
      const letras = item.opciones.map((_, i) => LETRAS[i]);
      // Excepción (ItemPublico.num_correctas, worker/src/items.ts): cuando el
      // propio enunciado ya pide un número concreto (p. ej. ítem "09", "qué
      // DOS continentes..."), se imprime solo ESE nº de casillas y el texto
      // lo refleja — en cualquier otro caso, una casilla por opción y "marca
      // TODAS", sin dar ninguna pista sobre cuántas son correctas.
      const n = item.num_correctas ?? item.opciones.length;
      const instruccionTexto =
        item.num_correctas != null
          ? `Marca las ${numeroEnLetras(item.num_correctas)} que correspondan: escribe sus letras, una por casilla.`
          : "Marca TODAS las que correspondan: escribe sus letras, una por casilla.";
      partes.push(construirInstruccion(ctx, instruccionTexto, anchoPt, config));
      partes.push(construirListaEtiquetada(ctx, item.opciones, letras, anchoPt, config));
      const offset = offsetActualPt();
      const bloqueDoble = construirBloqueCasillasDoble(ctx, "Respuesta", "Corrección (solo si te equivocaste antes)", n, anchoPt, config, {
        valoresIzq: resp ? [...resp] : undefined,
        valoresDer: corr ? [...corr] : undefined,
      });
      partes.push(bloqueDoble);
      bloquesCasillas.push({ bloque: bloqueDoble, offsetPt: offset });
      break;
    }
    case "ordenar": {
      const n = item.elementos.length;
      const letrasElementos = item.elementos.map((_, i) => LETRAS[i]);
      const posiciones = Array.from({ length: n }, (_, i) => String(i + 1));
      partes.push(
        construirInstruccion(
          ctx,
          "Escribe los elementos en orden: debajo de cada número de posición (1 = primero), la letra del elemento que va ahí.",
          anchoPt,
          config
        )
      );
      partes.push(construirListaEtiquetada(ctx, item.elementos, letrasElementos, anchoPt, config));
      const offset = offsetActualPt();
      const bloqueDoble = construirBloqueCasillasDoble(
        ctx,
        "Respuesta",
        "Corrección (solo si te equivocaste antes)",
        n,
        anchoPt,
        config,
        { etiquetasCabecera: posiciones, valoresIzq: resp, valoresDer: corr }
      );
      partes.push(bloqueDoble);
      bloquesCasillas.push({ bloque: bloqueDoble, offsetPt: offset });
      break;
    }
    case "clasificar": {
      const n = item.elementos.length;
      const numerosElementos = item.elementos.map((_, i) => String(i + 1));
      const letrasCategorias = item.categorias.map((_, i) => LETRAS[i]);
      partes.push(
        construirInstruccion(ctx, "Escribe, debajo del número de cada elemento, la letra de su categoría.", anchoPt, config)
      );
      partes.push(construirLeyendaCompacta(ctx, item.categorias, letrasCategorias, anchoPt, config));
      partes.push(construirListaEtiquetada(ctx, item.elementos, numerosElementos, anchoPt, config));
      const offset = offsetActualPt();
      const bloqueDoble = construirBloqueCasillasDoble(
        ctx,
        "Respuesta",
        "Corrección (solo si te equivocaste antes)",
        n,
        anchoPt,
        config,
        { etiquetasCabecera: numerosElementos, valoresIzq: resp, valoresDer: corr }
      );
      partes.push(bloqueDoble);
      bloquesCasillas.push({ bloque: bloqueDoble, offsetPt: offset });
      break;
    }
  }

  const bloque = apilar(partes, mmAPt(4));
  return {
    ...bloque,
    itemManifiesto: {
      id: item.id,
      formato: item.formato,
      numero,
      ...(contarNecesitaN(item.formato) ? { n: item.elementos.length } : {}),
      // numOpciones/numCategorias: cuántas letras válidas (A, B, C...) hay
      // realmente impresas para este ítem — se lo pasamos al motor de OCR-IA
      // (worker/src/endpoints/admin/ocrIa.ts) para que restrinja el esquema
      // JSON a exactamente esas letras (Structured Outputs `enum`), en vez de
      // aceptar cualquier string. Sin esto el modelo a veces devolvía cosas
      // como "F) 7" en vez de "F" (README §4.7).
      ...((item.formato === "opcion_multiple" || item.formato === "seleccion_multiple") && {
        numOpciones: item.opciones.length,
      }),
      ...(item.formato === "clasificar" && { numCategorias: item.categorias.length }),
      // Nº exacto de casillas impresas para "abierto" — el motor de OCR-IA
      // restringe el esquema de salida a exactamente esa longitud (ocrIa.ts).
      ...(item.formato === "abierto" && { numCasillas: numCasillasAbierto }),
    },
    // Geometría de TODAS las casillas del ítem, cualquiera que sea su formato
    // (issue #35: detección determinista de tinta por casilla, previa a
    // OCR-IA). xPt/yTopPt son absolutos de PÁGINA (mismo origen que dibujar):
    // el llamador (calcularGeometriaCasillas) solo tiene que sumar el offset
    // vertical acumulado de los bloques anteriores de la página, el resto
    // (offset dentro del ítem, lado respuesta/corrección) ya está resuelto
    // aquí.
    ...(bloquesCasillas.length > 0 && {
      casillas(xPt, yTopPt) {
        return bloquesCasillas.flatMap(({ bloque: b, offsetPt, lado }) =>
          b.casillas(xPt, yTopPt + offsetPt).map((c) => (lado ? { ...c, lado } : c))
        );
      },
    }),
  };
}

// ============================================================
// Bloques de demografía
// ============================================================

const CAMPOS_DEMOGRAFIA = [
  ["sexo", "sexo", "Sexo"],
  ["ccaa_educacion_secundaria", "ccaa", "CCAA donde cursaste la educación secundaria"],
  ["nivel_estudios", "nivel_estudios", "Nivel de estudios"],
  ["area_estudios", "area_estudios", "Área de estudios"],
  ["estudios_mayor_progenitor", "nivel_estudios", "Mayor nivel de estudios de tu padre o madre"],
  ["libros_en_casa", "libros_en_casa", "Libros en casa a los 15 años (aprox.)"],
];

// Margen tras cada bloque de demografía (README "padding entre elementos"):
// antes los bloques se apilaban con margen 0, así que en páginas donde varios
// caían seguidos (p. ej. "Año de nacimiento" seguido de "Sexo") la primera
// fila del siguiente bloque quedaba pegada, a veces solapada, contra el
// último elemento del anterior (bug real, más visible cuantas más opciones
// tenía el bloque siguiente en varias columnas).
const MARGEN_ENTRE_BLOQUES_DEMOGRAFIA_PT = mmAPt(2);

// sintetico (opcional, ocr_tests/ únicamente): { consentimiento, compromiso_honestidad
// (booleanos), anio_nacimiento (string 4 dígitos), <campo catálogo>: letra }.
function construirBloquesDemografia(ctx, anchoPt, config, sintetico) {
  const bloques = [];

  const consentimiento = apilar(
    [
      construirTitulo(ctx, "Consentimiento y compromiso", anchoPt, config),
      apilar(
        [
          construirCasillaConEtiqueta(
            ctx,
            "He leído la información del estudio y consiento participar de forma anónima.",
            anchoPt,
            config,
            sintetico?.consentimiento
          ),
          construirCasillaConEtiqueta(
            ctx,
            "Me comprometo a responder con honestidad, sin buscar las respuestas.",
            anchoPt,
            config,
            sintetico?.compromiso_honestidad
          ),
        ],
        mmAPt(1)
      ),
    ],
    MARGEN_ENTRE_BLOQUES_DEMOGRAFIA_PT
  );
  // Las casillas se imprimen y se piden igual (nudge social para que quien
  // rellena la hoja se lo tome en serio), pero NO se piden a OCR-IA: no hay
  // forma de invalidar una sesión ya rellenada en papel por esto, así que
  // leerlas nunca cambia nada salvo añadir una fuente de fallo más — y medida
  // contra la API real resultó ser, con diferencia, el campo menos fiable de
  // toda la hoja (decisión del propietario del proyecto). La digitalización
  // (worker/src/endpoints/admin/digitalizacion.ts) siempre manda
  // consentimiento/compromiso_honestidad = true.
  bloques.push({ ...consentimiento, camposDemografia: [] });

  const anio = apilar(
    [
      construirTitulo(ctx, "Año de nacimiento", anchoPt, config),
      construirInstruccion(ctx, "4 dígitos, en números de imprenta.", anchoPt, config),
      construirFilaCasillas(ctx, 4, anchoPt, { valores: sintetico?.anio_nacimiento ? [...sintetico.anio_nacimiento] : undefined }),
    ],
    MARGEN_ENTRE_BLOQUES_DEMOGRAFIA_PT
  );
  bloques.push({ ...anio, camposDemografia: ["anio_nacimiento"] });

  for (const [campo, claveCatalogo, etiqueta] of CAMPOS_DEMOGRAFIA) {
    const valores = CATALOGOS[claveCatalogo];
    const letras = valores.map((_, i) => LETRAS[i]);
    const valorInk = sintetico?.[campo];
    const bloque = apilar(
      [
        construirTitulo(ctx, etiqueta, anchoPt, config),
        construirListaEtiquetada(ctx, valores, letras, anchoPt, config),
        construirBloqueCasillas(ctx, "Respuesta", 1, anchoPt, config, { valores: valorInk ? [valorInk] : undefined }),
      ],
      MARGEN_ENTRE_BLOQUES_DEMOGRAFIA_PT
    );
    bloques.push({ ...bloque, camposDemografia: [campo] });
  }

  return bloques;
}

// ============================================================
// Paginado: empaquetado voraz por altura (aritmética pura, sin medir nada) —
// ver pdfLayout.js para por qué esto es determinista sin necesitar
// precalcular nada aparte ni depender de ningún navegador.
// ============================================================

function agruparEnPaginas(bloques, alturaPrimeraPt, alturaRestoPt) {
  const grupos = [];
  let actual = [];
  let altoActual = 0;
  for (const bloque of bloques) {
    const limite = grupos.length === 0 ? alturaPrimeraPt : alturaRestoPt;
    if (actual.length > 0 && altoActual + bloque.altoPt > limite) {
      grupos.push(actual);
      actual = [];
      altoActual = 0;
    }
    actual.push(bloque);
    altoActual += bloque.altoPt;
  }
  if (actual.length > 0) grupos.push(actual);
  return grupos;
}

// Manifiesto {tipo, campos|items}[] — un elemento por página física, en el
// mismo orden en que se van a imprimir: páginas de demografía primero,
// páginas de ítems después. Puramente aritmético (solo necesita `ctx` para
// las métricas de fuente, nunca crea páginas reales) — lo usan tanto
// construirHoja (para saber dónde cae cada bloque) como el pipeline de
// lectura (digitalizar.js/subirLote.js) para saber qué pedirle a OCR-IA en
// cada página, sin tener que generar ningún PDF.
//
// respuestasSinteticas (opcional, ocr_tests/ únicamente): { items: {<id>:
// {respuesta, correccion}}, demografia: {...} } — tinta a dibujar en cada
// casilla. Nunca cambia el alto de ningún bloque (los builders de más arriba
// dibujan la tinta DENTRO de casillas ya dimensionadas), así que el
// manifiesto/paginado sale exactamente igual con o sin ella — la lectura
// real (sin esto) y la generación de fixtures de prueba (con esto) nunca
// pueden desincronizarse en cuántas páginas tiene la hoja.
export function calcularManifiesto(ctx, items, config = CONFIG_POR_DEFECTO, respuestasSinteticas) {
  const bloquesDemografia = construirBloquesDemografia(ctx, ANCHO_CONTENIDO_PT, config, respuestasSinteticas?.demografia);
  const bloquesItems = items.map((item, i) =>
    construirBloqueItem(ctx, item, i + 1, ANCHO_CONTENIDO_PT, config, respuestasSinteticas?.items?.[item.id])
  );

  const gruposDemografia = agruparEnPaginas(bloquesDemografia, ALTURA_DISPONIBLE_PT - ALTURA_QR_GRANDE_PT, ALTURA_DISPONIBLE_PT);
  const gruposItems = agruparEnPaginas(bloquesItems, ALTURA_DISPONIBLE_PT, ALTURA_DISPONIBLE_PT);

  const paginasDemografia = gruposDemografia.map((grupo, i) => ({
    tipo: "demografia",
    campos: [...new Set(grupo.flatMap((b) => b.camposDemografia))],
    bloques: grupo,
    tituloDerecha: gruposDemografia.length > 1 ? `Página de datos ${i + 1}/${gruposDemografia.length}` : "Página de datos",
  }));
  const paginasItems = gruposItems.map((grupo) => ({
    tipo: "items",
    items: grupo.map((b) => b.itemManifiesto),
    bloques: grupo,
    tituloDerecha: null, // se rellena abajo con el total ya conocido
  }));
  paginasItems.forEach((p, i) => (p.tituloDerecha = `Página ${i + 1} de ${paginasItems.length}`));

  return [...paginasDemografia, ...paginasItems];
}

// Geometría absoluta (en pt, mismo sistema de coordenadas que dibujar: origen
// arriba-izquierda de cada página) de las casillas de ordenar/clasificar —
// issue #35: detección determinista de tinta por casilla, previa a OCR-IA.
// Reutiliza calcularManifiesto (los bloques ya construidos, con su método
// casillas() si lo tienen) y replica EXACTAMENTE el mismo bucle de
// acumulación vertical que usa construirHoja al dibujar cada página, así que
// nunca puede desincronizarse de dónde caen las casillas de verdad en el PDF
// — la lectura (subirLote.js/digitalizar.js, sobre la imagen ya enderezada a
// esta misma escala canónica) usa esta función, nunca mide nada por su
// cuenta. Devuelve un array paralelo al manifiesto: por página, la lista de
// casillas de ese formato con {itemId, lado, posicion, xPt, yTopPt, wPt, hPt}.
export function calcularGeometriaCasillas(ctx, items, config = CONFIG_POR_DEFECTO) {
  const manifiesto = calcularManifiesto(ctx, items, config);
  return manifiesto.map((entrada, i) => {
    let y = PADDING_PT + CABECERA_ALTO_PT;
    if (entrada.tipo === "demografia" && i === 0) y += ALTURA_QR_GRANDE_PT;
    const casillas = [];
    for (const bloque of entrada.bloques) {
      if (bloque.casillas) {
        for (const c of bloque.casillas(PADDING_PT, y)) {
          casillas.push({ itemId: bloque.itemManifiesto.id, formato: bloque.itemManifiesto.formato, ...c });
        }
      }
      y += bloque.altoPt;
    }
    return casillas;
  });
}

// ============================================================
// Construcción del PDF completo
// ============================================================

function dibujarCabeceraYFiduciales(ctx, page, lienzo, tituloDerecha) {
  const inset = mmAPt(FIDUCIAL_INSET_MM);
  const tamFiducial = mmAPt(FIDUCIAL_SIZE_MM);
  const esquinas = [
    [inset, inset],
    [PAGE_W_PT - inset - tamFiducial, inset],
    [PAGE_W_PT - inset - tamFiducial, PAGE_H_PT - inset - tamFiducial],
    [inset, PAGE_H_PT - inset - tamFiducial],
  ];
  for (const [x, yTop] of esquinas) lienzo.rect(x, yTop, tamFiducial, tamFiducial, { color: ctx.colorNegro });

  // El título va DEBAJO del fiducial superior (que ya ocupa los primeros
  // FIDUCIAL_SIZE_MM del bloque de cabecera, medido desde el margen), no a una
  // distancia fija del borde de la página — así el margen superior real es
  // PADDING_MM, igual que el resto de márgenes, y el título nunca se solapa
  // con el fiducial.
  const yTitulo = PADDING_PT + mmAPt(FIDUCIAL_SIZE_MM + 2);
  lienzo.texto(PADDING_PT, yTitulo, "Test de Cultura General — hoja de respuestas", {
    font: ctx.fontBold,
    tamanoPt: 10.5,
    color: ctx.colorAcento,
  });
  if (tituloDerecha) {
    const tamanoPt = 8;
    const ancho = ctx.fontRegular.widthOfTextAtSize(tituloDerecha, tamanoPt);
    lienzo.texto(PAGE_W_PT - PADDING_PT - ancho, yTitulo + mmAPt(0.3), tituloDerecha, {
      tamanoPt,
      color: ctx.colorTextoSuave,
    });
  }
  const yLinea = PADDING_PT + mmAPt(CABECERA_ALTO_MM - 1);
  lienzo.linea(PADDING_PT, yLinea, PAGE_W_PT - PADDING_PT, yLinea, {
    thickness: mmAPt(0.5),
    color: ctx.colorAcento,
  });
}

// items: banco ya en el orden de presentación (README §1.4). qr, si se pasa,
// es {tokenId, examId} — con él se generan los QR reales (impresión); sin él
// se genera igual el PDF pero sin código QR de verdad (usado por
// digitalizar.js/subirLote.js si alguna vez necesitan bytes reales en vez de
// solo el manifiesto, hoy no es el caso — ver calcularManifiesto más arriba
// para el camino sin PDF).
export async function construirHoja(ctx, items, qr, config = CONFIG_POR_DEFECTO, respuestasSinteticas) {
  const manifiesto = calcularManifiesto(ctx, items, config, respuestasSinteticas);
  const { PDFLib, pdfDoc } = ctx;

  for (let i = 0; i < manifiesto.length; i++) {
    const numeroPagina = i + 1;
    const entrada = manifiesto[i];
    const page = pdfDoc.addPage([PAGE_W_PT, PAGE_H_PT]);
    const lienzo = crearLienzo(ctx, page);
    dibujarCabeceraYFiduciales(ctx, page, lienzo, entrada.tituloDerecha);

    if (entrada.tipo === "demografia" && i === 0) {
      const cajaGrandeMm = cajaQrGrande();
      const xPt = mmAPt(cajaGrandeMm.x / PX_POR_MM);
      const yPt = mmAPt(cajaGrandeMm.y / PX_POR_MM);
      const ladoPt = mmAPt(QR_GRANDE_SIZE_MM);
      if (qr) {
        // El QR grande lleva SOLO el token_id de la remesa (README §4.9):
        // ya no incluye versión ni exam_id/página — eso viaja en el QR
        // pequeño de página (codificarPayloadQrPagina), que está en TODAS
        // las páginas, incluida esta.
        await lienzo.imagenQr(xPt, yPt, ladoPt, codificarPayloadQr({ tokenId: qr.tokenId }));
      } else {
        lienzo.rect(xPt, yPt, ladoPt, ladoPt, { borderColor: ctx.colorGris, borderWidth: mmAPt(0.3) });
      }
      // Etiqueta a la DERECHA del QR (no debajo): así cabe dentro del propio
      // alto reservado para el bloque (ALTURA_QR_GRANDE_PT), sin invadir el
      // inicio del flujo de contenido que viene justo después. Ancho fijo
      // (ANCHO_ETIQUETA_TOKEN_PT), no "todo lo que sobra": deja sitio a las
      // instrucciones generales a su derecha.
      const xEtiqueta = xPt + ladoPt + mmAPt(4);
      lienzo.texto(xEtiqueta, yPt + mmAPt(2), "Código de la remesa", { font: ctx.fontBold, tamanoPt: 8 });
      if (qr?.tokenId) {
        const lineasToken = envolverTexto(ctx.fontRegular, 6.5, qr.tokenId, ANCHO_ETIQUETA_TOKEN_PT);
        lineasToken.forEach((linea, i) =>
          lienzo.texto(xEtiqueta, yPt + mmAPt(6) + i * altoLineaPt(6.5), linea, { tamanoPt: 6.5, color: ctx.colorTextoSuave })
        );
      }

      const xInstrucciones = xEtiqueta + ANCHO_ETIQUETA_TOKEN_PT + GAP_INSTRUCCIONES_PT;
      const anchoInstruccionesPt = PADDING_PT + ANCHO_CONTENIDO_PT - xInstrucciones;
      construirInstruccionesGenerales(ctx, anchoInstruccionesPt).dibujar(lienzo, xInstrucciones, yPt);
    }

    if (qr?.examId) {
      const cajaPagMm = cajaQrPagina();
      const xPt = mmAPt(cajaPagMm.x / PX_POR_MM);
      const yPt = mmAPt(cajaPagMm.y / PX_POR_MM);
      const ladoPt = mmAPt(QR_PAGINA_SIZE_MM);
      await lienzo.imagenQr(xPt, yPt, ladoPt, codificarPayloadQrPagina({ examId: qr.examId, pagina: numeroPagina }));
    }

    let y = PADDING_PT + CABECERA_ALTO_PT;
    if (entrada.tipo === "demografia" && i === 0) y += ALTURA_QR_GRANDE_PT;
    for (const bloque of entrada.bloques) {
      bloque.dibujar(lienzo, PADDING_PT, y);
      y += bloque.altoPt;
    }
  }

  const pdfBytes = await pdfDoc.save();
  const manifiestoPublico = manifiesto.map(({ tipo, campos, items: its, tituloDerecha }) => ({
    tipo,
    ...(tipo === "demografia" ? { campos } : { items: its }),
    tituloDerecha,
  }));
  return { pdfBytes, manifiesto: manifiestoPublico, PDFLib };
}
