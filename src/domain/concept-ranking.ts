/**
 * Estadística de uso de un concepto de ingreso o egreso (`/CAJA`, spec de #100, §1). Ingreso y
 * egreso llevan estadísticas separadas. La clave es `[direction+concept]` con la grafía de la
 * primera vez; la comparación ignora mayúsculas y espacios de más (`conceptKey`).
 */
export type CashConcept = {
  direction: 'in' | 'out';
  concept: string;
  uses: number;
  lastUsedAt: string; // ISO 8601
};

export const CONCEPT_HALF_LIFE_DAYS = 14;
export const CONCEPT_SUGGESTIONS_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

function collapseSpaces(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function conceptKey(concept: string): string {
  return collapseSpaces(concept).toLocaleLowerCase();
}

/** Usos ponderados por recencia: la mitad cada 14 días desde el último uso. */
export function conceptScore(concept: CashConcept, now: string): number {
  const days = Math.max(0, (Date.parse(now) - Date.parse(concept.lastUsedAt)) / DAY_MS);
  return concept.uses * 0.5 ** (days / CONCEPT_HALF_LIFE_DAYS);
}

export function rankConcepts(
  concepts: readonly CashConcept[],
  now: string,
  limit = CONCEPT_SUGGESTIONS_LIMIT,
): CashConcept[] {
  return [...concepts]
    .sort(
      (a, b) => conceptScore(b, now) - conceptScore(a, now) || a.concept.localeCompare(b.concept),
    )
    .slice(0, limit);
}

/** La estadística después de usar el concepto una vez más. */
export function recordConceptUse(
  existing: CashConcept | undefined,
  params: { direction: 'in' | 'out'; concept: string; now: string },
): CashConcept {
  if (existing !== undefined) {
    return { ...existing, uses: existing.uses + 1, lastUsedAt: params.now };
  }
  return {
    direction: params.direction,
    concept: collapseSpaces(params.concept),
    uses: 1,
    lastUsedAt: params.now,
  };
}
