import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { loadDraftCart } from '../storage/draft-cart-repository.ts';
import { loadSyncConfig } from '../sync/config.ts';
import { connectionState } from '../sync/connection-state.ts';
import { restoreBackendCapabilities } from '../sync/backend-capabilities.ts';
import { restoreBackendCompany } from '../sync/backend-company.ts';
import { restoreBackendNotices } from '../sync/backend-notices.ts';
import { restoreDemoRevoked } from '../sync/demo-revoked.ts';
import { startSyncEngine } from '../sync/engine.ts';
import { resolveDeviceIdentity } from '../sync/terminal-identity.ts';
import { stripOnboardingParams } from '../sync/demo-link.ts';
import { openRequiredWizard, openWizardWithCandidate } from './keyboard/config-controller.ts';
import { openDemoConfirm } from './keyboard/demo-confirm-controller.ts';
import { runOnboardingFromUrl } from './onboarding.ts';
import { resetSessionAfterWipe } from './session-reset.ts';
import { cartSignal } from './state/cart.ts';
import { commandBarNoticeSignal, commandBarWarningSignal } from './state/command-bar.ts';
import { setCatalogRepository } from './state/catalog.ts';
import { attachedCustomerSignal } from './state/customer.ts';
import { setCustomerRepository } from './state/customer-repository.ts';
import { startCartPersistence } from './state/persist-cart.ts';
import { refreshStockSnapshot } from './state/stock.ts';
import { refreshCustomerBalances } from './state/customer-balance.ts';
import { summarizeLocalData, hasUserData } from '../storage/local-data.ts';
import { getCashBalance } from '../storage/cash-repository.ts';
import { lastCashCountAtSignal, startCashClock } from './state/cash.ts';
import { setActiveConnectorType, setConnectionState, setDemoSession } from './state/sync.ts';
import { configNoticeSignal, identityResetSignal } from './state/sync-config.ts';

/**
 * Arma los repositorios antes del primer render y arranca el motor de sync.
 * Se llama una sola vez desde `main.tsx`. Ya no siembra catálogo/clientes
 * localmente (Fase 7): esos datos ahora vienen del minibackend de demo (o de
 * cualquier backend real) vía pull — una terminal recién instalada, sin una
 * conexión probada todavía, arranca directamente en `/CONFIG` (Etapa 2b). Los
 * fixtures y `seedCatalogIfEmpty`/`seedCustomersIfEmpty`
 * (`storage/seed-catalog.ts`, `storage/seed-customers.ts`) se mantienen — los
 * siguen usando los tests unitarios. Los specs e2e que a propósito prueban el
 * flujo 100% offline sin ningún backend (`e2e/offline-sale.spec.ts`,
 * `e2e/account-sale.spec.ts`, `e2e/void-sale.spec.ts`, y los de
 * `e2e/cart-persistence.spec.ts`/`e2e/cash.spec.ts`/
 * `e2e/keyboard-only.spec.ts` que venden algo) no pueden importar esos
 * módulos TS (corren contra el build real en el navegador, no en Node) — en
 * su lugar siembran el mismo fixture directo en IndexedDB vía
 * `e2e/helpers.ts::seedCatalog`.
 */
export async function bootstrap(): Promise<void> {
  // Etapa 2 (#97): antes que nada — sin id, lo local se borra y no hay que
  // cargar repositorios ni la venta en curso de datos que ya no sirven.
  const identity = await resolveDeviceIdentity();
  identityResetSignal.value = identity.status === 'created' && identity.wipedLocalData;

  const catalogRepository = await loadCatalogRepository();
  setCatalogRepository(catalogRepository);
  setCustomerRepository(await loadCustomerRepository());
  await refreshStockSnapshot();
  await refreshCustomerBalances();
  // Etapa 5 de #94 (#100): el aviso "Sin arqueo en 24 h" de la barra de estado.
  lastCashCountAtSignal.value = (await getCashBalance()).lastCountAt;
  startCashClock();

  // Restaurar antes de empezar a persistir (issue #17): así el primer
  // disparo del effect no reescribe innecesariamente el mismo valor que se
  // acaba de leer.
  const draft = await loadDraftCart();
  if (draft !== undefined) {
    cartSignal.value = draft.cart;
    if (draft.customer !== undefined) {
      attachedCustomerSignal.value = draft.customer;
    }
  }
  startCartPersistence();

  // Onboarding de demo (#128): un link de demo o la vuelta del alta. Antes de leer la config:
  // puede haberla cambiado. La URL se limpia siempre, así un F5 no lo repite.
  const onboarding = await runOnboardingFromUrl(window.location.href, {
    config: loadSyncConfig(),
    hasUserData: hasUserData(await summarizeLocalData()),
  });
  if (onboarding.kind !== 'none') {
    window.history.replaceState(null, '', stripOnboardingParams(window.location.href));
  }
  if (onboarding.kind === 'applied') {
    // Lo local se borró: la venta en curso restaurada más arriba ya no existe, y el último arqueo
    // tampoco (aviso "Sin arqueo en 24 h").
    await resetSessionAfterWipe();
  }

  // Etapa 2b (#76): el estado de la conexión sale de lo guardado. Sin una
  // conexión activa la app solo muestra el wizard de `/CONFIG` (ver
  // `ui/app.tsx`), precargado con lo guardado y abierto en el primer paso que
  // falta (Etapa 2 de #94: `unverified`, `incomplete` o identidad perdida).
  const configResult = loadSyncConfig();
  const state = connectionState(configResult);
  setConnectionState(state);
  setActiveConnectorType(state === 'active' && configResult.ok ? configResult.value.type : null);
  setDemoSession(state === 'active' && configResult.ok ? (configResult.value.demo ?? null) : null);
  // 4.4.0 (#128): capacidades del último `getInfo` y avisos del último pull, así una terminal que
  // arranca sin red los sabe. 4.5.0 (#193): también la empresa.
  restoreBackendCapabilities();
  restoreBackendCompany();
  restoreBackendNotices();
  // #176: una demo revocada se sigue mostrando aunque se arranque sin red.
  restoreDemoRevoked();

  if (onboarding.kind === 'review') {
    await openWizardWithCandidate(onboarding.candidate, onboarding.notice);
  } else if (state !== 'active') {
    await openRequiredWizard();
    if (onboarding.kind === 'failed') {
      configNoticeSignal.value = onboarding.notice;
    }
  } else if (onboarding.kind === 'failed') {
    commandBarWarningSignal.value = onboarding.notice;
  } else if (onboarding.kind === 'applied' && onboarding.notice !== undefined) {
    commandBarNoticeSignal.value = onboarding.notice;
  }

  // #176: hay algo que perder, así que se confirma antes de pedir la demo. Sin conexión activa, el
  // wizard requerido ya quedó abierto arriba, por si se cancela. `openDemoConfirm` pausa el sync
  // antes de su primer `await`: `startSyncEngine` no corre nada mientras la pantalla esté abierta.
  if (onboarding.kind === 'confirm') {
    void openDemoConfirm(onboarding.entry);
  }

  startSyncEngine();
}
