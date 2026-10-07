import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS_SCRIPT_FILES } from '../src/connectors/google-sheets/apps-script-files.ts';
import { channelFor } from './channel-info.ts';

/**
 * `pos-sheets.gs` (#219): todos los archivos del proyecto de Apps Script en uno solo, para pegar en
 * el `Código.gs` de una planilla. En el repo siguen separados (el puente, los textos, la home, la
 * inicialización, el tablero y un archivo de datos por rubro); Apps Script los ve igual, porque los
 * archivos de un proyecto comparten el ámbito global. La cabecera lleva `@OnlyCurrentDoc` en el
 * primer comentario (el permiso de solo esta planilla) y los pasos para instalar, con el link a las
 * instrucciones con imágenes de su canal (#221); se publica tal cual, así que nada de lo que dice
 * cita el repo.
 */
export function buildSheetsBundle(options: { sourcesDir: string; version: string }): string {
  const sources = APPS_SCRIPT_FILES.map((file) =>
    readFileSync(join(options.sourcesDir, file), 'utf8').trimEnd(),
  );
  const contract = /var CONTRACT_VERSION = '([\d.]+)'/.exec(sources[0] ?? '')?.[1];
  if (contract === undefined) {
    throw new Error('bridge.gs no declara CONTRACT_VERSION');
  }
  const channel = channelFor(contract);
  const header = `/**
 * @OnlyCurrentDoc
 *
 * pos-sheets.gs, POS ${options.version} (contrato ${contract}): una planilla de Google Sheets como
 * backend del POS, en un solo archivo.
 *
 * Instalar, en tres pasos (con imágenes en https://pos.contax.ar/${channel}/docs/google-sheets/):
 * 1. En una planilla vacía, Extensiones > Apps Script: reemplazá el contenido de Código.gs con este
 *    archivo y guardá.
 * 2. Implementar > Nueva implementación > Aplicación web (Ejecutar como: Yo; Quién tiene acceso:
 *    Cualquier persona) > Implementar, y autorizá el acceso a esta planilla.
 * 3. Abrí la URL de la aplicación web: ahí se prepara la planilla y se abre el POS en cada caja.
 *
 * Actualizar: reemplazá el contenido y guardá; después, Implementar > Administrar implementaciones >
 * lápiz > Versión: Nueva versión > Implementar. La URL no cambia.
 */`;
  return `${[header, ...sources].join('\n\n')}\n`;
}
