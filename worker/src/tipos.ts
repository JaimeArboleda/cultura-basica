// Tipos compartidos por el Worker. Ver README §4.1 (esquema D1), §4.2 (formato de
// ítems) y §2 (variables demográficas).

export type TipoItem = "trivia" | "comentario_texto";
export type Dificultad = "facil" | "dificil";
export type Formato = "abierto" | "opcion_multiple" | "seleccion_multiple" | "ordenar" | "clasificar";
export type EstadoCorreccion = "auto" | "parcial" | "pendiente_revision" | "manual";

export interface Item {
  id: string;
  tipo: TipoItem;
  // null únicamente para el ítem de tipo "comentario_texto" (no pertenece al cupo
  // fácil/difícil, ver worker/src/puntuacion.ts).
  dificultad: Dificultad | null;
  formato: Formato;
  enunciado: string;
  texto: string | null;
  respuesta_canonica: string | null;
  alias: string[] | null;
  alias_parcial: string[] | null;
  tolerancia_edicion: number | null;
  opciones: string[] | null;
  indice_correcto: number | null;
  // Solo para formato "seleccion_multiple": índices (0-based) de las opciones
  // correctas. Acierto exige marcar exactamente ese conjunto, ni más ni menos.
  opciones_correctas: number[] | null;
  elementos: string[] | null;
  elementos_ordenados: string[] | null;
  categorias: string[] | null;
  clasificacion_correcta: Record<string, string> | null;
  // Opcional (solo presente en algún ítem puntual): suprime la nota genérica
  // "Rellena las que sepas..." (NOTAS_PARCIALES en public/app.js) cuando el
  // propio enunciado ya pide un número concreto de respuestas y la nota
  // resultaría engañosa (p. ej. data/items/09.json, que pregunta "qué DOS
  // continentes..."). Solo tiene sentido en formatos con puntuación
  // fraccionaria (seleccion_multiple, clasificar, ordenar).
  nota_parcial_desactivada?: boolean;
  // Opcional (solo presente en algún ítem "abierto" puntual, p. ej.
  // data/items/10.json): ejemplo del formato esperado en la respuesta (p.
  // ej. "1/2" para un ítem que pide el resultado como fracción). NUNCA se
  // escribe a mano dentro de enunciado (evita mantener el mismo ejemplo
  // repetido en dos sitios si algún día cambia): cada superficie compone su
  // propia aclaración a partir de este campo, con su propia redacción —
  // public/app.js añade "(por ejemplo, escribe "1/2").” tras el enunciado
  // (no hay ningún ejemplo visual en la web); public/admin/papel/hoja.js
  // añade solo "(mira el ejemplo)." porque ahí sí hay un ejemplo VISUAL
  // (una casilla pequeña por carácter, misma línea del enunciado — ver
  // construirEnunciado) y repetir el valor en texto sería redundante. No
  // revela la respuesta correcta del ítem, así que ItemPublico sí lo
  // expone.
  ejemplo_abierto?: string | null;
}

// Vista del ítem que sale hacia el cliente: nunca contiene la respuesta correcta.
// Ver worker/src/items.ts::paraCliente().
export interface ItemPublico {
  id: string;
  formato: Formato;
  enunciado: string;
  texto: string | null;
  opciones: string[] | null;
  elementos: string[] | null;
  categorias: string[] | null;
  // Ver Item.nota_parcial_desactivada. Siempre presente (boolean, no opcional)
  // para que el cliente no tenga que distinguir "false" de "ausente".
  nota_parcial_desactivada: boolean;
  // Solo para formato "abierto": nº de casillas realmente impresas para su
  // respuesta (worker/src/items.ts::casillasAbiertoPara) — null en cualquier
  // otro formato. No revela la respuesta correcta (README §4.3: ItemPublico
  // nunca la incluye), solo su longitud impresa; lo necesitan tanto
  // public/admin/papel/hoja.js (para dibujar el nº correcto de casillas en la
  // hoja, antes solo podía calcularlo con la propia respuesta_canonica, que
  // este tipo nunca expone — ver commit que descubrió el bug) como el motor
  // de OCR-IA (worker/src/endpoints/admin/ocrIa.ts, ItemEntrada.numCasillas)
  // para restringir el esquema de salida a la longitud exacta.
  casillas_abierto: number | null;
  // Solo cuando nota_parcial_desactivada es true en un "seleccion_multiple"
  // (el propio enunciado ya pide un número concreto, p. ej. data/items/09.json,
  // "qué DOS continentes..."): nº de opciones_correctas — null en cualquier
  // otro caso. Revela CUÁNTAS opciones hay que marcar, nunca CUÁLES (eso
  // seguiría sin exponerse, README §4.3) — lo usa
  // public/admin/papel/hoja.js para imprimir solo esas casillas ("Marca las
  // DOS que correspondan") en vez de una por cada opción del enunciado
  // ("Marca TODAS las que correspondan"), igual que ya hacía el test web al
  // suprimir la nota genérica de "rellena las que sepas" para este mismo ítem.
  num_correctas: number | null;
  // Ver Item.ejemplo_abierto. null en cualquier ítem que no lo tenga
  // (incluidos todos los formatos distintos de "abierto").
  ejemplo_abierto: string | null;
}

// Vista de un ítem ya respondido pero de una sesión aún en curso (README §3, §8:
// reanudar tras un refresco no debe hacer perder de vista lo contestado antes del
// corte). A diferencia de ItemRevision, NO incluye acierto ni respuesta correcta —
// la sesión no está completa, así que sigue vigente la regla de no revelar
// correcciones hasta el final (README §4.3). Ver
// worker/src/items.ts::paraClienteRespondido().
export interface ItemPublicoRespondido extends ItemPublico {
  respuesta_usuario: unknown;
}

// Vista de un ítem para la pantalla "ver respuestas" tras completar el test: a
// diferencia de ItemPublico, sí incluye la respuesta correcta y lo que respondió el
// usuario. Solo se sirve para sesiones ya completas (ver
// worker/src/endpoints/resultado.ts::getResultado).
export interface ItemRevision {
  id: string;
  formato: Formato;
  enunciado: string;
  texto: string | null;
  opciones: string[] | null;
  elementos: string[] | null;
  categorias: string[] | null;
  acierto: 0 | 1;
  respuesta_usuario: unknown;
  respuesta_correcta: unknown;
}

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  EXPORT_TOKEN: string;
  ALLOWED_ORIGIN: string;
  // Opcional: límite de creaciones de sesión por IP/minuto (ver ratelimit.ts).
  // Por defecto 5; se sube en tests para no toparse con el límite al crear muchas
  // sesiones de prueba seguidas desde la misma IP simulada.
  RATE_LIMIT_MAX?: string;
  // OAuth de Google para el panel de admin (README §4.5). GOOGLE_CLIENT_ID no es
  // secreto (va en wrangler.toml [vars]); GOOGLE_CLIENT_SECRET y
  // ADMIN_SESSION_SECRET sí lo son (wrangler secret put).
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Clave con la que se firma (HMAC-SHA256) la cookie de sesión de admin.
  ADMIN_SESSION_SECRET: string;
  // Backend de OCR-IA para v2 (README §4.7, "Motor gpt-mini"): OPENAI_API_KEY
  // es secreto (wrangler secret put); OPENAI_MODEL no lo es (va en
  // wrangler.toml [vars]) porque conviene poder cambiarlo sin redesplegar
  // código mientras se compara gpt-4o-mini vs gpt-5-mini con datos reales del
  // piloto — el cliente también puede pedir un modelo concreto por request
  // (POST /api/admin/ocr-ia), OPENAI_MODEL es solo el valor por defecto.
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

// --- Catálogos demográficos cerrados (README §2) ---
//
// El README fija las categorías de nivel_estudios, area_estudios y libros_en_casa
// (deben ser compatibles con INE/CINE/PISA) y exige que ccaa_educacion_secundaria sea
// una de las 19 comunidades/ciudades autónomas (el estudio se limita a España).

// 3 categorías (antes 4: "Otro" y "Prefiero no decirlo" fusionadas en una
// sola) — con 4 categorías la hoja en papel (README §4.7) no cabía en una
// sola página de datos censales.
export const SEXO = ["Hombre", "Mujer", "Otro / Prefiero no decirlo"] as const;

export const CCAA = [
  "Andalucía",
  "Aragón",
  "Asturias",
  "Cantabria",
  "Castilla-La Mancha",
  "Castilla y León",
  "Cataluña",
  "Comunidad Valenciana",
  "Extremadura",
  "Galicia",
  "Islas Baleares",
  "Canarias",
  "La Rioja",
  "Comunidad de Madrid",
  "Región de Murcia",
  "Navarra",
  "País Vasco",
  "Ceuta",
  "Melilla",
] as const;

export const NIVEL_ESTUDIOS = [
  "Sin estudios",
  "Primaria",
  "ESO",
  "Bachillerato",
  "FP grado medio",
  "FP grado superior",
  "Grado o licenciatura",
  "Máster",
  "Doctorado",
] as const;

export const AREA_ESTUDIOS = [
  "Artes y humanidades",
  "Ciencias sociales y jurídicas",
  "Ciencias",
  "Ingeniería y arquitectura",
  "Ciencias de la salud",
  "No aplica",
] as const;

export const LIBROS_EN_CASA = ["0-10", "11-25", "26-100", "101-200", "+200"] as const;

// --- Tokens de acceso (README §4.5) ---
//
// "Sin caducidad" se representa con este centinela en vez de NULL: D1/SQLite no
// permite relajar un NOT NULL con ALTER TABLE (solo add/drop/rename columna, no
// modificar constraints), así que en vez de migrar el esquema se usa una fecha
// deliberadamente lejana. Cualquier comparación existente
// (`new Date(token.expira_en).getTime() < Date.now()`) sigue funcionando sin
// tocarla: nunca es "menor que ahora". public/admin/admin.js duplica este mismo
// valor (no puede importar TypeScript del Worker, son despliegues separados,
// mismo motivo que CATALOGOS en public/js/demografia.js) para mostrar "Sin
// caducidad" en vez de una fecha.
export const EXPIRA_EN_INFINITO = "9999-12-31T23:59:59.999Z";

export interface Demografia {
  anio_nacimiento: number;
  sexo: (typeof SEXO)[number];
  ccaa_educacion_secundaria: (typeof CCAA)[number];
  nivel_estudios: (typeof NIVEL_ESTUDIOS)[number];
  area_estudios: (typeof AREA_ESTUDIOS)[number];
  estudios_mayor_progenitor: (typeof NIVEL_ESTUDIOS)[number];
  libros_en_casa: (typeof LIBROS_EN_CASA)[number];
}
