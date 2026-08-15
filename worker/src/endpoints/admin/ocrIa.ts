// Motor de OCR-IA del pipeline en papel (README §4.7): único motor de
// lectura desde que se retiraron Tesseract.js y el OMR (v1/v2 del pipeline,
// ver git log) — toda la hoja, incluidas las casillas de consentimiento y
// compromiso de honestidad (antes las únicas marcas OMR que quedaban), se
// resuelve mandando la imagen de página entera a un modelo de visión.
//
// Diseño: se manda la PÁGINA ENTERA ya enderezada como una sola imagen, no un
// recorte por casilla — el modelo lee el layout impreso él solo (enunciados,
// letras de opción, elementos, categorías ya están en la propia imagen), sin
// que haga falta decirle coordenadas ni repetir el contenido del banco de
// ítems en el prompt. Se le pide directamente la RESPUESTA DEFINITIVA de cada
// ítem (resolviendo él mismo la precedencia Respuesta/Corrección, README
// §4.9), no el texto crudo de cada casilla — así una sola llamada por página
// (o una por examen completo, según agrupación) sustituye a decenas de
// recortes: más simple, más barato y más preciso (un recorte obliga al
// modelo a decidir a ciegas sin ver el resto de la pregunta). El resultado se
// traduce aquí mismo de vuelta a la misma forma {clave: texto} que espera
// public/admin/papel/digitalizar.js::decodificarRespuestas.
//
// Deliberadamente NO toca la lectura del QR (README §4.9): remesa, exam_id y
// número de página siguen decodificándose de forma determinista con jsQR en
// el propio navegador — aunque con un modelo de visión ya no haría falta en
// teoría, mantenerlo evita depender de IA para algo que puede resolverse
// determinista y gratis.
import { error, json } from "../../http";
import { AREA_ESTUDIOS, CCAA, LIBROS_EN_CASA, NIVEL_ESTUDIOS, SEXO } from "../../tipos";
import type { Env } from "../../tipos";

// Mismo alfabeto que public/admin/papel/hoja.js::LETRAS — no se puede
// importar ese módulo aquí (es cliente, con dependencias de pdf-lib/DOM que
// no tienen sentido en el Worker), así que se duplica la constante, mismo
// motivo que CATALOGOS entre worker/ y public/ (tipos.ts arriba).
const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const MODELO_POR_DEFECTO = "gpt-5-mini";
// Límites de la petición: generosos para cualquier hoja real del banco de
// ítems actual (25 ítems, ~10 páginas), solo para no dejar pasar una
// petición desproporcionada por error del cliente.
const MAX_PAGINAS_POR_PETICION = 40;
const MAX_ITEMS_POR_PETICION = 200;

type FormatoItem = "abierto" | "opcion_multiple" | "seleccion_multiple" | "ordenar" | "clasificar";
const FORMATOS_VALIDOS = new Set<FormatoItem>(["abierto", "opcion_multiple", "seleccion_multiple", "ordenar", "clasificar"]);

interface ItemEntrada {
  id: string;
  formato: FormatoItem;
  // Posición ABSOLUTA del ítem en el banco completo (1-25), la misma que se
  // imprime dentro del círculo junto al enunciado
  // (public/admin/papel/hoja.js::construirEnunciado) — se usa en el
  // prompt para que el modelo correlacione cada pregunta por el número que
  // ve impreso, no por su posición en la lista de esta página (que en
  // cualquier página que no sea la primera de ítems empezaría en 1 aunque el
  // círculo impreso ya vaya por, p. ej., el 14).
  numero: number;
  // Nº de posiciones (ordenar) o de elementos (clasificar) — obligatorio para
  // esos dos formatos, la forma de la respuesta depende de él; irrelevante
  // (y ausente) para el resto.
  n?: number;
  // Nº de opciones realmente impresas — obligatorio para opcion_multiple y
  // seleccion_multiple, restringe el esquema JSON a exactamente esas letras
  // (LETRAS[0..numOpciones-1]) en vez de aceptar cualquier string: así el
  // modelo no puede devolver algo como "F) 7" en vez de "F" (README §4.7).
  numOpciones?: number;
  // Nº de categorías realmente impresas — obligatorio para clasificar (item.n
  // ahí es el nº de ELEMENTOS a clasificar, no el de categorías: son cosas
  // distintas, hace falta este campo aparte para restringir el esquema a las
  // letras de categoría válidas).
  numCategorias?: number;
}

interface PaginaEntrada {
  id: string;
  imagen: string; // data URL de la página ENTERA ya enderezada (no un recorte)
  tipo: "demografia" | "items";
  items?: ItemEntrada[]; // requerido si tipo === "items", en el mismo orden en que aparecen impresos
  // Requerido si tipo === "demografia": qué campos están REALMENTE impresos
  // en esta página concreta (subconjunto de CAMPOS_DEMOGRAFIA_CATALOGO más
  // "anio_nacimiento") — el bloque de demografía puede repartirse en más de
  // una página física (README §4.9, "Página de datos 1/2"), así que no se
  // puede asumir que todos los campos estén en cualquier página que se
  // marque como "demografia". Lo calcula el cliente a partir del manifiesto
  // de esa página concreta (hoja.js::calcularManifiesto).
  campos?: string[];
}

// Los 6 catálogos de opción única de demografía (README §4.9) — sexo,
// ccaa_educacion_secundaria, nivel_estudios, area_estudios,
// estudios_mayor_progenitor, libros_en_casa. El año de nacimiento se pide
// aparte (dígitos, no catálogo).
const CAMPOS_DEMOGRAFIA_CATALOGO = [
  "sexo",
  "ccaa_educacion_secundaria",
  "nivel_estudios",
  "area_estudios",
  "estudios_mayor_progenitor",
  "libros_en_casa",
] as const;
// Casillas cuadradas simples de sí/no (README §2) — antes las únicas marcas
// OMR que quedaban en el pipeline (oscuridad umbralizada); ahora se leen
// igual que el resto de la página, como parte de la misma imagen.
const CAMPOS_DEMOGRAFIA_CHECKBOX = ["consentimiento", "compromiso_honestidad"] as const;
const CAMPOS_DEMOGRAFIA_VALIDOS = new Set<string>([
  ...CAMPOS_DEMOGRAFIA_CATALOGO,
  ...CAMPOS_DEMOGRAFIA_CHECKBOX,
  "anio_nacimiento",
]);

// Nº de opciones de cada catálogo cerrado (worker/src/tipos.ts) — igual que
// numOpciones/numCategorias para los ítems del banco, restringe el esquema
// JSON de cada campo de demografía a exactamente las letras impresas
// (A..última), en vez de un string libre. Los campos censales son justo los
// que más se perdían antes de este cambio (README §4.7).
const LONGITUD_CATALOGO: Record<(typeof CAMPOS_DEMOGRAFIA_CATALOGO)[number], number> = {
  sexo: SEXO.length,
  ccaa_educacion_secundaria: CCAA.length,
  nivel_estudios: NIVEL_ESTUDIOS.length,
  area_estudios: AREA_ESTUDIOS.length,
  estudios_mayor_progenitor: NIVEL_ESTUDIOS.length,
  libros_en_casa: LIBROS_EN_CASA.length,
};

// Devuelven un motivo (string) si la entrada es inválida, o null si es
// válida — a diferencia de un simple boolean, esto permite que el 400 diga
// EXACTAMENTE qué campo de qué página falló (id, índice, campos concretos)
// en vez de un mensaje genérico. Descubierto necesario tras un caso real: un
// 400 genérico no bastaba para saber si el problema era una página sin
// `campos`, un ítem sin `numero`, o algo del todo distinto (README §4.7).
function motivoItemInvalido(it: unknown): string | null {
  if (typeof it !== "object" || it === null) return "no es un objeto";
  const o = it as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return "falta id";
  if (typeof o.formato !== "string" || !FORMATOS_VALIDOS.has(o.formato as FormatoItem)) {
    return `formato inválido: ${JSON.stringify(o.formato)}`;
  }
  if (typeof o.numero !== "number" || !Number.isInteger(o.numero) || o.numero < 1) {
    return `falta numero (o no es un entero >= 1): ${JSON.stringify(o.numero)}`;
  }
  if ((o.formato === "ordenar" || o.formato === "clasificar") && !(typeof o.n === "number" && Number.isInteger(o.n) && o.n > 0)) {
    return `formato "${o.formato}" necesita n (entero > 0): ${JSON.stringify(o.n)}`;
  }
  if (
    (o.formato === "opcion_multiple" || o.formato === "seleccion_multiple") &&
    !(typeof o.numOpciones === "number" && Number.isInteger(o.numOpciones) && o.numOpciones > 0 && o.numOpciones <= LETRAS.length)
  ) {
    return `formato "${o.formato}" necesita numOpciones (entero entre 1 y ${LETRAS.length}): ${JSON.stringify(o.numOpciones)}`;
  }
  if (
    o.formato === "clasificar" &&
    !(typeof o.numCategorias === "number" && Number.isInteger(o.numCategorias) && o.numCategorias > 0 && o.numCategorias <= LETRAS.length)
  ) {
    return `formato "clasificar" necesita numCategorias (entero entre 1 y ${LETRAS.length}): ${JSON.stringify(o.numCategorias)}`;
  }
  return null;
}

function motivoPaginaInvalida(p: unknown, indice: number): string | null {
  if (typeof p !== "object" || p === null) return `página ${indice}: no es un objeto`;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return `página ${indice}: falta id`;
  if (typeof o.imagen !== "string" || !o.imagen.startsWith("data:image/")) {
    return `página ${indice} (id=${JSON.stringify(o.id)}): imagen no es una data URL válida`;
  }
  if (o.tipo === "demografia") {
    if (!Array.isArray(o.campos) || o.campos.length === 0) {
      return `página ${indice} (id=${JSON.stringify(o.id)}, demografia): falta campos o está vacío`;
    }
    const invalido = o.campos.find((c) => !CAMPOS_DEMOGRAFIA_VALIDOS.has(c as string));
    if (invalido !== undefined) {
      return `página ${indice} (id=${JSON.stringify(o.id)}, demografia): campo desconocido ${JSON.stringify(invalido)}`;
    }
    return null;
  }
  if (o.tipo === "items") {
    if (!Array.isArray(o.items) || o.items.length === 0) {
      return `página ${indice} (id=${JSON.stringify(o.id)}, items): falta items o está vacío`;
    }
    for (let i = 0; i < o.items.length; i++) {
      const motivo = motivoItemInvalido(o.items[i]);
      if (motivo) return `página ${indice} (id=${JSON.stringify(o.id)}), ítem ${i}: ${motivo}`;
    }
    return null;
  }
  return `página ${indice} (id=${JSON.stringify(o.id)}): tipo inválido ${JSON.stringify(o.tipo)}`;
}

// ============================================================
// Prompt: una página entera + descripción mínima de qué ítems trae y en qué
// orden (el propio contenido — enunciado, opciones, elementos — lo lee el
// modelo de la imagen; aquí solo se le da el id de cada uno para poder
// devolverlo en la respuesta, y la forma esperada de la respuesta).
// ============================================================

const SYSTEM_PROMPT =
  "Eres un asistente que digitaliza hojas de examen en papel escaneadas y ya enderezadas. Cada pregunta tiene un " +
  'bloque "Respuesta" (una o varias casillas donde se escribió la respuesta a mano) y, debajo, un bloque ' +
  '"Corrección" más pequeño y separado por una línea discontinua, que solo se rellena si la persona quiso corregir ' +
  'lo que puso en "Respuesta". Para cada pregunta debes dar la RESPUESTA DEFINITIVA: si el bloque "Corrección" ' +
  'tiene algo escrito, esa es la respuesta definitiva (ignora "Respuesta"); si "Corrección" está en blanco, la ' +
  'respuesta definitiva es lo que haya en "Respuesta". Todo el texto está en MAYÚSCULAS de imprenta, una letra o ' +
  "dígito por casilla. Si una pregunta entera está en blanco o no se distingue nada, su respuesta definitiva es " +
  "cadena vacía.\n" +
  "En las casillas de una sola letra (opción única, selección múltiple, ordenar, clasificar, catálogos de datos " +
  'personales), a veces alguien escribe algo más que la letra dentro o junto a la casilla — p. ej. "F) 7" o "B. La ' +
  'presión" en vez de simplemente "F" o "B". En esos casos, identifica cuál es la LETRA de la opción marcada e ' +
  "ignora cualquier otro carácter, número o palabra que la acompañe: la respuesta es solo esa letra, nunca la letra " +
  "más texto adicional.\n" +
  "En las respuestas de texto libre, transcribe exactamente lo que esté escrito, aunque parezca incompleto, mal " +
  "escrito o abreviado — no la dejes en blanco solo porque no es la respuesta completa o \"perfecta\" que " +
  "esperarías; una respuesta parcial transcrita fielmente vale más que un campo vacío. Deja la respuesta vacía " +
  "ÚNICAMENTE si de verdad no hay nada escrito en la casilla.\n" +
  "Responde SIEMPRE a todos los campos e ítems que se te piden, uno por uno, sin saltarte ninguno aunque su casilla " +
  "esté en blanco (en ese caso, cadena vacía). Devuelve siempre JSON, nunca prosa ni markdown.";

function describirFormatoItem(item: ItemEntrada): string {
  const letraMax = (n: number) => LETRAS[n - 1];
  switch (item.formato) {
    case "abierto":
      return "respuesta libre corta (varias casillas de letra formando una palabra o sigla)";
    case "opcion_multiple":
      return `opción única: UNA letra entre A y ${letraMax(item.numOpciones!)}`;
    case "seleccion_multiple":
      return (
        `selección múltiple: TODAS las letras elegidas (entre A y ${letraMax(item.numOpciones!)}) juntas, sin ` +
        'separadores (p. ej. "AC")'
      );
    case "ordenar":
      return `ordenar: ${item.n} posiciones numeradas de 1 a ${item.n}, cada una con la letra (entre A y ${letraMax(item.n!)}) del elemento que va ahí`;
    case "clasificar":
      return `clasificar: ${item.n} elementos numerados de 1 a ${item.n}, cada uno con la letra (entre A y ${letraMax(item.numCategorias!)}) de su categoría`;
  }
}

function construirContenidoPagina(pagina: PaginaEntrada): Array<Record<string, unknown>> {
  let texto: string;
  if (pagina.tipo === "demografia") {
    const campos = pagina.campos!;
    const catalogos = campos.filter((c) => !CAMPOS_DEMOGRAFIA_CHECKBOX.includes(c as (typeof CAMPOS_DEMOGRAFIA_CHECKBOX)[number]) && c !== "anio_nacimiento");
    const checkboxes = campos.filter((c) => CAMPOS_DEMOGRAFIA_CHECKBOX.includes(c as (typeof CAMPOS_DEMOGRAFIA_CHECKBOX)[number]));
    const partes: string[] = [`Página "${pagina.id}": es (una parte de) la página de datos de la hoja (demografía).`];
    if (catalogos.length > 0) {
      const conRango = catalogos.map((c) => {
        const n = LONGITUD_CATALOGO[c as (typeof CAMPOS_DEMOGRAFIA_CATALOGO)[number]];
        return `${c} (letra entre A y ${LETRAS[n - 1]}, según las opciones que veas impresas en esta imagen)`;
      });
      partes.push(
        `Necesito la letra escrita en la casilla de cada uno de estos campos, TAL COMO APARECEN EN ESTA IMAGEN ` +
          `(si alguno de estos nombres no aparece impreso aquí, es que está en otra página — en ese caso no ` +
          `deberías verlo en absoluto en esta imagen): ${conRango.join(", ")}.`
      );
    }
    if (campos.includes("anio_nacimiento")) {
      partes.push('Y el año de nacimiento como los 4 dígitos escritos en sus 4 casillas (campo "anio_nacimiento").');
    }
    if (checkboxes.length > 0) {
      partes.push(
        `Estos campos son casillas cuadradas (sí/no), no casillas de letra: responde "SI" si la casilla está ` +
          `rellenada/marcada con tinta, o "NO" si está en blanco: ${checkboxes.join(", ")}.`
      );
    }
    texto = partes.join(" ");
  } else {
    // Cada ítem se identifica por el NÚMERO IMPRESO dentro del círculo junto
    // a su enunciado (no por su posición en esta lista, que en una página
    // que no sea la primera de ítems ya no empezaría en 1) — evita que el
    // modelo desalinee la respuesta de una pregunta con el id de otra.
    texto =
      `Página "${pagina.id}": contiene los siguientes ítems del test, cada uno identificado por el NÚMERO ` +
      "IMPRESO DENTRO DEL CÍRCULO junto a su enunciado en la propia imagen (ignora el orden de esta lista, " +
      "usa el número del círculo para saber a qué pregunta te refieres):\n" +
      pagina
        .items!.map((it) => `- círculo nº${it.numero}: id="${it.id}" — ${describirFormatoItem(it)}`)
        .join("\n") +
      "\nDame la respuesta definitiva de cada uno (identificado por su id, en la respuesta).";
  }
  return [
    { type: "text", text: texto },
    { type: "image_url", image_url: { url: pagina.imagen } },
  ];
}

// ============================================================
// Esquema JSON estricto (Structured Outputs): una propiedad por campo de
// demografía o por ítem, namespaced con "<id_pagina>::" para que el esquema
// combinado de varias páginas (modo "examen completo") nunca pueda
// colisionar — aunque en la práctica las claves ya son únicas dentro de un
// examen (README §4.9), namespacear por página deja la garantía en el propio
// esquema en vez de depender de esa asunción. `strict: true` +
// `additionalProperties: false` + todas las propiedades en `required` fuerza
// a la API a devolver EXACTAMENTE ese conjunto de claves siempre — con
// modelos baratos (p. ej. gpt-5-nano) pedirlo solo por prompt dejaba huecos
// en el JSON de vuelta con demasiada frecuencia.
// ============================================================

function esquemaLetraEnum(numLetras: number) {
  return { type: "string", enum: [...LETRAS.slice(0, numLetras)] };
}

// Un objeto {"1": <letra>, "2": <letra>, ...} con una propiedad por posición
// (ordenar) o por elemento (clasificar) — cada valor restringido por enum a
// las letras realmente válidas para ESE ítem (elementos en ordenar,
// categorías en clasificar: dos conjuntos de letras distintos y de tamaño
// distinto, ver numCategorias en ItemEntrada).
function esquemaPosiciones(numPosiciones: number, numLetrasValidas: number) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (let i = 1; i <= numPosiciones; i++) {
    properties[String(i)] = esquemaLetraEnum(numLetrasValidas);
    required.push(String(i));
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function esquemaItem(item: ItemEntrada) {
  switch (item.formato) {
    case "ordenar":
      // Una permutación de sus propios elementos: n posiciones, n letras válidas.
      return esquemaPosiciones(item.n!, item.n!);
    case "clasificar":
      return esquemaPosiciones(item.n!, item.numCategorias!);
    case "opcion_multiple":
      return esquemaLetraEnum(item.numOpciones!);
    case "seleccion_multiple":
      // Conjunto de letras válidas, en cualquier orden, sin separadores (p.
      // ej. "AC") — un enum no sirve para una combinación variable, así que
      // se restringe con un patrón al alfabeto válido de ESTE ítem
      // (A..última letra impresa) y a como mucho una casilla por opción; los
      // duplicados no invalidan nada (el decodificador los trata como
      // conjunto), así que no hace falta prohibirlos con el propio patrón.
      return {
        type: "string",
        pattern: `^[A-${LETRAS[item.numOpciones! - 1]}]{0,${item.numOpciones}}$`,
      };
    default:
      return { type: "string" };
  }
}

// Exportado únicamente para poder testear directamente la forma del esquema
// (enums/patterns) sin tener que mockear la API de OpenAI — mismo criterio
// que las funciones puras de worker/src/correccion.ts.
export function construirEsquemaCompleto(paginas: PaginaEntrada[]) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const pagina of paginas) {
    if (pagina.tipo === "demografia") {
      for (const campo of pagina.campos!) {
        const clave = `${pagina.id}::${campo}`;
        if ((CAMPOS_DEMOGRAFIA_CHECKBOX as readonly string[]).includes(campo)) {
          properties[clave] = { type: "string", enum: ["SI", "NO"] };
        } else if (campo === "anio_nacimiento") {
          // Solo dígitos, como mucho 4 (una casilla por dígito impreso) — no
          // impide una respuesta incompleta (2 dígitos escritos, 2 en
          // blanco), pero sí cualquier carácter que no sea un dígito.
          properties[clave] = { type: "string", pattern: "^[0-9]{0,4}$" };
        } else {
          properties[clave] = esquemaLetraEnum(LONGITUD_CATALOGO[campo as (typeof CAMPOS_DEMOGRAFIA_CATALOGO)[number]]);
        }
        required.push(clave);
      }
    } else {
      for (const item of pagina.items!) {
        const clave = `${pagina.id}::${item.id}`;
        properties[clave] = esquemaItem(item);
        required.push(clave);
      }
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}

// ============================================================
// Reintentos ante 429 (límite de tokens/minuto de la cuenta de OpenAI) y ante
// 5xx (error transitorio del lado de OpenAI). OpenAI manda la cabecera
// `retry-after` (segundos) en los 429; se respeta si viene, si no se usa un
// backoff exponencial fijo.
// ============================================================
const MAX_REINTENTOS = 3;
const BACKOFF_BASE_MS = 2000;

async function esperar(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function llamarChatCompletions(env: Env, body: unknown): Promise<Response> {
  for (let intento = 0; ; intento++) {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const esReintentable = respuesta.status === 429 || respuesta.status >= 500;
    if (!esReintentable || intento >= MAX_REINTENTOS) return respuesta;

    const retryAfter = Number(respuesta.headers.get("retry-after"));
    const esperaMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_BASE_MS * 2 ** intento;
    await esperar(esperaMs);
  }
}

// ============================================================
// Traduce la respuesta definitiva por ítem/campo a la forma {clave: texto}
// que espera public/admin/papel/digitalizar.js::decodificarRespuestas —
// "item:<id>:opcion" = "B", igual para cualquier formato. Nunca se rellena
// una clave ":correccion:..." (el modelo ya resolvió esa precedencia él
// mismo), así que decodificarRespuestas siempre cae a la clave de
// "respuesta" — comportamiento equivalente a "Corrección en blanco".
// ============================================================

function letraOVacio(v: unknown): string {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

function volcarRespuestaItem(textos: Record<string, string>, item: ItemEntrada, valor: unknown) {
  if (item.formato === "ordenar" || item.formato === "clasificar") {
    const dict = typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};
    const sufijo = item.formato === "ordenar" ? "orden" : "clasificar";
    for (let i = 1; i <= item.n!; i++) {
      textos[`item:${item.id}:${sufijo}:${i - 1}`] = letraOVacio(dict[String(i)]);
    }
    return;
  }
  const sufijo = item.formato === "abierto" ? "abierto" : item.formato === "opcion_multiple" ? "opcion" : "seleccion";
  textos[`item:${item.id}:${sufijo}`] = letraOVacio(valor);
}

export async function postOcrIa(request: Request, env: Env): Promise<Response> {
  // Validar la forma del body ANTES de comprobar OPENAI_API_KEY: así un
  // cliente con un body mal formado se entera del error real (400) en vez de
  // un "falta la clave" que podría no tener nada que ver, y el Worker no
  // gasta ni un solo request de la API de pago con una entrada inválida.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.paginas) || b.paginas.length === 0) {
    return error(
      env,
      400,
      'Falta paginas: array de {id, imagen:data-url, tipo:"demografia"|"items", campos?:[...] (si tipo=demografia), items?:[{id,formato,numero,n?}] (si tipo=items)}'
    );
  }
  for (let i = 0; i < b.paginas.length; i++) {
    const motivo = motivoPaginaInvalida(b.paginas[i], i);
    if (motivo) {
      // Log sin la imagen (base64, demasiado grande y no aporta nada al
      // diagnóstico) para que `wrangler tail` muestre id/tipo/campos/items
      // completos en vez de cortarse a media data URL.
      const resumen = (b.paginas as unknown[]).map((p) => {
        if (typeof p !== "object" || p === null) return p;
        const { imagen, ...resto } = p as Record<string, unknown>;
        return { ...resto, imagen: typeof imagen === "string" ? `<${imagen.length} chars>` : imagen };
      });
      console.log("[ocr-ia] body inválido", motivo, JSON.stringify(resumen));
      return error(env, 400, `Body inválido: ${motivo}`);
    }
  }
  const paginas = b.paginas as PaginaEntrada[];

  if (paginas.length > MAX_PAGINAS_POR_PETICION) {
    return error(env, 400, `Demasiadas páginas en una sola petición (máximo ${MAX_PAGINAS_POR_PETICION})`);
  }
  const totalItems = paginas.reduce((n, p) => n + (p.items?.length ?? 0), 0);
  if (totalItems > MAX_ITEMS_POR_PETICION) {
    return error(env, 400, `Demasiados ítems en una sola petición (máximo ${MAX_ITEMS_POR_PETICION})`);
  }

  if (!env.OPENAI_API_KEY) {
    return error(
      env,
      500,
      "El motor de OCR-IA no está configurado en este Worker (falta el secreto OPENAI_API_KEY) — es el único motor de lectura del pipeline de papel, no hay alternativa local."
    );
  }

  const modelo = typeof b.modelo === "string" && b.modelo ? b.modelo : (env.OPENAI_MODEL ?? MODELO_POR_DEFECTO);

  console.log("[ocr-ia] petición", {
    modelo,
    paginas: paginas.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      campos: p.campos,
      items: p.items?.map((it) => `círculo nº${it.numero}: ${it.id} (${it.formato}${it.n ? `, n=${it.n}` : ""})`),
    })),
  });

  // Los modelos gpt-5 son "de razonamiento": por defecto dedican tokens
  // internos a "pensar" antes de responder, lo que añade varios segundos por
  // llamada aunque la tarea (leer una hoja y devolver JSON) no necesite ese
  // razonamiento. `reasoning_effort: "minimal"` lo reduce al mínimo — mucho
  // más rápido, sin afectar a la calidad de lectura. Es un parámetro que solo
  // aceptan los modelos de razonamiento (gpt-5*, no gpt-4o-mini, que ni
  // siquiera lo soporta), así que solo se manda si el modelo empieza por
  // "gpt-5" — mismo motivo que la ausencia de `temperature` más abajo: un
  // parámetro que un modelo no soporta responde 400, no se ignora en silencio.
  const esModeloDeRazonamiento = /^gpt-5/.test(modelo);

  let respuestaOpenAI: Response;
  try {
    respuestaOpenAI = await llamarChatCompletions(env, {
      model: modelo,
      response_format: {
        type: "json_schema",
        json_schema: { name: "respuestas_definitivas", strict: true, schema: construirEsquemaCompleto(paginas) },
      },
      ...(esModeloDeRazonamiento ? { reasoning_effort: "minimal" } : {}),
      // Sin `temperature`: los modelos de la familia gpt-5 (a diferencia de
      // gpt-4o-mini) rechazan con 400 cualquier valor que no sea el 1 por
      // defecto ("Unsupported value: 'temperature' does not support 0.0
      // with this model").
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: paginas.flatMap((p) => construirContenidoPagina(p)),
        },
      ],
    });
  } catch (e) {
    return error(env, 502, `No se pudo contactar con la API de OpenAI: ${(e as Error).message}`);
  }

  if (!respuestaOpenAI.ok) {
    const detalle = await respuestaOpenAI.text().catch(() => "");
    return error(env, 502, `La API de OpenAI respondió ${respuestaOpenAI.status}: ${detalle.slice(0, 500)}`);
  }

  const cuerpo = (await respuestaOpenAI.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const contenido = cuerpo.choices?.[0]?.message?.content;
  if (!contenido) {
    return error(env, 502, "La API de OpenAI no devolvió contenido reconocible");
  }
  console.log("[ocr-ia] respuesta cruda del modelo", contenido);

  let plano: Record<string, unknown>;
  try {
    plano = JSON.parse(contenido);
  } catch {
    return error(env, 502, "La respuesta del modelo no era JSON válido");
  }

  const resultados: Record<string, Record<string, string>> = {};
  for (const pagina of paginas) {
    const textos: Record<string, string> = {};
    if (pagina.tipo === "demografia") {
      for (const campo of pagina.campos!) {
        if (campo === "anio_nacimiento") {
          const anio = letraOVacio(plano[`${pagina.id}::anio_nacimiento`]).replace(/\D/g, "");
          for (let i = 0; i < 4; i++) textos[`demografia:anio_nacimiento:${i}`] = anio[i] ?? "";
        } else {
          textos[`demografia:${campo}`] = letraOVacio(plano[`${pagina.id}::${campo}`]);
        }
      }
    } else {
      for (const item of pagina.items!) {
        volcarRespuestaItem(textos, item, plano[`${pagina.id}::${item.id}`]);
      }
    }
    resultados[pagina.id] = textos;
  }

  return json(env, { modelo, resultados });
}
