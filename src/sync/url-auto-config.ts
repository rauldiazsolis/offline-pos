import { hasUserData, type LocalDataSummary } from '../storage/local-data.ts';
import { applyConnection } from './apply-connection.ts';
import { probeConnection } from './connection.ts';
import type { SyncConfig } from './config.ts';
import { verifyAndConsumeWipeKey } from '../ui/state/demo-mode.ts';
import {
  setConfigField,
  setConfigTerminalField,
  setConfigType,
} from '../ui/keyboard/config-controller.ts';
import { cartSignal, cartSelectionIndexSignal } from '../ui/state/cart.ts';
import { resetAttachedCustomer } from '../ui/state/customer.ts';
import { identityResetSignal } from '../ui/state/sync-config.ts';

export type AutoConfigOutcome = {
  handled: boolean;
  success: boolean;
  mode?: 'auto-applied' | 'wizard-fallback';
  error?: string;
};

/**
 * Limpia los parámetros de configuración de la barra de direcciones
 * para evitar reintentar la configuración ante un refresco (F5).
 */
export function cleanUrlParams(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('connector_url');
    url.searchParams.delete('base_url');
    url.searchParams.delete('api_key');
    url.searchParams.delete('branch');
    url.searchParams.delete('pos_terminal');
    url.searchParams.delete('tenant_id');
    url.searchParams.delete('business_name');
    url.searchParams.delete('preset');
    url.searchParams.delete('wipe_key');
    url.searchParams.delete('status');
    const newSearch = url.searchParams.toString();
    const newUrl = `${url.pathname}${newSearch ? '?' + newSearch : ''}${url.hash}`;
    window.history.replaceState({}, '', newUrl);
  } catch {
    // Si no se puede manipular history, no bloquear
  }
}

/**
 * Procesa la configuración entrante por URL (ej: retorno de Onboarding o enlace de WhatsApp).
 */
export async function handleUrlAutoConfig(summary: LocalDataSummary): Promise<AutoConfigOutcome> {
  if (typeof window === 'undefined') return { handled: false, success: false };

  const url = new URL(window.location.href);
  const connectorUrl = url.searchParams.get('connector_url') || url.searchParams.get('base_url');
  const apiKey = url.searchParams.get('api_key');
  const branch = (url.searchParams.get('branch') || 'CENTRAL').trim();
  const posTerminal = (url.searchParams.get('pos_terminal') || 'Caja 1').trim();
  const incomingWipeKey = url.searchParams.get('wipe_key');

  if (!connectorUrl || !apiKey) {
    return { handled: false, success: false };
  }

  const isWipeAuthorized = verifyAndConsumeWipeKey(incomingWipeKey);
  const hasExistingData = hasUserData(summary);

  // Enfoque 3 (Auto-wipe): Se ejecuta si fue autorizado con wipe_key o si la terminal no tiene datos que perder (caso WhatsApp en dispositivo nuevo)
  if (isWipeAuthorized || !hasExistingData) {
    try {
      const candidate: SyncConfig = {
        type: 'rest',
        baseUrl: connectorUrl,
        apiKey: apiKey,
        branch,
        pointOfSale: posTerminal,
      };

      const probeResult = await probeConnection(candidate);
      if (probeResult.ok) {
        const applyResult = await applyConnection({
          candidate,
          snapshot: probeResult.value,
          local: 'wipe',
          originChanged: true,
          now: new Date().toISOString(),
        });

        if (applyResult.ok) {
          // Vaciar carrito en memoria y cliente asociado ante el wipe
          cartSignal.value = { lines: [] };
          cartSelectionIndexSignal.value = null;
          resetAttachedCustomer();
          identityResetSignal.value = false;

          cleanUrlParams();
          return { handled: true, success: true, mode: 'auto-applied' };
        }
      }
    } catch (err: unknown) {
      console.warn('Fallo en auto-aplicación de configuración por URL:', err);
    }
  }

  // Enfoque 2 (Fallback): Hay datos locales existentes y NO vino con wipe_key válido.
  // No borramos a ciegas; precargamos el wizard de /CONFIG para confirmación explícita.
  setConfigType('rest');
  setConfigField('baseUrl', connectorUrl);
  setConfigField('apiKey', apiKey);
  setConfigTerminalField('branch', branch);
  setConfigTerminalField('pointOfSale', posTerminal);
  cleanUrlParams();

  return { handled: true, success: false, mode: 'wizard-fallback' };
}
