-- =============================================================================
-- Conserjes Inmobiliarios — Código de barras / QR por producto
--
-- Añade el código escaneable real de cada producto (distinto del `codigo`
-- interno numérico del maestro). Garantiza que NO se repita entre productos y
-- registra su origen: escaneado del producto físico o generado por nosotros.
--
-- IDEMPOTENTE.
-- =============================================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras         TEXT;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras_formato VARCHAR(20);  -- QR | CODE128 | EAN13 | CODE39
ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras_origen  VARCHAR(20);  -- ESCANEADO | GENERADO

-- Unicidad del código escaneable (permite múltiples NULL, prohíbe duplicados).
CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_codigo_barras
  ON productos (codigo_barras)
  WHERE codigo_barras IS NOT NULL;

-- Restringe los valores de origen a los esperados.
DO $$ BEGIN
  ALTER TABLE productos ADD CONSTRAINT chk_codigo_barras_origen
    CHECK (codigo_barras_origen IS NULL OR codigo_barras_origen IN ('ESCANEADO','GENERADO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
