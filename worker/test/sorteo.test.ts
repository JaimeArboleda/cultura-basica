import { describe, expect, it } from "vitest";
import { sortearCorto, sortearExtension, type Rng } from "../src/sorteo";
import { bancoItems, itemsPorId } from "../src/items";

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

describe("sortearCorto", () => {
  it("devuelve exactamente 30 ítems: 1 ancla + 1 fácil + 1 difícil por cada uno de los 10 bloques", () => {
    const asignaciones = sortearCorto(bancoItems, rngConSemilla(1));
    expect(asignaciones.length).toBe(30);

    const porBloque = new Map<string, string[]>();
    for (const a of asignaciones) {
      const item = itemsPorId.get(a.item_id)!;
      const lista = porBloque.get(item.bloque) ?? [];
      lista.push(item.id);
      porBloque.set(item.bloque, lista);
    }
    expect(porBloque.size).toBe(10);

    for (const [, ids] of porBloque) {
      expect(ids.length).toBe(3);
      const items = ids.map((id) => itemsPorId.get(id)!);
      expect(items.filter((i) => i.ancla).length).toBe(1);
      expect(items.filter((i) => i.dificultad === "facil").length).toBe(1);
      expect(items.filter((i) => i.dificultad === "dificil").length).toBe(1);
    }
  });

  it("no repite ítems", () => {
    const asignaciones = sortearCorto(bancoItems, rngConSemilla(2));
    const ids = asignaciones.map((a) => a.item_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orden_presentacion es una permutación de 0..29", () => {
    const asignaciones = sortearCorto(bancoItems, rngConSemilla(3));
    const ordenes = asignaciones.map((a) => a.orden_presentacion).sort((a, b) => a - b);
    expect(ordenes).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("el fácil/difícil elegido varía entre sorteos con distinta semilla", () => {
    const facilesVistos = new Set<string>();
    for (let semilla = 0; semilla < 30; semilla++) {
      const asignaciones = sortearCorto(bancoItems, rngConSemilla(semilla));
      const primerFacilFilosofia = asignaciones
        .map((a) => itemsPorId.get(a.item_id)!)
        .find((i) => i.bloque === "filosofia" && i.dificultad === "facil");
      if (primerFacilFilosofia) facilesVistos.add(primerFacilFilosofia.id);
    }
    expect(facilesVistos.size).toBeGreaterThan(1);
  });
});

describe("sortearExtension", () => {
  it("devuelve exactamente los 90 ítems restantes tras el sorteo corto", () => {
    const corto = sortearCorto(bancoItems, rngConSemilla(4));
    const idsUsados = new Set(corto.map((a) => a.item_id));
    const extension = sortearExtension(bancoItems, idsUsados, rngConSemilla(5));

    expect(extension.length).toBe(90);
    const idsExtension = new Set(extension.map((a) => a.item_id));
    expect(idsExtension.size).toBe(90);
    for (const id of idsExtension) {
      expect(idsUsados.has(id)).toBe(false);
    }

    const ordenes = extension.map((a) => a.orden_presentacion).sort((a, b) => a - b);
    expect(ordenes).toEqual(Array.from({ length: 90 }, (_, i) => i));
  });
});
