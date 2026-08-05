// Puntuación ponderada por dificultad (fallar una fácil pesa más que fallar una
// difícil): cada acierto vale 1,5 / 1 / 0,5 puntos según sea fácil, media o difícil.
// Con los 36 ítems fijos (12 bloques × 3 dificultades) el máximo sigue siendo 36,
// igual que contar aciertos a secas, así que la escala 0-36 no cambia de sentido.
import type { Dificultad } from "./tipos";

export const PESO_DIFICULTAD: Record<Dificultad, number> = {
  facil: 1.5,
  medio: 1,
  dificil: 0.5,
};

export function calcularPuntuacionPonderada(
  respuestas: { item_id: string; acierto: number }[],
  dificultadDeItem: (itemId: string) => Dificultad | undefined
): number {
  let total = 0;
  for (const r of respuestas) {
    const dificultad = dificultadDeItem(r.item_id);
    if (!dificultad) continue; // ítem retirado del banco: no puntúa
    total += PESO_DIFICULTAD[dificultad] * r.acierto;
  }
  return total;
}
