-- =============================================================================
-- DASHBOARD Y MOVIMIENTOS: contar en SQL y un índice que faltaba
--
-- 1) El tablero traía TODAS las órdenes (una fila por orden, solo el estado)
--    para contar cinco cajitas, y los ~1.400 movimientos de 14 días para pintar
--    una gráfica de 14 puntos. Ahora las dos cuentas se hacen aquí.
--
-- 2) `movimientos` no tenía índice por `created_at`. Tanto el tablero (filtro de
--    14 días) como la pantalla /movimientos (ORDER BY created_at DESC sobre
--    toda la tabla) acababan en Seq Scan + Sort: 234 ms de media y 3.610
--    llamadas en pg_stat_statements, el mayor gasto de toda la base.
--
-- Zona horaria: el día se corta en América/Bogotá, no en la del servidor. Antes
-- el corte lo hacía JavaScript con `new Date().setHours(0,0,0,0)`, y en Vercel
-- el servidor corre en UTC, así que "hoy" empezaba a las 7:00 p. m. del día
-- anterior en Colombia: entre las 7 y las 12 de la noche los movimientos de la
-- noche se contaban como del día siguiente.
--
-- security_invoker: manda la RLS de lectura de quien consulta.
-- Idempotente.
-- =============================================================================

-- ── Conteo de órdenes por estado (una fila por estado) ──────────────────────
DROP VIEW IF EXISTS public.v_ordenes_insumo_por_estado;

CREATE VIEW public.v_ordenes_insumo_por_estado
WITH (security_invoker = true) AS
SELECT o.estado, COUNT(*)::int AS total
FROM public.ordenes_insumo o
GROUP BY o.estado;

GRANT SELECT ON public.v_ordenes_insumo_por_estado TO authenticated;

COMMENT ON VIEW public.v_ordenes_insumo_por_estado IS
  'Cuántas órdenes de insumo hay en cada estado. Para los KPI del tablero, que antes se traían las órdenes una por una.';


-- ── Movimientos por día (últimos 14 días, hora de Bogotá) ───────────────────
-- `entradas` / `salidas` son la SUMA de cantidades (la gráfica);
-- `n_entradas` / `n_salidas` son el NÚMERO de movimientos (los contadores de hoy).
-- DEVOLUCION cuenta como entrada, igual que en la pantalla.
DROP VIEW IF EXISTS public.v_movimientos_dia;

CREATE VIEW public.v_movimientos_dia
WITH (security_invoker = true) AS
SELECT
  (m.created_at AT TIME ZONE 'America/Bogota')::date                                   AS dia,
  COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo IN ('ENTRADA', 'DEVOLUCION')), 0)::numeric AS entradas,
  COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo = 'SALIDA'), 0)::numeric               AS salidas,
  COUNT(*) FILTER (WHERE m.tipo IN ('ENTRADA', 'DEVOLUCION'))::int                     AS n_entradas,
  COUNT(*) FILTER (WHERE m.tipo = 'SALIDA')::int                                       AS n_salidas,
  -- Todos los movimientos del día, incluidos TRASLADO y AJUSTE (es el número
  -- que muestra el KPI "Movimientos hoy").
  COUNT(*)::int                                                                        AS n_total
FROM public.movimientos m
WHERE m.created_at >= (
        (date_trunc('day', now() AT TIME ZONE 'America/Bogota') - INTERVAL '13 days')
        AT TIME ZONE 'America/Bogota'
      )
GROUP BY 1;

GRANT SELECT ON public.v_movimientos_dia TO authenticated;

COMMENT ON VIEW public.v_movimientos_dia IS
  'Entradas y salidas por día (14 días, hora de Bogotá) para la gráfica del tablero. 14 filas en vez de ~1.400.';


-- ── El índice que faltaba ───────────────────────────────────────────────────
-- (created_at DESC, id) es exactamente el ORDER BY de /movimientos y sirve
-- también para el filtro de fechas del tablero.
CREATE INDEX IF NOT EXISTS idx_movimientos_creado
  ON public.movimientos (created_at DESC, id);
