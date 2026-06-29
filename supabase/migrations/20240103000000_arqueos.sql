-- =============================================================================
-- Conserjes Inmobiliarios — Arqueo / Control de inventario físico
-- Conteo colaborativo en tiempo real, ajuste de diferencias, historial y reporte.
-- Idempotente.
-- =============================================================================

DO $$ BEGIN CREATE TYPE estado_arqueo AS ENUM ('ABIERTO','CERRADO','ANULADO'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE estado_conteo AS ENUM ('PENDIENTE','CONTADO','AJUSTADO'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Sesión de arqueo --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqueos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre               VARCHAR(200) NOT NULL,
  descripcion          TEXT,
  estado               estado_arqueo NOT NULL DEFAULT 'ABIERTO',
  filtro_tipo          tipo_insumo,                 -- alcance opcional (por tipo de insumo)
  total_items          INTEGER DEFAULT 0,
  items_contados       INTEGER DEFAULT 0,
  items_con_diferencia INTEGER DEFAULT 0,
  valor_diferencia     DECIMAL(16,2) DEFAULT 0,     -- impacto monetario al cerrar
  creado_por           UUID,
  cerrado_por          UUID,
  cerrado_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_arqueos_estado ON arqueos(estado, created_at DESC);

-- Línea de conteo por producto --------------------------------------------------
CREATE TABLE IF NOT EXISTS arqueo_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arqueo_id        UUID NOT NULL REFERENCES arqueos(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id),
  cantidad_sistema DECIMAL(12,2) NOT NULL DEFAULT 0,     -- foto del stock al iniciar
  cantidad_fisica  DECIMAL(12,2),                        -- contada (NULL = pendiente)
  diferencia       DECIMAL(12,2) GENERATED ALWAYS AS (COALESCE(cantidad_fisica,0) - cantidad_sistema) STORED,
  precio_lista     DECIMAL(12,2),                        -- foto del precio (para valorizar)
  estado           estado_conteo NOT NULL DEFAULT 'PENDIENTE',
  observacion      TEXT,
  contado_por      UUID,
  contado_por_nombre TEXT,
  contado_at       TIMESTAMPTZ,
  UNIQUE(arqueo_id, producto_id)
);
CREATE INDEX IF NOT EXISTS idx_arqueo_items_arqueo ON arqueo_items(arqueo_id);
CREATE INDEX IF NOT EXISTS idx_arqueo_items_estado ON arqueo_items(arqueo_id, estado);

DROP TRIGGER IF EXISTS tr_arqueos_upd ON arqueos;
CREATE TRIGGER tr_arqueos_upd BEFORE UPDATE ON arqueos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- FUNCIÓN: crear_arqueo — crea la sesión y toma la foto del inventario
-- =============================================================================
CREATE OR REPLACE FUNCTION public.crear_arqueo(
  p_nombre      TEXT,
  p_descripcion TEXT DEFAULT NULL,
  p_filtro      tipo_insumo DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  UUID;
  v_rol rol_usuario;
  v_n   INTEGER;
BEGIN
  v_rol := public.auth_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR') THEN
    RAISE EXCEPTION 'No tienes permisos para iniciar un arqueo';
  END IF;

  INSERT INTO arqueos (nombre, descripcion, filtro_tipo, creado_por)
  VALUES (p_nombre, p_descripcion, p_filtro, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO arqueo_items (arqueo_id, producto_id, cantidad_sistema, precio_lista)
  SELECT v_id, p.id, COALESCE(s.cantidad_real, 0), p.precio_lista
  FROM productos p
  LEFT JOIN stock s ON s.producto_id = p.id
  WHERE p.activo = true
    AND (p_filtro IS NULL OR p.tipo_insumo = p_filtro);

  SELECT count(*) INTO v_n FROM arqueo_items WHERE arqueo_id = v_id;
  UPDATE arqueos SET total_items = v_n WHERE id = v_id;

  RETURN v_id;
END $$;

-- =============================================================================
-- FUNCIÓN: contar_item — registra el conteo físico de una línea (colaborativo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.contar_item(
  p_item     UUID,
  p_cantidad DECIMAL,
  p_obs      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol    rol_usuario;
  v_estado estado_arqueo;
  v_nombre TEXT;
BEGIN
  v_rol := public.auth_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','OPERADOR_SEDE','COORDINADOR_COMPRAS') THEN
    RAISE EXCEPTION 'No tienes permisos para contar';
  END IF;

  SELECT a.estado INTO v_estado FROM arqueos a JOIN arqueo_items i ON i.arqueo_id = a.id WHERE i.id = p_item;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'Ítem de arqueo no encontrado'; END IF;
  IF v_estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El arqueo ya está cerrado'; END IF;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = auth.uid();

  UPDATE arqueo_items
  SET cantidad_fisica = p_cantidad,
      observacion = p_obs,
      estado = 'CONTADO',
      contado_por = auth.uid(),
      contado_por_nombre = COALESCE(v_nombre, 'Usuario'),
      contado_at = NOW()
  WHERE id = p_item;
END $$;

-- =============================================================================
-- FUNCIÓN: cerrar_arqueo — aplica los ajustes de stock y valoriza diferencias
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cerrar_arqueo(p_arqueo UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol   rol_usuario;
  v_estado estado_arqueo;
  v_nombre TEXT;
  r RECORD;
  v_con_dif INTEGER := 0;
  v_valor   DECIMAL(16,2) := 0;
BEGIN
  v_rol := public.auth_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR') THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar el arqueo';
  END IF;

  SELECT estado, nombre INTO v_estado, v_nombre FROM arqueos WHERE id = p_arqueo;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'Arqueo no encontrado'; END IF;
  IF v_estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El arqueo ya fue cerrado'; END IF;

  -- Aplica ajustes solo a ítems contados con diferencia
  FOR r IN
    SELECT id, producto_id, cantidad_fisica, diferencia, COALESCE(precio_lista,0) precio
    FROM arqueo_items
    WHERE arqueo_id = p_arqueo AND estado = 'CONTADO' AND diferencia <> 0
  LOOP
    INSERT INTO movimientos (tipo, producto_id, cantidad, observacion, usuario_id, ia_origen)
    VALUES ('AJUSTE', r.producto_id, r.cantidad_fisica, 'Arqueo: ' || v_nombre, auth.uid(), false);

    INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
    VALUES (r.producto_id, r.cantidad_fisica, r.cantidad_fisica)
    ON CONFLICT (producto_id) DO UPDATE
      SET cantidad_real = EXCLUDED.cantidad_real,
          cantidad_disp = EXCLUDED.cantidad_disp,
          updated_at = NOW();

    UPDATE arqueo_items SET estado = 'AJUSTADO' WHERE id = r.id;
    v_con_dif := v_con_dif + 1;
    v_valor := v_valor + (r.diferencia * r.precio);
  END LOOP;

  UPDATE arqueos
  SET estado = 'CERRADO',
      cerrado_por = auth.uid(),
      cerrado_at = NOW(),
      items_contados = (SELECT count(*) FROM arqueo_items WHERE arqueo_id = p_arqueo AND estado IN ('CONTADO','AJUSTADO')),
      items_con_diferencia = v_con_dif,
      valor_diferencia = v_valor
  WHERE id = p_arqueo;
END $$;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE arqueos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqueo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_arqueos ON arqueos;
CREATE POLICY auth_read_arqueos ON arqueos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_arqueo_items ON arqueo_items;
CREATE POLICY auth_read_arqueo_items ON arqueo_items FOR SELECT TO authenticated USING (true);
-- Las escrituras se hacen vía funciones SECURITY DEFINER (crear/contar/cerrar).

-- =============================================================================
-- REALTIME — conteo colaborativo en vivo
-- =============================================================================
ALTER TABLE arqueo_items REPLICA IDENTITY FULL;
ALTER TABLE arqueos      REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arqueo_items;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arqueos;
EXCEPTION WHEN duplicate_object THEN null; END $$;
