-- =============================================================================
-- ÓRDENES DE INSUMO — productos ADICIONALES (fuera de la parametrización)
-- =============================================================================
-- El coordinador puede pedir productos que NO están en la parametrización de su
-- sede (sede_productos). Esos ítems se marcan como `es_adicional = true` y NO
-- tienen tope de cantidad: la central los revisa al aprobar la orden.
-- IDEMPOTENTE.
-- =============================================================================

ALTER TABLE orden_insumo_items ADD COLUMN IF NOT EXISTS es_adicional BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN orden_insumo_items.es_adicional IS
  'true = producto pedido fuera de la parametrización de la sede (sin tope). false = viene del catálogo parametrizado.';

-- Los ítems ya existentes sin máximo de referencia son, de hecho, adicionales.
UPDATE orden_insumo_items
SET es_adicional = true
WHERE es_adicional = false
  AND (cantidad_maxima_ref IS NULL OR cantidad_maxima_ref = 0);
