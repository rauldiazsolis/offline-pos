import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCustomerRepository } from '../../storage/customer-repository.ts';
import { db } from '../../storage/db.ts';
import { setCustomerRepository } from '../state/customer-repository.ts';
import {
  commandBarBufferSignal,
  commandBarErrorSignal,
  commandResultsSignal,
  effectiveCommandIndexSignal,
} from '../state/command-bar.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import { demoResetErrorSignal } from '../state/demo-reset.ts';
import { appUpdateSignal } from '../state/app-update.ts';
import { activeScreenSignal } from '../state/screen.ts';
import {
  activeConnectorTypeSignal,
  backendCapabilitiesSignal,
  backendPortalSignal,
  demoRevokedSignal,
  setDemoSession,
} from '../state/sync.ts';
import {
  activateCommandBarRow,
  moveSelection,
  selectCartLine,
  submitCommandBar,
  submitEmptyCommandBar,
  triggerCheckout,
  updateCommandBarBuffer,
} from './command-bar-controller.ts';
import { syncNow } from '../../sync/engine.ts';
import { applyAppUpdate } from './app-update-controller.ts';
import { availableCommands } from './commands.ts';
import { startNewDemo, startOnboarding } from './onboarding-controller.ts';
import { openPortal } from './portal-controller.ts';

// /SINCRONIZAR dispara un ciclo real en background: se neutraliza para no dejarlo corriendo tras cerrar la base.
vi.mock('../../sync/engine.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  syncNow: vi.fn(() => Promise.resolve()),
}));

// /ALTA navega fuera de la app: se espía en vez de dejar que jsdom intente navegar.
vi.mock('./onboarding-controller.ts', () => ({ startOnboarding: vi.fn(), startNewDemo: vi.fn() }));

// El portal abre una pestaña nueva: se espía (su lógica está en portal-controller.test.ts).
vi.mock('./portal-controller.ts', () => ({ openPortal: vi.fn(() => Promise.resolve()) }));

// /ACTUALIZAR suelta la pestaña y recarga: se espía (su lógica está en app-update-controller.test.ts).
vi.mock('./app-update-controller.ts', () => ({ applyAppUpdate: vi.fn(() => Promise.resolve()) }));

beforeEach(async () => {
  await db.open();
  activeScreenSignal.value = 'sale';
  commandBarErrorSignal.value = null;
  cartSignal.value = { lines: [] };
  attachedCustomerSignal.value = undefined;
  updateCommandBarBuffer('');
});

const freeformLine = { kind: 'freeform' as const, description: 'regalo', qty: 1, unitPrice: 50 };

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('triggerCheckout (sin turnos desde la Etapa 5, #100)', () => {
  beforeEach(() => {
    cartSignal.value = { lines: [freeformLine] };
  });

  it('sin turno abierto, igual pasa a la pantalla de cobro', async () => {
    await triggerCheckout();

    expect(activeScreenSignal.value).toBe('checkout');
    expect(commandBarErrorSignal.value).toBeNull();
  });
});

describe('comandos habilitados (Etapa 2 de #94)', () => {
  it('con carrito vacío y sin cliente, "/" no preselecciona /COBRAR y Enter no hace nada', () => {
    updateCommandBarBuffer('/');
    expect(commandResultsSignal.value[0]).toMatchObject({
      name: 'COBRAR',
      availability: { enabled: false },
    });
    expect(effectiveCommandIndexSignal.value).toBeNull();
    submitCommandBar();
    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarErrorSignal.value).toBeNull();
  });

  it('"/COBRAR" completo + Enter muestra el motivo', () => {
    updateCommandBarBuffer('/COBRAR');
    submitCommandBar();
    expect(commandBarErrorSignal.value).toBe(
      '/COBRAR no está disponible: sin artículos ni cliente.',
    );
  });

  it('↓ saltea los deshabilitados', () => {
    updateCommandBarBuffer('/');
    moveSelection(1);
    expect(commandResultsSignal.value[effectiveCommandIndexSignal.value ?? -1]?.name).toBe('CAJA');
    moveSelection(-1);
    expect(commandResultsSignal.value[effectiveCommandIndexSignal.value ?? -1]?.name).toBe('CAJA');
  });

  it('con un artículo, /COBRAR vuelve a preseleccionarse', () => {
    cartSignal.value = { lines: [freeformLine] };
    updateCommandBarBuffer('/');
    expect(effectiveCommandIndexSignal.value).toBe(0);
  });

  it('con cliente y sin artículos, /COBRAR está habilitado', () => {
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Juan Pérez',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    updateCommandBarBuffer('/');
    expect(commandResultsSignal.value[0]?.availability.enabled).toBe(true);
  });

  it('Ctrl+Enter (triggerCheckout) con /COBRAR deshabilitado muestra el motivo', async () => {
    await triggerCheckout();
    expect(commandBarErrorSignal.value).toBe(
      '/COBRAR no está disponible: sin artículos ni cliente.',
    );
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('un comando que no existe sigue siendo "Comando desconocido"', () => {
    updateCommandBarBuffer('/NOEXISTE');
    submitCommandBar();
    expect(commandBarErrorSignal.value).toBe('Comando desconocido: /NOEXISTE');
  });
});

describe('activateCommandBarRow (click en una fila, Etapa 2 de #94)', () => {
  it('comando: ejecuta la fila clickeada', () => {
    updateCommandBarBuffer('/');
    const index = commandResultsSignal.value.findIndex((command) => command.name === 'DIAGNOSTICO');
    activateCommandBarRow('command', index);
    expect(activeScreenSignal.value).toBe('diagnostico');
  });

  it('comando deshabilitado: no hace nada', () => {
    updateCommandBarBuffer('/');
    activateCommandBarRow('command', 0); // COBRAR con carrito vacío
    expect(activeScreenSignal.value).toBe('sale');
    expect(commandBarBufferSignal.value).toBe('/');
  });
});

describe('/SINCRONIZAR', () => {
  it('fuerza el push del lote pendiente y un pull completo, ya (#87)', () => {
    commandBarBufferSignal.value = '/SINCRONIZAR';

    submitCommandBar();

    expect(syncNow).toHaveBeenCalled();
  });
});

describe('/DESCARTAR (Ciclo 8, sin confirmación)', () => {
  beforeEach(() => {
    cartSignal.value = {
      lines: [{ kind: 'freeform', description: 'regalo', qty: 1, unitPrice: 50 }],
      globalAdjustmentPercentage: 10,
    };
    attachedCustomerSignal.value = {
      id: 'c1',
      name: 'Juan Pérez',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
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
  const CORE = [
    'COBRAR',
    'CAJA',
    'RESUMEN',
    'ANULAR',
    'DESCARTAR',
    'CONFIG',
    'IMPRESORA',
    'SINCRONIZAR',
    'DIAGNOSTICO',
  ];

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

describe('/ALTA (terminal en demo, #128)', () => {
  const demo = {
    template: 'kiosco',
    onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
    startedAt: '2026-09-28T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(startOnboarding).mockClear();
  });

  afterEach(() => {
    setDemoSession(null);
  });

  it('sin demo no está en la lista y da "Comando desconocido"', () => {
    setDemoSession(null);
    expect(availableCommands().map((command) => command.name)).not.toContain('ALTA');

    updateCommandBarBuffer('/ALTA');
    submitCommandBar();

    expect(commandBarErrorSignal.value).toBe('Comando desconocido: /ALTA');
    expect(startOnboarding).not.toHaveBeenCalled();
  });

  it('con demo está en la lista con la etiqueta del backend y lleva al alta', () => {
    setDemoSession(demo);
    expect(availableCommands().find((command) => command.name === 'ALTA')?.description).toBe(
      'Darse de alta: Crear mi comercio',
    );

    updateCommandBarBuffer('/ALTA');
    submitCommandBar();

    expect(startOnboarding).toHaveBeenCalledTimes(1);
    expect(commandBarErrorSignal.value).toBeNull();
    expect(commandBarBufferSignal.value).toBe('');
  });
});

describe('/ACTUALIZAR (versión nueva descargada, #54)', () => {
  beforeEach(() => {
    vi.mocked(applyAppUpdate).mockClear();
  });

  afterEach(() => {
    appUpdateSignal.value = 'none';
  });

  it('sin versión nueva no está en la lista y da "Comando desconocido"', () => {
    expect(availableCommands().map((command) => command.name)).not.toContain('ACTUALIZAR');

    updateCommandBarBuffer('/ACTUALIZAR');
    submitCommandBar();

    expect(commandBarErrorSignal.value).toBe('Comando desconocido: /ACTUALIZAR');
    expect(applyAppUpdate).not.toHaveBeenCalled();
  });

  it('con una versión nueva está en la lista y la aplica', () => {
    appUpdateSignal.value = 'available';
    expect(availableCommands().map((command) => command.name)).toContain('ACTUALIZAR');

    updateCommandBarBuffer('/ACTUALIZAR');
    submitCommandBar();

    expect(applyAppUpdate).toHaveBeenCalledTimes(1);
    expect(commandBarErrorSignal.value).toBeNull();
    expect(commandBarBufferSignal.value).toBe('');
  });
});

describe('/DEMO_NUEVA (terminal en demo, #176)', () => {
  const demo = {
    template: 'kiosco',
    onboarding: { url: 'https://b.x/alta', label: 'Crear mi comercio' },
    startedAt: '2026-09-28T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(startNewDemo).mockClear();
  });

  afterEach(() => {
    setDemoSession(null);
  });

  it('sin demo no está en la lista y da "Comando desconocido"', () => {
    expect(availableCommands().map((command) => command.name)).not.toContain('DEMO_NUEVA');

    updateCommandBarBuffer('/DEMO_NUEVA');
    submitCommandBar();

    expect(commandBarErrorSignal.value).toBe('Comando desconocido: /DEMO_NUEVA');
    expect(startNewDemo).not.toHaveBeenCalled();
  });

  it('con demo está en la lista y empieza una demo nueva', () => {
    setDemoSession(demo);
    expect(availableCommands().map((command) => command.name)).toContain('DEMO_NUEVA');

    updateCommandBarBuffer('/DEMO_NUEVA');
    submitCommandBar();

    expect(startNewDemo).toHaveBeenCalledTimes(1);
    expect(commandBarErrorSignal.value).toBeNull();
    expect(commandBarBufferSignal.value).toBe('');
  });
});

describe('Enter con la barra vacía (#99)', () => {
  it('con líneas abre Cobro', async () => {
    cartSignal.value = { lines: [freeformLine] };

    await submitEmptyCommandBar();

    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('con una línea seleccionada igual abre Cobro', async () => {
    cartSignal.value = { lines: [freeformLine] };
    cartSelectionIndexSignal.value = 0;

    await submitEmptyCommandBar();

    expect(activeScreenSignal.value).toBe('checkout');
  });

  it('sin líneas y con cliente abre la cobranza sin venta (#101)', async () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };

    await submitEmptyCommandBar();

    expect(commandBarErrorSignal.value).toBeNull();
    expect(activeScreenSignal.value).toBe('collection');
  });

  it('/COBRAR y Ctrl+Enter sin líneas y con cliente también abren la cobranza (#101)', async () => {
    attachedCustomerSignal.value = { id: 'c1', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' };

    updateCommandBarBuffer('/COBRAR');
    submitCommandBar();
    await vi.waitFor(() => {
      expect(activeScreenSignal.value).toBe('collection');
    });

    activeScreenSignal.value = 'sale';
    await triggerCheckout();
    expect(activeScreenSignal.value).toBe('collection');
  });

  it('justo después de crear un cliente con @ espera a que se adjunte (#101)', async () => {
    setCustomerRepository(await loadCustomerRepository());
    updateCommandBarBuffer('@Cliente Nuevo');
    submitCommandBar(); // crea el cliente en segundo plano (pendingBarOperation)

    await submitEmptyCommandBar();

    expect(attachedCustomerSignal.value?.name).toBe('Cliente Nuevo');
    expect(activeScreenSignal.value).toBe('collection');
  });

  it('un Enter con el alta de @ todavía en curso no crea el cliente dos veces: abre la cobranza (#146)', async () => {
    setCustomerRepository(await loadCustomerRepository());
    updateCommandBarBuffer('@Cliente Nuevo');
    submitCommandBar(); // crea el cliente en segundo plano (pendingBarOperation)
    submitCommandBar(); // el segundo Enter llega con la barra todavía llena

    await vi.waitFor(() => {
      expect(activeScreenSignal.value).toBe('collection');
    });
    expect(await db.customers.count()).toBe(1);
    expect(attachedCustomerSignal.value?.name).toBe('Cliente Nuevo');
  });

  it('lo tipeado durante el alta de @ no se pierde cuando el alta termina (#152)', async () => {
    setCustomerRepository(await loadCustomerRepository());
    updateCommandBarBuffer('@Cliente Nuevo');
    submitCommandBar(); // crea el cliente en segundo plano (pendingBarOperation)
    updateCommandBarBuffer('regalo$50'); // el operador sigue tipeando antes de que termine

    await vi.waitFor(() => {
      expect(attachedCustomerSignal.value?.name).toBe('Cliente Nuevo');
    });
    expect(commandBarBufferSignal.value).toBe('regalo$50');
  });

  it('un Enter sobre lo tipeado durante el alta de @ lo agrega, no abre la cobranza (#152)', async () => {
    setCustomerRepository(await loadCustomerRepository());
    updateCommandBarBuffer('@Cliente Nuevo');
    submitCommandBar(); // crea el cliente en segundo plano (pendingBarOperation)
    updateCommandBarBuffer('regalo$50');
    submitCommandBar(); // Enter con el alta todavía en curso

    await vi.waitFor(() => {
      expect(cartSignal.value.lines).toHaveLength(1);
    });
    expect(cartSignal.value.lines[0]).toMatchObject({ kind: 'freeform', description: 'regalo' });
    expect(commandBarBufferSignal.value).toBe('');
    expect(attachedCustomerSignal.value?.name).toBe('Cliente Nuevo');
    expect(activeScreenSignal.value).toBe('sale');
  });

  it('sin líneas ni cliente no hace nada', async () => {
    await submitEmptyCommandBar();

    expect(commandBarErrorSignal.value).toBeNull();
    expect(activeScreenSignal.value).toBe('sale');
  });
});

describe('selectCartLine (click en el carrito, #99)', () => {
  it('selecciona la fila y no cambia nada con un índice fuera de rango', () => {
    cartSignal.value = { lines: [freeformLine, { ...freeformLine, description: 'otro' }] };
    cartSelectionIndexSignal.value = null;

    selectCartLine(1);
    expect(cartSelectionIndexSignal.value).toBe(1);

    selectCartLine(5);
    expect(cartSelectionIndexSignal.value).toBe(1);
  });
});

describe('comando del portal (4.6.0, #179)', () => {
  beforeEach(() => {
    vi.mocked(openPortal).mockClear();
    backendCapabilitiesSignal.value = ['portal'];
    backendPortalSignal.value = { command: 'PANEL', label: 'Panel del backend' };
  });

  afterEach(() => {
    backendCapabilitiesSignal.value = undefined;
    backendPortalSignal.value = undefined;
    demoRevokedSignal.value = null;
  });

  it('con la oferta está en la lista con la etiqueta del backend y abre el portal', () => {
    expect(availableCommands().find((command) => command.name === 'PANEL')?.description).toBe(
      'Panel del backend',
    );

    updateCommandBarBuffer('/PANEL');
    submitCommandBar();

    expect(openPortal).toHaveBeenCalledWith('Panel del backend');
    expect(commandBarErrorSignal.value).toBeNull();
    expect(commandBarBufferSignal.value).toBe('');
  });

  it('sin la capacidad no aparece y da "Comando desconocido"', () => {
    backendCapabilitiesSignal.value = [];
    expect(availableCommands().map((command) => command.name)).not.toContain('PANEL');

    updateCommandBarBuffer('/PANEL');
    submitCommandBar();

    expect(commandBarErrorSignal.value).toBe('Comando desconocido: /PANEL');
    expect(openPortal).not.toHaveBeenCalled();
  });

  it('con la demo revocada no aparece', () => {
    demoRevokedSignal.value = '2026-10-04T12:00:00.000Z';

    expect(availableCommands().map((command) => command.name)).not.toContain('PANEL');
  });

  it('un nombre del POS, aunque no esté disponible ahora, pasa a /PORTAL', () => {
    backendPortalSignal.value = { command: 'ALTA', label: 'Mi panel' };
    const names = availableCommands().map((command) => command.name);
    expect(names).toContain('PORTAL');
    expect(names).not.toContain('ALTA');

    updateCommandBarBuffer('/PORTAL');
    submitCommandBar();

    expect(openPortal).toHaveBeenCalledWith('Mi panel');
  });
});
