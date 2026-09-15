import { err, ok, type Result } from '../domain/result.ts';

/**
 * `POST /_demo/reset` contra el minibackend de demostración — no es parte
 * del contrato real del `Connector` (`sync/connector.ts`), es tooling
 * exclusivo de demo. Vive en su propio módulo, igual que
 * `sync/account-hold.ts`, para no mezclar esta llamada con el puerto que sí
 * representa el contrato real que un integrador implementaría.
 */
export async function resetDemoBackend(baseUrl: string): Promise<Result<void>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/_demo/reset`, { method: 'POST' });
  } catch (error) {
    return err('demo/backend-reset-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    return err('demo/backend-reset-failed', {
      message: `El backend respondió ${String(response.status)}`,
    });
  }
  return ok(undefined);
}
