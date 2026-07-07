-- =============================================================================
-- MÓDULO: GESTIÓN HUMANA
-- =============================================================================
-- Submódulos:
--   1) Personas  → colaboradores con su empresa usuaria asignada (CRUD + cargue masivo)
--   2) Documentos → árbol de tipos documentales + archivos por persona
-- =============================================================================

-- ── Empresas usuarias (empresas cliente donde presta servicio el personal) ───
CREATE TABLE IF NOT EXISTS empresas_usuarias (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(160) NOT NULL UNIQUE,
  nit        VARCHAR(30),
  ciudad     VARCHAR(120),
  contacto   VARCHAR(120),
  telefono   VARCHAR(30),
  email      VARCHAR(160),
  activo     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Personas (colaboradores) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc           VARCHAR(6) NOT NULL DEFAULT 'CC',   -- CC, CE, TI, PA, PEP, NIT
  documento          VARCHAR(30) NOT NULL UNIQUE,        -- clave de deduplicación
  nombres            VARCHAR(120) NOT NULL,
  apellidos          VARCHAR(120) NOT NULL,
  cargo              VARCHAR(120),
  empresa_usuaria_id UUID REFERENCES empresas_usuarias(id) ON DELETE SET NULL,
  sede_id            UUID REFERENCES sedes(id) ON DELETE SET NULL,
  fecha_ingreso      DATE,
  estado             VARCHAR(20) NOT NULL DEFAULT 'ACTIVO', -- ACTIVO, RETIRADO, SUSPENDIDO
  email              VARCHAR(160),
  telefono           VARCHAR(30),
  direccion          VARCHAR(200),
  eps                VARCHAR(120),
  arl                VARCHAR(120),
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personas_documento ON personas(documento);
CREATE INDEX IF NOT EXISTS idx_personas_empresa   ON personas(empresa_usuaria_id);
CREATE INDEX IF NOT EXISTS idx_personas_estado    ON personas(estado);
CREATE INDEX IF NOT EXISTS idx_personas_nombre    ON personas(apellidos, nombres);

-- ── Tipos documentales (árbol jerárquico, ramas y hojas ilimitadas) ──────────
CREATE TABLE IF NOT EXISTS tipos_documentales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES tipos_documentales(id) ON DELETE CASCADE,
  nombre      VARCHAR(160) NOT NULL,
  descripcion TEXT,
  orden       INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tipos_doc_parent ON tipos_documentales(parent_id, orden);

-- ── Documentos por persona ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documentos_persona (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  tipo_documental_id  UUID REFERENCES tipos_documentales(id) ON DELETE SET NULL,
  nombre_archivo      VARCHAR(255) NOT NULL,
  archivo_path        TEXT NOT NULL,              -- ruta en el bucket privado
  mime                VARCHAR(120),
  tamano              BIGINT,
  subido_por          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docper_persona ON documentos_persona(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docper_tipo    ON documentos_persona(tipo_documental_id);

-- ── Triggers updated_at ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_empresas_usuarias_upd ON empresas_usuarias;
CREATE TRIGGER tr_empresas_usuarias_upd BEFORE UPDATE ON empresas_usuarias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_personas_upd ON personas;
CREATE TRIGGER tr_personas_upd BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE empresas_usuarias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_documentales ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_persona ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado
DROP POLICY IF EXISTS gh_read_empresas ON empresas_usuarias;
CREATE POLICY gh_read_empresas ON empresas_usuarias FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gh_read_personas ON personas;
CREATE POLICY gh_read_personas ON personas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gh_read_tipos ON tipos_documentales;
CREATE POLICY gh_read_tipos ON tipos_documentales FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gh_read_docs ON documentos_persona;
CREATE POLICY gh_read_docs ON documentos_persona FOR SELECT TO authenticated USING (true);

-- Escritura: administración (SUPER_ADMIN / ADMIN / SUPERVISOR)
DROP POLICY IF EXISTS gh_write_empresas ON empresas_usuarias;
CREATE POLICY gh_write_empresas ON empresas_usuarias FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS gh_write_personas ON personas;
CREATE POLICY gh_write_personas ON personas FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS gh_write_tipos ON tipos_documentales;
CREATE POLICY gh_write_tipos ON tipos_documentales FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS gh_write_docs ON documentos_persona;
CREATE POLICY gh_write_docs ON documentos_persona FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- =============================================================================
-- STORAGE — bucket PRIVADO para documentos de RRHH (datos sensibles)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('gestion-humana', 'gestion-humana', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gh_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "gh_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "gh_delete_bucket" ON storage.objects;
CREATE POLICY "gh_read_bucket" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'gestion-humana');
CREATE POLICY "gh_upload_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'gestion-humana');
CREATE POLICY "gh_delete_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'gestion-humana');

-- ── Semilla mínima de tipos documentales (árbol de ejemplo) ──────────────────
DO $$
DECLARE
  r_ingreso UUID; r_afil UUID; r_contr UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tipos_documentales) THEN
    INSERT INTO tipos_documentales (nombre, descripcion, orden) VALUES
      ('Documentos de Ingreso', 'Documentación requerida al vincular', 1) RETURNING id INTO r_ingreso;
    INSERT INTO tipos_documentales (parent_id, nombre, orden) VALUES
      (r_ingreso, 'Hoja de vida', 1),
      (r_ingreso, 'Fotocopia de documento', 2),
      (r_ingreso, 'Exámenes médicos de ingreso', 3);

    INSERT INTO tipos_documentales (nombre, descripcion, orden) VALUES
      ('Afiliaciones', 'Seguridad social', 2) RETURNING id INTO r_afil;
    INSERT INTO tipos_documentales (parent_id, nombre, orden) VALUES
      (r_afil, 'EPS', 1),
      (r_afil, 'ARL', 2),
      (r_afil, 'Pensión', 3),
      (r_afil, 'Caja de compensación', 4);

    INSERT INTO tipos_documentales (nombre, descripcion, orden) VALUES
      ('Contratación', 'Documentos contractuales', 3) RETURNING id INTO r_contr;
    INSERT INTO tipos_documentales (parent_id, nombre, orden) VALUES
      (r_contr, 'Contrato firmado', 1),
      (r_contr, 'Otrosí', 2);
  END IF;
END $$;
