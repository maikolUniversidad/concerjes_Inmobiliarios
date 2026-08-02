-- =============================================================================
-- EMPRESAS EMISORAS (datos + logo para documentos) + CATÁLOGO DE PRESENTACIONES
-- =============================================================================
-- 1) empresas_emisoras: varias razones sociales con sus datos y logo, para
--    generar documentos (orden de insumo / remisión / etc.) con esos datos.
--    Una queda marcada como predeterminada (la que usan los documentos por
--    defecto).
-- 2) presentaciones: catálogo gestionable de presentaciones de insumo
--    (Galón, Litro, Caja x 12, Unidad…) para estandarizar el campo en productos.
-- =============================================================================

-- ── Empresas emisoras ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas_emisoras (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social     VARCHAR(200) NOT NULL,
  nombre_comercial VARCHAR(200),
  nit              VARCHAR(40),
  telefono         VARCHAR(60),
  email            VARCHAR(160),
  direccion        VARCHAR(240),
  ciudad           VARCHAR(120),
  sitio_web        VARCHAR(160),
  logo_path        TEXT,                 -- ruta en el bucket público `empresas`
  es_predeterminada BOOLEAN NOT NULL DEFAULT false,
  activo           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Solo una empresa puede ser la predeterminada.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_empresas_emisoras_predet
  ON empresas_emisoras(es_predeterminada) WHERE es_predeterminada;

DROP TRIGGER IF EXISTS tr_empresas_emisoras_upd ON empresas_emisoras;
CREATE TRIGGER tr_empresas_emisoras_upd BEFORE UPDATE ON empresas_emisoras
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Presentaciones (catálogo) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS presentaciones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(120) NOT NULL UNIQUE,
  activo     BOOLEAN NOT NULL DEFAULT true,
  orden      INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE empresas_emisoras ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentaciones    ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado.
DROP POLICY IF EXISTS ee_read ON empresas_emisoras;
CREATE POLICY ee_read ON empresas_emisoras FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS pres_read ON presentaciones;
CREATE POLICY pres_read ON presentaciones FOR SELECT TO authenticated USING (true);

-- Escritura: administración.
DROP POLICY IF EXISTS ee_write ON empresas_emisoras;
CREATE POLICY ee_write ON empresas_emisoras FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS pres_write ON presentaciones;
CREATE POLICY pres_write ON presentaciones FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));

-- =============================================================================
-- STORAGE — bucket PÚBLICO para logos (se incrustan en los documentos)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('empresas', 'empresas', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "emp_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "emp_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "emp_delete_bucket" ON storage.objects;
CREATE POLICY "emp_read_bucket" ON storage.objects
  FOR SELECT USING (bucket_id = 'empresas');
CREATE POLICY "emp_upload_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'empresas');
CREATE POLICY "emp_delete_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'empresas');

-- =============================================================================
-- SEED
-- =============================================================================
-- Empresa emisora por defecto (datos actuales quemados en la app).
INSERT INTO empresas_emisoras (razon_social, nombre_comercial, nit, telefono, sitio_web, ciudad, es_predeterminada, activo)
SELECT 'CONSERJES INMOBILIARIOS LTDA', 'Conserjes Inmobiliarios', '800093388-2', '+57 320 808 1399', 'conserjesinmobiliarios.com', 'Bogotá D.C.', true, true
WHERE NOT EXISTS (SELECT 1 FROM empresas_emisoras);

-- Catálogo de presentaciones: parte de los valores ya usados en productos.
INSERT INTO presentaciones (nombre)
SELECT DISTINCT upper(trim(presentacion))
FROM productos
WHERE presentacion IS NOT NULL AND trim(presentacion) <> ''
ON CONFLICT (nombre) DO NOTHING;
