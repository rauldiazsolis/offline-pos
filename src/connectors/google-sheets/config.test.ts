import { describe, expect, it } from 'vitest';
import { googleSheetsConfigFields, googleSheetsConfigSchema } from './config.ts';

describe('googleSheetsConfigSchema', () => {
  it('acepta una config mínima sin secreto', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    expect(parsed.success).toBe(true);
  });

  it('acepta un secreto compartido opcional', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: 's3cr3t',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sharedSecret).toBe('s3cr3t');
    }
  });

  it('rechaza una webAppUrl que no es una URL', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'no-es-una-url',
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un type distinto de google-sheets', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'rest',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un secreto vacío', () => {
    const parsed = googleSheetsConfigSchema.safeParse({
      type: 'google-sheets',
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      sharedSecret: '',
    });

    expect(parsed.success).toBe(false);
  });
});

describe('googleSheetsConfigFields', () => {
  it('lista webAppUrl (obligatorio) y sharedSecret (opcional), en ese orden', () => {
    expect(googleSheetsConfigFields).toEqual([
      {
        key: 'webAppUrl',
        label: 'URL del Web App de Google Apps Script',
        optional: false,
        placeholder: 'ej. https://script.google.com/macros/s/…/exec',
      },
      {
        key: 'sharedSecret',
        label: 'Secreto compartido',
        optional: true,
        placeholder: 'Valor de SHARED_SECRET, si lo configuraste',
        secret: true,
      },
    ]);
  });
});
