-- =============================================================================
-- Órdenes de insumo — quién modificó cada ítem de la solicitud
--
-- En la etapa de solicitud (borrador / cambios solicitados) el supervisor de la
-- sede puede ajustar cantidades y agregar o quitar productos. Guardamos en el
-- propio ítem quién hizo el último cambio para mostrarlo en una columna, además
-- de la trazabilidad completa por eventos.
-- =============================================================================

ALTER TABLE orden_insumo_items ADD COLUMN IF NOT EXISTS modificado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE orden_insumo_items ADD COLUMN IF NOT EXISTS modificado_nombre VARCHAR(200);
ALTER TABLE orden_insumo_items ADD COLUMN IF NOT EXISTS modificado_at     TIMESTAMPTZ;
