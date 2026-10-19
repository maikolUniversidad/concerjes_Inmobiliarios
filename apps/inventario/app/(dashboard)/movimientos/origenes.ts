/**
 * De dónde viene una entrada. No toda entrada es una compra: también entra lo
 * que vuelve de producción, del reembasado o de otra área. Solo COMPRA exige
 * orden de compra, y eso lo verifica además la restricción
 * `movimientos_compra_exige_oc` en la base.
 *
 * Vive aparte de `actions.ts` a propósito: un archivo 'use server' solo puede
 * exportar funciones async. Exportar este arreglo desde allí tumbaba en
 * producción todas las acciones de movimientos ("This page couldn't load").
 */
export const ORIGENES_ENTRADA = [
  'COMPRA', 'PRODUCCION', 'REEMBASADO', 'TRASLADO_INTERNO', 'DEVOLUCION_SEDE', 'AJUSTE', 'OTRO',
] as const
export type OrigenMovimiento = (typeof ORIGENES_ENTRADA)[number]
