import { describe, expect, it } from 'vitest';
import { keepFocusOnMouseDown } from './use-mouse-keeps-focus.ts';

function mouseDownOn(target: Element, button = 0): MouseEvent {
  const event = new MouseEvent('mousedown', { button, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  return event;
}

describe('keepFocusOnMouseDown', () => {
  const setup = (html: string) => {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const root = document.getElementById('root');
    root?.addEventListener('mousedown', keepFocusOnMouseDown);
    return root;
  };

  it('cancela el botón izquierdo sobre algo que no es un control de texto', () => {
    setup('<p id="t">texto</p><button id="b">x</button>');
    expect(mouseDownOn(document.getElementById('t') as Element).defaultPrevented).toBe(true);
    expect(mouseDownOn(document.getElementById('b') as Element).defaultPrevented).toBe(true);
  });

  it('no toca inputs', () => {
    setup('<input id="i" />');
    expect(mouseDownOn(document.getElementById('i') as Element).defaultPrevented).toBe(false);
  });

  it('no toca el botón del medio (autoscroll)', () => {
    setup('<p id="t">texto</p>');
    expect(mouseDownOn(document.getElementById('t') as Element, 1).defaultPrevented).toBe(false);
  });
});
