-- =============================================================================
-- PARAMETRIZACIÓN POR SEDE
-- =============================================================================
-- Cada sede puede tener un catálogo específico de productos, cada uno con una
-- cantidad máxima (y mínima opcional para reposición). Es la base para el futuro
-- MÓDULO DE CONTRATO, que asignará estas parametrizaciones — por eso se reserva
-- la columna `contrato_id` (aún sin FK: la tabla `contratos` se creará después).
-- =============================================================================

CREATE TABLE IF NOT EXISTS sede_productos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id          UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_maxima  DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_minima  DECIMAL(10,2) DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true,
  observacion      TEXT,
  -- Reservado para el futuro módulo de contratos (sin FK hasta que exista la tabla).
  contrato_id      UUID,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sede_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_sede_productos_sede     ON sede_productos(sede_id);
CREATE INDEX IF NOT EXISTS idx_sede_productos_producto ON sede_productos(producto_id);
CREATE INDEX IF NOT EXISTS idx_sede_productos_contrato ON sede_productos(contrato_id);

COMMENT ON TABLE  sede_productos IS 'Parametrización por sede: catálogo de productos permitidos y su cantidad máxima/mínima. Base del futuro módulo de contratos.';
COMMENT ON COLUMN sede_productos.contrato_id IS 'Reservado: el módulo de contratos asignará estas parametrizaciones. Sin FK hasta que exista la tabla contratos.';

-- updated_at
DROP TRIGGER IF EXISTS tr_sede_productos_upd ON sede_productos;
CREATE TRIGGER tr_sede_productos_upd BEFORE UPDATE ON sede_productos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE sede_productos ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado.
DROP POLICY IF EXISTS sp_read ON sede_productos;
CREATE POLICY sp_read ON sede_productos FOR SELECT TO authenticated USING (true);

-- Escritura: administración y coordinación.
DROP POLICY IF EXISTS sp_write ON sede_productos;
CREATE POLICY sp_write ON sede_productos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- =============================================================================
-- PERMISOS EN LOS ROLES (claves del catálogo lib/permisos.ts)
-- =============================================================================
-- Ver + gestionar: administración, compras, gerencia y coordinación.
UPDATE public.roles
SET permisos = permisos || '{"ver_parametrizacion": true, "gestionar_parametrizacion": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS')
   OR nombre IN ('Gerencia','Coordinador');

-- Solo ver: supervisión, auditoría y bodega.
UPDATE public.roles
SET permisos = permisos || '{"ver_parametrizacion": true}'::jsonb
WHERE rol_base IN ('SUPERVISOR','AUDITOR','BODEGUERO')
   OR nombre IN ('Supervisor de Conserjería');
