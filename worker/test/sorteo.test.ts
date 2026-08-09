import { describe, expect, it } from "vitest";
import { ordenarTest, type Rng } from "../src/sorteo";
import { bancoItems } from "../src/items";

// RNG determinista basado en semilla, para tests reproducibles (mulberry32).
function rngConSemilla(semilla: number): Rng {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("ordenarTest", () => {
  it("devuelve exactamente los 25 ítems del banco", () => {
    const asignaciones = ordenarTest(bancoItems, rngConSemilla(1));
    expect(asignaciones.length).toBe(25);
    const ids = asignaciones.map((a) => a.item_id);
    expect(new Set(ids).size).toBe(25);
    for (const item of bancoItems) {
      expect(ids).toContain(item.id);
    }
  });

  it("orden_presentacion es una permutación de 0..24", () => {
    const asignaciones = ordenarTest(bancoItems, rngConSemilla(3));
    const ordenes = asignaciones.map((a) => a.orden_presentacion).sort((a, b) => a - b);
    expect(ordenes).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it("el orden de presentación varía entre sorteos con distinta semilla", () => {
    const primerosVistos = new Set<string>();
    for (let semilla = 0; semilla < 10; semilla++) {
      const asignaciones = ordenarTest(bancoItems, rngConSemilla(semilla));
      const primero = asignaciones.find((a) => a.orden_presentacion === 0)!;
      primerosVistos.add(primero.item_id);
    }
    expect(primerosVistos.size).toBeGreaterThan(1);
  });
});
