-- =============================================================================
-- DEVOLUCIONES DE ÓRDENES DE INSUMO
-- =============================================================================
-- La sede devuelve parte de un pedido ya despachado (sobrantes, producto
-- averiado, referencia equivocada…). Se registra QUÉ productos y CUÁNTO se
-- devolvió de esa orden, quién lo registró y por qué. Si el producto vuelve
-- utilizable a la bodega, se suma al stock central con un movimiento
-- DEVOLUCION; si viene averiado, queda el registro pero NO reingresa stock.
--
-- Una orden puede tener varias devoluciones (parciales, en fechas distintas).
-- El tope por ítem es lo que realmente salió: cantidad_alistada - devuelto.
-- IDEMPOTENTE.
-- =============================================================================

-- ── Acumulado devuelto por ítem (para el tope y para mostrarlo en pantalla) ──
ALTER TABLE orden_insumo_items
  ADD COLUMN IF NOT EXISTS cantidad_devuelta NUMERIC(12,3) NOT NULL DEFAULT 0;

-- ── Devolución (cabecera) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_devoluciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id          UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  motivo            VARCHAR(30) NOT NULL,   -- SOBRANTE | AVERIADO | ERRADO | NO_REQUERIDO | OTRO
  observacion       TEXT,
  -- false = el producto NO vuelve utilizable (averiado/vencido): no suma stock.
  reingresa_stock   BOOLEAN NOT NULL DEFAULT true,
  total_unidades    NUMERIC(12,3) NOT NULL DEFAULT 0,
  registrado_por    UUID,
  registrado_nombre VARCHAR(200),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oi_dev_orden ON orden_insumo_devoluciones(orden_id, created_at DESC);

-- ── Productos y cantidades devueltas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_devolucion_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id UUID NOT NULL REFERENCES orden_insumo_devoluciones(id) ON DELETE CASCADE,
  item_id       UUID REFERENCES orden_insumo_items(id) ON DELETE SET NULL,
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad      NUMERIC(12,3) NOT NULL,
  CONSTRAINT ck_oi_dev_item_cantidad CHECK (cantidad > 0),
  CONSTRAINT uq_oi_dev_item UNIQUE (devolucion_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_oi_dev_items_dev ON orden_insumo_devolucion_items(devolucion_id);

-- =============================================================================
-- RPC: registrar una devolución completa (cabecera + ítems + stock) atómica
-- =============================================================================
-- SECURITY INVOKER: reingresar stock exige los mismos permisos que cualquier
-- otro movimiento de bodega, así que la RLS decide quién puede devolver.
--   p_items = [{"item_id": "<uuid>", "cantidad": 3}, ...]
CREATE OR REPLACE FUNCTION public.registrar_devolucion_oi(
  p_orden       UUID,
  p_motivo      VARCHAR,
  p_items       JSONB,
  p_observacion TEXT DEFAULT NULL,
  p_reingresa   BOOLEAN DEFAULT true
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_orden   ordenes_insumo%ROWTYPE;
  v_dev     UUID;
  v_row     RECORD;
  v_item    orden_insumo_items%ROWTYPE;
  v_saldo   NUMERIC;
  v_total   NUMERIC := 0;
  v_motivo  VARCHAR(30);
  v_reing   BOOLEAN;
  v_nombre  VARCHAR(200);
  v_obs     TEXT;
BEGIN
  v_motivo := COALESCE(NULLIF(trim(p_motivo), ''), 'OTRO');
  v_reing  := COALESCE(p_reingresa, true);

  SELECT * INTO v_orden FROM ordenes_insumo WHERE id = p_orden;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_orden.estado::text NOT IN ('DESPACHADO','EN_RUTA','ENTREGADO','RECIBIDO') THEN
    RAISE EXCEPTION 'Solo se registran devoluciones de órdenes ya despachadas';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos un producto para devolver';
  END IF;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = auth.uid();

  INSERT INTO orden_insumo_devoluciones
    (orden_id, motivo, observacion, reingresa_stock, registrado_por, registrado_nombre)
  VALUES
    (p_orden, v_motivo, NULLIF(trim(p_observacion), ''), v_reing, auth.uid(), v_nombre)
  RETURNING id INTO v_dev;

  v_obs := 'Devolución orden ' || v_orden.numero || ' · ' || v_motivo;

  FOR v_row IN
    SELECT (e->>'item_id')::UUID AS item_id, (e->>'cantidad')::NUMERIC AS cantidad
    FROM jsonb_array_elements(p_items) e
  LOOP
    CONTINUE WHEN v_row.cantidad IS NULL OR v_row.cantidad <= 0;

    SELECT * INTO v_item FROM orden_insumo_items WHERE id = v_row.item_id AND orden_id = p_orden;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El ítem seleccionado no pertenece a esta orden';
    END IF;

    -- Solo se puede devolver lo que realmente salió y aún no se ha devuelto.
    v_saldo := COALESCE(v_item.cantidad_alistada, 0) - COALESCE(v_item.cantidad_devuelta, 0);
    IF v_row.cantidad > v_saldo THEN
      RAISE EXCEPTION 'No puedes devolver % unidades: de ese producto solo quedan % por devolver',
        v_row.cantidad, v_saldo;
    END IF;

    INSERT INTO orden_insumo_devolucion_items (devolucion_id, item_id, producto_id, cantidad)
    VALUES (v_dev, v_item.id, v_item.producto_id, v_row.cantidad);

    UPDATE orden_insumo_items
       SET cantidad_devuelta = COALESCE(cantidad_devuelta, 0) + v_row.cantidad
     WHERE id = v_item.id;

    -- Reingreso a bodega central (no aplica si el producto vino averiado).
    IF v_reing THEN
      PERFORM registrar_movimiento(v_item.producto_id, 'DEVOLUCION', v_row.cantidad, v_orden.sede_id, v_obs, NULL);
    END IF;

    v_total := v_total + v_row.cantidad;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Selecciona al menos un producto con cantidad para devolver';
  END IF;

  UPDATE orden_insumo_devoluciones SET total_unidades = v_total WHERE id = v_dev;

  PERFORM oi_evento(
    p_orden, 'DEVOLUCION',
    'Devolución de ' || v_total || ' unidad(es) · ' || v_motivo
      || CASE WHEN v_reing THEN ' · reingresó a bodega' ELSE ' · NO reingresa a stock' END,
    NULL, NULL,
    jsonb_build_object('devolucion_id', v_dev, 'total', v_total, 'motivo', v_motivo, 'reingresa', v_reing)
  );

  RETURN v_dev;
END $fn$;

GRANT EXECUTE ON FUNCTION public.registrar_devolucion_oi(UUID, VARCHAR, JSONB, TEXT, BOOLEAN) TO authenticated;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE orden_insumo_devoluciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_devolucion_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oi_dev_read ON orden_insumo_devoluciones;
CREATE POLICY oi_dev_read ON orden_insumo_devoluciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_dev_items_read ON orden_insumo_devolucion_items;
CREATE POLICY oi_dev_items_read ON orden_insumo_devolucion_items FOR SELECT TO authenticated USING (true);

-- Escritura: los mismos roles que alistan y despachan.
DROP POLICY IF EXISTS oi_dev_write ON orden_insumo_devoluciones;
CREATE POLICY oi_dev_write ON orden_insumo_devoluciones FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_dev_items_write ON orden_insumo_devolucion_items;
CREATE POLICY oi_dev_items_write ON orden_insumo_devolucion_items FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
