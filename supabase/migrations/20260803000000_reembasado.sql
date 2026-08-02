-- =============================================================================
-- REEMBASADO / DECANTADO de productos
-- =============================================================================
-- Permite definir "recetas" de conversión de un producto en otros para llevar
-- el control del inventario cuando se reembasa: un cuñete/paquete grande se
-- reparte en varios pequeños (ej. 1 cuñete 20L → 40 botellas 500ml), o varios
-- pequeños se consolidan en uno grande (ej. 24 botellas → 1 caja, definiendo la
-- botella como origen). Modelo: 1 producto ORIGEN → N productos DESTINO.
--
-- Ejecutar una receta mueve el STOCK CENTRAL vía registrar_movimiento:
--   SALIDA del origen (cantidad_origen × veces) + ENTRADA de cada destino
--   (cantidad × veces). Todo en una transacción y trazable en `movimientos`.
-- =============================================================================

-- ── Receta (cabecera) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reembasados (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_origen_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre             VARCHAR(200) NOT NULL,
  descripcion        TEXT,
  cantidad_origen    NUMERIC(12,3) NOT NULL DEFAULT 1,   -- unidades del origen que consume cada ejecución
  activo             BOOLEAN DEFAULT true,
  created_by         UUID,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ck_reembasado_cantidad_origen CHECK (cantidad_origen > 0)
);
CREATE INDEX IF NOT EXISTS idx_reembasados_origen ON reembasados(producto_origen_id);

-- ── Productos destino de la receta ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reembasado_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reembasado_id       UUID NOT NULL REFERENCES reembasados(id) ON DELETE CASCADE,
  producto_destino_id UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad            NUMERIC(12,3) NOT NULL,             -- unidades del destino que se generan por ejecución
  CONSTRAINT ck_reembasado_item_cantidad CHECK (cantidad > 0),
  CONSTRAINT uq_reembasado_destino UNIQUE (reembasado_id, producto_destino_id)
);
CREATE INDEX IF NOT EXISTS idx_reembasado_items_recibe ON reembasado_items(producto_destino_id);

-- ── Historial de ejecuciones ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reembasado_ejecuciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reembasado_id UUID NOT NULL REFERENCES reembasados(id) ON DELETE CASCADE,
  veces         NUMERIC(12,3) NOT NULL,
  observacion   TEXT,
  usuario_id    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reembasado_ejec ON reembasado_ejecuciones(reembasado_id, created_at DESC);

-- updated_at
DROP TRIGGER IF EXISTS tr_reembasados_upd ON reembasados;
CREATE TRIGGER tr_reembasados_upd BEFORE UPDATE ON reembasados
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RPC: ejecutar una receta de reembasado (mueve stock central)
-- =============================================================================
-- SECURITY INVOKER: usa registrar_movimiento con los permisos del usuario, así
-- que solo quien puede mover stock (bodega/admin) puede reembasar — coherente
-- con que es una operación de bodega central.
CREATE OR REPLACE FUNCTION public.ejecutar_reembasado(
  p_reembasado  UUID,
  p_veces       NUMERIC DEFAULT 1,
  p_observacion TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rec      reembasados%ROWTYPE;
  v_item     RECORD;
  v_necesita NUMERIC;
  v_disp     NUMERIC;
  v_ejec     UUID;
  v_obs      TEXT;
BEGIN
  IF p_veces IS NULL OR p_veces <= 0 THEN
    RAISE EXCEPTION 'El número de veces debe ser mayor que cero';
  END IF;

  SELECT * INTO v_rec FROM reembasados WHERE id = p_reembasado AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receta de reembasado no encontrada o inactiva';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM reembasado_items WHERE reembasado_id = p_reembasado) THEN
    RAISE EXCEPTION 'La receta no tiene productos destino definidos';
  END IF;

  v_necesita := v_rec.cantidad_origen * p_veces;

  SELECT cantidad_disp INTO v_disp FROM stock WHERE producto_id = v_rec.producto_origen_id;
  IF COALESCE(v_disp, 0) < v_necesita THEN
    RAISE EXCEPTION 'Stock insuficiente del producto origen: disponible %, se requieren %',
      COALESCE(v_disp, 0), v_necesita;
  END IF;

  INSERT INTO reembasado_ejecuciones (reembasado_id, veces, observacion, usuario_id)
  VALUES (p_reembasado, p_veces, p_observacion, auth.uid())
  RETURNING id INTO v_ejec;

  v_obs := 'Reembasado ' || left(v_ejec::text, 8) || ' · ' || v_rec.nombre;
  IF p_observacion IS NOT NULL AND length(trim(p_observacion)) > 0 THEN
    v_obs := v_obs || ' · ' || p_observacion;
  END IF;

  -- SALIDA del producto origen
  PERFORM registrar_movimiento(v_rec.producto_origen_id, 'SALIDA', v_necesita, NULL, v_obs);

  -- ENTRADA de cada producto destino
  FOR v_item IN
    SELECT producto_destino_id, cantidad FROM reembasado_items WHERE reembasado_id = p_reembasado
  LOOP
    PERFORM registrar_movimiento(v_item.producto_destino_id, 'ENTRADA', v_item.cantidad * p_veces, NULL, v_obs);
  END LOOP;

  RETURN v_ejec;
END $$;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE reembasados            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reembasado_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reembasado_ejecuciones ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado
DROP POLICY IF EXISTS reembasados_read ON reembasados;
CREATE POLICY reembasados_read ON reembasados FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS reembasado_items_read ON reembasado_items;
CREATE POLICY reembasado_items_read ON reembasado_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS reembasado_ejec_read ON reembasado_ejecuciones;
CREATE POLICY reembasado_ejec_read ON reembasado_ejecuciones FOR SELECT TO authenticated USING (true);

-- Definir recetas: admin / bodeguero / supervisor
DROP POLICY IF EXISTS reembasados_write ON reembasados;
CREATE POLICY reembasados_write ON reembasados FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));
DROP POLICY IF EXISTS reembasado_items_write ON reembasado_items;
CREATE POLICY reembasado_items_write ON reembasado_items FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

-- Registrar ejecuciones: los mismos roles que pueden mover stock
DROP POLICY IF EXISTS reembasado_ejec_write ON reembasado_ejecuciones;
CREATE POLICY reembasado_ejec_write ON reembasado_ejecuciones FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','OPERADOR_SEDE','COORDINADOR_COMPRAS'));
