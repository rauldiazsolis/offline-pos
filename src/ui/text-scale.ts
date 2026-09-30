/**
 * Una medida en píxeles que envuelve texto y crece con él (#111): por debajo de ~870 px de ancho el
 * texto deja de achicarse con el zoom (`--text-zoom-compensation` en `tokens.css`), así que el ancho
 * fijo de un diálogo, una columna o un campo tiene que acompañarlo o el texto no entra. De 870 px
 * para arriba el factor vale 1 y la medida es la de siempre.
 */
export function scaledPx(px: number): string {
  return `calc(${String(px)}px * var(--text-zoom-compensation))`;
}
