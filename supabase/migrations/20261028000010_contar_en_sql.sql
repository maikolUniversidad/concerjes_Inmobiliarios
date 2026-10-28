-- =============================================================================
-- CONTAR EN SQL: fuera el patrón «traer filas para contarlas»
--
-- Después del arreglo de RLS (20261028000001) el patrón más caro que quedaba
-- era pedirle filas a la base para contarlas o sumarlas en JavaScript, y pedir
-- un viaje a Supabase por cada número. Cada viaje a us-west-2 se paga entero
-- (ida y vuelta), así que cinco contadores de una pantalla son cinco viajes.
--
-- 1) v_dashboard_inventario / v_stock_critico
--    El tablero se traía el catálogo activo COMPLETO (498 productos, con el
--    stock anidado) para sacar cuatro números y encontrar diez críticos.
--    Ahora son una fila y diez filas.
--    OJO con la semántica, que no cambia: el crítico se mide contra
--    `cantidad_disp` (lo DISPONIBLE: real menos lo reservado) y las unidades y
--    el valor contra `cantidad_real` (lo FÍSICO en bodega). Un producto sin
--    fila en `stock` cuenta como disponible 0, así que es crítico: por eso el
--    LEFT JOIN con COALESCE y no un JOIN.
--
-- 2) Cuatro resúmenes que eran de 3 a 5 viajes cada uno y ahora son uno:
--    v_arqueo_items_contados (era UN conteo POR arqueo abierto, en bucle),
--    v_servicios_hogar_resumen, v_pagos_hogar_resumen y v_puntos_resumen
--    (estos dos últimos además se traían TODAS las filas de cobros y de
--    clientes para sumarlas en memoria) y v_directorio_totales.
--
-- 3) estado_orden_reserva pierde el `SET search_path`
--    Una función SQL con cláusula SET no se puede INCORPORAR al plan, así que
--    el planificador la llamaba de verdad una vez por fila (~25.000 llamadas
--    en v_stock_flujo). La función es pura —sólo compara un texto contra una
--    lista, no lee ninguna tabla— y no es SECURITY DEFINER, así que corre con
--    los permisos de quien la llama: el search_path no la protege de nada.
--    Quitarlo baja v_stock_flujo de 117 ms a 26 ms.
--
-- v_sobre_pedidos se deja como estaba. Se probó armar el JSON sólo para los
-- productos en rojo (CTE MATERIALIZED + semijoin): da exactamente el mismo
-- resultado y sin RLS bajaba de 29 a 24 ms, pero CON RLS —que es como corre de
-- verdad— quedó en 34,3 vs 34,1 ms, o sea nada. Sus ~20 ms son el jsonb_agg de
-- las 2.437 órdenes que la pantalla sí muestra, y eso no se puede ahorrar sin
-- quitarle información. No vale complicar la vista por ruido de medición.
--
-- security_invoker: manda la RLS de lectura de quien consulta.
-- Idempotente.
-- =============================================================================

-- ── 1. Tablero de inventario: los cuatro totales en UNA fila ────────────────
DROP VIEW IF EXISTS public.v_dashboard_inventario;

CREATE VIEW public.v_dashboard_inventario
WITH (security_invoker = true) AS
SELECT
  COUNT(*)::int AS n_productos,
  -- Unidades y valor: lo FÍSICO en bodega (cantidad_real).
  COALESCE(SUM(COALESCE(s.cantidad_real, 0)), 0)::numeric                            AS unidades_real,
  COALESCE(SUM(COALESCE(s.cantidad_disp, 0)), 0)::numeric                            AS unidades_disp,
  COALESCE(SUM(COALESCE(s.cantidad_real, 0) * COALESCE(p.precio_lista, 0)), 0)::numeric AS valor_inventario,
  -- Crítico: contra el DISPONIBLE (real − reservado).
  COUNT(*) FILTER (
    WHERE p.stock_minimo_def > 0 AND COALESCE(s.cantidad_disp, 0) <= p.stock_minimo_def
  )::int AS n_criticos
FROM public.productos p
LEFT JOIN public.stock s ON s.producto_id = p.id
WHERE p.activo = true;

GRANT SELECT ON public.v_dashboard_inventario TO authenticated;

COMMENT ON VIEW public.v_dashboard_inventario IS
  'Los cuatro totales de inventario del tablero en una sola fila. Antes se traía el catálogo activo completo con el stock anidado para sumarlos en JavaScript.';


-- ── Los productos críticos (10 filas hoy, no 498) ───────────────────────────
-- Mismo criterio que el contador de arriba: disponible <= mínimo, con mínimo
-- definido. El orden final (por ítem y luego alfabético) lo pone la pantalla
-- con `ordenarPorItem`, que es la regla de todo el sistema.
DROP VIEW IF EXISTS public.v_stock_critico;

CREATE VIEW public.v_stock_critico
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.codigo,
  p.nombre_estandar,
  p.presentacion,
  p.cat_rotacion,
  p.stock_minimo_def,
  COALESCE(s.cantidad_real, 0)::numeric AS cantidad_real,
  COALESCE(s.cantidad_disp, 0)::numeric AS cantidad_disp
FROM public.productos p
LEFT JOIN public.stock s ON s.producto_id = p.id
WHERE p.activo = true
  AND p.stock_minimo_def > 0
  AND COALESCE(s.cantidad_disp, 0) <= p.stock_minimo_def;

GRANT SELECT ON public.v_stock_critico TO authenticated;

COMMENT ON VIEW public.v_stock_critico IS
  'Productos activos cuyo DISPONIBLE (real − reservado) está en o por debajo del mínimo. Para las alertas del tablero.';


-- ── 2. Ítems contados por arqueo (era un conteo por arqueo, en bucle) ───────
-- `arqueos.items_contados` sólo se actualiza al cerrar, así que los abiertos
-- se cuentan en vivo. La pantalla hacía UN viaje a Supabase por cada arqueo
-- abierto; ahora pide esta vista una vez y busca por id.
DROP VIEW IF EXISTS public.v_arqueo_items_contados;

CREATE VIEW public.v_arqueo_items_contados
WITH (security_invoker = true) AS
SELECT
  ai.arqueo_id,
  COUNT(*) FILTER (WHERE ai.estado <> 'PENDIENTE')::int AS contados
FROM public.arqueo_items ai
GROUP BY ai.arqueo_id;

GRANT SELECT ON public.v_arqueo_items_contados TO authenticated;

COMMENT ON VIEW public.v_arqueo_items_contados IS
  'Ítems ya contados de cada arqueo. Una fila por arqueo, en vez de un conteo por arqueo abierto.';


-- ── Resumen de solicitudes de servicios del hogar (eran 4 viajes) ───────────
-- «hoy» se corta en hora de Bogotá, igual que el resto del sistema: en Vercel
-- el servidor corre en UTC y el día cambiaría a las 7 de la noche.
DROP VIEW IF EXISTS public.v_servicios_hogar_resumen;

CREATE VIEW public.v_servicios_hogar_resumen
WITH (security_invoker = true) AS
SELECT
  COUNT(*) FILTER (WHERE s.estado = 'PENDIENTE')::int   AS pendientes,
  COUNT(*) FILTER (WHERE s.estado = 'CONFIRMADA')::int  AS confirmadas,
  COUNT(*) FILTER (
    WHERE s.fecha_deseada = (now() AT TIME ZONE 'America/Bogota')::date
  )::int                                                AS hoy,
  COUNT(*) FILTER (WHERE s.estado = 'COMPLETADA')::int  AS completadas
FROM public.solicitudes_servicio_hogar s;

GRANT SELECT ON public.v_servicios_hogar_resumen TO authenticated;

COMMENT ON VIEW public.v_servicios_hogar_resumen IS
  'Los cuatro contadores del tablero de servicios del hogar en una fila. Antes eran cuatro conteos, cuatro viajes.';


-- ── Resumen de cobros y pagos (eran 4 viajes, dos de ellos con TODAS las filas) ──
DROP VIEW IF EXISTS public.v_pagos_hogar_resumen;

CREATE VIEW public.v_pagos_hogar_resumen
WITH (security_invoker = true) AS
SELECT
  COUNT(*) FILTER (WHERE c.estado IN ('EMITIDO', 'PARCIAL'))::int AS por_cobrar,
  COALESCE(SUM(c.saldo) FILTER (WHERE c.estado IN ('EMITIDO', 'PARCIAL')), 0)::numeric AS saldo_pendiente,
  COUNT(*) FILTER (
    WHERE c.estado IN ('EMITIDO', 'PARCIAL')
      AND c.fecha_vencimiento < (now() AT TIME ZONE 'America/Bogota')::date
  )::int AS vencidos,
  COALESCE(SUM(c.total) FILTER (WHERE c.estado = 'PAGADO'), 0)::numeric AS recaudado,
  -- Pagos reportados por el cliente que alguien tiene que verificar.
  (SELECT COUNT(*) FROM public.pagos_hogar p WHERE p.estado = 'REPORTADO')::int AS por_verificar
FROM public.cobros_servicio_hogar c;

GRANT SELECT ON public.v_pagos_hogar_resumen TO authenticated;

COMMENT ON VIEW public.v_pagos_hogar_resumen IS
  'Cartera de servicios del hogar en una fila. Antes se traían TODAS las filas de cobros (dos veces) para sumarlas en memoria.';


-- ── Resumen de puntos (eran 3 viajes, uno con todos los clientes) ───────────
DROP VIEW IF EXISTS public.v_puntos_resumen;

CREATE VIEW public.v_puntos_resumen
WITH (security_invoker = true) AS
SELECT
  (SELECT COUNT(*) FROM public.redenciones r WHERE r.estado = 'SOLICITADA')::int AS por_entregar,
  (SELECT COUNT(*) FROM public.redenciones r WHERE r.estado = 'ENTREGADA')::int  AS entregadas,
  COALESCE(SUM(c.puntos), 0)::numeric                                            AS puntos_en_circulacion,
  COUNT(*) FILTER (WHERE COALESCE(c.puntos, 0) > 0)::int                         AS clientes_con_puntos
FROM public.clientes c;

GRANT SELECT ON public.v_puntos_resumen TO authenticated;

COMMENT ON VIEW public.v_puntos_resumen IS
  'Puntos en circulación y redenciones en una fila. Antes se traían los puntos de TODOS los clientes para sumarlos en memoria.';


-- ── Totales del directorio de correos (eran 5 viajes) ───────────────────────
DROP VIEW IF EXISTS public.v_directorio_totales;

CREATE VIEW public.v_directorio_totales
WITH (security_invoker = true) AS
SELECT
  (SELECT COUNT(*) FROM public.usuarios u WHERE u.activo = true)::int AS usuarios,
  (SELECT COUNT(*) FROM public.proveedores p)::int AS proveedores,
  (SELECT COUNT(*) FROM public.proveedores p
     WHERE p.email IS NOT NULL AND p.email <> '')::int AS proveedores_con_correo,
  (SELECT COUNT(*) FROM public.clientes c)::int AS clientes,
  (SELECT COUNT(*) FROM public.clientes c
     WHERE c.email IS NOT NULL AND c.email <> '')::int AS clientes_con_correo;

GRANT SELECT ON public.v_directorio_totales TO authenticated;

COMMENT ON VIEW public.v_directorio_totales IS
  'Cuántos destinatarios hay en cada fuente de correo del directorio. Antes eran cinco conteos, cinco viajes.';


-- ── 3. estado_orden_reserva: sin SET, para que se pueda incorporar al plan ──
-- Una función SQL con cláusula SET nunca se incorpora (inlining), y aquí el
-- planificador la llamaba una vez por fila. No lee tablas y no es SECURITY
-- DEFINER, así que el search_path no aportaba seguridad.
CREATE OR REPLACE FUNCTION public.estado_orden_reserva(p_estado text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_estado IN (
    'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA',
    'PENDIENTE', 'EN_ALISTAMIENTO', 'ALISTADO'
  );
$$;

-- `CREATE OR REPLACE` NO borra la configuración anterior de la función: hay que
-- quitarla a mano, o el `search_path=public` sigue ahí y sigue estorbando.
ALTER FUNCTION public.estado_orden_reserva(text) RESET ALL;

COMMENT ON FUNCTION public.estado_orden_reserva(text) IS
  '¿Un estado de orden de insumo reserva stock? Sin cláusula SET a propósito: con ella el planificador no la puede incorporar y la llamaría una vez por fila.';


-- v_sobre_pedidos NO se toca (ver la nota del encabezado).
