// Fusiona data/items/*.json en data/items.json (la fuente de verdad, README §4.2).
// Cada ítem vive en su propio fichero para que las revisiones en PR sean manejables.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ITEMS_DIR = new URL("./items", import.meta.url).pathname;
const OUT_FILE = new URL("./items.json", import.meta.url).pathname;

const ficheros = readdirSync(ITEMS_DIR).filter((f) => f.endsWith(".json"));
const items = ficheros
  .map((f) => JSON.parse(readFileSync(join(ITEMS_DIR, f), "utf8")))
  .sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(OUT_FILE, JSON.stringify(items, null, 2) + "\n");
console.log(`Escritos ${items.length} ítems en data/items.json`);
