// Motor de OCR-IA de la v2 del pipeline en papel (README §4.7, "Motor
// gpt-mini"): alternativa a Tesseract.js (que corre entero en el navegador,
// public/admin/papel/comun.js::ocrLinea) para leer las casillas de
// letra/dígito de una hoja escaneada, con más precisión sobre letra
// manuscrita real a costa de depender de una API de pago. El panel deja
// elegir entre los dos motores por hoja (public/admin/papel/v2/digitalizar.js)
// para poder compararlos con datos reales antes de decidir cuál usar en el
// piloto — ninguno sustituye al otro, conviven igual que v1/v2 (README §4.9).
//
// Diseño (2ª versión, tras probar con recortes por casilla): se manda la
// PÁGINA ENTERA ya enderezada como una sola imagen, no un recorte por
// casilla — el modelo lee el layout impreso él solo (enunciados, letras de
// opción, elementos, categorías ya están en la propia imagen), sin que haga
// falta decirle coordenadas ni repetir el contenido del banco de ítems en el
// prompt. Se le pide directamente la RESPUESTA DEFINITIVA de cada ítem
// (resolviendo él mismo la precedencia Respuesta/Corrección, README §4.9),
// no el texto crudo de cada casilla — así una sola llamada por página (o una
// por examen completo, según agrupación) sustituye a las decenas de recortes
// de la primera versión: más simple, más barato y, con esto, más preciso
// (los recortes obligaban al modelo a decidir a ciegas sin ver el resto de
// la pregunta). El resultado se traduce aquí mismo de vuelta a la misma forma
// {clave: texto} que ya esperaba el resto del pipeline (decodificarRespuestas
// en v2/digitalizar.js, sin cambios) para no acabar con dos formas distintas
// de interpretar una respuesta según el motor.
//
// Solo tiene sentido para v2: v1 es sobre todo burbujas OMR sin letra
// impresa al lado (README §4.7), así que "dame la letra definitiva" no
// aplica — public/admin/papel/subirLote.js usa Tesseract para v1 siempre,
// elija lo que elija el admin en el selector de motor.
//
// Deliberadamente NO toca la lectura del QR (README §4.9): remesa, exam_id y
// número de página siguen decodificándose de forma determinista con jsQR en
// el propio navegador, motor de OCR elegido aparte — aunque con un modelo de
// visión ya no haría falta en teoría, mantenerlo evita tener DOS diseños
// distintos de identificación de hoja (uno determinista, otro dependiente de
// IA) conviviendo a la vez. El OMR de consentimiento/compromiso tampoco pasa
// por aquí (oscuridad umbralizada, sin cambios).
import { error, json } from "../../http";
import type { Env } from "../../tipos";

const MODELO_POR_DEFECTO = "gpt-4o-mini";
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
  // Nº de posiciones (ordenar) o de elementos (clasificar) — obligatorio para
  // esos dos formatos, la forma de la respuesta depende de él; irrelevante
  // (y ausente) para el resto.
  n?: number;
}

interface PaginaEntrada {
  id: string;
  imagen: string; // data URL de la página ENTERA ya enderezada (no un recorte)
  tipo: "demografia" | "items";
  items?: ItemEntrada[]; // requerido si tipo === "items", en el mismo orden en que aparecen impresos
}

// Los 6 catálogos de opción única de demografía que en v2 son casilla de
// letra (README §4.9) — sexo, ccaa_educacion_secundaria, nivel_estudios,
// area_estudios, estudios_mayor_progenitor, libros_en_casa. El año de
// nacimiento se pide aparte (dígitos, no catálogo).
const CAMPOS_DEMOGRAFIA_CATALOGO = [
  "sexo",
  "ccaa_educacion_secundaria",
  "nivel_estudios",
  "area_estudios",
  "estudios_mayor_progenitor",
  "libros_en_casa",
] as const;

function validarItem(it: unknown): it is ItemEntrada {
  if (typeof it !== "object" || it === null) return false;
  const o = it as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.formato !== "string" || !FORMATOS_VALIDOS.has(o.formato as FormatoItem)) return false;
  if (o.formato === "ordenar" || o.formato === "clasificar") {
    return typeof o.n === "number" && Number.isInteger(o.n) && o.n > 0;
  }
  return true;
}

function validarPagina(p: unknown): p is PaginaEntrada {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.imagen !== "string" || !o.imagen.startsWith("data:image/")) return false;
  if (o.tipo === "demografia") return true;
  if (o.tipo === "items") return Array.isArray(o.items) && o.items.length > 0 && o.items.every(validarItem);
  return false;
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
  "cadena vacía. Devuelve siempre JSON, nunca prosa ni markdown.";

function describirFormatoItem(item: ItemEntrada): string {
  switch (item.formato) {
    case "abierto":
      return "respuesta libre corta (varias casillas de letra formando una palabra o sigla)";
    case "opcion_multiple":
      return "opción única: UNA letra";
    case "seleccion_multiple":
      return 'selección múltiple: TODAS las letras elegidas juntas, sin separadores (p. ej. "AC")';
    case "ordenar":
      return `ordenar: ${item.n} posiciones numeradas de 1 a ${item.n}, cada una con la letra del elemento que va ahí`;
    case "clasificar":
      return `clasificar: ${item.n} elementos numerados de 1 a ${item.n}, cada uno con la letra de su categoría`;
  }
}

function construirContenidoPagina(pagina: PaginaEntrada): Array<Record<string, unknown>> {
  const texto =
    pagina.tipo === "demografia"
      ? `Página "${pagina.id}": es la página de datos de la hoja (demografía). Necesito la letra escrita en la ` +
        `casilla de cada uno de estos campos (una letra por campo): ${CAMPOS_DEMOGRAFIA_CATALOGO.join(", ")}. Y el ` +
        'año de nacimiento como los 4 dígitos escritos en sus 4 casillas (campo "anio_nacimiento").'
      : `Página "${pagina.id}": contiene, en este orden de arriba a abajo, los siguientes ítems del test:\n` +
        pagina
          .items!.map((it, i) => `${i + 1}. id="${it.id}" — ${describirFormatoItem(it)}`)
          .join("\n") +
        "\nDame la respuesta definitiva de cada uno.";
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

function esquemaOrdenClasificar(n: number) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (let i = 1; i <= n; i++) {
    properties[String(i)] = { type: "string" };
    required.push(String(i));
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function esquemaItem(item: ItemEntrada) {
  if (item.formato === "ordenar" || item.formato === "clasificar") return esquemaOrdenClasificar(item.n!);
  return { type: "string" };
}

function construirEsquemaCompleto(paginas: PaginaEntrada[]) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const pagina of paginas) {
    if (pagina.tipo === "demografia") {
      for (const campo of CAMPOS_DEMOGRAFIA_CATALOGO) {
        const clave = `${pagina.id}::${campo}`;
        properties[clave] = { type: "string" };
        required.push(clave);
      }
      const claveAnio = `${pagina.id}::anio_nacimiento`;
      properties[claveAnio] = { type: "string" };
      required.push(claveAnio);
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
// Traduce la respuesta definitiva por ítem/campo de vuelta a la misma forma
// {clave: texto} que ya esperaba el resto del pipeline (v2/digitalizar.js::
// decodificarRespuestas, sin cambios): el motor Tesseract produce
// "item:<id>:opcion" = "B", este motor produce exactamente lo mismo aunque
// la lectura sea por página entera, no por casilla suelta. Nunca se rellena
// la clave ":correccion:..." (el modelo ya resolvió esa precedencia él
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

  if (!Array.isArray(b.paginas) || b.paginas.length === 0 || !b.paginas.every(validarPagina)) {
    return error(
      env,
      400,
      'Falta paginas: array de {id, imagen:data-url, tipo:"demografia"|"items", items?:[{id,formato,n?}]}'
    );
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
      "El motor de OCR-IA no está configurado en este Worker (falta el secreto OPENAI_API_KEY) — usa el motor Tesseract mientras tanto."
    );
  }

  const modelo = typeof b.modelo === "string" && b.modelo ? b.modelo : (env.OPENAI_MODEL ?? MODELO_POR_DEFECTO);

  console.log("[ocr-ia] petición", {
    modelo,
    paginas: paginas.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      items: p.items?.map((it) => `${it.id} (${it.formato}${it.n ? `, n=${it.n}` : ""})`),
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
      for (const campo of CAMPOS_DEMOGRAFIA_CATALOGO) {
        textos[`demografia:${campo}`] = letraOVacio(plano[`${pagina.id}::${campo}`]);
      }
      const anio = letraOVacio(plano[`${pagina.id}::anio_nacimiento`]).replace(/\D/g, "");
      for (let i = 0; i < 4; i++) textos[`demografia:anio_nacimiento:${i}`] = anio[i] ?? "";
    } else {
      for (const item of pagina.items!) {
        volcarRespuestaItem(textos, item, plano[`${pagina.id}::${item.id}`]);
      }
    }
    resultados[pagina.id] = textos;
  }

  return json(env, { modelo, resultados });
}
