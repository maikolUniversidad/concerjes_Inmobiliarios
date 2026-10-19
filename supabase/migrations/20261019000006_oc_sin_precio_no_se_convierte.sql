-- =============================================================================
-- COMPRAS — una orden de compra no puede nacer con una línea en $0
-- =============================================================================
-- `sc_convertir_a_oc()` valoraba cada línea con `COALESCE(s.precio, 0)`: si el
-- producto tenía proveedor pero ningún precio —ni cotización vigente en el
-- comparador ni precio de lista en su ficha— la orden nacía con esa línea en
-- cero, y `oc_items` no tenía nada que lo impidiera.
--
-- Medido antes de escribir esto: hay 6 productos activos con proveedor
-- sugerido y sin precio, y 1 de ellos está en la recomendación de compra de
-- hoy. Líneas de orden en cero que ya existan: ninguna (3 líneas en total), así
-- que la restricción entra validando el histórico sin excepciones.
--
-- Qué hace:
--   1. `oc_items.precio_unit > 0` como restricción de tabla, para que ningún
--      camino —la conversión, el formulario de OC o un script— pueda escribir
--      una línea sin precio.
--   2. La conversión trata «sin precio» igual que ya trataba «sin proveedor»:
--      no convierte el ítem, lo deja en la solicitud y lo cuenta aparte en
--      `sin_precio`. Así la solicitud queda PARCIAL y se ve qué falta, en vez
--      de reventar contra la restricción nueva a mitad de la conversión.
--
-- La función se reescribe completa a propósito: es la que está hoy en la base
-- (`pg_get_functiondef`), con el filtro de precio añadido en los tres sitios
-- donde ya se filtraba por proveedor.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ── 1. Ninguna línea de orden sin precio ─────────────────────────────────────
ALTER TABLE oc_items DROP CONSTRAINT IF EXISTS oc_items_precio_positivo;
ALTER TABLE oc_items ADD  CONSTRAINT oc_items_precio_positivo CHECK (precio_unit > 0);

COMMENT ON CONSTRAINT oc_items_precio_positivo ON oc_items IS
  'Una orden de compra dice cuánto se va a pagar: sin precio no hay línea.';

-- ── 2. La conversión deja fuera lo que no tiene precio ───────────────────────
CREATE OR REPLACE FUNCTION public.sc_convertir_a_oc(p_solicitud uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_sol       RECORD;
  v_grupo     RECORD;
  v_linea     RECORD;
  v_oc        UUID;
  v_numero    TEXT;
  v_prefijo   TEXT := 'OC-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  v_cons      INT;
  v_valor     NUMERIC;
  v_out       JSONB := '[]'::JSONB;
  v_sin_prov  INT := 0;
  v_sin_precio INT := 0;
  v_ordenes   INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('crear_ordenes_compra') THEN
    RAISE EXCEPTION 'Convertir una solicitud en orden de compra requiere el permiso de crear órdenes de compra.' USING ERRCODE = '42501';
  END IF;

  SELECT id, numero, estado::TEXT AS estado, observacion
    INTO v_sol
    FROM solicitudes_compra
   WHERE id = p_solicitud
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud de compra no existe.';
  END IF;
  IF v_sol.estado IN ('CONVERTIDA', 'RECHAZADA', 'ANULADA') THEN
    RAISE EXCEPTION 'La solicitud % está en estado % y ya no se puede convertir.', v_sol.numero, v_sol.estado;
  END IF;

  -- Productos pendientes sin proveedor: se informan y se dejan quietos.
  SELECT COUNT(*)
    INTO v_sin_prov
    FROM solicitud_compra_items si
    CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
   WHERE si.solicitud_id = p_solicitud
     AND si.cantidad_convertida < si.cantidad
     AND s.proveedor_id IS NULL;

  -- Con proveedor pero sin precio: tampoco se convierten. Una linea a 0 seria
  -- una orden de compra que no dice cuanto se va a pagar.
  SELECT COUNT(*)
    INTO v_sin_precio
    FROM solicitud_compra_items si
    CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
   WHERE si.solicitud_id = p_solicitud
     AND si.cantidad_convertida < si.cantidad
     AND s.proveedor_id IS NOT NULL
     AND COALESCE(s.precio, 0) <= 0;

  FOR v_grupo IN
    SELECT s.proveedor_id,
           SUM((si.cantidad - si.cantidad_convertida) * COALESCE(s.precio, 0)) AS valor
      FROM solicitud_compra_items si
      CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
     WHERE si.solicitud_id = p_solicitud
       AND si.cantidad_convertida < si.cantidad
       AND s.proveedor_id IS NOT NULL
       AND COALESCE(s.precio, 0) > 0
     GROUP BY s.proveedor_id
  LOOP
    v_oc := NULL;
    v_cons := public.oc_siguiente_consecutivo(v_prefijo);
    FOR i IN 1..15 LOOP
      BEGIN
        v_numero := v_prefijo || lpad(v_cons::TEXT, 3, '0');
        INSERT INTO ordenes_compra (
          numero_oc, proveedor_id, periodo, estado, valor_total, observaciones,
          creado_por, solicitud_id, bodega_destino_id
        ) VALUES (
          v_numero, v_grupo.proveedor_id, date_trunc('month', CURRENT_DATE)::DATE,
          -- El valor ya viene calculado del agrupado: insertarlo de una evita un
          -- UPDATE que dispararía un evento de EDICIÓN falso en la trazabilidad.
          'BORRADOR', v_grupo.valor,
          'Generada desde la solicitud de compra ' || v_sol.numero || '.',
          v_uid, p_solicitud, public.compras_bodega_central()
        ) RETURNING id INTO v_oc;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_cons := GREATEST(v_cons + 1, public.oc_siguiente_consecutivo(v_prefijo));
      END;
    END LOOP;

    IF v_oc IS NULL THEN
      RAISE EXCEPTION 'No se pudo asignar número de orden de compra, intenta de nuevo.';
    END IF;

    v_valor := v_grupo.valor;
    FOR v_linea IN
      SELECT si.id,
             si.producto_id,
             (si.cantidad - si.cantidad_convertida) AS cantidad,
             COALESCE(s.precio, 0) AS precio
        FROM solicitud_compra_items si
        CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
       WHERE si.solicitud_id = p_solicitud
         AND si.cantidad_convertida < si.cantidad
         AND s.proveedor_id = v_grupo.proveedor_id
         AND COALESCE(s.precio, 0) > 0
    LOOP
      -- `subtotal` es GENERATED ALWAYS: no se inserta.
      INSERT INTO oc_items (oc_id, producto_id, cantidad_ped, precio_unit)
      VALUES (v_oc, v_linea.producto_id, v_linea.cantidad, v_linea.precio);

      UPDATE solicitud_compra_items
         SET cantidad_convertida = cantidad,
             oc_id = v_oc,
             proveedor_sugerido_id = COALESCE(proveedor_sugerido_id, v_grupo.proveedor_id)
       WHERE id = v_linea.id;
    END LOOP;

    v_ordenes := v_ordenes + 1;
    v_out := v_out || jsonb_build_object(
      'oc_id',     v_oc,
      'numero',    v_numero,
      'proveedor', (SELECT nombre FROM proveedores WHERE id = v_grupo.proveedor_id),
      'valor',     v_valor
    );
  END LOOP;

  IF v_ordenes = 0 THEN
    IF v_sin_precio > 0 AND v_sin_prov = 0 THEN
      RAISE EXCEPTION 'Los % producto(s) pendientes tienen proveedor pero no tienen precio (ni cotizacion vigente ni precio de lista). Ponles precio antes de convertir la solicitud.', v_sin_precio;
    END IF;
    IF v_sin_prov > 0 THEN
      RAISE EXCEPTION 'Ninguno de los % producto(s) pendientes tiene proveedor (ni en el comparador ni en su ficha). Asígnales uno antes de convertir la solicitud.', v_sin_prov;
    END IF;
    RAISE EXCEPTION 'La solicitud % no tiene nada pendiente por convertir.', v_sol.numero;
  END IF;

  PERFORM public.sc_recalcular_estado(p_solicitud);

  RETURN jsonb_build_object(
    'ordenes',      v_out,
    'total',        v_ordenes,
    'sin_proveedor', v_sin_prov,
    'sin_precio',    v_sin_precio
  );
END;
$function$;


GRANT EXECUTE ON FUNCTION public.sc_convertir_a_oc(UUID) TO authenticated;

-- =============================================================================
-- FIN
-- =============================================================================
