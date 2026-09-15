# Minibackend de demostración (Fase 7, primera pieza) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un minibackend de demostración (Node puro, sin dependencias nuevas de runtime) que implemente los 10 recursos del Connector API, mover los datos de demo del POS hacia él, y probar de punta a punta con un e2e real que hoy solo se valida contra fakes.

**Architecture:** `demo-backend/` como paquete propio de un workspace pnpm liviano (separado del POS, que corre en el navegador). Node 24 ejecuta `.ts` nativamente — sin transpilar, sin `tsx`/`ts-node`. `node:sqlite` para persistencia (un archivo por instancia, reseteable). `node:http` con un router hecho a mano (10 rutas fijas, sin librería). El POS deja de sembrar datos localmente al arrancar (ahora los pide por sync real al minibackend) y `/DEMO_RESET` pasa a orquestar reset remoto + borrado local + resync.

**Tech Stack:** TypeScript nativo de Node 24 (sin build step), `node:sqlite`, `node:http`, Vitest (paquete propio para el backend, entorno `node`), Playwright (e2e existente, extendido).

**Spec:** `docs/superpowers/specs/2026-09-15-fase-7-minibackend-demo-design.md`

## Global Constraints

- Node 24 (floor ya usado por CI y el entorno de desarrollo) — cero dependencias nuevas de runtime para `demo-backend` (`node:sqlite` + `node:http` nativos).
- `demo-backend/` es un paquete pnpm separado del root (workspace liviano), nunca mezclado en el `package.json` del POS.
- El minibackend escucha en el puerto **4000** — no debe chocar con Vite (`5173`) ni `vite preview` (`4173`).
- El minibackend nunca simula rechazo de negocio en los eventos de sincronización (`sales`, `stock-movements`, `sales/{id}/void`, `customers`, `cash-sessions`): siempre responde éxito tras deduplicar por `Idempotency-Key`.
- `account-holds` (los tres endpoints) responden **501** siempre — cuenta corriente no está implementada del lado del backend todavía.
- Auth: exige `Authorization: Bearer <no-vacío>` en todo el contrato real (401 si falta); los endpoints `/_demo/*` (panel, reset, lectura) **no** exigen auth.
- `/_demo/reset` es el único endpoint de reset — lo usan tanto el botón del panel como `/DEMO_RESET` del POS.
- Los fixtures locales del POS (`storage/fixtures/*.json`, `seedCatalogIfEmpty`, `seedCustomersIfEmpty`) se mantienen intactos — siguen siendo necesarios para tests y para `e2e/offline-sale.spec.ts`/`e2e/account-sale.spec.ts`. Solo se les saca el llamado desde `bootstrap.ts`.
- Todo el código nuevo pasa `pnpm lint`, `pnpm typecheck` (POS) y `pnpm --filter demo-backend run typecheck`/`test` sin errores antes de cada commit.

---

## Task 1: Workspace pnpm + schema SQLite del minibackend

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `demo-backend/package.json`
- Create: `demo-backend/tsconfig.json`
- Create: `demo-backend/vitest.config.ts`
- Create: `demo-backend/src/db.ts`
- Test: `demo-backend/test/db.test.ts`
- Modify: `package.json` (root — agrega scripts, ver Step 6)
- Modify: `.gitignore` (root — agrega `demo-backend/data/`)

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync` (`demo-backend/src/db.ts`) — abre (creando el directorio si hace falta) y aplica el schema completo. `path === ':memory:'` para tests.

- [ ] **Step 1: Crear el workspace y el paquete `demo-backend`**

`pnpm-workspace.yaml` (raíz):
```yaml
packages:
  - '.'
  - 'demo-backend'
```

`demo-backend/package.json`:
```json
{
  "name": "demo-backend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.ts",
    "start": "node src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "typescript": "~6.0.2",
    "vitest": "^5.0.0"
  }
}
```

`demo-backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,
    "module": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "resolveJsonModule": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`demo-backend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 2: Instalar y confirmar que el workspace resuelve**

Run: `pnpm install`
Expected: instala sin errores, genera/actualiza `pnpm-lock.yaml` cubriendo los dos paquetes.

- [ ] **Step 3: Excluir `demo-backend` del Vitest del POS**

Modify `vite.config.ts` (root):
```ts
import preact from '@preact/preset-vite';
import { defaultExclude, defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // e2e/ es de Playwright; demo-backend/ tiene su propio Vitest (entorno
    // node, no jsdom) — sin esto, sus *.test.ts colisionarían acá.
    exclude: [...defaultExclude, 'e2e/**', 'demo-backend/**'],
  },
});
```

- [ ] **Step 4: Escribir el test del schema SQLite (falla — `db.ts` no existe)**

`demo-backend/test/db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';

describe('openDb', () => {
  it('crea todas las tablas del schema sobre una base en memoria', () => {
    const db = openDb(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toEqual(
      [
        'account_hold_attempts',
        'cash_sessions',
        'customers',
        'idempotency_keys',
        'products',
        'sale_voids',
        'sales',
        'stock',
        'stock_movements',
      ].sort(),
    );

    db.close();
  });

  it('permite insertar y leer una fila (round-trip real, no solo el schema)', () => {
    const db = openDb(':memory:');

    db.prepare('INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)').run(
      'p1',
      JSON.stringify({ name: 'Test' }),
      '2026-01-01T00:00:00.000Z',
    );
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get('p1') as {
      id: string;
      payload: string;
    };

    expect(row.id).toBe('p1');
    expect(JSON.parse(row.payload)).toEqual({ name: 'Test' });

    db.close();
  });
});
```

- [ ] **Step 5: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — `Cannot find module '../src/db.ts'`.

- [ ] **Step 6: Implementar `db.ts`**

`demo-backend/src/db.ts`:
```ts
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Tablas espejo de los recursos del Connector API, más `idempotency_keys`
 * (dedup de cualquier POST de evento — RNF-07) y `account_hold_attempts`
 * (log de intentos de cuenta corriente, que siempre responden 501 pero se
 * muestran en el panel). El payload de cada recurso se guarda como JSON
 * crudo (`payload TEXT`) en vez de columnas por campo — este es un backend
 * de demostración, no necesita un mapeo relacional completo para cumplir el
 * contrato.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_voids (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_hold_attempts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** Abre (creando el directorio del archivo si hace falta) y aplica el schema — idempotente. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores. Si `node:sqlite` no tipa `db.prepare(...).all()`/`.get()` como se asumió, ajustar con un cast puntual documentado (mismo criterio que `as Failure` en `domain/result.ts`) y volver a correr.

- [ ] **Step 9: Ignorar el archivo de datos del minibackend**

Modify `.gitignore` (root, agregar al final):
```
# demo-backend
demo-backend/data
```

- [ ] **Step 10: Actualizar scripts del root**

Modify `package.json` (root) — reemplazar `"dev"` y agregar dos scripts:
```json
"dev": "pnpm --parallel -r run dev",
"test:backend": "pnpm --filter demo-backend run test",
"typecheck:backend": "pnpm --filter demo-backend run typecheck",
```
(el resto de los scripts existentes queda igual). No hace falta script `dev` propio en el root `package.json` — ya existe (`"dev": "vite"`), pnpm lo corre como parte de `--parallel -r`.

- [ ] **Step 11: Commit**

```bash
git add pnpm-workspace.yaml demo-backend/package.json demo-backend/tsconfig.json demo-backend/vitest.config.ts demo-backend/src/db.ts demo-backend/test/db.test.ts vite.config.ts package.json .gitignore
git commit -m "feat(demo-backend): workspace pnpm + schema SQLite del minibackend"
```

---

## Task 2: Fixtures y semilla

**Files:**
- Create: `demo-backend/src/fixtures/products.json`
- Create: `demo-backend/src/fixtures/customers.json`
- Create: `demo-backend/src/seed.ts`
- Test: `demo-backend/test/seed.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1).
- Produces: `seedIfEmpty(db: DatabaseSync, now: string): void`, `resetToSeed(db: DatabaseSync, now: string): void` (`demo-backend/src/seed.ts`).

- [ ] **Step 1: Copiar los fixtures del POS con ids estables**

`demo-backend/src/fixtures/products.json` (copia de `src/storage/fixtures/catalog.json`, con `"id"` agregado — sku en minúsculas, determinístico y legible en el panel):
```json
[
  { "id": "alm-001", "sku": "ALM-001", "barcodes": ["7791234000011"], "name": "Arroz 1kg", "price": 1200, "taxRate": 0.21, "category": "almacen", "tracksStock": true, "initialStock": 40 },
  { "id": "alm-002", "sku": "ALM-002", "barcodes": ["7791234000028"], "name": "Fideos 500g", "price": 900, "taxRate": 0.21, "category": "almacen", "tracksStock": true, "initialStock": 50 },
  { "id": "alm-003", "sku": "ALM-003", "barcodes": ["7791234000035"], "name": "Aceite de girasol 900ml", "price": 2600, "taxRate": 0.21, "category": "almacen", "tracksStock": true, "initialStock": 30 },
  { "id": "alm-004", "sku": "ALM-004", "barcodes": ["7791234000042"], "name": "Yerba mate 1kg", "price": 3400, "taxRate": 0.21, "category": "almacen", "tracksStock": true, "initialStock": 25 },
  { "id": "alm-005", "sku": "ALM-005", "barcodes": ["7791234000059"], "name": "Azúcar 1kg", "price": 1100, "taxRate": 0.21, "category": "almacen", "tracksStock": true, "initialStock": 45 },
  { "id": "alm-006", "sku": "ALM-006", "barcodes": ["7791234000066"], "name": "Harina 000 1kg", "price": 950, "taxRate": 0.21, "category": "almacen", "tracksStock": true, "initialStock": 35 },
  { "id": "beb-001", "sku": "BEB-001", "barcodes": ["7791234000073"], "name": "Agua mineral 1.5L", "price": 800, "taxRate": 0.21, "category": "bebidas", "tracksStock": true, "initialStock": 60 },
  { "id": "beb-002", "sku": "BEB-002", "barcodes": ["7791234000080"], "name": "Gaseosa cola 1.5L", "price": 1500, "taxRate": 0.21, "category": "bebidas", "tracksStock": true, "initialStock": 50 },
  { "id": "beb-003", "sku": "BEB-003", "barcodes": ["7791234000097"], "name": "Jugo de naranja 1L", "price": 1300, "taxRate": 0.21, "category": "bebidas", "tracksStock": true, "initialStock": 30 },
  { "id": "beb-004", "sku": "BEB-004", "barcodes": ["7791234000103"], "name": "Cerveza lata 473ml", "price": 1100, "taxRate": 0.21, "category": "bebidas", "tracksStock": true, "initialStock": 48 },
  { "id": "beb-005", "sku": "BEB-005", "barcodes": ["7791234000110"], "name": "Agua saborizada 500ml", "price": 700, "taxRate": 0.21, "category": "bebidas", "tracksStock": true, "initialStock": 40 },
  { "id": "kio-001", "sku": "KIO-001", "barcodes": ["7791234000127"], "name": "Alfajor triple", "price": 650, "taxRate": 0.21, "category": "kiosco", "tracksStock": true, "initialStock": 80 },
  { "id": "kio-002", "sku": "KIO-002", "barcodes": ["7791234000134"], "name": "Chicles menta", "price": 350, "taxRate": 0.21, "category": "kiosco", "tracksStock": true, "initialStock": 100 },
  { "id": "kio-003", "sku": "KIO-003", "barcodes": ["7791234000141"], "name": "Barrita de cereal", "price": 500, "taxRate": 0.21, "category": "kiosco", "tracksStock": true, "initialStock": 70 },
  { "id": "kio-004", "sku": "KIO-004", "barcodes": ["7791234000158"], "name": "Papas fritas 45g", "price": 800, "taxRate": 0.21, "category": "kiosco", "tracksStock": true, "initialStock": 65 },
  { "id": "kio-005", "sku": "KIO-005", "barcodes": ["7791234000165"], "name": "Caramelos surtidos", "price": 300, "taxRate": 0.21, "category": "kiosco", "tracksStock": true, "initialStock": 90 },
  { "id": "lim-001", "sku": "LIM-001", "barcodes": ["7791234000172"], "name": "Detergente 750ml", "price": 1400, "taxRate": 0.21, "category": "limpieza", "tracksStock": true, "initialStock": 28 },
  { "id": "lim-002", "sku": "LIM-002", "barcodes": ["7791234000189"], "name": "Lavandina 1L", "price": 900, "taxRate": 0.21, "category": "limpieza", "tracksStock": true, "initialStock": 32 },
  { "id": "lim-003", "sku": "LIM-003", "barcodes": ["7791234000196"], "name": "Papel higiénico x4", "price": 1800, "taxRate": 0.21, "category": "limpieza", "tracksStock": true, "initialStock": 26 },
  { "id": "lim-004", "sku": "LIM-004", "barcodes": ["7791234000202"], "name": "Esponja de cocina", "price": 400, "taxRate": 0.21, "category": "limpieza", "tracksStock": true, "initialStock": 55 },
  { "id": "pan-001", "sku": "PAN-001", "barcodes": ["7791234000219"], "name": "Pan lactal", "price": 1600, "taxRate": 0.105, "category": "panaderia", "tracksStock": true, "initialStock": 20 },
  { "id": "pan-002", "sku": "PAN-002", "barcodes": ["7791234000226"], "name": "Medialunas x6", "price": 1900, "taxRate": 0.105, "category": "panaderia", "tracksStock": true, "initialStock": 15 },
  { "id": "ser-001", "sku": "SER-001", "barcodes": [], "name": "Envío a domicilio", "price": 800, "taxRate": 0.21, "category": "servicios", "tracksStock": false, "initialStock": 0 },
  { "id": "ser-002", "sku": "SER-002", "barcodes": [], "name": "Recarga de celular", "price": 1000, "taxRate": 0, "category": "servicios", "tracksStock": false, "initialStock": 0 }
]
```

`demo-backend/src/fixtures/customers.json` (copia de `src/storage/fixtures/customers.json`, con `"id"` agregado, y `creditLimit`/`margin`/`balance` en 3 clientes para poder demostrar cuenta corriente offline — el minibackend nunca aprueba holds síncronos, pero el POS evalúa crédito cacheado sin red con estos datos ya pulleados):
```json
[
  { "id": "cust-01", "name": "Ana García", "document": "30123456", "phone": "11-5555-1234", "creditLimit": 5000, "margin": 1000, "balance": 0 },
  { "id": "cust-02", "name": "Carlos Pérez", "document": "27890123", "phone": "11-4444-5678", "creditLimit": 3000, "margin": 500, "balance": 1200 },
  { "id": "cust-03", "name": "María López", "document": "25456789" },
  { "id": "cust-04", "name": "Juan Pérez", "document": "28901234", "phone": "11-4321-9876" },
  { "id": "cust-05", "name": "Juan Pérez" },
  { "id": "cust-06", "name": "Lucía Fernández", "phone": "11-3333-2222" },
  { "id": "cust-07", "name": "Martín Rodríguez", "document": "29876543", "phone": "11-6789-0123", "creditLimit": 8000, "margin": 2000, "balance": 4500 },
  { "id": "cust-08", "name": "Sofía Martínez" },
  { "id": "cust-09", "name": "Diego Sánchez", "document": "26543210" },
  { "id": "cust-10", "name": "Valentina Romero", "document": "31234567", "phone": "11-7654-3210" },
  { "id": "cust-11", "name": "Federico Torres", "phone": "11-2345-6789" },
  { "id": "cust-12", "name": "Camila Ruiz" },
  { "id": "cust-13", "name": "Nicolás Díaz", "document": "27456789", "phone": "11-8765-4321" },
  { "id": "cust-14", "name": "Julieta Álvarez", "document": "30987654" },
  { "id": "cust-15", "name": "Emiliano Castro" },
  { "id": "cust-16", "name": "Florencia Ortiz", "document": "28765432", "phone": "11-9876-5432" },
  { "id": "cust-17", "name": "Tomás Molina", "phone": "11-5432-1098" },
  { "id": "cust-18", "name": "Agustina Silva", "document": "29123456", "phone": "11-1234-5678" },
  { "id": "cust-19", "name": "Ignacio Herrera" },
  { "id": "cust-20", "name": "Micaela Acosta", "document": "26789012" },
  { "id": "cust-21", "name": "Bruno Medina", "document": "31456789", "phone": "11-6543-2109" },
  { "id": "cust-22", "name": "Delfina Vega" }
]
```

- [ ] **Step 2: Escribir el test de semilla (falla — `seed.ts` no existe)**

`demo-backend/test/seed.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { resetToSeed, seedIfEmpty } from '../src/seed.ts';

const NOW = '2026-01-01T00:00:00.000Z';

describe('seedIfEmpty', () => {
  it('siembra products, stock y customers cuando la base está vacía', () => {
    const db = openDb(':memory:');

    seedIfEmpty(db, NOW);

    const productCount = (
      db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }
    ).count;
    const stockCount = (
      db.prepare('SELECT COUNT(*) as count FROM stock').get() as { count: number }
    ).count;
    const customerCount = (
      db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }
    ).count;

    expect(productCount).toBe(24);
    expect(stockCount).toBe(24);
    expect(customerCount).toBe(22);

    const arroz = db.prepare('SELECT payload FROM products WHERE id = ?').get('alm-001') as {
      payload: string;
    };
    expect(JSON.parse(arroz.payload)).toMatchObject({ name: 'Arroz 1kg', price: 1200 });

    const arrozStock = db
      .prepare('SELECT quantity FROM stock WHERE product_id = ?')
      .get('alm-001') as { quantity: number };
    expect(arrozStock.quantity).toBe(40);

    db.close();
  });

  it('no vuelve a sembrar si products ya tiene filas', () => {
    const db = openDb(':memory:');
    seedIfEmpty(db, NOW);
    db.prepare('DELETE FROM customers').run();

    seedIfEmpty(db, NOW);

    const customerCount = (
      db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }
    ).count;
    // Sigue en 0: seedIfEmpty miró products (no vacío) y no volvió a sembrar nada.
    expect(customerCount).toBe(0);

    db.close();
  });
});

describe('resetToSeed', () => {
  it('borra todo (incluidos datos empujados desde el POS) y vuelve a sembrar', () => {
    const db = openDb(':memory:');
    seedIfEmpty(db, NOW);
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      '{}',
      NOW,
    );
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'nuevo',
      '{}',
      'pos',
      NOW,
    );

    resetToSeed(db, NOW);

    const salesCount = (
      db.prepare('SELECT COUNT(*) as count FROM sales').get() as { count: number }
    ).count;
    const customerCount = (
      db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number }
    ).count;
    expect(salesCount).toBe(0);
    expect(customerCount).toBe(22);

    db.close();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — `Cannot find module '../src/seed.ts'`.

- [ ] **Step 4: Implementar `seed.ts`**

`demo-backend/src/seed.ts`:
```ts
import type { DatabaseSync } from 'node:sqlite';
import productsFixture from './fixtures/products.json' with { type: 'json' };
import customersFixture from './fixtures/customers.json' with { type: 'json' };

type ProductFixtureEntry = {
  id: string;
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
  initialStock: number;
};

type CustomerFixtureEntry = {
  id: string;
  name: string;
  document?: string;
  phone?: string;
  creditLimit?: number;
  margin?: number;
  balance?: number;
};

function insertSeedRows(db: DatabaseSync, now: string): void {
  const insertProduct = db.prepare(
    'INSERT INTO products (id, payload, updated_at) VALUES (?, ?, ?)',
  );
  const insertStock = db.prepare(
    'INSERT INTO stock (product_id, quantity, updated_at) VALUES (?, ?, ?)',
  );
  for (const entry of productsFixture as ProductFixtureEntry[]) {
    const { initialStock, ...product } = entry;
    insertProduct.run(entry.id, JSON.stringify(product), now);
    insertStock.run(entry.id, initialStock, now);
  }

  const insertCustomer = db.prepare(
    'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)',
  );
  for (const entry of customersFixture as CustomerFixtureEntry[]) {
    insertCustomer.run(entry.id, JSON.stringify(entry), 'seed', now);
  }
}

/** Siembra desde el fixture local solo si `products` está vacía — mismo criterio que `seedCatalogIfEmpty` del POS. */
export function seedIfEmpty(db: DatabaseSync, now: string): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (row.count > 0) {
    return;
  }
  insertSeedRows(db, now);
}

/** Vacía todas las tablas de datos (nunca `idempotency_keys` a medias — se borra también) y vuelve a sembrar. Usado por `POST /_demo/reset`. */
export function resetToSeed(db: DatabaseSync, now: string): void {
  db.exec(`
    DELETE FROM products;
    DELETE FROM stock;
    DELETE FROM customers;
    DELETE FROM sales;
    DELETE FROM sale_voids;
    DELETE FROM stock_movements;
    DELETE FROM cash_sessions;
    DELETE FROM account_hold_attempts;
    DELETE FROM idempotency_keys;
  `);
  insertSeedRows(db, now);
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS (4 tests en `seed.test.ts`, 2 en `db.test.ts`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add demo-backend/src/fixtures demo-backend/src/seed.ts demo-backend/test/seed.test.ts
git commit -m "feat(demo-backend): fixtures de catálogo/clientes y semilla de SQLite"
```

---

## Task 3: Servidor HTTP mínimo (router + helpers, todavía sin rutas del contrato)

**Files:**
- Create: `demo-backend/src/http-helpers.ts`
- Create: `demo-backend/src/idempotency.ts`
- Create: `demo-backend/src/router.ts`
- Create: `demo-backend/src/app.ts`
- Test: `demo-backend/test/idempotency.test.ts`
- Test: `demo-backend/test/app.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1).
- Produces:
  - `sendJson(res: ServerResponse, status: number, body: unknown): void`, `readJsonBody(req: IncomingMessage): Promise<unknown>` (`http-helpers.ts`).
  - `withIdempotency(db: DatabaseSync, key: string, handler: () => Promise<{status:number;body:unknown}> | {status:number;body:unknown}): Promise<{status:number;body:unknown}>` (`idempotency.ts`).
  - `type RouteContext = { db: DatabaseSync; params: Record<string,string>; url: URL }`, `type RouteHandler`, `type RouteDef = { method: string; pattern: RegExp; requiresAuth: boolean; handler: RouteHandler }`, `registerRoutes(defs: RouteDef[]): void`, `handleRequest(db: DatabaseSync, req: IncomingMessage, res: ServerResponse): Promise<void>` (`router.ts`) — usados por todas las tareas siguientes que agregan rutas.
  - `createApp(db: DatabaseSync): Server` (`app.ts`) — arma el servidor sin escuchar en ningún puerto, para poder testearlo en un puerto efímero.

- [ ] **Step 1: Escribir el test de idempotencia (falla — `idempotency.ts` no existe)**

`demo-backend/test/idempotency.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db.ts';
import { withIdempotency } from '../src/idempotency.ts';

describe('withIdempotency', () => {
  it('ejecuta el handler la primera vez y graba el resultado', async () => {
    const db = openDb(':memory:');
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });

    const result = await withIdempotency(db, 'key-1', handler);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(handler).toHaveBeenCalledTimes(1);

    db.close();
  });

  it('con la misma key, devuelve la respuesta grabada sin volver a ejecutar el handler', async () => {
    const db = openDb(':memory:');
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { count: 1 } });

    await withIdempotency(db, 'key-1', handler);
    const second = await withIdempotency(db, 'key-1', handler);

    expect(second).toEqual({ status: 200, body: { count: 1 } });
    expect(handler).toHaveBeenCalledTimes(1);

    db.close();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — `Cannot find module '../src/idempotency.ts'`.

- [ ] **Step 3: Implementar `http-helpers.ts` e `idempotency.ts`**

`demo-backend/src/http-helpers.ts`:
```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
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
```

`demo-backend/src/idempotency.ts`:
```ts
import type { DatabaseSync } from 'node:sqlite';

export type IdempotentResponse = { status: number; body: unknown };

/**
 * Si `key` ya se procesó antes, devuelve la respuesta ya grabada sin volver
 * a ejecutar `handler` — el contrato exige que todo POST de evento sea
 * idempotente (RNF-07). Si es la primera vez, corre `handler` y graba su
 * resultado antes de devolverlo.
 */
export async function withIdempotency(
  db: DatabaseSync,
  key: string,
  handler: () => Promise<IdempotentResponse> | IdempotentResponse,
): Promise<IdempotentResponse> {
  const existing = db
    .prepare('SELECT status, body FROM idempotency_keys WHERE key = ?')
    .get(key) as { status: number; body: string } | undefined;
  if (existing !== undefined) {
    return { status: existing.status, body: JSON.parse(existing.body) as unknown };
  }

  const response = await handler();
  db.prepare(
    'INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)',
  ).run(key, response.status, JSON.stringify(response.body), new Date().toISOString());
  return response;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 5: Escribir el test del servidor HTTP (falla — `router.ts`/`app.ts` no existen)**

`demo-backend/test/app.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('createApp', () => {
  it('responde 404 para una ruta que no existe (sin rutas registradas todavía)', async () => {
    const response = await fetch(`${baseUrl}/no-existe`);
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — `Cannot find module '../src/app.ts'`.

- [ ] **Step 7: Implementar `router.ts` y `app.ts`**

`demo-backend/src/router.ts`:
```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { sendJson } from './http-helpers.ts';

export type RouteContext = {
  db: DatabaseSync;
  params: Record<string, string>;
  url: URL;
};

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => Promise<void> | void;

export type RouteDef = {
  method: string;
  pattern: RegExp;
  requiresAuth: boolean;
  handler: RouteHandler;
};

/**
 * Tabla de rutas, poblada por cada módulo de `routes/` vía `registerRoutes`
 * — no hay librería de router, son 10 recursos fijos, alcanza con un array
 * recorrido en orden. Vive a nivel de módulo (no en `createApp`) porque cada
 * módulo de rutas se importa una sola vez y se registra al cargar `server.ts`.
 */
const routes: RouteDef[] = [];

export function registerRoutes(defs: RouteDef[]): void {
  routes.push(...defs);
}

function hasValidBearerToken(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return false;
  }
  const match = /^Bearer (.+)$/.exec(header);
  return match !== null && match[1].trim() !== '';
}

export async function handleRequest(
  db: DatabaseSync,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const match = route.pattern.exec(url.pathname);
    if (match === null) {
      continue;
    }
    if (route.requiresAuth && !hasValidBearerToken(req)) {
      sendJson(res, 401, { error: 'Falta el header Authorization: Bearer <token>' });
      return;
    }
    await route.handler(req, res, { db, params: { ...match.groups }, url });
    return;
  }

  sendJson(res, 404, { error: `No existe ${method} ${url.pathname}` });
}
```

`demo-backend/src/app.ts`:
```ts
import { createServer, type Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { handleRequest } from './router.ts';

/** Arma el servidor sin escuchar en ningún puerto — separado de `server.ts` para poder testearlo en un puerto efímero (`listen(0)`). */
export function createApp(db: DatabaseSync): Server {
  return createServer((req, res) => {
    void handleRequest(db, req, res);
  });
}
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS (todos los tests del paquete).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add demo-backend/src/http-helpers.ts demo-backend/src/idempotency.ts demo-backend/src/router.ts demo-backend/src/app.ts demo-backend/test/idempotency.test.ts demo-backend/test/app.test.ts
git commit -m "feat(demo-backend): router HTTP, helpers e idempotencia (sin rutas del contrato todavía)"
```

---

## Task 4: `GET /products` y `GET /stock`

**Files:**
- Create: `demo-backend/src/routes/products.ts`
- Create: `demo-backend/src/routes/stock.ts`
- Test: `demo-backend/test/routes/products.test.ts`
- Test: `demo-backend/test/routes/stock.test.ts`

**Interfaces:**
- Consumes: `RouteDef`, `registerRoutes` (Task 3); `sendJson` (Task 3); `seedIfEmpty` (Task 2).
- Produces: `productRoutes: RouteDef[]` (`routes/products.ts`), `stockRoutes: RouteDef[]` (`routes/stock.ts`) — usados por `server.ts` (Task 10) y por los tests de este task vía `registerRoutes`.

- [ ] **Step 1: Escribir los tests (fallan — los route modules no existen)**

`demo-backend/test/routes/products.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { productRoutes } from '../../src/routes/products.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(productRoutes);
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db, '2026-01-01T00:00:00.000Z');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('GET /products', () => {
  it('exige Authorization Bearer', async () => {
    const response = await fetch(`${baseUrl}/products`);
    expect(response.status).toBe(401);
  });

  it('sin `since`, trae los 24 productos sembrados y un nextCursor', async () => {
    const response = await fetch(`${baseUrl}/products`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { id: string; name: string }[]; nextCursor?: string };
    expect(body.items).toHaveLength(24);
    expect(body.items.some((p) => p.name === 'Arroz 1kg')).toBe(true);
    expect(body.nextCursor).toBe('2026-01-01T00:00:00.000Z');
  });

  it('con `since` en el futuro, no trae nada', async () => {
    const response = await fetch(`${baseUrl}/products?since=2099-01-01T00:00:00.000Z`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });
});
```

`demo-backend/test/routes/stock.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { stockRoutes } from '../../src/routes/stock.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(stockRoutes);
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db, '2026-01-01T00:00:00.000Z');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('GET /stock', () => {
  it('exige Authorization Bearer', async () => {
    const response = await fetch(`${baseUrl}/stock`);
    expect(response.status).toBe(401);
  });

  it('trae el stock de los 24 productos', async () => {
    const response = await fetch(`${baseUrl}/stock`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(response.status).toBe(200);
    const items = (await response.json()) as { productId: string; quantity: number }[];
    expect(items).toHaveLength(24);
    expect(items.find((i) => i.productId === 'alm-001')).toEqual({
      productId: 'alm-001',
      quantity: 40,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — `Cannot find module '../../src/routes/products.ts'` (y `stock.ts`).

- [ ] **Step 3: Implementar las rutas**

`demo-backend/src/routes/products.ts`:
```ts
import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

type ProductRow = { payload: string; updated_at: string };

export const productRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/products$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const since = ctx.url.searchParams.get('since');
      const rows = (
        since === null
          ? ctx.db.prepare('SELECT payload, updated_at FROM products ORDER BY updated_at ASC').all()
          : ctx.db
              .prepare('SELECT payload, updated_at FROM products WHERE updated_at > ? ORDER BY updated_at ASC')
              .all(since)
      ) as ProductRow[];

      const items = rows.map((row) => JSON.parse(row.payload) as unknown);
      const last = rows.at(-1);
      sendJson(res, 200, last === undefined ? { items } : { items, nextCursor: last.updated_at });
    },
  },
];
```

`demo-backend/src/routes/stock.ts`:
```ts
import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

type StockRow = { product_id: string; quantity: number; updated_at: string };

export const stockRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/stock$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const rows = ctx.db.prepare('SELECT * FROM stock').all() as StockRow[];
      const items = rows.map((row) => ({
        productId: row.product_id,
        quantity: row.quantity,
        updatedAt: row.updated_at,
      }));
      sendJson(res, 200, items);
    },
  },
];
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/src/routes/products.ts demo-backend/src/routes/stock.ts demo-backend/test/routes/products.test.ts demo-backend/test/routes/stock.test.ts
git commit -m "feat(demo-backend): GET /products y GET /stock"
```

---

## Task 5: `GET /customers` y `POST /customers`

**Files:**
- Create: `demo-backend/src/routes/customers.ts`
- Test: `demo-backend/test/routes/customers.test.ts`

**Interfaces:**
- Consumes: `RouteDef`, `registerRoutes` (Task 3); `withIdempotency` (Task 3); `seedIfEmpty` (Task 2).
- Produces: `customerRoutes: RouteDef[]`.

- [ ] **Step 1: Escribir el test (falla — el módulo no existe)**

`demo-backend/test/routes/customers.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { customerRoutes } from '../../src/routes/customers.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(customerRoutes);
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db, '2026-01-01T00:00:00.000Z');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('GET /customers', () => {
  it('trae los 22 clientes sembrados, incluidos los que tienen cuenta corriente', async () => {
    const response = await fetch(`${baseUrl}/customers`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await response.json()) as {
      items: { id: string; name: string; creditLimit?: number }[];
    };
    expect(body.items).toHaveLength(22);
    const ana = body.items.find((c) => c.id === 'cust-01');
    expect(ana).toMatchObject({ name: 'Ana García', creditLimit: 5000, margin: 1000, balance: 0 });
  });
});

describe('POST /customers', () => {
  it('exige Idempotency-Key', async () => {
    const response = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'local-1', name: 'Nuevo Cliente' }),
    });
    expect(response.status).toBe(400);
  });

  it('crea el cliente y aparece en un pull posterior, marcado como source pos', async () => {
    const createResponse = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'evt-1',
      },
      body: JSON.stringify({ id: 'local-1', name: 'Nuevo Cliente' }),
    });
    expect(createResponse.status).toBe(200);

    const pullResponse = await fetch(`${baseUrl}/customers?since=2026-01-01T00:00:00.000Z`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await pullResponse.json()) as { items: { id: string; name: string }[] };
    expect(body.items).toEqual([{ id: 'local-1', name: 'Nuevo Cliente' }]);
  });

  it('reenviar la misma Idempotency-Key no duplica el cliente', async () => {
    const request = async () =>
      fetch(`${baseUrl}/customers`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer demo-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'evt-2',
        },
        body: JSON.stringify({ id: 'local-2', name: 'Repetido' }),
      });

    await request();
    await request();

    const pullResponse = await fetch(`${baseUrl}/customers?since=2026-01-01T00:00:00.000Z`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    const body = (await pullResponse.json()) as { items: { id: string }[] };
    expect(body.items.filter((c) => c.id === 'local-2')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `routes/customers.ts`**

```ts
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

type CustomerRow = { payload: string; updated_at: string };

export const customerRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/customers$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      const since = ctx.url.searchParams.get('since');
      const rows = (
        since === null
          ? ctx.db
              .prepare('SELECT payload, updated_at FROM customers ORDER BY updated_at ASC')
              .all()
          : ctx.db
              .prepare(
                'SELECT payload, updated_at FROM customers WHERE updated_at > ? ORDER BY updated_at ASC',
              )
              .all(since)
      ) as CustomerRow[];

      const items = rows.map((row) => JSON.parse(row.payload) as unknown);
      const last = rows.at(-1);
      sendJson(res, 200, last === undefined ? { items } : { items, nextCursor: last.updated_at });
    },
  },
  {
    method: 'POST',
    pattern: /^\/customers$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = (await readJsonBody(req)) as { id: string };
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        const now = new Date().toISOString();
        ctx.db
          .prepare(
            'INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?) ' +
              "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, source = 'pos', updated_at = excluded.updated_at",
          )
          .run(body.id, JSON.stringify(body), 'pos', now);
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  },
];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/src/routes/customers.ts demo-backend/test/routes/customers.test.ts
git commit -m "feat(demo-backend): GET/POST /customers"
```

---

## Task 6: Eventos que siempre responden éxito (`sales`, `stock-movements`, `sales/{id}/void`, `cash-sessions`)

**Files:**
- Create: `demo-backend/src/routes/events.ts`
- Test: `demo-backend/test/routes/events.test.ts`

**Interfaces:**
- Consumes: `RouteDef`, `registerRoutes`, `withIdempotency`.
- Produces: `eventRoutes: RouteDef[]`.

- [ ] **Step 1: Escribir el test (falla — el módulo no existe)**

`demo-backend/test/routes/events.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { eventRoutes } from '../../src/routes/events.ts';

beforeAll(() => {
  registerRoutes(eventRoutes);
});

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

async function post(path: string, key: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer demo-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /sales', () => {
  it('siempre responde 200, nunca simula rechazo de negocio', async () => {
    const response = await post('/sales', 'sale-1', { id: 'sale-1', total: 1200 });
    expect(response.status).toBe(200);
  });

  it('exige Idempotency-Key', async () => {
    const response = await fetch(`${baseUrl}/sales`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'sale-2' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /stock-movements', () => {
  it('siempre responde 200', async () => {
    const response = await post('/stock-movements', 'mov-1', { id: 'mov-1', productId: 'alm-001', delta: -1 });
    expect(response.status).toBe(200);
  });
});

describe('POST /sales/{saleId}/void', () => {
  it('siempre responde 200, con su propia Idempotency-Key (distinta de la venta)', async () => {
    await post('/sales', 'sale-3', { id: 'sale-3', total: 500 });
    const response = await post('/sales/sale-3/void', 'void-1', {
      saleId: 'sale-3',
      voidedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response.status).toBe(200);
  });
});

describe('POST /cash-sessions', () => {
  it('siempre responde 200', async () => {
    const response = await post('/cash-sessions', 'session-1', { id: 'session-1', sales: [] });
    expect(response.status).toBe(200);
  });
});

describe('idempotencia compartida entre los cuatro recursos', () => {
  it('reenviar la misma Idempotency-Key no vuelve a insertar la fila', async () => {
    await post('/sales', 'sale-4', { id: 'sale-4', total: 100 });
    const second = await post('/sales', 'sale-4', { id: 'sale-4', total: 999 });
    expect(second.status).toBe(200);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `routes/events.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import { withIdempotency } from '../idempotency.ts';
import type { RouteDef } from '../router.ts';

/**
 * Fábrica de rutas de "evento que siempre se acepta" — `sales`,
 * `stock-movements`, `sales/{id}/void` y `cash-sessions` comparten el mismo
 * comportamiento (deduplicar por Idempotency-Key, guardar, responder 200):
 * este es un POS de mostrador, no e-commerce, así que el minibackend nunca
 * simula rechazo de negocio en el camino de sincronización.
 */
function writeEventRoute(params: {
  method: string;
  pattern: RegExp;
  insert: (db: DatabaseSync, id: string, body: unknown, now: string) => void;
}): RouteDef {
  return {
    method: params.method,
    pattern: params.pattern,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        sendJson(res, 400, { error: 'Falta el header Idempotency-Key' });
        return;
      }
      const body = await readJsonBody(req);
      const result = await withIdempotency(ctx.db, idempotencyKey, () => {
        params.insert(ctx.db, idempotencyKey, body, new Date().toISOString());
        return { status: 200, body: {} };
      });
      sendJson(res, result.status, result.body);
    },
  };
}

export const eventRoutes: RouteDef[] = [
  writeEventRoute({
    method: 'POST',
    pattern: /^\/sales$/,
    insert: (db, id, body, now) =>
      db
        .prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(body), now),
  }),
  writeEventRoute({
    method: 'POST',
    pattern: /^\/stock-movements$/,
    insert: (db, id, body, now) =>
      db
        .prepare('INSERT INTO stock_movements (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(body), now),
  }),
  writeEventRoute({
    method: 'POST',
    pattern: /^\/sales\/(?<saleId>[^/]+)\/void$/,
    // `saleId` viaja en la URL, pero `writeEventRoute` no pasa `ctx.params`
    // a `insert` — se toma del body en su lugar (el POS lo manda igual, ver
    // `pushSaleVoid` en connectors/rest-fetch-connector.ts del POS).
    insert: (db, id, body, now) => {
      const saleId = (body as { saleId: string }).saleId;
      db
        .prepare('INSERT INTO sale_voids (id, sale_id, payload, created_at) VALUES (?, ?, ?, ?)')
        .run(id, saleId, JSON.stringify(body), now);
    },
  }),
  writeEventRoute({
    method: 'POST',
    pattern: /^\/cash-sessions$/,
    insert: (db, id, body, now) =>
      db
        .prepare('INSERT INTO cash_sessions (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(body), now),
  }),
];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores. Si `no-unsafe-member-access`/`no-explicit-any` (vía `pnpm lint`, correr también) marca el cast `(body as { saleId: string })`, es el único cast de este archivo — documentado, mismo criterio que `as Failure` en el POS.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/src/routes/events.ts demo-backend/test/routes/events.test.ts
git commit -m "feat(demo-backend): POST /sales, /stock-movements, /sales/{id}/void, /cash-sessions"
```

---

## Task 7: Cuenta corriente (`account-holds`) — siempre 501, pero logueada

**Files:**
- Create: `demo-backend/src/routes/account-holds.ts`
- Test: `demo-backend/test/routes/account-holds.test.ts`

**Interfaces:**
- Consumes: `RouteDef`, `registerRoutes`.
- Produces: `accountHoldRoutes: RouteDef[]`.

- [ ] **Step 1: Escribir el test (falla — el módulo no existe)**

`demo-backend/test/routes/account-holds.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { accountHoldRoutes } from '../../src/routes/account-holds.ts';

beforeAll(() => {
  registerRoutes(accountHoldRoutes);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const authHeaders = { Authorization: 'Bearer demo-token', 'Content-Type': 'application/json' };

describe('POST /account-holds', () => {
  it('responde 501 y loguea el intento', async () => {
    const response = await fetch(`${baseUrl}/account-holds`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ customerId: 'cust-01', amount: 500 }),
    });
    expect(response.status).toBe(501);

    const rows = db.prepare('SELECT kind FROM account_hold_attempts').all() as { kind: string }[];
    expect(rows).toEqual([{ kind: 'request' }]);
  });
});

describe('POST /account-holds/{holdId}/confirm', () => {
  it('responde 501 y loguea el intento', async () => {
    const response = await fetch(`${baseUrl}/account-holds/hold-1/confirm`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ saleId: 'sale-1' }),
    });
    expect(response.status).toBe(501);

    const rows = db.prepare('SELECT kind FROM account_hold_attempts').all() as { kind: string }[];
    expect(rows).toEqual([{ kind: 'confirm' }]);
  });
});

describe('DELETE /account-holds/{holdId}', () => {
  it('responde 501 y loguea el intento', async () => {
    const response = await fetch(`${baseUrl}/account-holds/hold-1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(response.status).toBe(501);

    const rows = db.prepare('SELECT kind FROM account_hold_attempts').all() as { kind: string }[];
    expect(rows).toEqual([{ kind: 'release' }]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `routes/account-holds.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { readJsonBody, sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

const NOT_IMPLEMENTED_BODY = {
  error: 'Cuenta corriente todavía no está implementada en el minibackend de demo.',
};

function logAttempt(db: DatabaseSync, kind: 'request' | 'confirm' | 'release', payload: unknown): void {
  const now = new Date().toISOString();
  const id = `${kind}-${now}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    'INSERT INTO account_hold_attempts (id, kind, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, kind, JSON.stringify(payload), now);
}

export const accountHoldRoutes: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/account-holds$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = await readJsonBody(req);
      logAttempt(ctx.db, 'request', body);
      sendJson(res, 501, NOT_IMPLEMENTED_BODY);
    },
  },
  {
    method: 'POST',
    pattern: /^\/account-holds\/(?<holdId>[^/]+)\/confirm$/,
    requiresAuth: true,
    handler: async (req, res, ctx) => {
      const body = await readJsonBody(req);
      logAttempt(ctx.db, 'confirm', { ...(body as object), holdId: ctx.params.holdId });
      sendJson(res, 501, NOT_IMPLEMENTED_BODY);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/account-holds\/(?<holdId>[^/]+)$/,
    requiresAuth: true,
    handler: (_req, res, ctx) => {
      logAttempt(ctx.db, 'release', { holdId: ctx.params.holdId });
      sendJson(res, 501, NOT_IMPLEMENTED_BODY);
    },
  },
];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/src/routes/account-holds.ts demo-backend/test/routes/account-holds.test.ts
git commit -m "feat(demo-backend): account-holds responde 501 y loguea los intentos"
```

---

## Task 8: `POST /_demo/reset`

**Files:**
- Create: `demo-backend/src/routes/demo-reset.ts`
- Test: `demo-backend/test/routes/demo-reset.test.ts`

**Interfaces:**
- Consumes: `RouteDef`, `registerRoutes`, `resetToSeed` (Task 2).
- Produces: `demoResetRoute: RouteDef[]`.

- [ ] **Step 1: Escribir el test (falla — el módulo no existe)**

`demo-backend/test/routes/demo-reset.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { demoResetRoute } from '../../src/routes/demo-reset.ts';
import { seedIfEmpty } from '../../src/seed.ts';

beforeAll(() => {
  registerRoutes(demoResetRoute);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, '2026-01-01T00:00:00.000Z');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('POST /_demo/reset', () => {
  it('no exige Authorization (tooling de desarrollo, no parte del contrato)', async () => {
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      '{}',
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/reset`, { method: 'POST' });

    expect(response.status).toBe(200);
    const salesCount = (
      db.prepare('SELECT COUNT(*) as count FROM sales').get() as { count: number }
    ).count;
    expect(salesCount).toBe(0);
    const productCount = (
      db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }
    ).count;
    expect(productCount).toBe(24);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `routes/demo-reset.ts`**

```ts
import { sendJson } from '../http-helpers.ts';
import { resetToSeed } from '../seed.ts';
import type { RouteDef } from '../router.ts';

export const demoResetRoute: RouteDef[] = [
  {
    method: 'POST',
    pattern: /^\/_demo\/reset$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      resetToSeed(ctx.db, new Date().toISOString());
      sendJson(res, 200, { reset: true });
    },
  },
];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add demo-backend/src/routes/demo-reset.ts demo-backend/test/routes/demo-reset.test.ts
git commit -m "feat(demo-backend): POST /_demo/reset"
```

---

## Task 9: Panel web de solo lectura

**Files:**
- Create: `demo-backend/src/panel.html`
- Create: `demo-backend/src/routes/panel.ts`
- Test: `demo-backend/test/routes/panel.test.ts`

**Interfaces:**
- Consumes: `RouteDef`, `registerRoutes`.
- Produces: `panelRoutes: RouteDef[]`.

- [ ] **Step 1: Escribir el HTML del panel**

`demo-backend/src/panel.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Minibackend de demo — offline-pos</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
      h1 { font-size: 1.25rem; }
      section { margin-bottom: 2rem; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
      button { padding: 0.5rem 1rem; cursor: pointer; }
      #reset-status { margin-left: 1rem; color: #555; }
    </style>
  </head>
  <body>
    <h1>Minibackend de demo — offline-pos</h1>
    <button id="reset-btn">Reset demo</button>
    <span id="reset-status"></span>

    <section>
      <h2>Ventas sincronizadas</h2>
      <table id="sales-table"><thead><tr><th>id</th><th>total</th><th>status</th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Turnos de caja cerrados</h2>
      <table id="cash-sessions-table"><thead><tr><th>id</th><th>openingAmount</th><th>closingAmount</th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Clientes creados desde el POS</h2>
      <table id="customers-table"><thead><tr><th>id</th><th>name</th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Intentos de cuenta corriente (siempre 501)</h2>
      <table id="account-holds-table"><thead><tr><th>kind</th><th>createdAt</th></tr></thead><tbody></tbody></table>
    </section>

    <script>
      async function loadTable(url, tbodyId, rowFn) {
        const response = await fetch(url);
        const rows = await response.json();
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = rows.map(rowFn).join('');
      }

      function refresh() {
        loadTable('/_demo/api/sales', 'sales-table', (s) => `<tr><td>${s.id}</td><td>${s.total}</td><td>${s.status}</td></tr>`);
        loadTable('/_demo/api/cash-sessions', 'cash-sessions-table', (c) => `<tr><td>${c.id}</td><td>${c.openingAmount}</td><td>${c.closingAmount ?? ''}</td></tr>`);
        loadTable('/_demo/api/customers', 'customers-table', (c) => `<tr><td>${c.id}</td><td>${c.name}</td></tr>`);
        loadTable('/_demo/api/account-holds', 'account-holds-table', (h) => `<tr><td>${h.kind}</td><td>${h.createdAt}</td></tr>`);
      }

      document.getElementById('reset-btn').addEventListener('click', async () => {
        const status = document.getElementById('reset-status');
        status.textContent = 'Reiniciando...';
        await fetch('/_demo/reset', { method: 'POST' });
        status.textContent = 'Listo.';
        refresh();
      });

      refresh();
    </script>
  </body>
</html>
```

- [ ] **Step 2: Escribir el test de las rutas del panel (falla — el módulo no existe)**

`demo-backend/test/routes/panel.test.ts`:
```ts
import type { Server } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { openDb } from '../../src/db.ts';
import { registerRoutes } from '../../src/router.ts';
import { panelRoutes } from '../../src/routes/panel.ts';

beforeAll(() => {
  registerRoutes(panelRoutes);
});

let server: Server;
let baseUrl: string;
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No se pudo obtener el puerto del servidor de test');
  }
  baseUrl = `http://localhost:${String(address.port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('GET /_demo', () => {
  it('sirve el HTML del panel sin exigir Authorization', async () => {
    const response = await fetch(`${baseUrl}/_demo`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Minibackend de demo');
  });
});

describe('GET /_demo/api/sales', () => {
  it('trae las ventas guardadas, sin exigir Authorization', async () => {
    db.prepare('INSERT INTO sales (id, payload, created_at) VALUES (?, ?, ?)').run(
      's1',
      JSON.stringify({ id: 's1', total: 1200, status: 'closed' }),
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/sales`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; total: number }[];
    expect(body).toEqual([{ id: 's1', total: 1200, status: 'closed' }]);
  });
});

describe('GET /_demo/api/customers', () => {
  it('trae solo los clientes con source pos, no los sembrados', async () => {
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'seed-1',
      JSON.stringify({ id: 'seed-1', name: 'Sembrado' }),
      'seed',
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare('INSERT INTO customers (id, payload, source, updated_at) VALUES (?, ?, ?, ?)').run(
      'pos-1',
      JSON.stringify({ id: 'pos-1', name: 'Del POS' }),
      'pos',
      '2026-01-01T00:00:00.000Z',
    );

    const response = await fetch(`${baseUrl}/_demo/api/customers`);
    const body = (await response.json()) as { id: string; name: string }[];
    expect(body).toEqual([{ id: 'pos-1', name: 'Del POS' }]);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `pnpm --filter demo-backend run test`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Implementar `routes/panel.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { sendJson } from '../http-helpers.ts';
import type { RouteDef } from '../router.ts';

const panelHtmlPath = fileURLToPath(new URL('../panel.html', import.meta.url));
const panelHtml = readFileSync(panelHtmlPath, 'utf-8');

function listPayloads(db: DatabaseSync, sql: string): unknown[] {
  const rows = db.prepare(sql).all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as unknown);
}

export const panelRoutes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^\/_demo$/,
    requiresAuth: false,
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(panelHtml);
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/sales$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(res, 200, listPayloads(ctx.db, 'SELECT payload FROM sales ORDER BY created_at DESC'));
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/cash-sessions$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(
        res,
        200,
        listPayloads(ctx.db, 'SELECT payload FROM cash_sessions ORDER BY created_at DESC'),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/customers$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      sendJson(
        res,
        200,
        listPayloads(
          ctx.db,
          "SELECT payload FROM customers WHERE source = 'pos' ORDER BY updated_at DESC",
        ),
      );
    },
  },
  {
    method: 'GET',
    pattern: /^\/_demo\/api\/account-holds$/,
    requiresAuth: false,
    handler: (_req, res, ctx) => {
      const rows = ctx.db
        .prepare(
          'SELECT kind, payload, created_at FROM account_hold_attempts ORDER BY created_at DESC',
        )
        .all() as { kind: string; payload: string; created_at: string }[];
      sendJson(
        res,
        200,
        rows.map((row) => ({
          kind: row.kind,
          payload: JSON.parse(row.payload) as unknown,
          createdAt: row.created_at,
        })),
      );
    },
  },
];
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm --filter demo-backend run test`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter demo-backend run typecheck`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add demo-backend/src/panel.html demo-backend/src/routes/panel.ts demo-backend/test/routes/panel.test.ts
git commit -m "feat(demo-backend): panel web de solo lectura"
```

---

## Task 10: `server.ts` — cablear todo, correr `pnpm dev` de verdad

**Files:**
- Create: `demo-backend/src/server.ts`

**Interfaces:**
- Consumes: todos los `*Routes` de Tasks 4-9, `openDb`, `seedIfEmpty`, `registerRoutes`, `createApp`.

- [ ] **Step 1: Implementar `server.ts`**

```ts
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
```

- [ ] **Step 2: Levantar el servidor real y probarlo a mano**

Run: `pnpm --filter demo-backend run start` (en background, o en una terminal aparte)
Run: `curl -s http://localhost:4000/_demo` — Expected: HTML del panel.
Run: `curl -s -H "Authorization: Bearer x" http://localhost:4000/products | head -c 200` — Expected: JSON con `items` y 24 productos.
Detener el servidor (Ctrl+C o matar el proceso).

- [ ] **Step 3: Levantar todo el monorepo con `pnpm dev` y confirmar que ambos procesos arrancan**

Run: `pnpm dev` (background, revisar el output)
Expected: log de Vite (`Local: http://localhost:5173`) y el log del minibackend (`Minibackend de demo escuchando en http://localhost:4000`) — ambos en la misma consola, sin que uno bloquee al otro.
Detener (`Ctrl+C`).

- [ ] **Step 4: Typecheck y lint del paquete completo**

Run: `pnpm --filter demo-backend run typecheck`
Run: `pnpm lint` (desde la raíz — cubre `demo-backend/` también, ver Global Constraints)
Expected: sin errores en ninguno de los dos.

- [ ] **Step 5: Commit**

```bash
git add demo-backend/src/server.ts
git commit -m "feat(demo-backend): cablear server.ts — pnpm dev levanta POS + minibackend"
```

---

## Task 11: El POS deja de sembrar datos localmente al arrancar

**Files:**
- Modify: `src/ui/bootstrap.ts`
- Test: `src/ui/bootstrap.test.ts` (nuevo)

**Interfaces:**
- Consumes: nada nuevo — `bootstrap()` (`src/ui/bootstrap.ts`) mantiene su firma `(): Promise<void>`.

- [ ] **Step 1: Escribir el test (falla — hoy `bootstrap()` sí siembra)**

`src/ui/bootstrap.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../storage/db.ts';
import { bootstrap } from './bootstrap.ts';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
});

describe('bootstrap', () => {
  it('no siembra catálogo ni clientes localmente — una terminal nueva arranca vacía hasta el primer sync', async () => {
    await bootstrap();

    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.customers.count()).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- bootstrap.test.ts`
Expected: FAIL — `db.products.count()` resuelve > 0 (bootstrap todavía siembra).

- [ ] **Step 3: Sacar el seed de `bootstrap.ts`**

Modify `src/ui/bootstrap.ts` — reemplazar todo el archivo:
```ts
import { loadCatalogRepository } from '../storage/catalog-repository.ts';
import { loadCustomerRepository } from '../storage/customer-repository.ts';
import { loadDraftCart } from '../storage/draft-cart-repository.ts';
import { startSyncEngine } from '../sync/engine.ts';
import { cartSignal } from './state/cart.ts';
import { setCatalogRepository } from './state/catalog.ts';
import { attachedCustomerSignal } from './state/customer.ts';
import { setCustomerRepository } from './state/customer-repository.ts';
import { startCartPersistence } from './state/persist-cart.ts';

/**
 * Arma los repositorios antes del primer render y arranca el motor de sync.
 * Se llama una sola vez desde `main.tsx`. Ya no siembra catálogo/clientes
 * localmente (Fase 7): esos datos ahora vienen del minibackend de demo (o de
 * cualquier backend real) vía pull — una terminal recién instalada, sin
 * `/CONFIG` configurado todavía, arranca vacía hasta el primer sync. Los
 * fixtures y `seedCatalogIfEmpty`/`seedCustomersIfEmpty`
 * (`storage/seed-catalog.ts`, `storage/seed-customers.ts`) se mantienen —
 * los siguen usando los tests y `e2e/offline-sale.spec.ts`/
 * `e2e/account-sale.spec.ts`, que a propósito prueban el flujo 100% offline
 * sin ningún backend.
 */
export async function bootstrap(): Promise<void> {
  const catalogRepository = await loadCatalogRepository();
  setCatalogRepository(catalogRepository);
  setCustomerRepository(await loadCustomerRepository());

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

  startSyncEngine();
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Correr toda la suite del POS (por si algún otro test asumía datos ya sembrados)**

Run: `pnpm test`
Expected: PASS. Si algún test de otro archivo fallaba por asumir catálogo/clientes ya poblados al montar la app (por ejemplo, algún test de `App`/`SaleScreen` que espera ver un producto sin sembrarlo explícitamente), agregar ahí el seed explícito que le faltaba (via `seedCatalogIfEmpty`/`seedCustomersIfEmpty` en su propio `beforeEach`) — no revertir este cambio.

- [ ] **Step 6: Typecheck y lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/ui/bootstrap.ts src/ui/bootstrap.test.ts
git commit -m "feat: el POS deja de sembrar catálogo/clientes localmente al arrancar"
```

---

## Task 12: `/CONFIG` precarga la URL del minibackend de demo

**Files:**
- Modify: `src/ui/state/sync-config.ts`
- Modify: `src/ui/keyboard/config-controller.test.ts`

**Interfaces:**
- Sin cambios de firma — `resetConfigFlow(): void` sigue igual, solo cambia el valor inicial de `configBufferSignal`.

- [ ] **Step 1: Escribir el test (falla — hoy `configBufferSignal` arranca vacío)**

Modify `src/ui/keyboard/config-controller.test.ts` — agregar un `it` dentro de `describe('enterConfigScreen', ...)`:
```ts
describe('enterConfigScreen', () => {
  it('cambia a la pantalla config y arranca en el paso baseUrl', () => {
    expect(activeScreenSignal.value).toBe('config');
    expect(configStepSignal.value).toBe('baseUrl');
  });

  it('precarga la URL del minibackend de demo como default editable', () => {
    expect(configBufferSignal.value).toBe('http://localhost:4000');
  });
});
```
(agregar `configBufferSignal` al import ya existente de `'../state/sync-config.ts'`, junto a `configErrorSignal`/`configStepSignal`.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- config-controller.test.ts`
Expected: FAIL — `configBufferSignal.value` es `''`.

- [ ] **Step 3: Precargar el default en `resetConfigFlow`**

Modify `src/ui/state/sync-config.ts`:
```ts
import { signal } from '@preact/signals';

export type ConfigStep = 'baseUrl' | 'apiKey' | 'locale';

/** URL default del minibackend de demo (Fase 7) — precargada en el primer paso de /CONFIG, sigue siendo editable. */
const DEFAULT_BASE_URL = 'http://localhost:4000';

export const configStepSignal = signal<ConfigStep>('baseUrl');
/** `baseUrl` ya confirmado (paso 1), mientras se tipea el `apiKey` opcional (paso 2). */
export const configBaseUrlSignal = signal('');
/** `apiKey` ya confirmado (paso 2, vacío = sin apiKey), mientras se tipea el `locale` opcional (paso 3). */
export const configApiKeySignal = signal('');
export const configBufferSignal = signal(DEFAULT_BASE_URL);
export const configErrorSignal = signal<string | null>(null);

export function resetConfigFlow(): void {
  configStepSignal.value = 'baseUrl';
  configBaseUrlSignal.value = '';
  configApiKeySignal.value = '';
  configBufferSignal.value = DEFAULT_BASE_URL;
  configErrorSignal.value = null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- config-controller.test.ts`
Expected: PASS (todos los tests del archivo — los que sobrescriben `configBufferSignal.value` explícitamente antes de cada `submitConfigStep()` no se ven afectados por el nuevo default).

- [ ] **Step 5: Typecheck y lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/ui/state/sync-config.ts src/ui/keyboard/config-controller.test.ts
git commit -m "feat: /CONFIG precarga la URL del minibackend de demo (localhost:4000)"
```

---

## Task 13: `resetDemoBackend` — llamar a `POST /_demo/reset` desde el POS

**Files:**
- Modify: `src/domain/result.ts` (nuevo `ErrorCode`)
- Modify: `src/ui/errors.ts` (nuevo caso del `switch`)
- Create: `src/sync/demo-backend-reset.ts`
- Test: `src/sync/demo-backend-reset.test.ts`

**Interfaces:**
- Produces: `resetDemoBackend(baseUrl: string): Promise<Result<void>>` (`src/sync/demo-backend-reset.ts`) — usado por Task 14.

- [ ] **Step 1: Agregar el `ErrorCode` nuevo**

Modify `src/domain/result.ts` — agregar, justo después de `'demo/reset-failed': { message: string };`:
```ts
  // storage/demo-reset.ts
  'demo/reset-failed': { message: string };
  'demo/backend-reset-failed': { message: string };
};
```

- [ ] **Step 2: Traducir el error nuevo**

Modify `src/ui/errors.ts` — agregar, junto al `case 'demo/reset-failed':` existente:
```ts
    case 'demo/reset-failed':
      return `No se pudo reiniciar la demo (${failure.meta.message}).`;
    case 'demo/backend-reset-failed':
      return `No se pudo reiniciar el minibackend de demo (${failure.meta.message}).`;
```

- [ ] **Step 3: Escribir el test de `resetDemoBackend` (falla — el módulo no existe)**

`src/sync/demo-backend-reset.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDemoBackend } from './demo-backend-reset.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resetDemoBackend', () => {
  it('hace POST a <baseUrl>/_demo/reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resetDemoBackend('http://localhost:4000');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/_demo/reset', {
      method: 'POST',
    });
  });

  it('devuelve error si la respuesta no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await resetDemoBackend('http://localhost:4000');

    expect(result).toEqual({
      ok: false,
      error: 'demo/backend-reset-failed',
      meta: { message: 'El backend respondió 500' },
    });
  });

  it('devuelve error si fetch lanza (backend no disponible)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await resetDemoBackend('http://localhost:4000');

    expect(result).toEqual({
      ok: false,
      error: 'demo/backend-reset-failed',
      meta: { message: 'ECONNREFUSED' },
    });
  });
});
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `pnpm test -- demo-backend-reset.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 5: Implementar `demo-backend-reset.ts`**

`src/sync/demo-backend-reset.ts`:
```ts
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
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `pnpm test -- demo-backend-reset.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck y lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/domain/result.ts src/ui/errors.ts src/sync/demo-backend-reset.ts src/sync/demo-backend-reset.test.ts
git commit -m "feat: resetDemoBackend — POST /_demo/reset contra el minibackend"
```

---

## Task 14: `/DEMO_RESET` orquesta reset remoto + borrado local + resync

**Files:**
- Modify: `src/storage/demo-reset.ts`
- Modify: `src/storage/demo-reset.test.ts`

**Interfaces:**
- Consumes: `resetDemoBackend` (Task 13), `loadSyncConfig` (`sync/config.ts`, ya existente), `runSyncCycle` (`sync/engine.ts`, ya existente).
- `demoReset(): Promise<Result<void>>` mantiene su firma — cambia su implementación.

- [ ] **Step 1: Reescribir el test de `demoReset`**

Reemplazar todo `src/storage/demo-reset.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCustomersCursor,
  getProductsCursor,
  setCustomersCursor,
  setProductsCursor,
} from '../sync/cursor.ts';
import { loadSyncConfig, saveSyncConfig } from '../sync/config.ts';
import { openCashSessionAndPersist } from './cash-session-repository.ts';
import { createCustomerLocally } from './customer-repository.ts';
import { db } from './db.ts';
import { demoReset } from './demo-reset.ts';

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'status text',
    json: () => Promise.resolve(body),
  } as Response;
}

/** Ruteador mínimo para el fetch mock — alcanza para lo que `demoReset` dispara (reset + un ciclo de sync). */
function fetchRouter(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return vi.fn((url: string) => {
    const path = new URL(url).pathname;
    if (path in overrides) {
      return Promise.resolve(overrides[path]());
    }
    if (path === '/products' || path === '/customers') {
      return Promise.resolve(jsonResponse({ items: [] }));
    }
    if (path === '/stock') {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

beforeEach(async () => {
  await db.open();
  setOnline(true);
});

afterEach(async () => {
  db.close();
  await db.delete();
  localStorage.clear();
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('demoReset', () => {
  it('sin /CONFIG: borra todo lo local y no re-siembra (queda vacía)', async () => {
    const created = await createCustomerLocally('Cliente de prueba');
    if (!created.ok) throw new Error('setup falló');
    await openCashSessionAndPersist({ openingAmount: 100 });

    const result = await demoReset();

    expect(result.ok).toBe(true);
    await expect(db.customers.get(created.value.id)).resolves.toBeUndefined();
    await expect(db.cashSessions.count()).resolves.toBe(0);
    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.customers.count()).resolves.toBe(0);
  });

  it('con /CONFIG: llama primero a POST /_demo/reset del backend antes de borrar nada local', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000' });
    const fetchMock = fetchRouter();
    vi.stubGlobal('fetch', fetchMock);

    await demoReset();

    const resetCall = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/_demo/reset');
    expect(resetCall).not.toBeUndefined();
    expect(resetCall?.[1]).toMatchObject({ method: 'POST' });
  });

  it('si POST /_demo/reset falla, no borra nada local y devuelve el error', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000' });
    const created = await createCustomerLocally('Cliente de prueba');
    if (!created.ok) throw new Error('setup falló');
    vi.stubGlobal(
      'fetch',
      fetchRouter({ '/_demo/reset': () => jsonResponse({}, { ok: false, status: 500 }) }),
    );

    const result = await demoReset();

    expect(result.ok).toBe(false);
    await expect(db.customers.get(created.value.id)).resolves.not.toBeUndefined();
  });

  it('con /CONFIG: dispara un resync después de borrar, repoblando desde el backend', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000' });
    vi.stubGlobal(
      'fetch',
      fetchRouter({
        '/products': () =>
          jsonResponse({
            items: [
              {
                id: 'p1',
                sku: 'SKU-1',
                barcodes: [],
                name: 'Producto Demo',
                price: 100,
                taxRate: 0.21,
                category: 'test',
                tracksStock: true,
              },
            ],
          }),
      }),
    );

    const result = await demoReset();

    expect(result.ok).toBe(true);
    await expect(db.products.count()).resolves.toBe(1);
  });

  it('limpia los cursores de pull para que el próximo pull traiga todo, no solo deltas', async () => {
    setProductsCursor('cursor-productos-viejo');
    setCustomersCursor('cursor-clientes-viejo');

    await demoReset();

    expect(getProductsCursor()).toBeUndefined();
    expect(getCustomersCursor()).toBeUndefined();
  });

  it('no toca la configuración de /CONFIG (URL, API key, locale)', async () => {
    saveSyncConfig({ baseUrl: 'http://localhost:4000', apiKey: 'clave-1', locale: 'es-AR' });
    vi.stubGlobal('fetch', fetchRouter());

    await demoReset();

    expect(loadSyncConfig()).toEqual({
      ok: true,
      value: { baseUrl: 'http://localhost:4000', apiKey: 'clave-1', locale: 'es-AR' },
    });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- demo-reset.test.ts`
Expected: FAIL — `demoReset()` todavía re-siembra localmente en vez de llamar al backend.

- [ ] **Step 3: Reescribir `demo-reset.ts`**

Reemplazar todo `src/storage/demo-reset.ts`:
```ts
import { err, ok, type Result } from '../domain/result.ts';
import { loadSyncConfig } from '../sync/config.ts';
import { clearSyncCursors } from '../sync/cursor.ts';
import { resetDemoBackend } from '../sync/demo-backend-reset.ts';
import { runSyncCycle } from '../sync/engine.ts';
import { db } from './db.ts';

/**
 * `/DEMO_RESET` (Ciclo 8, retomado en Fase 7 — issue #36): vuelve la
 * terminal a un estado limpio para reiniciar una demo. Desde que los datos
 * de demo viven en el minibackend (no en un fixture local, ver
 * `docs/superpowers/specs/2026-09-15-fase-7-minibackend-demo-design.md`),
 * el orden importa:
 *
 * 1. Si hay `/CONFIG` configurado, primero `POST /_demo/reset` contra el
 *    backend — si falla (backend no disponible), se corta acá, sin tocar
 *    nada local: dejar la terminal vacía sin poder repoblarla sería peor
 *    que no resetear nada.
 * 2. Borra todo lo local (catálogo, stock, clientes, cuentas, ventas,
 *    movimientos, turnos de caja, la venta en curso y el outbox pendiente).
 * 3. Limpia los cursores de pull (si no, el resync del paso 4 solo traería
 *    deltas desde el cursor viejo).
 * 4. Si había `/CONFIG`, dispara un resync completo (`runSyncCycle`) para
 *    repoblar desde el backend ya reseteado — reusa el motor de sync
 *    existente en vez de duplicar su lógica de pull.
 *
 * Sin `/CONFIG`, se saltan los pasos 1 y 4: la terminal queda vacía (mismo
 * criterio que `bootstrap.ts`, que tampoco siembra nada localmente).
 *
 * A propósito NO toca la configuración de `/CONFIG` (URL, API key, locale)
 * — es la conexión de esta terminal, no un dato de demo.
 */
export async function demoReset(): Promise<Result<void>> {
  const configResult = loadSyncConfig();

  if (configResult.ok) {
    const backendReset = await resetDemoBackend(configResult.value.baseUrl);
    if (!backendReset.ok) {
      return backendReset;
    }
  }

  try {
    await db.transaction(
      'rw',
      [
        db.products,
        db.stock,
        db.sales,
        db.stockMovements,
        db.outbox,
        db.customers,
        db.customerAccounts,
        db.accountMovements,
        db.draftCart,
        db.cashSessions,
      ],
      async () => {
        await Promise.all([
          db.products.clear(),
          db.stock.clear(),
          db.sales.clear(),
          db.stockMovements.clear(),
          db.outbox.clear(),
          db.customers.clear(),
          db.customerAccounts.clear(),
          db.accountMovements.clear(),
          db.draftCart.clear(),
          db.cashSessions.clear(),
        ]);
      },
    );
  } catch (error) {
    return err('demo/reset-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  clearSyncCursors();

  if (configResult.ok) {
    await runSyncCycle();
  }

  return ok(undefined);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- demo-reset.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Correr toda la suite del POS**

Run: `pnpm test`
Expected: PASS — en particular `src/ui/keyboard/demo-reset-controller.test.ts` (no debería verse afectado: sigue llamando `demoReset()` con la misma firma).

- [ ] **Step 6: Typecheck y lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/storage/demo-reset.ts src/storage/demo-reset.test.ts
git commit -m "feat: /DEMO_RESET orquesta reset del backend + borrado local + resync"
```

---

## Task 15: e2e real contra el minibackend + CI

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/minibackend-sync.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `openCashSession` (`e2e/helpers.ts`, ya existente).

- [ ] **Step 1: Playwright levanta también el minibackend**

Modify `playwright.config.ts` — reemplazar la clave `webServer`:
```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  // Solo Chromium — es el navegador de referencia del proyecto (ver CLAUDE.md).
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `pnpm build && pnpm preview --port ${String(PORT)}`,
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Minibackend de demo (Fase 7) — solo lo necesita
      // e2e/minibackend-sync.spec.ts, pero levantarlo para toda la suite es
      // más simple que filtrar por spec, y no interfiere con el resto (esos
      // specs nunca configuran /CONFIG).
      command: 'pnpm --filter demo-backend run start',
      url: 'http://localhost:4000/_demo',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
```

- [ ] **Step 2: Escribir el e2e nuevo**

`e2e/minibackend-sync.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { openCashSession } from './helpers.ts';

const BACKEND_URL = 'http://localhost:4000';

test('vender con el minibackend real configurado: la venta llega al backend', async ({ page }) => {
  await page.goto('/');
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();

  // Con el catálogo todavía vacío (Fase 7: ya no hay seed local), configurar
  // el minibackend y forzar un sync es requisito antes de poder vender.
  await commandBar.fill('/CONFIG');
  await commandBar.press('Enter');
  await expect(page.getByRole('heading', { name: 'Configurar conexión' })).toBeVisible();

  const urlInput = page.getByLabel(/URL del sistema externo/);
  await expect(urlInput).toHaveValue(BACKEND_URL);
  await urlInput.press('Enter');
  await page.getByLabel(/API key/).press('Enter');
  await page.getByLabel(/Locale/).press('Enter');
  await expect(commandBar).toBeVisible();

  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');

  await openCashSession(page, 500);

  await commandBar.fill('arroz');
  await expect(page.getByText('Arroz 1kg')).toBeVisible();
  await commandBar.press('Enter');
  await expect(commandBar).toHaveValue('');

  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  const amountInput = page.getByLabel('Monto a cobrar');
  await amountInput.fill('1200');
  await amountInput.press('Enter');
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${BACKEND_URL}/_demo/api/sales`);
        const sales = (await response.json()) as { total: number }[];
        return sales.some((sale) => sale.total === 1200);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
```

- [ ] **Step 3: Correr el e2e nuevo (localmente, requiere red al build/preview real)**

Run: `pnpm test:e2e -- minibackend-sync.spec.ts`
Expected: PASS. Si el catálogo no llega a tiempo tras `/SINCRONIZAR` (carrera con el ciclo de sync), el `expect(page.getByText('Arroz 1kg')).toBeVisible()` ya reintenta con el timeout default de Playwright — no debería hacer falta un `waitForTimeout` manual. Si igual falla por timing, aumentar el timeout de esa aserción puntual (`{ timeout: 10_000 }`) en vez de agregar un sleep fijo.

- [ ] **Step 4: Correr toda la suite e2e para confirmar que no rompió nada existente**

Run: `pnpm test:e2e`
Expected: PASS — en particular `e2e/offline-sale.spec.ts`/`e2e/account-sale.spec.ts`, que siguen sin configurar `/CONFIG` y dependen de `seedCatalogIfEmpty`/`seedCustomersIfEmpty` corridos explícitamente por sus propios setups (revisar si esos specs llamaban al seed vía la app al cargar — si asumían que `bootstrap()` sembraba solo, hay que sembrar ahí a mano con los mismos helpers de `storage/seed-catalog.ts`/`seed-customers.ts` que Task 11 dejó intactos, del mismo modo que ya lo resuelve `openCashSession` para el turno de caja).

- [ ] **Step 5: CI — typecheck/test del minibackend como pasos propios**

Modify `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      - run: pnpm --filter demo-backend run typecheck

      - run: pnpm test

      - run: pnpm --filter demo-backend run test

      - run: pnpm build

      - run: pnpm exec playwright install --with-deps chromium

      - run: pnpm test:e2e
```

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e/minibackend-sync.spec.ts .github/workflows/ci.yml
git commit -m "test: e2e real contra el minibackend de demo + CI"
```

---

## Verificación final (manual, en el navegador)

Después de completar las 15 tareas:

1. `pnpm dev` desde la raíz — confirmar que Vite y el minibackend arrancan juntos.
2. Abrir `http://localhost:5173` — la pantalla de venta debería verse vacía (sin productos, "Consumidor Final" como único cliente disponible) hasta configurar `/CONFIG`.
3. `/CONFIG`, confirmar que la URL ya viene precargada con `http://localhost:4000`, completar los tres pasos.
4. `/SINCRONIZAR` — confirmar que el catálogo y los clientes aparecen.
5. Abrir `http://localhost:4000/_demo` en otra pestaña — panel vacío (sin ventas/turnos todavía).
6. En el POS: `/CAJA` (abrir turno), vender algo, `/COBRAR`, cerrar el turno con `/CAJA` de nuevo.
7. Refrescar el panel (`http://localhost:4000/_demo`) — la venta y el turno cerrado deberían aparecer en sus tablas.
8. En el POS: `/DEMO_RESET`, confirmar con Enter — el panel debería volver a mostrarse vacío, y el POS debería quedar con el catálogo repoblado (buscar "arroz" debería volver a encontrar el producto).
9. Botón "Reset demo" del panel — confirmar que también funciona standalone (sin pasar por el POS).
