import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { registerRoutes } from './router.ts';
import { accountHoldRoutes } from './routes/account-holds.ts';
import { customerRoutes } from './routes/customers.ts';
import { demoResetRoute } from './routes/demo-reset.ts';
import { eventRoutes } from './routes/events.ts';
import { panelRoutes } from './routes/panel.ts';
import { productRoutes } from './routes/products.ts';
import { stockRoutes } from './routes/stock.ts';
import { seedIfEmpty } from './seed.ts';

const PORT = 4000;
const dbPath = fileURLToPath(new URL('../data/demo.sqlite', import.meta.url));

const db = openDb(dbPath);
seedIfEmpty(db, new Date().toISOString());

registerRoutes(productRoutes);
registerRoutes(stockRoutes);
registerRoutes(customerRoutes);
registerRoutes(eventRoutes);
registerRoutes(accountHoldRoutes);
registerRoutes(demoResetRoute);
registerRoutes(panelRoutes);

createApp(db).listen(PORT, () => {
  console.log(`Minibackend de demo escuchando en http://localhost:${String(PORT)}`);
});
