-- =============================================================================
-- SKU y Ubicación en Bodega por Producto
-- =============================================================================

-- SKU interno único (CI-ASEO-0042, CI-CAF-X3B1, etc.)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS sku VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_sku
  ON productos (sku)
  WHERE sku IS NOT NULL;

-- Ubicación estructurada: pasillo, estante, nivel (se guarda como "A-02-3")
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ubicacion_bodega   VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS bodega_descripcion TEXT;

-- Índice para búsquedas por ubicación (ej: todos los de pasillo A)
CREATE INDEX IF NOT EXISTS idx_productos_ubicacion ON productos (ubicacion_bodega);

-- Función helper: genera SKU a partir de tipo_insumo + ref/codigo
-- Se puede llamar desde la app o directamente: SELECT gen_sku('ASEO', 42)
CREATE OR REPLACE FUNCTION public.gen_sku(p_tipo TEXT, p_num INT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  prefix TEXT;
  seq    TEXT;
BEGIN
  prefix := CASE upper(p_tipo)
    WHEN 'CAFETERIA'  THEN 'CAF'
    WHEN 'LIQUIDOS'   THEN 'LIQ'
    WHEN 'ASEO'       THEN 'ASE'
    WHEN 'EPP'        THEN 'EPP'
    WHEN 'PAPELERIA'  THEN 'PAP'
    WHEN 'MAQUINARIA' THEN 'MAQ'
    WHEN 'JARDINERIA' THEN 'JAR'
    WHEN 'REPUESTOS'  THEN 'REP'
    ELSE 'OTR'
  END;

  IF p_num IS NOT NULL THEN
    seq := lpad(p_num::TEXT, 4, '0');
  ELSE
    seq := lpad((floor(random() * 9000) + 1000)::TEXT, 4, '0');
  END IF;

  RETURN 'CI-' || prefix || '-' || seq;
END;
$$;
