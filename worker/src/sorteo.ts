// Orden de presentación del test (README §1.4). El banco es fijo (36 ítems, uno por
// bloque y dificultad): no hay selección que hacer, solo aleatorizar el orden en que
// se presentan para que los bloques no queden agrupados por tema (README §3).
import type { Item } from "./tipos";

export type Rng = () => number; // en [0, 1)

export function rngCriptografico(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export interface AsignacionItem {
  item_id: string;
  orden_presentacion: number;
}

export function ordenarTest(banco: Item[], rng: Rng = rngCriptografico): AsignacionItem[] {
  return shuffle(banco, rng).map((item, i) => ({ item_id: item.id, orden_presentacion: i }));
}
