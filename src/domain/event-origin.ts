/**
 * Sucursal y punto de venta estampados en cada evento del outbox al encolarlo
 * (contrato v3, #96). Se guardan con el evento y nunca se releen de la config
 * al armar un lote: cambiar la sucursal con eventos pendientes no los reescribe.
 * Opcionales hasta la Etapa 2 (#97), que los vuelve obligatorios en /CONFIG.
 */
export type EventOrigin = { branch?: string; pointOfSale?: string };

export function buildEventOrigin(params: {
  branch?: string | undefined;
  pointOfSale?: string | undefined;
}): EventOrigin {
  const branch = params.branch?.trim() ?? '';
  const pointOfSale = params.pointOfSale?.trim() ?? '';
  return {
    ...(branch !== '' ? { branch } : {}),
    ...(pointOfSale !== '' ? { pointOfSale } : {}),
  };
}
