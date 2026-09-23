import { describe, expect, it } from 'vitest';
import type { LocalDataSummary } from '../../storage/local-data.ts';
import {
  buildWizardModel,
  formConnectionKey,
  initialStep,
  isReachable,
  nextStep,
  previousStep,
  validateStep,
  type WizardInput,
} from './config-wizard-model.ts';

const NO_DATA: LocalDataSummary = {
  products: 3,
  customers: 2,
  sales: 0,
  cashSessions: 0,
  pendingOutbox: 0,
  pendingSales: 0,
  draftCartLines: 0,
};
const WITH_SALES: LocalDataSummary = { ...NO_DATA, sales: 4, pendingOutbox: 2, pendingSales: 2 };

function blankValues(): WizardInput['fieldValues'] {
  return {
    rest: { baseUrl: '', apiKey: '' },
    'rest-demo': { baseUrl: '', apiKey: '' },
    'google-sheets': { webAppUrl: '', sharedSecret: '' },
  };
}

function input(overrides: Partial<WizardInput> = {}): WizardInput {
  const values = blankValues();
  values.rest = { baseUrl: 'http://a.test', apiKey: '' };
  return {
    terminal: { branch: 'Centro', pointOfSale: 'Caja 1', locale: '' },
    type: 'rest',
    fieldValues: values,
    saved: undefined,
    probe: null,
    localData: NO_DATA,
    localChoice: 'keep',
    localChoiceConfirmed: false,
    ...overrides,
  };
}

const SAVED = {
  type: 'rest' as const,
  baseUrl: 'http://a.test',
  branch: 'Centro',
  pointOfSale: 'Caja 1',
  verifiedAt: '2026-09-23T14:02:00.000Z',
};
const KEY_A = formConnectionKey('rest', { baseUrl: 'http://a.test', apiKey: '' });

describe('validateStep', () => {
  it('terminal exige sucursal y punto de venta', () => {
    const result = validateStep(
      input({ terminal: { branch: ' ', pointOfSale: 'x', locale: '' } }),
      'terminal',
    );
    expect(result).toEqual({ ok: false, field: 'branch', message: 'Completá «Sucursal».' });
  });
  it('type exige elegir', () => {
    expect(validateStep(input({ type: null }), 'type')).toEqual({
      ok: false,
      message: 'Elegí un tipo de conexión.',
    });
  });
  it('connector valida con el schema y apunta al campo', () => {
    const values = blankValues();
    values.rest = { baseUrl: 'no-es-url', apiKey: '' };
    const result = validateStep(input({ fieldValues: values }), 'connector');
    expect(result).toMatchObject({ ok: false, field: 'baseUrl' });
  });
});

describe('buildWizardModel — instalación', () => {
  it('sin prueba, se frena en probe', () => {
    const model = buildWizardModel(input());
    expect(model.connectionChanged).toBe(true);
    expect(model.firstIncomplete).toBe('probe');
    expect(model.applyAction).toBeNull();
  });
  it('con prueba vigente y sin datos del usuario, saltea local-data y aplica borrando (origen nuevo)', () => {
    const model = buildWizardModel(
      input({ probe: { status: 'ok', key: KEY_A, products: 3, customers: 2 } }),
    );
    expect(model.probeValid).toBe(true);
    expect(model.steps.find((s) => s.id === 'local-data')).toMatchObject({
      status: 'skipped',
      skipReason: 'no-user-data',
    });
    expect(model.firstIncomplete).toBe('review');
    expect(model.applyAction).toEqual({
      kind: 'apply-connection',
      local: 'wipe',
      originChanged: true,
    });
  });
  it('una prueba hecha con otra conexión no vale', () => {
    const model = buildWizardModel(
      input({ probe: { status: 'ok', key: 'otra', products: 0, customers: 0 } }),
    );
    expect(model.probeValid).toBe(false);
  });
  it('prueba fallida con la conexión actual marca error', () => {
    const model = buildWizardModel(
      input({ probe: { status: 'failed', key: KEY_A, message: 'x' } }),
    );
    expect(model.steps.find((s) => s.id === 'probe')?.status).toBe('error');
  });
});

describe('buildWizardModel — terminal activa', () => {
  it('solo cambió la terminal: saltea probe y local-data y guarda solo terminal', () => {
    const model = buildWizardModel(
      input({
        saved: SAVED,
        terminal: { branch: 'Norte', pointOfSale: 'Caja 3', locale: '' },
        localData: WITH_SALES,
      }),
    );
    expect(model.connectionChanged).toBe(false);
    expect(model.steps.find((s) => s.id === 'probe')).toMatchObject({
      status: 'skipped',
      skipReason: 'connection-unchanged',
    });
    expect(model.applyAction).toEqual({ kind: 'save-terminal' });
  });
  it('cambió la conexión con ventas: local-data pendiente hasta confirmar', () => {
    const values = blankValues();
    values.rest = { baseUrl: 'http://b.test', apiKey: '' };
    const key = formConnectionKey('rest', values.rest);
    const base = {
      saved: SAVED,
      fieldValues: values,
      localData: WITH_SALES,
      probe: { status: 'ok' as const, key, products: 1, customers: 1 },
    };
    expect(buildWizardModel(input(base)).firstIncomplete).toBe('local-data');
    const confirmed = buildWizardModel(input({ ...base, localChoiceConfirmed: true }));
    expect(confirmed.applyAction).toEqual({
      kind: 'apply-connection',
      local: 'keep',
      originChanged: true,
    });
  });
  it('mismo origen con otra API key: originChanged false', () => {
    const values = blankValues();
    values.rest = { baseUrl: 'http://a.test/', apiKey: 'k' };
    const key = formConnectionKey('rest', values.rest);
    const model = buildWizardModel(
      input({
        saved: SAVED,
        fieldValues: values,
        probe: { status: 'ok', key, products: 0, customers: 0 },
      }),
    );
    expect(model.connectionChanged).toBe(true);
    expect(model.originChanged).toBe(false);
    expect(model.applyAction).toEqual({
      kind: 'apply-connection',
      local: 'keep',
      originChanged: false,
    });
  });
  it('config guardada sin verifiedAt cuenta como conexión cambiada', () => {
    const { verifiedAt: _v, ...unverified } = SAVED;
    expect(buildWizardModel(input({ saved: unverified })).connectionChanged).toBe(true);
  });
});

describe('navegación', () => {
  it('next/previous saltean los pasos salteados', () => {
    const model = buildWizardModel(input({ saved: SAVED }));
    expect(nextStep(model, 'connector')).toBe('review');
    expect(previousStep(model, 'review')).toBe('connector');
    expect(previousStep(model, 'terminal')).toBe('terminal');
  });
  it('no se puede saltar más allá del primer paso incompleto', () => {
    const model = buildWizardModel(
      input({ terminal: { branch: '', pointOfSale: '', locale: '' } }),
    );
    expect(isReachable(model, 'terminal')).toBe(true);
    expect(isReachable(model, 'type')).toBe(false);
  });
  it('paso inicial', () => {
    const active = buildWizardModel(input({ saved: SAVED }));
    expect(initialStep(active, { active: true, identityReset: false })).toBe('review');
    const install = buildWizardModel(input());
    expect(initialStep(install, { active: false, identityReset: false })).toBe('probe');
    expect(initialStep(install, { active: false, identityReset: true })).toBe('terminal');
  });
});
