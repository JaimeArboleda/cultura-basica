// Nombres legibles de los bloques temáticos (README §4.2: el slug interno del banco
// de ítems, p. ej. "biologia_geologia", no es apto para mostrar en la pantalla de
// resultado).
export const NOMBRE_BLOQUE = {
  arte: "Arte",
  biologia_geologia: "Biología y Geología",
  comprension_lectora: "Comprensión lectora",
  economia_politica: "Economía y Política",
  filosofia: "Filosofía",
  fisica_quimica: "Física y Química",
  geografia: "Geografía",
  historia: "Historia",
  lengua_literatura: "Lengua y Literatura",
  matematicas: "Matemáticas",
  razonamiento: "Razonamiento",
  religion: "Religión",
};

export function nombreBonito(bloque) {
  return NOMBRE_BLOQUE[bloque] ?? bloque;
}
