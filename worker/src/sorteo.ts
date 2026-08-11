// Orden de presentación del test (README §1.4). Antes se aleatorizaba por sesión;
// ahora es fijo e igual para todas las sesiones, definido en data/orden-test.json
// (README §4.2, §8) — un array con los 25 ids del banco en el orden en que se
// presentan. Editar ese fichero (y redesplegar el Worker) para cambiar el orden.
import ordenIdsRaw from "../../data/orden-test.json";
import type { Item } from "./tipos";

const ordenIds = ordenIdsRaw as string[];

export interface AsignacionItem {
  item_id: string;
  orden_presentacion: number;
}

export function ordenarTest(banco: Item[]): AsignacionItem[] {
  const idsBanco = new Set(banco.map((item) => item.id));
  const orden = ordenIds.filter((id) => idsBanco.has(id));

  // Defensivo por si el banco y data/orden-test.json se desincronizan (un ítem
  // nuevo aún no añadido al orden fijo, o uno retirado del banco que sigue en
  // el fichero): los ids del banco que falten en el orden fijo se añaden al
  // final, en vez de perderlos o romper el sorteo.
  const vistos = new Set(orden);
  const faltantes = banco.map((item) => item.id).filter((id) => !vistos.has(id));

  return [...orden, ...faltantes].map((item_id, i) => ({ item_id, orden_presentacion: i }));
}
