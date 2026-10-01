-- =============================================================================
-- FLUJO DE STOCK POR PRODUCTO · por alistar / alistado / despachado / en tránsito
-- =============================================================================
-- Complementa 20260928100000_stock_disponible_reservas (stock.cantidad_disp =
-- real − reservado). Aquí se desglosa, por producto, en qué punto del flujo de
-- las órdenes de insumo está la mercancía:
--
--   por_alistar    Reservado en órdenes que reservan (EN_REVISION, CAMBIOS_SOLICITADOS,
--                  APROBADA, PENDIENTE, EN_ALISTAMIENTO, ALISTADO) y que aún no
--                  se ha chuleado: solicitado − alistado (mínimo 0).
--   alistado       Ya ordenado/preparado (ítem chuleado) en órdenes que siguen en
--                  bodega. Ojo: `cantidad_alistada` arranca igual a lo solicitado,
--                  así que solo cuenta si el ítem tiene `alistado = true`.
--                  En la práctica solo hay chuleos en EN_ALISTAMIENTO / ALISTADO;
--                  si una orden con chuleos vuelve a APROBADA, lo chuleado se
--                  sigue contando aquí para que por_alistar + alistado cuadre
--                  con el reservado.
--   despachado_mes Lo que ya salió de bodega en el mes en curso (America/Bogota):
--                  cantidad_alistada de órdenes DESPACHADO/EN_RUTA/ENTREGADO/
--                  RECIBIDO con despachado_at en el mes. Al despachar, los ítems
--                  no chuleados quedan con cantidad_alistada = 0, así que la suma
--                  es exactamente lo que salió.
--   en_transito    Lo despachado en órdenes DESPACHADO / EN_RUTA (salió y la sede
--                  aún no lo recibe), sin importar el mes.
--
-- Cuadre: por_alistar + LEAST(alistado, solicitado) = reservado
--         (= stock.cantidad_real − stock.cantidad_disp).
--
-- Solo trae productos con algún movimiento en el flujo (las tablas cruzan por
-- producto_id y lo que no aparece es 0). security_invoker: la RLS de lectura de
-- ordenes_insumo / orden_insumo_items es abierta a authenticated.
-- Idempotente.
-- =============================================================================

DROP VIEW IF EXISTS public.v_stock_flujo;

CREATE VIEW public.v_stock_flujo
WITH (security_invoker = true) AS
WITH mes AS (
  SELECT (date_trunc('month', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota') AS desde
),
it AS (
  SELECT
    oii.producto_id,
    oi.id                                     AS orden_id,
    oi.estado::text                           AS estado,
    oi.despachado_at,
    oii.cantidad_solicitada::numeric          AS solicitado,
    CASE WHEN oii.alistado THEN oii.cantidad_alistada ELSE 0 END::numeric AS alistado_ef,
    oii.cantidad_alistada::numeric            AS salio
  FROM orden_insumo_items oii
  JOIN ordenes_insumo oi ON oi.id = oii.orden_id
  CROSS JOIN mes
  WHERE oi.estado IN (
          'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
          'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO',
          'DESPACHADO', 'EN_RUTA'
        )
     OR (oi.estado IN ('ENTREGADO', 'RECIBIDO') AND oi.despachado_at >= mes.desde)
),
agg AS (
  SELECT
    it.producto_id,
    SUM(CASE WHEN public.estado_orden_reserva(it.estado)
             THEN GREATEST(it.solicitado - it.alistado_ef, 0) ELSE 0 END)          AS por_alistar,
    SUM(CASE WHEN public.estado_orden_reserva(it.estado)
             THEN it.alistado_ef ELSE 0 END)                                       AS alistado,
    SUM(CASE WHEN it.estado IN ('DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO')
              AND it.despachado_at >= (SELECT desde FROM mes)
             THEN it.salio ELSE 0 END)                                             AS despachado_mes,
    SUM(CASE WHEN it.estado IN ('DESPACHADO', 'EN_RUTA')
             THEN it.salio ELSE 0 END)                                             AS en_transito,
    COUNT(DISTINCT it.orden_id) FILTER (
      WHERE public.estado_orden_reserva(it.estado) AND it.solicitado - it.alistado_ef > 0) AS ordenes_por_alistar,
    COUNT(DISTINCT it.orden_id) FILTER (
      WHERE public.estado_orden_reserva(it.estado) AND it.alistado_ef > 0)              AS ordenes_alistado,
    COUNT(DISTINCT it.orden_id) FILTER (
      WHERE it.estado IN ('DESPACHADO', 'EN_RUTA') AND it.salio > 0)                    AS ordenes_en_transito
  FROM it
  GROUP BY it.producto_id
)
SELECT
  a.producto_id,
  p.codigo,
  p.nombre_estandar,
  COALESCE(s.cantidad_real, 0)::numeric                            AS stock_real,
  (COALESCE(s.cantidad_real, 0) - COALESCE(s.cantidad_disp, 0))::numeric AS reservado,
  COALESCE(s.cantidad_disp, 0)::numeric                            AS disponible,
  a.por_alistar::numeric                                           AS por_alistar,
  a.alistado::numeric                                              AS alistado,
  a.despachado_mes::numeric                                        AS despachado_mes,
  a.en_transito::numeric                                           AS en_transito,
  a.ordenes_por_alistar::int                                       AS ordenes_por_alistar,
  a.ordenes_alistado::int                                          AS ordenes_alistado,
  a.ordenes_en_transito::int                                       AS ordenes_en_transito
FROM agg a
JOIN productos p ON p.id = a.producto_id
LEFT JOIN stock s ON s.producto_id = a.producto_id
WHERE a.por_alistar <> 0 OR a.alistado <> 0 OR a.despachado_mes <> 0 OR a.en_transito <> 0;

COMMENT ON VIEW public.v_stock_flujo IS
  'Flujo por producto de las órdenes de insumo: por alistar, alistado (en bodega), despachado en el mes (America/Bogota) y en tránsito. por_alistar + alistado = reservado.';

GRANT SELECT ON public.v_stock_flujo TO authenticated;
REVOKE ALL ON public.v_stock_flujo FROM anon;

NOTIFY pgrst, 'reload schema';
