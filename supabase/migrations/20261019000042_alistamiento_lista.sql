-- =============================================================================
-- VISTA DE LA PANTALLA /alistamiento
--
-- Por qué existe: la misma bomba de tiempo que ya se desactivó en
-- /ordenes-insumo (migración 20261019000040). La cola de alistamiento se armaba
-- trayéndose las órdenes en APROBADA / EN_ALISTAMIENTO / ALISTADO / DESPACHADO
-- con sus ítems anidados y, de cada ítem, su producto y su stock
-- (`items:orden_insumo_items(... producto:productos(stock(…)))`), solo para
-- calcular media docena de contadores por orden. Son ~263 órdenes y ~6.300
-- ítems: en pg_stat_statements esa consulta promediaba 1.099 ms con picos de
-- 5.838 ms. El rol `authenticated` tiene statement_timeout = 8 s, así que con la
-- base ocupada se pasaba del tope, PostgREST devolvía 500 y la pantalla caía en
-- el aviso de "Esta pantalla no se pudo cargar".
--
-- Las cuentas se hacen aquí, en SQL, y la pantalla recibe una fila por orden.
-- Los responsables van en el mismo JSON: antes eran ~5 peticiones encadenadas
-- (lotes de 60 órdenes sobre `responsables_opciones`).
--
-- Cada contador replica EXACTAMENTE la función de TypeScript que reemplaza:
--
--   total_items / alistados   cuenta() y etapaAlistamiento() del cliente.
--   sin_stock                 sinStock(): ítems SIN chulear cuyo pedido pasa el
--                             stock FÍSICO (cantidad_real, no cantidad_disp).
--                             Las órdenes que ya salieron de bodega no aplican.
--   pend_items/pend_unidades  pendienteEnvio(): solicitada − alistada (mín. 0).
--   und_pedido/und_alistado/  unidades(), que es flujoItem() ítem por ítem:
--   und_despachado            antes del despacho `cantidad_alistada` arranca
--                             igual a lo solicitado, así que solo cuenta si el
--                             ítem está chuleado; cuando la orden ya salió,
--                             `cantidad_alistada` ES lo que salió.
--
-- security_invoker: la RLS de lectura de ordenes_insumo / orden_insumo_items /
-- stock sigue mandando; quien no pueda ver una orden no la ve aquí. Los nombres
-- de los responsables se toman de `responsables_opciones`, que NO es invoker (es
-- la vista que ya usaba la pantalla para saltarse la RLS cerrada de `usuarios`).
--
-- Idempotente.
-- =============================================================================

DROP VIEW IF EXISTS public.v_alistamiento_lista;

CREATE VIEW public.v_alistamiento_lista
WITH (security_invoker = true) AS
WITH items AS (
  SELECT
    i.orden_id,
    COUNT(*)::int                                AS total_items,
    COUNT(*) FILTER (WHERE i.alistado)::int      AS alistados,
    -- Pedido > stock físico, solo lo que aún no se ha chuleado.
    COUNT(*) FILTER (
      WHERE NOT i.alistado
        AND i.cantidad_solicitada > COALESCE(st.cantidad_real, 0)
    )::int                                       AS sin_stock,
    COUNT(*) FILTER (
      WHERE GREATEST(i.cantidad_solicitada - i.cantidad_alistada, 0) > 0
    )::int                                       AS pend_items,
    SUM(GREATEST(i.cantidad_solicitada - i.cantidad_alistada, 0)) AS pend_unidades,
    SUM(i.cantidad_solicitada)                   AS und_pedido,
    -- Dos lecturas de lo alistado: la de la orden que ya salió (todo lo que
    -- marca `cantidad_alistada`) y la de la que sigue en bodega (solo lo
    -- chuleado). El CASE de abajo elige según el estado.
    SUM(i.cantidad_alistada)                     AS und_alistada_total,
    COALESCE(SUM(i.cantidad_alistada) FILTER (WHERE i.alistado), 0) AS und_alistada_chuleada
  FROM public.orden_insumo_items i
  LEFT JOIN public.stock st ON st.producto_id = i.producto_id
  GROUP BY i.orden_id
),
responsables AS (
  -- Mismo orden que traía la pantalla (lotes ordenados por usuario_id).
  SELECT
    r.orden_id,
    jsonb_agg(r.nombre ORDER BY r.usuario_id) AS responsables
  FROM public.responsables_opciones r
  GROUP BY r.orden_id
)
SELECT
  o.id,
  o.numero,
  o.estado,
  o.sede_id,
  s.nombre                        AS sede,
  o.created_at,
  o.aprobado_at,
  o.despachado_at,
  o.alistado_at,
  o.tomado_ruta_at,
  o.recibido_at,
  COALESCE(it.total_items, 0)     AS total_items,
  COALESCE(it.alistados, 0)       AS alistados,
  CASE WHEN o.estado IN ('DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO')
       THEN 0 ELSE COALESCE(it.sin_stock, 0) END          AS sin_stock,
  COALESCE(it.pend_items, 0)      AS pend_items,
  COALESCE(it.pend_unidades, 0)   AS pend_unidades,
  COALESCE(it.und_pedido, 0)      AS und_pedido,
  CASE WHEN o.estado IN ('DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO')
       THEN COALESCE(it.und_alistada_total, 0)
       ELSE COALESCE(it.und_alistada_chuleada, 0) END      AS und_alistado,
  CASE WHEN o.estado IN ('DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO')
       THEN COALESCE(it.und_alistada_total, 0)
       ELSE 0 END                                         AS und_despachado,
  COALESCE(rs.responsables, '[]'::jsonb)                   AS responsables
FROM public.ordenes_insumo o
LEFT JOIN public.sedes s      ON s.id = o.sede_id
LEFT JOIN items it            ON it.orden_id = o.id
LEFT JOIN responsables rs     ON rs.orden_id = o.id;

GRANT SELECT ON public.v_alistamiento_lista TO authenticated;

COMMENT ON VIEW public.v_alistamiento_lista IS
  'Una fila por orden con los contadores de la cola de alistamiento ya resueltos en SQL y los responsables en JSON. Reemplaza el select anidado de ~6.300 ítems que se pasaba del statement_timeout de 8 s.';

-- Sin índice nuevo a propósito: el plan filtra por `idx_oi_estado` y ordenar
-- 263 filas por `aprobado_at` es gratis (EXPLAIN ANALYZE: 15 ms en total, de
-- los que el sort son 0,03 ms). Un (estado, aprobado_at) quedaría sin usar.
