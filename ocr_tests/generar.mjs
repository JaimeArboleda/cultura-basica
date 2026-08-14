// Genera, en ocr_tests/, varias "instancias" de hoja en papel (v1 OMR y v2
// OCR-de-letras) YA RELLENADAS a mano alzada de forma sintética y con un
// efecto de escaneo/foto ligero — para poder probar el pipeline real de
// digitalización (public/admin/papel/v{1,2}/digitalizar.js) con fotos
// "cuasi reales" sin tener que imprimir y rellenar hojas de verdad.
//
// Cómo funciona (el detalle de cómo se pinta cada marca vive en
// ./harness.html, cargado en un Chromium real vía Playwright):
//   1. Este script decide, por "persona" (perfil de quien rellena la hoja:
//      cuidadosa, con correcciones, descuidada...), qué respondería para cada
//      ítem del banco (data/items.json) — usando las respuestas correctas
//      reales del dataset como referencia, con una tasa de acierto y de
//      corrección configurable por persona. El resultado es un "plan"
//      (independiente de la versión del pipeline salvo por la mecánica de
//      "anular" en Corrección, exclusiva de v1 — ver README de este directorio).
//   2. Ese plan se envía a ./harness.html, que construye la hoja real con los
//      MISMOS módulos que usa el panel de admin
//      (public/admin/papel/v{1,2}/hoja.js) y pinta la tinta encima de cada
//      data-mark/data-linea real — así el layout es exactamente el que vería
//      el pipeline de digitalización, no una reconstrucción aproximada.
//   3. Cada página ya "rellenada" se captura con Chromium y se le aplica un
//      efecto de escaneo/foto ligero (rotación pequeña, ruido y desenfoque
//      sutiles) en el propio navegador (canvas 2D), sin añadir ninguna
//      dependencia de imagen nativa al proyecto.
//   4. Junto a las fotos de cada instancia se escribe
//      respuestas-esperadas.json: el resultado de aplicar la MISMA lógica de
//      precedencia Respuesta/Corrección que usa cada digitalizar.js
//      directamente sobre el plan (sin pasar por OCR/OMR) — así se puede
//      comparar a ojo lo que debería salir del pipeline real frente a lo que
//      de verdad sale.
//
// Uso: node ocr_tests/generar.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(__dirname, "..");

// ============================================================
// Servidor estático mínimo (sirve el repo entero: los módulos del pipeline
// de papel usan imports relativos entre public/, data/ y ocr_tests/, así que
// hace falta un único origen http para que el navegador pueda resolverlos).
// ============================================================

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function iniciarServidorEstatico() {
  const servidor = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rutaFs = path.join(RAIZ_REPO, urlPath);
      if (!rutaFs.startsWith(RAIZ_REPO)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const datos = await readFile(rutaFs);
      const ext = path.extname(rutaFs);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(datos);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

// ============================================================
// Fuentes de imitación manuscrita (Google Fonts, WOFF2), incrustadas como
// data URI en el propio documento: así Chromium no necesita red al renderizar
// (solo el propio script de generación la necesita, una vez, para
// descargarlas). Architects Daughter/Patrick Hand imitan letra de imprenta a
// mano (lo que pide la hoja); Caveat es más cursiva/desordenada — se reserva
// para la persona "descuidada", a propósito, para estresar el OCR con una
// letra menos ideal.
const FUENTES = [
  {
    familia: "Architects Daughter",
    url: "https://fonts.gstatic.com/s/architectsdaughter/v20/KtkxAKiDZI_td1Lkx62xHZHDtgO_Y-bvTYlg4w.woff2",
  },
  {
    familia: "Patrick Hand",
    url: "https://fonts.gstatic.com/s/patrickhand/v25/LDI1apSQOAYtSuYWp8ZhfYe8XsLL.woff2",
  },
  {
    familia: "Caveat",
    url: "https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjSx6eIWpYQ.woff2",
  },
];

async function construirCssFuentes() {
  const bloques = await Promise.all(
    FUENTES.map(async ({ familia, url }) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`No se pudo descargar la fuente ${familia}: HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const b64 = buf.toString("base64");
      return `@font-face { font-family: '${familia}'; src: url(data:font/woff2;base64,${b64}) format('woff2'); font-display: block; }`;
    })
  );
  return bloques.join("\n");
}

// ============================================================
// PRNG determinista (mulberry32, misma implementación que ./harness.html) —
// cada persona/instancia usa una semilla fija derivada de su nombre, para que
// el resultado sea reproducible entre ejecuciones.
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
function barajar(rng, arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Mismo alfabeto que comun.js::generarExamId (README §4.10) — duplicado aquí
// a propósito, con el `rng` determinista de este script en vez de
// crypto.getRandomValues: exam_id_qr también tiene que ser reproducible como
// el resto del plan (mismas semillas -> mismas hojas byte a byte), algo que
// la función real de la app no puede dar porque su gracia es precisamente
// ser aleatoria de verdad en cada hoja impresa.
const ALFABETO_EXAM_ID = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function generarExamIdDeterminista(rng) {
  let id = "";
  for (let i = 0; i < 8; i++) id += ALFABETO_EXAM_ID[Math.floor(rng() * ALFABETO_EXAM_ID.length)];
  return id;
}

// ============================================================
// Personas: perfiles de quien rellena la hoja. Cada una fija tasas de
// acierto/corrección/blanco, la fuente manuscrita, el color de tinta y unos
// parámetros de escaneo — para cubrir, entre las 3, hojas limpias, hojas con
// bloque de Corrección muy usado (clave para probar esa precedencia) y hojas
// descuidadas/incompletas con letra peor.
const PERSONAS = [
  {
    slug: "01-limpia",
    nombre: "Cuidadosa, sin apenas correcciones",
    tasaBlanco: 0.03,
    tasaBlancoPorFila: 0.02,
    tasaAciertoInicial: 0.88,
    tasaCorreccionSiFalla: 0.35,
    tasaAnularV1: 0.02,
    fuente: "Architects Daughter",
    colorTinta: "#15264a",
    escaneo: { anguloMax: 1.1, ruido: 0.025, blur: 0.2, brillo: [0.98, 1.04], contraste: [0.97, 1.03], calidad: 0.92 },
    demografia: {
      anio_nacimiento: "1994",
      sexo: "Mujer",
      ccaa_educacion_secundaria: "Comunidad de Madrid",
      nivel_estudios: "Grado o licenciatura",
      area_estudios: "Ciencias sociales y jurídicas",
      estudios_mayor_progenitor: "Bachillerato",
      libros_en_casa: "26-100",
    },
  },
  {
    slug: "02-con-correcciones",
    nombre: "Se equivoca a menudo y corrige mucho",
    tasaBlanco: 0.04,
    tasaBlancoPorFila: 0.05,
    tasaAciertoInicial: 0.5,
    tasaCorreccionSiFalla: 0.78,
    tasaAnularV1: 0.16,
    fuente: "Patrick Hand",
    colorTinta: "#0b3d6b",
    escaneo: { anguloMax: 2.2, ruido: 0.045, blur: 0.4, brillo: [0.93, 1.08], contraste: [0.93, 1.06], calidad: 0.88 },
    demografia: {
      anio_nacimiento: "1976",
      sexo: "Hombre",
      ccaa_educacion_secundaria: "Andalucía",
      nivel_estudios: "FP grado superior",
      area_estudios: "Ingeniería y arquitectura",
      estudios_mayor_progenitor: "Primaria",
      libros_en_casa: "0-10",
    },
  },
  {
    slug: "03-descuidada-incompleta",
    nombre: "Letra desordenada, deja varias en blanco",
    tasaBlanco: 0.16,
    tasaBlancoPorFila: 0.14,
    tasaAciertoInicial: 0.45,
    tasaCorreccionSiFalla: 0.22,
    tasaAnularV1: 0.06,
    fuente: "Caveat",
    colorTinta: "#1a1a1a",
    escaneo: { anguloMax: 3.2, ruido: 0.07, blur: 0.55, brillo: [0.88, 1.1], contraste: [0.88, 1.08], calidad: 0.82 },
    demografia: {
      anio_nacimiento: "2001",
      sexo: "Otro",
      ccaa_educacion_secundaria: "Cataluña",
      nivel_estudios: "Bachillerato",
      area_estudios: "Artes y humanidades",
      estudios_mayor_progenitor: "ESO",
      libros_en_casa: null, // campo dejado en blanco a propósito (persona incompleta)
    },
  },
];

// ============================================================
// Plan de respuestas de una persona para el banco de ítems completo.
// ============================================================

function planItem(item, persona, rng, poolAbierto, version) {
  if (rng() < persona.tasaBlanco) return { blanco: true };
  const acierto = rng() < persona.tasaAciertoInicial;
  const entrada = { blanco: false };

  switch (item.formato) {
    case "opcion_multiple": {
      const correctoIdx = item.indice_correcto;
      const n = item.opciones.length;
      entrada.respuestaIndice = acierto ? correctoIdx : otroIndice(rng, correctoIdx, n);
      entrada.correccionIndice = null;
      if (!acierto && rng() < persona.tasaCorreccionSiFalla) entrada.correccionIndice = correctoIdx;
      break;
    }
    case "seleccion_multiple": {
      const correctos = [...item.opciones_correctas].sort((a, b) => a - b);
      const n = item.opciones.length;
      let elegidos;
      if (acierto) {
        elegidos = correctos;
      } else {
        const set = new Set(correctos);
        if (rng() < 0.5 && set.size > 1) {
          set.delete(elegir(rng, [...set]));
        } else {
          let candidato = Math.floor(rng() * n);
          let intentos = 0;
          while (set.has(candidato) && intentos < 20) {
            candidato = Math.floor(rng() * n);
            intentos++;
          }
          set.add(candidato);
        }
        elegidos = [...set].sort((a, b) => a - b);
      }
      entrada.respuestaIndices = elegidos;
      entrada.correccionIndices = null;
      if (!acierto && rng() < persona.tasaCorreccionSiFalla) entrada.correccionIndices = correctos;
      break;
    }
    case "ordenar": {
      const correctoIdx = item.elementos_ordenados.map((nombre) => item.elementos.indexOf(nombre));
      const construir = (esCorrecto) => {
        let base = esCorrecto ? [...correctoIdx] : barajar(rng, correctoIdx);
        if (!esCorrecto && base.every((v, i) => v === correctoIdx[i])) {
          [base[0], base[1]] = [base[1], base[0]];
        }
        return base.map((v) => (rng() < persona.tasaBlancoPorFila ? null : v));
      };
      entrada.respuestaPosiciones = construir(acierto);
      entrada.correccionPosiciones = null;
      if (!acierto && rng() < persona.tasaCorreccionSiFalla) entrada.correccionPosiciones = [...correctoIdx];
      break;
    }
    case "clasificar": {
      const correctoPorElemento = item.elementos.map((el) => item.categorias.indexOf(item.clasificacion_correcta[el]));
      const construir = (esCorrecto) =>
        correctoPorElemento.map((catIdx) => {
          if (rng() < persona.tasaBlancoPorFila) return null;
          if (!esCorrecto && rng() < 0.6) return otroIndice(rng, catIdx, item.categorias.length);
          return catIdx;
        });
      entrada.respuestaPorElemento = construir(acierto);
      entrada.correccionPorElemento = null;
      if (!acierto && rng() < persona.tasaCorreccionSiFalla) entrada.correccionPorElemento = [...correctoPorElemento];
      break;
    }
    case "abierto": {
      const opcionesCorrectas = (item.alias?.length ? item.alias : [item.respuesta_canonica]).filter(Boolean);
      const correcta = elegir(rng, opcionesCorrectas);
      const candidatasIncorrectas = poolAbierto.filter((t) => t.toUpperCase() !== (item.respuesta_canonica || "").toUpperCase());
      const incorrecta = elegir(rng, candidatasIncorrectas.length ? candidatasIncorrectas : opcionesCorrectas);
      entrada.respuestaTexto = acierto ? correcta : incorrecta;
      entrada.correccionTexto = null;
      if (!acierto && rng() < persona.tasaCorreccionSiFalla) entrada.correccionTexto = correcta;
      break;
    }
  }

  // "anular" (solo v1, README §4.9 — la casilla "no responder" del bloque de
  // Corrección): en vez de escribir la respuesta correcta al corregir, a
  // veces la persona simplemente anula lo que había marcado.
  if (version === 1 && item.formato !== "abierto" && !acierto && rng() < persona.tasaAnularV1) {
    entrada.anular = true;
    entrada.correccionIndice = null;
    entrada.correccionIndices = null;
    entrada.correccionPosiciones = null;
    entrada.correccionPorElemento = null;
  }

  return entrada;
}

function construirPlan(items, persona, rng, poolAbierto, version) {
  const planItems = {};
  for (const item of items) planItems[item.id] = planItem(item, persona, rng, poolAbierto, version);
  return {
    fuente: persona.fuente,
    colorTinta: persona.colorTinta,
    demografia: {
      consentimiento: true,
      compromiso_honestidad: true,
      ...persona.demografia,
    },
    items: planItems,
  };
}

// Reproduce, a partir del plan (sin pasar por OCR/OMR), la MISMA lógica de
// precedencia Respuesta/Corrección que usa cada digitalizar.js real — para
// poder comparar el resultado esperado con lo que de verdad decodifique la
// app al digitalizar estas fotos. Ver v1/digitalizar.js::decodificarRespuestas
// y v2/digitalizar.js::decodificarRespuestas (opcion_multiple/seleccion_multiple/
// abierto: precedencia por bloque entero en ambas versiones; ordenar/clasificar:
// por bloque entero en v1, por casilla individual en v2).
function decodificarDesdePlan(items, plan, version) {
  const respuestas = {};
  for (const item of items) {
    const entrada = plan.items[item.id];
    if (!entrada || entrada.blanco) continue;

    if (item.formato === "abierto") {
      const texto = entrada.correccionTexto || entrada.respuestaTexto;
      if (texto) respuestas[item.id] = texto;
      continue;
    }
    if (version === 1 && entrada.anular) continue;

    switch (item.formato) {
      case "opcion_multiple": {
        const idx = entrada.correccionIndice ?? entrada.respuestaIndice;
        if (idx != null) respuestas[item.id] = idx;
        break;
      }
      case "seleccion_multiple": {
        const arr = entrada.correccionIndices ?? entrada.respuestaIndices;
        if (arr?.length) respuestas[item.id] = [...arr].sort((a, b) => a - b);
        break;
      }
      case "ordenar": {
        let posiciones;
        if (version === 1) {
          posiciones = entrada.correccionPosiciones ?? entrada.respuestaPosiciones;
        } else {
          posiciones = item.elementos.map((_, pos) => entrada.correccionPosiciones?.[pos] ?? entrada.respuestaPosiciones?.[pos] ?? null);
        }
        const nombres = posiciones.map((idx) => (idx != null ? item.elementos[idx] : null));
        if (nombres.some((v) => v != null)) respuestas[item.id] = nombres;
        break;
      }
      case "clasificar": {
        let porElemento;
        if (version === 1) {
          porElemento = entrada.correccionPorElemento ?? entrada.respuestaPorElemento;
        } else {
          porElemento = item.elementos.map((_, i) => entrada.correccionPorElemento?.[i] ?? entrada.respuestaPorElemento?.[i] ?? null);
        }
        const asign = {};
        let alguna = false;
        item.elementos.forEach((el, i) => {
          if (porElemento[i] != null) {
            asign[el] = item.categorias[porElemento[i]];
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

// ============================================================
// Efecto de escaneo/foto ligero, aplicado en el propio navegador (canvas 2D):
// rotación pequeña, desenfoque y brillo/contraste vía CSS filter (nativo,
// rápido) y un grano de ruido sutil superpuesto con blend "overlay" — nada de
// esto toca los fiduciales lo bastante como para que la detección automática
// de ../public/admin/papel/comun.js::detectarFiduciales deje de funcionar con
// los parámetros por defecto (por eso "ligero").
// ============================================================

async function capturarConEfecto(page, elementHandle, opts, seed) {
  const buf = await elementHandle.screenshot({ type: "png" });
  const dataUrl = "data:image/png;base64," + buf.toString("base64");
  const rng = rngDesde(seed);
  const signo = rng() < 0.5 ? -1 : 1;
  const angulo = signo * (opts.anguloMax * (0.35 + rng() * 0.65));
  const brillo = opts.brillo[0] + rng() * (opts.brillo[1] - opts.brillo[0]);
  const contraste = opts.contraste[0] + rng() * (opts.contraste[1] - opts.contraste[0]);

  const resultado = await page.evaluate(
    async ({ dataUrl, angulo, ruido, blur, brillo, contraste, calidad }) => {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = dataUrl;
      });
      const w = img.width;
      const h = img.height;
      const rad = (Math.abs(angulo) * Math.PI) / 180;
      const bw = Math.ceil(w * Math.cos(rad) + h * Math.sin(rad)) + 20;
      const bh = Math.ceil(w * Math.sin(rad) + h * Math.cos(rad)) + 20;
      const canvas = document.createElement("canvas");
      canvas.width = bw;
      canvas.height = bh;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ded9d0";
      ctx.fillRect(0, 0, bw, bh);
      ctx.save();
      ctx.translate(bw / 2, bh / 2);
      ctx.rotate((angulo * Math.PI) / 180);
      ctx.filter = `blur(${blur}px) brightness(${brillo}) contrast(${contraste})`;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();

      const ruidoCanvas = document.createElement("canvas");
      ruidoCanvas.width = 96;
      ruidoCanvas.height = 96;
      const rctx = ruidoCanvas.getContext("2d");
      const idata = rctx.createImageData(96, 96);
      for (let i = 0; i < idata.data.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        idata.data[i] = v;
        idata.data[i + 1] = v;
        idata.data[i + 2] = v;
        idata.data[i + 3] = 255;
      }
      rctx.putImageData(idata, 0, 0);
      const patron = ctx.createPattern(ruidoCanvas, "repeat");
      ctx.save();
      ctx.globalAlpha = ruido;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = patron;
      ctx.fillRect(0, 0, bw, bh);
      ctx.restore();

      return canvas.toDataURL("image/jpeg", calidad);
    },
    { dataUrl, angulo, ruido: opts.ruido, blur: opts.blur, brillo, contraste, calidad: opts.calidad }
  );
  return Buffer.from(resultado.split(",")[1], "base64");
}

// Recompresión SOLO para hoja-completa.pdf (README §4.10): las fotos sueltas
// (pagina-NN.jpg / subida-en-bloque/foto-NN.jpg) se quedan a la resolución y
// calidad "de foto real" de capturarConEfecto, pero un PDF con 10-12 páginas
// a esa resolución pesaba varios MB — de sobra para un fixture de prueba,
// que no necesita más nitidez que la que ya exige el propio pipeline de
// digitalización (bastante menos que la de la imagen "fuente"). Reduce el
// ancho y la calidad JPEG antes de incrustarla en el PDF.
//
// anchoMax/calidad por defecto verificados a mano contra las instancias
// "descuidada-incompleta" (v1 y v2, el escaneo con más ruido/desenfoque/
// ángulo de las tres personas): con estos valores el QR pequeño de página
// se sigue leyendo en las 22/22 páginas de esas dos instancias; bajar más
// (p. ej. 1200px/0.5) ya perdía alguna lectura — mejor un PDF algo más
// pesado que un fixture cuyo QR no se pueda leer de verdad.
async function comprimirParaPdf(page, buf, { anchoMax = 1600, calidad = 0.55 } = {}) {
  const dataUrl = "data:image/jpeg;base64," + buf.toString("base64");
  const resultado = await page.evaluate(
    async ({ dataUrl, anchoMax, calidad }) => {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = dataUrl;
      });
      const factor = Math.min(1, anchoMax / img.width);
      const w = Math.round(img.width * factor);
      const h = Math.round(img.height * factor);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", calidad);
    },
    { dataUrl, anchoMax, calidad }
  );
  return Buffer.from(resultado.split(",")[1], "base64");
}

// ============================================================
// Programa principal
// ============================================================

async function main() {
  const items = JSON.parse(await readFile(path.join(RAIZ_REPO, "data/items.json"), "utf8"));
  const poolAbierto = [
    ...new Set(
      items
        .filter((it) => it.formato === "abierto")
        .flatMap((it) => (it.alias?.length ? it.alias : [it.respuesta_canonica]).filter(Boolean))
    ),
  ];

  console.log(`Ítems cargados: ${items.length}. Iniciando servidor estático y Chromium…`);
  const servidor = await iniciarServidorEstatico();
  const puerto = servidor.address().port;
  const baseUrl = `http://127.0.0.1:${puerto}`;

  const cssFuentes = await construirCssFuentes();

  // executablePath fijo (README de este repo, "entorno remoto"): el Chromium
  // preinstalado en /opt/pw-browsers no siempre coincide en versión con la
  // que espera el playwright de node_modules (que intentaría descargar otro
  // por su cuenta, con o sin red) — el symlink /opt/pw-browsers/chromium
  // apunta siempre al que ya está instalado.
  const chromiumPreinstalado = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(fs.existsSync(chromiumPreinstalado) ? { executablePath: chromiumPreinstalado } : {});
  const context = await browser.newContext({ viewport: { width: 900, height: 1300 }, deviceScaleFactor: 2.2 });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[harness]", msg.text());
  });

  // El QR de cada hoja se genera dentro del propio Chromium: comun.js carga
  // qrcode-generator desde un CDN con un <script src> normal (ver
  // comun.js::cargarScript). Chromium no hereda HTTPS_PROXY/HTTP_PROXY del
  // proceso automáticamente (a diferencia del fetch() de Node de más arriba) y
  // configurar un proxy a nivel de navegador acaba desviando también las
  // peticiones al servidor estático local — más simple: se descarga el script
  // una vez con el fetch() de Node (que sí respeta el proxy) y se intercepta
  // esa URL concreta para servirlo desde memoria, sin que Chromium necesite
  // tocar la red en ningún momento.
  const qrcodeJsUrl = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
  const qrcodeJsResp = await fetch(qrcodeJsUrl);
  if (!qrcodeJsResp.ok) throw new Error(`No se pudo descargar qrcode-generator: HTTP ${qrcodeJsResp.status}`);
  const qrcodeJsBody = await qrcodeJsResp.text();
  await page.route(qrcodeJsUrl, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: qrcodeJsBody }));

  await page.goto(`${baseUrl}/ocr_tests/harness.html`);
  await page.addStyleTag({ content: cssFuentes });
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load("20px 'Architects Daughter'"),
      document.fonts.load("20px 'Patrick Hand'"),
      document.fonts.load("20px 'Caveat'"),
    ]);
  });
  await page.waitForFunction(() => window.__harnessListo === true);

  const dirSalida = path.join(RAIZ_REPO, "ocr_tests");

  const modoRapido = process.env.OCR_TESTS_QUICK === "1";
  const versiones = modoRapido ? [Number(process.env.OCR_TESTS_QUICK_VERSION || 1)] : [1, 2];
  const personas = modoRapido ? [PERSONAS[Number(process.env.OCR_TESTS_QUICK_PERSONA || 0)]] : PERSONAS;

  for (const version of versiones) {
    for (const persona of personas) {
      const rng = rngDesde(hashCadena(`${persona.slug}:v${version}`));
      const plan = construirPlan(items, persona, rng, poolAbierto, version);
      // OCR_TESTS_TOKEN_ID (opcional): sustituye el token sintético
      // "TEST-V{1,2}-<instancia>" (que a propósito no existe en la base de
      // datos, README de este directorio) por uno real, para poder probar la
      // subida en bloque de principio a fin (detección automática Y creación
      // de sesión real) contra una remesa que sí existe. Pensado para
      // regenerar puntualmente con `OCR_TESTS_TOKEN_ID=<id-real> node
      // ocr_tests/generar.mjs`, no para dejarlo así por defecto: un token
      // real incrustado en estas hojas de prueba versionadas es utilizable
      // por cualquiera con acceso al repo para crear sesiones bajo esa
      // remesa, así que conviene que sea un token de pruebas dedicado, no el
      // de una remesa real de participantes.
      const tokenId = process.env.OCR_TESTS_TOKEN_ID || `TEST-V${version}-${persona.slug.toUpperCase()}`;

      // exam_id (README §4.9/§4.10): identifica esta hoja física concreta,
      // distinto del tokenId de arriba (la remesa). Generado en Node con el
      // mismo `rng` determinista que el resto del plan (ver
      // generarExamIdDeterminista más arriba) para que estas hojas sean
      // reproducibles byte a byte, a diferencia de comun.js::generarExamId
      // (la de la app real), que es aleatoria de verdad a propósito.
      const examId = generarExamIdDeterminista(rng);
      const qr = { tokenId, examId, version };
      const numPaginas = await page.evaluate(([v, its, q]) => window.__construirPaginas(v, its, q), [version, items, qr]);
      await page.evaluate(([v, its, p]) => {
        window.__version = v;
        window.__items = its;
        window.__plan = p;
      }, [version, items, plan]);

      const dirInstancia = path.join(dirSalida, `v${version}`, persona.slug);
      fs.mkdirSync(dirInstancia, { recursive: true });

      const paginasAGenerar = modoRapido ? Math.min(Number(process.env.OCR_TESTS_QUICK_PAGES || 2), numPaginas) : numPaginas;
      const buffersPorPagina = [];
      for (let i = 0; i < paginasAGenerar; i++) {
        await page.evaluate((i) => {
          window.__renderPagina(i);
          window.__aplicarPlan(window.__version, window.__items, window.__plan);
        }, i);
        const el = await page.$(".hoja-pagina");
        const jpegBuf = await capturarConEfecto(page, el, persona.escaneo, hashCadena(`${persona.slug}:v${version}:pagina:${i}`));
        buffersPorPagina.push(jpegBuf);
        const nombre = `pagina-${String(i + 1).padStart(2, "0")}.jpg`;
        fs.writeFileSync(path.join(dirInstancia, nombre), jpegBuf);
      }

      // Demo de la subida en bloque (README §4.10), solo en una pasada
      // completa (no en OCR_TESTS_QUICK, que ya recorta a propósito para
      // iterar rápido): las MISMAS fotos de arriba, pero organizadas de dos
      // formas pensadas para ese flujo en vez del secuencial de siempre.
      if (!modoRapido && paginasAGenerar === numPaginas) {
        // 1) Sueltas y DESORDENADAS (nombre de archivo sin relación con el
        //    número de página real): demuestra que subirLote.js recoloca
        //    cada una solo por su QR, no por el nombre ni el orden de subida.
        const dirLote = path.join(dirInstancia, "subida-en-bloque");
        fs.mkdirSync(dirLote, { recursive: true });
        const rngBarajado = rngDesde(hashCadena(`${persona.slug}:v${version}:barajado`));
        const ordenBarajado = barajar(rngBarajado, buffersPorPagina.map((_, i) => i));
        ordenBarajado.forEach((indicePagina, posicionSubida) => {
          const nombre = `foto-${String(posicionSubida + 1).padStart(2, "0")}.jpg`;
          fs.writeFileSync(path.join(dirLote, nombre), buffersPorPagina[indicePagina]);
        });

        // 2) Un único PDF con TODAS las páginas ya en orden: el caso "mejor"
        //    de README §4.10 (si el PDF ya viene completo, se procesa de una).
        const pdfDoc = await PDFDocument.create();
        for (const buf of buffersPorPagina) {
          const bufComprimido = await comprimirParaPdf(page, buf);
          const jpg = await pdfDoc.embedJpg(bufComprimido);
          const paginaPdf = pdfDoc.addPage([jpg.width, jpg.height]);
          paginaPdf.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
        }
        fs.writeFileSync(path.join(dirInstancia, "hoja-completa.pdf"), await pdfDoc.save());
      }

      const esperado = decodificarDesdePlan(items, plan, version);
      fs.writeFileSync(
        path.join(dirInstancia, "respuestas-esperadas.json"),
        JSON.stringify(
          {
            persona: persona.slug,
            descripcion: persona.nombre,
            version_pipeline: version,
            token_id_qr: tokenId,
            exam_id_qr: examId,
            paginas: numPaginas,
            demografia: plan.demografia,
            respuestas_esperadas: esperado,
          },
          null,
          2
        )
      );
      console.log(`✓ v${version}/${persona.slug}: ${numPaginas} páginas`);
    }
  }

  await browser.close();
  servidor.close();
  console.log(`Listo. Hojas generadas en ${dirSalida}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
