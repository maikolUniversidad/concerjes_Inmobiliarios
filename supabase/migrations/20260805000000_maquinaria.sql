-- =============================================================================
-- MÓDULO: CONTROL DE MAQUINARIA
-- =============================================================================
-- Activos únicos con código personalizado, estado, ubicación (dónde está),
-- fotos y trazabilidad completa (cambios de estado/ubicación, fotos, comentarios).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE estado_maquinaria AS ENUM ('OPERATIVA','EN_USO','MANTENIMIENTO','DANADA','BAJA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Maquinaria ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maquinaria (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            VARCHAR(40) NOT NULL UNIQUE,   -- código personalizado y único
  nombre            VARCHAR(160) NOT NULL,
  tipo              VARCHAR(80),                   -- aspiradora, brilladora, guadaña, hidrolavadora…
  marca             VARCHAR(80),
  modelo            VARCHAR(80),
  serial            VARCHAR(120),
  estado            estado_maquinaria NOT NULL DEFAULT 'OPERATIVA',
  ubicacion_sede_id UUID REFERENCES sedes(id) ON DELETE SET NULL,
  ubicacion_texto   VARCHAR(200),                  -- ubicación libre / área / bodega
  responsable       VARCHAR(160),
  imagen_url        TEXT,                          -- foto principal (última)
  fecha_adquisicion DATE,
  valor             NUMERIC(14,2),
  observaciones     TEXT,
  activo            BOOLEAN DEFAULT true,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maquinaria_codigo ON maquinaria(codigo);
CREATE INDEX IF NOT EXISTS idx_maquinaria_estado ON maquinaria(estado);
CREATE INDEX IF NOT EXISTS idx_maquinaria_sede   ON maquinaria(ubicacion_sede_id);

DROP TRIGGER IF EXISTS tr_maquinaria_upd ON maquinaria;
CREATE TRIGGER tr_maquinaria_upd BEFORE UPDATE ON maquinaria
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Bitácora / trazabilidad ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maquinaria_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquinaria_id   UUID NOT NULL REFERENCES maquinaria(id) ON DELETE CASCADE,
  tipo            VARCHAR(30) NOT NULL,   -- CREACION, ESTADO, UBICACION, FOTO, MANTENIMIENTO, COMENTARIO
  estado_anterior estado_maquinaria,
  estado_nuevo    estado_maquinaria,
  ubicacion       VARCHAR(200),
  descripcion     TEXT NOT NULL,
  foto_path       TEXT,
  detalle         JSONB,
  usuario_id      UUID,
  usuario_email   VARCHAR(200),
  usuario_nombre  VARCHAR(200),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maq_eventos ON maquinaria_eventos(maquinaria_id, created_at DESC);

-- Helper para registrar un evento capturando al usuario
CREATE OR REPLACE FUNCTION public.maq_evento(
  p_maq UUID, p_tipo VARCHAR, p_estado_ant estado_maquinaria, p_estado_nue estado_maquinaria,
  p_ubic VARCHAR, p_desc TEXT, p_foto TEXT, p_detalle JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_email VARCHAR(200); v_nombre VARCHAR(200);
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NOT NULL THEN SELECT email, nombre INTO v_email, v_nombre FROM usuarios WHERE id = v_uid; END IF;
  INSERT INTO maquinaria_eventos (maquinaria_id, tipo, estado_anterior, estado_nuevo, ubicacion, descripcion, foto_path, detalle, usuario_id, usuario_email, usuario_nombre)
  VALUES (p_maq, p_tipo, p_estado_ant, p_estado_nue, p_ubic, p_desc, p_foto, p_detalle, v_uid, v_email, v_nombre);
END; $$;
GRANT EXECUTE ON FUNCTION public.maq_evento(UUID, VARCHAR, estado_maquinaria, estado_maquinaria, VARCHAR, TEXT, TEXT, JSONB) TO authenticated;

-- Trigger: registra creación, cambios de estado y de ubicación
CREATE OR REPLACE FUNCTION public.tr_maquinaria_eventos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_ubic_ant TEXT; v_ubic_nue TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM maq_evento(NEW.id, 'CREACION', NULL, NEW.estado, NEW.ubicacion_texto, 'Maquinaria registrada: ' || NEW.codigo, NULL, NULL);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      PERFORM maq_evento(NEW.id, 'ESTADO', OLD.estado, NEW.estado, NULL, 'Estado: ' || OLD.estado || ' → ' || NEW.estado, NULL, NULL);
    END IF;
    IF NEW.ubicacion_sede_id IS DISTINCT FROM OLD.ubicacion_sede_id OR NEW.ubicacion_texto IS DISTINCT FROM OLD.ubicacion_texto THEN
      v_ubic_nue := COALESCE((SELECT nombre FROM sedes WHERE id = NEW.ubicacion_sede_id), NEW.ubicacion_texto);
      PERFORM maq_evento(NEW.id, 'UBICACION', NULL, NULL, v_ubic_nue, 'Ubicación actualizada' || COALESCE(': ' || v_ubic_nue, ''), NULL, NULL);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_maquinaria_eventos ON maquinaria;
CREATE TRIGGER tr_maquinaria_eventos AFTER INSERT OR UPDATE ON maquinaria
  FOR EACH ROW EXECUTE FUNCTION public.tr_maquinaria_eventos();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE maquinaria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE maquinaria_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maq_read ON maquinaria;
CREATE POLICY maq_read ON maquinaria FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS maq_write ON maquinaria;
CREATE POLICY maq_write ON maquinaria FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','COORDINADOR_COMPRAS'));

DROP POLICY IF EXISTS maq_ev_read ON maquinaria_eventos;
CREATE POLICY maq_ev_read ON maquinaria_eventos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS maq_ev_write ON maquinaria_eventos;
CREATE POLICY maq_ev_write ON maquinaria_eventos FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','COORDINADOR_COMPRAS'));

-- ── Storage: bucket público de fotos de maquinaria ───────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('maquinaria', 'maquinaria', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "maq_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "maq_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "maq_delete_bucket" ON storage.objects;
CREATE POLICY "maq_read_bucket" ON storage.objects FOR SELECT USING (bucket_id = 'maquinaria');
CREATE POLICY "maq_upload_bucket" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'maquinaria');
CREATE POLICY "maq_delete_bucket" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'maquinaria');

-- ── Permisos en los roles ────────────────────────────────────────────────────
UPDATE public.roles
SET permisos = permisos || '{"ver_maquinaria": true, "gestionar_maquinaria": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','COORDINADOR_COMPRAS')
   OR nombre ILIKE 'coordinador%' OR nombre ILIKE 'gerencia%';

UPDATE public.roles
SET permisos = permisos || '{"ver_maquinaria": true}'::jsonb
WHERE rol_base IN ('AUDITOR','OPERADOR_SEDE');
