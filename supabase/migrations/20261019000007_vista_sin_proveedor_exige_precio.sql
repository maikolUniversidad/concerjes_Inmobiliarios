-- =============================================================================
-- COMPRAS — la ficha del producto solo cuenta si trae precio
-- =============================================================================
-- Cierra el agujero que la §14 dejó medido y sin arreglar: `v_productos_sin_proveedor`
-- daba por resuelto un producto cuya ficha nombra un proveedor, sin mirar si esa
-- ficha trae precio. Del comparador sí exigía `precio > 0`; de la ficha, no.
--
-- A quién afecta, medido hoy: **6 productos** con proveedor activo en la ficha,
-- `precio_lista = 0` y ninguna fila en el comparador —ALCOHOL GLICERINADO AL
-- 70%, AMONIO CUATERNARIO, JABON PARA ROPA, SUAVIZANTE PARA ROPA, THINER A
-- GRANEL y VARSOL INDUSTRIAL—, uno de ellos en la recomendación de compra de
-- hoy. Estaban en el peor sitio posible: **invisibles y bloqueados a la vez**.
--   · invisibles, porque el filtro «Sin proveedor» de /comparador-precios sale
--     de esta vista y los daba por resueltos;
--   · bloqueados, porque desde `20261019000006` una línea de orden sin precio
--     no se escribe: `sc_convertir_a_oc()` los deja fuera y los cuenta en
--     `sin_precio`. Nadie podía comprarlos y nadie los veía en la lista de los
--     que hay que arreglar.
--
-- Lo único que cambia es la condición de la ficha: ahora pide
-- `COALESCE(p.precio_lista, 0) > 0`, el mismo criterio que ya se le exigía al
-- comparador. Con eso la vista pasa de **178 a 184** productos.
--
-- Ese número no es cosmético: la §11 y la §14 del documento lo explican en
-- varios sitios (la cadena de asignación dice «X de 178»), así que el documento
-- se actualiza en el mismo commit.
--
-- Comprobado también el caso simétrico, por si hacía falta el mismo arreglo del
-- otro lado: productos con filas en el comparador pero ninguna usable (precio 0
-- o no vigente) hay **0**, así que ahí no hay nada que tapar.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

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
   -- La ficha resuelve el producto solo si nombra un proveedor activo Y trae
   -- precio. Con precio 0 no hay con qué armar la orden, así que el producto
   -- sigue estando «sin proveedor» para lo que importa aquí.
   AND NOT EXISTS (
     SELECT 1 FROM proveedores pr
      WHERE pr.id = p.proveedor_id
        AND pr.activo
        AND COALESCE(p.precio_lista, 0) > 0
   )
   AND NOT EXISTS (
     SELECT 1 FROM precios_proveedor pp
      JOIN proveedores pr ON pr.id = pp.proveedor_id AND pr.activo
      WHERE pp.producto_id = p.id
        AND COALESCE(pp.vigente, true)
        AND pp.precio > 0
   );

COMMENT ON VIEW v_productos_sin_proveedor IS
  'Productos activos sin proveedor ACTIVO con precio, ni en el comparador ni en la ficha: los que una solicitud de compra no puede convertir en orden. Trae cuánto se pidió y cuánto se movió en 6 meses para priorizar.';

GRANT SELECT ON v_productos_sin_proveedor TO authenticated;

-- =============================================================================
-- FIN
-- =============================================================================
