import type { LocalDataSummary } from '../../../storage/local-data.ts';
import type { SyncConfig } from '../../../sync/config.ts';
import {
  connectorFields,
  connectorLabel,
  type ConnectorType,
} from '../../../sync/connector-registry.ts';
import type { WizardModel, WizardStepId } from '../../keyboard/config-wizard-model.ts';
import { formatDate } from '../../format.ts';
import {
  configFieldValuesSignal,
  configTerminalSignal,
  configTypeSignal,
  localChoiceSignal,
  probeOutcomeSignal,
  savedConfigSignal,
} from '../../state/sync-config.ts';

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/** El campo de URL de cada tipo de conector (de donde sale el host que se muestra). */
function urlOf(type: ConnectorType, values: Record<string, string>): string {
  return (type === 'google-sheets' ? values['webAppUrl'] : values['baseUrl']) ?? '';
}

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host;
  } catch {
    return url.trim();
  }
}

/** Host de la conexión que se está cargando en el wizard. */
export function formHost(): string {
  const type = configTypeSignal.value;
  return type === null ? '' : hostOf(urlOf(type, configFieldValuesSignal.value[type]));
}

/** Host de una config guardada (la conexión actual, para el envío previo al borrado). */
export function savedHost(config: SyncConfig): string {
  return hostOf(config.type === 'google-sheets' ? config.webAppUrl : config.baseUrl);
}

/**
 * Resumen de un paso para la columna lateral (y para Revisar): lo cargado en
 * una línea, credenciales como `•••`. Vacío si todavía no hay nada.
 */
export function stepSummary(id: WizardStepId, model: WizardModel): string {
  const step = model.steps.find((candidate) => candidate.id === id);
  switch (id) {
    case 'terminal': {
      const { branch, pointOfSale, locale } = configTerminalSignal.value;
      return [branch, pointOfSale, locale]
        .map((value) => value.trim())
        .filter((value) => value !== '')
        .join(' · ');
    }
    case 'type': {
      const type = configTypeSignal.value;
      return type === null ? '' : connectorLabel(type);
    }
    case 'connector': {
      const type = configTypeSignal.value;
      if (type === null) {
        return '';
      }
      const values = configFieldValuesSignal.value[type];
      return connectorFields(type)
        .flatMap((field) => {
          const value = (values[field.key] ?? '').trim();
          if (value === '') {
            return [];
          }
          return [field.secret === true ? `${field.label}: •••` : value];
        })
        .join(' · ');
    }
    case 'probe': {
      if (step?.status === 'skipped') {
        const verifiedAt = savedConfigSignal.value?.verifiedAt;
        return verifiedAt === undefined
          ? 'No hace falta: la conexión no cambió'
          : `No hace falta: la conexión no cambió (probada el ${formatDate(verifiedAt)})`;
      }
      const outcome = probeOutcomeSignal.value;
      if (outcome === null || outcome.key !== model.connectionKey) {
        return '';
      }
      switch (outcome.status) {
        case 'ok':
          return `OK: ${plural(outcome.products, 'producto', 'productos')}, ${plural(outcome.customers, 'cliente', 'clientes')}`;
        case 'failed':
          return 'Falló';
        case 'cancelled':
          return 'Cancelada';
      }
      return '';
    }
    case 'local-data':
      if (step?.status === 'skipped') {
        return step.skipReason === 'no-user-data'
          ? 'No hace falta: no hay ventas ni pendientes'
          : 'No hace falta: la conexión no cambió';
      }
      return localChoiceSignal.value === 'keep' ? 'Mantener' : 'Borrar';
    case 'review':
      return '';
  }
}

/** Lo que se perdería, en una línea: solo lo que existe. */
export function describeLocalDataLoss(summary: LocalDataSummary): string {
  const parts: string[] = [];
  if (summary.sales > 0) parts.push(plural(summary.sales, 'venta', 'ventas'));
  if (summary.cashSessions > 0) {
    parts.push(plural(summary.cashSessions, 'turno de caja', 'turnos de caja'));
  }
  if (summary.draftCartLines > 0) parts.push('la venta en curso');
  if (summary.products > 0) parts.push(plural(summary.products, 'producto', 'productos'));
  if (summary.customers > 0) parts.push(plural(summary.customers, 'cliente', 'clientes'));
  return parts.join(' · ');
}
