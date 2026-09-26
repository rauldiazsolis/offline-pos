---
description: Reglas operativas, protocolo de interacción de alto nivel y arquitectura para mini-erp
globs: mini-erp/**/*
---

# Reglas y Protocolo de Desarrollo para `mini-erp`

Este documento rige de forma permanente todas las interacciones, planificación y desarrollo sobre el subdirectorio `mini-erp/`.

---

## 1. Protocolo de Interacción: Requerimientos de Alto Nivel & Brainstorming

1. **Requerimientos de Alto Nivel**:
   - El usuario expresará sus necesidades en lenguaje natural y a nivel conceptual (ej. *"Quiero implementar modo claro, modo oscuro y heredado"* o *"Necesitamos un descuento masivo por categoría"*).
   - El agente **asume automáticamente todas las reglas técnicas, de estilo y de arquitectura** sin necesidad de que el usuario las repita en el prompt.

2. **Fase Obligatoria de Brainstorming & Diseño (Antes de Codificar)**:
   - Ante cualquier nuevo pedido o cambio funcional/visual, el agente **NUNCA comienza a editar código directamente**.
   - El agente debe responder abriendo un espacio de **Brainstorming y Planificación**:
     1. Desglosar las opciones de diseño, UX y flujos de usuario.
     2. Analizar el impacto arquitectónico (stores/signals, componentes Preact, endpoints Express, contenedor IoC, schemas SQLite).
     3. Presentar un plan de etapas atómicas y verificables.
     4. Esperar la validación y feedback del usuario antes de proceder a la ejecución.

3. **Mantenimiento del Documento Maestro**:
   - El archivo `mini-erp/AGENTS.md` es la **Única Fuente de Verdad (Single Source of Truth)**.
   - Ante cualquier decisión arquitectónica nueva o cambio de convención, el agente debe actualizar `mini-erp/AGENTS.md` y/o `mini-erp/PLAN.md` para que persista en el tiempo.

---

## 2. Invariantes Técnicas y de Arquitectura (No Negociables)

- **Límite Territorial Estricto**: Toda modificación de código debe residir exclusivamente dentro de `mini-erp/`. Está prohibido alterar archivos en `src/`, `demo-backend/` o la raíz (solo lectura de tipos y modelos).
- **TypeScript Ultra-Estricto & Node 22 (Strip-only mode)**:
  - `any` **estrictamente prohibido**. `unknown` permitido solo en fronteras externas e inmediatamente validado con Zod.
  - **Prohibidos los "parameter properties" en constructores**: `constructor(private db: DatabaseSync)` falla en Node 22 strip-types. Declarar siempre las propiedades explícitamente en el cuerpo de la clase:
    ```typescript
    class MiServicio {
      private db: DatabaseSync;
      constructor(db: DatabaseSync) {
        this.db = db;
      }
    }
    ```
  - **Imports relativos con extensión obligatoria**: `.ts` para módulos TypeScript y `.tsx` para componentes Preact.
- **Frontend Admin (`src/client/`)**:
  - Stack: Preact + `@preact/signals` + Tailwind CSS v4.
  - **Arquitectura de Estado**: Exclusivamente Signals (`signal`, `computed`, stores en `src/client/state/*`). **Terminantemente prohibido el uso de React hooks (`useState`, `useEffect`, etc.)**.
- **Backend Multitenant (`src/server/`)**:
  - Motor DB-per-tenant con `node:sqlite` nativo (`DatabaseSync`).
  - Inversión de Control con **Hardwired 1.6.2**: resolución de servicios scopeados por request mediante `req.tenantScope.use(...)`. Prohibido instanciar servicios de tenant a mano con `new Service()`.
  - Contrato Connector API v4.0.0 riguroso (`connector-api.openapi.yaml`). El backend nunca rechaza síncronamente el contenido de un lote de push (ack 200).
- **Testing y Verificación Continua**:
  - Todo cambio debe acompañarse de tests con Vitest en `mini-erp/test/`.
  - Verificación obligatoria: `pnpm typecheck` (0 errores) y `pnpm test` (100% verde).
  - Si se modifica el frontend, validar con `pnpm run build`.
- **Política de Git**:
  - **El agente NUNCA ejecuta `git commit` ni `git push`**.
  - Al completar una etapa verificada, el agente sugiere el comando atómico (`git add ... && git commit -m "..."`).
