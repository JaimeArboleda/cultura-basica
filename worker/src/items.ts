// Carga el banco de ítems desde data/items.json (fuente de verdad, README §4.2 y §8).
// Import estático: wrangler lo bundlea en el Worker en cada build/deploy, así que
// regenerar data/items.json (`npm run build:items`) y volver a desplegar el Worker
// es todo lo que hace falta para que un cambio en data/items/ llegue a producción.
// D1 nunca almacena contenido de ítems (ver schema/schema.sql).
import itemsRaw from "../../data/items.json";
import type {
  Dificultad,
  Formato,
  Item,
  ItemPublico,
  ItemPublicoRespondido,
  ItemRevision,
  TipoItem,
} from "./tipos";

export const bancoItems: Item[] = itemsRaw as Item[];

export const itemsPorId: ReadonlyMap<string, Item> = new Map(
  bancoItems.map((item) => [item.id, item])
);

export function obtenerItem(id: string): Item | undefined {
  return itemsPorId.get(id);
}

// Nº mínimo de casillas para una respuesta "abierto" cuando la canónica es
// corta — mismo valor que public/admin/papel/hoja.js::CONFIG_POR_DEFECTO.
// casillasAbierto (duplicado a propósito, mismo motivo que LETRAS/CATALOGOS
// entre worker/ y public/: hoja.js es código de cliente, no se puede
// importar aquí).
const CASILLAS_ABIERTO_MINIMO = 18;

// Nº de casillas que se imprimen de verdad para la respuesta de un ítem
// "abierto": la respuesta canónica completa tiene que caber físicamente en
// la hoja (+2 de margen), nunca menos que el mínimo por defecto — mismo
// cálculo que hacía antes public/admin/papel/hoja.js a partir de
// item.respuesta_canonica.length, pero ESE campo nunca llega al cliente
// (ItemPublico no lo incluye, README §4.3), así que en producción la hoja
// real seguía imprimiendo siempre el mínimo fijo pese a la corrección
// anterior — bug real, descubierto al construir el esquema de OCR-IA para
// "abierto" (necesita esta misma longitud EXACTA para restringir el
// esquema). Se calcula aquí, server-side, donde sí está respuesta_canonica,
// y se expone como longitud (nunca como el texto) vía
// ItemPublico.casillas_abierto.
export function casillasAbiertoPara(item: Pick<Item, "formato" | "respuesta_canonica">): number | null {
  if (item.formato !== "abierto") return null;
  return Math.max(CASILLAS_ABIERTO_MINIMO, (item.respuesta_canonica?.length ?? 0) + 2);
}

// Ver ItemPublico.num_correctas: revela cuántas opciones hay que marcar
// (nunca cuáles) solo cuando nota_parcial_desactivada ya señala que el propio
// enunciado pide un número concreto — en cualquier otro "seleccion_multiple"
// se sigue pidiendo "marca TODAS las que correspondan", sin dar ninguna
// pista sobre el nº de opciones correctas.
export function numCorrectasPara(item: Pick<Item, "formato" | "nota_parcial_desactivada" | "opciones_correctas">): number | null {
  if (item.formato !== "seleccion_multiple" || item.nota_parcial_desactivada !== true) return null;
  return item.opciones_correctas?.length ?? null;
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
    casillas_abierto: casillasAbiertoPara(item),
    num_correctas: numCorrectasPara(item),
    ejemplo_abierto: item.formato === "abierto" ? (item.ejemplo_abierto ?? null) : null,
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

export function respuestaCorrectaDe(item: Item): unknown {
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

// Fila del banco de ítems para el dataset del panel de admin (§4.5,
// estadísticas avanzadas): a diferencia de ItemPublico, sí incluye la
// respuesta correcta — es justo lo que hace falta para poder analizar en qué
// ítems/formatos hay más error, cruzando por item_id con "respuestas" del
// mismo dataset (worker/src/db.ts::obtenerDatasetCompleto). No sale de aquí
// nada que no estuviera ya en data/items.json (público en el repo).
export interface FilaItemDataset {
  id: string;
  tipo: TipoItem;
  dificultad: Dificultad | null;
  formato: Formato;
  enunciado: string;
  texto: string | null;
  opciones: string[] | null;
  elementos: string[] | null;
  categorias: string[] | null;
  respuesta_correcta: unknown;
}

export function paraDataset(item: Item): FilaItemDataset {
  return {
    id: item.id,
    tipo: item.tipo,
    dificultad: item.dificultad,
    formato: item.formato,
    enunciado: item.enunciado,
    texto: item.texto,
    opciones:
      item.formato === "opcion_multiple" || item.formato === "seleccion_multiple"
        ? item.opciones
        : null,
    elementos: item.formato === "ordenar" || item.formato === "clasificar" ? item.elementos : null,
    categorias: item.formato === "clasificar" ? item.categorias : null,
    respuesta_correcta: respuestaCorrectaDe(item),
  };
}
