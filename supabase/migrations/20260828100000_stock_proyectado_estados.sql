-- =============================================================================
-- STOCK PROYECTADO · corrección de los estados considerados y del alcance
-- =============================================================================
-- La versión anterior (20260804000000_stock_proyectado.sql) excluía la demanda
-- con una lista NEGATIVA: NOT IN ('BORRADOR','DESPACHADO','ANULADA'). Cuando se
-- agregaron los estados de logística (EN_RUTA, ENTREGADO) y el cierre de la
-- sede (RECIBIDO), esas órdenes siguieron contando como demanda comprometida
-- aunque la mercancía YA salió de la bodega: el "déficit" del panel de
-- productos sobre-pedidos quedó inflado.
--
-- Se pasa a la MISMA lista positiva que ya usan v_recomendacion_compra
-- (20260825000000) y los informes de /reportes, para que las tres cifras
-- coincidan:
--
--   demanda comprometida = órdenes que aún NO salen de bodega:
--     EN_REVISION, CAMBIOS_SOLICITADOS, APROBADA, PENDIENTE,
--     EN_ALISTAMIENTO, ALISTADO
--
--   Se suma `cantidad_solicitada` (no lo pendiente por alistar) porque el stock
--   solo se descuenta al despachar: lo ya alistado sigue contado en
--   `stock.cantidad_real`.
--
-- Además:
--   · se limita a productos activos (igual que v_recomendacion_compra), para no
--     reportar déficit de productos dados de baja;
--   · v_stock_proyectado expone el nombre/presentación y v_demanda_ordenes_insumo
--     expone `comprometido`, de modo que el reporte cuadre sin consultas extra:
--     SUM(cantidad_solicitada) por producto == comprometido == |disponible| + stock.
--   · v_demanda_ordenes_insumo expone `item_id` (clave única). Sin ella, paginar
--     con .range() ordenando por (created_at, orden_id) es inestable: una misma
--     orden aporta una fila por producto, todas con la misma llave de orden, y
--     en el borde de cada página se repiten o se pierden filas.
-- =============================================================================

-- Se recrean desde cero: CREATE OR REPLACE no admite cambiar la lista de
-- columnas y aquí se agregan nombre/presentación. Ninguna otra vista depende de
-- ellas (verificado en pg_depend), así que el DROP es seguro.
DROP VIEW IF EXISTS public.v_stock_proyectado;

CREATE VIEW public.v_stock_proyectado
WITH (security_invoker = true) AS
SELECT
  p.id                                                                  AS producto_id,
  p.nombre_estandar,
  p.presentacion,
  COALESCE(s.cantidad_real, 0)::numeric                                 AS stock_real,
  COALESCE(d.comprometido, 0)::numeric                                  AS comprometido,
  (COALESCE(s.cantidad_real, 0) - COALESCE(d.comprometido, 0))::numeric AS disponible,
  COALESCE(d.n_ordenes, 0)::int                                         AS ordenes_en_cola
FROM productos p
LEFT JOIN stock s ON s.producto_id = p.id
LEFT JOIN (
  SELECT oii.producto_id,
         SUM(oii.cantidad_solicitada)  AS comprometido,
         COUNT(DISTINCT oii.orden_id)  AS n_ordenes
  FROM orden_insumo_items oii
  JOIN ordenes_insumo oi ON oi.id = oii.orden_id
  WHERE oi.estado IN (
    'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
    'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'
  )
  GROUP BY oii.producto_id
) d ON d.producto_id = p.id
WHERE p.activo = true;

GRANT SELECT ON public.v_stock_proyectado TO authenticated;

-- Detalle: qué órdenes en cola están pidiendo cada producto. `comprometido` va
-- repetido en cada fila para que el Excel de sobre-pedidos pueda cuadrar el
-- subtotal filtrado contra el total del producto.
DROP VIEW IF EXISTS public.v_demanda_ordenes_insumo;

CREATE VIEW public.v_demanda_ordenes_insumo
WITH (security_invoker = true) AS
SELECT
  oii.id                AS item_id,   -- clave única: necesaria para paginar con
                                      -- .range() sin repetir ni perder filas
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
WHERE oi.estado IN (
  'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
  'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'
)
  AND oii.cantidad_solicitada > 0;

GRANT SELECT ON public.v_demanda_ordenes_insumo TO authenticated;
