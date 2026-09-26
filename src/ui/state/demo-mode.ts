import { signal } from '@preact/signals';

export const isDemoModeSignal = signal<boolean>(false);

const DEMO_STORAGE_KEY = 'offline-pos:demo-mode';
const PENDING_WIPE_KEY = 'offline-pos:pending-wipe-key';
const PENDING_WIPE_TIME = 'offline-pos:pending-wipe-time';

/**
 * Determina si el modo demo está o puede estar activo.
 * Solo se acepta si no hay datos de usuario previos o si estamos en entorno de desarrollo.
 */
export function initDemoMode(hasUserData: boolean): boolean {
  if (typeof window === 'undefined') return false;

  const isDev = Boolean(import.meta.env?.DEV);
  const url = new URL(window.location.href);
  const requestedDemo = url.searchParams.has('demo') || url.searchParams.get('mode') === 'demo';
  const savedDemo = localStorage.getItem(DEMO_STORAGE_KEY) === 'true';

  const canActivate = isDev || !hasUserData;

  if (url.searchParams.get('demo') === 'false') {
    isDemoModeSignal.value = false;
    localStorage.removeItem(DEMO_STORAGE_KEY);
    return false;
  }

  if ((requestedDemo || savedDemo) && canActivate) {
    isDemoModeSignal.value = true;
    localStorage.setItem(DEMO_STORAGE_KEY, 'true');
    return true;
  }

  isDemoModeSignal.value = savedDemo && canActivate;
  return isDemoModeSignal.value;
}

/**
 * Inicia el handshake seguro con Mini-ERP:
 * 1. Genera un token wipe_key único.
 * 2. Lo almacena localmente en localStorage de esta terminal.
 * 3. Redirige al onboarding de Mini-ERP con el return_url y el wipe_key.
 */
export function startOnboardingHandshake(erpBaseUrl = 'http://localhost:4100'): void {
  if (typeof window === 'undefined') return;

  const wipeKey =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `wipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  localStorage.setItem(PENDING_WIPE_KEY, wipeKey);
  localStorage.setItem(PENDING_WIPE_TIME, Date.now().toString());

  const returnUrl = window.location.origin + window.location.pathname;
  const targetUrl = new URL('/onboarding', erpBaseUrl);
  targetUrl.searchParams.set('return_url', returnUrl);
  targetUrl.searchParams.set('wipe_key', wipeKey);
  targetUrl.searchParams.set('preset', 'kiosco');

  window.location.href = targetUrl.toString();
}

/**
 * Verifica si un wipe_key entrante coincide con el emitido por esta terminal.
 * Si es válido, lo consume inmediatamente (token de un solo uso).
 */
export function verifyAndConsumeWipeKey(incomingKey: string | null): boolean {
  if (!incomingKey || typeof window === 'undefined') return false;

  const storedKey = localStorage.getItem(PENDING_WIPE_KEY);
  const storedTime = localStorage.getItem(PENDING_WIPE_TIME);

  if (!storedKey || storedKey !== incomingKey) {
    return false;
  }

  if (storedTime) {
    const elapsed = Date.now() - parseInt(storedTime, 10);
    // Expiración a las 2 horas
    if (elapsed > 2 * 60 * 60 * 1000) {
      localStorage.removeItem(PENDING_WIPE_KEY);
      localStorage.removeItem(PENDING_WIPE_TIME);
      return false;
    }
  }

  // Consumo exitoso
  localStorage.removeItem(PENDING_WIPE_KEY);
  localStorage.removeItem(PENDING_WIPE_TIME);
  localStorage.removeItem(DEMO_STORAGE_KEY);
  isDemoModeSignal.value = false;
  return true;
}
