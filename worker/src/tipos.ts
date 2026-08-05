// Tipos compartidos por el Worker. Ver README §4.1 (esquema D1), §4.2 (formato de
// ítems) y §2 (variables demográficas).

export type Dificultad = "facil" | "medio" | "dificil";
export type Formato = "abierto" | "opcion_multiple" | "ordenar" | "clasificar";
export type Fase = "corto" | "extension";
export type EstadoCorreccion = "auto" | "parcial" | "pendiente_revision" | "manual";

export interface Item {
  id: string;
  bloque: string;
  dificultad: Dificultad;
  ancla: boolean;
  formato: Formato;
  enunciado: string;
  texto: string | null;
  respuesta_canonica: string | null;
  alias: string[] | null;
  alias_parcial: string[] | null;
  tolerancia_edicion: number | null;
  opciones: string[] | null;
  indice_correcto: number | null;
  elementos: string[] | null;
  elementos_ordenados: string[] | null;
  categorias: string[] | null;
  clasificacion_correcta: Record<string, string> | null;
}

// Vista del ítem que sale hacia el cliente: nunca contiene la respuesta correcta.
// Ver worker/src/items.ts::paraCliente().
export interface ItemPublico {
  id: string;
  bloque: string;
  formato: Formato;
  enunciado: string;
  texto: string | null;
  opciones: string[] | null;
  elementos: string[] | null;
  categorias: string[] | null;
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
}

// --- Catálogos demográficos cerrados (README §2) ---
//
// El README fija las categorías de nivel_estudios, area_estudios y libros_en_casa
// (deben ser compatibles con INE/CINE/PISA) y exige que ccaa_* sean las 19
// comunidades/ciudades autónomas. Para profesion fija "CNO-11 a 1 dígito" (9 grandes
// grupos + estudiante/desempleado/jubilado). Para frecuencia_lectura,
// consumo_informativos y horas_redes_dia el README solo dice "Cerrado" sin enumerar
// las opciones: se fijan aquí catálogos concretos y razonables, documentados como tal
// para que se puedan ajustar sin tocar el resto del código.
//
// pais_nacimiento es "Cerrado + otros" (README): en vez de mantener un listado ISO de
// países que inevitablemente quedaría incompleto o desincronizado, se valida solo como
// texto no vacío (el front-end ofrece un <select> con los países más frecuentes en la
// muestra esperada + opción "Otro" de texto libre); el Worker no impone una lista
// cerrada aquí a propósito.

export const SEXO = ["Hombre", "Mujer", "Otro", "Prefiero no decirlo"] as const;

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
  "sin estudios",
  "primaria",
  "ESO",
  "bachillerato",
  "FP grado medio",
  "FP grado superior",
  "grado o licenciatura",
  "máster",
  "doctorado",
] as const;

export const AREA_ESTUDIOS = [
  "Artes y humanidades",
  "Ciencias sociales y jurídicas",
  "Ciencias",
  "Ingeniería y arquitectura",
  "Ciencias de la salud",
  "No aplica",
] as const;

export const PROFESION = [
  "Directores y gerentes",
  "Técnicos y profesionales científicos e intelectuales",
  "Técnicos y profesionales de apoyo",
  "Empleados contables, administrativos y otros empleados de oficina",
  "Trabajadores de los servicios de restauración, personales, protección y vendedores",
  "Trabajadores cualificados en el sector agrícola, ganadero, forestal y pesquero",
  "Artesanos y trabajadores cualificados de las industrias manufactureras y la construcción",
  "Operadores de instalaciones y maquinaria, y montadores",
  "Ocupaciones elementales",
  "Estudiante",
  "Desempleado/a",
  "Jubilado/a",
] as const;

export const LIBROS_EN_CASA = ["0-10", "11-25", "26-100", "101-200", "+200"] as const;

export const FRECUENCIA_LECTURA = [
  "Nunca",
  "Rara vez",
  "Algunas veces al mes",
  "Varias veces por semana",
  "A diario",
] as const;

export const CONSUMO_INFORMATIVOS = [
  "Nunca",
  "Rara vez",
  "Varias veces por semana",
  "A diario",
] as const;

export const HORAS_REDES_DIA = ["0", "Menos de 1", "1-2", "2-4", "Más de 4"] as const;

export interface Demografia {
  anio_nacimiento: number;
  sexo: (typeof SEXO)[number];
  pais_nacimiento: string;
  ccaa_nacimiento: (typeof CCAA)[number] | null;
  ccaa_residencia: (typeof CCAA)[number];
  nivel_estudios: (typeof NIVEL_ESTUDIOS)[number];
  area_estudios: (typeof AREA_ESTUDIOS)[number];
  profesion: (typeof PROFESION)[number];
  estudios_padre: (typeof NIVEL_ESTUDIOS)[number];
  estudios_madre: (typeof NIVEL_ESTUDIOS)[number];
  libros_en_casa: (typeof LIBROS_EN_CASA)[number];
  frecuencia_lectura: (typeof FRECUENCIA_LECTURA)[number];
  consumo_informativos: (typeof CONSUMO_INFORMATIVOS)[number];
  horas_redes_dia: (typeof HORAS_REDES_DIA)[number];
}
