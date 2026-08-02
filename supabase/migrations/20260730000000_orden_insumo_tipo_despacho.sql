-- =============================================================================
-- Órdenes de insumo — tipo de despacho: conductor propio vs transportadora
--
-- Al despachar se registra si el envío sale con un conductor propio (flota de
-- Conserjes, ligado al módulo de logística) o con una transportadora de un
-- tercero (con nombre y número de guía para el seguimiento).
-- =============================================================================

-- CONDUCTOR_PROPIO | TRANSPORTADORA
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS tipo_despacho VARCHAR(20);

-- Datos de la transportadora tercera (solo cuando tipo_despacho = TRANSPORTADORA)
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS transportadora_nombre VARCHAR(200);
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS transportadora_guia   VARCHAR(100);

-- conductor_id (flota propia) ya existe desde el módulo de conductores.

COMMENT ON COLUMN ordenes_insumo.tipo_despacho IS 'CONDUCTOR_PROPIO = flota propia (conductor_id); TRANSPORTADORA = tercero (transportadora_nombre/guia).';
