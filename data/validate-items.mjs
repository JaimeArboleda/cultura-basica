// Valida los invariantes de data/items.json (README §4.2).
// Se ejecuta tras `node data/build-items.mjs`. Pensado para correr en CI (README §8).
//
// Durante la Fase 1 el banco se redacta bloque a bloque, así que los checks de
// conteo/distribución/ancla solo se aplican a los bloques que YA tienen 12 ítems;
// los checks de forma de cada ítem (opciones, alias, etc.) se aplican siempre.
import { readFileSync } from "node:fs";

const ITEMS_FILE = new URL("./items.json", import.meta.url).pathname;
const items = JSON.parse(readFileSync(ITEMS_FILE, "utf8"));

const errores = [];
const avisos = [];

function err(msg) {
  errores.push(msg);
}
function warn(msg) {
  avisos.push(msg);
}

// --- Checks por ítem (siempre) ---
for (const it of items) {
  const ctx = `[${it.id}]`;

  if (!["facil", "medio", "dificil"].includes(it.dificultad)) {
    err(`${ctx} dificultad inválida: ${it.dificultad}`);
  }
  if (!["abierto", "opcion_multiple", "ordenar", "clasificar"].includes(it.formato)) {
    err(`${ctx} formato inválido: ${it.formato}`);
  }

  if (it.texto != null && (typeof it.texto !== "string" || it.texto.trim() === "")) {
    err(`${ctx} texto debe ser una cadena no vacía si está presente`);
  }

  if (it.formato === "opcion_multiple") {
    if (!Array.isArray(it.opciones) || it.opciones.length !== 6) {
      err(`${ctx} opcion_multiple debe tener exactamente 6 opciones`);
    }
    if (
      typeof it.indice_correcto !== "number" ||
      it.indice_correcto < 0 ||
      it.indice_correcto > 5
    ) {
      err(`${ctx} indice_correcto inválido`);
    }
  }

  if (it.formato === "abierto") {
    if (!it.respuesta_canonica) {
      err(`${ctx} abierto sin respuesta_canonica`);
    }
    if (!Array.isArray(it.alias) || it.alias.length < 1) {
      err(`${ctx} abierto sin al menos un alias`);
    }
    if (typeof it.tolerancia_edicion !== "number" || it.tolerancia_edicion < 0) {
      err(`${ctx} abierto sin tolerancia_edicion válida`);
    }
    if (it.alias_parcial != null) {
      if (!Array.isArray(it.alias_parcial) || it.alias_parcial.length < 1) {
        err(`${ctx} alias_parcial debe ser un array no vacío si está presente`);
      } else if ((it.alias ?? []).some((a) => it.alias_parcial.includes(a))) {
        err(`${ctx} alias_parcial no debe solaparse con alias`);
      }
    }
  } else if (it.alias_parcial != null) {
    err(`${ctx} alias_parcial solo aplica a ítems abiertos`);
  }

  if (it.formato === "ordenar") {
    if (!Array.isArray(it.elementos) || it.elementos.length < 4) {
      err(`${ctx} ordenar debe tener al menos 4 elementos`);
    } else if (new Set(it.elementos).size !== it.elementos.length) {
      err(`${ctx} ordenar tiene elementos duplicados`);
    }
    if (!Array.isArray(it.elementos_ordenados) || it.elementos_ordenados.length < 4) {
      err(`${ctx} ordenar debe tener elementos_ordenados`);
    } else if (
      Array.isArray(it.elementos) &&
      JSON.stringify([...it.elementos].sort()) !== JSON.stringify([...it.elementos_ordenados].sort())
    ) {
      err(`${ctx} elementos_ordenados debe ser una permutación de elementos`);
    } else if (
      Array.isArray(it.elementos) &&
      JSON.stringify(it.elementos) === JSON.stringify(it.elementos_ordenados)
    ) {
      err(`${ctx} elementos ya está en el orden correcto (elementos_ordenados), no plantea reto`);
    }
  }

  if (it.formato === "clasificar") {
    if (!Array.isArray(it.categorias) || it.categorias.length < 2) {
      err(`${ctx} clasificar debe tener al menos 2 categorías`);
    } else if (new Set(it.categorias).size !== it.categorias.length) {
      err(`${ctx} clasificar tiene categorías duplicadas`);
    }
    if (!Array.isArray(it.elementos) || it.elementos.length < 4) {
      err(`${ctx} clasificar debe tener al menos 4 elementos`);
    } else if (new Set(it.elementos).size !== it.elementos.length) {
      err(`${ctx} clasificar tiene elementos duplicados`);
    }
    if (
      typeof it.clasificacion_correcta !== "object" ||
      it.clasificacion_correcta === null ||
      Array.isArray(it.clasificacion_correcta)
    ) {
      err(`${ctx} clasificar debe tener clasificacion_correcta (objeto elemento → categoría)`);
    } else if (Array.isArray(it.elementos) && Array.isArray(it.categorias)) {
      const claves = Object.keys(it.clasificacion_correcta);
      if (JSON.stringify([...claves].sort()) !== JSON.stringify([...it.elementos].sort())) {
        err(`${ctx} clasificacion_correcta debe tener exactamente una entrada por cada elemento`);
      }
      for (const [el, cat] of Object.entries(it.clasificacion_correcta)) {
        if (!it.categorias.includes(cat)) {
          err(`${ctx} clasificacion_correcta asigna "${el}" a una categoría inexistente: ${cat}`);
        }
      }
      const categoriasUsadas = new Set(Object.values(it.clasificacion_correcta));
      if (it.categorias.some((c) => !categoriasUsadas.has(c))) {
        err(`${ctx} clasificar tiene alguna categoría sin ningún elemento asignado`);
      }
    }
  }

  if (it.ancla && it.dificultad !== "medio") {
    err(`${ctx} ancla debe tener dificultad 'medio'`);
  }

  if (String(it.enunciado ?? "").startsWith("TODO")) {
    warn(`${ctx} enunciado pendiente de redactar`);
  }
  if (
    it.respuesta_canonica === "TODO" ||
    (it.alias ?? []).includes("TODO") ||
    (it.opciones ?? []).some((o) => o.startsWith("TODO")) ||
    (it.elementos ?? []).some((e) => e.startsWith("TODO")) ||
    (it.elementos_ordenados ?? []).some((e) => e.startsWith("TODO")) ||
    (it.categorias ?? []).some((c) => c.startsWith("TODO"))
  ) {
    warn(`${ctx} contenido de placeholder pendiente de completar`);
  }
}

// --- Checks por bloque (solo si el bloque ya tiene 12 ítems) ---
const porBloque = new Map();
for (const it of items) {
  if (!porBloque.has(it.bloque)) porBloque.set(it.bloque, []);
  porBloque.get(it.bloque).push(it);
}

for (const [bloque, its] of porBloque) {
  if (its.length !== 12) {
    warn(`[${bloque}] tiene ${its.length}/12 ítems (bloque incompleto, aún no evaluado)`);
    continue;
  }
  const anclas = its.filter((i) => i.ancla);
  if (anclas.length !== 1) {
    err(`[${bloque}] debe tener exactamente 1 ítem ancla, tiene ${anclas.length}`);
  }
  const porDificultad = { facil: 0, medio: 0, dificil: 0 };
  for (const i of its) porDificultad[i.dificultad]++;
  if (porDificultad.facil !== 4 || porDificultad.medio !== 4 || porDificultad.dificil !== 4) {
    err(
      `[${bloque}] distribución de dificultad incorrecta: ` +
        `facil=${porDificultad.facil} medio=${porDificultad.medio} dificil=${porDificultad.dificil} (esperado 4/4/4)`
    );
  }
  const abiertos = its.filter((i) => i.formato === "abierto").length;
  if (abiertos > 6) {
    err(`[${bloque}] ítems abiertos (${abiertos}) supera el máximo del 50% (§4.2)`);
  }
}

// --- Checks globales (solo si el banco está completo) ---
const TOTAL_BLOQUES = 13;
const TOTAL_ITEMS = TOTAL_BLOQUES * 12; // 156

if (items.length === TOTAL_ITEMS) {
  if (porBloque.size !== TOTAL_BLOQUES) {
    err(`Se esperaban ${TOTAL_BLOQUES} bloques, hay ${porBloque.size}`);
  }
  const abiertosGlobal = items.filter((i) => i.formato === "abierto").length;
  if (abiertosGlobal > TOTAL_ITEMS * 0.4) {
    err(`Ítems abiertos globales (${abiertosGlobal}) supera el máximo del 40% (§1.5)`);
  }
} else {
  warn(`Banco incompleto: ${items.length}/${TOTAL_ITEMS} ítems`);
}

for (const a of avisos) console.warn("AVISO:", a);
for (const e of errores) console.error("ERROR:", e);

console.log(`\n${items.length} ítems, ${errores.length} errores, ${avisos.length} avisos.`);

if (errores.length > 0) {
  process.exit(1);
}
