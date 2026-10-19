-- =============================================================================
-- COMPRAS — el catálogo de productos que NO pueden convertirse en orden
-- =============================================================================
-- Sale de lo que mostró la fase 2 (docs/modulo-compras.md §11, punto 2): de los
-- 109 productos que el sistema recomienda comprar, 36 no tienen proveedor ni en
-- el comparador ni en la ficha, así que la conversión a orden los deja quietos.
--
-- Al medirlo completo resultó que el hueco no son 36 sino **178**: de los 498
-- productos activos, 225 tienen proveedor en la ficha y 216 tienen precio
-- vigente en el comparador, y 178 no tienen ninguna de las dos cosas. Los 36
-- son solo los que la recomendación pidió este mes; el mes entrante serán otros
-- de la misma bolsa. De los 178, **97 se movieron o se pidieron en los últimos
-- 6 meses** y 81 llevan medio año quietos — esos últimos pueden esperar.
--
-- No hay nada de dónde deducir el proveedor: `movimientos` no tiene columna de
-- proveedor, hay una sola orden de compra en todo el sistema y ninguno de esos
-- productos tiene fila en `precios_proveedor`, ni siquiera apagada. Llenarlo es
-- trabajo de alguien que sepa a quién se le compra. Lo que sí puede hacer el
-- sistema es poner la lista enfrente y ordenarla por lo que de verdad pesa.
--
-- Esta vista alimenta el filtro «Sin proveedor» de /comparador-precios.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- Un producto cuenta como «sin proveedor» cuando NINGUNA de las dos fuentes que
-- lee `compras_precio_sugerido()` lo resuelve: ni un precio vigente en el
-- comparador, ni el proveedor de su ficha. Es exactamente lo que bloquea la
-- conversión de una solicitud en orden de compra.
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
  -- Cuánto pidieron las sedes en medio año: es la mejor señal de que el
  -- producto importa, mejor que el stock (que puede estar en cero justamente
  -- porque nadie sabe a quién comprárselo).
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
  -- Lo que la recomendación de compra está pidiendo hoy: son los que urgen.
  LEFT JOIN v_recomendacion_compra rc ON rc.producto_id = p.id
 WHERE p.activo
   AND p.proveedor_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM precios_proveedor pp
      WHERE pp.producto_id = p.id
        AND COALESCE(pp.vigente, true)
        AND pp.precio > 0
   );

COMMENT ON VIEW v_productos_sin_proveedor IS
  'Productos activos sin proveedor en el comparador NI en la ficha: los que una solicitud de compra no puede convertir en orden. Trae cuánto se pidió y cuánto se movió en 6 meses para priorizar.';

GRANT SELECT ON v_productos_sin_proveedor TO authenticated;

-- =============================================================================
-- FIN
-- =============================================================================
