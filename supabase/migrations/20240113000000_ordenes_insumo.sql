-- =============================================================================
-- ÓRDENES DE INSUMO (despacho a bodega + alistamiento + video de despacho)
-- =============================================================================
-- Flujo:
--   1) Se crea una orden POR SEDE tomando su parametrización (sede_productos):
--      productos permitidos + cantidad máxima (propuesta, editable hacia abajo).
--   2) Llega a la bodega como orden de despacho (estado PENDIENTE).
--   3) ALISTAMIENTO: se marca ítem por ítem lo que se va alistando y se asignan
--      responsables.
--   4) DESPACHO: se graba/sube un VIDEO que queda ligado a la orden y se registra
--      la SALIDA de stock (traslado de mercancía a la sede) vía registrar_movimiento.
--
-- `contrato_id` queda reservado para el futuro módulo de contratos.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE estado_orden_insumo AS ENUM
    ('PENDIENTE','EN_ALISTAMIENTO','ALISTADO','DESPACHADO','ANULADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Cabecera ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_insumo (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                   VARCHAR(30) UNIQUE NOT NULL,
  sede_id                  UUID NOT NULL REFERENCES sedes(id),
  bodega_id                UUID REFERENCES bodegas(id) ON DELETE SET NULL,
  estado                   estado_orden_insumo NOT NULL DEFAULT 'PENDIENTE',
  periodo                  DATE,
  observacion              TEXT,
  contrato_id              UUID,  -- reservado para el módulo de contratos
  creado_por               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alistamiento_iniciado_at TIMESTAMPTZ,
  alistado_at              TIMESTAMPTZ,
  despachado_por           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  despachado_at            TIMESTAMPTZ,
  video_path               TEXT,          -- ruta en el bucket privado ordenes-insumo
  video_mime               VARCHAR(60),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oi_sede    ON ordenes_insumo(sede_id);
CREATE INDEX IF NOT EXISTS idx_oi_estado  ON ordenes_insumo(estado);
CREATE INDEX IF NOT EXISTS idx_oi_creada  ON ordenes_insumo(created_at DESC);

-- ── Ítems ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id),
  cantidad_solicitada DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_maxima_ref DECIMAL(10,2) DEFAULT 0,   -- máximo parametrizado al crear
  cantidad_alistada   DECIMAL(10,2) NOT NULL DEFAULT 0,
  alistado            BOOLEAN NOT NULL DEFAULT false,
  alistado_por        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alistado_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_oi_items_orden ON orden_insumo_items(orden_id);

-- ── Responsables del alistamiento ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_responsables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id   UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_oi_resp_orden ON orden_insumo_responsables(orden_id);

-- ── updated_at ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_ordenes_insumo_upd ON ordenes_insumo;
CREATE TRIGGER tr_ordenes_insumo_upd BEFORE UPDATE ON ordenes_insumo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE ordenes_insumo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_responsables ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado.
DROP POLICY IF EXISTS oi_read ON ordenes_insumo;
CREATE POLICY oi_read ON ordenes_insumo FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_items_read ON orden_insumo_items;
CREATE POLICY oi_items_read ON orden_insumo_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_resp_read ON orden_insumo_responsables;
CREATE POLICY oi_resp_read ON orden_insumo_responsables FOR SELECT TO authenticated USING (true);

-- Escritura: administración, supervisión, bodega y compras.
DROP POLICY IF EXISTS oi_write ON ordenes_insumo;
CREATE POLICY oi_write ON ordenes_insumo FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_items_write ON orden_insumo_items;
CREATE POLICY oi_items_write ON orden_insumo_items FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_resp_write ON orden_insumo_responsables;
CREATE POLICY oi_resp_write ON orden_insumo_responsables FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));

-- =============================================================================
-- STORAGE — bucket PRIVADO para los videos de despacho
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('ordenes-insumo', 'ordenes-insumo', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "oi_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "oi_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "oi_delete_bucket" ON storage.objects;
CREATE POLICY "oi_read_bucket" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ordenes-insumo');
CREATE POLICY "oi_upload_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ordenes-insumo');
CREATE POLICY "oi_delete_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ordenes-insumo');

-- =============================================================================
-- PERMISOS EN LOS ROLES (claves del catálogo lib/permisos.ts)
-- =============================================================================
-- Ver + crear + alistar: administración, gerencia, supervisión.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true, "alistar_ordenes_insumo": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR')
   OR nombre IN ('Gerencia','Coordinador');

-- Compras: ver + crear.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS';

-- Bodega: ver + alistar (arma y despacha el pedido).
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "alistar_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'BODEGUERO';

-- Auditor: solo ver.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'AUDITOR';
