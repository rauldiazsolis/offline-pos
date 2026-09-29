import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MIN_BACKEND_CONTRACT, POS_CONTRACT_VERSION } from '../src/domain/contract-version.ts';
import { isMain } from './cli.ts';
import { renderGuidePage } from './guide-page.ts';
import type { VersionInfo } from './version-info.ts';

export type DocsSources = { guide: string; llms: string; openapi: string };

const repo = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

const DEFAULT_DOCS: DocsSources = {
  guide: repo('docs/integradores/guia.md'),
  llms: repo('docs/integradores/llms.txt'),
  openapi: repo('docs/connector-api.openapi.yaml'),
};

/** En el repo el OpenAPI está un nivel arriba; publicado, al lado. */
const localizeLinks = (text: string): string =>
  text.replaceAll('../connector-api.openapi.yaml', 'connector-api.openapi.yaml');

/**
 * Arma `/<versión>/` dentro del sitio (#148): el build, `version.json` (hechos del POS) y `docs/`.
 * Una carpeta publicada es inmutable: si ya existe, falla.
 */
export function buildVersionFolder(options: {
  distDir: string;
  siteDir: string;
  info: VersionInfo;
  docs?: DocsSources;
}): string {
  const { distDir, siteDir, info, docs = DEFAULT_DOCS } = options;
  const folder = join(siteDir, info.version);
  if (existsSync(folder)) {
    throw new Error(`La versión ${info.version} ya está publicada: las carpetas son inmutables`);
  }
  cpSync(distDir, folder, { recursive: true });
  writeFileSync(join(folder, 'version.json'), `${JSON.stringify(info, null, 2)}\n`);

  const docsDir = join(folder, 'docs');
  mkdirSync(docsDir);
  const guide = localizeLinks(readFileSync(docs.guide, 'utf8'));
  writeFileSync(join(docsDir, 'guia.md'), guide);
  writeFileSync(join(docsDir, 'llms.txt'), localizeLinks(readFileSync(docs.llms, 'utf8')));
  cpSync(docs.openapi, join(docsDir, 'connector-api.openapi.yaml'));
  writeFileSync(join(docsDir, 'index.html'), renderGuidePage(guide, info.version));
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
    throw new Error('Uso: node site/build-version.ts --dist <dir> --site <dir>');
  }
  const folder = buildVersionFolder({
    distDir: values.dist,
    siteDir: values.site,
    info: currentVersionInfo(),
  });
  console.log(`Versión armada en ${folder}`);
}
