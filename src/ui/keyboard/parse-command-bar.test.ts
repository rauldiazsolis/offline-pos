import { describe, expect, it } from 'vitest';
import { parseCommandBar } from './parse-command-bar.ts';

const live = (buffer: string) => parseCommandBar(buffer, { finalizing: false });
const enter = (buffer: string) => parseCommandBar(buffer, { finalizing: true });

describe('parseCommandBar', () => {
  it('buffer vacío es "typing"', () => {
    expect(live('')).toEqual({ kind: 'typing' });
  });

  describe('regla 1: /', () => {
    it('"/" solo muestra el modo comando sin nombre', () => {
      expect(live('/')).toEqual({ kind: 'command', name: '', args: [] });
    });

    it('parsea nombre de comando y argumentos, en mayúsculas', () => {
      expect(live('/cobrar')).toEqual({ kind: 'command', name: 'COBRAR', args: [] });
      expect(live('/anular abc123')).toEqual({ kind: 'command', name: 'ANULAR', args: ['abc123'] });
    });
  });

  describe('regla 2: @', () => {
    it('extrae la query de búsqueda de cliente, sin ambigüedad que resolver con finalizing', () => {
      expect(live('@juan')).toEqual({ kind: 'customer', query: 'juan' });
      expect(enter('@juan')).toEqual({ kind: 'customer', query: 'juan' });
    });

    it('buffer solo "@" es query vacía', () => {
      expect(live('@')).toEqual({ kind: 'customer', query: '' });
    });
  });

  describe('recargo/descuento global (<signo><número>%, RF-03)', () => {
    it('signo + confirma recargo o descuento', () => {
      expect(live('+10%')).toEqual({ kind: 'global-adjustment', percentage: 10 });
      expect(live('-10%')).toEqual({ kind: 'global-adjustment', percentage: -10 });
    });

    it('acepta coma como separador decimal', () => {
      expect(live('+12,5%')).toEqual({ kind: 'global-adjustment', percentage: 12.5 });
    });

    it('"0%" sin signo cancela cualquier ajuste', () => {
      expect(live('0%')).toEqual({ kind: 'global-adjustment', percentage: 0 });
    });

    it('una magnitud distinta de cero sin signo no es un comando (sigue a búsqueda)', () => {
      expect(live('50%')).toEqual({ kind: 'search', query: '50%', qty: 1 });
    });

    it('mientras se tipea el signo y los dígitos, sin "%" todavía, es "typing"', () => {
      expect(live('+10')).toEqual({ kind: 'typing' });
      expect(live('-10')).toEqual({ kind: 'typing' });
    });

    it('al confirmar (Enter) sin el "%", es un error de parseo', () => {
      expect(enter('+10').kind).toBe('parse-error');
    });
  });

  describe('regla 3: línea libre ($)', () => {
    it('todo antes del último $ es la descripción, lo que sigue el monto', () => {
      expect(live('reparación varios$3000')).toEqual({
        kind: 'freeform-line',
        description: 'reparación varios',
        amount: 3000,
        qty: 1,
      });
    });

    it('usa el último $ si hay más de uno', () => {
      expect(live('combo $5 + $200')).toEqual({
        kind: 'freeform-line',
        description: 'combo $5 +',
        amount: 200,
        qty: 1,
      });
    });

    it('parsea coma como separador decimal', () => {
      expect(live('envío$1500,50')).toEqual({
        kind: 'freeform-line',
        description: 'envío',
        amount: 1500.5,
        qty: 1,
      });
    });

    it('mientras se está tipeando el monto, es "typing" (sin error todavía)', () => {
      expect(live('envío$')).toEqual({ kind: 'typing' });
    });

    it('al confirmar (Enter) con monto inválido, es un error de parseo', () => {
      const result = enter('envío$');
      expect(result.kind).toBe('parse-error');
    });

    it('descripción vacía es inválida al confirmar', () => {
      expect(enter('$100').kind).toBe('parse-error');
    });

    it('el prefijo de cantidad multiplica el precio unitario de una línea libre', () => {
      expect(live('3*regalo$100')).toEqual({
        kind: 'freeform-line',
        description: 'regalo',
        amount: 100,
        qty: 3,
      });
    });

    it('también acepta cantidad negativa a nivel de sintaxis (la identidad se resuelve en el dominio)', () => {
      expect(live('-2*regalo$100')).toEqual({
        kind: 'freeform-line',
        description: 'regalo',
        amount: 100,
        qty: -2,
      });
    });
  });

  describe('regla 4: prefijo de cantidad', () => {
    it('"3*<código>" multiplica la cantidad', () => {
      expect(enter('3*7798787667')).toEqual({ kind: 'barcode', code: '7798787667', qty: 3 });
    });

    it('"-2*<nombre>" resta cantidad sobre una búsqueda', () => {
      expect(live('-2*sandwich de miga')).toEqual({
        kind: 'search',
        query: 'sandwich de miga',
        qty: -2,
      });
    });

    it('sin nada después del prefijo, es "typing" mientras se escribe', () => {
      expect(live('3*')).toEqual({ kind: 'typing' });
    });

    it('sin nada después del prefijo, es error al confirmar', () => {
      expect(enter('3*').kind).toBe('parse-error');
    });
  });

  describe('regla 5: código de barras / SKU (todo dígitos)', () => {
    it('mientras se tipea, no dispara búsqueda (ambiguo con cantidad)', () => {
      expect(live('7798787667')).toEqual({ kind: 'pending-numeric' });
    });

    it('al confirmar (Enter), resuelve a código de barras', () => {
      expect(enter('7798787667')).toEqual({ kind: 'barcode', code: '7798787667', qty: 1 });
    });

    it('la secuencia tecla por tecla de un código completo nunca dispara búsqueda hasta Enter', () => {
      const digits = '7798787667';
      for (let i = 1; i <= digits.length; i++) {
        const buffer = digits.slice(0, i);
        expect(live(buffer)).toEqual({ kind: 'pending-numeric' });
      }
      expect(enter(digits)).toEqual({ kind: 'barcode', code: digits, qty: 1 });
    });

    it('en cuanto aparece un carácter no numérico, se resuelve a búsqueda de inmediato', () => {
      expect(live('779a')).toEqual({ kind: 'search', query: '779a', qty: 1 });
    });

    it('un "*" confirma que lo anterior era una cantidad, pero lo que sigue puede seguir siendo un código en progreso', () => {
      // "3*7798787667" es justamente el ejemplo de código de barras con cantidad de §7:
      // mientras el resto siga siendo solo dígitos, sigue sin dispararse la búsqueda.
      expect(live('2*77')).toEqual({ kind: 'pending-numeric' });
      expect(enter('2*77')).toEqual({ kind: 'barcode', code: '77', qty: 2 });
    });

    it('con "*", en cuanto lo que sigue deja de ser solo dígitos, se resuelve a búsqueda', () => {
      expect(live('2*sandwich')).toEqual({ kind: 'search', query: 'sandwich', qty: 2 });
    });

    it('un lector de código de barras no se ve afectado: siempre llega con Enter', () => {
      expect(enter('123456789012')).toEqual({ kind: 'barcode', code: '123456789012', qty: 1 });
    });
  });

  describe('regla 6: búsqueda difusa por nombre', () => {
    it('cualquier texto no numérico dispara búsqueda en vivo, sin esperar Enter', () => {
      expect(live('coca')).toEqual({ kind: 'search', query: 'coca', qty: 1 });
    });

    it('sigue siendo búsqueda al confirmar', () => {
      expect(enter('coca')).toEqual({ kind: 'search', query: 'coca', qty: 1 });
    });
  });
});
