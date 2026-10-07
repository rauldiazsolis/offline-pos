import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../domain/result.ts';
import { readConnectReturn } from '../../sync/demo-link.ts';
import { loadAppsScript, type AppsScriptOptions } from '../../test/apps-script.ts';

const WEB_APP_URL = 'https://script.google.com/macros/s/abc/exec';
const FORMULARIO = { comercio: 'El Tornillo', sucursal: 'Centro', caja: 'Caja 1' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 15, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  Reflect.deleteProperty(globalThis, 'google');
});

type App = ReturnType<typeof loadAppsScript>;

/** Una planilla nueva con su "Hoja 1" (100 filas: el tablero llega a la 60). */
function planillaNueva(options: AppsScriptOptions = {}): App {
  const app = loadAppsScript({
    useTestClock: true,
    defaultRows: 100,
    webAppUrl: WEB_APP_URL,
    ...options,
  });
  app.spreadsheet.insertSheet('Hoja 1');
  return app;
}

function preparar(app: App, opciones: Record<string, unknown> = {}): void {
  app.run(
    `posInicializar(${JSON.stringify({ ...FORMULARIO, modelo: 'ferreteria', ...opciones })})`,
  );
}

/**
 * Dibuja la página en el documento del test y corre su script, con un `google.script.run` que
 * llama a las funciones del proyecto como lo haría Apps Script (acá, sincrónico).
 */
function abrir(app: App): void {
  const html = app.page().html;
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  if (script === undefined) {
    throw new Error('La página no tiene script');
  }
  const runner = (onSuccess?: (value: unknown) => void, onFailure?: (error: Error) => void) =>
    new Proxy(
      {},
      {
        get: (_, name: string) => {
          if (name === 'withSuccessHandler') {
            return (handler: (value: unknown) => void) => runner(handler, onFailure);
          }
          if (name === 'withFailureHandler') {
            return (handler: (error: Error) => void) => runner(onSuccess, handler);
          }
          return (argument: unknown) => {
            try {
              onSuccess?.(
                app.run(`${name}(${argument === undefined ? '' : JSON.stringify(argument)})`),
              );
            } catch (error) {
              onFailure?.(error as Error);
            }
          };
        },
      },
    );
  Object.assign(globalThis, {
    google: {
      script: {
        get run() {
          return runner();
        },
      },
    },
  });
  document.body.innerHTML = '<div id="app"></div>';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- es el script de la página
  const correr = new Function(script) as () => void;
  correr();
}

function elemento(selector: string): HTMLElement {
  const encontrado = document.querySelector<HTMLElement>(selector);
  if (encontrado === null) {
    throw new Error(`No está ${selector}`);
  }
  return encontrado;
}

function campo(selector: string): HTMLInputElement {
  const encontrado = elemento(selector);
  if (!(encontrado instanceof HTMLInputElement)) {
    throw new Error(`${selector} no es un campo`);
  }
  return encontrado;
}

function boton(selector: string): HTMLButtonElement {
  const encontrado = elemento(selector);
  if (!(encontrado instanceof HTMLButtonElement)) {
    throw new Error(`${selector} no es un botón`);
  }
  return encontrado;
}

const texto = (selector: string) => elemento(selector).textContent;

function completar(campos: Record<string, string>): void {
  for (const [id, valor] of Object.entries(campos)) {
    campo(`#${id}`).value = valor;
  }
}

function enviar(): void {
  elemento('#f').dispatchEvent(new Event('submit', { cancelable: true }));
}

function linkAlPos(): string {
  return elemento('#pos').getAttribute('href') ?? '';
}

describe('doGet', () => {
  it('solo lee: no crea pestañas ni toma nada', () => {
    const app = planillaNueva();

    const { title } = app.page();

    expect(title).toBe('POS · Google Sheets');
    expect(app.spreadsheet.sheetNames()).toEqual(['Hoja 1']);
  });

  it('nunca lleva el secreto compartido', () => {
    const app = planillaNueva({ sharedSecret: 'secreto-1' });
    preparar(app);

    expect(app.page().html).not.toContain('secreto-1');
  });

  it('un texto de la planilla nunca cierra el script de la página', () => {
    const app = planillaNueva();
    preparar(app, { comercio: 'Kiosco </script><b>' });

    const html = app.page().html;

    expect(html.match(/<\/script>/g)).toHaveLength(1);
    abrir(app);
    expect(texto('h1')).toBe('Kiosco </script><b>');
  });
});

describe('la home sin preparar', () => {
  it('pide el comercio, la sucursal, la caja y con qué datos empezar', () => {
    abrir(planillaNueva());

    expect(texto('h1')).toBe('Preparar la planilla');
    expect([...document.querySelectorAll('.modelo')].map((label) => label.textContent)).toEqual([
      ' Ferretería',
      ' Kiosco',
      ' Almacén',
      ' Vacía (empezar de cero)',
    ]);
    expect(campo('input[value=ferreteria]').checked).toBe(true);
    expect(campo('#comercio').placeholder).toBe('ej. Ferretería El Tornillo');
  });

  it('"Preparar la planilla" la prepara y muestra lo que cargó', () => {
    const app = planillaNueva();
    abrir(app);
    completar(FORMULARIO);
    campo('input[value=kiosco]').checked = true;

    enviar();

    expect(texto('h1')).toBe('El Tornillo');
    expect(texto('.sub')).toBe('Sucursal Centro · contrato 4.6.0');
    expect(texto('.ok')).toMatch(/^Listo\. Kiosco: 30 productos, 5 clientes, /);
    expect(app.spreadsheet.getName()).toBe('El Tornillo');
  });

  it('un error se muestra debajo del botón, y el botón vuelve', () => {
    abrir(planillaNueva());
    completar({ ...FORMULARIO, comercio: '' });

    enviar();

    expect(texto('#error')).toBe('Falta el nombre del comercio.');
    expect(boton('#ir').disabled).toBe(false);
    expect(texto('#ir')).toBe('Preparar la planilla');
  });
});

describe('la home preparada', () => {
  it('"Abrir la planilla" lleva directo al Tablero', () => {
    const app = planillaNueva();
    preparar(app);
    abrir(app);

    const tablero = app.spreadsheet.getSheetByName('Tablero')?.getSheetId();
    expect(elemento('#planilla').getAttribute('href')).toBe(
      `https://docs.google.com/spreadsheets/d/fake/edit#gid=${String(tablero)}`,
    );
  });

  it('"Abrir el POS" lleva la planilla, la sucursal y la caja tipeada, como las lee el POS', () => {
    const app = planillaNueva();
    preparar(app);
    abrir(app);
    expect(campo('#caja').value).toBe('Caja 1');

    campo('#caja').value = ' Caja 2 ';
    elemento('#caja').dispatchEvent(new Event('input'));

    const link = linkAlPos();
    expect(link.startsWith('https://pos.contax.ar/v4/#connect=')).toBe(true);
    expect(link).not.toMatch(/=$/);
    // El mismo código del POS lo lee: el contrato entre los dos, de punta a punta.
    expect(readConnectReturn(link)).toEqual(
      ok({
        type: 'google-sheets',
        webAppUrl: WEB_APP_URL,
        branch: 'Centro',
        pointOfSale: 'Caja 2',
      }),
    );
  });

  it.each([
    [
      'la de Configuración, sin el fragmento',
      ' https://otro.pos/v4/#viejo ',
      'https://otro.pos/v4/',
    ],
    ['la de por omisión, si está vacía', '', 'https://pos.contax.ar/v4/'],
    ['la de por omisión, si no es http(s)', 'javascript:alert(1)', 'https://pos.contax.ar/v4/'],
  ])('la URL del POS: %s', (_, valor, esperada) => {
    const app = planillaNueva();
    preparar(app);
    app.run(`escribirConfiguracion_([['posUrl', ${JSON.stringify(valor)}]])`);
    abrir(app);

    expect(linkAlPos().startsWith(`${esperada}#connect=`)).toBe(true);
  });

  it('sin "Permitir reiniciar" = Sí, no ofrece reiniciar', () => {
    const app = planillaNueva();
    preparar(app);
    abrir(app);

    expect(document.querySelector('#reiniciar')).toBeNull();
  });

  it('con "Sí", "Reiniciar la planilla" la deja nueva y vuelve al formulario', () => {
    const app = planillaNueva();
    preparar(app);
    app.run(`escribirConfiguracion_([['permitirReiniciar', 'Sí']])`);
    abrir(app);

    elemento('#reiniciar').click();

    expect(texto('h1')).toBe('Preparar la planilla');
    expect(app.spreadsheet.sheetNames()).toEqual(['Hoja 1']);
  });
});

describe('una planilla preparada antes del tablero', () => {
  it('ofrece "Agregar el tablero", y al agregarlo deja de ofrecerlo', () => {
    const app = planillaNueva();
    preparar(app);
    const tablero = app.spreadsheet.getSheetByName('Tablero');
    if (tablero !== null) {
      app.spreadsheet.deleteSheet(tablero);
    }
    abrir(app);

    elemento('#tablero').click();

    expect(texto('.ok')).toBe('Listo. Se agregó el tablero.');
    expect(document.querySelector('#tablero')).toBeNull();
    expect(app.spreadsheet.sheetNames()[0]).toBe('Tablero');
  });

  it('con el tablero, no lo ofrece', () => {
    const app = planillaNueva();
    preparar(app);
    abrir(app);

    expect(document.querySelector('#tablero')).toBeNull();
  });
});
