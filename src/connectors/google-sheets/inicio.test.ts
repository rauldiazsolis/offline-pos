import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadAppsScript, publicFunctions } from '../../test/apps-script.ts';

// Miércoles 7/10/2026 a la tarde, hora local: hace 3 días fue domingo (la ferretería cierra).
const HOY = new Date(2026, 9, 7, 15, 0, 0);
const INICIO_DE_HOY = new Date(2026, 9, 7);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
});

afterEach(() => {
  vi.useRealTimers();
});

const FORMULARIO = { comercio: 'El Tornillo', sucursal: 'Centro', caja: 'Caja 1' };

/** Una planilla recién creada: una sola pestaña vacía, "Hoja 1". */
function planillaNueva() {
  // 100 filas: el Tablero llega a la 60 (en Sheets, una pestaña nueva tiene 1000).
  const app = loadAppsScript({
    useTestClock: true,
    name: 'Hoja de cálculo sin título',
    defaultRows: 100,
  });
  app.spreadsheet.insertSheet('Hoja 1');
  return app;
}

function preparar(app: ReturnType<typeof planillaNueva>, opciones: Record<string, unknown>) {
  return z
    .object({ resumen: z.string() })
    .parse(app.run(`posInicializar(${JSON.stringify(opciones)})`));
}

type Fila = Record<string, unknown>;

function filas(app: ReturnType<typeof planillaNueva>, pestaña: string): Fila[] {
  return z.array(z.record(z.string(), z.unknown())).parse(app.run(`readRows_('${pestaña}')`));
}

function configuracion(app: ReturnType<typeof planillaNueva>, clave: string): unknown {
  return app.run(`readConfigValue_('${clave}')`);
}

const redondear = (valor: number) => Math.round(valor * 100) / 100;

describe('seguridad', () => {
  it('de todo el proyecto, solo son públicas doGet, doPost y las tres que llama la home', () => {
    const { context } = planillaNueva();

    expect(publicFunctions(context)).toEqual([
      'doGet',
      'doPost',
      'posAgregarTablero',
      'posInicializar',
      'posReiniciar',
    ]);
  });
});

describe('posInicializar: la planilla', () => {
  it('pestañas en orden, y la "Hoja 1" pasa a ser el Tablero (las otras vacías se borran)', () => {
    const app = planillaNueva();
    const hoja1 = app.spreadsheet.getSheetByName('Hoja 1');
    app.spreadsheet.insertSheet('Hoja 2');
    app.spreadsheet.insertSheet('Notas').getRange('A1').setValue('mis notas');

    preparar(app, { ...FORMULARIO, modelo: '' });

    expect(app.spreadsheet.sheetNames()).toEqual([
      'Tablero',
      'Productos',
      'Clientes',
      'Ventas',
      'Pagos',
      'CuentaCorriente',
      'MovimientosCaja',
      'Cobranzas',
      'Configuración',
      'Notas',
      '_PushLots',
      '_Snapshot',
    ]);
    expect(app.spreadsheet.getSheetByName('Tablero')).toBe(hoja1);
  });

  it('la planilla toma el nombre del comercio y Configuración guarda lo del formulario', () => {
    const app = planillaNueva();

    preparar(app, { ...FORMULARIO, modelo: '' });

    expect(app.spreadsheet.getName()).toBe('El Tornillo');
    expect(configuracion(app, 'comercio')).toBe('El Tornillo');
    expect(configuracion(app, 'sucursal')).toBe('Centro');
    expect(configuracion(app, 'caja')).toBe('Caja 1');
    expect(configuracion(app, 'permitirReiniciar')).toBe('No');
    expect(configuracion(app, 'posUrl')).toBe('https://pos.contax.ar/v4/');
  });

  it('vacía: sin productos, clientes ni movimientos', () => {
    const app = planillaNueva();

    const { resumen } = preparar(app, { ...FORMULARIO, modelo: '' });

    expect(resumen).toBe('Planilla vacía, lista para cargar productos y clientes.');
    for (const pestaña of ['Productos', 'Clientes', 'Ventas', 'MovimientosCaja']) {
      expect(filas(app, pestaña)).toEqual([]);
    }
  });

  it('se niega si la planilla ya está inicializada', () => {
    const app = planillaNueva();
    preparar(app, { ...FORMULARIO, modelo: 'ferreteria' });

    expect(() => preparar(app, { ...FORMULARIO, modelo: '' })).toThrow(
      'Esta planilla ya está inicializada.',
    );
    expect(filas(app, 'Productos')).toHaveLength(42);
  });

  it.each([
    [{ ...FORMULARIO, comercio: ' ' }, 'Falta el nombre del comercio.'],
    [{ ...FORMULARIO, sucursal: '' }, 'Falta la sucursal.'],
    [{ ...FORMULARIO, caja: undefined }, 'Falta la caja.'],
    [{ ...FORMULARIO, modelo: 'panaderia' }, 'Todavía no hay datos de prueba para ese modelo.'],
  ])('sin lo necesario no toca nada: %o', (opciones, error) => {
    const app = planillaNueva();

    expect(() => preparar(app, opciones)).toThrow(error);
    expect(app.spreadsheet.sheetNames()).toEqual(['Hoja 1']);
  });
});

describe.each([
  { modelo: 'ferreteria', nombre: 'Ferretería', productos: 42, clientes: 7, cerrado: [0] },
  { modelo: 'kiosco', nombre: 'Kiosco', productos: 30, clientes: 5, cerrado: [] },
  { modelo: 'almacen', nombre: 'Almacén', productos: 38, clientes: 8, cerrado: [] },
])('posInicializar con $nombre', ({ modelo, nombre, productos, clientes, cerrado }) => {
  let app: ReturnType<typeof planillaNueva>;
  let resumen: string;

  beforeEach(() => {
    app = planillaNueva();
    ({ resumen } = preparar(app, { ...FORMULARIO, modelo }));
  });

  it('el resumen cuenta lo que cargó', () => {
    expect(resumen).toMatch(
      new RegExp(
        `^${nombre}: ${String(productos)} productos, ${String(clientes)} clientes, \\d+ ventas, 1 anulación, \\d+ cobranzas y \\d+ movimientos de caja en los últimos 10 días\\.$`,
      ),
    );
  });

  it('cada venta: el total es la suma de sus líneas y de sus pagos', () => {
    const ventas = filas(app, 'Ventas');
    const pagos = filas(app, 'Pagos');
    const ids = [...new Set(ventas.map((fila) => fila.saleId))];
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) {
      const lineas = ventas.filter((fila) => fila.saleId === id);
      const total = Number(lineas[0]?.totalVenta);
      const deLineas = lineas.reduce((suma, linea) => {
        const bruto = redondear(Number(linea.cantidad) * Number(linea.precioUnitario));
        const descuento = linea.descuentoValor === '' ? 0 : Number(linea.descuentoValor);
        return suma + redondear(bruto * (1 - descuento / 100));
      }, 0);
      const dePagos = pagos
        .filter((pago) => pago.saleId === id)
        .reduce((suma, pago) => suma + Number(pago.monto), 0);
      expect([redondear(deLineas), redondear(dePagos)]).toEqual([total, total]);
    }
  });

  it('tickets correlativos por día, en los últimos 10 días, nunca hoy ni un día cerrado', () => {
    const primeras = filas(app, 'Ventas').filter((fila) => fila.linea === 1);
    const porDia = new Map<unknown, unknown[]>();
    for (const fila of primeras) {
      porDia.set(fila.fechaTicket, [...(porDia.get(fila.fechaTicket) ?? []), fila.numeroTicket]);
      const fecha = fila.fecha as Date;
      expect(fecha.getTime()).toBeLessThan(INICIO_DE_HOY.getTime());
      expect(fecha.getTime()).toBeGreaterThanOrEqual(INICIO_DE_HOY.getTime() - 10 * 86_400_000);
      expect(cerrado).not.toContain(fecha.getDay());
    }
    for (const numeros of porDia.values()) {
      expect(numeros).toEqual(numeros.map((_, index) => index + 1));
    }
  });

  it('una anulación: líneas y pagos invertidos, y la venta original marcada', () => {
    const ventas = filas(app, 'Ventas');
    const anulacion = ventas.filter((fila) => fila.anulaA !== '');
    const original = ventas.filter((fila) => fila.saleId === anulacion[0]?.anulaA);
    expect(new Set(anulacion.map((fila) => fila.saleId)).size).toBe(1);
    expect(original.map((fila) => fila.estado)).toEqual(original.map(() => 'anulada'));
    expect(anulacion.map((fila) => fila.cantidad)).toEqual(
      original.map((fila) => -Number(fila.cantidad)),
    );
    expect(anulacion[0]?.totalVenta).toBe(-Number(original[0]?.totalVenta));
  });

  it('las filas llevan el dispositivo de prueba y la sucursal y la caja del formulario', () => {
    for (const pestaña of ['Ventas', 'Pagos', 'CuentaCorriente', 'MovimientosCaja']) {
      for (const fila of filas(app, pestaña)) {
        expect([fila.deviceId, fila.branch, fila.pointOfSale]).toEqual([
          'datos-de-prueba',
          'Centro',
          'Caja 1',
        ]);
      }
    }
  });

  it('nadie le cobra al cliente bloqueado, y ningún saldo queda negativo', () => {
    const bloqueado = filas(app, 'Clientes').find((cliente) => cliente.blocked === 'yes');
    const cobranzas = filas(app, 'Cobranzas');
    expect(cobranzas.filter((fila) => fila.customerId === bloqueado?.id)).toEqual([]);
    const saldos = new Map<unknown, number>();
    for (const fila of filas(app, 'CuentaCorriente')) {
      saldos.set(fila.customerId, (saldos.get(fila.customerId) ?? 0) + Number(fila.monto));
    }
    for (const saldo of saldos.values()) {
      expect(redondear(saldo)).toBeGreaterThanOrEqual(0);
    }
  });

  it('un arqueo con diferencia es un ajuste por esa diferencia', () => {
    const arqueos = filas(app, 'MovimientosCaja').filter(
      (fila) => fila.origenMovimiento === 'count-adjustment',
    );
    for (const arqueo of arqueos) {
      const signo = arqueo.direccion === 'in' ? 1 : -1;
      expect(redondear(Number(arqueo.contado) - Number(arqueo.esperado))).toBe(
        signo * Number(arqueo.monto),
      );
    }
  });

  it('el POS recibe los productos (con el bloqueado) y los saldos del libro', () => {
    const pull = app.call('pullBatch', { cursors: {}, pendingLotIds: [] });
    const data = z
      .object({
        products: z.object({ items: z.array(z.object({ blocked: z.unknown().optional() })) }),
        customers: z.object({ items: z.array(z.object({ balance: z.number() })) }),
      })
      .parse(pull.data);

    expect(data.products.items).toHaveLength(productos);
    expect(data.products.items.filter((item) => item.blocked !== undefined)).toHaveLength(1);
    expect(data.customers.items).toHaveLength(clientes);
    expect(data.customers.items.some((item) => item.balance > 0)).toBe(true);
  });

  it('con la misma fecha, la misma historia', () => {
    const otra = planillaNueva();
    preparar(otra, { ...FORMULARIO, modelo });

    expect(filas(otra, 'Ventas')).toEqual(filas(app, 'Ventas'));
  });
});

describe('posInicializar: la anulación en un día abierto', () => {
  it('si el día elegido cae cerrado, va al siguiente día abierto', () => {
    // Ferretería: hace 3 días (domingo 4/10) estaba cerrada; va el lunes 5/10.
    const app = planillaNueva();
    preparar(app, { ...FORMULARIO, modelo: 'ferreteria' });

    const anulacion = filas(app, 'Ventas').find((fila) => fila.anulaA !== '');
    expect(anulacion?.fechaTicket).toBe('2026-10-05');
  });
});

describe('posReiniciar', () => {
  it('sin "Sí" en Permitir reiniciar no toca nada', () => {
    const app = planillaNueva();
    preparar(app, { ...FORMULARIO, modelo: 'kiosco' });

    expect(() => app.run('posReiniciar()')).toThrow(
      'Para reiniciar, poné "Sí" en "Permitir reiniciar" (pestaña Configuración).',
    );
    expect(filas(app, 'Productos')).toHaveLength(30);
  });

  it('con "Sí" deja la planilla como recién creada, lista para prepararla de nuevo', () => {
    const app = planillaNueva();
    preparar(app, { ...FORMULARIO, modelo: 'kiosco' });
    app.run(`escribirConfiguracion_([['permitirReiniciar', 'Sí']])`);

    app.run('posReiniciar()');

    expect(app.spreadsheet.sheetNames()).toEqual(['Hoja 1']);
    expect(app.spreadsheet.getName()).toBe('Planilla sin inicializar');
    preparar(app, { ...FORMULARIO, modelo: 'almacen' });
    expect(filas(app, 'Productos')).toHaveLength(38);
  });
});
