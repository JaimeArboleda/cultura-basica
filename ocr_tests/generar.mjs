// Genera, en ocr_tests/, varias "instancias" de hoja en papel YA RELLENADAS a
// mano alzada de forma sintética (tinta dibujada directamente con pdf-lib
// sobre las casillas reales, README del proyecto §4.7) y con un efecto de
// escaneo/foto ligero, para poder probar el pipeline real de digitalización
// (OCR-IA, `POST /api/admin/ocr-ia`) contra la API real de OpenAI sin tener
// que imprimir y rellenar hojas de verdad — ver
// `probar_ocr_ia.mjs` en este mismo directorio para el test que las usa.
//
// Cómo funciona:
//   1. Este script decide, por "persona" (perfil de quien rellena la hoja),
//      qué escribiría para cada ítem del banco (data/items.json), usando las
//      respuestas correctas reales como referencia — con una tasa de acierto,
//      de corrección y de errores deliberados (valores inválidos, respuestas
//      abiertas incompletas) configurable por persona (ver PERSONAS).
//   2. hoja.js::construirHoja dibuja esa "tinta" directamente en las casillas
//      reales al generar el PDF (mismo mecanismo que produce la hoja en
//      blanco, con un parámetro extra — nunca lo usa el panel de admin real).
//   3. Cada página se rasteriza a JPEG (Chromium vía Playwright) y se le
//      aplica un efecto de escaneo/foto ligero (rotación, ruido y desenfoque)
//      en un <canvas>, sin añadir ninguna dependencia de imagen nativa.
//   4. Junto a las fotos de cada instancia se escribe
//      respuestas-esperadas.json: la respuesta DEFINITIVA de cada ítem según
//      el propio plan (aplicando la misma precedencia Respuesta/Corrección y
//      las mismas reglas de decodificación que
//      public/admin/papel/digitalizar.js::decodificarRespuestas) — sirve para
//      comparar contra lo que de verdad devuelve la API.
//
// Uso: node ocr_tests/generar.mjs
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import UPNGmod from "@pdf-lib/upng";
import qrGenLib from "qrcode-generator";
import { crearContextoFuentes, construirHoja, LETRAS } from "../public/admin/papel/hoja.js";
import { generarExamId } from "../public/admin/papel/qr.js";

const UPNG = UPNGmod.default ?? UPNGmod;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");

// Mismo cálculo que worker/src/items.ts::casillasAbiertoPara (duplicado a
// propósito, mismo motivo que LETRAS/CATALOGOS entre worker/ y public/: este
// script carga el banco crudo de data/items.json directamente, sin pasar por
// paraCliente()/la API, así que tiene que reproducir el mismo cálculo para
// que la hoja sintética que genera cuadre con lo que dibujaría la hoja real
// — si no, item.casillas_abierto quedaría ausente y hoja.js caería siempre
// al mínimo fijo (18), el mismo bug que motivó mover este cálculo al
// servidor.
const CASILLAS_ABIERTO_MINIMO = 18;
function conCasillasAbierto(item) {
  if (item.formato !== "abierto") return item;
  return { ...item, casillas_abierto: Math.max(CASILLAS_ABIERTO_MINIMO, (item.respuesta_canonica?.length ?? 0) + 2) };
}

// ============================================================
// PRNG determinista (mulberry32) — misma semilla siempre da el mismo plan.
// ============================================================
function rngDesde(semilla) {
  let s = semilla >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashCadena(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function elegir(rng, lista) {
  return lista[Math.floor(rng() * lista.length)];
}
function otroIndice(rng, correcto, total) {
  if (total <= 1) return correcto;
  let idx = correcto;
  while (idx === correcto) idx = Math.floor(rng() * total);
  return idx;
}

// ============================================================
// Fuentes de imitación manuscrita (Google Fonts, TTF vía el espejo de
// jsdelivr — cdn.jsdelivr.net/gh/google/fonts, no requiere acceso directo al
// repo de GitHub): Architects Daughter/Patrick Hand imitan letra de imprenta
// a mano; Caveat es más cursiva/desordenada, para estresar la lectura.
// ============================================================
const FUENTES_INK = {
  clara: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf",
  media: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/patrickhand/PatrickHand-Regular.ttf",
  // Antes Caveat[wght].ttf (fuente VARIABLE) — pdf-lib/fontkit subsettea mal
  // sus glifos con `embedFont(..., { subset: true })`: casi todas las letras
  // salían invisibles en el PDF final (solo alguna suelta, al azar,
  // renderizaba), aunque el propio texto sí se calculaba y persistía bien en
  // el plan — visto al comparar el PDF ya rasterizado contra
  // `respuestas-esperadas.json`, que sí tenía el valor esperado. Gochi Hand
  // es una fuente ESTÁTICA (no variable) con el mismo espíritu descuidado.
  descuidada: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/gochihand/GochiHand-Regular.ttf",
};
async function descargarFuenteInk(nombre) {
  const resp = await fetch(FUENTES_INK[nombre]);
  if (!resp.ok) throw new Error(`No se pudo descargar la fuente de tinta "${nombre}": HTTP ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// ============================================================
// Personas: perfiles de quien rellena la hoja. Cada una estresa un aspecto
// distinto del pipeline de OCR-IA, en línea con los fallos reportados
// (README del proyecto): campos censales perdidos, valores inválidos en una
// casilla de opción (p. ej. "F) 7" en vez de "F"), respuestas abiertas
// incompletas, y robustez general con letra descuidada/foto ruidosa.
// ============================================================
const PERSONAS = [
  {
    id: "01-letra-clara",
    descripcion: "Letra clara, casi sin correcciones — todos los campos censales deben leerse bien",
    fuenteInk: "clara",
    colorInk: [0.08, 0.1, 0.5],
    tasaAcierto: 0.92,
    tasaCorreccionSiFalla: 0.3,
    tasaValorInvalido: 0,
    tasaAbiertaIncompleta: 0.05,
    tasaBlanco: 0.02,
    demografiaCompleta: true,
    escaneo: { anguloMax: 0.4, ruido: 0.03, blur: 0.15, calidad: 0.92 },
  },
  {
    id: "02-con-correcciones",
    descripcion: "Se equivoca a menudo y corrige la mayoría — prueba la precedencia Respuesta/Corrección",
    fuenteInk: "media",
    colorInk: [0.05, 0.05, 0.05],
    tasaAcierto: 0.4,
    tasaCorreccionSiFalla: 0.85,
    tasaValorInvalido: 0,
    tasaAbiertaIncompleta: 0,
    tasaBlanco: 0.03,
    demografiaCompleta: true,
    escaneo: { anguloMax: 0.8, ruido: 0.05, blur: 0.25, calidad: 0.88 },
  },
  {
    id: "03-valores-invalidos-e-incompletas",
    descripcion:
      'Escribe valores fuera de formato en casillas de opción (p. ej. "F) 7" en vez de "F") y respuestas abiertas a medias',
    fuenteInk: "clara",
    colorInk: [0.1, 0.1, 0.1],
    tasaAcierto: 0.75,
    tasaCorreccionSiFalla: 0.2,
    tasaValorInvalido: 0.5,
    tasaAbiertaIncompleta: 0.5,
    tasaBlanco: 0.02,
    demografiaCompleta: true,
    escaneo: { anguloMax: 0.5, ruido: 0.04, blur: 0.2, calidad: 0.9 },
  },
  {
    id: "04-descuidada-ruidosa",
    descripcion: "Letra descuidada, foto con más ruido/desenfoque, varios campos en blanco",
    fuenteInk: "descuidada",
    colorInk: [0.15, 0.15, 0.2],
    tasaAcierto: 0.5,
    tasaCorreccionSiFalla: 0.4,
    tasaValorInvalido: 0.1,
    tasaAbiertaIncompleta: 0.15,
    tasaBlanco: 0.15,
    demografiaCompleta: false,
    escaneo: { anguloMax: 2.2, ruido: 0.12, blur: 0.6, calidad: 0.75 },
  },
];

// ============================================================
// Construcción del plan de respuestas de una persona: para cada ítem decide
// qué tinta va en "Respuesta" y qué (si algo) va en "Corrección", más la
// respuesta DEFINITIVA esperada (misma precedencia que decodificarRespuestas).
// ============================================================

// Huecos deliberados en preguntas "clasificar" (issue #33): antes, la rama
// "clasificar" de planItem solo sabía dejar el bloque ENTERO en blanco
// (enBlanco, ver más abajo) o enteramente relleno — nunca una posición
// individual sin clasificar en medio de las demás, pese a ser justo el
// patrón real que se encontró mal leído en un examen de producción (issue
// #33: 2 huecos entre 9 elementos, letras desplazadas en vez de dejar hueco
// = cadena vacía). Solo hay 2 ítems "clasificar" en todo el banco (04, 9
// elementos; 22, 10 elementos), así que con 4 personas caben como mucho 8
// combinaciones (persona, ítem) — se fuerzan aquí 4 de esas 8, una por
// persona, variando tanto el nº de huecos (1 a 3) como qué pasa con ellos en
// Corrección (ninguna corrección, corrección que los rellena todos, o
// corrección que rellena solo algunos y deja otro hueco — mismo patrón que
// el one-shot-example ampliado en esta misma ronda, worker/src/endpoints/
// admin/ocrIaEjemplo.ts) para medir el motor contra la mayor variedad
// posible con solo 4 casos. Las posiciones son índices 0-based sobre
// item.elementos.
const HUECOS_CLASIFICAR = {
  "01-letra-clara": { "04": { posiciones: [2, 6], correccion: "ninguna" } },
  "02-con-correcciones": { "22": { posiciones: [0, 4, 8], correccion: "completa" } },
  "03-valores-invalidos-e-incompletas": { "04": { posiciones: [3], correccion: "ninguna" } },
  "04-descuidada-ruidosa": { "22": { posiciones: [1, 5, 9], correccion: "parcial", huecosCorreccion: [9] } },
};

function letraDeIndice(i) {
  return LETRAS[i];
}

// Construye {respuestaInk, correccionInk, definitiva} para un ítem, según su
// formato. `definitiva` ya está en la forma que espera el backend (índice,
// array, objeto...) — la misma que produce corregirRespuesta().
function planItem(item, persona, rng) {
  const acierta = rng() < persona.tasaAcierto;
  const enBlanco = !acierta && rng() < persona.tasaBlanco;

  switch (item.formato) {
    case "abierto": {
      const canonica = item.respuesta_canonica.toUpperCase();
      if (enBlanco) return { respuestaInk: "", correccionInk: "", definitiva: undefined };
      const incompleta = rng() < persona.tasaAbiertaIncompleta;
      const texto = acierta
        ? incompleta
          ? canonica.slice(0, Math.max(2, Math.ceil(canonica.length * 0.55)))
          : canonica
        : elegir(rng, item.alias_parcial ?? [canonica.split("").reverse().join("")]).toUpperCase();
      const corrige = !acierta && rng() < persona.tasaCorreccionSiFalla;
      return {
        respuestaInk: texto,
        correccionInk: corrige ? canonica : "",
        definitiva: corrige ? canonica : texto,
      };
    }
    case "opcion_multiple": {
      const n = item.opciones.length;
      if (enBlanco) return { respuestaInk: "", correccionInk: "", definitiva: undefined };
      const idxCorrecto = item.indice_correcto;
      const idx = acierta ? idxCorrecto : otroIndice(rng, idxCorrecto, n);
      const invalida = rng() < persona.tasaValorInvalido;
      // Simula el fallo reportado: escribir "F) 7" en vez de "F" (la letra +
      // fragmento del propio texto de la opción, como si la persona hubiera
      // copiado de más).
      const textoInvalido = `${letraDeIndice(idx)}) ${item.opciones[idx].replace(/\s.*/, "")}`;
      const respuestaInk = invalida ? textoInvalido : letraDeIndice(idx);
      const corrige = !acierta && !invalida && rng() < persona.tasaCorreccionSiFalla;
      return {
        respuestaInk,
        correccionInk: corrige ? letraDeIndice(idxCorrecto) : "",
        definitiva: corrige ? idxCorrecto : idx,
      };
    }
    case "seleccion_multiple": {
      const n = item.opciones.length;
      if (enBlanco) return { respuestaInk: "", correccionInk: "", definitiva: undefined };
      const correctos = item.opciones_correctas;
      const elegidos = acierta
        ? correctos
        : correctos.length > 1
          ? correctos.slice(1)
          : [...correctos, otroIndice(rng, correctos[0], n)];
      const ordenPlan = [...elegidos].sort((a, b) => a - b);
      const respuestaInk = ordenPlan.map(letraDeIndice);
      const corrige = !acierta && rng() < persona.tasaCorreccionSiFalla;
      return {
        respuestaInk,
        correccionInk: corrige ? correctos.map(letraDeIndice) : null,
        definitiva: corrige ? [...correctos].sort((a, b) => a - b) : ordenPlan,
      };
    }
    case "ordenar": {
      const n = item.elementos.length;
      if (enBlanco) return { respuestaInk: new Array(n).fill(""), correccionInk: null, definitiva: undefined };
      const idxDe = new Map(item.elementos.map((e, i) => [e, i]));
      const correcto = item.elementos_ordenados.map((e) => letraDeIndice(idxDe.get(e)));
      let intento = correcto;
      if (!acierta) {
        intento = [...correcto];
        const i = Math.floor(rng() * n);
        const j = otroIndice(rng, i, n);
        [intento[i], intento[j]] = [intento[j], intento[i]];
      }
      const corrige = !acierta && rng() < persona.tasaCorreccionSiFalla;
      return {
        respuestaInk: intento,
        correccionInk: corrige ? correcto : null,
        definitiva: corrige ? item.elementos_ordenados : intento.map((l) => item.elementos[LETRAS.indexOf(l)]),
      };
    }
    case "clasificar": {
      const n = item.elementos.length;
      if (enBlanco) return { respuestaInk: new Array(n).fill(""), correccionInk: null, definitiva: undefined };
      const idxCat = new Map(item.categorias.map((c, i) => [c, i]));
      const correcto = item.elementos.map((e) => letraDeIndice(idxCat.get(item.clasificacion_correcta[e])));
      let intento = correcto;
      if (!acierta) {
        intento = correcto.map((l) => (rng() < 0.4 ? letraDeIndice(otroIndice(rng, LETRAS.indexOf(l), item.categorias.length)) : l));
      }
      const corrige = !acierta && rng() < persona.tasaCorreccionSiFalla;
      let respuestaInk = intento;
      let correccionInk = corrige ? correcto : null;
      let finalLetras = corrige ? correcto : intento;

      const huecos = HUECOS_CLASIFICAR[persona.id]?.[item.id];
      if (huecos) {
        respuestaInk = intento.map((l, i) => (huecos.posiciones.includes(i) ? "" : l));
        if (huecos.correccion === "ninguna") {
          correccionInk = null;
          finalLetras = respuestaInk;
        } else if (huecos.correccion === "completa") {
          correccionInk = correcto;
          finalLetras = correcto;
        } else {
          correccionInk = correcto.map((l, i) => (huecos.huecosCorreccion.includes(i) ? "" : l));
          finalLetras = correccionInk;
        }
      }

      // Una posición sin clasificar (cadena vacía) no aporta clave al
      // diccionario definitivo — mismo criterio que decodificarRespuestas
      // (public/admin/papel/digitalizar.js), que solo escribe una entrada
      // cuando encuentra una letra válida.
      const definitiva = Object.fromEntries(
        item.elementos.map((e, i) => [e, finalLetras[i] ? item.categorias[LETRAS.indexOf(finalLetras[i])] : null]).filter(([, cat]) => cat !== null)
      );
      return { respuestaInk, correccionInk, definitiva };
    }
    default:
      throw new Error(`Formato desconocido: ${item.formato}`);
  }
}

// Letras fijas (public/js/demografia.js::CATALOGOS, orden real de cada
// catálogo): A=Hombre, N=14ª CCAA=Comunidad de Madrid, G=7º nivel=Grado o
// licenciatura, C=3ª área=Ciencias, C=3º tramo de libros=26-100.
function planDemografia(persona, rng) {
  const demografia = {
    consentimiento: true,
    compromiso_honestidad: true,
    anio_nacimiento: String(1950 + Math.floor(rng() * 60)),
    sexo: "A",
    ccaa_educacion_secundaria: "N",
    nivel_estudios: "G",
    area_estudios: "C",
    estudios_mayor_progenitor: "G",
    libros_en_casa: "C",
  };
  const definitiva = {
    anio_nacimiento: Number(demografia.anio_nacimiento),
    sexo: "Hombre",
    ccaa_educacion_secundaria: "Comunidad de Madrid",
    nivel_estudios: "Grado o licenciatura",
    area_estudios: "Ciencias",
    estudios_mayor_progenitor: "Grado o licenciatura",
    libros_en_casa: "26-100",
  };

  if (!persona.demografiaCompleta && rng() < 0.5) {
    demografia.libros_en_casa = "";
    // null, no undefined: mismo motivo que en construirPlan (más abajo) —
    // así el campo sigue presente como ground truth ("se esperaba blanco")
    // en vez de desaparecer sin más de respuestas-esperadas.json al
    // serializar con JSON.stringify (que omite las claves con undefined).
    definitiva.libros_en_casa = null;
  }
  return { demografia, definitiva };
}

function construirPlan(items, persona, semilla) {
  const rng = rngDesde(semilla);
  const planItems = {};
  const definitivas = {};
  for (const item of items) {
    const { respuestaInk, correccionInk, definitiva } = planItem(item, persona, rng);
    planItems[item.id] = { respuesta: respuestaInk, correccion: correccionInk };
    // Siempre se registra una entrada, incluso cuando el ítem cayó en blanco
    // (definitiva === undefined) — así respuestas-esperadas.json tiene
    // SIEMPRE los 25 ítems como ground truth (null = "se esperaba blanco"),
    // en vez de omitir el ítem y dejar que la comparación no cuente ni a
    // favor ni en contra.
    definitivas[item.id] = definitiva !== undefined ? definitiva : null;
  }
  const { demografia, definitiva: demografiaDefinitiva } = planDemografia(persona, rng);
  return { planItems, definitivas, demografia, demografiaDefinitiva };
}

// ============================================================
// Servidor estático mínimo: sirve el build de pdfjs-dist ya instalado en
// node_modules (README, "sin CDN para scripts de generación" — mismo
// espíritu que la fuente incrustada de la hoja, nada de red en un paso que
// debe poder repetirse offline una vez descargadas las 3 fuentes de tinta).
// ============================================================
const MIME = { ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function iniciarServidorEstatico() {
  const servidor = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      // Página en blanco propia (en vez de about:blank) para que el import()
      // dinámico de pdf.js se resuelva en el mismo origen que la sirve — con
      // origen opaco (about:blank), Chromium trata la carga del módulo como
      // cross-origin sin CORS y falla con "Failed to fetch dynamically
      // imported module" antes de intentar la petición siquiera.
      if (urlPath === "/__vacio.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!DOCTYPE html><html><body></body></html>");
        return;
      }
      const rutaFs = path.join(RAIZ_REPO, urlPath);
      if (!rutaFs.startsWith(RAIZ_REPO)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const datos = await readFile(rutaFs);
      res.writeHead(200, { "Content-Type": MIME[path.extname(rutaFs)] || "application/octet-stream" });
      res.end(datos);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(servidor)));
}

// Renderiza cada página de un PDF (bytes en memoria) a un PNG dataURL usando
// pdf.js dentro del navegador (canvas real, sin la interfaz del visor de PDF
// de Chrome de por medio — a diferencia de navegar a un file://...pdf, que
// captura también la barra de herramientas/barra lateral del visor). Devuelve
// un array de dataURL, uno por página, a la escala pedida.
async function rasterizarPdf(page, baseUrl, pdfBytesBase64, escala) {
  return page.evaluate(
    async ({ baseUrl, pdfBytesBase64, escala }) => {
      const pdfjsLib = await import(`${baseUrl}/node_modules/pdfjs-dist/build/pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${baseUrl}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`;
      const binario = atob(pdfBytesBase64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      const dataUrls = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pagina = await doc.getPage(i);
        const viewport = pagina.getViewport({ scale: escala });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await pagina.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        dataUrls.push(canvas.toDataURL("image/png"));
      }
      return dataUrls;
    },
    { baseUrl, pdfBytesBase64, escala }
  );
}

// Aplica rotación + ruido + desenfoque a una imagen (dataURL) en un <canvas>,
// simulando una foto de móvil de la hoja ya "escaneada" — mismo espíritu que
// el generador anterior, adaptado para partir de un PNG (captura de página
// PDF) en vez de un DOM ya pintado.
async function capturarConEfecto(page, dataUrlEntrada, opciones) {
  return page.evaluate(
    async ({ dataUrl, opciones }) => {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      const margen = Math.ceil(Math.max(img.width, img.height) * 0.03);
      canvas.width = img.width + margen * 2;
      canvas.height = img.height + margen * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.filter = `blur(${opciones.blur}px)`;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((opciones.angulo * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      ctx.filter = "none";

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const ruido = (Math.random() - 0.5) * opciones.ruido * 255;
        d[i] = Math.min(255, Math.max(0, d[i] + ruido));
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + ruido));
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + ruido));
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/jpeg", opciones.calidad);
    },
    { dataUrl: dataUrlEntrada, opciones }
  );
}

// ============================================================
// Generación principal
// ============================================================
async function main() {
  const items = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/items.json"), "utf8"));
  const ordenIds = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/orden-test.json"), "utf8"));
  const porId = new Map(items.map((it) => [it.id, it]));
  const idsBanco = new Set(items.map((it) => it.id));
  const orden = ordenIds.filter((id) => idsBanco.has(id));
  const faltantes = items.map((it) => it.id).filter((id) => !orden.includes(id));
  const itemsOrdenados = [...orden, ...faltantes].map((id) => porId.get(id));

  const fontRegularBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Regular.ttf"));
  const fontBoldBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Bold.ttf"));

  console.log("Descargando fuentes de tinta manuscrita…");
  const fuentesInk = {};
  for (const nombre of Object.keys(FUENTES_INK)) fuentesInk[nombre] = await descargarFuenteInk(nombre);

  const chromiumPreinstalado = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(fs.existsSync(chromiumPreinstalado) ? { executablePath: chromiumPreinstalado } : {});
  const servidor = await iniciarServidorEstatico();
  try {
    await generarPersonas(browser, servidor);
  } finally {
    // Si algo falla a mitad de una persona, el navegador y el servidor HTTP
    // siguen con handles abiertos y Node nunca terminaría solo — cerrarlos
    // aquí es lo que permite que un fallo real termine el proceso en vez de
    // dejarlo colgado indefinidamente (visto en la práctica: un error dentro
    // del bucle dejó el proceso vivo más de diez minutos).
    await browser.close();
    servidor.close();
  }
}

async function generarPersonas(browser, servidor) {
  const items = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/items.json"), "utf8"));
  const ordenIds = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/orden-test.json"), "utf8"));
  const porId = new Map(items.map((it) => [it.id, it]));
  const idsBanco = new Set(items.map((it) => it.id));
  const orden = ordenIds.filter((id) => idsBanco.has(id));
  const faltantes = items.map((it) => it.id).filter((id) => !orden.includes(id));
  const itemsOrdenados = [...orden, ...faltantes].map((id) => conCasillasAbierto(porId.get(id)));

  const fontRegularBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Regular.ttf"));
  const fontBoldBytes = await readFile(path.join(RAIZ_REPO, "public/admin/papel/fonts/LiberationSans-Bold.ttf"));

  console.log("Descargando fuentes de tinta manuscrita…");
  const fuentesInk = {};
  for (const nombre of Object.keys(FUENTES_INK)) fuentesInk[nombre] = await descargarFuenteInk(nombre);

  const puerto = servidor.address().port;
  const baseUrl = `http://127.0.0.1:${puerto}`;

  for (const persona of PERSONAS) {
    console.log(`\n=== ${persona.id}: ${persona.descripcion} ===`);
    const dir = path.join(RAIZ_REPO, "ocr_tests", persona.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, "subida-en-bloque"), { recursive: true });

    const PDFLib = { PDFDocument, rgb };
    const ctx = await crearContextoFuentes(PDFLib, fontkit, UPNG, qrGenLib, fontRegularBytes, fontBoldBytes);
    ctx.fontInk = await ctx.pdfDoc.embedFont(fuentesInk[persona.fuenteInk], { subset: true });
    ctx.colorInk = rgb(...persona.colorInk);

    const semilla = hashCadena(persona.id);
    const plan = construirPlan(itemsOrdenados, persona, semilla);
    const tokenIdQr = `TEST-${persona.id}`;
    const examId = `T${generarExamId().slice(1)}`;

    const { pdfBytes, manifiesto } = await construirHoja(
      ctx,
      itemsOrdenados,
      { tokenId: tokenIdQr, examId },
      undefined,
      { items: plan.planItems, demografia: plan.demografia }
    );

    // Rasteriza cada página del PDF "relleno" con pdf.js sobre un <canvas>
    // real (sin la interfaz del visor de PDF de Chrome de por medio,
    // rasterizarPdf más arriba) y le aplica el efecto de escaneo/foto.
    const numPaginas = manifiesto.length;
    const paginaRender = await browser.newPage();
    await paginaRender.goto(`${baseUrl}/__vacio.html`);
    const pdfBytesBase64 = Buffer.from(pdfBytes).toString("base64");
    const pngDataUrls = await rasterizarPdf(paginaRender, baseUrl, pdfBytesBase64, 2.5);
    await paginaRender.close();

    const efectoPage = await browser.newPage();
    const jpegsFinal = [];
    for (let i = 0; i < numPaginas; i++) {
      const angulo = (Math.random() * 2 - 1) * persona.escaneo.anguloMax;
      const jpegDataUrl = await capturarConEfecto(efectoPage, pngDataUrls[i], {
        angulo,
        ruido: persona.escaneo.ruido,
        blur: persona.escaneo.blur,
        calidad: persona.escaneo.calidad,
      });
      const jpegBytes = Buffer.from(jpegDataUrl.split(",")[1], "base64");
      const nombre = `pagina-${String(i + 1).padStart(2, "0")}.jpg`;
      await writeFile(path.join(dir, nombre), jpegBytes);
      jpegsFinal.push(jpegBytes);
      process.stdout.write(`  página ${i + 1}/${numPaginas}\r`);
    }
    await efectoPage.close();
    console.log(`  ${numPaginas} páginas rasterizadas.            `);

    // hoja-completa.pdf: las mismas fotos, en orden, como un único PDF (caso
    // "escáner de sobremesa" de la subida en bloque, README §4.10).
    const pdfCompleto = await PDFDocument.create();
    for (const jpegBytes of jpegsFinal) {
      const img = await pdfCompleto.embedJpg(jpegBytes);
      const pagina = pdfCompleto.addPage([img.width, img.height]);
      pagina.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    await writeFile(path.join(dir, "hoja-completa.pdf"), await pdfCompleto.save());

    // subida-en-bloque/: las mismas páginas, sueltas y BARAJADAS.
    const indicesBarajados = [...jpegsFinal.keys()];
    for (let i = indicesBarajados.length - 1; i > 0; i--) {
      const j = Math.floor(rngDesde(semilla + 1)() * (i + 1));
      [indicesBarajados[i], indicesBarajados[j]] = [indicesBarajados[j], indicesBarajados[i]];
    }
    for (let k = 0; k < indicesBarajados.length; k++) {
      await writeFile(
        path.join(dir, "subida-en-bloque", `foto-${String(k + 1).padStart(2, "0")}.jpg`),
        jpegsFinal[indicesBarajados[k]]
      );
    }

    await writeFile(
      path.join(dir, "respuestas-esperadas.json"),
      JSON.stringify(
        {
          persona: persona.id,
          descripcion: persona.descripcion,
          token_id_qr: tokenIdQr,
          exam_id_qr: examId,
          paginas: numPaginas,
          demografia: plan.demografiaDefinitiva,
          respuestas_esperadas: plan.definitivas,
        },
        null,
        2
      )
    );
    console.log(`  Escrito ${dir}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
