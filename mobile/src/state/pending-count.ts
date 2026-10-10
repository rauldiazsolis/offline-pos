import { db } from '../../../src/storage/db.ts';
import { activeScreenSignal } from '../../../src/ui/state/screen.ts';
import { setPendingOutboxCount } from '../../../src/ui/state/sync.ts';

/**
 * El motor de sync cuenta lo pendiente al terminar cada ciclo; sin red no corre ninguno, y "Sin
 * conexión (N)" quedaba con el número viejo. Acá se vuelve a contar cada vez que cambia la pantalla
 * (después de cobrar, de una cobranza, de la caja o de anular).
 */
export function startPendingCount(): () => void {
  return activeScreenSignal.subscribe(() => {
    void db.outbox.where('status').equals('pending').count().then(setPendingOutboxCount);
  });
}
