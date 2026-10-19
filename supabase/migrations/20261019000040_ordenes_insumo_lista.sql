-- =============================================================================
-- VISTAS DE LA PANTALLA /ordenes-insumo
--
-- Por qué existen: la pantalla armaba su tabla trayéndose TODAS las órdenes con
-- sus ítems anidados (`items:orden_insumo_items(... producto:productos(stock(…)))`)
-- solo para contar tres números por orden. Eso son ~10.000 filas y ~2,4 MB de
-- JSON por carga, con una media de 617 ms y picos de 7,9 s medidos en
-- pg_stat_statements. El rol `authenticated` tiene statement_timeout = 8 s, así
-- que cuando la base estaba ocupada la consulta se pasaba del tope, PostgREST
-- devolvía 500 y la pantalla caía en el error boundary del panel.
--
-- La cuenta se hace aquí, en SQL, y la pantalla recibe una fila por orden.
--
--   v_ordenes_insumo_lista  una fila por orden con los contadores ya resueltos
--                           (ítems, alistados, sin stock, responsables,
--                           comentarios, nivel de reposición y nombre del
--                           creador).
--   v_sobre_pedidos         un producto en déficit por fila, con sus órdenes ya
--                           agregadas en JSON (antes eran 5 peticiones).
--
-- security_invoker: la RLS de lectura de ordenes_insumo / orden_insumo_items /
-- stock / productos sigue mandando; quien no pueda ver una orden no la ve aquí.
-- El nombre del creador se toma de `usuarios_opciones`, que NO es invoker (es la
-- vista que ya usaba la pantalla para saltarse la RLS cerrada de `usuarios`).
--
-- Idempotente.
-- =============================================================================

-- ── Ítems "propios" de cada orden ───────────────────────────────────────────
-- Un ítem que se fue ENTERO a una orden de reposición ya no cuenta como ítem de
-- la orden de origen (misma regla que tenía la pantalla en TypeScript):
--   cantidad_a_pendiente > 0  Y  cantidad_alistada <= 0  Y
--   cantidad_solicitada <= cantidad_a_pendiente
-- Si alcanzó a salir algo, o solo una parte quedó pendiente, el ítem sí cuenta.

DROP VIEW IF EXISTS public.v_ordenes_insumo_lista;

CREATE VIEW public.v_ordenes_insumo_lista
WITH (security_invoker = true) AS
WITH RECURSIVE cadena AS (
  -- Nivel en la cadena de pendientes: 1 = reposición de una orden original,
  -- 2 = reposición de una reposición… Se corta en 20 por seguridad, igual que
  -- hacía el bucle de la pantalla.
  SELECT o.id, o.orden_origen_id, 1 AS nivel
  FROM public.ordenes_insumo o
  WHERE o.orden_origen_id IS NOT NULL
  UNION ALL
  SELECT c.id, o.orden_origen_id, c.nivel + 1
  FROM cadena c
  JOIN public.ordenes_insumo o ON o.id = c.orden_origen_id
  WHERE o.orden_origen_id IS NOT NULL AND c.nivel < 20
),
reposicion AS (
  SELECT id, MAX(nivel)::int AS nivel FROM cadena GROUP BY id
),
items AS (
  SELECT
    i.orden_id,
    COUNT(*)::int                                                        AS total_items,
    COUNT(*) FILTER (WHERE i.alistado)::int                              AS alistados,
    COUNT(*) FILTER (WHERE COALESCE(st.cantidad_disp, 0) < 0)::int       AS sin_stock
  FROM public.orden_insumo_items i
  LEFT JOIN public.stock st ON st.producto_id = i.producto_id
  WHERE NOT (
        COALESCE(i.cantidad_a_pendiente, 0) > 0
    AND COALESCE(i.cantidad_alistada, 0) <= 0
    AND COALESCE(i.cantidad_solicitada, 0) <= COALESCE(i.cantidad_a_pendiente, 0)
  )
  GROUP BY i.orden_id
),
responsables AS (
  SELECT r.orden_id, COUNT(*)::int AS responsables
  FROM public.orden_insumo_responsables r
  GROUP BY r.orden_id
),
coment_total AS (
  SELECT e.orden_id, COUNT(*)::int AS comentarios
  FROM public.orden_insumo_eventos e
  WHERE e.tipo = 'COMENTARIO'
  GROUP BY e.orden_id
),
coment_ultimo AS (
  -- El último comentario QUE TRAE TEXTO, con su autor (los eventos COMENTARIO
  -- sin mensaje cuentan para el total pero no son "el último comentario").
  SELECT DISTINCT ON (e.orden_id)
    e.orden_id,
    btrim(e.mensaje)        AS ultimo_comentario,
    e.usuario_nombre        AS comentario_autor
  FROM public.orden_insumo_eventos e
  WHERE e.tipo = 'COMENTARIO' AND btrim(COALESCE(e.mensaje, '')) <> ''
  ORDER BY e.orden_id, e.created_at DESC, e.id DESC
)
SELECT
  o.id,
  o.numero,
  o.estado,
  o.sede_id,
  COALESCE(s.nombre, '—')                         AS sede,
  o.created_at,
  o.despachado_at,
  o.alistado_at,
  o.tomado_ruta_at,
  o.recibido_at,
  o.fecha_entrega_pactada,
  COALESCE(o.urgente, false)                      AS urgente,
  o.creado_por                                    AS creador_id,
  uo.nombre                                       AS creador_nombre,
  NULLIF(btrim(COALESCE(o.observacion, '')), '')  AS observacion,
  COALESCE(it.total_items, 0)                     AS total_items,
  COALESCE(it.alistados, 0)                       AS alistados,
  COALESCE(it.sin_stock, 0)                       AS sin_stock,
  COALESCE(rs.responsables, 0)                    AS responsables,
  COALESCE(ct.comentarios, 0)                     AS comentarios,
  cu.ultimo_comentario,
  cu.comentario_autor,
  CASE WHEN o.orden_origen_id IS NULL THEN 0 ELSE COALESCE(rp.nivel, 0) END AS reposicion
FROM public.ordenes_insumo o
LEFT JOIN public.sedes s            ON s.id = o.sede_id
LEFT JOIN public.usuarios_opciones uo ON uo.id = o.creado_por
LEFT JOIN items it                  ON it.orden_id = o.id
LEFT JOIN responsables rs           ON rs.orden_id = o.id
LEFT JOIN coment_total ct           ON ct.orden_id = o.id
LEFT JOIN coment_ultimo cu          ON cu.orden_id = o.id
LEFT JOIN reposicion rp             ON rp.id = o.id;

GRANT SELECT ON public.v_ordenes_insumo_lista TO authenticated;

COMMENT ON VIEW public.v_ordenes_insumo_lista IS
  'Una fila por orden de insumo con los contadores de la tabla ya resueltos en SQL. Reemplaza el select anidado de ~10.000 ítems que se pasaba del statement_timeout de 8 s.';


-- ── Productos sobre-pedidos, con sus órdenes ────────────────────────────────
-- disponible = stock real − lo pedido en órdenes que aún NO salen de bodega
-- (v_stock_proyectado). Negativo = se pidió de más. El faltante NO es la suma de
-- las órdenes: es esa suma MENOS el stock.
--
-- Las órdenes van agregadas en JSON para que la pantalla no tenga que pedirlas
-- por lotes de 60 productos (eran 5 peticiones y ~2.800 filas sueltas).

DROP VIEW IF EXISTS public.v_sobre_pedidos;

CREATE VIEW public.v_sobre_pedidos
WITH (security_invoker = true) AS
SELECT
  sp.producto_id,
  p.codigo,
  sp.nombre_estandar,
  sp.presentacion,
  sp.stock_real,
  sp.comprometido,
  sp.disponible,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'orden_id', d.orden_id,
        'numero',   d.orden_numero,
        'estado',   d.estado,
        'sede',     d.sede_nombre,
        'cantidad', d.cantidad_solicitada
      )
      ORDER BY d.orden_numero
    ) FILTER (WHERE d.orden_id IS NOT NULL),
    '[]'::jsonb
  ) AS ordenes
FROM public.v_stock_proyectado sp
LEFT JOIN public.productos p ON p.id = sp.producto_id
LEFT JOIN public.v_demanda_ordenes_insumo d ON d.producto_id = sp.producto_id
WHERE sp.disponible < 0
GROUP BY sp.producto_id, p.codigo, sp.nombre_estandar, sp.presentacion,
         sp.stock_real, sp.comprometido, sp.disponible;

GRANT SELECT ON public.v_sobre_pedidos TO authenticated;

COMMENT ON VIEW public.v_sobre_pedidos IS
  'Productos cuyo disponible proyectado quedó negativo, con las órdenes que los piden ya agregadas en JSON.';


-- ── Índice para el conteo de comentarios ────────────────────────────────────
-- El índice que había es (orden_id, created_at); el filtro de la vista es por
-- `tipo`, así que para 500 órdenes acababa recorriendo la tabla entera.
CREATE INDEX IF NOT EXISTS idx_oi_eventos_comentario
  ON public.orden_insumo_eventos (orden_id, created_at DESC)
  WHERE tipo = 'COMENTARIO';
