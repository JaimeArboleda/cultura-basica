import { describe, expect, it } from "vitest";
import { corregirAbierto, corregirOpcionMultiple } from "../src/correccion";
import { bancoItems } from "../src/items";
import {
  puntuarClasificar,
  puntuarItem,
  puntuarOrdenar,
  puntuarSeleccionMultiple,
  puntuarSesion,
} from "../src/puntuacion";
import type { Item } from "../src/tipos";

function itemBase(overrides: Partial<Item> = {}): Item {
  return {
    id: "TEST-01",
    tipo: "trivia",
    dificultad: "facil",
    formato: "abierto",
    enunciado: "¿?",
    texto: null,
    respuesta_canonica: null,
    alias: null,
    alias_parcial: null,
    tolerancia_edicion: null,
    opciones: null,
    indice_correcto: null,
    opciones_correctas: null,
    elementos: null,
    elementos_ordenados: null,
    categorias: null,
    clasificacion_correcta: null,
    ...overrides,
  };
}

describe("puntuarSeleccionMultiple", () => {
  const item = itemBase({
    formato: "seleccion_multiple",
    opciones: ["a", "b", "c", "d"],
    opciones_correctas: [1, 3],
  });

  it("marca exactamente el conjunto correcto: 1.0", () => {
    expect(puntuarSeleccionMultiple(item, [1, 3])).toBe(1);
  });

  it("no marca nada: acierta las 2 no marcadas correctas, falla las 2 marcables -> 2/4", () => {
    expect(puntuarSeleccionMultiple(item, [])).toBe(0.5);
  });

  it("una marca de más (falso positivo): 3/4", () => {
    expect(puntuarSeleccionMultiple(item, [1, 3, 0])).toBeCloseTo(0.75);
  });
});

describe("puntuarClasificar", () => {
  const item = itemBase({
    formato: "clasificar",
    elementos: ["a", "b", "c", "d", "e", "f", "g", "h"],
    clasificacion_correcta: {
      a: "X", b: "X", c: "Y", d: "Y", e: "Z", f: "Z", g: "W", h: "W",
    },
  });

  it("mapeo completo correcto: 1.0", () => {
    expect(puntuarClasificar(item, item.clasificacion_correcta!)).toBe(1);
  });

  it("6/8 correctos: 0.75", () => {
    const parcial = { ...item.clasificacion_correcta!, g: "X", h: "X" };
    expect(puntuarClasificar(item, parcial)).toBeCloseTo(0.75);
  });

  it("envío vacío: 0", () => {
    expect(puntuarClasificar(item, {})).toBe(0);
  });
});

describe("puntuarOrdenar (por parejas)", () => {
  const item = itemBase({
    formato: "ordenar",
    elementos_ordenados: ["a", "b", "c", "d"],
  });

  it("C(4,2) = 6 parejas totales", () => {
    expect(puntuarOrdenar(item, ["a", "b", "c", "d"])).toBe(1);
  });

  it("orden totalmente invertido: 0/6", () => {
    expect(puntuarOrdenar(item, ["d", "c", "b", "a"])).toBe(0);
  });

  it("un intercambio adyacente: 5/6", () => {
    expect(puntuarOrdenar(item, ["a", "c", "b", "d"])).toBeCloseTo(5 / 6);
  });

  it("k=3 -> 3 parejas, k=10 -> 45 parejas", () => {
    const k3 = itemBase({ formato: "ordenar", elementos_ordenados: ["a", "b", "c"] });
    expect(puntuarOrdenar(k3, ["b", "a", "c"])).toBeCloseTo(2 / 3);

    const k10 = itemBase({
      formato: "ordenar",
      elementos_ordenados: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });
    expect(puntuarOrdenar(k10, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])).toBe(1);
  });
});

describe("puntuarItem: abierto/opcion_multiple coincide con la corrección estricta", () => {
  const abiertos = bancoItems.filter((i) => i.formato === "abierto");
  const opcionMultiple = bancoItems.filter((i) => i.formato === "opcion_multiple");

  it("abierto: fracción == acierto estricto", () => {
    expect(abiertos.length).toBeGreaterThan(0);
    for (const item of abiertos) {
      const canonica = item.respuesta_canonica ?? "";
      expect(puntuarItem(item, canonica)).toBe(corregirAbierto(item, canonica).acierto);
      expect(puntuarItem(item, "xxxxxxxxxxzzzzzzzzzz")).toBe(
        corregirAbierto(item, "xxxxxxxxxxzzzzzzzzzz").acierto
      );
    }
  });

  it("opcion_multiple: fracción == acierto estricto", () => {
    expect(opcionMultiple.length).toBeGreaterThan(0);
    for (const item of opcionMultiple) {
      expect(puntuarItem(item, item.indice_correcto)).toBe(
        corregirOpcionMultiple(item, item.indice_correcto!).acierto
      );
      const incorrecto = (item.indice_correcto! + 1) % 6;
      expect(puntuarItem(item, incorrecto)).toBe(corregirOpcionMultiple(item, incorrecto).acierto);
    }
  });
});

describe("puntuarSesion", () => {
  it("suma las fracciones de los ítems respondidos", () => {
    const item1 = itemBase({ id: "A", formato: "opcion_multiple", indice_correcto: 1 });
    const item2 = itemBase({
      id: "B",
      formato: "clasificar",
      elementos: ["x", "y"],
      clasificacion_correcta: { x: "P", y: "Q" },
    });
    const mapa = new Map<string, Item>([
      ["A", item1],
      ["B", item2],
    ]);

    const total = puntuarSesion(
      [
        { item_id: "A", respuesta_cruda: JSON.stringify(1) },
        { item_id: "B", respuesta_cruda: JSON.stringify({ x: "P", y: "Z" }) },
      ],
      (id) => mapa.get(id)
    );
    expect(total).toBeCloseTo(1 + 0.5);
  });

  it("ítems sin responder o retirados del banco no rompen y no puntúan", () => {
    const total = puntuarSesion(
      [
        { item_id: "NO-EXISTE", respuesta_cruda: null },
        { item_id: "NO-EXISTE", respuesta_cruda: JSON.stringify(1) },
      ],
      () => undefined
    );
    expect(total).toBe(0);
  });
});
