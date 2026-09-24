const TEXT_CONTROLS = 'input, textarea, select';

/**
 * Patrón teclado + mouse (Etapa 2 de #94, sacado de `/RESUMEN`): va en el
 * `onMouseDown` del contenedor de una pantalla. Un click con el botón
 * izquierdo sobre algo que no es un control de texto le sacaría el foco al
 * "hogar" de la pantalla (el input o el contenedor) y lo dejaría en `<body>`,
 * donde los atajos ya no llegan — se cancela el `mousedown` (el `click` se
 * dispara igual). Los controles de texto quedan afuera para poder ubicar el
 * cursor con el mouse. Los demás botones no se tocan: la rueda y el
 * autoscroll con el botón del medio siguen andando.
 */
export function keepFocusOnMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest(TEXT_CONTROLS) !== null) return;
  event.preventDefault();
}
