/**
 * Actividad en curso mientras se espera a un servicio (Etapa 2 de #94).
 * Decorativo: el texto de qué se espera va aparte, en un `role="status"`.
 * Con `prefers-reduced-motion` queda quieto (`tokens.css`).
 */
export function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}
