import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { currentPortalOffer } from '../keyboard/commands.ts';
import { startNewDemo, startOnboarding } from '../keyboard/onboarding-controller.ts';
import { openPortal } from '../keyboard/portal-controller.ts';
import {
  backendCompanySignal,
  demoRevokedSignal,
  demoSessionSignal,
  terminalIdentitySignal,
} from '../state/sync.ts';
import { terminalHeading } from '../terminal-context.ts';

/** Una línea, recortada con "…" si no entra (#193): nunca empuja al botón de la demo. */
const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const;

/**
 * Los botones del encabezado (el del portal y el de la demo): como los de la barra de estado, y sin
 * partir nunca su etiqueta (#111): si falta lugar, se recorta el título. `.btn` o `.btn-primary`
 * ponen el color.
 */
const headerButton = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  borderRadius: 'var(--radius-sm, 6px)',
  padding: '2px 8px',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
} as const;

/**
 * Encabezado de la venta (#193): en qué comercio y en qué caja está la terminal. La empresa (de
 * `GET /info`, 4.5.0) es el título y `<caja> - <sucursal>` va debajo; sin empresa, la caja es el
 * título. Con la terminal en demo (#128), la marca DEMO y, a la derecha, el botón del alta
 * (`<onboarding.label> (/ALTA)`, lo mismo que el comando) o, con la demo revocada (#176), "Empezar
 * una demo nueva (/DEMO_NUEVA)". Si el backend ofrece el portal (4.6.0, #179), su botón
 * `<label> (/<command>)` va a la derecha, antes del de la demo, que sigue siendo el primario.
 * Información pasiva: solo los botones hacen algo, sin sacarle el foco a la barra de comandos. Sin
 * conexión activa, demo ni portal no se muestra.
 */
export function TerminalHeader() {
  const heading = terminalHeading(terminalIdentitySignal.value, backendCompanySignal.value);
  const demo = demoSessionSignal.value;
  const portal = currentPortalOffer();
  if (heading === null && demo === null && portal === null) {
    return null;
  }
  const revoked = demoRevokedSignal.value !== null;
  const demoButtonLabel = revoked
    ? 'Empezar una demo nueva (/DEMO_NUEVA)'
    : `${demo?.onboarding.label ?? ''} (/ALTA)`;
  return (
    <header
      data-testid="terminal-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--color-chrome-bg)',
        borderBottom: '2px solid var(--color-chrome-border)',
      }}
    >
      {heading !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span
            style={{
              ...ellipsis,
              color: 'var(--color-chrome-text)',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'bold',
              lineHeight: 1.2,
            }}
          >
            {heading.title}
          </span>
          {heading.subtitle !== undefined && (
            <span
              style={{
                ...ellipsis,
                color: 'var(--color-chrome-text-muted)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              {heading.subtitle}
            </span>
          )}
        </div>
      )}
      {portal !== null && (
        <button
          type="button"
          tabIndex={-1}
          class="btn"
          onMouseDown={keepFocusOnMouseDown}
          onClick={() => {
            void openPortal(portal.label);
          }}
          title={`${portal.label} (/${portal.command})`}
          style={{ ...headerButton, marginLeft: 'auto' }}
        >
          {`${portal.label} (/${portal.command})`}
        </button>
      )}
      {demo !== null && (
        <>
          <span
            style={{
              flexShrink: 0,
              color: 'var(--color-chrome-warning)',
              border: '1px solid var(--color-chrome-warning)',
              borderRadius: 'var(--radius-sm, 6px)',
              padding: '0 6px',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
            }}
          >
            DEMO
          </span>
          <button
            type="button"
            tabIndex={-1}
            class="btn-primary"
            onMouseDown={keepFocusOnMouseDown}
            onClick={() => {
              if (revoked) {
                startNewDemo();
              } else {
                startOnboarding();
              }
            }}
            title={demoButtonLabel}
            // Con el botón del portal, ese ya empuja los dos a la derecha.
            style={{
              ...headerButton,
              border: '1px solid var(--color-accent)',
              ...(portal === null ? { marginLeft: 'auto' } : {}),
            }}
          >
            {demoButtonLabel}
          </button>
        </>
      )}
    </header>
  );
}
