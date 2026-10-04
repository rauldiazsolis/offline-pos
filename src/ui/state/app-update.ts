import { signal } from '@preact/signals';

/**
 * Versión nueva del POS (#54): `available` cuando el service worker ya descargó una y espera,
 * `applying` mientras `/ACTUALIZAR` la aplica.
 */
export type AppUpdateState = 'none' | 'available' | 'applying';
export const appUpdateSignal = signal<AppUpdateState>('none');

/**
 * Si el POS abre sin red (#54): `ready` con un service worker activo, `installing` mientras se
 * instala el primero, `unsupported` sin service worker (contexto no seguro, dev o registro fallido).
 */
export type ServiceWorkerState = 'unsupported' | 'installing' | 'ready';
export const serviceWorkerStateSignal = signal<ServiceWorkerState>('unsupported');
