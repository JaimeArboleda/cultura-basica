// Genera data/debug.html: una web autocontenida (HTML+CSS+JS embebidos, sin
// dependencias externas) para depurar el banco de ítems fuera de línea.
// Ver README §4.4 para cuándo y cómo regenerarla.
//
// Muestra las preguntas agrupadas por bloque tal y como se verían en la web
// definitiva, pero además:
//   - metadatos de depuración por ítem (id, dificultad, ancla, formato) que la
//     web de usuario nunca muestra,
//   - al responder, cómo quedaría catalogada la respuesta (acierto/fallo/parcial,
//     estado_correccion, alias que matcheó, distancia de Levenshtein, etc.),
//   - estadísticas por bloque (nº de ítems por dificultad/formato, si tiene ancla).
//
// Los bloques sin ítems redactados (solo con .gitkeep) simplemente no aparecen:
// no es un error, es el estado esperado durante la Fase 1 (README §6).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ITEMS_DIR = new URL("./items", import.meta.url).pathname;
const OUT_FILE = new URL("./debug.html", import.meta.url).pathname;

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

const NOMBRE_BLOQUE = {
  filosofia: "Filosofía",
  historia: "Historia",
  lengua_literatura: "Lengua y Literatura",
  fisica_quimica: "Física y Química",
  biologia_geologia: "Biología y Geología",
  economia_politica: "Economía y Política",
  geografia: "Geografía",
  matematicas: "Matemáticas",
  arte: "Arte",
  religion: "Religión",
};

// Orden de depuración: fácil, luego medio (ancla primero), luego difícil.
// Dentro de cada grupo, por id. Así se ve de un vistazo la progresión de
// dificultad del bloque, sin saltos, en vez del orden alfabético de ficheros.
const RANGO_DIFICULTAD = { facil: 0, medio: 1, dificil: 2 };

function ordenDebug(a, b) {
  const da = RANGO_DIFICULTAD[a.dificultad] ?? 99;
  const db = RANGO_DIFICULTAD[b.dificultad] ?? 99;
  if (da !== db) return da - db;
  if (a.ancla !== b.ancla) return a.ancla ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function cargarBloque(bloque) {
  const dir = join(ITEMS_DIR, bloque);
  let ficheros;
  try {
    ficheros = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return ficheros
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .sort(ordenDebug);
}

const bloques = ORDEN_BLOQUES.map((bloque) => ({
  bloque,
  nombre: NOMBRE_BLOQUE[bloque],
  items: cargarBloque(bloque),
})).filter((b) => b.items.length > 0);

const bloquesVacios = ORDEN_BLOQUES.filter(
  (b) => !bloques.some((x) => x.bloque === b)
);

const totalItems = bloques.reduce((n, b) => n + b.items.length, 0);

console.log(
  `Cargados ${totalItems} ítems en ${bloques.length} bloques.` +
    (bloquesVacios.length
      ? ` Sin ítems (omitidos): ${bloquesVacios.join(", ")}.`
      : "")
);

const DATA_JSON = JSON.stringify(bloques);

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cultura Básica — Debug de ítems</title>
<style>
:root {
  --bg: #f6f5f2;
  --panel: #ffffff;
  --ink: #1c1b1a;
  --muted: #6b6560;
  --border: #e2ddd5;
  --accent: #7a4f2b;
  --ok: #2e7d32;
  --ok-bg: #eaf5ea;
  --parcial: #b8860b;
  --parcial-bg: #fbf3df;
  --fail: #b3261e;
  --fail-bg: #fcebea;
  --pending: #6b6560;
  --pending-bg: #eeece8;
  --chip-bg: #efe9df;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17161a;
    --panel: #232228;
    --ink: #ece9e4;
    --muted: #a39d95;
    --border: #38363c;
    --accent: #d8a978;
    --ok: #7fd88f;
    --ok-bg: #16301c;
    --parcial: #e3c05b;
    --parcial-bg: #362c11;
    --fail: #f0918c;
    --fail-bg: #3a1613;
    --pending: #a39d95;
    --pending-bg: #2b2a2f;
    --chip-bg: #322f34;
  }
}
:root[data-theme="dark"] {
  --bg: #17161a; --panel: #232228; --ink: #ece9e4; --muted: #a39d95;
  --border: #38363c; --accent: #d8a978; --ok: #7fd88f; --ok-bg: #16301c;
  --parcial: #e3c05b; --parcial-bg: #362c11; --fail: #f0918c; --fail-bg: #3a1613;
  --pending: #a39d95; --pending-bg: #2b2a2f; --chip-bg: #322f34;
}
:root[data-theme="light"] {
  --bg: #f6f5f2; --panel: #ffffff; --ink: #1c1b1a; --muted: #6b6560;
  --border: #e2ddd5; --accent: #7a4f2b; --ok: #2e7d32; --ok-bg: #eaf5ea;
  --parcial: #b8860b; --parcial-bg: #fbf3df; --fail: #b3261e; --fail-bg: #fcebea;
  --pending: #6b6560; --pending-bg: #eeece8; --chip-bg: #efe9df;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.45;
}
header.top {
  position: sticky; top: 0; z-index: 10;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  padding: 12px 16px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px;
}
header.top h1 { font-size: 15px; margin: 0; white-space: nowrap; }
header.top .resumen { color: var(--muted); font-size: 13px; }
header.top .acciones { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit; cursor: pointer; border: 1px solid var(--border);
  background: var(--panel); color: var(--ink); border-radius: 8px;
  padding: 7px 12px;
}
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button:hover { filter: brightness(0.97); }
main { max-width: 900px; margin: 0 auto; padding: 16px; }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 20px; position: sticky; top: 53px; z-index: 9; background: var(--bg); padding-top: 4px; padding-bottom: 4px; }
nav.toc button {
  font-size: 12.5px; color: var(--ink);
  background: var(--chip-bg); border: 1px solid transparent; border-radius: 999px; padding: 5px 12px;
}
nav.toc button.activa { background: var(--accent); color: #fff; }
section.bloque {
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  margin-bottom: 22px; overflow: hidden;
}
section.bloque.oculto { display: none !important; }
.bloque-header { padding: 14px 18px; border-bottom: 1px solid var(--border); }
.bloque-header h2 { margin: 0 0 6px; font-size: 17px; }
.stats { display: flex; flex-wrap: wrap; gap: 6px 8px; font-size: 12px; color: var(--muted); }
.stats .chip { background: var(--chip-bg); border-radius: 999px; padding: 2px 9px; }
.items { padding: 10px 18px 18px; }
.item {
  border-top: 1px dashed var(--border);
  padding: 16px 0;
}
.item:first-child { border-top: none; }
.item-debug {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
}
.badge {
  font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border);
  color: var(--muted); background: var(--chip-bg); font-family: ui-monospace, Menlo, Consolas, monospace;
}
.badge.dif-facil { color: var(--ok); }
.badge.dif-medio { color: var(--parcial); }
.badge.dif-dificil { color: var(--fail); }
.badge.ancla { color: var(--accent); border-color: var(--accent); }
.enunciado { font-size: 15.5px; margin: 0 0 10px; }
.opciones { display: flex; flex-direction: column; gap: 6px; }
.opciones label {
  display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px;
  border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: 14px;
}
.opciones label:hover { background: var(--chip-bg); }
input[type="text"] {
  width: 100%; max-width: 360px; font: inherit; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--ink);
}
ul.ordenar { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 420px; }
ul.ordenar li {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px;
  background: var(--bg); font-size: 14px; cursor: grab;
}
ul.ordenar li.dragging { opacity: 0.4; }
ul.ordenar li .handle { color: var(--muted); font-size: 12px; }
ul.ordenar li .mover { margin-left: auto; display: flex; gap: 4px; }
ul.ordenar li .mover button { padding: 2px 7px; font-size: 12px; }
.clasificar { display: flex; flex-direction: column; gap: 12px; }
.clasificar .bandeja {
  list-style: none; margin: 0; padding: 8px; display: flex; flex-wrap: wrap; gap: 8px;
  border: 1px dashed var(--border); border-radius: 8px; min-height: 44px;
}
.clasificar .bandeja.pool { background: var(--chip-bg); }
.clasificar .cajas { display: flex; flex-wrap: wrap; gap: 10px; }
.clasificar .caja { flex: 1 1 200px; min-width: 180px; }
.clasificar .caja h4 { margin: 0 0 6px; font-size: 12.5px; color: var(--muted); font-weight: 600; }
.clasificar .ficha {
  border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px;
  background: var(--panel); font-size: 13.5px; cursor: grab; user-select: none;
}
.clasificar .ficha.dragging { opacity: 0.4; }
.clasificar .bandeja.dragover { border-color: var(--accent); }
.resultado {
  margin-top: 10px; font-size: 13px; border-radius: 8px; padding: 8px 10px; display: none;
}
.resultado.show { display: block; }
.resultado.ok { background: var(--ok-bg); color: var(--ok); }
.resultado.parcial { background: var(--parcial-bg); color: var(--parcial); }
.resultado.fail { background: var(--fail-bg); color: var(--fail); }
.resultado.pending { background: var(--pending-bg); color: var(--pending); }
.resultado dl { margin: 4px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; }
.resultado dt { opacity: 0.75; }
.resultado dt::after { content: ":"; }
footer.bar {
  position: sticky; bottom: 0; background: var(--panel); border-top: 1px solid var(--border);
  padding: 10px 16px; display: flex; justify-content: center; gap: 10px;
}
.oculto { display: none !important; }
</style>
</head>
<body>
<header class="top">
  <h1>Cultura Básica · Debug</h1>
  <span class="resumen" id="resumen-global"></span>
  <div class="acciones">
    <button id="btn-limpiar">Limpiar respuestas</button>
    <button id="btn-corregir" class="primary">Comprobar todo</button>
  </div>
</header>
<main>
  <nav class="toc" id="toc"></nav>
  <div id="bloques"></div>
</main>
<footer class="bar">
  <button id="btn-corregir-2" class="primary">Comprobar todo</button>
</footer>

<script>
const BLOQUES = ${DATA_JSON};
</script>
<script>
// --- Normalización y distancia de Levenshtein, igual que README §1.6 ---
function normalizar(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]/gu, "")
    .replace(/\\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const coste = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + coste
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function distanciaMinima(respuestaNorm, lista) {
  let mejor = null;
  for (const alias of lista ?? []) {
    const aliasNorm = normalizar(alias);
    const d = levenshtein(respuestaNorm, aliasNorm);
    if (mejor === null || d < mejor.distancia) mejor = { alias, aliasNorm, distancia: d };
  }
  return mejor;
}

// Corrige un ítem 'abierto' según el algoritmo del README §1.6.
function corregirAbierto(item, respuestaCruda) {
  const respuestaNorm = normalizar(respuestaCruda);
  if (respuestaNorm === "") {
    return { estado: "pending", acierto: null, detalle: { motivo: "sin respuesta" } };
  }
  // Sin tolerancia para respuestas de ≤4 caracteres (deben coincidir exactas).
  const tolerancia = respuestaNorm.length <= 4 ? 0 : (item.tolerancia_edicion ?? 0);

  const match = distanciaMinima(respuestaNorm, item.alias);
  if (match && match.distancia <= tolerancia) {
    return {
      estado: "ok", acierto: 1,
      detalle: {
        estado_correccion: "auto",
        alias_match: match.alias,
        distancia: match.distancia,
        tolerancia_aplicada: tolerancia,
      },
    };
  }
  const matchParcial = distanciaMinima(respuestaNorm, item.alias_parcial);
  if (matchParcial && matchParcial.distancia <= tolerancia) {
    return {
      estado: "parcial", acierto: 0,
      detalle: {
        estado_correccion: "parcial",
        alias_parcial_match: matchParcial.alias,
        distancia: matchParcial.distancia,
        tolerancia_aplicada: tolerancia,
      },
    };
  }
  return {
    estado: "fail", acierto: 0,
    detalle: {
      estado_correccion: "auto",
      alias_mas_cercano: match ? match.alias : null,
      distancia_minima: match ? match.distancia : null,
      tolerancia_aplicada: tolerancia,
    },
  };
}

function corregirOpcionMultiple(item, indiceElegido) {
  if (indiceElegido === null || indiceElegido === undefined) {
    return { estado: "pending", acierto: null, detalle: { motivo: "sin respuesta" } };
  }
  const acierto = Number(indiceElegido) === item.indice_correcto ? 1 : 0;
  return {
    estado: acierto ? "ok" : "fail",
    acierto,
    detalle: {
      estado_correccion: "auto",
      opcion_elegida: item.opciones[indiceElegido],
      opcion_correcta: item.opciones[item.indice_correcto],
    },
  };
}

function corregirOrdenar(item, ordenActual) {
  if (!ordenActual) return { estado: "pending", acierto: null, detalle: { motivo: "sin respuesta" } };
  const acierto = JSON.stringify(ordenActual) === JSON.stringify(item.elementos_ordenados) ? 1 : 0;
  return {
    estado: acierto ? "ok" : "fail",
    acierto,
    detalle: {
      estado_correccion: "auto",
      orden_enviado: ordenActual.join(" → "),
      orden_correcto: item.elementos_ordenados.join(" → "),
    },
  };
}

function corregirClasificar(item, asignacionActual) {
  if (!asignacionActual || Object.keys(asignacionActual).length !== item.elementos.length) {
    return { estado: "pending", acierto: null, detalle: { motivo: "sin responder / incompleto" } };
  }
  const acierto = item.elementos.every(
    (el) => asignacionActual[el] === item.clasificacion_correcta[el]
  )
    ? 1
    : 0;
  return {
    estado: acierto ? "ok" : "fail",
    acierto,
    detalle: {
      estado_correccion: "auto",
      asignacion_enviada: item.elementos.map((el) => \`\${el} → \${asignacionActual[el]}\`).join(", "),
      asignacion_correcta: item.elementos.map((el) => \`\${el} → \${item.clasificacion_correcta[el]}\`).join(", "),
    },
  };
}

// --- Render ---
const $bloques = document.getElementById("bloques");
const $toc = document.getElementById("toc");
const $resumen = document.getElementById("resumen-global");

function contar(items, campo) {
  const c = {};
  for (const it of items) c[it[campo]] = (c[it[campo]] ?? 0) + 1;
  return c;
}

function chipsCuenta(c, prefijo) {
  return Object.entries(c)
    .map(([k, v]) => \`<span class="chip">\${prefijo ? prefijo + " " : ""}\${k}: \${v}</span>\`)
    .join("");
}

let totalItems = 0;
for (const b of BLOQUES) totalItems += b.items.length;
$resumen.textContent = \`\${BLOQUES.length} bloques · \${totalItems} ítems cargados\`;

for (const b of BLOQUES) {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.textContent = \`\${b.nombre} (\${b.items.length})\`;
  tab.dataset.bloque = b.bloque;
  tab.addEventListener("click", () => mostrarBloque(b.bloque));
  $toc.appendChild(tab);

  const porDif = contar(b.items, "dificultad");
  const porFormato = contar(b.items, "formato");
  const ancla = b.items.find((i) => i.ancla);

  const section = document.createElement("section");
  section.className = "bloque";
  section.id = \`bloque-\${b.bloque}\`;
  section.innerHTML = \`
    <div class="bloque-header">
      <h2>\${b.nombre}</h2>
      <div class="stats">
        <span class="chip"><strong>\${b.items.length}</strong> ítems</span>
        \${chipsCuenta(porDif)}
        \${chipsCuenta(porFormato)}
        <span class="chip">ancla: \${ancla ? ancla.id : "—"}</span>
      </div>
    </div>
    <div class="items"></div>
  \`;
  const $items = section.querySelector(".items");

  for (const item of b.items) {
    $items.appendChild(renderItem(item));
  }
  $bloques.appendChild(section);
}

function mostrarBloque(bloque) {
  document.querySelectorAll("section.bloque").forEach((s) => {
    s.classList.toggle("oculto", s.id !== \`bloque-\${bloque}\`);
  });
  document.querySelectorAll("nav.toc button").forEach((btn) => {
    btn.classList.toggle("activa", btn.dataset.bloque === bloque);
  });
  window.scrollTo({ top: 0 });
}

if (BLOQUES.length > 0) mostrarBloque(BLOQUES[0].bloque);

function renderItem(item) {
  const div = document.createElement("div");
  div.className = "item";
  div.dataset.itemId = item.id;

  const debugBadges = \`
    <span class="badge">\${item.id}</span>
    <span class="badge dif-\${item.dificultad}">\${item.dificultad}</span>
    <span class="badge">\${item.formato}</span>
    \${item.ancla ? '<span class="badge ancla">⚓ ancla</span>' : ""}
  \`;

  let cuerpo = "";
  if (item.formato === "abierto") {
    cuerpo = \`<input type="text" data-role="respuesta" placeholder="Escribe la respuesta…" autocomplete="off">\`;
  } else if (item.formato === "opcion_multiple") {
    cuerpo = \`<div class="opciones">\${item.opciones
      .map(
        (op, i) =>
          \`<label><input type="radio" name="op-\${item.id}" value="\${i}"> \${op}</label>\`
      )
      .join("")}</div>\`;
  } else if (item.formato === "ordenar") {
    cuerpo = \`<ul class="ordenar" data-role="ordenar">\${item.elementos
      .map((el) => \`<li draggable="true"><span class="handle">⠿</span><span class="texto">\${el}</span><span class="mover"><button type="button" data-mover="up">↑</button><button type="button" data-mover="down">↓</button></span></li>\`)
      .join("")}</ul>\`;
  } else if (item.formato === "clasificar") {
    cuerpo = \`<div class="clasificar" data-role="clasificar">
      <ul class="bandeja pool" data-caja="__pool__">\${item.elementos
        .map((el) => \`<li class="ficha" draggable="true" data-elemento="\${el}">\${el}</li>\`)
        .join("")}</ul>
      <div class="cajas">\${item.categorias
        .map(
          (cat) =>
            \`<div class="caja"><h4>\${cat}</h4><ul class="bandeja" data-caja="\${cat}"></ul></div>\`
        )
        .join("")}</div>
    </div>\`;
  }

  div.innerHTML = \`
    <div class="item-debug">\${debugBadges}</div>
    <p class="enunciado">\${item.enunciado}</p>
    \${cuerpo}
    <div class="resultado" data-role="resultado"></div>
  \`;

  if (item.formato === "ordenar") {
    activarOrdenar(div.querySelector("ul.ordenar"));
  } else if (item.formato === "clasificar") {
    activarClasificar(div.querySelector('[data-role="clasificar"]'));
  }

  return div;
}

function activarOrdenar(ul) {
  let dragEl = null;
  ul.addEventListener("dragstart", (e) => {
    dragEl = e.target.closest("li");
    dragEl.classList.add("dragging");
  });
  ul.addEventListener("dragend", () => dragEl && dragEl.classList.remove("dragging"));
  ul.addEventListener("dragover", (e) => {
    e.preventDefault();
    const after = [...ul.querySelectorAll("li:not(.dragging)")].find(
      (li) => e.clientY <= li.getBoundingClientRect().top + li.getBoundingClientRect().height / 2
    );
    if (after) ul.insertBefore(dragEl, after);
    else ul.appendChild(dragEl);
  });
  ul.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mover]");
    if (!btn) return;
    const li = btn.closest("li");
    if (btn.dataset.mover === "up" && li.previousElementSibling) {
      li.parentNode.insertBefore(li, li.previousElementSibling);
    } else if (btn.dataset.mover === "down" && li.nextElementSibling) {
      li.parentNode.insertBefore(li.nextElementSibling, li);
    }
  });
}

function activarClasificar(root) {
  let dragEl = null;
  root.addEventListener("dragstart", (e) => {
    dragEl = e.target.closest(".ficha");
    if (dragEl) dragEl.classList.add("dragging");
  });
  root.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("dragging");
    root.querySelectorAll(".bandeja.dragover").forEach((b) => b.classList.remove("dragover"));
  });
  root.querySelectorAll("ul.bandeja").forEach((bandeja) => {
    bandeja.addEventListener("dragover", (e) => {
      e.preventDefault();
      bandeja.classList.add("dragover");
    });
    bandeja.addEventListener("dragleave", () => bandeja.classList.remove("dragover"));
    bandeja.addEventListener("drop", (e) => {
      e.preventDefault();
      bandeja.classList.remove("dragover");
      if (dragEl) bandeja.appendChild(dragEl);
    });
  });
}

function leerClasificacion(root) {
  const asignacion = {};
  root.querySelectorAll('ul.bandeja[data-caja]:not([data-caja="__pool__"]) .ficha').forEach((li) => {
    asignacion[li.dataset.elemento] = li.closest("ul.bandeja").dataset.caja;
  });
  return asignacion;
}

function itemPorId(id) {
  for (const b of BLOQUES) {
    const it = b.items.find((i) => i.id === id);
    if (it) return it;
  }
  return null;
}

function corregirTarjeta(div) {
  const item = itemPorId(div.dataset.itemId);
  const $res = div.querySelector('[data-role="resultado"]');
  let resultado;

  if (item.formato === "abierto") {
    const valor = div.querySelector('[data-role="respuesta"]').value;
    resultado = corregirAbierto(item, valor);
  } else if (item.formato === "opcion_multiple") {
    const marcado = div.querySelector(\`input[name="op-\${item.id}"]:checked\`);
    resultado = corregirOpcionMultiple(item, marcado ? marcado.value : null);
  } else if (item.formato === "ordenar") {
    const li = [...div.querySelectorAll('ul.ordenar li .texto')].map((n) => n.textContent);
    const sinTocar = JSON.stringify(li) === JSON.stringify(item.elementos);
    resultado = corregirOrdenar(item, li.length ? li : null);
    if (sinTocar) resultado.detalle.aviso = "orden de presentación sin modificar";
  } else if (item.formato === "clasificar") {
    const asignacion = leerClasificacion(div.querySelector('[data-role="clasificar"]'));
    resultado = corregirClasificar(item, asignacion);
  }

  $res.className = "resultado show " + resultado.estado;
  const etiqueta = { ok: "✔ Acierto", parcial: "◐ Parcial (fallo puntuado, categoría distinta)", fail: "✘ Fallo", pending: "— Sin responder" }[resultado.estado];
  const filas = Object.entries(resultado.detalle)
    .map(([k, v]) => \`<dt>\${k}</dt><dd>\${v ?? "—"}</dd>\`)
    .join("");
  $res.innerHTML = \`<strong>\${etiqueta}</strong><dl>\${filas}</dl>\`;
}

function bloqueActivo() {
  return document.querySelector("section.bloque:not(.oculto)");
}

function comprobarTodo() {
  const bloque = bloqueActivo();
  if (!bloque) return;
  bloque.querySelectorAll(".item").forEach(corregirTarjeta);
}

function limpiarTodo() {
  const bloque = bloqueActivo();
  if (!bloque) return;
  bloque.querySelectorAll('input[type="text"]').forEach((i) => (i.value = ""));
  bloque.querySelectorAll('input[type="radio"]').forEach((i) => (i.checked = false));
  bloque.querySelectorAll(".resultado").forEach((r) => {
    r.className = "resultado";
    r.innerHTML = "";
  });
  bloque.querySelectorAll("ul.ordenar").forEach((ul) => {
    const item = itemPorId(ul.closest(".item").dataset.itemId);
    const original = [...ul.querySelectorAll("li")];
    const porTexto = new Map(original.map((li) => [li.querySelector(".texto").textContent, li]));
    for (const el of item.elementos) ul.appendChild(porTexto.get(el));
  });
  bloque.querySelectorAll('[data-role="clasificar"]').forEach((root) => {
    const pool = root.querySelector('ul.bandeja[data-caja="__pool__"]');
    root.querySelectorAll(".ficha").forEach((li) => pool.appendChild(li));
  });
}

document.getElementById("btn-corregir").addEventListener("click", comprobarTodo);
document.getElementById("btn-corregir-2").addEventListener("click", comprobarTodo);
document.getElementById("btn-limpiar").addEventListener("click", limpiarTodo);
</script>
</body>
</html>
`;

writeFileSync(OUT_FILE, html);
console.log(`Escrito data/debug.html (${(html.length / 1024).toFixed(0)} KB)`);
