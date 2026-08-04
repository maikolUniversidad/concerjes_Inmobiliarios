-- =============================================================================
-- RECOMENDACIÓN DE COMPRA (aprovisionamiento en vivo)
-- =============================================================================
-- La tabla `aprovisionamiento` se carga de un Excel (CMI) y puede estar vacía.
-- Esta vista calcula la recomendación con datos REALES en tiempo real:
--
--   recomendado = max(0, stock_minimo + demanda_en_cola − stock_real − oc_pendiente)
--
--   · demanda_en_cola = lo pedido en órdenes de insumo aún no despachadas.
--   · oc_pendiente    = lo ya pedido en órdenes de compra aún no recibidas.
--   · stock_minimo    = colchón parametrizado (hoy suele ser 0; se respeta si existe).
--
-- Es decir: qué comprar para cubrir la demanda comprometida que el stock actual
-- más lo que ya viene en camino no alcanzan a cubrir.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_recomendacion_compra
WITH (security_invoker = true) AS
SELECT
  p.id                                    AS producto_id,
  p.codigo,
  p.nombre_estandar,
  p.presentacion,
  p.cat_rotacion,
  p.precio_lista,
  COALESCE(s.cantidad_real, 0)::numeric   AS stock_real,
  COALESCE(p.stock_minimo_def, 0)::numeric AS stock_minimo,
  COALESCE(dem.comprometido, 0)::numeric  AS comprometido,
  COALESCE(ocp.pendiente, 0)::numeric     AS oc_pendiente,
  GREATEST(0,
    COALESCE(p.stock_minimo_def, 0)
    + COALESCE(dem.comprometido, 0)
    - COALESCE(s.cantidad_real, 0)
    - COALESCE(ocp.pendiente, 0)
  )::numeric                              AS recomendado
FROM productos p
LEFT JOIN stock s ON s.producto_id = p.id
LEFT JOIN (
  SELECT oii.producto_id, SUM(oii.cantidad_solicitada) AS comprometido
  FROM orden_insumo_items oii
  JOIN ordenes_insumo oi ON oi.id = oii.orden_id
  WHERE oi.estado NOT IN ('BORRADOR', 'DESPACHADO', 'ANULADA')
  GROUP BY oii.producto_id
) dem ON dem.producto_id = p.id
LEFT JOIN (
  SELECT oi.producto_id, SUM(GREATEST(0, oi.cantidad_ped - COALESCE(oi.cantidad_rec, 0))) AS pendiente
  FROM oc_items oi
  JOIN ordenes_compra oc ON oc.id = oi.oc_id
  WHERE oc.estado NOT IN ('ANULADA', 'COMPLETA')
  GROUP BY oi.producto_id
) ocp ON ocp.producto_id = p.id
WHERE p.activo = true;

GRANT SELECT ON public.v_recomendacion_compra TO authenticated;
