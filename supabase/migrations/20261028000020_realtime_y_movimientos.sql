-- =============================================================================
-- REALTIME: SACAR DE LA PUBLICACIÓN LO QUE NADIE ESCUCHA
-- =============================================================================
-- Tras el arreglo de RLS de hoy (20261028000001), el mayor consumidor de la
-- base pasó a ser Realtime: la consulta con la que revisa el WAL lleva
-- 1.295.008 ejecuciones, 2,7 h de CPU acumuladas y picos de 15.520 ms.
--
-- Ese costo se paga por cada cambio de CUALQUIER tabla de la publicación
-- `supabase_realtime`, aunque ninguna pantalla esté suscrita a ella. Así que lo
-- primero es dejar en la publicación solo lo que de verdad se escucha.
--
-- Inventario del 2026-10-28: la publicación tenía 17 tablas y el código escucha
-- 14. Las que escucha, con dónde:
--
--     arqueo_items ................. arqueo/[id]/ArqueoClient.tsx
--     conductor_ubicacion_actual ... logistica/mapa, logistica/monitoreo
--     mantenimiento_mensajes ....... mantenimiento/[id]/ChatTicket.tsx
--     mantenimiento_tickets ........ mantenimiento/TableroClient.tsx
--     novedades_entrega ............ logistica/monitoreo/MonitoreoClient.tsx
--     orden_insumo_items ........... useEnVivo (6 pantallas)
--     ordenes_insumo ............... useEnVivo (5 pantallas)
--     pqrs ......................... pqrs/ListaPqrs.tsx, pqrs/[id]
--     pqrs_bitacora ................ pqrs/[id]/PqrsClient.tsx
--     ruta_paradas ................. logistica/monitoreo/MonitoreoClient.tsx
--     rutas_entrega ................ logistica/monitoreo/MonitoreoClient.tsx
--     soporte_mensajes ............. soporte/[id]/TicketSoporteClient.tsx
--     soporte_tickets .............. soporte/ListaSoporte.tsx, soporte/[id]
--     stock ........................ useEnVivo (5 pantallas)
--
-- Las 3 que salen, y la prueba de que nadie las escuchaba (buscado en apps/
-- completo, las dos apps, por `postgres_changes`, `.channel(` y `useEnVivo`):
--
--   · notificaciones — ninguna suscripción. La campanita cuenta por sondeo, y
--     se queda así a propósito: vive en el shell, o sea en cada pestaña de cada
--     usuario, y los flujos la escriben en ráfaga (notifican a varios de una),
--     de modo que un canal aquí sería la suscripción más montada de la app y
--     cada INSERT pagaría la revisión de RLS contra todos los clientes
--     conectados. El conteo, en cambio, es un Index Only Scan de 0,14 ms.
--     Es la que más ahorra de las tres: 80.675 filas y escrituras constantes.
--   · arqueos — ArqueoClient solo escucha `arqueo_items` (filtrado por
--     arqueo_id) y `presence`. De `arqueos` no escucha nada.
--   · persona_ubicacion_actual — no aparece NI UNA VEZ en el código de las dos
--     apps, ni leyéndola.
--
-- Si alguna pantalla necesita «en vivo» sobre estas tablas, se vuelve a agregar
-- con el mismo patrón de más abajo. Quitarla de la publicación no borra ni
-- cambia datos: solo deja de replicar sus cambios al WAL lógico.
--
-- Qué NO trae esta migración, y por qué: índices nuevos en `movimientos`,
-- `personas` y `orden_insumo_items`. Los seq scans que se les veían (28,7 M,
-- 4,2 M y 85 M de filas leídas) son contadores ACUMULADOS de 121 días, de antes
-- del arreglo de RLS. Vueltos a medir hoy con EXPLAIN (analyze) y RLS activa,
-- todos los accesos reales de esas pantallas ya van por índice: la lista de
-- movimientos 7,6 ms por idx_movimientos_creado, el conteo filtrado 1,5 ms, los
-- ítems de una orden 1,5 ms, la lista de personas 4,8 ms. Se probó crear
-- (sede_id, created_at DESC, id) y (tipo, created_at, id) dentro de una
-- transacción: el planificador NI LOS USA a este tamaño, y el compuesto de
-- sede_id resultó más lento (1,71 → 1,90 ms). Un índice que nadie usa solo
-- cuesta en cada escritura, así que no van. Lo de `personas` no es falta de
-- índice sino que la pantalla lee la tabla completa con ORDER BY apellidos; eso
-- se arregla paginando, no indexando.

-- ── Realtime: quitar las tablas que nadie escucha ───────────────────────────
-- Idempotente: solo intenta quitarlas si siguen en la publicación.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notificaciones', 'arqueos', 'persona_ubicacion_actual']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_object THEN null;
END $$;

-- `arqueos` estaba además en REPLICA IDENTITY FULL, que escribe la fila ENTERA
-- al WAL en cada UPDATE y cada DELETE. Eso solo sirve para que un suscriptor
-- vea los valores viejos; sin suscriptor es puro peso. Vuelve a DEFAULT (la
-- llave primaria). `arqueo_items` SÍ se escucha y se queda en FULL.
ALTER TABLE public.arqueos REPLICA IDENTITY DEFAULT;

-- ── movimientos: el único índice que el planificador sí aprovecha ───────────
-- El plano de bodega (bodegas/[id]/BodegaPlano.tsx) pide los últimos 10
-- movimientos de una ubicación: WHERE ubicacion_id = ... ORDER BY created_at
-- DESC LIMIT 10. Con el índice de una sola columna había que traer todas las
-- filas de la ubicación y ordenarlas; con created_at dentro, el orden ya viene
-- del índice. Medido con EXPLAIN (analyze, timing off) y RLS activa:
--
--     (ubicacion_id)                    1,444 ms  — con Sort
--     (ubicacion_id, created_at DESC)   0,857 ms  — sin Sort
--
-- Va como REEMPLAZO, no como índice adicional: la columna que lleva adelante es
-- la misma, así que sigue sirviendo para los mismos filtros y para la revisión
-- de la llave foránea, y el número de índices de la tabla no cambia. No hay
-- escritura nueva que pagar.
DROP INDEX IF EXISTS idx_movimientos_ubicacion;
CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion
  ON public.movimientos (ubicacion_id, created_at DESC);

ANALYZE public.movimientos;
