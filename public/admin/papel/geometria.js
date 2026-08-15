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

// Margen de contenido: más ajustado que el diseño anterior (18mm) porque
// ahora el objetivo es una hoja compacta (7-8 páginas en vez de 11) — sigue
// dejando hueco de sobra entre los fiduciales (a 3mm del borde) y el
// contenido para que detectarFiduciales() no confunda un bloque de texto con
// un fiducial.
export const PADDING_MM = 14;

export const FIDUCIAL_INSET_MM = 3; // distancia del borde de la página al fiducial más cercano
export const FIDUCIAL_SIZE_MM = 5;

export const QR_GRANDE_SIZE_MM = 22; // solo en la página 1, esquina superior izquierda del área de contenido
export const QR_PAGINA_SIZE_MM = 10; // en TODAS las páginas, borde derecho, centrado verticalmente
export const QR_PAGINA_RIGHT_INSET_MM = 4;

// Escala del canvas de referencia usado al digitalizar: cuanto mayor, más
// resolución para decodificar los QR y para la imagen que se manda a
// OCR-IA, a costa de más cómputo por warp. 3x da ~2382x3369px, de sobra.
export const ESCALA_DIGITALIZACION = 3;

// Cabecera de cada página: título + subtítulo + línea separadora. Altura fija
// (no depende de cuánto mida el texto real, que siempre cabe en una línea a
// estos tamaños) para poder reservar el hueco de forma determinista sin medir
// nada — hoja.js dibuja dentro de este presupuesto.
export const CABECERA_ALTO_MM = 11;

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

// Caja del QR pequeño de página (exam_id + página, README §4.9/§4.10): borde
// derecho, centrado verticalmente — en px canónicos, {x,y,w,h} de la esquina
// superior izquierda de la caja.
export function cajaQrPagina() {
  const w = QR_PAGINA_SIZE_MM * PX_POR_MM;
  const h = w;
  const x = (PAGE_W_MM - QR_PAGINA_RIGHT_INSET_MM) * PX_POR_MM - w;
  const y = (PAGE_H_MM / 2) * PX_POR_MM - h / 2;
  return { x, y, w, h };
}

// Caja del QR grande (token/versión/exam_id, README §4.9): fija en la esquina
// superior izquierda del área de contenido de la página 1, justo debajo de la
// cabecera — ya no "primer bloque del flujo": al ser una posición fija (no
// depende de que haya o no otro contenido antes), el resto de la página de
// demografía empieza su flujo por debajo de esta caja en vez de encadenarse a
// ella (ver hoja.js).
export function cajaQrGrande() {
  const w = QR_GRANDE_SIZE_MM * PX_POR_MM;
  const h = w;
  const x = PADDING_MM * PX_POR_MM;
  const y = CABECERA_ALTO_MM * PX_POR_MM;
  return { x, y, w, h };
}
