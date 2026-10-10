import { contractRequirement, MIN_BACKEND_CONTRACT } from '../../../src/domain/contract-version.ts';
import { currentPortalOffer } from '../../../src/ui/keyboard/commands.ts';
import { enterDiagnosticoScreen } from '../../../src/ui/keyboard/diagnostico-controller.ts';
import { startNewDemo, startOnboarding } from '../../../src/ui/keyboard/onboarding-controller.ts';
import { openPortal } from '../../../src/ui/keyboard/portal-controller.ts';
import {
  backendCompanySignal,
  backendStatusSignal,
  demoRevokedSignal,
  demoSessionSignal,
  pendingOutboxCountSignal,
  syncConfiguredSignal,
  syncStatusSignal,
  terminalIdentitySignal,
} from '../../../src/ui/state/sync.ts';
import { terminalHeading } from '../../../src/ui/terminal-context.ts';
import { previewModeSignal } from '../preview/flag.ts';
import { moreOpenSignal } from '../state/nav.ts';

type Pill = { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' };

/** El estado de sync en pocas palabras (el detalle, en Diagnóstico, como la barra de escritorio). */
export function syncPill(): Pill {
  // La vista previa con datos de ejemplo no tiene backend (`src/preview/seed.ts`).
  if (previewModeSignal.value) return { text: 'Vista previa', tone: 'muted' };
  const status = syncStatusSignal.value;
  const pending = pendingOutboxCountSignal.value;
  if (status === 'offline') {
    return {
      text: pending > 0 ? `Sin conexión (${String(pending)})` : 'Sin conexión',
      tone: 'warn',
    };
  }
  if (!syncConfiguredSignal.value) return { text: 'Sin configurar', tone: 'muted' };
  if (demoRevokedSignal.value !== null) return { text: 'La demo terminó', tone: 'error' };
  const backend = backendStatusSignal.value;
  if (backend.kind === 'incompatible') {
    return {
      text: `Necesita contrato ${contractRequirement(MIN_BACKEND_CONTRACT)}`,
      tone: 'error',
    };
  }
  if (backend.kind === 'maintenance') return { text: 'En mantenimiento', tone: 'warn' };
  if (status === 'syncing') return { text: `Sincronizando (${String(pending)})`, tone: 'muted' };
  if (status === 'sync-error') return { text: 'Error de sync', tone: 'error' };
  return { text: pending > 0 ? `Pendiente (${String(pending)})` : 'Sincronizado', tone: 'ok' };
}

/**
 * Arriba de todo (#193): la empresa como título y la caja y la sucursal debajo; a la derecha, el
 * estado de sync (un toque abre Diagnóstico). Con la terminal en demo, la marca DEMO y su botón (el
 * alta, o una demo nueva si terminó); si el backend ofrece el portal, su botón.
 */
export function Header() {
  const heading = terminalHeading(terminalIdentitySignal.value, backendCompanySignal.value);
  const pill = syncPill();
  return (
    <header class="top">
      <div class="brand">
        <h1>{heading?.title ?? 'POS'}</h1>
        {heading?.subtitle !== undefined && <p>{heading.subtitle}</p>}
      </div>
      <button
        type="button"
        class={`pill pill--${pill.tone}`}
        onClick={() => {
          moreOpenSignal.value = false;
          enterDiagnosticoScreen();
        }}
        data-testid="sync-pill"
      >
        {pill.text}
      </button>
    </header>
  );
}

/** La franja de la demo y del portal, debajo del encabezado. */
export function DemoAndPortalBar() {
  const demo = demoSessionSignal.value;
  const portal = currentPortalOffer();
  if (demo === null && portal === null) {
    return null;
  }
  const revoked = demoRevokedSignal.value !== null;
  return (
    <div class={revoked ? 'banner banner--error' : 'banner banner--info'}>
      {demo !== null ? (
        <span>
          <strong>DEMO</strong>
          {revoked ? ' · La demo terminó' : ''}
        </span>
      ) : (
        <span />
      )}
      <span style={{ display: 'flex', gap: '14px' }}>
        {portal !== null && (
          <button type="button" onClick={() => void openPortal(portal.label)}>
            {portal.label}
          </button>
        )}
        {demo !== null && (
          <button
            type="button"
            onClick={() => {
              if (revoked) startNewDemo();
              else startOnboarding();
            }}
          >
            {revoked ? 'Empezar una demo nueva' : demo.onboarding.label}
          </button>
        )}
      </span>
    </div>
  );
}
