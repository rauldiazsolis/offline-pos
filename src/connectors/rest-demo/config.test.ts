import { describe, expect, it } from 'vitest';
import { restDemoCommands, restDemoConfigFields, restDemoConfigSchema } from './config.ts';

describe('restDemoConfigSchema', () => {
  it('acepta una config mínima sin apiKey', () => {
    const parsed = restDemoConfigSchema.safeParse({
      type: 'rest-demo',
      baseUrl: 'http://localhost:4000',
    });

    expect(parsed.success).toBe(true);
  });

  it('acepta apiKey opcional', () => {
    const parsed = restDemoConfigSchema.safeParse({
      type: 'rest-demo',
      baseUrl: 'http://localhost:4000',
      apiKey: 'demo-token',
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza type rest (es otro tipo de conector)', () => {
    const parsed = restDemoConfigSchema.safeParse({
      type: 'rest',
      baseUrl: 'http://localhost:4000',
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza una baseUrl inválida', () => {
    expect(
      restDemoConfigSchema.safeParse({ type: 'rest-demo', baseUrl: 'no-es-una-url' }).success,
    ).toBe(false);
  });
});

describe('restDemoConfigFields', () => {
  it('son los mismos campos que REST: baseUrl obligatorio y apiKey opcional', () => {
    expect(restDemoConfigFields.map((field) => [field.key, field.optional])).toEqual([
      ['baseUrl', false],
      ['apiKey', true],
    ]);
  });
});

describe('restDemoCommands', () => {
  it('declara /DEMO_RESET, atado a la acción demo-reset', () => {
    expect(restDemoCommands).toEqual([
      {
        name: 'DEMO_RESET',
        description: 'Borrar todos los datos locales y reiniciar la demo',
        action: 'demo-reset',
      },
    ]);
  });
});
