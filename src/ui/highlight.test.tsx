import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { highlightMatches } from './highlight.tsx';

describe('highlightMatches', () => {
  it('sin query, devuelve el texto sin envolver', () => {
    const { container } = render(<div>{highlightMatches('Arroz 1kg', '')}</div>);

    expect(container.querySelectorAll('mark').length).toBe(0);
    expect(container.textContent).toBe('Arroz 1kg');
  });

  it('envuelve la coincidencia en <mark>, sin distinguir mayúsculas', () => {
    const { container } = render(<div>{highlightMatches('Arroz 1kg', 'arroz')}</div>);

    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('Arroz');
  });

  it('resalta cada palabra del query por separado, en cualquier parte del texto', () => {
    const { container } = render(<div>{highlightMatches('Paula Torres', 'torres paula')}</div>);

    const marks = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual(['Paula', 'Torres']);
  });

  it('sin coincidencias, no agrega ningún <mark>', () => {
    const { container } = render(<div>{highlightMatches('Arroz 1kg', 'fideos')}</div>);

    expect(container.querySelectorAll('mark').length).toBe(0);
    expect(container.textContent).toBe('Arroz 1kg');
  });
});
