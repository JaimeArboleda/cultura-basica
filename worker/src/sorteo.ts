// Sorteo de ítems (README §1.4). Funciones puras: reciben el banco y una fuente de
// aleatoriedad inyectable (para tests deterministas) y devuelven asignaciones, sin
// tocar D1 ni Math.random directamente.
import type { Fase, Item } from "./tipos";

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

function elegirUno<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

export interface AsignacionItem {
  item_id: string;
  fase: Fase;
  orden_presentacion: number;
}

// 30 ítems: por cada uno de los 10 bloques, el ancla (dificultad medio, fijo) + 1
// fácil aleatorio + 1 difícil aleatorio (README §1.4). Orden de bloques y orden dentro
// del trío, aleatorios.
export function sortearCorto(banco: Item[], rng: Rng = rngCriptografico): AsignacionItem[] {
  const bloques = [...new Set(banco.map((i) => i.bloque))];
  const bloquesEnOrden = shuffle(bloques, rng);

  const asignaciones: AsignacionItem[] = [];
  for (const bloque of bloquesEnOrden) {
    const itemsBloque = banco.filter((i) => i.bloque === bloque);
    const ancla = itemsBloque.find((i) => i.ancla);
    if (!ancla) {
      throw new Error(`Bloque sin ítem ancla: ${bloque}`);
    }
    const facil = elegirUno(
      itemsBloque.filter((i) => i.dificultad === "facil"),
      rng
    );
    const dificil = elegirUno(
      itemsBloque.filter((i) => i.dificultad === "dificil"),
      rng
    );
    const trio = shuffle([ancla, facil, dificil], rng);
    for (const item of trio) {
      asignaciones.push({ item_id: item.id, fase: "corto", orden_presentacion: 0 });
    }
  }

  return asignaciones.map((a, i) => ({ ...a, orden_presentacion: i }));
}

// Los 90 ítems restantes del banco (todo lo no sorteado en el modo corto), en orden
// aleatorio. El README solo define estructura por bloque/dificultad para el modo
// corto (§1.4); la extensión no tiene esa restricción.
export function sortearExtension(
  banco: Item[],
  idsYaUsados: ReadonlySet<string>,
  rng: Rng = rngCriptografico
): AsignacionItem[] {
  const restantes = banco.filter((i) => !idsYaUsados.has(i.id));
  const enOrden = shuffle(restantes, rng);
  return enOrden.map((item, i) => ({
    item_id: item.id,
    fase: "extension",
    orden_presentacion: i,
  }));
}
