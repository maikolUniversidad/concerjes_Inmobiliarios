-- =============================================================================
-- registrar_movimiento + ubicación física (enlaza el movimiento a una estantería)
-- Reemplaza la función agregando p_ubicacion (opcional). Idempotente.
-- =============================================================================
DROP FUNCTION IF EXISTS public.registrar_movimiento(UUID, tipo_movimiento, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_producto    UUID,
  p_tipo        tipo_movimiento,
  p_cantidad    NUMERIC,
  p_sede        UUID DEFAULT NULL,
  p_observacion TEXT DEFAULT NULL,
  p_ubicacion   UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  INSERT INTO movimientos (tipo, producto_id, cantidad, sede_id, ubicacion_id, observacion, usuario_id)
  VALUES (p_tipo, p_producto, p_cantidad, p_sede, p_ubicacion, p_observacion, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
  VALUES (p_producto, 0, 0)
  ON CONFLICT (producto_id) DO NOTHING;

  IF p_tipo = 'AJUSTE' THEN
    UPDATE stock SET cantidad_real = p_cantidad, cantidad_disp = p_cantidad, updated_at = NOW()
    WHERE producto_id = p_producto;
  ELSIF p_tipo IN ('ENTRADA', 'DEVOLUCION') THEN
    UPDATE stock SET cantidad_real = cantidad_real + p_cantidad, cantidad_disp = cantidad_disp + p_cantidad, updated_at = NOW()
    WHERE producto_id = p_producto;
  ELSIF p_tipo = 'SALIDA' THEN
    UPDATE stock SET cantidad_real = GREATEST(0, cantidad_real - p_cantidad), cantidad_disp = GREATEST(0, cantidad_disp - p_cantidad), updated_at = NOW()
    WHERE producto_id = p_producto;
  END IF;

  RETURN v_id;
END $$;
