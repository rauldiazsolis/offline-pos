import { describe, expect, it } from 'vitest';
import {
  TRAINING_MARK_KEY,
  operationalKeyFor,
  readTrainingMark,
  trainingDatabaseName,
} from './training-mode.ts';

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: () => value };
}

describe('modo entrenamiento: la marca (#177)', () => {
  it('sin marca, o rota, está apagado', () => {
    expect(readTrainingMark(storageWith(null))).toBeNull();
    expect(readTrainingMark(storageWith('no es json'))).toBeNull();
    expect(readTrainingMark(storageWith('{"startedAt":3}'))).toBeNull();
  });

  it('con la marca válida, devuelve cuándo empezó', () => {
    const mark = readTrainingMark(storageWith('{"startedAt":"2026-10-04T12:00:00.000Z"}'));
    expect(mark).toEqual({ startedAt: '2026-10-04T12:00:00.000Z' });
  });

  it('la clave es la de la carpeta', () => {
    expect(TRAINING_MARK_KEY).toBe('offline-pos:training');
  });
});

describe('modo entrenamiento: nombres', () => {
  it('la base de entrenamiento es aparte, también en una carpeta', () => {
    expect(trainingDatabaseName('offline-pos')).toBe('offline-pos#entrenamiento');
    expect(trainingDatabaseName('offline-pos@/v4/')).toBe('offline-pos@/v4/#entrenamiento');
  });

  it('las claves operativas se separan solo en entrenamiento', () => {
    expect(operationalKeyFor('ticket-counter', false)).toBe('offline-pos:ticket-counter');
    expect(operationalKeyFor('ticket-counter', true)).toBe('offline-pos:training:ticket-counter');
  });
});
