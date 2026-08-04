-- =============================================================================
-- STOCK PROYECTADO (órdenes de insumo)
-- =============================================================================
-- Disponible proyectado = stock real − lo comprometido en órdenes de insumo que
-- están "en cola" (creadas pero aún no despachadas ni anuladas). Si queda
-- negativo, significa que entre las órdenes en cola se pidió más de lo que hay.
-- Estados en cola = todos MENOS borrador, despachado y anulada.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_stock_proyectado
WITH (security_invoker = true) AS
SELECT
  p.id                                                            AS producto_id,
  COALESCE(s.cantidad_real, 0)::numeric                           AS stock_real,
  COALESCE(d.comprometido, 0)::numeric                            AS comprometido,
  (COALESCE(s.cantidad_real, 0) - COALESCE(d.comprometido, 0))::numeric AS disponible,
  COALESCE(d.n_ordenes, 0)::int                                   AS ordenes_en_cola
FROM productos p
LEFT JOIN stock s ON s.producto_id = p.id
LEFT JOIN (
  SELECT oii.producto_id,
         SUM(oii.cantidad_solicitada)      AS comprometido,
         COUNT(DISTINCT oii.orden_id)       AS n_ordenes
  FROM orden_insumo_items oii
  JOIN ordenes_insumo oi ON oi.id = oii.orden_id
  WHERE oi.estado NOT IN ('BORRADOR', 'DESPACHADO', 'ANULADA')
  GROUP BY oii.producto_id
) d ON d.producto_id = p.id;

GRANT SELECT ON public.v_stock_proyectado TO authenticated;

-- Detalle: qué órdenes en cola están pidiendo cada producto (para el listado de
-- sobre-pedidos, ver qué órdenes contribuyen al déficit).
CREATE OR REPLACE VIEW public.v_demanda_ordenes_insumo
WITH (security_invoker = true) AS
SELECT
  oii.producto_id,
  oi.id                 AS orden_id,
  oi.numero             AS orden_numero,
  oi.estado             AS estado,
  oi.sede_id,
  se.nombre             AS sede_nombre,
  oii.cantidad_solicitada,
  oi.created_at
FROM orden_insumo_items oii
JOIN ordenes_insumo oi ON oi.id = oii.orden_id
LEFT JOIN sedes se ON se.id = oi.sede_id
WHERE oi.estado NOT IN ('BORRADOR', 'DESPACHADO', 'ANULADA')
  AND oii.cantidad_solicitada > 0;

GRANT SELECT ON public.v_demanda_ordenes_insumo TO authenticated;
