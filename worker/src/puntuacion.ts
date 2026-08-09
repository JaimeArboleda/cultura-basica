// Puntuación ponderada interna, usada solo para calcular el percentil que se muestra
// en la pantalla de resultado (nunca se enseña la puntuación en bruto al usuario: es
// una cifra de trabajo, no un titular). Un acierto fácil vale el doble que uno difícil
// (4 / 2); el comentario de texto pesa como un término medio entre ambos (3), ya que
// no pertenece al cupo fácil/difícil. Máximo: 12×4 + 12×2 + 1×3 = 75.
import type { Item } from "./tipos";

export const PESO_FACIL = 4;
export const PESO_DIFICIL = 2;
export const PESO_COMENTARIO_TEXTO = 3;

export function pesoItem(item: Item): number {
  if (item.tipo === "comentario_texto") return PESO_COMENTARIO_TEXTO;
  return item.dificultad === "facil" ? PESO_FACIL : PESO_DIFICIL;
}

export function calcularPuntuacionPonderada(
  respuestas: { item_id: string; acierto: number }[],
  itemDeId: (itemId: string) => Item | undefined
): number {
  let total = 0;
  for (const r of respuestas) {
    const item = itemDeId(r.item_id);
    if (!item) continue; // ítem retirado del banco: no puntúa
    total += pesoItem(item) * r.acierto;
  }
  return total;
}
