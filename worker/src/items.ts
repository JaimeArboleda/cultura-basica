// Carga el banco de ítems desde data/items.json (fuente de verdad, README §4.2 y §8).
// Import estático: wrangler lo bundlea en el Worker en cada build/deploy, así que
// regenerar data/items.json (`npm run build:items`) y volver a desplegar el Worker
// es todo lo que hace falta para que un cambio en data/items/ llegue a producción.
// D1 nunca almacena contenido de ítems (ver schema/schema.sql).
import itemsRaw from "../../data/items.json";
import type { Item, ItemPublico, ItemPublicoRespondido, ItemRevision } from "./tipos";

export const bancoItems: Item[] = itemsRaw as Item[];

export const itemsPorId: ReadonlyMap<string, Item> = new Map(
  bancoItems.map((item) => [item.id, item])
);

export function obtenerItem(id: string): Item | undefined {
  return itemsPorId.get(id);
}

// Única función que produce lo que ve el cliente antes de contestar: nunca debe
// incluir la respuesta correcta (README §4.3).
export function paraCliente(item: Item): ItemPublico {
  return {
    id: item.id,
    formato: item.formato,
    enunciado: item.enunciado,
    texto: item.texto,
    opciones:
      item.formato === "opcion_multiple" || item.formato === "seleccion_multiple"
        ? item.opciones
        : null,
    elementos: item.formato === "ordenar" || item.formato === "clasificar" ? item.elementos : null,
    categorias: item.formato === "clasificar" ? item.categorias : null,
    nota_parcial_desactivada: item.nota_parcial_desactivada === true,
  };
}

// Para un ítem ya respondido de una sesión aún en curso (README §3, §8): igual
// que paraCliente(), pero añade lo que el usuario ya contestó, para poder
// reconstruir la pantalla de revisión pre-envío tras un refresco sin perder de
// vista las respuestas dadas antes del corte. No incluye acierto ni respuesta
// correcta (ver ItemPublicoRespondido).
export function paraClienteRespondido(
  item: Item,
  respuestaCruda: string | null
): ItemPublicoRespondido {
  let respuestaUsuario: unknown = null;
  if (respuestaCruda != null) {
    try {
      respuestaUsuario = JSON.parse(respuestaCruda);
    } catch {
      respuestaUsuario = respuestaCruda;
    }
  }
  return { ...paraCliente(item), respuesta_usuario: respuestaUsuario };
}

function respuestaCorrectaDe(item: Item): unknown {
  switch (item.formato) {
    case "abierto":
      return item.respuesta_canonica;
    case "opcion_multiple":
      return item.indice_correcto;
    case "seleccion_multiple":
      return item.opciones_correctas;
    case "ordenar":
      return item.elementos_ordenados;
    case "clasificar":
      return item.clasificacion_correcta;
  }
}

// Para la pantalla "ver respuestas" (solo sesiones completas, README §3): a
// diferencia de paraCliente(), sí revela la respuesta correcta.
export function paraRevision(
  item: Item,
  fila: { respuesta_cruda: string | null; acierto: number }
): ItemRevision {
  let respuestaUsuario: unknown = null;
  if (fila.respuesta_cruda != null) {
    try {
      respuestaUsuario = JSON.parse(fila.respuesta_cruda);
    } catch {
      respuestaUsuario = fila.respuesta_cruda;
    }
  }

  return {
    id: item.id,
    formato: item.formato,
    enunciado: item.enunciado,
    texto: item.texto,
    opciones:
      item.formato === "opcion_multiple" || item.formato === "seleccion_multiple"
        ? item.opciones
        : null,
    elementos: item.formato === "ordenar" || item.formato === "clasificar" ? item.elementos : null,
    categorias: item.formato === "clasificar" ? item.categorias : null,
    acierto: fila.acierto as 0 | 1,
    respuesta_usuario: respuestaUsuario,
    respuesta_correcta: respuestaCorrectaDe(item),
  };
}
