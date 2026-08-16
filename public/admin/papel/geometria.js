// Geometría fija de la hoja de papel (README §4.7/§4.9): única fuente de verdad
// para las posiciones de los fiduciales y los dos códigos QR, usada tanto al
// GENERAR la hoja (hoja.js, con pdf-lib) como al LEERLA (comun.js). Antes esta
// geometría se MEDÍA en el DOM después de maquetar (comun.js::medirMarcas) —
// ahora, como la hoja se genera con pdf-lib (posiciones calculadas por
// aritmética, no por un motor de renderizado), la posición de fiduciales/QR no
// depende de ningún contenido ni de ningún navegador: son constantes.
//
// Escala: todo aquí está en "px canónicos" (PX_POR_MM = 96/25.4), la misma
// convención que ya usaba el pipeline de lectura (homografía, warpeado,
// recorte — comun.js) antes de este cambio, para no tener que tocar esa
// aritmética. La generación del PDF (hoja.js) convierte estos mismos
// milímetros a puntos (72/25.4) para dibujar con pdf-lib — dos escalas
// distintas derivadas de los mismos milímetros, nunca dos fuentes de verdad.
export const PX_POR_MM = 96 / 25.4;
export const PT_POR_MM = 72 / 25.4;

export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;
export const PAGE_W = Math.round(PAGE_W_MM * PX_POR_MM); // ≈ 794
export const PAGE_H = Math.round(PAGE_H_MM * PX_POR_MM); // ≈ 1123

// Margen de página: 15mm en los 4 lados, el mínimo recomendable para que
// ninguna impresora doméstica/de oficina recorte contenido por falta de
// margen (antes 14mm horizontal y solo ~4mm vertical — asimétrico, corregido
// aquí). Se aplica por igual a texto, fiduciales y QR: nada se dibuja más
// cerca del borde de la página que PADDING_MM, ni siquiera las marcas de
// esquina — ver FIDUCIAL_INSET_MM/QR_PAGINA_BOTTOM_INSET_MM más abajo.
export const PADDING_MM = 15;

// Antes 3mm (muy cerca del borde real, fuera del margen de 15mm) — ahora
// coincide con el margen: el fiducial queda con su borde exterior justo en la
// línea de los 15mm, nunca más cerca del borde físico de la página.
export const FIDUCIAL_INSET_MM = PADDING_MM;
export const FIDUCIAL_SIZE_MM = 5;

export const QR_GRANDE_SIZE_MM = 22; // solo en la página 1, esquina superior izquierda del área de contenido
export const QR_PAGINA_SIZE_MM = 10; // en TODAS las páginas, centrado horizontalmente, pegado al margen inferior

// Escala del canvas de referencia usado al digitalizar: cuanto mayor, más
// resolución para decodificar los QR y para la imagen que se manda a
// OCR-IA, a costa de más cómputo por warp. 3x da ~2382x3369px, de sobra.
export const ESCALA_DIGITALIZACION = 3;

// Cabecera de cada página: título + subtítulo + línea separadora, medida
// DESDE el final del margen superior (PADDING_MM), no desde el borde de la
// página. Altura fija (no depende de cuánto mida el texto real, que siempre
// cabe en una línea a estos tamaños) para poder reservar el hueco de forma
// determinista sin medir nada — hoja.js dibuja dentro de este presupuesto,
// dejando primero un hueco para el fiducial superior (FIDUCIAL_SIZE_MM) más
// un pequeño margen antes de escribir el título.
export const CABECERA_ALTO_MM = 16;

function fiducial(cx, cy) {
  return { cx: cx * PX_POR_MM, cy: cy * PX_POR_MM };
}

// Centros de los 4 fiduciales, en px canónicos — igual que antes
// (.hoja-fiducial-{tl,tr,br,bl}, top/left/right/bottom: 3mm, tamaño 5mm).
export function fiducialesFijos() {
  const inset = FIDUCIAL_INSET_MM + FIDUCIAL_SIZE_MM / 2;
  return {
    tl: fiducial(inset, inset),
    tr: fiducial(PAGE_W_MM - inset, inset),
    br: fiducial(PAGE_W_MM - inset, PAGE_H_MM - inset),
    bl: fiducial(inset, PAGE_H_MM - inset),
  };
}

// Caja del QR pequeño de página (exam_id + página, README §4.9/§4.10):
// centrado horizontalmente, pegado al margen inferior (su borde inferior
// coincide con la línea de los PADDING_MM, igual que los fiduciales) — antes
// pegado al borde derecho, cerca del contenido de cada ítem; centrado abajo
// queda más lejos de donde se escribe y no obliga a reservar ancho en cada
// línea de texto, solo un hueco fijo al final de cada página (hoja.js).
// En px canónicos, {x,y,w,h} de la esquina superior izquierda de la caja.
export function cajaQrPagina() {
  const w = QR_PAGINA_SIZE_MM * PX_POR_MM;
  const h = w;
  const x = ((PAGE_W_MM - QR_PAGINA_SIZE_MM) / 2) * PX_POR_MM;
  const y = (PAGE_H_MM - PADDING_MM) * PX_POR_MM - h;
  return { x, y, w, h };
}

// Caja del QR grande (token de la remesa, README §4.9): fija en la esquina
// superior izquierda del área de contenido de la página 1, justo debajo de la
// cabecera (que ahora empieza en PADDING_MM, no en el borde de la página) —
// ya no "primer bloque del flujo": al ser una posición fija (no depende de
// que haya o no otro contenido antes), el resto de la página de demografía
// empieza su flujo por debajo de esta caja en vez de encadenarse a ella (ver
// hoja.js).
export function cajaQrGrande() {
  const w = QR_GRANDE_SIZE_MM * PX_POR_MM;
  const h = w;
  const x = PADDING_MM * PX_POR_MM;
  const y = (PADDING_MM + CABECERA_ALTO_MM) * PX_POR_MM;
  return { x, y, w, h };
}
