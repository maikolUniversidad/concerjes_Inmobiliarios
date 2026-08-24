-- ============================================================================
-- Etiqueta de inventario fisico
-- Marca cada producto del catalogo con el periodo del ultimo inventario fisico
-- cruzado y si el producto fue hallado o no en ese conteo. Los productos que
-- NO aparecen en el inventario se conservan (no se borran ni se desactivan),
-- solo quedan etiquetados para poder identificarlos y filtrarlos.
-- ============================================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS inventario_periodo    VARCHAR(50);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS inventario_encontrado BOOLEAN;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS inventario_fecha      TIMESTAMPTZ;

COMMENT ON COLUMN productos.inventario_periodo    IS 'Periodo del ultimo inventario fisico cruzado contra este producto (ej. "AGOSTO 2025")';
COMMENT ON COLUMN productos.inventario_encontrado IS 'true = aparecio en ese inventario; false = NO se encontro (se conserva en el catalogo, etiquetado)';
COMMENT ON COLUMN productos.inventario_fecha      IS 'Momento en que se aplico el cruce del inventario';

-- Indice parcial: la consulta util es "los que no se encontraron"
CREATE INDEX IF NOT EXISTS idx_productos_inventario_no_hallado
  ON productos (inventario_periodo)
  WHERE inventario_encontrado IS FALSE;
