-- =============================================================================
-- TIENDA VIRTUAL — Servicios del Hogar (estilo marketplace)
-- · Galería con VIDEOS además de fotos.
-- · Concerjes habilitados por tipo de servicio (perfil público con calificación).
-- · Calificación también para los clientes (doble vía).
-- · Ubicación del servicio y concerje asignado en cada solicitud.
-- =============================================================================

-- ── Galería: soportar video ──────────────────────────────────────────────────
ALTER TABLE galeria_servicio_hogar
  ADD COLUMN IF NOT EXISTS media_tipo VARCHAR(10) NOT NULL DEFAULT 'imagen',  -- imagen | video
  ADD COLUMN IF NOT EXISTS poster_url TEXT,                                    -- miniatura del video
  ADD COLUMN IF NOT EXISTS destacado  BOOLEAN NOT NULL DEFAULT false;          -- aparece en el carrusel

-- ── Concerjes que prestan servicios del hogar (perfil público) ───────────────
CREATE TABLE IF NOT EXISTS concerjes_hogar (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- cuenta de staff (opcional)
  nombre              VARCHAR(150) NOT NULL,
  foto_url            TEXT,
  bio                 TEXT,
  anios_experiencia   SMALLINT DEFAULT 0,
  ciudad              VARCHAR(100) DEFAULT 'Bogotá',
  zonas               TEXT[],                       -- zonas donde presta servicio
  calificacion_prom   NUMERIC(3,2) NOT NULL DEFAULT 0,
  servicios_count     INTEGER NOT NULL DEFAULT 0,
  disponible          BOOLEAN NOT NULL DEFAULT true,
  activo              BOOLEAN NOT NULL DEFAULT true,
  orden               SMALLINT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitación concerje ↔ tipo de servicio (qué sabe hacer cada quién).
CREATE TABLE IF NOT EXISTS concerje_servicio_hogar (
  concerje_id  UUID NOT NULL REFERENCES concerjes_hogar(id) ON DELETE CASCADE,
  tipo_id      UUID NOT NULL REFERENCES tipos_servicio_hogar(id) ON DELETE CASCADE,
  activo       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (concerje_id, tipo_id)
);

DROP TRIGGER IF EXISTS tr_concerjes_upd ON concerjes_hogar;
CREATE TRIGGER tr_concerjes_upd
  BEFORE UPDATE ON concerjes_hogar FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Calificación de clientes (el concerje califica al cliente) ────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS calificacion_prom   NUMERIC(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calificaciones_count INTEGER     NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS calificaciones_cliente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concerje_id   UUID REFERENCES concerjes_hogar(id) ON DELETE SET NULL,
  solicitud_id  UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  calificacion  SMALLINT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
  comentario    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calif_cliente ON calificaciones_cliente(cliente_id);

-- Recalcular el promedio del cliente al calificarlo.
CREATE OR REPLACE FUNCTION public.recalc_calificacion_cliente()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID := COALESCE(NEW.cliente_id, OLD.cliente_id);
BEGIN
  UPDATE clientes SET
    calificaciones_count = (SELECT COUNT(*) FROM calificaciones_cliente WHERE cliente_id = cid),
    calificacion_prom    = COALESCE((SELECT ROUND(AVG(calificacion)::numeric, 2) FROM calificaciones_cliente WHERE cliente_id = cid), 0)
  WHERE id = cid;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_recalc_calif_cliente ON calificaciones_cliente;
CREATE TRIGGER tr_recalc_calif_cliente
  AFTER INSERT OR UPDATE OR DELETE ON calificaciones_cliente
  FOR EACH ROW EXECUTE FUNCTION public.recalc_calificacion_cliente();

-- ── Solicitudes: concerje asignado + ubicación geográfica ────────────────────
ALTER TABLE solicitudes_servicio_hogar
  ADD COLUMN IF NOT EXISTS concerje_id          UUID REFERENCES concerjes_hogar(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ubicacion_lat        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS ubicacion_lng        NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS ubicacion_referencia TEXT;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE concerjes_hogar         ENABLE ROW LEVEL SECURITY;
ALTER TABLE concerje_servicio_hogar ENABLE ROW LEVEL SECURITY;
ALTER TABLE calificaciones_cliente  ENABLE ROW LEVEL SECURITY;

-- Concerjes y su habilitación: lectura pública (tienda); gestión sólo personal.
DROP POLICY IF EXISTS concerjes_public_read ON concerjes_hogar;
DROP POLICY IF EXISTS concerjes_staff_all   ON concerjes_hogar;
CREATE POLICY concerjes_public_read ON concerjes_hogar FOR SELECT USING (activo = true);
CREATE POLICY concerjes_staff_all ON concerjes_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

DROP POLICY IF EXISTS csh_public_read ON concerje_servicio_hogar;
DROP POLICY IF EXISTS csh_staff_all   ON concerje_servicio_hogar;
CREATE POLICY csh_public_read ON concerje_servicio_hogar FOR SELECT USING (true);
CREATE POLICY csh_staff_all ON concerje_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Calificación de clientes: el cliente ve las suyas; el personal gestiona.
DROP POLICY IF EXISTS calif_cliente_self  ON calificaciones_cliente;
DROP POLICY IF EXISTS calif_cliente_staff ON calificaciones_cliente;
CREATE POLICY calif_cliente_self ON calificaciones_cliente FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
CREATE POLICY calif_cliente_staff ON calificaciones_cliente FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
