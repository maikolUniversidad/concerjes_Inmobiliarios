-- =============================================================================
-- SERVICIOS DEL HOGAR — Galería de fotos (vitrina) + Reseñas de clientes
-- · Galería: la empresa/admin sube imágenes que se muestran en la landing.
-- · Reseñas: los clientes con servicios completados califican; las reseñas
--   quedan PENDIENTES hasta que el personal las aprueba (moderación manual).
-- =============================================================================

-- ── Galería (vitrina curada por el personal) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS galeria_servicio_hogar (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id       UUID REFERENCES tipos_servicio_hogar(id) ON DELETE SET NULL,
  titulo        VARCHAR(150),
  descripcion   TEXT,
  storage_path  TEXT,                 -- ruta dentro del bucket 'servicios-hogar'
  url           TEXT NOT NULL,        -- URL pública de la imagen
  orden         SMALLINT NOT NULL DEFAULT 0,
  activo        BOOLEAN  NOT NULL DEFAULT true,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_galeria_tipo  ON galeria_servicio_hogar(tipo_id);
CREATE INDEX IF NOT EXISTS idx_galeria_orden ON galeria_servicio_hogar(orden);

-- ── Reseñas de clientes (moderadas) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resenas_servicio_hogar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id    UUID UNIQUE REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  cliente_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo_id         UUID REFERENCES tipos_servicio_hogar(id) ON DELETE SET NULL,
  cliente_nombre  VARCHAR(120) NOT NULL,   -- nombre a mostrar (p.ej. "María G.")
  servicio_nombre VARCHAR(120),
  calificacion    SMALLINT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
  comentario      TEXT,
  aprobada        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resenas_aprobada ON resenas_servicio_hogar(aprobada);
CREATE INDEX IF NOT EXISTS idx_resenas_cliente  ON resenas_servicio_hogar(cliente_id);

DROP TRIGGER IF EXISTS tr_resenas_upd ON resenas_servicio_hogar;
CREATE TRIGGER tr_resenas_upd
  BEFORE UPDATE ON resenas_servicio_hogar FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE galeria_servicio_hogar ENABLE ROW LEVEL SECURITY;
ALTER TABLE resenas_servicio_hogar ENABLE ROW LEVEL SECURITY;

-- Galería: lectura pública de lo activo; gestión sólo personal (admin/supervisor).
DROP POLICY IF EXISTS galeria_public_read ON galeria_servicio_hogar;
DROP POLICY IF EXISTS galeria_staff_all   ON galeria_servicio_hogar;
CREATE POLICY galeria_public_read ON galeria_servicio_hogar FOR SELECT USING (activo = true);
CREATE POLICY galeria_staff_all ON galeria_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Reseñas:
--  · público: sólo las aprobadas
--  · cliente: crea/edita/ve LAS SUYAS (cliente_id = auth.uid())
--  · personal: gestiona todo (aprueba)
DROP POLICY IF EXISTS resenas_public_read  ON resenas_servicio_hogar;
DROP POLICY IF EXISTS resenas_self         ON resenas_servicio_hogar;
DROP POLICY IF EXISTS resenas_staff_all    ON resenas_servicio_hogar;
CREATE POLICY resenas_public_read ON resenas_servicio_hogar FOR SELECT USING (aprobada = true);
CREATE POLICY resenas_self ON resenas_servicio_hogar FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid()))
  WITH CHECK (cliente_id = (SELECT auth.uid()));
CREATE POLICY resenas_staff_all ON resenas_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- ── Storage: bucket público para la galería ──────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('servicios-hogar', 'servicios-hogar', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública de los objetos del bucket.
DROP POLICY IF EXISTS sh_bucket_public_read ON storage.objects;
CREATE POLICY sh_bucket_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'servicios-hogar');

-- Escritura/borrado sólo personal (admin/supervisor).
DROP POLICY IF EXISTS sh_bucket_staff_insert ON storage.objects;
DROP POLICY IF EXISTS sh_bucket_staff_update ON storage.objects;
DROP POLICY IF EXISTS sh_bucket_staff_delete ON storage.objects;
CREATE POLICY sh_bucket_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'servicios-hogar' AND public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
CREATE POLICY sh_bucket_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'servicios-hogar' AND public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
CREATE POLICY sh_bucket_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'servicios-hogar' AND public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
