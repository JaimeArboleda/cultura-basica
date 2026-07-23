// Validación de la demografía recibida en POST /api/sesion contra los catálogos
// cerrados de README §2 (ver tipos.ts).
import {
  AREA_ESTUDIOS,
  CCAA,
  CONSUMO_INFORMATIVOS,
  FRECUENCIA_LECTURA,
  HORAS_REDES_DIA,
  LIBROS_EN_CASA,
  NIVEL_ESTUDIOS,
  PROFESION,
  SEXO,
  type Demografia,
} from "./tipos";

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
  if (!enCatalogo(d.sexo, SEXO)) return null;
  if (typeof d.pais_nacimiento !== "string" || d.pais_nacimiento.trim().length === 0 || d.pais_nacimiento.length > 100) {
    return null;
  }
  // ccaa_nacimiento es opcional (solo si nació en España, README §2)
  if (d.ccaa_nacimiento !== null && d.ccaa_nacimiento !== undefined && !enCatalogo(d.ccaa_nacimiento, CCAA)) {
    return null;
  }
  if (!enCatalogo(d.ccaa_residencia, CCAA)) return null;
  if (!enCatalogo(d.nivel_estudios, NIVEL_ESTUDIOS)) return null;
  if (!enCatalogo(d.area_estudios, AREA_ESTUDIOS)) return null;
  if (!enCatalogo(d.profesion, PROFESION)) return null;
  if (!enCatalogo(d.estudios_padre, NIVEL_ESTUDIOS)) return null;
  if (!enCatalogo(d.estudios_madre, NIVEL_ESTUDIOS)) return null;
  if (!enCatalogo(d.libros_en_casa, LIBROS_EN_CASA)) return null;
  if (!enCatalogo(d.frecuencia_lectura, FRECUENCIA_LECTURA)) return null;
  if (!enCatalogo(d.consumo_informativos, CONSUMO_INFORMATIVOS)) return null;
  if (!enCatalogo(d.horas_redes_dia, HORAS_REDES_DIA)) return null;

  return {
    anio_nacimiento: d.anio_nacimiento,
    sexo: d.sexo,
    pais_nacimiento: d.pais_nacimiento.trim(),
    ccaa_nacimiento: (d.ccaa_nacimiento as Demografia["ccaa_nacimiento"]) ?? null,
    ccaa_residencia: d.ccaa_residencia,
    nivel_estudios: d.nivel_estudios,
    area_estudios: d.area_estudios,
    profesion: d.profesion,
    estudios_padre: d.estudios_padre,
    estudios_madre: d.estudios_madre,
    libros_en_casa: d.libros_en_casa,
    frecuencia_lectura: d.frecuencia_lectura,
    consumo_informativos: d.consumo_informativos,
    horas_redes_dia: d.horas_redes_dia,
  };
}
