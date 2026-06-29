-- =============================================================================
-- Conserjes Inmobiliarios — Bodegas y Ubicaciones (plano físico)
-- Clasificación real de la(s) bodega(s): plano con marcadores de ubicación,
-- foto de cada estantería/zona, responsables (usuarios) y enlace a movimientos.
-- Idempotente.
-- =============================================================================

-- Bodegas / almacenes ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS bodegas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(200) NOT NULL,
  codigo         VARCHAR(30) UNIQUE,
  direccion      TEXT,
  descripcion    TEXT,
  plano_url      TEXT,                       -- imagen del plano/layout de la bodega
  responsable_id UUID REFERENCES usuarios(id),
  activo         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Ubicaciones dentro de una bodega (estantería / zona / posición) -------------
CREATE TABLE IF NOT EXISTS ubicaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bodega_id      UUID NOT NULL REFERENCES bodegas(id) ON DELETE CASCADE,
  codigo         VARCHAR(40) NOT NULL,        -- p.ej. "A-01-03"
  nombre         VARCHAR(200),                -- "Estantería A · Nivel 1"
  tipo           VARCHAR(40) DEFAULT 'ESTANTERIA', -- ESTANTERIA/ZONA/NEVERA/PALLET/VITRINA/OTRO
  descripcion    TEXT,
  foto_url       TEXT,                        -- foto real del lugar/estantería
  pos_x          NUMERIC(6,2),                -- % horizontal sobre el plano (0–100)
  pos_y          NUMERIC(6,2),                -- % vertical sobre el plano (0–100)
  responsable_id UUID REFERENCES usuarios(id),
  activo         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bodega_id, codigo)
);

-- Enlaces ---------------------------------------------------------------------
ALTER TABLE productos   ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES ubicaciones(id);
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES ubicaciones(id);

CREATE INDEX IF NOT EXISTS idx_ubicaciones_bodega ON ubicaciones(bodega_id);
CREATE INDEX IF NOT EXISTS idx_productos_ubicacion ON productos(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion ON movimientos(ubicacion_id);

-- updated_at + versionado (historial) -----------------------------------------
DROP TRIGGER IF EXISTS tr_bodegas_upd ON bodegas;
CREATE TRIGGER tr_bodegas_upd BEFORE UPDATE ON bodegas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_ubic_upd ON ubicaciones;
CREATE TRIGGER tr_ubic_upd BEFORE UPDATE ON ubicaciones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t TEXT; tablas TEXT[] := ARRAY['bodegas','ubicaciones'];
BEGIN
  IF to_regproc('public.registrar_historial') IS NOT NULL THEN
    FOREACH t IN ARRAY tablas LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS tr_hist_%1$s ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_hist_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.registrar_historial()', t);
    END LOOP;
  END IF;
END $$;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE bodegas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ubicaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_bodegas ON bodegas;
CREATE POLICY auth_read_bodegas ON bodegas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS write_bodegas ON bodegas;
CREATE POLICY write_bodegas ON bodegas FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

DROP POLICY IF EXISTS auth_read_ubicaciones ON ubicaciones;
CREATE POLICY auth_read_ubicaciones ON ubicaciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS write_ubicaciones ON ubicaciones;
CREATE POLICY write_ubicaciones ON ubicaciones FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

-- =============================================================================
-- SEED: una bodega central por defecto (si no existe ninguna)
-- =============================================================================
INSERT INTO bodegas (nombre, codigo, descripcion)
SELECT 'Bodega Central', 'CENTRAL', 'Bodega principal de Conserjes Inmobiliarios'
WHERE NOT EXISTS (SELECT 1 FROM bodegas);
