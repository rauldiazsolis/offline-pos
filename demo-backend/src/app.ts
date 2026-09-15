import { createServer, type Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { handleRequest } from './router.ts';

/** Arma el servidor sin escuchar en ningún puerto — separado de `server.ts` para poder testearlo en un puerto efímero (`listen(0)`). */
export function createApp(db: DatabaseSync): Server {
  return createServer((req, res) => {
    void handleRequest(db, req, res);
  });
}
