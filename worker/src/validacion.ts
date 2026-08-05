// Validación de la demografía recibida en POST /api/sesion contra los catálogos
// cerrados de README §2 (ver tipos.ts).
import { AREA_ESTUDIOS, CCAA, LIBROS_EN_CASA, NIVEL_ESTUDIOS, type Demografia } from "./tipos";

const ANIO_MINIMO = 1920;

function enCatalogo<T extends string>(valor: unknown, catalogo: readonly T[]): valor is T {
  return typeof valor === "string" && (catalogo as readonly string[]).includes(valor);
}

export function validarDemografia(body: unknown): Demografia | null {
  if (typeof body !== "object" || body === null) return null;
  const d = body as Record<string, unknown>;

  const anioMaximo = new Date().getUTCFullYear() - 5;
  if (
    typeof d.anio_nacimiento !== "number" ||
    !Number.isInteger(d.anio_nacimiento) ||
    d.anio_nacimiento < ANIO_MINIMO ||
    d.anio_nacimiento > anioMaximo
  ) {
    return null;
  }
  if (!enCatalogo(d.ccaa_educacion_secundaria, CCAA)) return null;
  if (!enCatalogo(d.nivel_estudios, NIVEL_ESTUDIOS)) return null;
  if (!enCatalogo(d.area_estudios, AREA_ESTUDIOS)) return null;
  if (!enCatalogo(d.estudios_mayor_progenitor, NIVEL_ESTUDIOS)) return null;
  if (!enCatalogo(d.libros_en_casa, LIBROS_EN_CASA)) return null;

  return {
    anio_nacimiento: d.anio_nacimiento,
    ccaa_educacion_secundaria: d.ccaa_educacion_secundaria,
    nivel_estudios: d.nivel_estudios,
    area_estudios: d.area_estudios,
    estudios_mayor_progenitor: d.estudios_mayor_progenitor,
    libros_en_casa: d.libros_en_casa,
  };
}
