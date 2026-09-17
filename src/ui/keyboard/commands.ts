/**
 * Comandos disponibles, para la lista que se muestra con solo "/" (§7 del
 * doc de diseño: "la barra enseña en vez de requerir memorización"). El
 * comportamiento real de cada uno vive en `command-bar-controller.ts` —
 * esto es solo lo que se le muestra al cajero.
 */
export const AVAILABLE_COMMANDS: { name: string; description: string }[] = [
  { name: 'COBRAR', description: 'Cobrar y cerrar la venta (o Ctrl+Enter)' },
  { name: 'CAJA', description: 'Abrir o cerrar el turno de caja' },
  { name: 'RESUMEN', description: 'Consultar tickets, productos y medios de pago del turno' },
  { name: 'ANULAR', description: 'Anular una venta ya cerrada' },
  { name: 'DESCARTAR', description: 'Vaciar la venta en curso (líneas, cliente y ajuste)' },
  { name: 'CONFIG', description: 'Configurar la conexión con el sistema externo' },
  { name: 'SINCRONIZAR', description: 'Sincronizar ahora' },
  { name: 'DEMO_RESET', description: 'Borrar todos los datos locales y reiniciar la demo' },
];
