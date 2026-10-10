/**
 * Entrada del POS mobile para desarrollo (`pnpm --filter pos-mobile dev`) y para la vista previa con
 * datos de ejemplo (`build:preview`). La app publicada es una sola con las dos vistas (`src/main.tsx`
 * de la raíz, que elige según `ui/state/ui-mode.ts`); acá se arranca esa misma, después de cargar los
 * datos de ejemplo si es la vista previa.
 */
async function start(): Promise<void> {
  if (__PREVIEW__) {
    const { seedPreview } = await import('./preview/seed.ts');
    await seedPreview();
  }
  await import('../../src/main.tsx');
}

void start();
