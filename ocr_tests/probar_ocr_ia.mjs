// Test de digitalización contra la API real de OpenAI (README del proyecto,
// §4.7/§6): lee las instancias generadas por generar.mjs (ocr_tests/<persona>/),
// las manda al motor de OCR-IA real del Worker desplegado
// (`POST /api/admin/ocr-ia`) y compara el resultado contra
// respuestas-esperadas.json — en particular los casos que motivaron este
// script: campos censales perdidos, precedencia Respuesta/Corrección, valores
// fuera de formato en una casilla de opción y respuestas abiertas
// incompletas. Al final, crea una sesión real por instancia
// (`POST /api/admin/digitalizacion`) bajo el token reservado de pruebas
// (`tokens.es_prueba`, README §4.5) para probar también el extremo a extremo,
// sin ensuciar las estadísticas del piloto.
//
// Deliberadamente NO se ejecuta como parte de `npm test`: necesita red, una
// API key de OpenAI real configurada en el Worker (gasta dinero de verdad) y
// un Worker ya desplegado (o `wrangler dev` local) con sesión de admin. Se
// deja como script aparte, igual que generar.mjs.
//
// Variables de entorno requeridas:
//   CULTURA_BASICA_API_BASE    URL base del Worker, p. ej.
//                              http://127.0.0.1:8787 (wrangler dev) o el
//                              *.workers.dev desplegado.
//   CULTURA_BASICA_ADMIN_TOKEN Token de sesión de admin (Authorization:
//                              Bearer …) — se obtiene entrando al panel
//                              (/admin) y copiando `cb_admin_token` de
//                              localStorage tras iniciar sesión con Google.
// Opcionales:
//   CULTURA_BASICA_MODELO      Modelo a usar (por defecto gpt-5-mini).
//   CULTURA_BASICA_PERSONAS    Lista separada por comas de personas a probar
//                              (por defecto, todas las carpetas de ocr_tests/
//                              con respuestas-esperadas.json).
//
// Uso: node ocr_tests/probar_ocr_ia.mjs
import { readFile, readdir } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { crearContextoFuentes, calcularManifiesto, LETRAS } from "../public/admin/papel/hoja.js";
import { CATALOGOS } from "../public/js/demografia.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");

const API_BASE = process.env.CULTURA_BASICA_API_BASE;
const ADMIN_TOKEN = process.env.CULTURA_BASICA_ADMIN_TOKEN;
const MODELO = process.env.CULTURA_BASICA_MODELO || "gpt-5-mini";
// Override opcional de reasoning_effort (issue #31): solo para comparar
// contra la API real si subir el esfuerzo de razonamiento por encima de
// "minimal" (el valor por defecto del Worker) mejora algún fallo concreto —
// nunca lo manda el panel de admin real.
const REASONING_EFFORT = process.env.CULTURA_BASICA_REASONING_EFFORT || undefined;

// Mismo cálculo que worker/src/items.ts::casillasAbiertoPara (duplicado a
// propósito: este script carga el banco crudo de data/items.json
// directamente, sin pasar por paraCliente()/la API, así que tiene que
// reproducir el mismo cálculo para que el manifiesto (y por tanto el
// esquema de OCR-IA que arma el propio Worker a partir de él) cuadre con lo
// que vería un ítem "abierto" real — mismo motivo que LETRAS/CATALOGOS entre
// worker/ y public/, ver README §2).
const CASILLAS_ABIERTO_MINIMO = 18;
function conCasillasAbierto(item) {
  if (item.formato !== "abierto") return item;
  return { ...item, casillas_abierto: Math.max(CASILLAS_ABIERTO_MINIMO, (item.respuesta_canonica?.length ?? 0) + 2) };
}

if (!API_BASE || !ADMIN_TOKEN) {
  console.log(
    "Faltan variables de entorno: CULTURA_BASICA_API_BASE y CULTURA_BASICA_ADMIN_TOKEN.\n" +
      "Este test llama a la API real de OpenAI a través de un Worker desplegado (o `wrangler dev` local)\n" +
      "y gasta cuota real — no se ejecuta como parte de `npm test`. Genera antes las fixtures con\n" +
      "`node ocr_tests/generar.mjs` si no existen, y consulta la cabecera de este fichero para las\n" +
      "variables necesarias."
  );
  process.exit(0);
}

async function peticion(pathname, opciones = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}`, ...opciones.headers },
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`${opciones.method ?? "GET"} ${pathname} → HTTP ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ============================================================
// Remesa de pruebas reservada (README §4.5): se reutiliza si ya existe una
// con esta descripción exacta, o se crea — nunca hardcodeada, el id sigue
// siendo un UUID cualquiera (worker/src/endpoints/admin/tokens.ts).
// ============================================================
const DESCRIPCION_TOKEN_PRUEBAS = "Tests de digitalización (ocr_tests/probar_ocr_ia.mjs)";
async function obtenerTokenDePruebas() {
  const { tokens } = await peticion("/api/admin/tokens");
  const existente = tokens.find((t) => t.descripcion === DESCRIPCION_TOKEN_PRUEBAS && t.es_prueba);
  if (existente) return existente.id;
  const creado = await peticion("/api/admin/tokens", {
    method: "POST",
    body: JSON.stringify({ descripcion: DESCRIPCION_TOKEN_PRUEBAS, es_prueba: true, sin_caducidad: true }),
  });
  return creado.id;
}

// ============================================================
// Decodificación local (duplica public/admin/papel/digitalizar.js::
// decodificarRespuestas — ese módulo importa admin.js, que toca `document`
// al cargar, así que no es seguro importarlo en Node; misma duplicación
// deliberada que CATALOGOS entre worker/ y public/, ver README §2).
// ============================================================
function primeraLetra(texto, limiteExclusivo) {
  for (const ch of (texto ?? "").toUpperCase()) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) return idx;
  }
  return null;
}
function letrasValidas(texto, limiteExclusivo) {
  const indices = new Set();
  for (const ch of (texto ?? "").toUpperCase()) {
    const idx = LETRAS.indexOf(ch);
    if (idx >= 0 && idx < limiteExclusivo) indices.add(idx);
  }
  return [...indices].sort((a, b) => a - b);
}
function decodificarRespuestas(items, textos) {
  const respuestas = {};
  for (const item of items) {
    const t = (clave) => (textos.get(clave) ?? "").trim().toUpperCase();
    switch (item.formato) {
      case "abierto": {
        const texto = t(`item:${item.id}:abierto`);
        if (texto) respuestas[item.id] = texto;
        break;
      }
      case "opcion_multiple": {
        const idx = primeraLetra(t(`item:${item.id}:opcion`), item.opciones.length);
        if (idx != null) respuestas[item.id] = idx;
        break;
      }
      case "seleccion_multiple": {
        const indices = letrasValidas(t(`item:${item.id}:seleccion`), item.opciones.length);
        if (indices.length > 0) respuestas[item.id] = indices;
        break;
      }
      case "ordenar": {
        const n = item.elementos.length;
        const arr = new Array(n).fill(null);
        let alguna = false;
        for (let pos = 0; pos < n; pos++) {
          const idx = primeraLetra(t(`item:${item.id}:orden:${pos}`), n);
          if (idx != null) {
            arr[pos] = item.elementos[idx];
            alguna = true;
          }
        }
        if (alguna) respuestas[item.id] = arr;
        break;
      }
      case "clasificar": {
        const asign = {};
        let alguna = false;
        item.elementos.forEach((elemento, i) => {
          const idx = primeraLetra(t(`item:${item.id}:clasificar:${i}`), item.categorias.length);
          if (idx != null) {
            asign[elemento] = item.categorias[idx];
            alguna = true;
          }
        });
        if (alguna) respuestas[item.id] = asign;
        break;
      }
    }
  }
  return respuestas;
}

function claveCatalogo(campo) {
  return { sexo: "sexo", ccaa_educacion_secundaria: "ccaa", nivel_estudios: "nivel_estudios", area_estudios: "area_estudios", estudios_mayor_progenitor: "nivel_estudios", libros_en_casa: "libros_en_casa" }[campo];
}

// Duplica worker/src/correccion.ts::normalizar/variantesSinEspacios (mismo
// motivo que el resto de duplicaciones de este script: no se puede importar
// TypeScript del Worker desde aquí sin más). Se usan para que este test mida
// lo mismo que la puntuación real: un acento perdido o un espacio de menos
// entre palabras no son errores de comprensión, y worker/src/correccion.ts
// ya no los penaliza — comparar aquí con igualdad estricta daría una imagen
// más pesimista de la precisión real que la que verá el usuario final.
function normalizar(s) {
  return s
    .normalize("NFD")
    .replace(/[\p{Mn}\p{Me}]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
// Tope de espacios antes de expandir combinatoriamente (2^n variantes): a
// diferencia de worker/src/correccion.ts::variantesSinEspacios (que solo se
// aplica a los alias FIJOS y cortos del banco de ítems), aquí también se
// aplica a `obtenida`, la respuesta cruda del modelo — sin límite, texto
// alucinado con espaciado letra a letra en una respuesta larga (visto contra
// la API real, issue #31) puede tener más de 30 espacios y hacer explotar el
// Set (RangeError: Set maximum size exceeded), tumbando todo el lote de
// pruebas por un solo fallo ya evidente. Con más de este tope se renuncia a
// la expansión completa y solo se compara sin espacios en absoluto: una
// respuesta así de espaciada ya es un fallo claro de todas formas.
const TOPE_ESPACIOS_PARA_EXPANDIR = 16;

function variantesSinEspacios(texto) {
  const posiciones = [];
  for (let i = 0; i < texto.length; i++) if (texto[i] === " ") posiciones.push(i);
  if (posiciones.length === 0) return [texto];
  if (posiciones.length > TOPE_ESPACIOS_PARA_EXPANDIR) return [texto, texto.replace(/ /g, "")];
  const variantes = new Set();
  const totalMascaras = 1 << posiciones.length;
  for (let mascara = 0; mascara < totalMascaras; mascara++) {
    const caracteres = [...texto];
    for (let bit = posiciones.length - 1; bit >= 0; bit--) {
      if (mascara & (1 << bit)) caracteres.splice(posiciones[bit], 1);
    }
    variantes.add(caracteres.join(""));
  }
  return [...variantes];
}
function coincideAbierto(obtenida, esperada) {
  if (typeof obtenida !== "string" || typeof esperada !== "string") return false;
  const variantesObtenida = new Set(variantesSinEspacios(normalizar(obtenida)));
  return variantesSinEspacios(normalizar(esperada)).some((v) => variantesObtenida.has(v));
}

// esperada === null significa "el plan de esta persona dejó el ítem/campo en
// blanco a propósito" (ocr_tests/generar.mjs) — el ground truth incluye
// SIEMPRE los 25 ítems (antes se omitían los que caían en blanco, dejando la
// comparación sin nada que contar ni a favor ni en contra); coincide si la
// digitalización tampoco devolvió nada para esa clave.
function igual(a, b, formato) {
  if (b === null) return a === undefined;
  if (formato === "abierto") return coincideAbierto(a, b);
  return JSON.stringify(a) === JSON.stringify(b);
}

// ============================================================
// Ejecución por instancia
// ============================================================
async function probarInstancia(dir, items, manifiesto, tokenPruebaId) {
  const nombre = path.basename(dir);
  const esperado = JSON.parse(await readFile(path.join(dir, "respuestas-esperadas.json"), "utf8"));

  const paginasEntrada = [];
  for (let i = 0; i < manifiesto.length; i++) {
    const jpegPath = path.join(dir, `pagina-${String(i + 1).padStart(2, "0")}.jpg`);
    const jpegBase64 = await readFile(jpegPath, "base64");
    const m = manifiesto[i];
    paginasEntrada.push({
      id: `${nombre}-${i + 1}`,
      imagen: `data:image/jpeg;base64,${jpegBase64}`,
      tipo: m.tipo,
      ...(m.tipo === "demografia" ? { campos: m.campos } : { items: m.items }),
    });
  }

  // Una llamada por página, NUNCA todas juntas en una sola: es la opción por
  // defecto del panel real (public/admin/papel/digitalizar.js,
  // #select-agrupacion-ia) y, medido contra la API real, da resultados
  // notablemente mejores que mandar la hoja completa de una vez — con 7
  // páginas/~34 campos en un solo mensaje, el modelo mezclaba respuestas
  // entre páginas. Probar aquí "examen completo" mediría una configuración
  // que el panel no usa por defecto y dejaría una imagen pesimista de la
  // precisión real.
  const textos = new Map();
  const demografiaLeida = {};
  for (const pagina of paginasEntrada) {
    const { resultados } = await peticion("/api/admin/ocr-ia", {
      method: "POST",
      body: JSON.stringify({ modelo: MODELO, ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}), paginas: [pagina] }),
    });
    const textosPagina = resultados[pagina.id] ?? {};
    if (pagina.tipo === "demografia") {
      for (const campo of pagina.campos) {
        if (campo === "anio_nacimiento") {
          // El Worker siempre reparte el año en 4 claves independientes,
          // una por dígito (ocrIa.ts, mismo formato que cualquier casilla
          // individual del resto de la hoja).
          const anio = [0, 1, 2, 3].map((i) => textosPagina[`demografia:anio_nacimiento:${i}`] ?? "").join("");
          demografiaLeida.anio_nacimiento = Number(anio.replace(/\D/g, "")) || undefined;
        } else {
          const letra = (textosPagina[`demografia:${campo}`] ?? "").toUpperCase();
          const idx = primeraLetra(letra, CATALOGOS[claveCatalogo(campo)].length);
          demografiaLeida[campo] = idx != null ? CATALOGOS[claveCatalogo(campo)][idx] : undefined;
        }
      }
    }
    for (const [clave, valor] of Object.entries(textosPagina)) textos.set(clave, valor);
  }

  const respuestasDecodificadas = decodificarRespuestas(items, textos);
  const formatoPorId = new Map(items.map((it) => [it.id, it.formato]));

  let aciertos = 0;
  let total = 0;
  const fallos = [];
  for (const [itemId, esperada] of Object.entries(esperado.respuestas_esperadas)) {
    total++;
    const obtenida = respuestasDecodificadas[itemId];
    if (igual(obtenida, esperada, formatoPorId.get(itemId))) aciertos++;
    else fallos.push({ itemId, esperada, obtenida });
  }

  let demografiaOk = 0;
  const demografiaTotal = Object.keys(esperado.demografia).length;
  const fallosDemografia = [];
  for (const [campo, esperada] of Object.entries(esperado.demografia)) {
    if (igual(demografiaLeida[campo], esperada)) demografiaOk++;
    else fallosDemografia.push({ campo, esperada, obtenida: demografiaLeida[campo] });
  }

  console.log(`\n=== ${nombre} ===`);
  console.log(`  Ítems:      ${aciertos}/${total} (${((aciertos / total) * 100).toFixed(0)}%)`);
  console.log(`  Demografía: ${demografiaOk}/${demografiaTotal} (${((demografiaOk / demografiaTotal) * 100).toFixed(0)}%)`);
  for (const f of fallosDemografia) console.log(`    FALLO demografía.${f.campo}: esperado=${JSON.stringify(f.esperada)} obtenido=${JSON.stringify(f.obtenida)}`);
  for (const f of fallos.slice(0, 15)) console.log(`    FALLO item ${f.itemId}: esperado=${JSON.stringify(f.esperada)} obtenido=${JSON.stringify(f.obtenida)}`);
  if (fallos.length > 15) console.log(`    … y ${fallos.length - 15} fallos más`);

  // Extremo a extremo: crea/actualiza la sesión real bajo la remesa de
  // pruebas, igual que haría el panel de admin.
  const demografiaCompleta = {
    anio_nacimiento: demografiaLeida.anio_nacimiento ?? 1990,
    sexo: demografiaLeida.sexo ?? CATALOGOS.sexo[0],
    ccaa_educacion_secundaria: demografiaLeida.ccaa_educacion_secundaria ?? CATALOGOS.ccaa[0],
    nivel_estudios: demografiaLeida.nivel_estudios ?? CATALOGOS.nivel_estudios[0],
    area_estudios: demografiaLeida.area_estudios ?? CATALOGOS.area_estudios[0],
    estudios_mayor_progenitor: demografiaLeida.estudios_mayor_progenitor ?? CATALOGOS.nivel_estudios[0],
    libros_en_casa: demografiaLeida.libros_en_casa ?? CATALOGOS.libros_en_casa[0],
  };
  // Como el propio panel (público/admin/papel/digitalizar.js): las casillas
  // de consentimiento/compromiso son un recordatorio impreso, no algo que se
  // lea ni se pida a OCR-IA — la digitalización siempre las da por buenas.
  // Aun así no se envuelve en try/catch para tapar el error: cualquier fallo
  // real aquí interesa reportarlo, pero no debe tumbar el resto del lote
  // (otras personas no tienen por qué compartirlo).
  let sesionId = null;
  try {
    const sesion = await peticion("/api/admin/digitalizacion", {
      method: "POST",
      body: JSON.stringify({
        token_id: tokenPruebaId,
        examen_id: esperado.exam_id_qr,
        consentimiento: true,
        compromiso_honestidad: true,
        demografia: demografiaCompleta,
        respuestas: respuestasDecodificadas,
      }),
    });
    sesionId = sesion.sesion_id;
    console.log(`  Sesión creada/actualizada: ${sesionId} (token de pruebas, excluida de las estadísticas)`);
  } catch (err) {
    console.log(`  FALLO extremo a extremo (POST /api/admin/digitalizacion): ${err.message}`);
  }

  return { nombre, aciertos, total, demografiaOk, demografiaTotal, sesionId };
}

async function main() {
  const entradas = await readdir(RAIZ_REPO + "/ocr_tests", { withFileTypes: true });
  const candidatas = entradas.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  // Solo carpetas de persona de verdad (con respuestas-esperadas.json) —
  // ocr_tests/one_shot_example/ vive en el mismo directorio (generada por
  // generar_one_shot.mjs, issue #31) pero no es una instancia de prueba, es
  // el ejemplo de una sola vez que se inyecta en cada llamada real: sin este
  // filtro, el escaneo la trataba como una persona más y crasheaba al no
  // encontrar ese fichero.
  let personasDisponibles = [];
  for (const nombre of candidatas) {
    if (fs.existsSync(path.join(RAIZ_REPO, "ocr_tests", nombre, "respuestas-esperadas.json"))) {
      personasDisponibles.push(nombre);
    }
  }
  if (process.env.CULTURA_BASICA_PERSONAS) {
    const pedidas = new Set(process.env.CULTURA_BASICA_PERSONAS.split(","));
    personasDisponibles = personasDisponibles.filter((p) => pedidas.has(p));
  }
  if (personasDisponibles.length === 0) {
    console.log("No hay instancias en ocr_tests/ — ejecuta primero `node ocr_tests/generar.mjs`.");
    return;
  }

  const items = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/items.json"), "utf8"));
  const ordenIds = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/orden-test.json"), "utf8"));
  const porId = new Map(items.map((it) => [it.id, it]));
  const idsBanco = new Set(items.map((it) => it.id));
  const orden = ordenIds.filter((id) => idsBanco.has(id));
  const faltantes = items.map((it) => it.id).filter((id) => !orden.includes(id));
  const itemsOrdenados = [...orden, ...faltantes].map((id) => conCasillasAbierto(porId.get(id)));

  const fontRegularBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Regular.ttf"));
  const fontBoldBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Bold.ttf"));
  const ctx = await crearContextoFuentes({ PDFDocument, rgb }, fontkit, null, null, fontRegularBytes, fontBoldBytes);
  const manifiesto = calcularManifiesto(ctx, itemsOrdenados);

  console.log(`Modelo: ${MODELO}. Instancias: ${personasDisponibles.join(", ")}`);
  const tokenPruebaId = await obtenerTokenDePruebas();
  console.log(`Remesa de pruebas: ${tokenPruebaId} (es_prueba, excluida de /api/admin/stats sin filtro)`);

  const resumen = [];
  for (const persona of personasDisponibles) {
    resumen.push(await probarInstancia(path.join(RAIZ_REPO, "ocr_tests", persona), itemsOrdenados, manifiesto, tokenPruebaId));
  }

  console.log("\n=== Resumen ===");
  for (const r of resumen) {
    console.log(
      `  ${r.nombre}: ítems ${r.aciertos}/${r.total}, demografía ${r.demografiaOk}/${r.demografiaTotal}` +
        (r.sesionId ? `, sesión ${r.sesionId}` : ", SIN sesión (falló el extremo a extremo)")
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
