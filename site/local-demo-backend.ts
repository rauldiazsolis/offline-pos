import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../demo-backend/src/server.ts', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('No se pudo reservar un puerto'));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function waitUntilUp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // todavía arrancando
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`El demo-backend no arrancó en ${String(timeoutMs)} ms (${url})`);
}

/**
 * Levanta el demo-backend de este commit, en memoria y en un puerto libre, y lo apaga al terminar
 * (#148). Nunca se consulta un `localhost:4000` ya levantado: `POST /demo-sessions` resiembra la
 * base y le borraría los datos a quien lo esté usando.
 */
export async function withLocalDemoBackend<T>(run: (url: string) => Promise<T>): Promise<T> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DEMO_BACKEND_PORT: String(port), DEMO_BACKEND_DB: ':memory:' },
    stdio: 'inherit',
  });
  try {
    const url = `http://localhost:${String(port)}`;
    await waitUntilUp(`${url}/_demo`, 15_000);
    return await run(url);
  } finally {
    child.kill();
  }
}
