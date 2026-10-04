import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

/** El origen con el que llegó el request: para armar URLs absolutas hacia este mismo servidor. */
export function requestOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? 'localhost:4000'}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Lee y parsea el body como JSON. Body vacío (GET, DELETE) → `undefined`. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw === '' ? undefined : (JSON.parse(raw) as unknown);
}
