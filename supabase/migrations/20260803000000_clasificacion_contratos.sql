-- =============================================================================
-- CLASIFICACIÓN DE CONTRATOS
-- =============================================================================
-- 1) Tipo de contrato (Directo / Privado) a nivel de grupo y de sede.
--    La sede hereda del grupo si no tiene tipo propio (se resuelve en la app).
-- 2) Sistema de etiquetas flexible: categorías → valores → asignaciones,
--    aplicables a grupos y a sedes. Reutilizable por otros módulos.
-- =============================================================================

-- 1. Tipo de contrato ---------------------------------------------------------
ALTER TABLE grupos_contrato ADD COLUMN IF NOT EXISTS tipo_contrato TEXT
  CHECK (tipo_contrato IN ('DIRECTO', 'PRIVADO'));
ALTER TABLE sedes ADD COLUMN IF NOT EXISTS tipo_contrato TEXT
  CHECK (tipo_contrato IN ('DIRECTO', 'PRIVADO'));

-- 2. Categorías de etiquetas --------------------------------------------------
CREATE TABLE IF NOT EXISTS etiqueta_categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      VARCHAR(80) NOT NULL UNIQUE,
  descripcion TEXT,
  color       VARCHAR(20) DEFAULT 'gray',
  multiple    BOOLEAN DEFAULT true,       -- ¿se pueden asignar varias etiquetas de esta categoría?
  orden       INTEGER DEFAULT 0,
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Etiquetas (valores dentro de una categoría) ------------------------------
CREATE TABLE IF NOT EXISTS etiquetas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES etiqueta_categorias(id) ON DELETE CASCADE,
  nombre       VARCHAR(80) NOT NULL,
  color        VARCHAR(20),
  orden        INTEGER DEFAULT 0,
  activo       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (categoria_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_etiquetas_categoria ON etiquetas(categoria_id);

-- 4. Asignaciones (grupo y sede) ----------------------------------------------
CREATE TABLE IF NOT EXISTS grupo_etiquetas (
  grupo_id    UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  etiqueta_id UUID NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  PRIMARY KEY (grupo_id, etiqueta_id)
);
CREATE TABLE IF NOT EXISTS sede_etiquetas (
  sede_id     UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  etiqueta_id UUID NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  PRIMARY KEY (sede_id, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS idx_grupo_etiquetas_et ON grupo_etiquetas(etiqueta_id);
CREATE INDEX IF NOT EXISTS idx_sede_etiquetas_et  ON sede_etiquetas(etiqueta_id);

-- updated_at ------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_etiqueta_categorias_upd ON etiqueta_categorias;
CREATE TRIGGER tr_etiqueta_categorias_upd BEFORE UPDATE ON etiqueta_categorias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_etiquetas_upd ON etiquetas;
CREATE TRIGGER tr_etiquetas_upd BEFORE UPDATE ON etiquetas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: lectura para autenticados; escritura como contratos (ADMIN/SUPER_ADMIN) -
ALTER TABLE etiqueta_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE etiquetas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_etiquetas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sede_etiquetas      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['etiqueta_categorias','etiquetas','grupo_etiquetas','sede_etiquetas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format($p$CREATE POLICY %I_write ON %I FOR ALL TO authenticated
      USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
      WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))$p$, t, t);
  END LOOP;
END $$;

-- Categorías de ejemplo (idempotente; el usuario puede editarlas/borrarlas) ----
INSERT INTO etiqueta_categorias (nombre, descripcion, color, multiple, orden)
VALUES
  ('Modalidad',    'Modalidad del servicio en el contrato',     'blue',   true,  1),
  ('Riesgo',       'Nivel de riesgo / prioridad del contrato',  'amber',  false, 2),
  ('Facturación',  'Esquema de facturación del contrato',       'green',  false, 3)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO etiquetas (categoria_id, nombre, color, orden)
SELECT c.id, v.nombre, v.color, v.orden FROM etiqueta_categorias c
JOIN (VALUES
  ('Riesgo',      'Alto',   'red',    1),
  ('Riesgo',      'Medio',  'amber',  2),
  ('Riesgo',      'Bajo',   'green',  3),
  ('Facturación', 'Directa',           'green', 1),
  ('Facturación', 'Por administración','blue',  2)
) AS v(cat, nombre, color, orden) ON v.cat = c.nombre
ON CONFLICT (categoria_id, nombre) DO NOTHING;
