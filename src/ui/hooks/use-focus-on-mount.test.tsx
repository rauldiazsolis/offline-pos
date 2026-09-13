import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { useFocusOnMount } from './use-focus-on-mount.ts';

function TestInput() {
  const ref = useFocusOnMount<HTMLInputElement>();
  return <input ref={ref} aria-label="test-input" />;
}

describe('useFocusOnMount', () => {
  it('enfoca el elemento al montarse', () => {
    render(<TestInput />);
    expect(document.activeElement).toBe(screen.getByLabelText('test-input'));
  });
});
