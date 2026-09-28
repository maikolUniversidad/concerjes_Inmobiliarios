-- =============================================================================
-- STOCK DISPONIBLE REAL · reservas de las órdenes de insumo aprobadas
-- =============================================================================
-- Hasta ahora `stock.cantidad_disp` era una copia de `cantidad_real`: todos los
-- escritores (registrar_movimiento, cerrar_arqueo, aplicar_inventario_fisico,
-- importadores...) las igualaban. El "disponible" de verdad solo existía en la
-- vista v_stock_proyectado.
--
-- REGLA (la misma lista positiva de v_stock_proyectado, v_demanda_ordenes_insumo
-- y v_recomendacion_compra, para que todas las cifras cuadren):
--
--   · BORRADOR ............................ no reserva (es un borrador).
--   · EN_REVISION, CAMBIOS_SOLICITADOS,
--     APROBADA, PENDIENTE,
--     EN_ALISTAMIENTO, ALISTADO ........... RESERVA `cantidad_solicitada`: la
--                                           mercancía está comprometida pero
--                                           sigue físicamente en bodega.
--   · DESPACHADO, EN_RUTA, ENTREGADO,
--     RECIBIDO ............................ ya salió: la reserva se libera y el
--                                           stock real ya bajó con el movimiento
--                                           SALIDA que registra el despacho.
--   · ANULADA ............................. libera la reserva.
--
--   cantidad_real = lo que hay físicamente en bodega (no cambia al aprobar).
--   cantidad_disp = cantidad_real − reservado  (puede ser NEGATIVO: se pidió
--                   más de lo que hay).
--
-- EN_REVISION cuenta porque la orden ya salió de borrador y está a la espera de
-- las firmas: si no se reserva desde ahí, dos sedes pueden "ganarse" el mismo
-- stock mientras se aprueban.
--
-- Mecanismo:
--   1. BEFORE INSERT/UPDATE en `stock`: fija cantidad_disp = real − reservado.
--      Así cualquier escritor queda correcto sin tocarlo.
--   2. AFTER en `ordenes_insumo` (cambio de estado) y en `orden_insumo_items`
--      (alta/baja/cambio de cantidad o producto): recalcula los productos
--      afectados, solo si el valor cambia (nada de UPDATE vacíos).
--   3. Backfill de todo el stock.
--   4. Realtime para stock / ordenes_insumo / orden_insumo_items: las tablas de
--      la app se refrescan en vivo.
--   5. historial_cambios: el recálculo de la reserva NO se registra como cambio
--      de stock (sería una fila por producto en cada aprobación); la aprobación
--      ya queda en la trazabilidad de la orden.
--   6. ejecutar_reembasado valida contra el stock FÍSICO (cantidad_real), como
--      hacía antes de este cambio: reembasar no es una salida de bodega.
-- =============================================================================

-- Índice para sumar la reserva por producto sin recorrer todos los ítems.
CREATE INDEX IF NOT EXISTS idx_oi_items_producto ON public.orden_insumo_items (producto_id);

-- ── 1. Cuánto está reservado de un producto ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.stock_reservado(p_producto UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(oii.cantidad_solicitada), 0)::numeric
  FROM orden_insumo_items oii
  JOIN ordenes_insumo oi ON oi.id = oii.orden_id
  WHERE oii.producto_id = p_producto
    AND oi.estado IN (
      'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
      'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'
    );
$$;

-- ¿Este estado reserva stock? (misma lista que arriba)
CREATE OR REPLACE FUNCTION public.estado_orden_reserva(p_estado TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_estado IN (
    'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
    'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'
  );
$$;

-- ── Recalcula cantidad_disp de unos productos (solo si cambia) ────────────────
CREATE OR REPLACE FUNCTION public.recalcular_stock_disponible(p_productos UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_productos IS NULL OR array_length(p_productos, 1) IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE stock s
     SET cantidad_disp = s.cantidad_real - stock_reservado(s.producto_id)
   WHERE s.producto_id = ANY (p_productos)
     AND s.cantidad_disp IS DISTINCT FROM s.cantidad_real - stock_reservado(s.producto_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.stock_reservado(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recalcular_stock_disponible(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_reservado(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalcular_stock_disponible(UUID[]) TO authenticated;

-- ── Trigger en stock: todo escritor deja el disponible correcto ──────────────
CREATE OR REPLACE FUNCTION public.tr_stock_fijar_disponible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.cantidad_disp := COALESCE(NEW.cantidad_real, 0) - stock_reservado(NEW.producto_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_stock_disponible ON public.stock;
CREATE TRIGGER tr_stock_disponible
  BEFORE INSERT OR UPDATE ON public.stock
  FOR EACH ROW EXECUTE FUNCTION public.tr_stock_fijar_disponible();

-- ── 2a. Cambio de estado de la orden ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tr_oi_estado_reserva()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo importa si la orden entra o sale de la lista de estados que reservan.
  IF estado_orden_reserva(OLD.estado::text) IS DISTINCT FROM estado_orden_reserva(NEW.estado::text) THEN
    PERFORM recalcular_stock_disponible(ARRAY(
      SELECT DISTINCT producto_id FROM orden_insumo_items WHERE orden_id = NEW.id
    ));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_oi_reserva_estado ON public.ordenes_insumo;
CREATE TRIGGER tr_oi_reserva_estado
  AFTER UPDATE OF estado ON public.ordenes_insumo
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.tr_oi_estado_reserva();

-- ── 2b. Ítems: alta, baja, cambio de cantidad / producto / orden ─────────────
CREATE OR REPLACE FUNCTION public.tr_oi_items_reserva()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recalcular_stock_disponible(ARRAY[NEW.producto_id]);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recalcular_stock_disponible(ARRAY[OLD.producto_id]);
  ELSE
    PERFORM recalcular_stock_disponible(ARRAY[OLD.producto_id, NEW.producto_id]);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_oi_items_reserva_ins ON public.orden_insumo_items;
CREATE TRIGGER tr_oi_items_reserva_ins
  AFTER INSERT ON public.orden_insumo_items
  FOR EACH ROW EXECUTE FUNCTION public.tr_oi_items_reserva();

DROP TRIGGER IF EXISTS tr_oi_items_reserva_del ON public.orden_insumo_items;
CREATE TRIGGER tr_oi_items_reserva_del
  AFTER DELETE ON public.orden_insumo_items
  FOR EACH ROW EXECUTE FUNCTION public.tr_oi_items_reserva();

DROP TRIGGER IF EXISTS tr_oi_items_reserva_upd ON public.orden_insumo_items;
CREATE TRIGGER tr_oi_items_reserva_upd
  AFTER UPDATE OF cantidad_solicitada, producto_id, orden_id ON public.orden_insumo_items
  FOR EACH ROW
  WHEN (OLD.cantidad_solicitada IS DISTINCT FROM NEW.cantidad_solicitada
     OR OLD.producto_id IS DISTINCT FROM NEW.producto_id
     OR OLD.orden_id IS DISTINCT FROM NEW.orden_id)
  EXECUTE FUNCTION public.tr_oi_items_reserva();

-- ── 5. Historial de stock sin el ruido del recálculo de reservas ─────────────
-- Antes: un solo trigger AFTER INSERT/UPDATE/DELETE. Se parte en dos para que
-- el UPDATE solo se registre cuando cambia algo distinto del disponible.
DROP TRIGGER IF EXISTS tr_hist_stock ON public.stock;
CREATE TRIGGER tr_hist_stock
  AFTER INSERT OR DELETE ON public.stock
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historial();

DROP TRIGGER IF EXISTS tr_hist_stock_upd ON public.stock;
CREATE TRIGGER tr_hist_stock_upd
  AFTER UPDATE ON public.stock
  FOR EACH ROW
  WHEN ((OLD.producto_id, OLD.cantidad_real, OLD.cantidad_entr, OLD.cantidad_sal)
        IS DISTINCT FROM
        (NEW.producto_id, NEW.cantidad_real, NEW.cantidad_entr, NEW.cantidad_sal))
  EXECUTE FUNCTION public.registrar_historial();

-- ── 6. Reembasado: valida contra el stock físico ─────────────────────────────
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

  -- Stock físico: cantidad_disp ahora descuenta las reservas de las órdenes.
  SELECT cantidad_real INTO v_disp FROM stock WHERE producto_id = v_rec.producto_origen_id;
  IF COALESCE(v_disp, 0) < v_necesita THEN
    RAISE EXCEPTION 'Stock insuficiente del producto origen: en bodega %, se requieren %',
      COALESCE(v_disp, 0), v_necesita;
  END IF;

  INSERT INTO reembasado_ejecuciones (reembasado_id, veces, observacion, usuario_id)
  VALUES (p_reembasado, p_veces, p_observacion, auth.uid())
  RETURNING id INTO v_ejec;

  v_obs := 'Reembasado ' || left(v_ejec::text, 8) || ' · ' || v_rec.nombre;
  IF p_observacion IS NOT NULL AND length(trim(p_observacion)) > 0 THEN
    v_obs := v_obs || ' · ' || p_observacion;
  END IF;

  PERFORM registrar_movimiento(v_rec.producto_origen_id, 'SALIDA', v_necesita, NULL, v_obs);

  FOR v_item IN
    SELECT producto_destino_id, cantidad FROM reembasado_items WHERE reembasado_id = p_reembasado
  LOOP
    PERFORM registrar_movimiento(v_item.producto_destino_id, 'ENTRADA', v_item.cantidad * p_veces, NULL, v_obs);
  END LOOP;

  RETURN v_ejec;
END $$;

-- ── 3. Backfill (sin registrar historial: es el cambio de regla, no un movimiento)
UPDATE public.stock s
   SET cantidad_disp = s.cantidad_real - public.stock_reservado(s.producto_id)
 WHERE s.cantidad_disp IS DISTINCT FROM s.cantidad_real - public.stock_reservado(s.producto_id);

-- ── 4. Realtime ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['stock', 'ordenes_insumo', 'orden_insumo_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
