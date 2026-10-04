import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadBackends, selectBackends } from './backends.ts';
import { readChannels } from './channel-info.ts';
import { isMain } from './cli.ts';
import {
  renderHomePage,
  renderRootLlms,
  sameIgnoringGeneratedAt,
  type KnownBackend,
} from './home-page.ts';
import { withLocalDemoBackend } from './local-demo-backend.ts';
import { queryBackend } from './query-backend.ts';

/** Escribe `content` salvo que lo publicado sea igual ignorando la fecha: el cron no hace commits vacíos. */
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && sameIgnoringGeneratedAt(readFileSync(path, 'utf8'), content)) {
    return;
  }
  writeFileSync(path, content);
}

/**
 * Regenera la home (`/index.html`), `/llms.txt`, `_headers` y `_redirects` del sitio (#54),
 * consultando cada backend conocido. Falla si alguno no contesta.
 */
export async function buildHomePage(
  siteDir: string,
  now: Date,
  { onlyLocal = false }: { onlyLocal?: boolean } = {},
): Promise<void> {
  const channels = readChannels(siteDir);
  const backends: KnownBackend[] = [];
  for (const entry of selectBackends(loadBackends(), { onlyLocal })) {
    const facts =
      entry.local === 'demo-backend'
        ? await withLocalDemoBackend((url) => queryBackend(url, now))
        : await queryBackend(entry.url, now);
    backends.push({ entry, facts });
  }
  writeIfChanged(
    join(siteDir, 'index.html'),
    renderHomePage(channels, backends, now.toISOString()),
  );
  writeIfChanged(join(siteDir, 'llms.txt'), renderRootLlms(channels));
  for (const file of ['_headers', '_redirects']) {
    cpSync(new URL(`./templates/${file}`, import.meta.url), join(siteDir, file));
  }
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { site: { type: 'string' } } });
  if (values.site === undefined) {
    throw new Error('Uso: node site/build-home-page.ts --site <dir>');
  }
  await buildHomePage(values.site, new Date());
  console.log(`Home regenerada en ${values.site}`);
}
