-- =============================================================================
-- Conserjes Inmobiliarios — Versionado / Historial + Cargas masivas
-- Idempotente. Agrega:
--   1. historial_cambios: registro automático (antes/después) de TODO cambio
--      en las tablas clave, vía trigger genérico.
--   2. importaciones: historial de cargas masivas (lotes).
-- =============================================================================

-- =============================================================================
-- HISTORIAL DE CAMBIOS (versionado de todo)
-- =============================================================================
CREATE TABLE IF NOT EXISTS historial_cambios (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabla            TEXT NOT NULL,
  registro_id      TEXT NOT NULL,
  accion           TEXT NOT NULL,                 -- INSERT | UPDATE | DELETE
  datos_anteriores JSONB,
  datos_nuevos     JSONB,
  campos_cambiados TEXT[],
  usuario_id       UUID,
  usuario_email    TEXT,
  origen           TEXT,                          -- app | import (app.origen)
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_historial_tabla_reg ON historial_cambios(tabla, registro_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historial_created   ON historial_cambios(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historial_usuario   ON historial_cambios(usuario_id);

-- Función de trigger genérica
CREATE OR REPLACE FUNCTION public.registrar_historial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old   JSONB;
  v_new   JSONB;
  v_id    TEXT;
  v_campos TEXT[];
  v_uid   UUID;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_id := OLD.id::text;
  ELSIF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_id := NEW.id::text;
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := NEW.id::text;
    SELECT array_agg(n.key) INTO v_campos
    FROM jsonb_each(v_new) n
    WHERE n.key <> 'updated_at'
      AND n.value IS DISTINCT FROM (v_old -> n.key);
    -- Si solo cambió updated_at, no registramos ruido
    IF v_campos IS NULL OR array_length(v_campos, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO historial_cambios (tabla, registro_id, accion, datos_anteriores, datos_nuevos, campos_cambiados, usuario_id, usuario_email, origen)
  VALUES (TG_TABLE_NAME, v_id, TG_OP, v_old, v_new, v_campos, v_uid, v_email, current_setting('app.origen', true));

  RETURN COALESCE(NEW, OLD);
END $$;

-- Helper para crear el trigger en cada tabla sin repetir
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY['productos','usuarios','proveedores','sedes','stock','ordenes_compra','oc_items','grupos_contrato','precios_proveedor'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tr_hist_%1$s ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_hist_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.registrar_historial()', t);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- IMPORTACIONES (historial de cargas masivas)
-- =============================================================================
CREATE TABLE IF NOT EXISTS importaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad        TEXT NOT NULL,                  -- productos | usuarios | proveedores
  archivo_nombre TEXT,
  total          INTEGER DEFAULT 0,
  creados        INTEGER DEFAULT 0,
  actualizados   INTEGER DEFAULT 0,
  errores        INTEGER DEFAULT 0,
  detalle        JSONB,
  usuario_id     UUID,
  usuario_email  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_importaciones_created ON importaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_importaciones_entidad ON importaciones(entidad);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE historial_cambios ENABLE ROW LEVEL SECURITY;
ALTER TABLE importaciones      ENABLE ROW LEVEL SECURITY;

-- Lectura para autenticados (la escritura de historial es por trigger DEFINER)
DROP POLICY IF EXISTS auth_read_historial ON historial_cambios;
CREATE POLICY auth_read_historial ON historial_cambios FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_importaciones ON importaciones;
CREATE POLICY auth_read_importaciones ON importaciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_insert_importaciones ON importaciones;
CREATE POLICY auth_insert_importaciones ON importaciones FOR INSERT TO authenticated WITH CHECK (true);
