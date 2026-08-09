-- =============================================================================
-- Órdenes de insumo — urgencia y fecha de entrega pactada
--
-- Para priorizar el despacho: cada orden puede tener una fecha de entrega
-- pactada (según el contrato) y/o marcarse como urgente. Con eso el módulo
-- ordena y etiqueta las órdenes por entregar según su urgencia.
-- =============================================================================

ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS fecha_entrega_pactada DATE;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS urgente BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_oi_fecha_entrega ON ordenes_insumo(fecha_entrega_pactada);
CREATE INDEX IF NOT EXISTS idx_oi_urgente       ON ordenes_insumo(urgente) WHERE urgente;

COMMENT ON COLUMN ordenes_insumo.fecha_entrega_pactada IS 'Fecha límite de entrega pactada por contrato; se usa para priorizar y etiquetar.';
COMMENT ON COLUMN ordenes_insumo.urgente IS 'Marca manual de urgencia (además de la que se deriva de la fecha).';
