/**
 * Un campo de configuración de un conector, en el orden en que `/CONFIG` lo
 * muestra (Etapa 2, #68). Cada conector exporta su propia lista
 * (`connectors/<tipo>/config.ts`); la pantalla no sabe qué campos existen,
 * solo renderiza los del tipo elegido. `optional` lo lee la UI para marcar el
 * campo y tiene que coincidir con el schema Zod del conector (lo verifica un
 * test en `sync/connector-registry.test.ts`).
 */
export type ConfigField<K extends string = string> = {
  key: K;
  label: string;
  optional: boolean;
};
