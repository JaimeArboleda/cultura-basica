import { describe, expect, it } from "vitest";
import { bancoItems, obtenerItem, paraCliente } from "../src/items";

const CLAVES_PERMITIDAS = new Set([
  "id",
  "formato",
  "enunciado",
  "texto",
  "opciones",
  "elementos",
  "categorias",
  "nota_parcial_desactivada",
  "casillas_abierto",
  "num_correctas",
  "ejemplo_abierto",
]);

const CLAVES_PROHIBIDAS = [
  "respuesta_canonica",
  "alias",
  "alias_parcial",
  "tolerancia_edicion",
  "indice_correcto",
  "opciones_correctas",
  "elementos_ordenados",
  "clasificacion_correcta",
];

describe("banco de ítems", () => {
  it("carga los 25 ítems desde data/items.json", () => {
    expect(bancoItems.length).toBe(25);
  });

  it("obtenerItem encuentra un ítem real por id", () => {
    expect(obtenerItem(bancoItems[0].id)?.id).toBe(bancoItems[0].id);
  });

  it("obtenerItem devuelve undefined para un id inexistente", () => {
    expect(obtenerItem("NO-EXISTE-99")).toBeUndefined();
  });
});

describe("paraCliente: no debe filtrar la respuesta correcta", () => {
  for (const item of bancoItems) {
    it(`${item.id} (${item.formato}) no expone claves de respuesta`, () => {
      const publico = paraCliente(item);
      for (const clave of CLAVES_PROHIBIDAS) {
        expect(publico).not.toHaveProperty(clave);
      }
      for (const clave of Object.keys(publico)) {
        expect(CLAVES_PERMITIDAS.has(clave)).toBe(true);
      }
    });
  }

  it("un ítem opcion_multiple sí expone las 6 opciones (sin el índice correcto)", () => {
    const item = bancoItems.find((i) => i.formato === "opcion_multiple")!;
    const publico = paraCliente(item);
    expect(publico.opciones).toHaveLength(6);
  });

  it("un ítem seleccion_multiple expone las opciones sin las opciones_correctas", () => {
    const item = bancoItems.find((i) => i.formato === "seleccion_multiple")!;
    const publico = paraCliente(item);
    expect(publico.opciones).toEqual(item.opciones);
    expect(publico).not.toHaveProperty("opciones_correctas");
  });

  it("un ítem ordenar expone elementos en orden de presentación, no elementos_ordenados", () => {
    const item = bancoItems.find((i) => i.formato === "ordenar")!;
    const publico = paraCliente(item);
    expect(publico.elementos).toEqual(item.elementos);
  });

  it("un ítem clasificar expone categorias y elementos, no clasificacion_correcta", () => {
    // El formato sigue soportado aunque el banco actual de 25 ítems no incluya
    // ninguno: se salta el test si no hay ningún ítem clasificar que comprobar.
    const item = bancoItems.find((i) => i.formato === "clasificar");
    if (!item) return;
    const publico = paraCliente(item);
    expect(publico.categorias).toEqual(item.categorias);
    expect(publico.elementos).toEqual(item.elementos);
  });
});
