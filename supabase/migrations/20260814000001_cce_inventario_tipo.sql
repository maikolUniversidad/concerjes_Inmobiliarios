-- CCE: tipo de inventario por producto (PROPIO o COMPARTIDO)
-- PROPIO   → CCE tiene sus propias unidades (tabla stock_cce), separadas de Conserjes
-- COMPARTIDO → CCE y Conserjes comparten el mismo stock existente (tabla stock)

-- ─── 1. ENUM ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE cce_tipo_inventario AS ENUM ('PROPIO', 'COMPARTIDO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. COLUMNA EN PRODUCTOS ─────────────────────────────────────────────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS cce_tipo cce_tipo_inventario;

-- ─── 3. STOCK PROPIO DE CCE ──────────────────────────────────────────────────
-- Solo aplica cuando cce_tipo = 'PROPIO'.
CREATE TABLE IF NOT EXISTS stock_cce (
  producto_id   UUID PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_real DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_disp DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger: mantiene updated_at
CREATE OR REPLACE FUNCTION set_stock_cce_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tr_stock_cce_upd ON stock_cce;
CREATE TRIGGER tr_stock_cce_upd
  BEFORE UPDATE ON stock_cce
  FOR EACH ROW EXECUTE FUNCTION set_stock_cce_updated_at();

-- ─── 4. AUTO-INICIALIZAR stock_cce cuando se activa cce_tipo = 'PROPIO' ──────
CREATE OR REPLACE FUNCTION init_stock_cce_on_propio()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cce_tipo = 'PROPIO' AND (OLD.cce_tipo IS DISTINCT FROM 'PROPIO') THEN
    INSERT INTO stock_cce (producto_id) VALUES (NEW.id)
    ON CONFLICT (producto_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_init_stock_cce ON productos;
CREATE TRIGGER tr_init_stock_cce
  AFTER UPDATE OF cce_tipo ON productos
  FOR EACH ROW EXECUTE FUNCTION init_stock_cce_on_propio();

-- ─── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE stock_cce ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_cce_read ON stock_cce;
CREATE POLICY stock_cce_read ON stock_cce
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS stock_cce_write ON stock_cce;
CREATE POLICY stock_cce_write ON stock_cce
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'superadmin'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'superadmin'));
