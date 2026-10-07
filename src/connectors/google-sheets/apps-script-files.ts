/**
 * Los archivos del proyecto de Apps Script de Google Sheets, en el orden en que se publican juntos
 * en `pos-sheets.gs` (#219): el puente primero, con `@OnlyCurrentDoc` en su primer comentario.
 * Los tests los cargan en el mismo orden.
 */
export const APPS_SCRIPT_FILES = [
  'bridge.gs',
  'columnas.gs',
  'inicio.gs',
  'tablero.gs',
  'home.gs',
  'datos-ferreteria.gs',
  'datos-kiosco.gs',
  'datos-almacen.gs',
] as const;
