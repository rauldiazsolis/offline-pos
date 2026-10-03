import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveSyncConfig } from '../../sync/config.ts';
import { returnUrlFor } from '../../sync/demo-link.ts';
import { consumeWipeKey } from '../../sync/wipe-key.ts';
import { setDemoSession } from '../state/sync.ts';
import { startNewDemo, startOnboarding } from './onboarding-controller.ts';

afterEach(() => {
  setDemoSession(null);
  localStorage.clear();
});

describe('startOnboarding (/ALTA, #128)', () => {
  it('navega al alta con return_url y un wipe_key recién emitido', () => {
    setDemoSession({
      template: 'kiosco',
      onboarding: { url: 'https://b.x/alta', label: 'Crear' },
      startedAt: 'x',
    });
    const navigate = vi.fn();

    startOnboarding(navigate);

    const target = new URL(navigate.mock.calls[0]?.[0] as string);
    expect(target.origin + target.pathname).toBe('https://b.x/alta');
    expect(target.searchParams.get('return_url')).toBe(returnUrlFor(window.location.href));
    expect(consumeWipeKey(target.searchParams.get('wipe_key') ?? undefined, new Date())).toBe(true);
  });

  it('sin demo no hace nada', () => {
    setDemoSession(null);
    const navigate = vi.fn();

    startOnboarding(navigate);

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('startNewDemo (/DEMO_NUEVA, #176)', () => {
  const onboarding = { url: 'https://b.x/alta', label: 'Crear' };

  function target(navigate: ReturnType<typeof vi.fn>): URL {
    return new URL(navigate.mock.calls[0]?.[0] as string);
  }

  it('navega al link de demo con el backend del link original y la plantilla', () => {
    setDemoSession({
      template: 'kiosco',
      onboarding,
      startedAt: 'x',
      backend: 'https://b.x/connector',
    });
    const navigate = vi.fn();

    startNewDemo(navigate);

    const url = target(navigate);
    expect(url.origin + url.pathname).toBe(returnUrlFor(window.location.href));
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('https://b.x/connector');
    expect(url.searchParams.get('template')).toBe('kiosco');
  });

  it('una demo anterior a #176, sin backend guardado, usa la baseUrl de la config', () => {
    setDemoSession({ template: 'kiosco', onboarding, startedAt: 'x' });
    saveSyncConfig({ type: 'rest', baseUrl: 'https://b.x', apiKey: 'demo-1' });
    const navigate = vi.fn();

    startNewDemo(navigate);

    expect(target(navigate).searchParams.get('backend')).toBe('https://b.x');
  });

  it('sin demo no hace nada', () => {
    const navigate = vi.fn();
    startNewDemo(navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
});
