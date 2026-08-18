// Motor de OCR-IA del pipeline en papel (README §4.7): único motor de
// lectura desde que se retiraron Tesseract.js y el OMR (v1/v2 del pipeline,
// ver git log) — la hoja se resuelve mandando la imagen de página entera a
// un modelo de visión. Las casillas de consentimiento/compromiso de
// honestidad se imprimen igual, pero nunca se leen aquí (decisión del
// propietario del proyecto: no condicionan la digitalización).
//
// Diseño: se manda la PÁGINA ENTERA ya enderezada como una sola imagen, no un
// recorte por casilla — el modelo lee el layout impreso él solo (enunciados,
// letras de opción, elementos, categorías ya están en la propia imagen), sin
// que haga falta decirle coordenadas ni repetir el contenido del banco de
// ítems en el prompt: así una sola llamada por página (o una por examen
// completo, según agrupación) sustituye a decenas de recortes: más simple,
// más barato y más preciso (un recorte obliga al modelo a decidir a ciegas
// sin ver el resto de la pregunta).
//
// Demografía (SYSTEM_PROMPT_DEMOGRAFIA más abajo) y páginas de ítems
// (SYSTEM_PROMPT_ITEMS) usan diseños DISTINTOS: a demografía se le pide
// directamente la RESPUESTA DEFINITIVA de cada campo (resolviendo el propio
// modelo la precedencia Respuesta/Corrección, README §4.9) — sigue dando
// 100% de acierto medido, así que no se ha tocado. A los ítems del test, en
// cambio (tasa de fallo alta con ese mismo diseño), se les pide el texto
// crudo de "Respuesta" y "Corrección" por separado, resolviendo la
// precedencia en código después de leer la respuesta (más fiable que
// dejársela al modelo, ver el comentario junto a bloqueTieneContenido) — y
// usando como clave el número de pregunta que el modelo ve impreso, no el id
// interno del banco de ítems (ver el comentario junto a SYSTEM_PROMPT_ITEMS).
// El resultado se traduce aquí mismo, en ambos casos, de vuelta a la misma
// forma {clave: texto} que espera
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
import {
  EJEMPLO_UNO_DISPARO_IMAGEN_DATA_URL,
  EJEMPLO_UNO_DISPARO_RESPUESTA_JSON,
  EJEMPLO_UNO_DISPARO_USER_PROMPT,
} from "./ocrIaEjemplo";

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
  // Id interno del banco de ítems (data/items.json) — el modelo nunca lo ve;
  // solo se usa aquí para nombrar las claves de salida ("item:<id>:...") que
  // espera public/admin/papel/digitalizar.js::decodificarRespuestas.
  id: string;
  formato: FormatoItem;
  // Posición ABSOLUTA del ítem en el banco completo (1-25), la misma que se
  // imprime dentro del círculo junto al enunciado
  // (public/admin/papel/hoja.js::construirEnunciado) — es lo que el modelo
  // SÍ ve impreso, así que es también la clave que se le pide usar en el
  // JSON de salida (construirEsquemaCompleto/construirContenidoPagina): a
  // diferencia de pedirle usar item.id (una numeración que no ve en ningún
  // sitio de la hoja), aquí no hace falta que el modelo traduzca nada — la
  // traducción numero→id se hace en código, después de leer la respuesta.
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
  // Nº de casillas realmente impresas para la respuesta — obligatorio para
  // "abierto" (worker/src/items.ts::casillasAbiertoPara), restringe el
  // esquema JSON a exactamente esa longitud (minLength/maxLength/pattern):
  // como son casillas físicas, la transcripción SIEMPRE mide ese nº exacto
  // de caracteres (huecos = espacio), nunca más ni menos.
  numCasillas?: number;
  // Detección determinista de tinta por casilla, SIEMPRE calculada por el
  // cliente sobre la imagen ya enderezada, ANTES de llamar aquí
  // (public/admin/papel/comun.js::detectarTintaCasillas, hoja.js::
  // calcularGeometriaCasillas, issue #35). Desde la ronda del 18 de agosto de
  // 2026 del issue #37, la detección es de 2 ZONAS (blanco/tinta, sin banda
  // "dudosa" intermedia) — densidad relativa al blanco local + varianza de
  // intensidad, separador de margen máximo calibrado contra 552 casillas de
  // ocr_tests/ (312 sintéticas + 240 reales de 3 escaneos distintos, margen
  // de separación de 769 puntos de varianza entre clases): con esa certeza,
  // "no está en la lista de blancas" significa "tiene tinta" con la misma
  // confianza que estar en ella, así que el esquema ya puede forzar CONTENIDO
  // no vacío, no solo forzar vacío. Nunca calculado por el modelo. Campos
  // opcionales según formato:
  //
  // - ordenar/clasificar/opcion_multiple: posiciones (1-based, sobre
  //   "1"..item.n) que ya se saben sin rellenar. Es la causa raíz del fallo
  //   de #33 en ordenar/clasificar — sin esto, cuando el modelo no sabe de
  //   antemano qué casilla está vacía, lee las letras SIN hueco en el orden
  //   en que aparecen y las reparte secuencialmente entre TODAS las
  //   posiciones, desplazando todo lo que va después del primer hueco en vez
  //   de dejar esa posición como cadena vacía. Las posiciones que NO están en
  //   esta lista se fuerzan a una letra (nunca cadena vacía) — 2 zonas, sin
  //   término medio. Si la lista cubre TODAS las posiciones del bloque, el
  //   bloque entero se fuerza a null, no a un objeto con todas las
  //   posiciones en "". opcion_multiple tiene una única casilla por lado
  //   (item.n no aplica: siempre 1), así que "posición 1 en blanco" == "el
  //   bloque entero está vacío"; si no, se fuerza una letra.
  posicionesEnBlancoRespuesta?: number[];
  posicionesEnBlancoCorreccion?: number[];
  // - abierto/seleccion_multiple: nº de casillas entre la primera y la última
  //   CON tinta (0..item.numCasillas para abierto, 0..item.numOpciones para
  //   seleccion_multiple; 0 = ninguna, fuerza null) — incluye cualquier hueco
  //   intermedio sin tinta (en abierto son los espacios entre palabras; en
  //   selección múltiple, casillas de opciones no marcadas entre dos que sí
  //   lo están). El esquema fuerza esa longitud EXACTA (minLength = maxLength
  //   = este valor) — antes (issue #35) solo se usaba como techo con un
  //   margen de seguridad, porque el umbral absoluto de densidad podía
  //   quedarse corto por una casilla borderline (7.9 de densidad contra un
  //   umbral de 8, el caso real que motivó el #37 entero); con la detección
  //   de 2 zonas ya no hay ese margen de error — la varianza separa con 769
  //   puntos de margen en las 552 casillas calibradas, así que exigir la
  //   longitud exacta es seguro.
  longitudDetectadaRespuesta?: number;
  longitudDetectadaCorreccion?: number;
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
// Consentimiento/compromiso_honestidad se imprimen en la hoja (recordatorio
// para quien la rellena) pero NUNCA se piden aquí: no condicionan la
// digitalización (worker/src/endpoints/admin/digitalizacion.ts siempre las
// da por buenas) y, medidas contra la API real, resultaron ser el campo
// menos fiable de toda la hoja sin aportar nada a cambio — decisión del
// propietario del proyecto, no una limitación técnica del motor.
const CAMPOS_DEMOGRAFIA_VALIDOS = new Set<string>([...CAMPOS_DEMOGRAFIA_CATALOGO, "anio_nacimiento"]);

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
  if (o.formato === "abierto" && !(typeof o.numCasillas === "number" && Number.isInteger(o.numCasillas) && o.numCasillas > 0)) {
    return `formato "abierto" necesita numCasillas (entero > 0): ${JSON.stringify(o.numCasillas)}`;
  }
  for (const campo of ["posicionesEnBlancoRespuesta", "posicionesEnBlancoCorreccion"] as const) {
    const valor = o[campo];
    if (valor === undefined) continue;
    if (o.formato !== "ordenar" && o.formato !== "clasificar" && o.formato !== "opcion_multiple") {
      return `${campo} solo es válido en ordenar/clasificar/opcion_multiple, no en "${o.formato}"`;
    }
    // opcion_multiple siempre tiene una única casilla por lado (item.n no
    // aplica ahí, ver ItemEntrada) — el límite superior es 1, no o.n.
    const n = o.formato === "opcion_multiple" ? 1 : (o.n as number);
    if (!Array.isArray(valor) || valor.some((p) => typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > n)) {
      return `${campo} debe ser un array de enteros entre 1 y n=${n}: ${JSON.stringify(valor)}`;
    }
  }
  for (const campo of ["longitudDetectadaRespuesta", "longitudDetectadaCorreccion"] as const) {
    const valor = o[campo];
    if (valor === undefined) continue;
    if (o.formato !== "abierto" && o.formato !== "seleccion_multiple") {
      return `${campo} solo es válido en abierto/seleccion_multiple, no en "${o.formato}"`;
    }
    // El límite es numCasillas en abierto (nº de casillas físicas) o
    // numOpciones en seleccion_multiple (una casilla por opción impresa) —
    // formatos distintos, mismo campo, mismo significado ("longitud del
    // tramo entre la primera y la última casilla con tinta").
    const limite = o.formato === "abierto" ? (o.numCasillas as number) : (o.numOpciones as number);
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor > limite) {
      return `${campo} debe ser un entero entre 0 y ${o.formato === "abierto" ? "numCasillas" : "numOpciones"}=${limite}: ${JSON.stringify(valor)}`;
    }
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
// modelo de la imagen; aquí solo se le da el número de cada uno para poder
// devolverlo en la respuesta, y la forma esperada de la respuesta).
//
// Dos prompts de sistema distintos, combinados según qué tipos de página
// trae la petición (construirSystemPrompt más abajo):
//
// - SYSTEM_PROMPT_DEMOGRAFIA: sin cambios respecto al diseño anterior (100%
//   de acierto medido en ocr_tests/README.md) — el modelo ya resuelve él
//   mismo la precedencia Respuesta/Corrección y devuelve la respuesta
//   definitiva de cada campo.
// - SYSTEM_PROMPT_ITEMS: enfoque nuevo en prueba para los ítems del test
//   (tasa de fallo alta con el diseño anterior). Dos cambios de fondo: (1)
//   el modelo ya NO resuelve la precedencia Respuesta/Corrección — devuelve
//   ambas por separado (respuesta_inicial/correccion) y la resolución se
//   hace en código (más abajo, bloqueTieneContenido), determinista en vez
//   de depender del modelo (un fallo real de precedencia motivó este
//   cambio, ver ocr_tests/README.md); (2) el JSON de salida usa como claves
//   los NÚMEROS DE PREGUNTA que el modelo ve impresos en el círculo, no los
//   ids internos del banco de ítems — antes el esquema exigía como clave
//   `item.id` (p. ej. "05"), una numeración que el modelo no ve impresa en
//   ningún sitio (el círculo imprime "5", sin ceros a la izquierda,
//   hoja.js::construirEnunciado) y que solo podía inferir indirectamente
//   del texto del prompt; ahora se le pide la numeración que él mismo lee,
//   y la traducción a item.id se hace después, en código.
// ============================================================

// A diferencia de las páginas de ítems (SYSTEM_PROMPT_ITEMS), la página de
// datos/demografía (public/admin/papel/hoja.js::construirBloquesDemografia)
// NUNCA imprime un bloque "Corrección" para estos campos — cada uno tiene un
// único bloque "Respuesta" (una casilla para año de nacimiento, o una sola
// letra para el resto). El prompt anterior describía un bloque "Corrección"
// que no existe en absoluto en esta página (sí existe en las páginas de
// ítems, de donde se copió por error) — inventarle al modelo una precedencia
// que resolver sobre algo que no está impreso es puro ruido, así que se
// retiró (issue #31).
export const SYSTEM_PROMPT_DEMOGRAFIA =
  "Eres un asistente que digitaliza hojas de examen en papel escaneadas y ya enderezadas. Cada campo tiene un único " +
  'bloque "Respuesta": una casilla, o varias para el año de nacimiento, donde se escribió a mano una letra de ' +
  "opción o un dígito, en MAYÚSCULAS de imprenta. No hay ningún bloque de corrección en esta página: transcribe " +
  "tal cual lo consignado en Respuesta, sin resolver ninguna precedencia.\n" +
  "En las casillas de una sola letra (catálogos de datos personales), a veces alguien escribe algo más que la " +
  'letra dentro o junto a la casilla — p. ej. "F) 7" o "B. La presión" en vez de simplemente "F" o "B". En esos ' +
  "casos, identifica cuál es la LETRA de la opción marcada e ignora cualquier otro carácter, número o palabra que " +
  "la acompañe: la respuesta es solo esa letra, nunca la letra más texto adicional.\n" +
  "Si un campo está en blanco o es absolutamente indistinguible, su valor es null — no inventes una letra o dígito " +
  "plausible.\n" +
  "Responde SIEMPRE a todos los campos que se te piden, uno por uno, sin saltarte ninguno. Devuelve siempre JSON, " +
  "nunca prosa ni markdown.";

export const SYSTEM_PROMPT_ITEMS =
  "Eres un asistente que digitaliza hojas de examen en papel escaneadas. Cada pregunta tiene un bloque " +
  '"Respuesta" (una o varias casillas donde se escribió la respuesta a mano) y un bloque "Corrección", con la ' +
  'etiqueta "Corrección (solo si te equivocaste antes)" en letra más pequeña, que solo se rellena si la persona ' +
  'quiso corregir lo que puso en "Respuesta". La POSICIÓN del bloque Corrección respecto al de Respuesta depende ' +
  'del formato de la pregunta: en las preguntas de formato abierto, Corrección va JUSTO DEBAJO de Respuesta (una ' +
  "fila de casillas encima de la otra); en el resto de formatos (opción múltiple, selección múltiple, ordenar, " +
  'clasificar), Respuesta y Corrección van EN LA MISMA FILA, una al lado de la otra (Respuesta a la izquierda, ' +
  "Corrección a la derecha) — no confundas esa columna de la derecha con el enunciado de la siguiente pregunta.\n" +
  "Para cada pregunta debes dar ambas respuestas, usando como claves respuesta_inicial y correccion. La salida " +
  "completa en formato JSON debe seguir el siguiente formato (esto es un ejemplo de una supuesta hoja cuya " +
  "primera pregunta es la 8):\n" +
  '```json\n{"8": {"respuesta_inicial": "freud", "correccion": null}, "9": ...}\n```\n' +
  "Es decir, pondrás como claves principales del JSON los números de pregunta de la página. Y dentro de cada " +
  "pregunta, pondrás dos claves, una para la respuesta inicial y otra para la corrección, dejando como null " +
  "aquellas que no tengan contenido o sea absolutamente indistinguible.\n" +
  "Hay cinco formatos de preguntas: abierto, ordenar, clasificar, opcion_multiple, seleccion_multiple. Dependiendo " +
  "del tipo de pregunta (se te especificará junto con la imagen de la hoja el tipo de preguntas que contiene) la " +
  "salida debe ir en uno u otro formato:\n" +
  "* Abierto: pondrás el texto tal cual está, respetando espacios en blanco si hay. Entre casilla y casilla NO " +
  "hay un espacio en blanco. Los espacios en blanco solo se corresponden a casillas vacías. No incluyas saltos " +
  "de línea aunque haya varias líneas de casillas. Y nunca completes palabras escritas a medias. Tu misión no " +
  "es interpretar la intención del alumno, sino reflejar fielmente lo consignado en la hoja.\n" +
  '* Ordenar y clasificar: pondrás un diccionario con claves de "1" a "N" (N es el número total de elementos a ' +
  'ordenar/clasificar) y las letras consignadas en cada una de las posiciones, con cadenas vacías si hay bloques ' +
  'sin rellenar. Ejemplo: {"1": "B", "2": "", "3": "J"...}. Esos números aparecen encima de las casillas en las ' +
  "que el alumno debe escribir, y están siempre ordenados. **Jamás** pongas una letra en posiciones " +
  "correspondientes a casillas sin rellenar: recuerda que debes consignar fielmente lo escrito por el alumno, " +
  "sin añadir o modificar información.\n" +
  "* Opción múltiple: pondrás la opción elegida, una única letra, en mayúscula.\n" +
  "* Selección múltiple: pondrás todas las opciones elegidas, en un único string, en mayúsculas. Por ejemplo: " +
  '"BJ A". Si hay espacios entre medias, los dejas, para transcribir fielmente lo consignado (luego los ' +
  "quitaremos en post-proceso).\n" +
  "En todas las respuestas, tanto en respuesta_inicial como en correccion usarás null en los casos en los que no " +
  "hay nada o es indistinguible. Si una pregunta entera está en blanco (ninguna casilla de ese bloque tiene nada " +
  "escrito), su valor es null — no inventes una letra, palabra o posición plausible solo porque el resto de la " +
  "hoja parece coherente con alguna.\n" +
  "En resumen, se espera de ti una transcripción estructurada y fiel, sin interpretaciones. Sobre todo, **nunca " +
  "modifiques** lo consignado: no te inventes la respuesta si no está, ni añadas o completes palabras u opciones. " +
  "Tu misión no es corregir, sino digitalizar de manera absolutamente exacta lo que hay en el papel.";

// Combina los prompts de sistema según qué tipos de página trae ESTA
// petición — en el modo por defecto del panel ("una llamada por página",
// README ocr_tests/README.md) cada petición trae un solo tipo, así que en
// la práctica esto nunca mezcla ambos prompts; solo puede pasar en el modo
// "examen completo" (una sola llamada con toda la hoja).
function construirSystemPrompt(paginas: PaginaEntrada[]): string {
  const partes: string[] = [];
  if (paginas.some((p) => p.tipo === "demografia")) partes.push(SYSTEM_PROMPT_DEMOGRAFIA);
  if (paginas.some((p) => p.tipo === "items")) partes.push(SYSTEM_PROMPT_ITEMS);
  return partes.join("\n\n");
}

// Ejemplo de una sola vez (few-shot, issue #31 — ver ocr_tests/
// generar_one_shot.mjs y ocr_tests/one_shot_example/ para el porqué de cada
// una de sus 4 preguntas): un turno user+assistant adicional, ANTES de la
// página real, que le muestra al modelo una página YA RESUELTA con los casos
// donde seguía alucinando pese al refuerzo de SYSTEM_PROMPT_ITEMS —
// completar una respuesta corta hacia la canónica, inventar una letra en una
// pregunta en blanco, cerrar un hueco en una selección múltiple o rellenar
// una posición sin contestar en "ordenar". Solo se añade si la petición trae
// alguna página de tipo "items" (demografía ya mide 100% de acierto sin él,
// y el ejemplo no tiene ningún campo censal que enseñar).
// Exportado únicamente para poder testear la condición de activación sin
// mockear la API de OpenAI (mismo criterio que construirEsquemaCompleto/
// construirContenidoPagina más abajo).
export function construirMensajesEjemplo(paginas: PaginaEntrada[]): Array<Record<string, unknown>> {
  if (!paginas.some((p) => p.tipo === "items")) return [];
  return [
    {
      role: "user",
      content: [
        { type: "text", text: EJEMPLO_UNO_DISPARO_USER_PROMPT },
        { type: "image_url", image_url: { url: EJEMPLO_UNO_DISPARO_IMAGEN_DATA_URL, detail: "high" } },
      ],
    },
    { role: "assistant", content: EJEMPLO_UNO_DISPARO_RESPUESTA_JSON },
  ];
}

function letraMax(n: number): string {
  return LETRAS[n - 1];
}

function describirFormatoItemBreve(item: ItemEntrada): string {
  switch (item.formato) {
    case "abierto":
      return "Abierto";
    case "opcion_multiple":
      return `Opción múltiple, entre A y ${letraMax(item.numOpciones!)}`;
    case "seleccion_multiple":
      return `Selección múltiple, con opciones entre A y ${letraMax(item.numOpciones!)}`;
    case "ordenar":
      return `Ordenar ${item.n} elementos (letras A-${letraMax(item.n!)}) en las posiciones 1-${item.n}`;
    case "clasificar":
      return `Clasificar ${item.n} elementos (números 1-${item.n}) en categorías entre A y ${letraMax(item.numCategorias!)}`;
  }
}

// numeroPagina: posición (1-based) de esta página dentro de LA PETICIÓN
// actual (no un id interno) — es lo único que se le muestra al modelo para
// referirse a "esta página" en el texto del prompt de un ítem; con una sola
// página por petición (el modo por defecto del panel) siempre vale 1. Antes
// se usaba aquí pagina.id (p. ej. "pagina-3" en producción o
// "01-letra-clara-6" en los fixtures de prueba), un identificador interno
// sin ningún significado para el modelo.
export function construirContenidoPagina(pagina: PaginaEntrada, numeroPagina = 1): Array<Record<string, unknown>> {
  let texto: string;
  if (pagina.tipo === "demografia") {
    const campos = pagina.campos!;
    const catalogos = campos.filter((c) => c !== "anio_nacimiento");
    const partes: string[] = [
      `Debes digitalizar la página ${numeroPagina}: es (una parte de) la página de datos de la hoja (demografía).`,
    ];
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
    texto = partes.join(" ");
  } else {
    // Cada pregunta se identifica por el NÚMERO IMPRESO dentro del círculo
    // junto a su enunciado — el mismo número que se le pide usar como clave
    // en el JSON de salida (a diferencia del diseño anterior, que exigía
    // como clave el id interno del banco de ítems, una numeración que el
    // modelo nunca ve impresa en la hoja).
    texto =
      `Debes digitalizar la página ${numeroPagina}, en el JSON ya especificado, que contiene los siguientes ` +
      "ítems del test:\n" +
      pagina.items!.map((it) => `- Pregunta ${it.numero}: ${describirFormatoItemBreve(it)}.`).join("\n") +
      '\n\nPara cada pregunta debes transcribir tanto "Respuesta" como "Corrección".';
  }
  return [
    { type: "text", text: texto },
    // detail:"high" evita que la API downscalee la imagen antes de leerla —
    // sin esto, una letra entre varias parecidas puede perderse en la pasada
    // de baja resolución que "auto" usa por defecto para decidir cuántos
    // tiles pedir.
    { type: "image_url", image_url: { url: pagina.imagen, detail: "high" } },
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

// Un objeto {"1": <letra o vacío>, "2": ..., ...} con una propiedad por
// posición (ordenar) o por elemento (clasificar) — cada valor restringido a
// las letras realmente válidas para ESE ítem (elementos en ordenar,
// categorías en clasificar: dos conjuntos de letras distintos y de tamaño
// distinto, ver numCategorias en ItemEntrada), o cadena vacía si esa casilla
// no está rellenada — a diferencia del diseño anterior (enum sin cadena
// vacía + todo el ítem null si no había nada), aquí cada posición puede
// estar en blanco por separado dentro de un bloque Respuesta/Corrección que
// sí tiene contenido en otras posiciones. El objeto entero también puede ser
// null si el bloque completo (Respuesta o Corrección) está en blanco.
//
// posicionesForzadasVacias (issue #35): posiciones 1-based que el cliente ya
// detectó sin tinta de forma determinista (ItemEntrada.posicionesEnBlanco*
// más arriba) — para esas, el esquema no ofrece ninguna letra como opción
// (enum: [""]) en vez del patrón normal letra-o-vacío: el modelo ya no puede
// "inventar" una letra ahí ni desplazar el resto de la secuencia para
// rellenar el hueco, porque Structured Outputs no le deja otra salida.
function esquemaPosicionesNullable(numPosiciones: number, numLetrasValidas: number, posicionesForzadasVacias?: number[]) {
  const letra = letraMax(numLetrasValidas);
  const forzadas = new Set(posicionesForzadasVacias ?? []);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (let i = 1; i <= numPosiciones; i++) {
    properties[String(i)] = forzadas.has(i) ? { type: "string", enum: [""] } : { type: "string", pattern: `^[A-${letra}]?$` };
    required.push(String(i));
  }
  return { anyOf: [{ type: "object", properties, required, additionalProperties: false }, { type: "null" }] };
}

// Esquema del contenido de UN bloque (Respuesta o Corrección) para un ítem,
// según su formato — se usa igual para respuesta_inicial y para correccion
// (esquemaPregunta más abajo), ya que ambos bloques admiten la misma forma.
function esquemaCampoRespuestaItem(item: ItemEntrada) {
  switch (item.formato) {
    case "abierto": {
      // maxLength = nº de casillas realmente impresas (numCasillas): nunca
      // puede haber más caracteres que casillas físicas. Deliberadamente
      // SIN minLength ni longitud exacta ({n} en vez de {0,n}) pese a que
      // las casillas sobrantes se dibujan en blanco en la hoja: probado
      // contra la API real, exigir longitud EXACTA (minLength=maxLength=n)
      // hacía que el modelo, forzado a completar hasta n caracteres,
      // rellenara el resto con basura inventada en vez de espacios
      // ("INFLACIÓN   NULL", "AMINOÁCIDOS    A", "SODICÁONIMAÑIÑIÑIÑ") — un
      // efecto secundario real del grammar-constrained decoding de
      // Structured Outputs, no una interpretación equivocada del prompt.
      // Con solo un tope máximo el modelo simplemente para de escribir
      // cuando termina la respuesta real, sin verse obligado a inventar
      // relleno. El alfabeto cubre mayúsculas, vocales con tilde, Ñ,
      // dígitos, espacio y "/" (hace falta para respuestas como "4/15",
      // README ocr_tests) — no letras minúsculas ni signos de puntuación
      // sueltos, y sin salto de línea posible (\n no pertenece a la clase
      // de caracteres).
      const n = item.numCasillas!;
      return {
        anyOf: [{ type: "string", maxLength: n, pattern: `^[A-Z0-9ÁÉÍÓÚÜÑ /]{0,${n}}$` }, { type: "null" }],
      };
    }
    case "opcion_multiple":
      // "" además de null como formas alternativas de "sin marcar" — el
      // modelo puede devolver cualquiera de las dos, el post-proceso trata
      // ambas igual (letraOVacio).
      return { anyOf: [{ type: "string", enum: ["", ...LETRAS.slice(0, item.numOpciones!)] }, { type: "null" }] };
    case "seleccion_multiple":
      // Letras válidas y espacios, sin límite de longitud: se le pide
      // transcribir fielmente lo escrito, espacios incluidos (los quita el
      // post-proceso, digitalizar.js::letrasValidas ya ignora cualquier
      // carácter que no sea una letra válida).
      return { anyOf: [{ type: "string", pattern: `^[A-${letraMax(item.numOpciones!)} ]*$` }, { type: "null" }] };
    case "ordenar":
      // Una permutación (parcial) de sus propios elementos: n posiciones, n
      // letras válidas.
      return esquemaPosicionesNullable(item.n!, item.n!);
    case "clasificar":
      return esquemaPosicionesNullable(item.n!, item.numCategorias!);
  }
}

// true si el ítem trae ALGÚN dato de detección determinista de tinta para
// CUALQUIERA de los dos lados — issue #35, ampliado de ordenar/clasificar a
// los 5 formatos (cada uno usa un subconjunto distinto de estos campos, ver
// ItemEntrada). Cuando es true, Respuesta y Corrección dejan de compartir el
// mismo esquema `campo` (esquemaCampoRespuestaItem): cada una se construye
// por separado con esquemaCampoRespuestaItemLado, aplicando SOLO lo que se
// detectó para ESE lado concreto (el otro lado, si no trae nada, sale con el
// esquema normal sin restringir — misma lógica que antes para ordenar/
// clasificar, generalizada).
function tieneDeteccionDeTinta(item: ItemEntrada): boolean {
  return (
    item.posicionesEnBlancoRespuesta != null ||
    item.posicionesEnBlancoCorreccion != null ||
    item.longitudDetectadaRespuesta != null ||
    item.longitudDetectadaCorreccion != null
  );
}

// Esquema de posiciones (ordenar/clasificar) cuando SÍ hay detección de tinta
// — a diferencia de esquemaPosicionesNullable (usada en
// esquemaCampoRespuestaItem, la variante SIN detección, donde cada posición
// admite letra-o-vacío sin ninguna certeza), aquí cada posición YA se sabe
// con certeza si tiene tinta o no: 2 zonas (issue #37, ronda del 18 de agosto
// de 2026), no hay una tercera opción "dudosa" que dejar sin restringir. Las
// posiciones en `posicionesForzadasVacias` se fuerzan a "" (igual que antes);
// TODAS LAS DEMÁS se fuerzan a una letra — sin el "?" del patrón anterior,
// que todavía admitía cadena vacía incluso en una posición ya detectada con
// tinta. Si la lista cubre TODAS las posiciones, el bloque entero es null en
// vez de un objeto con cada posición en "".
function esquemaPosicionesConDeteccion(numPosiciones: number, numLetrasValidas: number, posicionesForzadasVacias: number[]) {
  const forzadas = new Set(posicionesForzadasVacias);
  if (forzadas.size >= numPosiciones) return { type: "null" };
  const letra = letraMax(numLetrasValidas);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (let i = 1; i <= numPosiciones; i++) {
    properties[String(i)] = forzadas.has(i) ? { type: "string", enum: [""] } : { type: "string", pattern: `^[A-${letra}]$` };
    required.push(String(i));
  }
  return { type: "object", properties, required, additionalProperties: false };
}

// Esquema de UN lado (Respuesta o Corrección) cuando el ítem trae detección
// de tinta — variante de esquemaCampoRespuestaItem que, según formato, aplica
// lo detectado para ESE lado concreto. Diseño de 2 zonas (issue #37, ronda
// del 18 de agosto de 2026, tras corregir el desalineamiento de fiduciales
// del #38 y calibrar densidad+varianza contra 552 casillas con 769 puntos de
// margen): ya no existe una zona "dudosa" intermedia que dejar sin forzar, así
// que en los 4 formatos con detección se fuerza tanto el lado vacío (null o
// "") como el lado con contenido (una letra, o una longitud exacta) — antes
// (issue #35) solo se forzaba el vacío, nunca el contenido, precisamente
// porque el umbral absoluto de densidad podía confundir una casilla
// borderline con tinta real.
//   - ordenar/clasificar: cada posición se fuerza a "" o a una letra
//     (esquemaPosicionesConDeteccion) — nunca queda sin restringir.
//   - opcion_multiple: única casilla en blanco (posición 1) -> todo el bloque
//     null; si no, se fuerza una letra (nunca "" ni null).
//   - abierto/seleccion_multiple: 0 casillas con tinta -> null; si no, se
//     fuerza la longitud EXACTA detectada (minLength = maxLength), no un
//     techo con margen — la varianza ya separa con margen de sobra (769
//     puntos en las 552 casillas calibradas), así que un conteo exacto ya no
//     es el punto único de fallo que era con el umbral absoluto de #35.
function esquemaCampoRespuestaItemLado(item: ItemEntrada, lado: "respuesta" | "correccion") {
  const posiciones = (lado === "respuesta" ? item.posicionesEnBlancoRespuesta : item.posicionesEnBlancoCorreccion) ?? [];
  switch (item.formato) {
    case "ordenar":
      return esquemaPosicionesConDeteccion(item.n!, item.n!, posiciones);
    case "clasificar":
      return esquemaPosicionesConDeteccion(item.n!, item.numCategorias!, posiciones);
    case "opcion_multiple":
      if (posiciones.includes(1)) return { type: "null" };
      return { type: "string", enum: [...LETRAS.slice(0, item.numOpciones!)] };
    case "seleccion_multiple": {
      const longitud = lado === "respuesta" ? item.longitudDetectadaRespuesta : item.longitudDetectadaCorreccion;
      const letra = letraMax(item.numOpciones!);
      if (longitud === 0) return { type: "null" };
      // Sin longitud detectada para este lado: mismo esquema que sin ninguna
      // detección (esquemaCampoRespuestaItem) — sin forzar ningún relleno.
      if (longitud == null) {
        return { anyOf: [{ type: "string", pattern: `^[A-${letra} ]*$` }, { type: "null" }] };
      }
      return { type: "string", minLength: longitud, maxLength: longitud, pattern: `^[A-${letra} ]{${longitud}}$` };
    }
    case "abierto": {
      const longitud = lado === "respuesta" ? item.longitudDetectadaRespuesta : item.longitudDetectadaCorreccion;
      const n = item.numCasillas!;
      if (longitud === 0) return { type: "null" };
      if (longitud == null) {
        return { anyOf: [{ type: "string", maxLength: n, pattern: `^[A-Z0-9ÁÉÍÓÚÜÑ /]{0,${n}}$` }, { type: "null" }] };
      }
      return { type: "string", minLength: longitud, maxLength: longitud, pattern: `^[A-Z0-9ÁÉÍÓÚÜÑ /]{${longitud}}$` };
    }
  }
}

// {"respuesta_inicial": <bloque Respuesta>, "correccion": <bloque
// Corrección>} — el modelo ya no resuelve la precedencia entre ambos
// (SYSTEM_PROMPT_ITEMS), eso se hace en código, ver bloqueTieneContenido
// más abajo.
function esquemaPregunta(item: ItemEntrada) {
  if (tieneDeteccionDeTinta(item)) {
    return {
      type: "object",
      properties: {
        respuesta_inicial: esquemaCampoRespuestaItemLado(item, "respuesta"),
        correccion: esquemaCampoRespuestaItemLado(item, "correccion"),
      },
      required: ["respuesta_inicial", "correccion"],
      additionalProperties: false,
    };
  }
  const campo = esquemaCampoRespuestaItem(item);
  return {
    type: "object",
    properties: { respuesta_inicial: campo, correccion: campo },
    required: ["respuesta_inicial", "correccion"],
    additionalProperties: false,
  };
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
        if (campo === "anio_nacimiento") {
          // Solo dígitos, como mucho 4 (una casilla por dígito impreso) — no
          // impide una respuesta incompleta (2 dígitos escritos, 2 en
          // blanco), pero sí cualquier carácter que no sea un dígito. También
          // admite null (campo en blanco del todo, SYSTEM_PROMPT_DEMOGRAFIA;
          // letraOVacio más abajo trata null igual que cadena vacía).
          properties[clave] = { anyOf: [{ type: "string", pattern: "^[0-9]{0,4}$" }, { type: "null" }] };
        } else {
          // El esquema anterior no admitía null (solo las letras del
          // catálogo), pese a que SYSTEM_PROMPT_DEMOGRAFIA sí le pide null
          // para un campo en blanco — reflejamos aquí las opciones reales del
          // catálogo (issue #31) MÁS la posibilidad de null.
          properties[clave] = {
            anyOf: [esquemaLetraEnum(LONGITUD_CATALOGO[campo as (typeof CAMPOS_DEMOGRAFIA_CATALOGO)[number]]), { type: "null" }],
          };
        }
        required.push(clave);
      }
    } else {
      // Clave = número de pregunta IMPRESO (el que ve el modelo en el
      // círculo), sin prefijo de página — a diferencia de demografía
      // (arriba), no hace falta namespacear por página: item.numero ya es
      // único en todo el examen (posición absoluta 1-25 en el banco), así
      // que tampoco puede colisionar entre páginas dentro de una misma
      // petición ("examen completo"). Evita además la traducción indirecta
      // que exigía el diseño anterior (ver el comentario grande junto a
      // SYSTEM_PROMPT_ITEMS).
      for (const item of pagina.items!) {
        const clave = String(item.numero);
        properties[clave] = esquemaPregunta(item);
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

// Preferencia de valores de bajo esfuerzo de razonamiento, de más a menos
// barato/rápido — distintas generaciones de modelos gpt-5 soportan conjuntos
// distintos: gpt-5/gpt-5-mini/gpt-5-nano aceptan "minimal" (el valor más
// barato); gpt-5.4-* ya NO lo soportan y lo han renombrado a "none" (probado
// contra la API real, issue #31: "Unsupported value: 'reasoning_effort' does
// not support 'minimal' with this model. Supported values are: 'none',
// 'low', 'medium', 'high', and 'xhigh'."). En vez de mantener a mano un mapa
// modelo→valor soportado (se quedaría desactualizado con cada modelo nuevo),
// se prueba "minimal" primero y, si la API lo rechaza, se relee su propio
// mensaje de error para elegir el valor más barato que SÍ soporte y
// reintentar una vez — más robusto ante modelos futuros que este mismo caso
// ya demostró que hace falta.
const PREFERENCIA_REASONING_EFFORT = ["none", "minimal", "low", "medium", "high", "xhigh"];

// Extrae los valores soportados del mensaje 400 de OpenAI para
// `reasoning_effort` (p. ej. "Supported values are: 'none', 'low', 'medium',
// 'high', and 'xhigh'.") y devuelve el más barato de esa lista, o null si el
// mensaje no tiene la forma esperada (entonces no merece la pena reintentar).
function elegirReasoningEffortDesdeError(mensaje: string): string | null {
  if (!mensaje.includes("reasoning_effort")) return null;
  const valores = [...mensaje.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  if (valores.length === 0) return null;
  const soportados = new Set(valores);
  return PREFERENCIA_REASONING_EFFORT.find((v) => soportados.has(v)) ?? valores[0];
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
// Traduce el par {respuesta_inicial, correccion} que devuelve el modelo
// (SYSTEM_PROMPT_ITEMS) a la misma forma {clave: texto} que esperaba el
// diseño anterior y sigue esperando
// public/admin/papel/digitalizar.js::decodificarRespuestas — "item:<id>:
// opcion" = "B", igual para cualquier formato. A diferencia del diseño
// anterior, la precedencia Respuesta/Corrección YA NO la resuelve el modelo
// (era una fuente real de fallos, ver ocr_tests/README.md: un `clasificar`
// de 9 casillas donde el modelo ignoró una Corrección correcta y se quedó
// con la Respuesta original) — se resuelve aquí en código, determinista:
// si el bloque Corrección tiene algún contenido, es la respuesta definitiva
// completa (no se mezcla posición a posición con Respuesta); si Corrección
// está enteramente en blanco, la definitiva es Respuesta.
// ============================================================

function letraOVacio(v: unknown): string {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

// ¿Tiene contenido este bloque (Respuesta o Corrección) de un ítem? Para
// ordenar/clasificar (un objeto de posiciones) cuenta como "con contenido"
// si CUALQUIER posición está rellenada, no solo si lo están todas.
function bloqueTieneContenido(valor: unknown, item: ItemEntrada): boolean {
  if (item.formato === "ordenar" || item.formato === "clasificar") {
    const dict = typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};
    for (let i = 1; i <= item.n!; i++) {
      if (letraOVacio(dict[String(i)]) !== "") return true;
    }
    return false;
  }
  return letraOVacio(valor) !== "";
}

// Misma forma de salida que el diseño anterior (volcarRespuestaItem): ya no
// hace falta resolver precedencia aquí, `valor` YA es la respuesta
// definitiva (calculada por el llamador con bloqueTieneContenido).
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
  // razonamiento. `reasoning_effort` lo reduce al mínimo — mucho más rápido,
  // sin afectar a la calidad de lectura. Es un parámetro que solo aceptan los
  // modelos de razonamiento (gpt-5*, no gpt-4o-mini, que ni siquiera lo
  // soporta), así que solo se manda si el modelo empieza por "gpt-5" — mismo
  // motivo que la ausencia de `temperature` más abajo: un parámetro que un
  // modelo no soporta responde 400, no se ignora en silencio.
  const esModeloDeRazonamiento = /^gpt-5/.test(modelo);
  // Override opcional por petición (mismo criterio que `modelo` arriba) —
  // solo para poder comparar el efecto de más esfuerzo de razonamiento contra
  // la API real (ocr_tests/probar_ocr_ia.mjs, issue #31); el panel de admin
  // nunca lo manda, así que en producción real siempre se usa "minimal".
  const reasoningEffortPorDefecto =
    typeof b.reasoning_effort === "string" && b.reasoning_effort ? b.reasoning_effort : "minimal";

  function cuerpoPeticion(reasoningEffort: string | null) {
    return {
      model: modelo,
      response_format: {
        type: "json_schema",
        json_schema: { name: "respuestas_definitivas", strict: true, schema: construirEsquemaCompleto(paginas) },
      },
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      // Sin `temperature`: los modelos de la familia gpt-5 (a diferencia de
      // gpt-4o-mini) rechazan con 400 cualquier valor que no sea el 1 por
      // defecto ("Unsupported value: 'temperature' does not support 0.0
      // with this model").
      messages: [
        { role: "system", content: construirSystemPrompt(paginas) },
        ...construirMensajesEjemplo(paginas),
        {
          role: "user",
          content: paginas.flatMap((p, i) => construirContenidoPagina(p, i + 1)),
        },
      ],
    };
  }

  let respuestaOpenAI: Response;
  try {
    respuestaOpenAI = await llamarChatCompletions(
      env,
      cuerpoPeticion(esModeloDeRazonamiento ? reasoningEffortPorDefecto : null)
    );
    // "minimal" no lo soportan todas las generaciones de modelos gpt-5 (p.
    // ej. gpt-5.4-nano/gpt-5.4-mini, probado contra la API real: "Unsupported
    // value: 'reasoning_effort' does not support 'minimal' with this model" —
    // issue #31). Un único reintento con el valor de menor esfuerzo que el
    // propio mensaje de error diga que sí soporta, en vez de fallar la
    // petición entera por un parámetro de afinado de latencia.
    if (respuestaOpenAI.status === 400 && esModeloDeRazonamiento) {
      const detalle = await respuestaOpenAI.clone().text().catch(() => "");
      const alternativa = elegirReasoningEffortDesdeError(detalle);
      if (alternativa) {
        console.log("[ocr-ia] reintentando con reasoning_effort alternativo", { modelo, alternativa });
        respuestaOpenAI = await llamarChatCompletions(env, cuerpoPeticion(alternativa));
      }
    }
  } catch (e) {
    return error(env, 502, `No se pudo contactar con la API de OpenAI: ${(e as Error).message}`);
  }

  if (!respuestaOpenAI.ok) {
    const detalle = await respuestaOpenAI.text().catch(() => "");
    return error(env, 502, `La API de OpenAI respondió ${respuestaOpenAI.status}: ${detalle.slice(0, 500)}`);
  }

  const cuerpo = (await respuestaOpenAI.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      // Desglose de completion_tokens: cuánto de eso fue "pensar" (tokens
      // internos de razonamiento, gpt-5*) frente a la respuesta final —
      // solo para poder comparar el coste de subir reasoning_effort por
      // encima de "minimal" (issue #31, ocr_tests/README.md), nunca se lee
      // en el flujo normal.
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const contenido = cuerpo.choices?.[0]?.message?.content;
  if (!contenido) {
    return error(env, 502, "La API de OpenAI no devolvió contenido reconocible");
  }
  console.log("[ocr-ia] respuesta cruda del modelo", contenido);
  // Solo para observabilidad/depuración (p. ej. estimar coste por página con
  // `wrangler tail`, ocr_tests/README.md) — no forma parte del contrato con
  // el cliente, que nunca lo lee.
  console.log("[ocr-ia] uso", { modelo, ...cuerpo.usage });

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
        const pregunta = plano[String(item.numero)];
        const p = typeof pregunta === "object" && pregunta !== null ? (pregunta as Record<string, unknown>) : {};
        const definitiva = bloqueTieneContenido(p.correccion, item) ? p.correccion : p.respuesta_inicial;
        volcarRespuestaItem(textos, item, definitiva);
      }
    }
    resultados[pagina.id] = textos;
  }

  return json(env, { modelo, resultados });
}
