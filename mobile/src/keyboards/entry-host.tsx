import { entrySignal } from './entry.ts';
import { NumberEntry } from './number-entry.tsx';
import { TextEntry } from './text-entry.tsx';

/** Muestra la entrada abierta delante de todo (ver `entry.ts`). */
export function EntryHost() {
  const open = entrySignal.value;
  if (open === null) {
    return null;
  }
  return open.request.kind === 'number' ? (
    <NumberEntry key={open.seq} request={open.request} />
  ) : (
    <TextEntry key={open.seq} request={open.request} />
  );
}
