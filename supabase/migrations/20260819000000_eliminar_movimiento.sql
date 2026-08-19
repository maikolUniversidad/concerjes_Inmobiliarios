-- =============================================================================
-- ELIMINAR UN MOVIMIENTO REGISTRADO POR ERROR (revirtiendo el stock)
-- =============================================================================
-- `movimientos` es un ledger: solo tenía política de INSERT, así que un
-- registro equivocado no se podía quitar desde la aplicación. Esta función lo
-- borra y deshace su efecto en el stock central:
--
--   ENTRADA / DEVOLUCION → resta lo que había sumado
--   SALIDA               → devuelve lo que había restado
--   TRASLADO             → no tocó el stock, no hay nada que revertir
--   AJUSTE               → fijó el stock a un valor absoluto y no se guarda el
--                          valor anterior: se borra el registro SIN revertir y
--                          hay que corregir el stock con un nuevo ajuste.
--
-- SECURITY DEFINER para saltar la falta de política DELETE, pero valida el rol
-- del que llama: solo administración y bodega.
-- IDEMPOTENTE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_movimiento(
  p_mov      UUID,
  p_revertir BOOLEAN DEFAULT true
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_mov   movimientos%ROWTYPE;
  v_rev   BOOLEAN;
  v_nota  TEXT;
BEGIN
  IF public.auth_rol() NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO') THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar movimientos';
  END IF;

  SELECT * INTO v_mov FROM movimientos WHERE id = p_mov;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El movimiento no existe (puede que ya lo hayan eliminado)';
  END IF;

  v_rev := COALESCE(p_revertir, true) AND v_mov.tipo NOT IN ('AJUSTE', 'TRASLADO');

  IF v_rev THEN
    IF v_mov.tipo IN ('ENTRADA', 'DEVOLUCION') THEN
      UPDATE stock SET
        cantidad_real = GREATEST(0, cantidad_real - v_mov.cantidad),
        cantidad_disp = GREATEST(0, cantidad_disp - v_mov.cantidad),
        updated_at = NOW()
      WHERE producto_id = v_mov.producto_id;
    ELSIF v_mov.tipo = 'SALIDA' THEN
      UPDATE stock SET
        cantidad_real = cantidad_real + v_mov.cantidad,
        cantidad_disp = cantidad_disp + v_mov.cantidad,
        updated_at = NOW()
      WHERE producto_id = v_mov.producto_id;
    END IF;
  END IF;

  DELETE FROM movimientos WHERE id = p_mov;

  IF v_mov.tipo = 'AJUSTE' THEN
    v_nota := 'Movimiento eliminado. Era un AJUSTE (fijó el stock a un valor absoluto): revisa el stock del producto y corrígelo con un nuevo ajuste.';
  ELSIF v_mov.tipo = 'TRASLADO' THEN
    v_nota := 'Movimiento eliminado. El traslado no alteraba el stock central.';
  ELSIF v_rev THEN
    v_nota := 'Movimiento eliminado y stock revertido.';
  ELSE
    v_nota := 'Movimiento eliminado sin tocar el stock.';
  END IF;

  RETURN v_nota;
END $fn$;

GRANT EXECUTE ON FUNCTION public.eliminar_movimiento(UUID, BOOLEAN) TO authenticated;

-- Permiso de pantalla: quién ve el botón de eliminar en /movimientos.
UPDATE public.roles
   SET permisos = permisos || '{"eliminar_movimientos": true}'::jsonb
 WHERE rol_base IN ('SUPER_ADMIN','ADMIN','BODEGUERO')
    OR nombre IN ('Gerencia');
