import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadBackends, selectBackends } from './backends.ts';
import { isMain } from './cli.ts';
import { withLocalDemoBackend } from './local-demo-backend.ts';
import { queryBackend } from './query-backend.ts';
import { readPublishedVersions } from './version-info.ts';
import {
  renderRootLlms,
  renderVersionsPage,
  sameIgnoringGeneratedAt,
  type KnownBackend,
} from './versions-page.ts';

/** Escribe `content` salvo que lo publicado sea igual ignorando la fecha: el cron no hace commits vacíos. */
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && sameIgnoringGeneratedAt(readFileSync(path, 'utf8'), content)) {
    return;
  }
  writeFileSync(path, content);
}

/**
 * Regenera `/versions/index.html`, `/llms.txt`, `_headers` y `_redirects` del sitio (#148),
 * consultando cada backend conocido. Falla si alguno no contesta.
 */
export async function buildVersionsPage(
  siteDir: string,
  now: Date,
  { onlyLocal = false }: { onlyLocal?: boolean } = {},
): Promise<void> {
  const versions = readPublishedVersions(siteDir);
  const backends: KnownBackend[] = [];
  for (const entry of selectBackends(loadBackends(), { onlyLocal })) {
    const facts =
      entry.local === 'demo-backend'
        ? await withLocalDemoBackend((url) => queryBackend(url, now))
        : await queryBackend(entry.url, now);
    backends.push({ entry, facts });
  }
  mkdirSync(join(siteDir, 'versions'), { recursive: true });
  writeIfChanged(
    join(siteDir, 'versions', 'index.html'),
    renderVersionsPage(versions, backends, now.toISOString()),
  );
  writeIfChanged(join(siteDir, 'llms.txt'), renderRootLlms(versions));
  for (const file of ['_headers', '_redirects']) {
    cpSync(new URL(`./templates/${file}`, import.meta.url), join(siteDir, file));
  }
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { site: { type: 'string' } } });
  if (values.site === undefined) {
    throw new Error('Uso: node site/build-versions-page.ts --site <dir>');
  }
  await buildVersionsPage(values.site, new Date());
  console.log(`/versions regenerada en ${values.site}`);
}
