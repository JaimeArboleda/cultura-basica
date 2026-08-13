// Corrección automática de respuestas. Traducción directa del algoritmo de README §1.6
// para ítems 'abierto', más la corrección exacta de los otros 3 formatos.
import type { EstadoCorreccion, Item } from "./tipos";

export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\p{Mn}\p{Me}]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const filas = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: filas }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < filas; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < filas; i++) {
    for (let j = 1; j < cols; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // borrado
        d[i][j - 1] + 1, // inserción
        d[i - 1][j - 1] + costo // sustitución
      );
    }
  }
  return d[filas - 1][cols - 1];
}

export interface ResultadoCorreccion {
  acierto: 0 | 1;
  estado_correccion: EstadoCorreccion;
}

// Compara la respuesta normalizada contra una lista de alias normalizados, aplicando
// la regla de §1.6: sin tolerancia (igualdad exacta) para respuestas de ≤4 caracteres;
// distancia de Levenshtein ≤ tolerancia para el resto. Ambas cosas son equivalentes a
// "Levenshtein con tolerancia 0" bajo 4 caracteres, salvo por coste — se hace explícito
// aquí para que la regla quede clara sin depender de leer levenshtein().
function matcheaAlgunAlias(normalizada: string, alias: string[], tolerancia: number): boolean {
  const aliasNormalizados = alias.map(normalizar);
  if (normalizada.length <= 4) {
    return aliasNormalizados.includes(normalizada);
  }
  return aliasNormalizados.some((a) => levenshtein(normalizada, a) <= tolerancia);
}

export function corregirAbierto(item: Item, respuestaCruda: string): ResultadoCorreccion {
  const normalizada = normalizar(respuestaCruda ?? "");
  if (normalizada === "") {
    return { acierto: 0, estado_correccion: "auto" };
  }

  const tolerancia = item.tolerancia_edicion ?? 0;

  if (matcheaAlgunAlias(normalizada, item.alias ?? [], tolerancia)) {
    return { acierto: 1, estado_correccion: "auto" };
  }
  if (item.alias_parcial && matcheaAlgunAlias(normalizada, item.alias_parcial, tolerancia)) {
    return { acierto: 0, estado_correccion: "parcial" };
  }
  return { acierto: 0, estado_correccion: "auto" };
}

export function corregirOpcionMultiple(item: Item, opcionElegida: number): ResultadoCorreccion {
  const acierto = opcionElegida === item.indice_correcto ? 1 : 0;
  return { acierto, estado_correccion: "auto" };
}

// Acierto exige marcar exactamente el conjunto de opciones_correctas, ni de más ni de
// menos (no hay puntuación parcial por acertar solo alguna).
export function corregirSeleccionMultiple(item: Item, seleccionadas: number[]): ResultadoCorreccion {
  const esperado = [...(item.opciones_correctas ?? [])].sort((a, b) => a - b);
  const recibido = Array.isArray(seleccionadas)
    ? [...new Set(seleccionadas)].sort((a, b) => a - b)
    : [];
  const acierto =
    recibido.length === esperado.length && recibido.every((v, i) => v === esperado[i]) ? 1 : 0;
  return { acierto, estado_correccion: "auto" };
}

export function corregirOrdenar(item: Item, respuestaOrden: string[]): ResultadoCorreccion {
  const esperado = item.elementos_ordenados ?? [];
  const acierto =
    Array.isArray(respuestaOrden) &&
    respuestaOrden.length === esperado.length &&
    respuestaOrden.every((el, i) => el === esperado[i])
      ? 1
      : 0;
  return { acierto, estado_correccion: "auto" };
}

export function corregirClasificar(
  item: Item,
  respuestaClasificacion: Record<string, string>
): ResultadoCorreccion {
  const esperado = item.clasificacion_correcta ?? {};
  const clavesEsperadas = Object.keys(esperado);
  const clavesRecibidas = Object.keys(respuestaClasificacion ?? {});
  const mismasClaves =
    clavesEsperadas.length === clavesRecibidas.length &&
    clavesEsperadas.every((k) => clavesRecibidas.includes(k));
  const acierto =
    mismasClaves && clavesEsperadas.every((k) => respuestaClasificacion[k] === esperado[k]) ? 1 : 0;
  return { acierto, estado_correccion: "auto" };
}

// Despachador por formato, compartido por POST /api/respuesta
// (worker/src/endpoints/respuesta.ts) y por la digitalización desde papel
// (worker/src/endpoints/admin/digitalizacion.ts, README §4.7): misma corrección
// para una respuesta tecleada en la web que para una ya interpretada por el
// pipeline de OMR/OCR, sin duplicar el switch por formato en dos sitios.
export function corregirRespuesta(item: Item, respuesta: unknown): ResultadoCorreccion | null {
  switch (item.formato) {
    case "abierto":
      return typeof respuesta === "string" ? corregirAbierto(item, respuesta) : null;
    case "opcion_multiple":
      return typeof respuesta === "number" ? corregirOpcionMultiple(item, respuesta) : null;
    case "seleccion_multiple":
      return Array.isArray(respuesta) ? corregirSeleccionMultiple(item, respuesta) : null;
    case "ordenar":
      return Array.isArray(respuesta) ? corregirOrdenar(item, respuesta) : null;
    case "clasificar":
      return typeof respuesta === "object" && respuesta !== null && !Array.isArray(respuesta)
        ? corregirClasificar(item, respuesta as Record<string, string>)
        : null;
  }
}
