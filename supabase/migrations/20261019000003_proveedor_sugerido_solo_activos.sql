-- =============================================================================
-- COMPRAS — no sugerir un proveedor desactivado
-- =============================================================================
-- Sale de revisar juntas la fase 2 y la fusión de proveedores duplicados
-- (migración 20261019000001). Hasta ahora **nada filtraba por
-- `proveedores.activo`**:
--
--   · `compras_precio_sugerido()` tomaba el precio vigente más barato del
--     comparador fuera de quien fuera, y si no había, el proveedor de la ficha
--     del producto — activo o no.
--   · `v_productos_sin_proveedor` daba por resuelto un producto cuyo único
--     proveedor estuviera desactivado, así que ni siquiera salía en la lista de
--     los que hay que arreglar.
--
-- Hasta hoy daba igual porque todos los proveedores estaban activos. Dejó de
-- dar igual con la fusión: ahora hay 20 proveedores desactivados, y
-- `eliminarProveedor` de /proveedores no borra, pone `activo = false`. El día
-- que alguien «elimine» un proveedor que todavía tiene sus 226 precios en el
-- comparador, el sistema seguiría proponiéndolo y `sc_convertir_a_oc()` armaría
-- la orden de compra contra un proveedor que para el usuario ya no existe.
--
-- Al aplicarla no cambia ni un dato: se comprobó que hoy no hay un solo
-- producto, precio, orden, solicitud ni fila de aprovisionamiento apuntando a
-- un proveedor desactivado. Esto es para que siga siendo verdad.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El proveedor y el precio sugeridos ignoran a los desactivados
-- ─────────────────────────────────────────────────────────────────────────────
-- Mismo contrato que antes (ver 20261019000000_compras_fase2_solicitudes.sql):
-- comparador vigente más barato y, si no hay, el proveedor de la ficha con su
-- precio de lista. Lo único que cambia es que un proveedor desactivado ya no
-- cuenta por ninguno de los dos caminos.
--
-- Sigue SIN ser SECURITY DEFINER: `precios_proveedor` y `productos` están
-- cerrados por permiso de lectura y la vista que la usa es `security_invoker`.

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
  ), lista AS (
    -- `pr.id` y NO `p.proveedor_id`: el LEFT JOIN solo sirve si la columna que
    -- se devuelve es la del proveedor activo. Tomando la de la ficha, el join
    -- no filtra nada y la función sigue sugiriendo al desactivado (lo encontró
    -- la prueba: la vista lo daba por huérfano y la función lo seguía
    -- proponiendo, que es justo la incoherencia que esto viene a quitar).
    -- El precio de lista sí se conserva: es del producto, no del proveedor.
    SELECT pr.id AS proveedor_id, p.precio_lista
      FROM productos p
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id AND pr.activo
     WHERE p.id = p_producto
  )
  SELECT COALESCE(c.proveedor_id, p_proveedor, l.proveedor_id),
         COALESCE(c.precio, l.precio_lista),
         CASE WHEN c.precio IS NOT NULL      THEN 'COMPARADOR'
              WHEN l.precio_lista IS NOT NULL THEN 'LISTA'
              ELSE 'SIN_PRECIO' END
    FROM lista l
    LEFT JOIN comparador c ON TRUE
$$;

COMMENT ON FUNCTION public.compras_precio_sugerido(UUID, UUID) IS
  'Proveedor y precio con que se valora un producto: comparador vigente más barato o ficha del producto, ignorando a los proveedores desactivados.';

-- Ojo: `lista` ya no devuelve el proveedor de la ficha cuando está desactivado,
-- pero el `COALESCE(..., p_proveedor, ...)` sigue respetando el proveedor que
-- pida quien llama. Eso es a propósito: la conversión de una solicitud pasa el
-- proveedor que la solicitud trae, y ahí el que manda es ese, no la ficha.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La lista de «sin proveedor» cuenta igual
-- ─────────────────────────────────────────────────────────────────────────────
-- Si el único proveedor de un producto quedó desactivado, el producto vuelve a
-- estar sin proveedor y tiene que salir en la lista para que alguien lo arregle.
-- Es el mismo criterio de la función: si no, la pantalla diría que está
-- resuelto y la conversión a orden fallaría.

CREATE OR REPLACE VIEW v_productos_sin_proveedor WITH (security_invoker = true) AS
SELECT p.id            AS producto_id,
       p.codigo,
       p.ref,
       p.nombre_estandar,
       p.presentacion,
       p.tipo_insumo::text AS tipo_insumo,
       p.precio_lista,
       COALESCE(d.pedido_6m, 0)        AS pedido_6m,
       COALESCE(mv.movimientos_6m, 0)  AS movimientos_6m,
       COALESCE(rc.recomendado, 0)     AS recomendado
  FROM productos p
  LEFT JOIN LATERAL (
    SELECT SUM(i.cantidad_solicitada) AS pedido_6m
      FROM orden_insumo_items i
      JOIN ordenes_insumo o ON o.id = i.orden_id
     WHERE i.producto_id = p.id
       AND o.created_at > NOW() - INTERVAL '6 months'
  ) d ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS movimientos_6m
      FROM movimientos m
     WHERE m.producto_id = p.id
       AND m.created_at > NOW() - INTERVAL '6 months'
  ) mv ON TRUE
  LEFT JOIN v_recomendacion_compra rc ON rc.producto_id = p.id
 WHERE p.activo
   AND NOT EXISTS (
     SELECT 1 FROM proveedores pr
      WHERE pr.id = p.proveedor_id AND pr.activo
   )
   AND NOT EXISTS (
     SELECT 1 FROM precios_proveedor pp
      JOIN proveedores pr ON pr.id = pp.proveedor_id AND pr.activo
      WHERE pp.producto_id = p.id
        AND COALESCE(pp.vigente, true)
        AND pp.precio > 0
   );

COMMENT ON VIEW v_productos_sin_proveedor IS
  'Productos activos sin proveedor ACTIVO en el comparador ni en la ficha: los que una solicitud de compra no puede convertir en orden. Trae cuánto se pidió y cuánto se movió en 6 meses para priorizar.';

GRANT SELECT ON v_productos_sin_proveedor TO authenticated;

-- =============================================================================
-- FIN
-- =============================================================================
