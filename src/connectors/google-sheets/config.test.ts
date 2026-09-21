import { describe, expect, it } from 'vitest';
import { googleSheetsConfigSchema } from './config.ts';

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
