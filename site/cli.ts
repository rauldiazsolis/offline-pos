import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `true` si el módulo se ejecutó con `node site/<archivo>.ts` y no se importó (tests). */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(importMetaUrl) === resolve(entry);
}
