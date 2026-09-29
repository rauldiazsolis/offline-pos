import { afterEach, describe, expect, it, vi } from 'vitest';
import { returnUrlFor } from '../../sync/demo-link.ts';
import { consumeWipeKey } from '../../sync/wipe-key.ts';
import { setDemoSession } from '../state/sync.ts';
import { startOnboarding } from './onboarding-controller.ts';

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
