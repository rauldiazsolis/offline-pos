/**
 * Comandos disponibles, para la lista que se muestra con solo "/" (§7 del
 * doc de diseño: "la barra enseña en vez de requerir memorización"). El
 * comportamiento real de cada uno vive en `command-bar-controller.ts` —
 * esto es solo lo que se le muestra al cajero.
 */
export const AVAILABLE_COMMANDS: { name: string; description: string }[] = [
  { name: 'COBRAR', description: 'Cobrar y cerrar la venta (o Ctrl+Enter)' },
  { name: 'ANULAR', description: 'Anular una venta ya cerrada' },
  { name: 'CONFIG', description: 'Configurar la conexión con el sistema externo' },
  { name: 'SINCRONIZAR', description: 'Sincronizar ahora' },
];
