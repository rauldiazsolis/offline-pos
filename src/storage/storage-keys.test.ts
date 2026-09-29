// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #148: las claves de `localStorage` pasan por `storageKey`, así en `/` quedan exactamente como
 * antes (`offline-pos:<nombre>`) y en una carpeta se aíslan. Este test lee el código: cada nombre
 * de hoy sigue usándose y ninguna clave con el prefijo escrito a mano volvió.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

const LEGACY_NAMES = [
  'sync-config',
  'sync-cursor:products',
  'sync-cursor:customers',
  'sync:last-full',
  'sync:push-lot',
  'sync:push-lot-awaiting',
  'backend-capabilities',
  'backend-notices',
  'cleanup:last-run',
  'receipt-counter',
  'ticket-counter',
  'device-id',
  'pending-wipe-key',
];

function sources(): { path: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => ({ path: file, text: readFileSync(join(SRC, file), 'utf8') }));
}

describe('claves de localStorage (#148)', () => {
  it('cada nombre de antes de #148 sigue pasando por storageKey', () => {
    const all = sources()
      .map((source) => source.text)
      .join('\n');
    for (const name of LEGACY_NAMES) {
      expect(all).toContain(`storageKey('${name}')`);
    }
  });

  it("ningún archivo escribe el prefijo 'offline-pos:' a mano", () => {
    const offenders = sources()
      .filter((source) => source.text.includes("'offline-pos:"))
      .map((source) => source.path);
    expect(offenders).toEqual([]);
  });
});
