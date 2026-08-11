// Puntuación fraccionaria por ítem, usada SOLO para la nota global 0-25 (y su
// derivada 0-10 mostrada al usuario) y para el percentil — nunca para decidir qué
// cuenta como acierto: eso sigue siendo el acierto 0/1 binario y estricto de
// correccion.ts, almacenado en respuestas.acierto y sin cambios.
//
// Cada ítem puntúa en [0,1]:
// - abierto / opcion_multiple: 0 o 1, delegando en la corrección estricta.
// - seleccion_multiple: nº de opciones cuyo estado marcado/no-marcado coincide con
//   la verdad, dividido por el nº total de opciones.
// - clasificar: nº de elementos con categoría correcta, dividido por el nº de
//   elementos.
// - ordenar: de las C(k,2) parejas de elementos, nº de parejas cuyo orden relativo
//   coincide con el correcto, dividido por C(k,2).
import { corregirAbierto, corregirOpcionMultiple } from "./correccion";
import type { Item } from "./tipos";

function numPares(k: number): number {
  return (k * (k - 1)) / 2;
}

export function puntuarSeleccionMultiple(item: Item, seleccionadas: number[]): number {
  const n = item.opciones?.length ?? 0;
  if (n === 0) return 0;
  const correctas = new Set(item.opciones_correctas ?? []);
  const marcadas = new Set(Array.isArray(seleccionadas) ? seleccionadas : []);
  let aciertos = 0;
  for (let i = 0; i < n; i++) {
    if (marcadas.has(i) === correctas.has(i)) aciertos++;
  }
  return aciertos / n;
}

export function puntuarClasificar(item: Item, clasificacion: Record<string, string>): number {
  const esperado = item.clasificacion_correcta ?? {};
  const elementos = item.elementos ?? [];
  if (elementos.length === 0) return 0;
  const recibido = clasificacion ?? {};
  let aciertos = 0;
  for (const el of elementos) {
    if (recibido[el] != null && recibido[el] === esperado[el]) aciertos++;
  }
  return aciertos / elementos.length;
}

export function puntuarOrdenar(item: Item, respuestaOrden: string[]): number {
  const correcto = item.elementos_ordenados ?? [];
  const k = correcto.length;
  const totalPares = numPares(k);
  if (totalPares === 0) return 0;
  const orden = Array.isArray(respuestaOrden) ? respuestaOrden : [];
  const posUsuario = new Map(orden.map((el, i) => [el, i]));
  let aciertosPares = 0;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const pa = posUsuario.get(correcto[i]);
      const pb = posUsuario.get(correcto[j]);
      if (pa != null && pb != null && pa < pb) aciertosPares++;
    }
  }
  return aciertosPares / totalPares;
}

export function puntuarItem(item: Item, respuestaCruda: unknown): number {
  switch (item.formato) {
    case "abierto":
      return typeof respuestaCruda === "string"
        ? corregirAbierto(item, respuestaCruda).acierto
        : 0;
    case "opcion_multiple":
      return typeof respuestaCruda === "number"
        ? corregirOpcionMultiple(item, respuestaCruda).acierto
        : 0;
    case "seleccion_multiple":
      return puntuarSeleccionMultiple(item, Array.isArray(respuestaCruda) ? respuestaCruda : []);
    case "ordenar":
      return puntuarOrdenar(item, Array.isArray(respuestaCruda) ? respuestaCruda : []);
    case "clasificar":
      return puntuarClasificar(
        item,
        typeof respuestaCruda === "object" && respuestaCruda !== null && !Array.isArray(respuestaCruda)
          ? (respuestaCruda as Record<string, string>)
          : {}
      );
  }
}

// Suma la puntuación fraccionaria de todos los ítems respondidos de una sesión
// (rango [0, N]). Se calcula bajo demanda a partir de respuesta_cruda ya
// almacenada — no requiere ninguna columna nueva por-ítem.
export function puntuarSesion(
  respuestas: { item_id: string; respuesta_cruda: string | null }[],
  itemDeId: (itemId: string) => Item | undefined
): number {
  let total = 0;
  for (const r of respuestas) {
    const item = itemDeId(r.item_id);
    if (!item) continue; // ítem retirado del banco: no puntúa
    let raw: unknown = null;
    if (r.respuesta_cruda != null) {
      try {
        raw = JSON.parse(r.respuesta_cruda);
      } catch {
        raw = null;
      }
    }
    total += puntuarItem(item, raw);
  }
  return total;
}
