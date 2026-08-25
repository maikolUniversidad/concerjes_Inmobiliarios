-- =============================================================================
-- RECOMENDACIÓN DE COMPRA · corrección de los estados considerados
-- =============================================================================
-- La versión anterior (20260805000000_recomendacion_compra.sql) excluía la
-- demanda con una lista negativa: NOT IN ('BORRADOR','DESPACHADO','ANULADA').
-- Cuando se agregaron los estados del módulo de logística (EN_RUTA, ENTREGADO)
-- y el cierre (RECIBIDO), esas órdenes quedaron contando como demanda
-- comprometida aunque la mercancía YA salió de bodega: se recomendaba comprar
-- de más.
--
-- Ahora ambos lados usan listas POSITIVAS —los mismos estados que los informes
-- de /reportes (lib/reportes/informes.ts)— para que las cifras coincidan:
--
--   · demanda comprometida = órdenes de insumo que aún NO salen de bodega:
--       EN_REVISION, CAMBIOS_SOLICITADOS, APROBADA, PENDIENTE,
--       EN_ALISTAMIENTO, ALISTADO
--     Se suma `cantidad_solicitada` (no lo pendiente por alistar) porque el
--     stock solo se descuenta al despachar: lo ya alistado sigue contado en
--     `stock.cantidad_real`.
--
--   · oc_pendiente = lo no recibido de OC abiertas:
--       BORRADOR, APROBADA, ENVIADA, PARCIAL
--
-- La lista positiva evita que un estado nuevo vuelva a entrar por descuido.
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
  WHERE oi.estado IN (
    'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
    'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'
  )
  GROUP BY oii.producto_id
) dem ON dem.producto_id = p.id
LEFT JOIN (
  SELECT oi.producto_id, SUM(GREATEST(0, oi.cantidad_ped - COALESCE(oi.cantidad_rec, 0))) AS pendiente
  FROM oc_items oi
  JOIN ordenes_compra oc ON oc.id = oi.oc_id
  WHERE oc.estado IN ('BORRADOR', 'APROBADA', 'ENVIADA', 'PARCIAL')
  GROUP BY oi.producto_id
) ocp ON ocp.producto_id = p.id
WHERE p.activo = true;

GRANT SELECT ON public.v_recomendacion_compra TO authenticated;
