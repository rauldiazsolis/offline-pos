import { signal, type Signal } from '@preact/signals';
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { useTicketListNavigation } from './use-ticket-list-navigation.ts';

/**
 * jsdom no calcula layout real (`offsetTop`/`offsetHeight` son 0 salvo que se los fuerce a mano) —
 * el harness de este test define geometría explícita por ticket para poder probar la mecánica sin
 * un navegador real. Cada entrada es la altura en px; las cabeceras se fuerzan a 40px.
 */
function TestHarness({
  heights,
  headerHeight = 40,
  clientHeight = 300,
  selectedIndex,
  onKeyDownResult,
  onReady,
}: {
  heights: number[];
  headerHeight?: number;
  clientHeight?: number;
  selectedIndex: Signal<number>;
  onKeyDownResult?: (handled: boolean) => void;
  onReady?: (nav: ReturnType<typeof useTicketListNavigation>) => void;
}) {
  const nav = useTicketListNavigation(selectedIndex, heights.length);
  onReady?.(nav);
  const offsets: number[] = [];
  let running = 0;
  for (let i = 0; i < heights.length; i++) {
    offsets.push(running);
    running += heights[i] ?? 0;
  }
  const totalHeight = running;

  return (
    <div
      data-testid="container"
      ref={(el) => {
        nav.containerRef(el);
        if (el !== null) {
          Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
          Object.defineProperty(el, 'scrollHeight', { value: totalHeight, configurable: true });
        }
      }}
      onKeyDown={(e) => {
        const handled = nav.handleKeyDown(e);
        onKeyDownResult?.(handled);
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          data-testid={`ticket-${String(i)}`}
          ref={(el) => {
            nav.ticketRef(i)(el);
            if (el !== null) {
              Object.defineProperty(el, 'offsetTop', { value: offsets[i], configurable: true });
              Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
              const header = document.createElement('div');
              header.className = 'ticket__header';
              Object.defineProperty(header, 'offsetHeight', {
                value: headerHeight,
                configurable: true,
              });
              el.appendChild(header);
            }
          }}
        />
      ))}
    </div>
  );
}

describe('useTicketListNavigation', () => {
  it('ArrowDown repetido recorre los 3 tickets en orden, sin saltear el corto', () => {
    const selectedIndex = signal(0);
    // Ticket 1 corto (60px, ventana angosta comparada al paso de 64px).
    const { getByTestId } = render(
      <TestHarness heights={[400, 60, 400]} selectedIndex={selectedIndex} />,
    );
    const container = getByTestId('container');

    const seen = new Set([selectedIndex.value]);
    for (let i = 0; i < 30; i++) {
      container.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
      seen.add(selectedIndex.value);
    }

    expect(seen).toEqual(new Set([0, 1, 2]));
    expect(selectedIndex.value).toBe(2); // termina en el último
  });

  it('PageDown salta directo al siguiente índice', () => {
    const selectedIndex = signal(0);
    const { getByTestId } = render(
      <TestHarness heights={[400, 400, 400]} selectedIndex={selectedIndex} />,
    );
    const container = getByTestId('container');

    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }),
    );

    expect(selectedIndex.value).toBe(1);
  });

  it('en el tramo final más corto que el viewport, ArrowDown sigue avanzando el cursor sin scroll disponible', () => {
    const selectedIndex = signal(0);
    // clientHeight 300, últimos dos tickets suman 150px — menos que el viewport.
    const { getByTestId } = render(
      <TestHarness heights={[400, 80, 70]} clientHeight={300} selectedIndex={selectedIndex} />,
    );
    const container = getByTestId('container');

    for (let i = 0; i < 15; i++) {
      container.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
    }

    expect(selectedIndex.value).toBe(2);
  });

  it('ignora teclas que no son de navegación', () => {
    const selectedIndex = signal(0);
    let handled: boolean | undefined;
    const { getByTestId } = render(
      <TestHarness
        heights={[400]}
        selectedIndex={selectedIndex}
        onKeyDownResult={(h) => {
          handled = h;
        }}
      />,
    );

    getByTestId('container').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
    );

    expect(handled).toBe(false);
  });

  it('select mueve la selección y hace scroll hasta ese ticket (click con mouse)', () => {
    const selectedIndex = signal(0);
    let nav: ReturnType<typeof useTicketListNavigation> | undefined;
    const { getByTestId } = render(
      <TestHarness
        heights={[400, 400, 400]}
        selectedIndex={selectedIndex}
        onReady={(n) => {
          nav = n;
        }}
      />,
    );
    const container = getByTestId('container');

    nav?.select(2);

    expect(selectedIndex.value).toBe(2);
    expect(container.scrollTop).toBe(800);
  });
});
