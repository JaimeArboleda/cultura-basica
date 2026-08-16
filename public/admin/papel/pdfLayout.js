// Primitivas de maquetado puramente aritméticas (README §4.7, "Paginado
// fiable"): envuelto de texto y decisión de nº de columnas a partir de
// métricas REALES de la fuente ya incrustada (font.widthOfTextAtSize), nunca
// del DOM ni de ningún motor de renderizado. Esto es lo que hace que
// hoja.js (pdf-lib) produzca el MISMO PDF, byte a byte, en Node, en Chrome, en
// Firefox o en cualquier dispositivo — la propiedad que antes requería
// precalcular data/paginacion.json con Playwright (README, "Paginado fiable",
// ahora retirado: ver git log). No depende de pdf-lib más allá de la forma de
// `font` (duck-typed: cualquier objeto con `widthOfTextAtSize(texto, tamano)`
// sirve, incluido un doble de prueba en tests).
import { PT_POR_MM } from "./geometria.js";

export function mmAPt(mm) {
  return mm * PT_POR_MM;
}
export function ptAMm(pt) {
  return pt / PT_POR_MM;
}

// Alto de línea a partir del tamaño de fuente (pt): 1.28x es una relación
// habitual para texto compacto de una sola hoja impresa (más ajustado que el
// 1.35 de line-height que usaba el CSS anterior, a propósito — parte del
// objetivo de compactar la hoja).
export const FACTOR_INTERLINEADO = 1.28;
export function altoLineaPt(tamanoPt, factor = FACTOR_INTERLINEADO) {
  return tamanoPt * factor;
}

// Envuelve `texto` en líneas que quepan en `maxAnchoPt` con `font`/`tamanoPt`
// dados (word-wrap clásico, greedy). Una palabra individual más ancha que
// maxAnchoPt se deja sola en su línea (se sale un poco) en vez de partirla:
// no ocurre con el banco de ítems real (sin palabras sueltas absurdamente
// largas en español), y partir palabras a mitad sería peor para la lectura.
export function envolverTexto(font, tamanoPt, texto, maxAnchoPt) {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [""];
  const lineas = [];
  let actual = "";
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (!actual || font.widthOfTextAtSize(candidata, tamanoPt) <= maxAnchoPt) {
      actual = candidata;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  lineas.push(actual);
  return lineas;
}

// Decide en cuántas columnas (1 a maxColumnas) repartir una lista de
// `entradas` (opciones/elementos/categorías) dado el ancho disponible: cada
// candidato de nº de columnas se acepta si TODAS las entradas caben en una
// sola línea dentro de su columna a `tamanoPt` — empieza por el mayor nº de
// columnas y baja hasta que se cumpla, así prioriza compacidad sin arriesgar
// que una opción larga quede partida en 2 líneas dentro de una columna
// estrecha (eso es lo que compactaba de más y desalineaba filas en los
// prototipos previos del layout, README §checkpoint de layout).
export function elegirColumnas(font, tamanoPt, entradas, anchoDisponiblePt, { maxColumnas = 3, gapPt = mmAPt(4) } = {}) {
  for (let n = maxColumnas; n >= 2; n--) {
    const anchoCol = (anchoDisponiblePt - gapPt * (n - 1)) / n;
    const cabeEnUnaLinea = entradas.every((e) => font.widthOfTextAtSize(e, tamanoPt) <= anchoCol);
    if (cabeEnUnaLinea) return n;
  }
  return 1;
}

// Reparte `entradas` en una rejilla de `nCols` columnas, orden de lectura por
// COLUMNAS (la primera columna se rellena entera antes de pasar a la
// siguiente) — así una lista etiquetada A/B/C.../1/2/3... se lee de arriba a
// abajo dentro de cada columna en vez de saltar de 3 en 3 (p. ej. con 3
// columnas, la primera columna pasaba a ser A) D) G)... en vez de A) B) C)...,
// el motivo original de este cambio). Devuelve {filas, anchoColPt}, donde
// filas es un array (uno por fila visual) de arrays de {texto, indice, col}
// — indice es la posición original (para las etiquetas A/B/C... o 1/2/3...),
// col la columna en la que se dibuja.
export function distribuirEnRejilla(entradas, nCols, anchoDisponiblePt, gapPt = mmAPt(4)) {
  const anchoColPt = (anchoDisponiblePt - gapPt * (nCols - 1)) / nCols;
  const filasPorColumna = Math.ceil(entradas.length / nCols);
  const filas = Array.from({ length: filasPorColumna }, () => []);
  for (let col = 0; col < nCols; col++) {
    for (let fila = 0; fila < filasPorColumna; fila++) {
      const indice = col * filasPorColumna + fila;
      if (indice >= entradas.length) continue;
      filas[fila].push({ texto: entradas[indice], indice, col });
    }
  }
  return { filas, anchoColPt };
}
