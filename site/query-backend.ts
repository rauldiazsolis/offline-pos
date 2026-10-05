import { POS_CONTRACT_VERSION } from '../src/domain/contract-version.ts';
import { backendInfoSchema, CONTRACT_VERSION_HEADER } from '../src/sync/connector.ts';
import { requestDemoSession } from '../src/sync/demo-session.ts';

/** Lo que la home muestra de un backend, consultado en vivo (#148, #54). */
export type BackendFacts = { contract: string; capabilities: string[]; checkedAt: string };

/**
 * `GET /info` está autenticado, así que se pide antes una demo (`POST /demo-sessions`, público) y
 * se usa su conexión. Sin cambio de contrato; la alternativa (`/info` público) es #151. Lanza: una
 * generación con un backend que no contesta tiene que fallar, nunca publicar datos viejos.
 */
export async function queryBackend(url: string, now: Date): Promise<BackendFacts> {
  const session = await requestDemoSession(url);
  if (!session.ok) {
    throw new Error(`${url}: POST /demo-sessions falló (${JSON.stringify(session)})`);
  }
  const base = (session.value.baseUrl ?? url).replace(/\/+$/, '');
  let body: unknown;
  try {
    const response = await fetch(`${base}/info`, {
      headers: {
        Authorization: `Bearer ${session.value.apiKey}`,
        [CONTRACT_VERSION_HEADER]: POS_CONTRACT_VERSION,
      },
    });
    body = (await response.json()) as unknown;
  } catch (error) {
    throw new Error(`${url}: GET /info no contestó (${String(error)})`, { cause: error });
  }
  const info = backendInfoSchema.safeParse(body);
  if (!info.success) {
    throw new Error(`${url}: GET /info devolvió algo inválido (${JSON.stringify(body)})`);
  }
  const capabilities = info.data.capabilities ?? [];
  if (!capabilities.includes('demo-sessions')) {
    throw new Error(
      `${url}: no declara la capacidad demo-sessions; la home solo lista backends con demo`,
    );
  }
  return { contract: info.data.contractVersion, capabilities, checkedAt: now.toISOString() };
}
