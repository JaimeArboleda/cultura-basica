// Fusiona data/items/<bloque>/*.json en data/items.json (la fuente de verdad, README §4.2).
// Cada ítem vive en su propio fichero para que las revisiones en PR sean manejables.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ITEMS_DIR = new URL("./items", import.meta.url).pathname;
const OUT_FILE = new URL("./items.json", import.meta.url).pathname;

const ORDEN_BLOQUES = [
  "filosofia",
  "historia",
  "lengua_literatura",
  "fisica_quimica",
  "biologia_geologia",
  "economia_politica",
  "geografia",
  "matematicas",
  "arte",
  "religion",
];

function cargarBloque(bloque) {
  const dir = join(ITEMS_DIR, bloque);
  const ficheros = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return ficheros
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const items = ORDEN_BLOQUES.flatMap(cargarBloque);

writeFileSync(OUT_FILE, JSON.stringify(items, null, 2) + "\n");
console.log(`Escritos ${items.length} ítems en data/items.json`);
