import type { TargetedKeyboardEvent } from 'preact';
import type { Failure } from '../../domain/result.ts';
import { originKey } from '../../sync/connection.ts';
import { connectorLabel } from '../../sync/connector-registry.ts';
import { collectDiagnostics } from '../../sync/diagnostics.ts';
import { describeError } from '../errors.ts';
import { formatAwaitingLotStatus, formatLotIssue } from '../format-lot.ts';
import { useFocusOnMount } from '../hooks/use-focus-on-mount.ts';
import { keepFocusOnMouseDown } from '../hooks/use-mouse-keeps-focus.ts';
import { exitDiagnosticoScreen } from '../keyboard/diagnostico-controller.ts';
import type { SyncLogEntry } from '../state/sync.ts';

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-1)',
};
const labelStyle = {
  fontSize: 'var(--font-size-sm)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--color-text-muted)',
  margin: 0,
};
const monoStyle = { fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' };

function describeLogResult(result: SyncLogEntry['result']): string {
  if (result.ok) {
    return 'OK';
  }
  return describeError({ ok: false, error: result.error, meta: result.meta } as Failure);
}

/**
 * `/DIAGNOSTICO`: pantalla de solo lectura sobre el estado de sincronización
 * — un usuario probando el conector de Sheets contra un despliegue real se
 * topó con un error sin poder ver el detalle (la Console del navegador no
 * mostraba nada). Todo acá sale de `sync/diagnostics.ts::collectDiagnostics`
 * (signals y lecturas síncronas de `localStorage`), la misma foto que
 * `pos.status()` muestra en la consola — se actualiza sola mientras está
 * abierta, sin poll.
 */
export function DiagnosticoScreen() {
  const containerRef = useFocusOnMount<HTMLDivElement>();

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      exitDiagnosticoScreen();
    }
  };

  const diagnostics = collectDiagnostics();
  const { config: configResult, currentLot, awaitingLots, log } = diagnostics;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // Teclado + mouse (Etapa 2 de #94): ver ui/hooks/use-mouse-keeps-focus.ts.
      onMouseDown={keepFocusOnMouseDown}
      style={{
        height: 'var(--app-height)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>
          Diagnóstico de sincronización
        </h1>
        <button
          type="button"
          onClick={exitDiagnosticoScreen}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-md)',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          Cerrar (Esc)
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        <div style={cardStyle}>
          <p style={labelStyle}>Conexión</p>
          {configResult.ok ? (
            <>
              <p style={{ margin: 0 }}>{connectorLabel(configResult.value.type)}</p>
              <p style={{ ...monoStyle, margin: 0 }}>{originKey(configResult.value)}</p>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                {configResult.value.verifiedAt !== undefined
                  ? `Probada: ${new Date(configResult.value.verifiedAt).toLocaleString()}`
                  : 'Sin probar'}
              </p>
            </>
          ) : (
            <p style={{ margin: 0, color: 'var(--color-danger)' }}>{describeError(configResult)}</p>
          )}
        </div>

        <div style={cardStyle}>
          <p style={labelStyle}>Motor</p>
          <p style={{ margin: 0 }}>
            Dispositivo: <span style={monoStyle}>{diagnostics.deviceId}</span>
          </p>
          <p style={{ margin: 0 }}>Cerrojo: {diagnostics.lockHeld ? 'ocupado' : 'libre'}</p>
          <p style={{ margin: 0 }}>Red: {diagnostics.online ? 'online' : 'offline'}</p>
        </div>

        <div style={cardStyle}>
          <p style={labelStyle}>Último push</p>
          {currentLot !== undefined ? (
            <>
              <p style={{ margin: 0 }}>
                Lote {currentLot.id} — reintento {currentLot.retries}
              </p>
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                Próximo intento: {new Date(currentLot.nextAttemptAt).toLocaleString()}
              </p>
              {currentLot.lastError !== undefined && (
                <p style={{ margin: 0, color: 'var(--color-danger)' }}>{currentLot.lastError}</p>
              )}
            </>
          ) : (
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              Sin lote pendiente de reintento
            </p>
          )}
        </div>

        <div style={cardStyle}>
          <p style={labelStyle}>Último pull</p>
          <p style={{ margin: 0 }}>
            {diagnostics.lastSyncedAt !== null
              ? `OK ${new Date(diagnostics.lastSyncedAt).toLocaleString()}`
              : 'Todavía no hubo un pull exitoso'}
          </p>
          {diagnostics.lastSyncFailure !== null && (
            <p style={{ margin: 0, color: 'var(--color-danger)' }}>
              {describeError(diagnostics.lastSyncFailure)}
            </p>
          )}
          {diagnostics.pushLotIssues !== null && (
            <p style={{ margin: 0, color: 'var(--color-warning, #b45309)' }}>
              Issues del backend: {diagnostics.pushLotIssues.map(formatLotIssue).join('; ')}
            </p>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <p style={labelStyle}>Lotes de push en espera de confirmación ({awaitingLots.length})</p>
        {awaitingLots.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Ninguno</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
            {awaitingLots.map((lot) => (
              <li key={lot.id} style={monoStyle}>
                {lot.id} — enviado {new Date(lot.sentAt).toLocaleString()} —{' '}
                {formatAwaitingLotStatus(lot)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ ...cardStyle, flex: 1, minHeight: 0 }}>
        <p style={labelStyle}>Últimos {log.length} intentos de sync</p>
        {log.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            Todavía no hubo ningún intento en esta sesión.
          </p>
        ) : (
          <div style={{ overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 'var(--space-1)' }}>Hora</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-1)' }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-1)' }}>Request</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-1)' }}>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry, index) => (
                  <tr key={index} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-1)', ...monoStyle }}>
                      {new Date(entry.at).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: 'var(--space-1)' }}>{entry.kind}</td>
                    <td
                      style={{
                        padding: 'var(--space-1)',
                        ...monoStyle,
                        maxWidth: 400,
                        overflowWrap: 'break-word',
                      }}
                    >
                      {JSON.stringify(entry.request)}
                    </td>
                    <td
                      style={{
                        padding: 'var(--space-1)',
                        color: entry.result.ok ? 'var(--color-text)' : 'var(--color-danger)',
                      }}
                    >
                      {describeLogResult(entry.result)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
