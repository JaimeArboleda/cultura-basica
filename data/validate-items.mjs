// Valida los invariantes de data/items.json (README §4.2).
// Se ejecuta tras `node data/build-items.mjs`. Pensado para correr en CI (README §8).
//
// El banco es fijo: 12 ítems fáciles + 12 difíciles (tipo "trivia") + 1 comentario de
// texto (tipo "comentario_texto") = 25 ítems. Los checks de forma de cada ítem
// (opciones, alias, etc.) se aplican siempre.
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

  if (!["trivia", "comentario_texto"].includes(it.tipo)) {
    err(`${ctx} tipo inválido: ${it.tipo}`);
  }
  if (it.tipo === "trivia" && !["facil", "dificil"].includes(it.dificultad)) {
    err(`${ctx} dificultad inválida para un ítem trivia: ${it.dificultad}`);
  }
  if (it.tipo === "comentario_texto") {
    if (it.dificultad !== null) {
      err(`${ctx} un comentario_texto no debe tener dificultad (debe ser null)`);
    }
    if (typeof it.texto !== "string" || it.texto.trim() === "") {
      err(`${ctx} comentario_texto sin texto`);
    }
  }
  if (
    !["abierto", "opcion_multiple", "seleccion_multiple", "ordenar", "clasificar"].includes(
      it.formato
    )
  ) {
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

  if (it.formato === "seleccion_multiple") {
    if (!Array.isArray(it.opciones) || it.opciones.length < 2) {
      err(`${ctx} seleccion_multiple debe tener al menos 2 opciones`);
    } else if (new Set(it.opciones).size !== it.opciones.length) {
      err(`${ctx} seleccion_multiple tiene opciones duplicadas`);
    }
    if (!Array.isArray(it.opciones_correctas) || it.opciones_correctas.length < 1) {
      err(`${ctx} seleccion_multiple debe tener al menos 1 opción correcta`);
    } else if (new Set(it.opciones_correctas).size !== it.opciones_correctas.length) {
      err(`${ctx} opciones_correctas tiene índices duplicados`);
    } else if (
      Array.isArray(it.opciones) &&
      it.opciones_correctas.some((i) => !Number.isInteger(i) || i < 0 || i >= it.opciones.length)
    ) {
      err(`${ctx} opciones_correctas tiene algún índice fuera de rango`);
    } else if (
      Array.isArray(it.opciones) &&
      it.opciones_correctas.length === it.opciones.length
    ) {
      err(`${ctx} seleccion_multiple no debe marcar todas las opciones como correctas`);
    }
    if (it.indice_correcto !== null) {
      err(`${ctx} seleccion_multiple no debe usar indice_correcto (usa opciones_correctas)`);
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
      // Una categoría sin elementos puede ser un distractor deliberado (p. ej. un
      // autor de más entre las opciones de clasificación), así que solo avisa en
      // vez de bloquear el build.
      const categoriasUsadas = new Set(Object.values(it.clasificacion_correcta));
      if (it.categorias.some((c) => !categoriasUsadas.has(c))) {
        warn(`${ctx} clasificar tiene alguna categoría sin ningún elemento asignado (posible distractor deliberado o error tipográfico)`);
      }
    }
  }

  if (it.nota_parcial_desactivada != null) {
    if (typeof it.nota_parcial_desactivada !== "boolean") {
      err(`${ctx} nota_parcial_desactivada debe ser boolean si está presente`);
    } else if (!["seleccion_multiple", "clasificar", "ordenar"].includes(it.formato)) {
      err(`${ctx} nota_parcial_desactivada solo tiene sentido en formatos con nota parcial (seleccion_multiple/clasificar/ordenar)`);
    }
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

// --- Checks globales ---
const TOTAL_FACILES = 12;
const TOTAL_DIFICILES = 12;
const TOTAL_COMENTARIO_TEXTO = 1;
const TOTAL_ITEMS = TOTAL_FACILES + TOTAL_DIFICILES + TOTAL_COMENTARIO_TEXTO; // 25

const facilesReales = items.filter((it) => it.tipo === "trivia" && it.dificultad === "facil").length;
const dificilesReales = items.filter((it) => it.tipo === "trivia" && it.dificultad === "dificil").length;
const comentarioTextoReales = items.filter((it) => it.tipo === "comentario_texto").length;

if (facilesReales !== TOTAL_FACILES) {
  err(`Se esperaban ${TOTAL_FACILES} ítems fáciles, hay ${facilesReales}`);
}
if (dificilesReales !== TOTAL_DIFICILES) {
  err(`Se esperaban ${TOTAL_DIFICILES} ítems difíciles, hay ${dificilesReales}`);
}
if (comentarioTextoReales !== TOTAL_COMENTARIO_TEXTO) {
  err(`Se esperaba ${TOTAL_COMENTARIO_TEXTO} comentario de texto, hay ${comentarioTextoReales}`);
}
if (items.length !== TOTAL_ITEMS) {
  err(`Se esperaban ${TOTAL_ITEMS} ítems en total, hay ${items.length}`);
}

const ids = items.map((it) => it.id);
if (new Set(ids).size !== ids.length) {
  err(`Hay ids de ítem duplicados`);
}

for (const a of avisos) console.warn("AVISO:", a);
for (const e of errores) console.error("ERROR:", e);

console.log(`\n${items.length} ítems, ${errores.length} errores, ${avisos.length} avisos.`);

if (errores.length > 0) {
  process.exit(1);
}
