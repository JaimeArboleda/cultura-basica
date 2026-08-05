// Tipos compartidos por el Worker. Ver README §4.1 (esquema D1), §4.2 (formato de
// ítems) y §2 (variables demográficas).

export type Dificultad = "facil" | "medio" | "dificil";
export type Formato = "abierto" | "opcion_multiple" | "ordenar" | "clasificar";
export type EstadoCorreccion = "auto" | "parcial" | "pendiente_revision" | "manual";

export interface Item {
  id: string;
  bloque: string;
  dificultad: Dificultad;
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
// (deben ser compatibles con INE/CINE/PISA) y exige que ccaa_educacion_secundaria sea
// una de las 19 comunidades/ciudades autónomas (el estudio se limita a España).

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

export const LIBROS_EN_CASA = ["0-10", "11-25", "26-100", "101-200", "+200"] as const;

export interface Demografia {
  anio_nacimiento: number;
  ccaa_educacion_secundaria: (typeof CCAA)[number];
  nivel_estudios: (typeof NIVEL_ESTUDIOS)[number];
  area_estudios: (typeof AREA_ESTUDIOS)[number];
  estudios_mayor_progenitor: (typeof NIVEL_ESTUDIOS)[number];
  libros_en_casa: (typeof LIBROS_EN_CASA)[number];
}
