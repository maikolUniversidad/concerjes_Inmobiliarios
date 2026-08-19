-- =============================================================================
-- BORRADORES DE MOVIMIENTOS (registro en lote con responsables)
-- =============================================================================
-- Permite guardar una tanda de movimientos como borrador, asignarle
-- responsables (usuarios de la plataforma) y registrarlos luego de una vez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS movimiento_borradores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(120),
  creado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimiento_borrador_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrador_id  UUID NOT NULL REFERENCES movimiento_borradores(id) ON DELETE CASCADE,
  tipo         tipo_movimiento NOT NULL,
  producto_id  UUID REFERENCES productos(id),
  cantidad     NUMERIC,
  sede_id      UUID REFERENCES sedes(id),
  ubicacion_id UUID REFERENCES ubicaciones(id),
  observacion  TEXT,
  orden        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mov_borr_items ON movimiento_borrador_items(borrador_id);

CREATE TABLE IF NOT EXISTS movimiento_borrador_responsables (
  borrador_id UUID NOT NULL REFERENCES movimiento_borradores(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (borrador_id, usuario_id)
);

DROP TRIGGER IF EXISTS tr_mov_borradores_upd ON movimiento_borradores;
CREATE TRIGGER tr_mov_borradores_upd BEFORE UPDATE ON movimiento_borradores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: cualquier autenticado puede ver y gestionar borradores (herramienta interna).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['movimiento_borradores','movimiento_borrador_items','movimiento_borrador_responsables'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_write ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
