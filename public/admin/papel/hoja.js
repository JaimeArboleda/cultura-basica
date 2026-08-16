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

// v1 = burbujas OMR, v2 = casillas de letra + Tesseract/OCR-IA, v3 = este
// (pdf-lib, 100% OCR-IA) — se sigue mandando en el QR y guardándose en
// sesiones.version_papel (README §4.9) para poder distinguir en el dataset
// de qué diseño de hoja viene cada sesión si se vuelve a rediseñar en el
// futuro, aunque hoy solo exista un pipeline activo.
export const VERSION_PIPELINE = 3;

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
const MARGEN_SEGURIDAD_PT = mmAPt(4);
const ALTURA_DISPONIBLE_PT = PAGE_H_PT - 2 * PADDING_PT - CABECERA_ALTO_PT - MARGEN_SEGURIDAD_PT;
// La página 1 de la sección de demografía reserva además el hueco del QR
// grande (fijo, README §4.9) antes de que empiece el flujo de bloques.
const ALTURA_QR_GRANDE_PT = mmAPt(QR_GRANDE_SIZE_MM + 3);

const CASILLA_W_PT = mmAPt(5.4);
const CASILLA_H_PT = mmAPt(6.2);
const CASILLA_GAP_PT = mmAPt(0.8);
const CASILLA_BORDE_PT = mmAPt(0.35);
const GAP_COLUMNAS_PT = mmAPt(4);

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
  const numeroTxt = String(numero);
  return {
    altoPt: Math.max(lineas.length * altoLinea, DIAM_PT) + mmAPt(1.5),
    dibujar(lienzo, xPt, yTopPt) {
      lienzo.circulo(xPt + DIAM_PT / 2, yTopPt + DIAM_PT / 2, DIAM_PT / 2, { color: ctx.colorAcento });
      const tamNumero = 7.5;
      lienzo.textoCentrado(xPt + DIAM_PT / 2, yTopPt + DIAM_PT / 2 - tamNumero * 0.36, numeroTxt, {
        font: ctx.fontBold,
        tamanoPt: tamNumero,
        color: ctx.PDFLib.rgb(1, 1, 1),
      });
      lineas.forEach((linea, i) => lienzo.texto(xPt + DIAM_PT + GAP_PT, yTopPt + i * altoLinea, linea, { font, tamanoPt }));
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
          const ci = celda.indice % nCols;
          lienzo.texto(xPt + ci * (anchoColPt + GAP_COLUMNAS_PT), yTopPt + fi * altoLinea, celda.texto, { font, tamanoPt });
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
function construirFilaCasillas(ctx, n, anchoPt, { etiquetasCabecera, valores } = {}) {
  const porFila = Math.max(1, Math.floor((anchoPt + CASILLA_GAP_PT) / (CASILLA_W_PT + CASILLA_GAP_PT)));
  const numFilas = Math.ceil(n / porFila);
  const altoCabecera = etiquetasCabecera ? altoLineaPt(6) : 0;
  const altoFila = altoCabecera + CASILLA_H_PT;
  const gapEntreFilas = mmAPt(1.5);
  return {
    altoPt: numFilas * altoFila + (numFilas - 1) * gapEntreFilas,
    dibujar(lienzo, xPt, yTopPt) {
      for (let i = 0; i < n; i++) {
        const fila = Math.floor(i / porFila);
        const col = i % porFila;
        const x = xPt + col * (CASILLA_W_PT + CASILLA_GAP_PT);
        const yFila = yTopPt + fila * (altoFila + gapEntreFilas);
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
  return apilar([titulo, fila], mmAPt(1.5));
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
      numCasillasAbierto = item.casillas_abierto ?? config.casillasAbierto;
      partes.push(construirRespuestaAbierta(ctx, "Respuesta", anchoPt, config, resp, numCasillasAbierto));
      partes.push(
        construirRespuestaAbierta(ctx, "Corrección (solo si te equivocaste arriba)", anchoPt, config, corr, numCasillasAbierto)
      );
      break;
    }
    case "opcion_multiple": {
      const letras = item.opciones.map((_, i) => LETRAS[i]);
      partes.push(construirInstruccion(ctx, "Marca UNA sola respuesta: escribe su letra en la casilla.", anchoPt, config));
      partes.push(construirListaEtiquetada(ctx, item.opciones, letras, anchoPt, config));
      partes.push(construirBloqueCasillas(ctx, "Respuesta", 1, anchoPt, config, { valores: resp ? [resp] : undefined }));
      partes.push(
        construirBloqueCasillas(ctx, "Corrección (solo si te equivocaste arriba)", 1, anchoPt, config, {
          valores: corr ? [corr] : undefined,
        })
      );
      break;
    }
    case "seleccion_multiple": {
      const letras = item.opciones.map((_, i) => LETRAS[i]);
      const n = item.opciones.length;
      partes.push(
        construirInstruccion(ctx, "Marca TODAS las que correspondan: escribe sus letras, una por casilla.", anchoPt, config)
      );
      partes.push(construirListaEtiquetada(ctx, item.opciones, letras, anchoPt, config));
      partes.push(construirBloqueCasillas(ctx, "Respuesta", n, anchoPt, config, { valores: resp ? [...resp] : undefined }));
      partes.push(
        construirBloqueCasillas(ctx, "Corrección (solo si te equivocaste arriba)", n, anchoPt, config, {
          valores: corr ? [...corr] : undefined,
        })
      );
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
      partes.push(
        construirBloqueCasillas(ctx, "Respuesta", n, anchoPt, config, { etiquetasCabecera: posiciones, valores: resp })
      );
      partes.push(
        construirBloqueCasillas(ctx, "Corrección (solo si te equivocaste arriba)", n, anchoPt, config, {
          etiquetasCabecera: posiciones,
          valores: corr,
        })
      );
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
      partes.push(
        construirBloqueCasillas(ctx, "Respuesta", n, anchoPt, config, { etiquetasCabecera: numerosElementos, valores: resp })
      );
      partes.push(
        construirBloqueCasillas(ctx, "Corrección (solo si te equivocaste arriba)", n, anchoPt, config, {
          etiquetasCabecera: numerosElementos,
          valores: corr,
        })
      );
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

// sintetico (opcional, ocr_tests/ únicamente): { consentimiento, compromiso_honestidad
// (booleanos), anio_nacimiento (string 4 dígitos), <campo catálogo>: letra }.
function construirBloquesDemografia(ctx, anchoPt, config, sintetico) {
  const bloques = [];

  const consentimiento = apilar([
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
  ]);
  // Las casillas se imprimen y se piden igual (nudge social para que quien
  // rellena la hoja se lo tome en serio), pero NO se piden a OCR-IA: no hay
  // forma de invalidar una sesión ya rellenada en papel por esto, así que
  // leerlas nunca cambia nada salvo añadir una fuente de fallo más — y medida
  // contra la API real resultó ser, con diferencia, el campo menos fiable de
  // toda la hoja (decisión del propietario del proyecto). La digitalización
  // (worker/src/endpoints/admin/digitalizacion.ts) siempre manda
  // consentimiento/compromiso_honestidad = true.
  bloques.push({ ...consentimiento, camposDemografia: [] });

  const anio = apilar([
    construirTitulo(ctx, "Año de nacimiento", anchoPt, config),
    construirInstruccion(ctx, "4 dígitos, en números de imprenta.", anchoPt, config),
    construirFilaCasillas(ctx, 4, anchoPt, { valores: sintetico?.anio_nacimiento ? [...sintetico.anio_nacimiento] : undefined }),
  ]);
  bloques.push({ ...anio, camposDemografia: ["anio_nacimiento"] });

  for (const [campo, claveCatalogo, etiqueta] of CAMPOS_DEMOGRAFIA) {
    const valores = CATALOGOS[claveCatalogo];
    const letras = valores.map((_, i) => LETRAS[i]);
    const valorInk = sintetico?.[campo];
    const bloque = apilar([
      construirTitulo(ctx, etiqueta, anchoPt, config),
      construirListaEtiquetada(ctx, valores, letras, anchoPt, config),
      construirBloqueCasillas(ctx, "Respuesta", 1, anchoPt, config, { valores: valorInk ? [valorInk] : undefined }),
    ]);
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

  lienzo.texto(PADDING_PT, mmAPt(4), "Test de Cultura General — hoja de respuestas", {
    font: ctx.fontBold,
    tamanoPt: 10.5,
    color: ctx.colorAcento,
  });
  if (tituloDerecha) {
    const tamanoPt = 8;
    const ancho = ctx.fontRegular.widthOfTextAtSize(tituloDerecha, tamanoPt);
    lienzo.texto(PAGE_W_PT - PADDING_PT - ancho, mmAPt(4.3), tituloDerecha, {
      tamanoPt,
      color: ctx.colorTextoSuave,
    });
  }
  lienzo.linea(PADDING_PT, mmAPt(CABECERA_ALTO_MM - 1), PAGE_W_PT - PADDING_PT, mmAPt(CABECERA_ALTO_MM - 1), {
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
        await lienzo.imagenQr(xPt, yPt, ladoPt, codificarPayloadQr({ ...qr, version: VERSION_PIPELINE, pagina: numeroPagina }));
      } else {
        lienzo.rect(xPt, yPt, ladoPt, ladoPt, { borderColor: ctx.colorGris, borderWidth: mmAPt(0.3) });
      }
      // Etiqueta a la DERECHA del QR (no debajo): así cabe dentro del propio
      // alto reservado para el bloque (ALTURA_QR_GRANDE_PT), sin invadir el
      // inicio del flujo de contenido que viene justo después.
      const xEtiqueta = xPt + ladoPt + mmAPt(4);
      lienzo.texto(xEtiqueta, yPt + mmAPt(2), "Código de la remesa", { font: ctx.fontBold, tamanoPt: 8 });
      if (qr?.tokenId) {
        const lineasToken = envolverTexto(ctx.fontRegular, 6.5, qr.tokenId, ANCHO_CONTENIDO_PT - ladoPt - mmAPt(4));
        lineasToken.forEach((linea, i) =>
          lienzo.texto(xEtiqueta, yPt + mmAPt(6) + i * altoLineaPt(6.5), linea, { tamanoPt: 6.5, color: ctx.colorTextoSuave })
        );
      }
    }

    if (qr?.examId) {
      const cajaPagMm = cajaQrPagina();
      const xPt = mmAPt(cajaPagMm.x / PX_POR_MM);
      const yPt = mmAPt(cajaPagMm.y / PX_POR_MM);
      const ladoPt = mmAPt(QR_PAGINA_SIZE_MM);
      await lienzo.imagenQr(xPt, yPt, ladoPt, codificarPayloadQrPagina({ examId: qr.examId, pagina: numeroPagina }));
    }

    let y = mmAPt(CABECERA_ALTO_MM);
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
