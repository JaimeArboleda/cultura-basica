import { describe, expect, it } from "vitest";
import {
  corregirAbierto,
  corregirClasificar,
  corregirOpcionMultiple,
  corregirOrdenar,
  levenshtein,
  normalizar,
} from "../src/correccion";
import { bancoItems } from "../src/items";
import type { Item } from "../src/tipos";

function itemAbierto(overrides: Partial<Item> = {}): Item {
  return {
    id: "TEST-01",
    bloque: "test",
    dificultad: "facil",
    formato: "abierto",
    enunciado: "¿?",
    texto: null,
    respuesta_canonica: "Platón",
    alias: ["platon", "plato", "platon de atenas"],
    alias_parcial: null,
    tolerancia_edicion: 1,
    opciones: null,
    indice_correcto: null,
    elementos: null,
    elementos_ordenados: null,
    categorias: null,
    clasificacion_correcta: null,
    ...overrides,
  };
}

describe("normalizar", () => {
  it("quita acentos, mayúsculas y puntuación, y colapsa espacios", () => {
    expect(normalizar("  Platón,   de Atenas!!  ")).toBe("platon de atenas");
  });
});

describe("levenshtein", () => {
  it("cuenta ediciones mínimas", () => {
    expect(levenshtein("gato", "gato")).toBe(0);
    expect(levenshtein("gato", "gata")).toBe(1);
    expect(levenshtein("gato", "pato")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("corregirAbierto", () => {
  it("acierta con la respuesta canónica", () => {
    const r = corregirAbierto(itemAbierto(), "Platón");
    expect(r).toEqual({ acierto: 1, estado_correccion: "auto" });
  });

  it("acierta con un alias sin acentos", () => {
    const r = corregirAbierto(itemAbierto(), "platon");
    expect(r).toEqual({ acierto: 1, estado_correccion: "auto" });
  });

  it("acierta con una errata dentro de la tolerancia", () => {
    // tolerancia_edicion=1, "platos" vs "plato" (5 letras, alias) -> distancia 1
    const r = corregirAbierto(itemAbierto(), "platos de atenas");
    expect(r).toEqual({ acierto: 1, estado_correccion: "auto" });
  });

  it("falla con una errata fuera de la tolerancia", () => {
    const r = corregirAbierto(itemAbierto(), "aristoteles");
    expect(r).toEqual({ acierto: 0, estado_correccion: "auto" });
  });

  it("no aplica tolerancia a respuestas de 4 caracteres o menos", () => {
    // "Dios" (4 chars) con alias "dios": exacto tras normalizar -> acierta
    const item = itemAbierto({ alias: ["dios"], tolerancia_edicion: 2 });
    expect(corregirAbierto(item, "Dios")).toEqual({ acierto: 1, estado_correccion: "auto" });
    // "Dio" (3 chars, a 1 de distancia de "dios") no debe aceptarse aunque
    // tolerancia_edicion sea 2, porque son <=4 caracteres: exige igualdad exacta.
    expect(corregirAbierto(item, "Dio")).toEqual({ acierto: 0, estado_correccion: "auto" });
  });

  it("respuesta vacía es fallo directo sin gastar Levenshtein", () => {
    expect(corregirAbierto(itemAbierto(), "   ")).toEqual({ acierto: 0, estado_correccion: "auto" });
  });

  it("matchea alias_parcial como fallo distinguido", () => {
    const item = itemAbierto({
      respuesta_canonica: "Atenas",
      alias: ["atenas"],
      alias_parcial: ["grecia"],
      tolerancia_edicion: 1,
    });
    expect(corregirAbierto(item, "Grecia")).toEqual({ acierto: 0, estado_correccion: "parcial" });
  });

  it("cada ítem abierto real del banco acierta con su propia respuesta canónica y variantes sin acentos", () => {
    const abiertos = bancoItems.filter((i) => i.formato === "abierto");
    expect(abiertos.length).toBeGreaterThan(0);
    for (const item of abiertos) {
      const canonica = item.respuesta_canonica ?? "";
      const r = corregirAbierto(item, canonica);
      expect(r.acierto, `${item.id}: "${canonica}" debería acertar`).toBe(1);

      const sinAcentos = normalizar(canonica);
      const r2 = corregirAbierto(item, sinAcentos);
      expect(r2.acierto, `${item.id}: "${sinAcentos}" debería acertar`).toBe(1);

      const incorrecta = corregirAbierto(item, "xxxxxxxxxxzzzzzzzzzz");
      expect(incorrecta.acierto, `${item.id}: respuesta disparatada no debería acertar`).toBe(0);
    }
  });
});

describe("corregirOpcionMultiple", () => {
  const item = itemAbierto({ formato: "opcion_multiple", indice_correcto: 2 });
  it("acierta con el índice correcto", () => {
    expect(corregirOpcionMultiple(item, 2)).toEqual({ acierto: 1, estado_correccion: "auto" });
  });
  it("falla con otro índice", () => {
    expect(corregirOpcionMultiple(item, 0)).toEqual({ acierto: 0, estado_correccion: "auto" });
  });
});

describe("corregirOrdenar", () => {
  const item = itemAbierto({
    formato: "ordenar",
    elementos_ordenados: ["Bach", "Haydn", "Mozart"],
  });
  it("acierta con igualdad exacta de secuencia", () => {
    expect(corregirOrdenar(item, ["Bach", "Haydn", "Mozart"])).toEqual({
      acierto: 1,
      estado_correccion: "auto",
    });
  });
  it("falla si el orden no coincide", () => {
    expect(corregirOrdenar(item, ["Haydn", "Bach", "Mozart"])).toEqual({
      acierto: 0,
      estado_correccion: "auto",
    });
  });
});

describe("corregirClasificar", () => {
  const item = itemAbierto({
    formato: "clasificar",
    clasificacion_correcta: { Kant: "Deontología", Bentham: "Utilitarismo" },
  });
  it("acierta con la asignación completa correcta", () => {
    expect(
      corregirClasificar(item, { Kant: "Deontología", Bentham: "Utilitarismo" })
    ).toEqual({ acierto: 1, estado_correccion: "auto" });
  });
  it("falla si algún elemento está mal clasificado", () => {
    expect(
      corregirClasificar(item, { Kant: "Utilitarismo", Bentham: "Utilitarismo" })
    ).toEqual({ acierto: 0, estado_correccion: "auto" });
  });
});
