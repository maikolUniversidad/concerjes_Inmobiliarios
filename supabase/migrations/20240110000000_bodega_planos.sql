-- =============================================================================
-- Conserjes Inmobiliarios — Diseñador de planos de bodega (por pisos)
--
-- Cada bodega puede tener varios PISOS. Cada piso guarda sus dimensiones reales
-- (en metros), la escala del editor y el conjunto de ELEMENTOS dibujados
-- (estantes, zonas de almacenamiento, puertas, escaleras, paredes, etc.) como
-- JSONB. Los elementos usan coordenadas y medidas en metros; opcionalmente un
-- elemento puede enlazarse a una `ubicaciones` (ubicacion_id dentro del JSON).
--
-- IDEMPOTENTE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bodega_pisos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bodega_id  UUID NOT NULL REFERENCES bodegas(id) ON DELETE CASCADE,
  numero     INTEGER NOT NULL DEFAULT 1,          -- 1 = planta baja, 2 = piso 2 …
  nombre     VARCHAR(120),                        -- "Planta baja", "Mezzanine"…
  ancho_m    NUMERIC(8,2) NOT NULL DEFAULT 20,    -- ancho real del plano (m)
  alto_m     NUMERIC(8,2) NOT NULL DEFAULT 15,    -- alto real del plano (m)
  escala     NUMERIC(6,2) NOT NULL DEFAULT 40,    -- px por metro en el editor
  fondo_url  TEXT,                                -- imagen de fondo opcional (plano escaneado)
  elementos  JSONB NOT NULL DEFAULT '[]',         -- [{ id,tipo,x,y,w,h,rot,etiqueta,color,ubicacion_id }]
  orden      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (bodega_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_bodega_pisos_bodega ON bodega_pisos(bodega_id, numero);

-- updated_at
DROP TRIGGER IF EXISTS tr_bodega_pisos_upd ON bodega_pisos;
CREATE TRIGGER tr_bodega_pisos_upd BEFORE UPDATE ON bodega_pisos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historial/versionado si existe la función
DO $$ BEGIN
  IF to_regproc('public.registrar_historial') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tr_hist_bodega_pisos ON public.bodega_pisos;
    CREATE TRIGGER tr_hist_bodega_pisos AFTER INSERT OR UPDATE OR DELETE ON public.bodega_pisos
      FOR EACH ROW EXECUTE FUNCTION public.registrar_historial();
  END IF;
END $$;

-- =============================================================================
-- RLS — igual que bodegas: lectura autenticada, escritura roles de bodega
-- =============================================================================
ALTER TABLE bodega_pisos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_bodega_pisos ON bodega_pisos;
CREATE POLICY auth_read_bodega_pisos ON bodega_pisos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS write_bodega_pisos ON bodega_pisos;
CREATE POLICY write_bodega_pisos ON bodega_pisos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

-- =============================================================================
-- SEED: crea un piso 1 por cada bodega que aún no tenga pisos
-- =============================================================================
INSERT INTO bodega_pisos (bodega_id, numero, nombre)
SELECT b.id, 1, 'Planta baja'
FROM bodegas b
WHERE NOT EXISTS (SELECT 1 FROM bodega_pisos p WHERE p.bodega_id = b.id);
