import { describe, expect, it } from "vitest";
import { ordenarTest } from "../src/sorteo";
import { bancoItems } from "../src/items";
import ordenIds from "../../data/orden-test.json";

describe("ordenarTest", () => {
  it("devuelve exactamente los 25 ítems del banco", () => {
    const asignaciones = ordenarTest(bancoItems);
    expect(asignaciones.length).toBe(25);
    const ids = asignaciones.map((a) => a.item_id);
    expect(new Set(ids).size).toBe(25);
    for (const item of bancoItems) {
      expect(ids).toContain(item.id);
    }
  });

  it("orden_presentacion es una permutación de 0..24", () => {
    const asignaciones = ordenarTest(bancoItems);
    const ordenes = asignaciones.map((a) => a.orden_presentacion).sort((a, b) => a - b);
    expect(ordenes).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it("el orden es fijo e igual al de data/orden-test.json, no aleatorio por sesión", () => {
    const asignaciones1 = ordenarTest(bancoItems);
    const asignaciones2 = ordenarTest(bancoItems);
    expect(asignaciones1).toEqual(asignaciones2);

    const idsEnOrden = [...asignaciones1]
      .sort((a, b) => a.orden_presentacion - b.orden_presentacion)
      .map((a) => a.item_id);
    expect(idsEnOrden).toEqual(ordenIds);
  });
});
