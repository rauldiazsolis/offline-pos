import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isAllowedBackendUrl } from '../src/sync/demo-link.ts';

/**
 * Backends conocidos de `/versions` (#148): un dato del sitio, no de una versión del POS (la app
 * nunca lo lee). Solo lo que no se puede averiguar solo; el contrato y las capacidades se consultan
 * en vivo (`query-backend.ts`). `local: 'demo-backend'`: la Action no llega a la máquina de nadie,
 * así que levanta el demo-backend del commit y lo consulta a él.
 */
const backendEntrySchema = z.object({
  name: z.string().min(1),
  url: z.url().refine(isAllowedBackendUrl, 'Tiene que ser https (o http a localhost)'),
  local: z.literal('demo-backend').optional(),
  notes: z.string().optional(),
});

export type BackendEntry = { name: string; url: string; local?: 'demo-backend'; notes?: string };

export function parseBackends(raw: unknown): BackendEntry[] {
  const parsed = z.array(backendEntrySchema).min(1).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`site/backends.json inválido:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.map(({ name, url, local, notes }) => ({
    name,
    url: url.replace(/\/+$/, ''),
    ...(local !== undefined ? { local } : {}),
    ...(notes !== undefined ? { notes } : {}),
  }));
}

export function loadBackends(
  path: URL = new URL('./backends.json', import.meta.url),
): BackendEntry[] {
  return parseBackends(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
