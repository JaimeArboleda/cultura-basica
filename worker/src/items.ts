// Carga el banco de ítems desde data/items.json (fuente de verdad, README §4.2 y §8).
// Import estático: wrangler lo bundlea en el Worker en cada build/deploy, así que
// regenerar data/items.json (`npm run build:items`) y volver a desplegar el Worker
// es todo lo que hace falta para que un cambio en data/items/ llegue a producción.
// D1 nunca almacena contenido de ítems (ver schema/schema.sql).
import itemsRaw from "../../data/items.json";
import type { Item, ItemPublico } from "./tipos";

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
    bloque: item.bloque,
    formato: item.formato,
    enunciado: item.enunciado,
    texto: item.texto,
    opciones: item.formato === "opcion_multiple" ? item.opciones : null,
    elementos: item.formato === "ordenar" || item.formato === "clasificar" ? item.elementos : null,
    categorias: item.formato === "clasificar" ? item.categorias : null,
  };
}
