/// <reference types="node" />
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** Los datos de prueba de cada rubro (#219): la forma que espera la inicialización. */
const RUBROS = [
  { archivo: 'datos-ferreteria.gs', funcion: 'datosFerreteria_', nombre: 'Ferretería' },
  { archivo: 'datos-kiosco.gs', funcion: 'datosKiosco_', nombre: 'Kiosco' },
  { archivo: 'datos-almacen.gs', funcion: 'datosAlmacen_', nombre: 'Almacén' },
];

const productoSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  barcodes: z.string(),
  name: z.string().min(1),
  price: z.number().positive(),
  taxRate: z.union([z.literal(0.21), z.literal(0.105)]),
  category: z.string().min(1),
  frecuencia: z.number().int().positive(),
  cantidades: z.array(z.number().positive()).min(1).optional(),
  blocked: z.literal(true).optional(),
  blockedReason: z.string().min(1).optional(),
});

const clienteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  document: z.string(),
  phone: z.string(),
  fia: z.literal(true).optional(),
  saldoInicial: z.number().positive().optional(),
  blocked: z.literal(true).optional(),
  blockedReason: z.string().min(1).optional(),
});

const rango = z.tuple([z.number(), z.number()]);
const MEDIOS = ['cash', 'debit', 'credit', 'transfer', 'qr'] as const;

const historiaSchema = z.object({
  semilla: z.number().int(),
  dias: z.number().int().min(7),
  cerrado: z.array(z.number().int().min(0).max(6)),
  turnos: z.array(rango).min(1),
  ventasPorDia: rango,
  factorSabado: z.number().positive(),
  lineasPorVenta: rango,
  medios: z.partialRecord(z.enum(MEDIOS), z.number().positive()),
  pagoDivididoDesde: z.number().positive(),
  proporcionConCliente: z.number().min(0).max(1),
  proporcionFiada: z.number().min(0).max(1),
  probabilidadDeDescuento: z.number().min(0).max(1),
  descuentos: z.array(z.number().positive()).min(1),
  probabilidadDeLineaLibre: z.number().min(0).max(1),
  lineasLibres: z.array(z.object({ descripcion: z.string().min(1), precios: rango })).min(1),
  cobranzasPorDia: z.number().min(0).max(1),
  diaDeLaAnulacion: z.number().int().min(1),
  fondoInicial: z.number().positive(),
  retiroAlCerrar: z.boolean(),
  egresos: z.array(
    z.object({
      concepto: z.string().min(1),
      descripcion: z.string().optional(),
      probabilidad: z.number().min(0).max(1),
      montos: rango,
    }),
  ),
  arqueoProbabilidad: z.number().min(0).max(1),
  diferenciasDeArqueo: z.array(z.number()).min(1),
});

const datosSchema = z.object({
  nombre: z.string(),
  productos: z.array(productoSchema).min(20),
  clientes: z.array(clienteSchema).min(4),
  historia: historiaSchema,
});

function cargar(archivo: string, funcion: string) {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL(archivo, import.meta.url), 'utf8'), context);
  return datosSchema.parse(vm.runInContext(`${funcion}()`, context));
}

/** EAN-13: el último dígito es el de control. */
function eanValido(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) {
    return false;
  }
  let suma = 0;
  for (let index = 0; index < 12; index++) {
    suma += Number(codigo[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (suma % 10)) % 10 === Number(codigo[12]);
}

describe.each(RUBROS)('datos de prueba: $nombre', ({ archivo, funcion, nombre }) => {
  const datos = cargar(archivo, funcion);

  it('tiene el nombre del rubro y una forma válida', () => {
    expect(datos.nombre).toBe(nombre);
  });

  it('los ids y los SKU no se repiten', () => {
    const ids = [...datos.productos, ...datos.clientes].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const skus = datos.productos.map((producto) => producto.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('los códigos de barras son EAN-13 válidos y no se repiten', () => {
    const codigos = datos.productos.flatMap((producto) =>
      producto.barcodes === '' ? [] : producto.barcodes.split(','),
    );
    expect(codigos.filter((codigo) => !eanValido(codigo))).toEqual([]);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('lo que se vende por peso o por metro (cantidades con decimales) no lleva código', () => {
    const porPeso = datos.productos.filter((producto) =>
      (producto.cantidades ?? []).some((cantidad) => !Number.isInteger(cantidad)),
    );
    expect(porPeso.filter((producto) => producto.barcodes !== '')).toEqual([]);
  });

  it('un producto y un cliente bloqueados, con su motivo', () => {
    const productos = datos.productos.filter((producto) => producto.blocked === true);
    const clientes = datos.clientes.filter((cliente) => cliente.blocked === true);
    expect(productos).toHaveLength(1);
    expect(clientes).toHaveLength(1);
    expect(productos[0]?.blockedReason).toBeDefined();
    expect(clientes[0]?.blockedReason).toBeDefined();
  });

  it('hay clientes que fían y uno sin cuenta', () => {
    expect(datos.clientes.some((cliente) => cliente.fia === true)).toBe(true);
    expect(datos.clientes.some((cliente) => cliente.fia === undefined)).toBe(true);
  });

  it('la historia tiene al menos una semana y el día de la anulación cae adentro', () => {
    expect(datos.historia.dias).toBeGreaterThanOrEqual(7);
    expect(datos.historia.diaDeLaAnulacion).toBeLessThanOrEqual(datos.historia.dias);
  });

  it('los horarios de atención están dentro del día', () => {
    for (const [desde, hasta] of datos.historia.turnos) {
      expect(desde).toBeGreaterThanOrEqual(0);
      expect(hasta).toBeLessThanOrEqual(24);
      expect(desde).toBeLessThan(hasta);
    }
  });
});
