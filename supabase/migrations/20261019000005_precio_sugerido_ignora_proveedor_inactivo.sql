-- =============================================================================
-- COMPRAS — el proveedor que pide quien llama tampoco vale si está desactivado
-- =============================================================================
-- Cierra el hueco que quedó abierto en `20261019000004_proveedor_sugerido_solo_activos.sql`.
-- Esa migración sacó a los proveedores desactivados de los dos caminos que
-- resuelve `compras_precio_sugerido()` —el comparador y la ficha del producto—
-- pero dejó intacto el del medio: el `COALESCE(c.proveedor_id, p_proveedor, …)`
-- honraba el proveedor recibido sin comprobar que siguiera activo.
--
-- Por qué importa: `sc_convertir_a_oc()` llama a la función con
-- `si.proveedor_sugerido_id`, el proveedor que la solicitud guardó el día que
-- se creó. Si ese proveedor se da de baja entre tanto —y en /proveedores
-- «eliminar» no borra, solo pone `activo = false`—, convertir la solicitud
-- nacía una orden de compra dirigida a un proveedor que para el usuario ya no
-- existe, y valorada con el precio de lista del producto en vez de con la
-- cotización de nadie (la fuente pasaba de COMPARADOR a LISTA sin que nada lo
-- dijera).
--
-- Comprobado antes de escribir esto, en una transacción revertida: con un
-- proveedor real desactivado y pasándolo como `p_proveedor`, la función lo
-- devolvía igual. Sin `p_proveedor` sí caía bien en otro proveedor activo.
--
-- Qué hace ahora: si el proveedor recibido está desactivado, se ignora como si
-- no lo hubieran pasado. El ítem se queda sin proveedor, que es el camino que
-- el módulo ya tiene previsto: `sc_convertir_a_oc()` no lo convierte, lo deja
-- en la solicitud y lo reporta en `sin_proveedor` para que alguien le asigne
-- uno. Mejor una orden que no sale que una orden a un proveedor retirado.
--
-- Las dos vistas que llaman a la función con un solo argumento
-- (`v_recomendacion_compra_proveedor`, `v_sc_pendientes_sin_solicitud`) no
-- cambian: ahí `p_proveedor` siempre fue NULL.
--
-- No cambia ni un dato: hoy no hay ninguna solicitud apuntando a un proveedor
-- desactivado. Esto es para que siga siendo verdad.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.compras_precio_sugerido(
  p_producto  UUID,
  p_proveedor UUID DEFAULT NULL
)
RETURNS TABLE (proveedor_id UUID, precio NUMERIC, fuente TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH comparador AS (
    SELECT pp.proveedor_id, pp.precio
      FROM precios_proveedor pp
      JOIN proveedores pr ON pr.id = pp.proveedor_id AND pr.activo
     WHERE pp.producto_id = p_producto
       AND COALESCE(pp.vigente, true)
       AND pp.precio > 0
       AND (p_proveedor IS NULL OR pp.proveedor_id = p_proveedor)
     ORDER BY pp.precio, pp.fecha_cotiz DESC NULLS LAST
     LIMIT 1
  ), pedido AS (
    -- El proveedor que pide quien llama, solo si sigue activo.
    SELECT pr.id AS proveedor_id
      FROM proveedores pr
     WHERE pr.id = p_proveedor AND pr.activo
  ), lista AS (
    -- `pr.id` y NO `p.proveedor_id`: el LEFT JOIN solo filtra si la columna que
    -- se devuelve es la del proveedor activo. El precio de lista sí se
    -- conserva: es del producto, no del proveedor.
    SELECT pr.id AS proveedor_id, p.precio_lista
      FROM productos p
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id AND pr.activo
     WHERE p.id = p_producto
  )
  SELECT COALESCE(c.proveedor_id, pe.proveedor_id, l.proveedor_id),
         COALESCE(c.precio, l.precio_lista),
         CASE WHEN c.precio IS NOT NULL       THEN 'COMPARADOR'
              WHEN l.precio_lista IS NOT NULL THEN 'LISTA'
              ELSE 'SIN_PRECIO' END
    FROM lista l
    LEFT JOIN comparador c ON TRUE
    LEFT JOIN pedido     pe ON TRUE
$$;

COMMENT ON FUNCTION public.compras_precio_sugerido(UUID, UUID) IS
  'Proveedor y precio con que se valora un producto: comparador vigente más barato, el proveedor pedido, o la ficha del producto. Ignora en los tres caminos a los proveedores desactivados.';

-- =============================================================================
-- FIN
-- =============================================================================
