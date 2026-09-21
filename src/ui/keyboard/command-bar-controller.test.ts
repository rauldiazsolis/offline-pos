import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCashSessionAndPersist } from '../../storage/cash-session-repository.ts';
import { db } from '../../storage/db.ts';
import { commandBarBufferSignal, commandBarErrorSignal } from '../state/command-bar.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { demoResetErrorSignal } from '../state/demo-reset.ts';
import { activeScreenSignal } from '../state/screen.ts';
import { activeConnectorTypeSignal } from '../state/sync.ts';
import { submitCommandBar, triggerCheckout } from './command-bar-controller.ts';
import { availableCommands } from './commands.ts';

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  commandBarErrorSignal.value = null;
  cartSignal.value = { lines: [] };
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('triggerCheckout (Fase 6: gate de turno de caja)', () => {
  it('sin turno abierto, muestra un error y no cambia de pantalla', async () => {
    await triggerCheckout();

    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarErrorSignal.value).not.toBeNull();
  });

  it('con un turno abierto, pasa a la pantalla de cobro', async () => {
    await openCashSessionAndPersist({ openingAmount: 0 });

    await triggerCheckout();

    expect(activeScreenSignal.value).toBe('checkout');
    expect(commandBarErrorSignal.value).toBeNull();
  });
});

describe('/DESCARTAR (Ciclo 8, sin confirmación)', () => {
  beforeEach(() => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'regalo', qty: 1, unitPrice: 50 }],
      globalAdjustmentPercentage: 10,
    };
    attachedCustomerSignal.value = { id: 'c1', name: 'Juan Pérez', createdAt: '2026-01-01T00:00:00.000Z' };
    cartSelectionIndexSignal.value = 0;
  });

  it('vacía líneas, ajuste global y cliente adjunto de una, sin paso intermedio', () => {
    commandBarBufferSignal.value = '/DESCARTAR';

    submitCommandBar();

    expect(cartSignal.value).toEqual({ lines: [] });
    expect(attachedCustomerSignal.value).toBeUndefined();
    expect(cartSelectionIndexSignal.value).toBeNull();
    expect(commandBarBufferSignal.value).toBe('');
  });
});

describe('/DEMO_RESET (Ciclo 8; comando del conector rest-demo desde la Etapa 2c)', () => {
  beforeEach(() => {
    activeScreenSignal.value = 'sale';
    demoResetErrorSignal.value = null;
    activeConnectorTypeSignal.value = 'rest-demo';
  });

  afterEach(() => {
    activeConnectorTypeSignal.value = null;
  });

  it('abre la pantalla de confirmación dedicada, sin borrar nada todavía', async () => {
    commandBarBufferSignal.value = '/DEMO_RESET';

    submitCommandBar();

    expect(activeScreenSignal.value).toBe('demo-reset');
    await expect(db.products.count()).resolves.toBe(0);
  });

  it.each(['rest', 'google-sheets', null] as const)(
    'con el conector %s no existe: da "Comando desconocido" y no cambia de pantalla',
    (connectorType) => {
      activeConnectorTypeSignal.value = connectorType;
      commandBarBufferSignal.value = '/DEMO_RESET';

      submitCommandBar();

      expect(commandBarErrorSignal.value).toBe('Comando desconocido: /DEMO_RESET');
      expect(activeScreenSignal.value).toBe('sale');
    },
  );
});

describe('availableCommands (Etapa 2c)', () => {
  const CORE = ['COBRAR', 'CAJA', 'RESUMEN', 'ANULAR', 'DESCARTAR', 'CONFIG', 'SINCRONIZAR'];

  afterEach(() => {
    activeConnectorTypeSignal.value = null;
  });

  it('siempre ofrece los comandos del núcleo', () => {
    for (const type of ['rest', 'rest-demo', 'google-sheets', null] as const) {
      activeConnectorTypeSignal.value = type;
      const names = availableCommands().map((command) => command.name);
      expect(names).toEqual(expect.arrayContaining(CORE));
    }
  });

  it('suma DEMO_RESET solo con el conector rest-demo', () => {
    activeConnectorTypeSignal.value = 'rest-demo';
    expect(availableCommands().map((command) => command.name)).toContain('DEMO_RESET');

    activeConnectorTypeSignal.value = 'rest';
    expect(availableCommands().map((command) => command.name)).not.toContain('DEMO_RESET');
  });
});
