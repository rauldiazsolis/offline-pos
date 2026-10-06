import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MIN_BACKEND_CONTRACT, POS_CONTRACT_VERSION } from '../src/domain/contract-version.ts';
import {
  channelFor,
  compareVersionsDesc,
  readChannelInfo,
  type VersionInfo,
} from './channel-info.ts';
import { isMain } from './cli.ts';
import { renderGuidePage } from './guide-page.ts';

/** Las docs de cada canal (#54); `sheets*`, la guía y los archivos del puente de Google Sheets (#180). */
export type DocsSources = {
  guide: string;
  llms: string;
  openapi: string;
  sheetsGuide: string;
  sheetsBridge: string;
  sheetsColumns: string;
};

const repo = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

const DEFAULT_DOCS: DocsSources = {
  guide: repo('docs/integradores/guia.md'),
  llms: repo('docs/integradores/llms.txt'),
  openapi: repo('docs/connector-api.openapi.yaml'),
  sheetsGuide: repo('docs/integradores/google-sheets.md'),
  sheetsBridge: repo('src/connectors/google-sheets/bridge.gs'),
  sheetsColumns: repo('src/connectors/google-sheets/columnas.gs'),
};

/** Dónde están los `.gs` en el repo, visto desde `docs/integradores/`. */
const SHEETS_SOURCES = '../../src/connectors/google-sheets/';

/**
 * Los links de las docs se escriben para el repo (`docs/integradores/`) y se localizan al publicar,
 * con un reemplazo literal de prefijos por destino. En el repo el OpenAPI está un nivel arriba;
 * publicado, al lado de `docs/guia.md`, y la guía del puente vive en su carpeta, con los `.gs`.
 */
const localizeOpenapi = (text: string): string =>
  text.replaceAll('../connector-api.openapi.yaml', 'connector-api.openapi.yaml');

/** `docs/guia.md` (y su `index.html`): la guía del puente es la página de su carpeta. */
const localizeGuide = (text: string): string =>
  localizeOpenapi(text).replaceAll('](google-sheets.md)', '](google-sheets/)');

/** `docs/llms.txt`: la guía del puente en Markdown y los `.gs` en su carpeta. */
const localizeLlms = (text: string): string =>
  localizeOpenapi(text)
    .replaceAll('](google-sheets.md)', '](google-sheets/guia.md)')
    .replaceAll(SHEETS_SOURCES, 'google-sheets/');

/** `docs/google-sheets/guia.md`: los `.gs` al lado, la otra guía un nivel arriba (el OpenAPI ya). */
const localizeSheetsGuide = (text: string): string =>
  text.replaceAll(SHEETS_SOURCES, '').replaceAll('](guia.md)', '](../guia.md)');

/**
 * Arma el canal `v<major del contrato>/` (#54): lo reemplaza entero con el build, `version.json`
 * (hechos del POS) y `docs/`, con el puente de Google Sheets y su guía en `docs/google-sheets/`.
 * Nunca baja ni repite la versión publicada en el canal: volver atrás es un revert y un tag de
 * parche (además, una versión vieja no abre una base de Dexie ya migrada).
 */
export function buildChannel(options: {
  distDir: string;
  siteDir: string;
  info: VersionInfo;
  docs?: DocsSources;
}): string {
  const { distDir, siteDir, info, docs = DEFAULT_DOCS } = options;
  const channel = channelFor(info.contract);
  const folder = join(siteDir, channel);
  const published = readChannelInfo(folder);
  // compareVersionsDesc(publicada, nueva) <= 0 ⇔ la publicada es igual o más nueva.
  if (published !== undefined && compareVersionsDesc(published.version, info.version) <= 0) {
    throw new Error(
      `La versión ${info.version} ya está publicada en /${channel}/ (o hay una más nueva: ${published.version}): para volver atrás, revert y un tag de parche`,
    );
  }
  rmSync(folder, { recursive: true, force: true });
  cpSync(distDir, folder, { recursive: true });
  writeFileSync(join(folder, 'version.json'), `${JSON.stringify(info, null, 2)}\n`);

  const docsDir = join(folder, 'docs');
  mkdirSync(docsDir);
  const guide = localizeGuide(readFileSync(docs.guide, 'utf8'));
  writeFileSync(join(docsDir, 'guia.md'), guide);
  writeFileSync(join(docsDir, 'llms.txt'), localizeLlms(readFileSync(docs.llms, 'utf8')));
  cpSync(docs.openapi, join(docsDir, 'connector-api.openapi.yaml'));
  writeFileSync(join(docsDir, 'index.html'), renderGuidePage(guide, info.version));

  const sheetsDir = join(docsDir, 'google-sheets');
  mkdirSync(sheetsDir);
  const sheetsGuide = localizeSheetsGuide(readFileSync(docs.sheetsGuide, 'utf8'));
  writeFileSync(join(sheetsDir, 'guia.md'), sheetsGuide);
  writeFileSync(join(sheetsDir, 'index.html'), renderGuidePage(sheetsGuide, info.version, '../'));
  cpSync(docs.sheetsBridge, join(sheetsDir, 'bridge.gs'));
  cpSync(docs.sheetsColumns, join(sheetsDir, 'columnas.gs'));
  return folder;
}

export function currentVersionInfo(): VersionInfo {
  const { version } = JSON.parse(readFileSync(repo('package.json'), 'utf8')) as {
    version: string;
  };
  return { version, contract: POS_CONTRACT_VERSION, minBackendContract: MIN_BACKEND_CONTRACT };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { dist: { type: 'string' }, site: { type: 'string' } } });
  if (values.dist === undefined || values.site === undefined) {
    throw new Error('Uso: node site/build-channel.ts --dist <dir> --site <dir>');
  }
  const folder = buildChannel({
    distDir: values.dist,
    siteDir: values.site,
    info: currentVersionInfo(),
  });
  console.log(`Canal armado en ${folder}`);
}
