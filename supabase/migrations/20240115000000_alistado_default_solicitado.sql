-- =============================================================================
-- Órdenes de insumo — el alistamiento arranca con la cantidad solicitada
--
-- Regla de negocio: al alistar, cada ítem parte con la cantidad que se pidió;
-- si en bodega hay menos, el bodeguero la baja manualmente.
--
-- Las órdenes NUEVAS ya se crean así desde la app. Aquí se hace el backfill de
-- las órdenes existentes que aún no se han despachado.
--
-- IDEMPOTENTE.
-- =============================================================================

UPDATE orden_insumo_items i
SET cantidad_alistada = i.cantidad_solicitada
FROM ordenes_insumo o
WHERE o.id = i.orden_id
  AND o.estado IN ('PENDIENTE', 'EN_ALISTAMIENTO')
  AND i.cantidad_alistada = 0
  AND i.cantidad_solicitada > 0;
