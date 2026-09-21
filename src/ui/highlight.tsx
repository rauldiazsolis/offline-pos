import type { ComponentChildren } from 'preact';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Envuelve en `<mark>` cada ocurrencia (sin distinguir mayúsculas) de alguna palabra de `query`
 * dentro de `text` — usado en las 3 pestañas de `/RESUMEN` para mostrar qué coincidió con el
 * filtro tipeado, no solo ocultar lo que no matchea (issue post-PR #65).
 */
export function highlightMatches(text: string, query: string): ComponentChildren {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return text;

  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length === 1) return text;

  // `String.split` con un regex de un solo grupo de captura devuelve las partes no-matcheadas en
  // los índices pares y las matcheadas (el propio grupo capturado) en los impares — más simple y
  // sin estado que volver a testear cada parte contra un regex `g` (que arrastra `lastIndex`).
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        style={{ background: 'var(--color-accent)', color: 'var(--color-chrome-bg)', borderRadius: '2px' }}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
