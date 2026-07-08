-- =============================================================================
-- ENTRENAMIENTO DE CLASIFICACIÓN DOCUMENTAL
-- =============================================================================
-- Referencias/muestras por tipo documental. Sirven de contexto (few-shot) para
-- que la IA clasifique automáticamente los documentos que se suben.
--   origen 'muestra'    → documento de referencia subido manualmente
--   origen 'confirmado' → texto de un documento clasificado y confirmado (aprende)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tipos_documentales_refs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id      UUID NOT NULL REFERENCES tipos_documentales(id) ON DELETE CASCADE,
  texto        TEXT,                       -- palabras clave / resumen OCR
  archivo_path TEXT,                       -- ruta de la muestra en el bucket (opcional)
  origen       VARCHAR(20) NOT NULL DEFAULT 'muestra',
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiporefs_tipo ON tipos_documentales_refs(tipo_id, created_at DESC);

ALTER TABLE tipos_documentales_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gh_read_tiporefs ON tipos_documentales_refs;
CREATE POLICY gh_read_tiporefs ON tipos_documentales_refs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS gh_write_tiporefs ON tipos_documentales_refs;
CREATE POLICY gh_write_tiporefs ON tipos_documentales_refs FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
