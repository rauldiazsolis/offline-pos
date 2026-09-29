import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { registerRoutes } from './router.ts';
import { accountHoldRoutes } from './routes/account-holds.ts';
import { demoResetRoute } from './routes/demo-reset.ts';
import { demoSessionRoutes } from './routes/demo-sessions.ts';
import { infoRoutes } from './routes/info.ts';
import { panelRoutes } from './routes/panel.ts';
import { syncRoutes } from './routes/sync.ts';
import { seedIfEmpty } from './seed.ts';

// Puerto y base configurables (#128): el e2e del onboarding levanta un segundo backend en memoria.
const PORT = Number(process.env.DEMO_BACKEND_PORT ?? 4000);
const dbPath =
  process.env.DEMO_BACKEND_DB ?? fileURLToPath(new URL('../data/demo.sqlite', import.meta.url));

const db = openDb(dbPath);
seedIfEmpty(db, new Date().toISOString());

registerRoutes(infoRoutes);
registerRoutes(syncRoutes);
registerRoutes(accountHoldRoutes);
registerRoutes(demoResetRoute);
registerRoutes(demoSessionRoutes);
registerRoutes(panelRoutes);

createApp(db).listen(PORT, () => {
  console.log(`Minibackend de demo escuchando en http://localhost:${String(PORT)}`);
});
