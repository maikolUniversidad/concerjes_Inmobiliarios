-- =============================================================================
-- RLS: EVALUAR LOS PERMISOS UNA VEZ POR CONSULTA, NO UNA VEZ POR FILA
-- =============================================================================
-- Dentro de una policy, `auth_permiso('x')` escrito suelto se ejecuta UNA VEZ
-- POR CADA FILA que la consulta examina. Escrito como `(select auth_permiso('x'))`
-- Postgres lo convierte en un InitPlan y lo ejecuta UNA SOLA VEZ.
--
-- Medido el 2026-10-28 sobre dos copias de orden_insumo_items (10.350 filas) con
-- la MISMA condición, una policy suelta y la otra envuelta:
--
--     policy suelta   : 248,5 ms
--     policy envuelta :   1,8 ms      → 138x
--
-- Y en consultas reales (ejecución en el servidor, sin RLS → con RLS suelta):
--
--     count(*) de orden_insumo_items    1,2 ms →  229 ms   (191x)
--     count(*) de movimientos           0,8 ms →  178 ms   (223x)
--     count(*) de personas              1,6 ms →  151 ms    (95x)
--     v_sobre_pedidos (50 filas)         23 ms →  310 ms    (13x)
--     v_stock_flujo (50 filas)           22 ms →  182 ms     (8x)
--
-- El costo es proporcional a las filas EXAMINADAS, no a las devueltas: por eso
-- `personas order by id limit 50` costaba 1,6 ms y un `count: 'exact'` sobre la
-- misma tabla costaba 151 ms. También explica los 45,9 millones de index scans
-- sobre `usuarios`, que tiene 892 filas: es la tabla que consulta auth_permiso.
--
-- Qué hace esta migración:
--   Reescribe las policies envolviendo cada llamada a auth_permiso(),
--   auth_permiso_any(), auth_rol() y auth.uid() en `( SELECT ... )`.
--   Son 291 policies: 250 en public y 41 en storage.
--
-- Qué NO hace:
--   No cambia ninguna regla de permiso. Las expresiones son las mismas, con el
--   mismo nombre de policy, la misma tabla, el mismo comando y los mismos roles;
--   lo único que cambia es CUÁNTAS VECES se evalúan. Se generó leyendo las
--   expresiones de pg_policies y se verificó que, al quitar los `( SELECT )`
--   agregados, cada expresión vuelve a ser idéntica a la original.
--
-- Se usa ALTER POLICY (no DROP + CREATE) para que ningún momento de la
-- migración deje una tabla sin su policy. Cada sentencia va con IF EXISTS para
-- que repetir la migración sea seguro.
--
-- Se comprobó además que las 433 llamadas reciben argumentos literales (nunca
-- una columna): una subconsulta no ve la fila de afuera, así que si alguna
-- dependiera de la fila, envolverla sí cambiaría el resultado. Ninguna depende.
--
-- Generada por scripts/generar-rls-envuelta.mjs — si en el futuro se agregan
-- policies nuevas, se puede volver a correr para generar la siguiente.
-- =============================================================================

-- ALTER POLICY toma un lock de catálogo sobre cada tabla. Con lock_timeout, si
-- una consulta larga tiene la tabla ocupada la migración falla rápido y se
-- repite, en vez de quedarse esperando y hacer cola delante de todo lo demás.
SET LOCAL lock_timeout = '5s';


-- ─────────────────────────────────────────────────────────────────────────────
-- Esquema public (250 policies)
-- ─────────────────────────────────────────────────────────────────────────────

-- public.actividad_log
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'actividad_log' AND policyname = 'admin_read_log') THEN
    ALTER POLICY "admin_read_log" ON "public"."actividad_log"
      USING (((EXISTS ( SELECT 1
     FROM usuarios u
    WHERE ((u.id = ( SELECT auth.uid())) AND (u.rol = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'AUDITOR'::rol_usuario]))))) OR ( SELECT auth_permiso_any('{ver_actividad_log}'::text[]))));
  END IF;
END $mig$;

-- public.afp
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'afp' AND policyname = 'afp_write') THEN
    ALTER POLICY "afp_write" ON "public"."afp"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.agenda_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agenda_servicio_hogar' AND policyname = 'agenda_sh_read') THEN
    ALTER POLICY "agenda_sh_read" ON "public"."agenda_servicio_hogar"
      USING ((false OR (EXISTS ( SELECT 1
     FROM solicitudes_servicio_hogar s
    WHERE ((s.id = agenda_servicio_hogar.solicitud_id) AND (s.cliente_id = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso_any('{ver_servicios_hogar}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agenda_servicio_hogar' AND policyname = 'agenda_sh_write') THEN
    ALTER POLICY "agenda_sh_write" ON "public"."agenda_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_agenda_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_agenda_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.aprovisionamiento
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'aprovisionamiento' AND policyname = 'auth_read_aprov') THEN
    ALTER POLICY "auth_read_aprov" ON "public"."aprovisionamiento"
      USING (( SELECT auth_permiso_any(ARRAY['ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'aprovisionamiento' AND policyname = 'write_aprov') THEN
    ALTER POLICY "write_aprov" ON "public"."aprovisionamiento"
      USING ((false OR ( SELECT auth_permiso_any('{editar_aprovisionamiento}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_aprovisionamiento}'::text[]))));
  END IF;
END $mig$;

-- public.arl
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'arl' AND policyname = 'arl_write') THEN
    ALTER POLICY "arl_write" ON "public"."arl"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.arqueo_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'arqueo_items' AND policyname = 'auth_read_arqueo_items') THEN
    ALTER POLICY "auth_read_arqueo_items" ON "public"."arqueo_items"
      USING (( SELECT auth_permiso_any(ARRAY['ver_arqueo'::text, 'realizar_arqueo'::text, 'ver_inventario_fisico'::text, 'cargar_inventario_fisico'::text, 'ver_stock'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;

-- public.arqueos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'arqueos' AND policyname = 'auth_read_arqueos') THEN
    ALTER POLICY "auth_read_arqueos" ON "public"."arqueos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_arqueo'::text, 'realizar_arqueo'::text, 'ver_inventario_fisico'::text, 'cargar_inventario_fisico'::text, 'ver_stock'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;

-- public.bancos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bancos' AND policyname = 'bancos_write') THEN
    ALTER POLICY "bancos_write" ON "public"."bancos"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.beneficiarios
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'beneficiarios' AND policyname = 'beneficiarios_owner') THEN
    ALTER POLICY "beneficiarios_owner" ON "public"."beneficiarios"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = beneficiarios.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = beneficiarios.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.bodega_pisos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bodega_pisos' AND policyname = 'auth_read_bodega_pisos') THEN
    ALTER POLICY "auth_read_bodega_pisos" ON "public"."bodega_pisos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_bodegas'::text, 'gestionar_bodegas'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_stock'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_alistamiento'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bodega_pisos' AND policyname = 'write_bodega_pisos') THEN
    ALTER POLICY "write_bodega_pisos" ON "public"."bodega_pisos"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_bodegas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_bodegas}'::text[]))));
  END IF;
END $mig$;

-- public.bodegas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bodegas' AND policyname = 'auth_read_bodegas') THEN
    ALTER POLICY "auth_read_bodegas" ON "public"."bodegas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_bodegas'::text, 'gestionar_bodegas'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_stock'::text, 'ajustar_stock'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_arqueo'::text, 'ver_inventario_fisico'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bodegas' AND policyname = 'write_bodegas') THEN
    ALTER POLICY "write_bodegas" ON "public"."bodegas"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_bodegas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_bodegas}'::text[]))));
  END IF;
END $mig$;

-- public.cajas_compensacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cajas_compensacion' AND policyname = 'cajas_compensacion_write') THEN
    ALTER POLICY "cajas_compensacion_write" ON "public"."cajas_compensacion"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.calificaciones_cliente
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'calificaciones_cliente' AND policyname = 'calif_cliente_staff') THEN
    ALTER POLICY "calif_cliente_staff" ON "public"."calificaciones_cliente"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.candidato_direcciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_direcciones' AND policyname = 'candidato_direcciones_owner') THEN
    ALTER POLICY "candidato_direcciones_owner" ON "public"."candidato_direcciones"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_direcciones.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_direcciones.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.candidato_documentos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_documentos' AND policyname = 'candidato_documentos_owner') THEN
    ALTER POLICY "candidato_documentos_owner" ON "public"."candidato_documentos"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_documentos.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_documentos.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.candidato_estudios
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_estudios' AND policyname = 'candidato_estudios_mod') THEN
    ALTER POLICY "candidato_estudios_mod" ON "public"."candidato_estudios"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_estudios.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso('gestionar_postulaciones'::text))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_estudios.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso('gestionar_postulaciones'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_estudios' AND policyname = 'candidato_estudios_sel') THEN
    ALTER POLICY "candidato_estudios_sel" ON "public"."candidato_estudios"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_estudios.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text]))));
  END IF;
END $mig$;

-- public.candidato_evaluaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_evaluaciones' AND policyname = 'candidato_evaluaciones_read') THEN
    ALTER POLICY "candidato_evaluaciones_read" ON "public"."candidato_evaluaciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_evaluaciones' AND policyname = 'candidato_evaluaciones_write') THEN
    ALTER POLICY "candidato_evaluaciones_write" ON "public"."candidato_evaluaciones"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.candidato_eventos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_eventos' AND policyname = 'cand_eventos_read') THEN
    ALTER POLICY "cand_eventos_read" ON "public"."candidato_eventos"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])) OR (EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_eventos.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid)))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_eventos' AND policyname = 'cand_eventos_write') THEN
    ALTER POLICY "cand_eventos_write" ON "public"."candidato_eventos"
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.candidato_experiencias
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_experiencias' AND policyname = 'candidato_experiencias_mod') THEN
    ALTER POLICY "candidato_experiencias_mod" ON "public"."candidato_experiencias"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_experiencias.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso('gestionar_postulaciones'::text))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_experiencias.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso('gestionar_postulaciones'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_experiencias' AND policyname = 'candidato_experiencias_sel') THEN
    ALTER POLICY "candidato_experiencias_sel" ON "public"."candidato_experiencias"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_experiencias.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text]))));
  END IF;
END $mig$;

-- public.candidato_observaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_observaciones' AND policyname = 'candidato_observaciones_read') THEN
    ALTER POLICY "candidato_observaciones_read" ON "public"."candidato_observaciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_observaciones' AND policyname = 'candidato_observaciones_write') THEN
    ALTER POLICY "candidato_observaciones_write" ON "public"."candidato_observaciones"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.candidato_referencias
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_referencias' AND policyname = 'candidato_referencias_mod') THEN
    ALTER POLICY "candidato_referencias_mod" ON "public"."candidato_referencias"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_referencias.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso('gestionar_postulaciones'::text))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_referencias.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso('gestionar_postulaciones'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidato_referencias' AND policyname = 'candidato_referencias_sel') THEN
    ALTER POLICY "candidato_referencias_sel" ON "public"."candidato_referencias"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = candidato_referencias.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))) OR ( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text]))));
  END IF;
END $mig$;

-- public.candidatos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidatos' AND policyname = 'candidatos_owner_sel') THEN
    ALTER POLICY "candidatos_owner_sel" ON "public"."candidatos"
      USING (((auth_uid = ( SELECT auth.uid() AS uid)) OR false OR ( SELECT auth_permiso_any('{ver_postulaciones}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidatos' AND policyname = 'candidatos_owner_upd') THEN
    ALTER POLICY "candidatos_owner_upd" ON "public"."candidatos"
      USING (((auth_uid = ( SELECT auth.uid() AS uid)) OR false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK (((auth_uid = ( SELECT auth.uid() AS uid)) OR false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'candidatos' AND policyname = 'candidatos_staff_del') THEN
    ALTER POLICY "candidatos_staff_del" ON "public"."candidatos"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.cargos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cargos' AND policyname = 'cargos_write') THEN
    ALTER POLICY "cargos_write" ON "public"."cargos"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.caso_mensajes
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'caso_mensajes' AND policyname = 'msj_staff') THEN
    ALTER POLICY "msj_staff" ON "public"."caso_mensajes"
      USING (( SELECT auth_permiso('gestionar_casos_hogar'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_casos_hogar'::text)));
  END IF;
END $mig$;

-- public.casos_servicio
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'casos_servicio' AND policyname = 'caso_staff') THEN
    ALTER POLICY "caso_staff" ON "public"."casos_servicio"
      USING (( SELECT auth_permiso('gestionar_casos_hogar'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_casos_hogar'::text)));
  END IF;
END $mig$;

-- public.centros_costo
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'centros_costo' AND policyname = 'cc_escribe') THEN
    ALTER POLICY "cc_escribe" ON "public"."centros_costo"
      USING (( SELECT auth_permiso('gestionar_planta_personal'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_planta_personal'::text)));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'centros_costo' AND policyname = 'cc_lee') THEN
    ALTER POLICY "cc_lee" ON "public"."centros_costo"
      USING (( SELECT auth_permiso_any(ARRAY['ver_planta_personal'::text, 'ver_personas'::text, 'ver_postulaciones'::text])));
  END IF;
END $mig$;

-- public.cesantias
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cesantias' AND policyname = 'cesantias_write') THEN
    ALTER POLICY "cesantias_write" ON "public"."cesantias"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.clientes
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'clientes_staff_read') THEN
    ALTER POLICY "clientes_staff_read" ON "public"."clientes"
      USING ((false OR ( SELECT auth_permiso_any('{ver_servicios_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.cobro_items_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cobro_items_hogar' AND policyname = 'cobro_items_staff') THEN
    ALTER POLICY "cobro_items_staff" ON "public"."cobro_items_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.cobros_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cobros_servicio_hogar' AND policyname = 'cobros_staff_all') THEN
    ALTER POLICY "cobros_staff_all" ON "public"."cobros_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.colombia_compra_eficiente
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'colombia_compra_eficiente' AND policyname = 'cce_read_all') THEN
    ALTER POLICY "cce_read_all" ON "public"."colombia_compra_eficiente"
      USING (( SELECT auth_permiso_any(ARRAY['ver_productos'::text, 'editar_productos'::text, 'ver_stock'::text, 'ajustar_stock'::text, 'ver_proveedores'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'colombia_compra_eficiente' AND policyname = 'cce_write_admin') THEN
    ALTER POLICY "cce_write_admin" ON "public"."colombia_compra_eficiente"
      USING (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'importar_datos'::text])))
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'importar_datos'::text])));
  END IF;
END $mig$;

-- public.compras_niveles_aprobacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'compras_niveles_aprobacion' AND policyname = 'compras_niveles_read') THEN
    ALTER POLICY "compras_niveles_read" ON "public"."compras_niveles_aprobacion"
      USING (( SELECT auth_permiso_any('{ver_ordenes_compra,crear_ordenes_compra,aprobar_ordenes_compra}'::text[])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'compras_niveles_aprobacion' AND policyname = 'compras_niveles_write') THEN
    ALTER POLICY "compras_niveles_write" ON "public"."compras_niveles_aprobacion"
      USING (( SELECT auth_permiso_any('{gestionar_parametrizacion}'::text[])))
      WITH CHECK (( SELECT auth_permiso_any('{gestionar_parametrizacion}'::text[])));
  END IF;
END $mig$;

-- public.concerje_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'concerje_servicio_hogar' AND policyname = 'csh_staff_all') THEN
    ALTER POLICY "csh_staff_all" ON "public"."concerje_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_agenda_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_agenda_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.concerjes_bloqueados
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'concerjes_bloqueados' AND policyname = 'blo_staff_read') THEN
    ALTER POLICY "blo_staff_read" ON "public"."concerjes_bloqueados"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'OPERADOR_SEDE'::rol_usuario])));
  END IF;
END $mig$;

-- public.concerjes_favoritos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'concerjes_favoritos' AND policyname = 'fav_staff_read') THEN
    ALTER POLICY "fav_staff_read" ON "public"."concerjes_favoritos"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'OPERADOR_SEDE'::rol_usuario])));
  END IF;
END $mig$;

-- public.concerjes_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'concerjes_hogar' AND policyname = 'concerjes_staff_all') THEN
    ALTER POLICY "concerjes_staff_all" ON "public"."concerjes_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_agenda_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_agenda_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.conductor_ubicacion_actual
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conductor_ubicacion_actual' AND policyname = 'gps_act_read') THEN
    ALTER POLICY "gps_act_read" ON "public"."conductor_ubicacion_actual"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_ubicacion_conductores'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'gestionar_conductores'::text])) OR (conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conductor_ubicacion_actual' AND policyname = 'gps_act_write') THEN
    ALTER POLICY "gps_act_write" ON "public"."conductor_ubicacion_actual"
      USING ((( SELECT auth_permiso_any(ARRAY['gestionar_rutas'::text, 'gestionar_conductores'::text])) OR (conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid))))))
      WITH CHECK (((conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT auth_permiso_any(ARRAY['actualizar_gps_conductor'::text, 'gestionar_rutas'::text, 'gestionar_conductores'::text]))));
  END IF;
END $mig$;

-- public.conductor_ubicacion_historial
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conductor_ubicacion_historial' AND policyname = 'gps_hist_insert') THEN
    ALTER POLICY "gps_hist_insert" ON "public"."conductor_ubicacion_historial"
      WITH CHECK (((conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid())))) OR false OR ( SELECT auth_permiso_any('{actualizar_gps_conductor}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conductor_ubicacion_historial' AND policyname = 'gps_hist_read') THEN
    ALTER POLICY "gps_hist_read" ON "public"."conductor_ubicacion_historial"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_ubicacion_conductores'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'gestionar_conductores'::text])) OR (conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;

-- public.conductores
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conductores' AND policyname = 'cond_read') THEN
    ALTER POLICY "cond_read" ON "public"."conductores"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_logistica'::text, 'gestionar_conductores'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'ver_novedades_entrega'::text, 'gestionar_novedades_entrega'::text, 'ver_ubicacion_conductores'::text])) OR (usuario_id = ( SELECT auth.uid() AS uid))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conductores' AND policyname = 'cond_write') THEN
    ALTER POLICY "cond_write" ON "public"."conductores"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_conductores}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_conductores}'::text[]))));
  END IF;
END $mig$;

-- public.confirmaciones_entrega
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'confirmaciones_entrega' AND policyname = 'conf_read') THEN
    ALTER POLICY "conf_read" ON "public"."confirmaciones_entrega"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_logistica'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'gestionar_conductores'::text, 'recibir_ordenes_insumo'::text, 'ver_ordenes_insumo'::text, 'ver_alistamiento'::text, 'alistar_ordenes_insumo'::text])) OR (conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'confirmaciones_entrega' AND policyname = 'conf_write') THEN
    ALTER POLICY "conf_write" ON "public"."confirmaciones_entrega"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_rutas,confirmar_entrega_conductor}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_rutas,confirmar_entrega_conductor}'::text[]))));
  END IF;
END $mig$;

-- public.consentimientos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'consentimientos' AND policyname = 'consentimientos_owner') THEN
    ALTER POLICY "consentimientos_owner" ON "public"."consentimientos"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = consentimientos.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = consentimientos.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.contactos_web
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contactos_web' AND policyname = 'admin_read_contactos') THEN
    ALTER POLICY "admin_read_contactos" ON "public"."contactos_web"
      USING ((false OR ( SELECT auth_permiso_any('{ver_configuracion}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contactos_web' AND policyname = 'admin_update_contactos') THEN
    ALTER POLICY "admin_update_contactos" ON "public"."contactos_web"
      USING ((false OR ( SELECT auth_permiso_any('{editar_configuracion}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_configuracion}'::text[]))));
  END IF;
END $mig$;

-- public.contratos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contratos' AND policyname = 'contratos_read') THEN
    ALTER POLICY "contratos_read" ON "public"."contratos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contratos' AND policyname = 'contratos_write') THEN
    ALTER POLICY "contratos_write" ON "public"."contratos"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.correo_saliente
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'correo_saliente' AND policyname = 'admin_correo_saliente') THEN
    ALTER POLICY "admin_correo_saliente" ON "public"."correo_saliente"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_integraciones}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_integraciones}'::text[]))));
  END IF;
END $mig$;

-- public.departamentos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'departamentos' AND policyname = 'departamentos_write') THEN
    ALTER POLICY "departamentos_write" ON "public"."departamentos"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.descuentos_volumen_empresas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'descuentos_volumen_empresas' AND policyname = 'sim_desc_write') THEN
    ALTER POLICY "sim_desc_write" ON "public"."descuentos_volumen_empresas"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])))
      WITH CHECK ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])));
  END IF;
END $mig$;

-- public.direcciones_cliente
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'direcciones_cliente' AND policyname = 'dir_staff_read') THEN
    ALTER POLICY "dir_staff_read" ON "public"."direcciones_cliente"
      USING ((false OR ( SELECT auth_permiso_any('{ver_servicios_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.directorio_contactos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'directorio_contactos' AND policyname = 'directorio_contactos_read') THEN
    ALTER POLICY "directorio_contactos_read" ON "public"."directorio_contactos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_directorio_correos'::text, 'gestionar_directorio_correos'::text, 'ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'directorio_contactos' AND policyname = 'directorio_contactos_write') THEN
    ALTER POLICY "directorio_contactos_write" ON "public"."directorio_contactos"
      USING (( SELECT auth_permiso('gestionar_directorio_correos'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_directorio_correos'::text)));
  END IF;
END $mig$;

-- public.directorio_listas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'directorio_listas' AND policyname = 'directorio_listas_read') THEN
    ALTER POLICY "directorio_listas_read" ON "public"."directorio_listas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_directorio_correos'::text, 'gestionar_directorio_correos'::text, 'ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'directorio_listas' AND policyname = 'directorio_listas_write') THEN
    ALTER POLICY "directorio_listas_write" ON "public"."directorio_listas"
      USING (( SELECT auth_permiso('gestionar_directorio_correos'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_directorio_correos'::text)));
  END IF;
END $mig$;

-- public.documentos_generados
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documentos_generados' AND policyname = 'docgen_read') THEN
    ALTER POLICY "docgen_read" ON "public"."documentos_generados"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])) OR ((estado <> 'ANULADO'::text) AND visible_candidato AND (EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = documentos_generados.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid))))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documentos_generados' AND policyname = 'docgen_write') THEN
    ALTER POLICY "docgen_write" ON "public"."documentos_generados"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.documentos_persona
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documentos_persona' AND policyname = 'gh_read_docs') THEN
    ALTER POLICY "gh_read_docs" ON "public"."documentos_persona"
      USING (( SELECT auth_permiso_any(ARRAY['ver_documentos_rrhh'::text, 'gestionar_documentos_rrhh'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documentos_persona' AND policyname = 'gh_write_docs') THEN
    ALTER POLICY "gh_write_docs" ON "public"."documentos_persona"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_documentos_rrhh}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_documentos_rrhh}'::text[]))));
  END IF;
END $mig$;

-- public.empresas_cotizacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas_cotizacion' AND policyname = 'emp_cot_staff') THEN
    ALTER POLICY "emp_cot_staff" ON "public"."empresas_cotizacion"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario])))
      WITH CHECK ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario])));
  END IF;
END $mig$;

-- public.empresas_cotizacion_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas_cotizacion_items' AND policyname = 'emp_cot_items_staff') THEN
    ALTER POLICY "emp_cot_items_staff" ON "public"."empresas_cotizacion_items"
      USING ((EXISTS ( SELECT 1
     FROM empresas_cotizacion c
    WHERE ((c.id = empresas_cotizacion_items.cotizacion_id) AND ((c.cliente_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario])))))))
      WITH CHECK ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario])));
  END IF;
END $mig$;

-- public.empresas_emisoras
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas_emisoras' AND policyname = 'ee_read') THEN
    ALTER POLICY "ee_read" ON "public"."empresas_emisoras"
      USING (( SELECT auth_permiso_any(ARRAY['ver_configuracion'::text, 'editar_configuracion'::text, 'gestionar_integraciones'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_ordenes_compra'::text, 'crear_ordenes_compra'::text, 'ver_directorio_correos'::text, 'gestionar_directorio_correos'::text, 'ver_notificaciones'::text, 'gestionar_plantillas_correo'::text, 'ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'ver_pagos_hogar'::text, 'gestionar_pagos_hogar'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas_emisoras' AND policyname = 'ee_write') THEN
    ALTER POLICY "ee_write" ON "public"."empresas_emisoras"
      USING ((false OR ( SELECT auth_permiso_any('{editar_configuracion}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_configuracion}'::text[]))));
  END IF;
END $mig$;

-- public.empresas_usuarias
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas_usuarias' AND policyname = 'gh_read_empresas') THEN
    ALTER POLICY "gh_read_empresas" ON "public"."empresas_usuarias"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_empresas_usuarias'::text, 'gestionar_empresas_usuarias'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'importar_personas'::text, 'ver_planta_personal'::text, 'gestionar_planta_personal'::text, 'ver_documentos_rrhh'::text, 'gestionar_documentos_rrhh'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'ver_requisiciones'::text, 'gestionar_requisiciones'::text, 'ver_directorio_correos'::text, 'gestionar_directorio_correos'::text, 'ver_notificaciones'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])) OR (id IN ( SELECT p.empresa_usuaria_id
     FROM personas p
    WHERE (p.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresas_usuarias' AND policyname = 'gh_write_empresas') THEN
    ALTER POLICY "gh_write_empresas" ON "public"."empresas_usuarias"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_empresas_usuarias}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_empresas_usuarias}'::text[]))));
  END IF;
END $mig$;

-- public.eps
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eps' AND policyname = 'eps_write') THEN
    ALTER POLICY "eps_write" ON "public"."eps"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.etiqueta_categorias
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'etiqueta_categorias' AND policyname = 'etiqueta_categorias_read') THEN
    ALTER POLICY "etiqueta_categorias_read" ON "public"."etiqueta_categorias"
      USING (( SELECT auth_permiso_any(ARRAY['ver_contratos'::text, 'editar_contratos'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_parametrizacion'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'etiqueta_categorias' AND policyname = 'etiqueta_categorias_write') THEN
    ALTER POLICY "etiqueta_categorias_write" ON "public"."etiqueta_categorias"
      USING ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))));
  END IF;
END $mig$;

-- public.etiquetas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'etiquetas' AND policyname = 'etiquetas_read') THEN
    ALTER POLICY "etiquetas_read" ON "public"."etiquetas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_contratos'::text, 'editar_contratos'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_parametrizacion'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'etiquetas' AND policyname = 'etiquetas_write') THEN
    ALTER POLICY "etiquetas_write" ON "public"."etiquetas"
      USING ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))));
  END IF;
END $mig$;

-- public.eventos_notificacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eventos_notificacion' AND policyname = 'eventos_notif_read') THEN
    ALTER POLICY "eventos_notif_read" ON "public"."eventos_notificacion"
      USING (( SELECT auth_permiso_any(ARRAY['ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text, 'ver_notificaciones'::text, 'gestionar_alertas'::text, 'gestionar_plantillas_correo'::text, 'ver_configuracion'::text, 'editar_configuracion'::text, 'gestionar_integraciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eventos_notificacion' AND policyname = 'eventos_notif_write') THEN
    ALTER POLICY "eventos_notif_write" ON "public"."eventos_notificacion"
      USING (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)));
  END IF;
END $mig$;

-- public.eventos_pasarela
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eventos_pasarela' AND policyname = 'eventos_staff') THEN
    ALTER POLICY "eventos_staff" ON "public"."eventos_pasarela"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])));
  END IF;
END $mig$;

-- public.flujo_ejecucion_pasos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujo_ejecucion_pasos' AND policyname = 'flujo_ejec_pasos_read') THEN
    ALTER POLICY "flujo_ejec_pasos_read" ON "public"."flujo_ejecucion_pasos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujo_ejecucion_pasos' AND policyname = 'flujo_ejec_pasos_write') THEN
    ALTER POLICY "flujo_ejec_pasos_write" ON "public"."flujo_ejecucion_pasos"
      USING (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)));
  END IF;
END $mig$;

-- public.flujo_ejecuciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujo_ejecuciones' AND policyname = 'flujo_ejec_read') THEN
    ALTER POLICY "flujo_ejec_read" ON "public"."flujo_ejecuciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujo_ejecuciones' AND policyname = 'flujo_ejec_write') THEN
    ALTER POLICY "flujo_ejec_write" ON "public"."flujo_ejecuciones"
      USING (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)));
  END IF;
END $mig$;

-- public.flujo_pasos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujo_pasos' AND policyname = 'flujo_pasos_read') THEN
    ALTER POLICY "flujo_pasos_read" ON "public"."flujo_pasos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujo_pasos' AND policyname = 'flujo_pasos_write') THEN
    ALTER POLICY "flujo_pasos_write" ON "public"."flujo_pasos"
      USING (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)));
  END IF;
END $mig$;

-- public.flujos_notificacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujos_notificacion' AND policyname = 'flujos_read') THEN
    ALTER POLICY "flujos_read" ON "public"."flujos_notificacion"
      USING (( SELECT auth_permiso_any(ARRAY['ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'flujos_notificacion' AND policyname = 'flujos_write') THEN
    ALTER POLICY "flujos_write" ON "public"."flujos_notificacion"
      USING (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_flujos_notificacion'::text)));
  END IF;
END $mig$;

-- public.fotos_servicio
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fotos_servicio' AND policyname = 'fot_staff') THEN
    ALTER POLICY "fot_staff" ON "public"."fotos_servicio"
      USING (( SELECT auth_permiso('gestionar_solicitudes_hogar'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_solicitudes_hogar'::text)));
  END IF;
END $mig$;

-- public.galeria_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'galeria_servicio_hogar' AND policyname = 'galeria_staff_all') THEN
    ALTER POLICY "galeria_staff_all" ON "public"."galeria_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.grupo_etiquetas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grupo_etiquetas' AND policyname = 'grupo_etiquetas_read') THEN
    ALTER POLICY "grupo_etiquetas_read" ON "public"."grupo_etiquetas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_contratos'::text, 'editar_contratos'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_parametrizacion'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grupo_etiquetas' AND policyname = 'grupo_etiquetas_write') THEN
    ALTER POLICY "grupo_etiquetas_write" ON "public"."grupo_etiquetas"
      USING ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))));
  END IF;
END $mig$;

-- public.grupos_contrato
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grupos_contrato' AND policyname = 'auth_read_grupos') THEN
    ALTER POLICY "auth_read_grupos" ON "public"."grupos_contrato"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_contratos'::text, 'editar_contratos'::text, 'ver_contratos_conserjeria'::text, 'gestionar_contratos_conserjeria'::text, 'ver_parametrizacion'::text, 'gestionar_parametrizacion'::text, 'ver_usuarios'::text, 'gestionar_usuarios'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'ver_planta_personal'::text, 'ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text, 'ver_movimientos'::text, 'ver_productos'::text, 'ver_stock'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'gestionar_rutas'::text, 'ver_monitoreo_entregas'::text, 'ver_ubicacion_conductores'::text, 'gestionar_horarios_entrega'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])) OR (id = ( SELECT u.grupo_id
     FROM usuarios u
    WHERE (u.id = ( SELECT auth.uid() AS uid)))) OR (id IN ( SELECT auth_grupos() AS auth_grupos))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grupos_contrato' AND policyname = 'write_grupos') THEN
    ALTER POLICY "write_grupos" ON "public"."grupos_contrato"
      USING (((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario])) OR ( SELECT auth_permiso_any(ARRAY['editar_contratos'::text, 'gestionar_contratos_conserjeria'::text]))))
      WITH CHECK (((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario])) OR ( SELECT auth_permiso_any(ARRAY['editar_contratos'::text, 'gestionar_contratos_conserjeria'::text]))));
  END IF;
END $mig$;

-- public.historial_cambios
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'historial_cambios' AND policyname = 'auth_read_historial') THEN
    ALTER POLICY "auth_read_historial" ON "public"."historial_cambios"
      USING (( SELECT auth_permiso_any(ARRAY['ver_historial'::text, 'ver_actividad_log'::text])));
  END IF;
END $mig$;

-- public.importaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'importaciones' AND policyname = 'auth_read_importaciones') THEN
    ALTER POLICY "auth_read_importaciones" ON "public"."importaciones"
      USING ((( SELECT auth_permiso_any(ARRAY['importar_datos'::text, 'importar_personas'::text, 'ver_historial'::text, 'ver_actividad_log'::text])) OR (usuario_id = ( SELECT auth.uid() AS uid))));
  END IF;
END $mig$;

-- public.integraciones_correo
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integraciones_correo' AND policyname = 'admin_all_integr_correo') THEN
    ALTER POLICY "admin_all_integr_correo" ON "public"."integraciones_correo"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_integraciones}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_integraciones}'::text[]))));
  END IF;
END $mig$;

-- public.intentos_identificacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'intentos_identificacion' AND policyname = 'intentos_staff') THEN
    ALTER POLICY "intentos_staff" ON "public"."intentos_identificacion"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.inventario_fisico_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inventario_fisico_items' AND policyname = 'inventario_fisico_items_select') THEN
    ALTER POLICY "inventario_fisico_items_select" ON "public"."inventario_fisico_items"
      USING (( SELECT auth_permiso_any('{ver_inventario_fisico,cargar_inventario_fisico}'::text[])));
  END IF;
END $mig$;

-- public.inventarios_fisicos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inventarios_fisicos' AND policyname = 'inventarios_fisicos_select') THEN
    ALTER POLICY "inventarios_fisicos_select" ON "public"."inventarios_fisicos"
      USING (( SELECT auth_permiso_any('{ver_inventario_fisico,cargar_inventario_fisico}'::text[])));
  END IF;
END $mig$;

-- public.ips
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ips' AND policyname = 'ips_write') THEN
    ALTER POLICY "ips_write" ON "public"."ips"
      USING (( SELECT auth_permiso_any(ARRAY['gestionar_directorio_correos'::text, 'gestionar_postulaciones'::text])))
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['gestionar_directorio_correos'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;

-- public.maquinaria
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maquinaria' AND policyname = 'maq_read') THEN
    ALTER POLICY "maq_read" ON "public"."maquinaria"
      USING (( SELECT auth_permiso_any(ARRAY['ver_maquinaria'::text, 'gestionar_maquinaria'::text, 'ver_mantenimiento'::text, 'atender_mantenimiento'::text, 'gestionar_mantenimiento'::text, 'reportar_falla_maquinaria'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maquinaria' AND policyname = 'maq_write') THEN
    ALTER POLICY "maq_write" ON "public"."maquinaria"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))));
  END IF;
END $mig$;

-- public.maquinaria_eventos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maquinaria_eventos' AND policyname = 'maq_ev_read') THEN
    ALTER POLICY "maq_ev_read" ON "public"."maquinaria_eventos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_maquinaria'::text, 'gestionar_maquinaria'::text, 'ver_mantenimiento'::text, 'atender_mantenimiento'::text, 'gestionar_mantenimiento'::text, 'reportar_falla_maquinaria'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'maquinaria_eventos' AND policyname = 'maq_ev_write') THEN
    ALTER POLICY "maq_ev_write" ON "public"."maquinaria_eventos"
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))));
  END IF;
END $mig$;

-- public.metodos_pago_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'metodos_pago_hogar' AND policyname = 'metodos_pago_read') THEN
    ALTER POLICY "metodos_pago_read" ON "public"."metodos_pago_hogar"
      USING ((((activo = true) AND (visible_cliente = true)) OR false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'metodos_pago_hogar' AND policyname = 'metodos_pago_write') THEN
    ALTER POLICY "metodos_pago_write" ON "public"."metodos_pago_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{parametrizar_pagos_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{parametrizar_pagos_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.movimiento_borrador_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimiento_borrador_items' AND policyname = 'movimiento_borrador_items_read') THEN
    ALTER POLICY "movimiento_borrador_items_read" ON "public"."movimiento_borrador_items"
      USING (( SELECT auth_permiso_any(ARRAY['ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_alistamiento'::text, 'alistar_ordenes_insumo'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimiento_borrador_items' AND policyname = 'movimiento_borrador_items_write') THEN
    ALTER POLICY "movimiento_borrador_items_write" ON "public"."movimiento_borrador_items"
      USING (( SELECT auth_permiso('crear_movimientos'::text)))
      WITH CHECK (( SELECT auth_permiso('crear_movimientos'::text)));
  END IF;
END $mig$;

-- public.movimiento_borrador_responsables
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimiento_borrador_responsables' AND policyname = 'movimiento_borrador_responsables_read') THEN
    ALTER POLICY "movimiento_borrador_responsables_read" ON "public"."movimiento_borrador_responsables"
      USING (( SELECT auth_permiso_any(ARRAY['ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_alistamiento'::text, 'alistar_ordenes_insumo'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimiento_borrador_responsables' AND policyname = 'movimiento_borrador_responsables_write') THEN
    ALTER POLICY "movimiento_borrador_responsables_write" ON "public"."movimiento_borrador_responsables"
      USING (( SELECT auth_permiso('crear_movimientos'::text)))
      WITH CHECK (( SELECT auth_permiso('crear_movimientos'::text)));
  END IF;
END $mig$;

-- public.movimiento_borradores
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimiento_borradores' AND policyname = 'movimiento_borradores_read') THEN
    ALTER POLICY "movimiento_borradores_read" ON "public"."movimiento_borradores"
      USING (( SELECT auth_permiso_any(ARRAY['ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_alistamiento'::text, 'alistar_ordenes_insumo'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimiento_borradores' AND policyname = 'movimiento_borradores_write') THEN
    ALTER POLICY "movimiento_borradores_write" ON "public"."movimiento_borradores"
      USING (( SELECT auth_permiso('crear_movimientos'::text)))
      WITH CHECK (( SELECT auth_permiso('crear_movimientos'::text)));
  END IF;
END $mig$;

-- public.movimientos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimientos' AND policyname = 'auth_read_movimientos') THEN
    ALTER POLICY "auth_read_movimientos" ON "public"."movimientos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_stock'::text, 'ajustar_stock'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_bodegas'::text, 'ver_arqueo'::text, 'ver_inventario_fisico'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimientos' AND policyname = 'write_movimientos') THEN
    ALTER POLICY "write_movimientos" ON "public"."movimientos"
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{crear_movimientos}'::text[]))));
  END IF;
END $mig$;

-- public.movimientos_puntos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movimientos_puntos' AND policyname = 'mov_puntos_staff') THEN
    ALTER POLICY "mov_puntos_staff" ON "public"."movimientos_puntos"
      USING (( SELECT auth_permiso('ver_puntos_hogar'::text)));
  END IF;
END $mig$;

-- public.municipios
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'municipios' AND policyname = 'municipios_write') THEN
    ALTER POLICY "municipios_write" ON "public"."municipios"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.municipios_nomina
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'municipios_nomina' AND policyname = 'municipios_nomina_write') THEN
    ALTER POLICY "municipios_nomina_write" ON "public"."municipios_nomina"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.notificaciones_cliente
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notificaciones_cliente' AND policyname = 'notif_cliente_staff') THEN
    ALTER POLICY "notif_cliente_staff" ON "public"."notificaciones_cliente"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.novedades_entrega
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'novedades_entrega' AND policyname = 'novedades_read') THEN
    ALTER POLICY "novedades_read" ON "public"."novedades_entrega"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_novedades_entrega'::text, 'gestionar_novedades_entrega'::text, 'reportar_novedad_conductor'::text, 'ver_logistica'::text, 'gestionar_rutas'::text, 'ver_monitoreo_entregas'::text, 'ver_ubicacion_conductores'::text, 'gestionar_conductores'::text, 'ver_rutas_conductor'::text, 'ver_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_reportes'::text, 'exportar_datos'::text])) OR (conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'novedades_entrega' AND policyname = 'novedades_write') THEN
    ALTER POLICY "novedades_write" ON "public"."novedades_entrega"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_novedades_entrega,reportar_novedad_conductor}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_novedades_entrega,reportar_novedad_conductor}'::text[]))));
  END IF;
END $mig$;

-- public.obras
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obras' AND policyname = 'obras_write') THEN
    ALTER POLICY "obras_write" ON "public"."obras"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.oc_eventos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oc_eventos' AND policyname = 'oc_eventos_read') THEN
    ALTER POLICY "oc_eventos_read" ON "public"."oc_eventos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_compra'::text, 'crear_ordenes_compra'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oc_eventos' AND policyname = 'oc_eventos_write') THEN
    ALTER POLICY "oc_eventos_write" ON "public"."oc_eventos"
      WITH CHECK (( SELECT auth_permiso_any('{crear_ordenes_compra,aprobar_ordenes_compra,aprobar_ordenes_compra_sin_tope,recibir_ordenes_compra}'::text[])));
  END IF;
END $mig$;

-- public.oc_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oc_items' AND policyname = 'auth_read_oc_items') THEN
    ALTER POLICY "auth_read_oc_items" ON "public"."oc_items"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_compra'::text, 'crear_ordenes_compra'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oc_items' AND policyname = 'oc_items_write') THEN
    ALTER POLICY "oc_items_write" ON "public"."oc_items"
      USING (( SELECT auth_permiso('crear_ordenes_compra'::text)))
      WITH CHECK (( SELECT auth_permiso('crear_ordenes_compra'::text)));
  END IF;
END $mig$;

-- public.oc_recepcion_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oc_recepcion_items' AND policyname = 'oc_recepcion_items_read') THEN
    ALTER POLICY "oc_recepcion_items_read" ON "public"."oc_recepcion_items"
      USING (( SELECT auth_permiso_any('{ver_ordenes_compra,crear_ordenes_compra,recibir_ordenes_compra}'::text[])));
  END IF;
END $mig$;

-- public.oc_recepciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oc_recepciones' AND policyname = 'oc_recepciones_read') THEN
    ALTER POLICY "oc_recepciones_read" ON "public"."oc_recepciones"
      USING (( SELECT auth_permiso_any('{ver_ordenes_compra,crear_ordenes_compra,recibir_ordenes_compra}'::text[])));
  END IF;
END $mig$;

-- public.orden_insumo_devolucion_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_devolucion_items' AND policyname = 'oi_dev_items_read') THEN
    ALTER POLICY "oi_dev_items_read" ON "public"."orden_insumo_devolucion_items"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_movimientos'::text, 'ver_stock'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_devolucion_items' AND policyname = 'oi_dev_items_write') THEN
    ALTER POLICY "oi_dev_items_write" ON "public"."orden_insumo_devolucion_items"
      USING ((false OR ( SELECT auth_permiso_any('{alistar_ordenes_insumo,aprobar_ordenes_insumo}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{alistar_ordenes_insumo,aprobar_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;

-- public.orden_insumo_devoluciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_devoluciones' AND policyname = 'oi_dev_read') THEN
    ALTER POLICY "oi_dev_read" ON "public"."orden_insumo_devoluciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_movimientos'::text, 'ver_stock'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_devoluciones' AND policyname = 'oi_dev_write') THEN
    ALTER POLICY "oi_dev_write" ON "public"."orden_insumo_devoluciones"
      USING ((false OR ( SELECT auth_permiso_any('{alistar_ordenes_insumo,aprobar_ordenes_insumo}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{alistar_ordenes_insumo,aprobar_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;

-- public.orden_insumo_eventos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_eventos' AND policyname = 'oi_ev_read') THEN
    ALTER POLICY "oi_ev_read" ON "public"."orden_insumo_eventos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'ver_contratos'::text, 'editar_contratos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_eventos' AND policyname = 'oi_ev_write') THEN
    ALTER POLICY "oi_ev_write" ON "public"."orden_insumo_eventos"
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text])));
  END IF;
END $mig$;

-- public.orden_insumo_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_items' AND policyname = 'oi_items_read') THEN
    ALTER POLICY "oi_items_read" ON "public"."orden_insumo_items"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'ver_rutas_conductor'::text, 'confirmar_entrega_conductor'::text, 'ver_novedades_entrega'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_stock'::text, 'ver_productos'::text, 'ver_aprovisionamiento'::text, 'ver_contratos'::text, 'editar_contratos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_items' AND policyname = 'oi_items_write') THEN
    ALTER POLICY "oi_items_write" ON "public"."orden_insumo_items"
      USING ((false OR ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;

-- public.orden_insumo_responsables
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_responsables' AND policyname = 'oi_resp_read') THEN
    ALTER POLICY "oi_resp_read" ON "public"."orden_insumo_responsables"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'ver_contratos'::text, 'editar_contratos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_insumo_responsables' AND policyname = 'oi_resp_write') THEN
    ALTER POLICY "oi_resp_write" ON "public"."orden_insumo_responsables"
      USING ((false OR ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;

-- public.ordenes_compra
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes_compra' AND policyname = 'auth_read_oc') THEN
    ALTER POLICY "auth_read_oc" ON "public"."ordenes_compra"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_compra'::text, 'crear_ordenes_compra'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes_compra' AND policyname = 'oc_delete') THEN
    ALTER POLICY "oc_delete" ON "public"."ordenes_compra"
      USING (( SELECT auth_permiso('crear_ordenes_compra'::text)));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes_compra' AND policyname = 'oc_insert') THEN
    ALTER POLICY "oc_insert" ON "public"."ordenes_compra"
      WITH CHECK (( SELECT auth_permiso('crear_ordenes_compra'::text)));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes_compra' AND policyname = 'oc_update') THEN
    ALTER POLICY "oc_update" ON "public"."ordenes_compra"
      USING (( SELECT auth_permiso_any('{crear_ordenes_compra,aprobar_ordenes_compra,aprobar_ordenes_compra_sin_tope}'::text[])))
      WITH CHECK (( SELECT auth_permiso_any('{crear_ordenes_compra,aprobar_ordenes_compra,aprobar_ordenes_compra_sin_tope}'::text[])));
  END IF;
END $mig$;

-- public.ordenes_insumo
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes_insumo' AND policyname = 'oi_read') THEN
    ALTER POLICY "oi_read" ON "public"."ordenes_insumo"
      USING (( SELECT auth_permiso_any(ARRAY['ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'ver_rutas_conductor'::text, 'confirmar_entrega_conductor'::text, 'ver_novedades_entrega'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_stock'::text, 'ver_productos'::text, 'ver_aprovisionamiento'::text, 'ver_contratos'::text, 'editar_contratos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ordenes_insumo' AND policyname = 'oi_write') THEN
    ALTER POLICY "oi_write" ON "public"."ordenes_insumo"
      USING ((false OR ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;

-- public.pagos_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pagos_hogar' AND policyname = 'pagos_staff_all') THEN
    ALTER POLICY "pagos_staff_all" ON "public"."pagos_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_pagos_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.paquetes_documentos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'paquetes_documentos' AND policyname = 'paquetes_read') THEN
    ALTER POLICY "paquetes_read" ON "public"."paquetes_documentos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'paquetes_documentos' AND policyname = 'paquetes_write') THEN
    ALTER POLICY "paquetes_write" ON "public"."paquetes_documentos"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.parametros_legales
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parametros_legales' AND policyname = 'parametros_legales_write') THEN
    ALTER POLICY "parametros_legales_write" ON "public"."parametros_legales"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.parametros_pago_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parametros_pago_hogar' AND policyname = 'param_pago_read') THEN
    ALTER POLICY "param_pago_read" ON "public"."parametros_pago_hogar"
      USING (( SELECT auth_permiso_any(ARRAY['ver_pagos_hogar'::text, 'gestionar_pagos_hogar'::text, 'parametrizar_pagos_hogar'::text, 'ver_servicios_hogar'::text, 'gestionar_solicitudes_hogar'::text, 'gestionar_agenda_hogar'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parametros_pago_hogar' AND policyname = 'param_pago_write') THEN
    ALTER POLICY "param_pago_write" ON "public"."parametros_pago_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{parametrizar_pagos_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{parametrizar_pagos_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.parametros_precio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parametros_precio_hogar' AND policyname = 'param_precio_write') THEN
    ALTER POLICY "param_precio_write" ON "public"."parametros_precio_hogar"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])))
      WITH CHECK ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])));
  END IF;
END $mig$;

-- public.parametros_puntos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parametros_puntos' AND policyname = 'param_puntos_write') THEN
    ALTER POLICY "param_puntos_write" ON "public"."parametros_puntos"
      USING (( SELECT auth_permiso('parametrizar_puntos_hogar'::text)))
      WITH CHECK (( SELECT auth_permiso('parametrizar_puntos_hogar'::text)));
  END IF;
END $mig$;

-- public.parametros_simulador_empresas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'parametros_simulador_empresas' AND policyname = 'sim_param_write') THEN
    ALTER POLICY "sim_param_write" ON "public"."parametros_simulador_empresas"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])))
      WITH CHECK ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])));
  END IF;
END $mig$;

-- public.pedidos_sede
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pedidos_sede' AND policyname = 'auth_read_pedidos') THEN
    ALTER POLICY "auth_read_pedidos" ON "public"."pedidos_sede"
      USING (( SELECT auth_permiso_any(ARRAY['ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pedidos_sede' AND policyname = 'write_pedidos') THEN
    ALTER POLICY "write_pedidos" ON "public"."pedidos_sede"
      USING ((false OR ( SELECT auth_permiso_any('{editar_aprovisionamiento}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_aprovisionamiento}'::text[]))));
  END IF;
END $mig$;

-- public.perfiles_facturacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'perfiles_facturacion' AND policyname = 'perfil_fact_staff_read') THEN
    ALTER POLICY "perfil_fact_staff_read" ON "public"."perfiles_facturacion"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario])));
  END IF;
END $mig$;

-- public.persona_vinculaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'persona_vinculaciones' AND policyname = 'vinc_escribe') THEN
    ALTER POLICY "vinc_escribe" ON "public"."persona_vinculaciones"
      USING (( SELECT auth_permiso('gestionar_planta_personal'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_planta_personal'::text)));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'persona_vinculaciones' AND policyname = 'vinc_lee') THEN
    ALTER POLICY "vinc_lee" ON "public"."persona_vinculaciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_planta_personal'::text, 'ver_personas'::text, 'ver_postulaciones'::text])));
  END IF;
END $mig$;

-- public.personas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'personas' AND policyname = 'gh_read_personas') THEN
    ALTER POLICY "gh_read_personas" ON "public"."personas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_personas'::text, 'gestionar_personas'::text, 'importar_personas'::text, 'ver_documentos_rrhh'::text, 'ver_planta_personal'::text, 'gestionar_planta_personal'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'personas' AND policyname = 'gh_write_personas') THEN
    ALTER POLICY "gh_write_personas" ON "public"."personas"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_personas}'::text[]))));
  END IF;
END $mig$;

-- public.planes_membresia
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'planes_membresia' AND policyname = 'planes_write') THEN
    ALTER POLICY "planes_write" ON "public"."planes_membresia"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])))
      WITH CHECK ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario])));
  END IF;
END $mig$;

-- public.plantilla_versiones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantilla_versiones' AND policyname = 'plantilla_versiones_read') THEN
    ALTER POLICY "plantilla_versiones_read" ON "public"."plantilla_versiones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_plantillas_documento'::text, 'gestionar_plantillas_documento'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantilla_versiones' AND policyname = 'plantilla_versiones_write') THEN
    ALTER POLICY "plantilla_versiones_write" ON "public"."plantilla_versiones"
      USING (( SELECT auth_permiso('gestionar_plantillas_documento'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_plantillas_documento'::text)));
  END IF;
END $mig$;

-- public.plantillas_correo
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantillas_correo' AND policyname = 'plantillas_read') THEN
    ALTER POLICY "plantillas_read" ON "public"."plantillas_correo"
      USING (( SELECT auth_permiso_any(ARRAY['gestionar_plantillas_correo'::text, 'ver_flujos_notificacion'::text, 'gestionar_integraciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantillas_correo' AND policyname = 'plantillas_write') THEN
    ALTER POLICY "plantillas_write" ON "public"."plantillas_correo"
      USING (( SELECT auth_permiso('gestionar_plantillas_correo'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_plantillas_correo'::text)));
  END IF;
END $mig$;

-- public.plantillas_documento
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantillas_documento' AND policyname = 'plantillas_doc_read') THEN
    ALTER POLICY "plantillas_doc_read" ON "public"."plantillas_documento"
      USING (( SELECT auth_permiso_any(ARRAY['ver_plantillas_documento'::text, 'gestionar_plantillas_documento'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantillas_documento' AND policyname = 'plantillas_doc_write') THEN
    ALTER POLICY "plantillas_doc_write" ON "public"."plantillas_documento"
      USING (( SELECT auth_permiso('gestionar_plantillas_documento'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_plantillas_documento'::text)));
  END IF;
END $mig$;

-- public.postulaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'postulaciones' AND policyname = 'postulaciones_owner') THEN
    ALTER POLICY "postulaciones_owner" ON "public"."postulaciones"
      USING (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = postulaciones.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK (((EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = postulaciones.candidato_id) AND ((c.auth_uid = ( SELECT auth.uid() AS uid)) OR false)))) OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.pqrs_bitacora
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pqrs_bitacora' AND policyname = 'pqrs_bitacora_insert') THEN
    ALTER POLICY "pqrs_bitacora_insert" ON "public"."pqrs_bitacora"
      WITH CHECK ((((tipo)::text = ANY ((ARRAY['MENSAJE'::character varying, 'ADJUNTO'::character varying])::text[])) AND (estado_nuevo IS NULL) AND (estado_anterior IS NULL) AND ( SELECT auth_permiso('gestionar_pqrs'::text)) AND pqrs_puede_ver(pqrs_id) AND ((adjunto_path IS NULL) OR (adjunto_path ~~ ((pqrs_id)::text || '/%'::text))) AND (EXISTS ( SELECT 1
     FROM pqrs p
    WHERE ((p.id = pqrs_bitacora.pqrs_id) AND ((p.estado)::text <> ALL ((ARRAY['CERRADA'::character varying, 'ANULADA'::character varying])::text[])))))));
  END IF;
END $mig$;

-- public.precios_proveedor
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'precios_proveedor' AND policyname = 'auth_read_precios') THEN
    ALTER POLICY "auth_read_precios" ON "public"."precios_proveedor"
      USING (( SELECT auth_permiso_any(ARRAY['ver_proveedores'::text, 'editar_proveedores'::text, 'ver_ordenes_compra'::text, 'crear_ordenes_compra'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'precios_proveedor' AND policyname = 'write_precios') THEN
    ALTER POLICY "write_precios" ON "public"."precios_proveedor"
      USING ((false OR ( SELECT auth_permiso_any('{editar_proveedores}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_proveedores}'::text[]))));
  END IF;
END $mig$;

-- public.preguntas_encuesta
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'preguntas_encuesta' AND policyname = 'preg_admin') THEN
    ALTER POLICY "preg_admin" ON "public"."preguntas_encuesta"
      USING (( SELECT auth_permiso('parametrizar_encuesta'::text)))
      WITH CHECK (( SELECT auth_permiso('parametrizar_encuesta'::text)));
  END IF;
END $mig$;

-- public.presentaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'presentaciones' AND policyname = 'pres_write') THEN
    ALTER POLICY "pres_write" ON "public"."presentaciones"
      USING (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'editar_configuracion'::text, 'editar_proveedores'::text])))
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'editar_configuracion'::text, 'editar_proveedores'::text])));
  END IF;
END $mig$;

-- public.producto_fotos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'producto_fotos' AND policyname = 'fotos_delete') THEN
    ALTER POLICY "fotos_delete" ON "public"."producto_fotos"
      USING (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'importar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'producto_fotos' AND policyname = 'fotos_insert') THEN
    ALTER POLICY "fotos_insert" ON "public"."producto_fotos"
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'importar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'producto_fotos' AND policyname = 'fotos_select') THEN
    ALTER POLICY "fotos_select" ON "public"."producto_fotos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_productos'::text, 'editar_productos'::text, 'generar_codigos'::text, 'ver_stock'::text, 'ajustar_stock'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_inventario_fisico'::text, 'ver_arqueo'::text, 'ver_bodegas'::text, 'ver_reembasado'::text, 'ver_parametrizacion'::text, 'ver_proveedores'::text, 'ver_ordenes_compra'::text, 'crear_ordenes_compra'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'producto_fotos' AND policyname = 'fotos_update') THEN
    ALTER POLICY "fotos_update" ON "public"."producto_fotos"
      USING (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'importar_datos'::text])))
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['editar_productos'::text, 'importar_datos'::text])));
  END IF;
END $mig$;

-- public.productos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'productos' AND policyname = 'auth_read_productos') THEN
    ALTER POLICY "auth_read_productos" ON "public"."productos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_productos'::text, 'editar_productos'::text, 'generar_codigos'::text, 'ver_stock'::text, 'ajustar_stock'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_arqueo'::text, 'realizar_arqueo'::text, 'ver_inventario_fisico'::text, 'cargar_inventario_fisico'::text, 'ver_bodegas'::text, 'gestionar_bodegas'::text, 'ver_reembasado'::text, 'gestionar_reembasado'::text, 'ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text, 'ver_parametrizacion'::text, 'gestionar_parametrizacion'::text, 'ver_proveedores'::text, 'editar_proveedores'::text, 'ver_ordenes_compra'::text, 'crear_ordenes_compra'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'ver_monitoreo_entregas'::text, 'gestionar_rutas'::text, 'ver_rutas_conductor'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'productos' AND policyname = 'write_productos') THEN
    ALTER POLICY "write_productos" ON "public"."productos"
      USING ((false OR ( SELECT auth_permiso_any('{editar_productos}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_productos}'::text[]))));
  END IF;
END $mig$;

-- public.proveedores
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'proveedores' AND policyname = 'auth_read_proveedores') THEN
    ALTER POLICY "auth_read_proveedores" ON "public"."proveedores"
      USING (( SELECT auth_permiso_any(ARRAY['ver_proveedores'::text, 'editar_proveedores'::text, 'ver_ordenes_compra'::text, 'crear_ordenes_compra'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_directorio_correos'::text, 'gestionar_directorio_correos'::text, 'ver_notificaciones'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'importar_datos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'proveedores' AND policyname = 'write_proveedores') THEN
    ALTER POLICY "write_proveedores" ON "public"."proveedores"
      USING ((false OR ( SELECT auth_permiso_any('{editar_proveedores}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_proveedores}'::text[]))));
  END IF;
END $mig$;

-- public.prueba_intentos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'prueba_intentos' AND policyname = 'prueba_intentos_read') THEN
    ALTER POLICY "prueba_intentos_read" ON "public"."prueba_intentos"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])) OR (EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.id = prueba_intentos.candidato_id) AND (c.auth_uid = ( SELECT auth.uid() AS uid)))))));
  END IF;
END $mig$;

-- public.prueba_preguntas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'prueba_preguntas' AND policyname = 'prueba_preguntas_staff') THEN
    ALTER POLICY "prueba_preguntas_staff" ON "public"."prueba_preguntas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.pruebas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pruebas' AND policyname = 'pruebas_write') THEN
    ALTER POLICY "pruebas_write" ON "public"."pruebas"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.recompensas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recompensas' AND policyname = 'recompensas_write') THEN
    ALTER POLICY "recompensas_write" ON "public"."recompensas"
      USING (( SELECT auth_permiso('gestionar_recompensas'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_recompensas'::text)));
  END IF;
END $mig$;

-- public.redenciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'redenciones' AND policyname = 'redenciones_staff') THEN
    ALTER POLICY "redenciones_staff" ON "public"."redenciones"
      USING (( SELECT auth_permiso('gestionar_puntos_hogar'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_puntos_hogar'::text)));
  END IF;
END $mig$;

-- public.reembasado_ejecuciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reembasado_ejecuciones' AND policyname = 'reembasado_ejec_read') THEN
    ALTER POLICY "reembasado_ejec_read" ON "public"."reembasado_ejecuciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_reembasado'::text, 'gestionar_reembasado'::text, 'ver_stock'::text, 'ver_movimientos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reembasado_ejecuciones' AND policyname = 'reembasado_ejec_write') THEN
    ALTER POLICY "reembasado_ejec_write" ON "public"."reembasado_ejecuciones"
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_reembasado}'::text[]))));
  END IF;
END $mig$;

-- public.reembasado_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reembasado_items' AND policyname = 'reembasado_items_read') THEN
    ALTER POLICY "reembasado_items_read" ON "public"."reembasado_items"
      USING (( SELECT auth_permiso_any(ARRAY['ver_reembasado'::text, 'gestionar_reembasado'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_stock'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reembasado_items' AND policyname = 'reembasado_items_write') THEN
    ALTER POLICY "reembasado_items_write" ON "public"."reembasado_items"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_reembasado}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_reembasado}'::text[]))));
  END IF;
END $mig$;

-- public.reembasados
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reembasados' AND policyname = 'reembasados_read') THEN
    ALTER POLICY "reembasados_read" ON "public"."reembasados"
      USING (( SELECT auth_permiso_any(ARRAY['ver_reembasado'::text, 'gestionar_reembasado'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_stock'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reembasados' AND policyname = 'reembasados_write') THEN
    ALTER POLICY "reembasados_write" ON "public"."reembasados"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_reembasado}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_reembasado}'::text[]))));
  END IF;
END $mig$;

-- public.registros_faciales
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'registros_faciales' AND policyname = 'faciales_staff') THEN
    ALTER POLICY "faciales_staff" ON "public"."registros_faciales"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.reglas_alerta
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reglas_alerta' AND policyname = 'admin_write_reglas') THEN
    ALTER POLICY "admin_write_reglas" ON "public"."reglas_alerta"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_alertas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_alertas}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reglas_alerta' AND policyname = 'auth_read_reglas') THEN
    ALTER POLICY "auth_read_reglas" ON "public"."reglas_alerta"
      USING (( SELECT auth_permiso_any(ARRAY['ver_notificaciones'::text, 'gestionar_alertas'::text, 'ver_configuracion'::text, 'editar_configuracion'::text, 'ver_flujos_notificacion'::text, 'gestionar_flujos_notificacion'::text])));
  END IF;
END $mig$;

-- public.reportes_servicio
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reportes_servicio' AND policyname = 'rep_staff') THEN
    ALTER POLICY "rep_staff" ON "public"."reportes_servicio"
      USING (( SELECT auth_permiso('gestionar_solicitudes_hogar'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_solicitudes_hogar'::text)));
  END IF;
END $mig$;

-- public.requisiciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'requisiciones' AND policyname = 'requisiciones_read') THEN
    ALTER POLICY "requisiciones_read" ON "public"."requisiciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_requisiciones'::text, 'gestionar_requisiciones'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'requisiciones' AND policyname = 'requisiciones_write') THEN
    ALTER POLICY "requisiciones_write" ON "public"."requisiciones"
      USING (( SELECT auth_permiso('gestionar_requisiciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_requisiciones'::text)));
  END IF;
END $mig$;

-- public.resenas_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resenas_servicio_hogar' AND policyname = 'resenas_staff_all') THEN
    ALTER POLICY "resenas_staff_all" ON "public"."resenas_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.respuestas_encuesta
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'respuestas_encuesta' AND policyname = 'resp_staff') THEN
    ALTER POLICY "resp_staff" ON "public"."respuestas_encuesta"
      USING (( SELECT auth_permiso('gestionar_solicitudes_hogar'::text)));
  END IF;
END $mig$;

-- public.roles
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roles' AND policyname = 'roles_read') THEN
    ALTER POLICY "roles_read" ON "public"."roles"
      USING ((( SELECT auth_permiso_any(ARRAY['gestionar_roles'::text, 'ver_usuarios'::text, 'gestionar_usuarios'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'importar_personas'::text, 'ver_planta_personal'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'importar_datos'::text])) OR (id = ( SELECT u.rol_id
     FROM usuarios u
    WHERE (u.id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'roles' AND policyname = 'roles_write') THEN
    ALTER POLICY "roles_write" ON "public"."roles"
      USING (( SELECT auth_permiso('gestionar_roles'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_roles'::text)));
  END IF;
END $mig$;

-- public.rotacion
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rotacion' AND policyname = 'auth_read_rotacion') THEN
    ALTER POLICY "auth_read_rotacion" ON "public"."rotacion"
      USING (( SELECT auth_permiso_any(ARRAY['ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text, 'ver_productos'::text, 'editar_productos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rotacion' AND policyname = 'write_rotacion') THEN
    ALTER POLICY "write_rotacion" ON "public"."rotacion"
      USING ((false OR ( SELECT auth_permiso_any('{editar_aprovisionamiento}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_aprovisionamiento}'::text[]))));
  END IF;
END $mig$;

-- public.ruta_paradas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ruta_paradas' AND policyname = 'paradas_read') THEN
    ALTER POLICY "paradas_read" ON "public"."ruta_paradas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_logistica'::text, 'gestionar_rutas'::text, 'ver_monitoreo_entregas'::text, 'ver_ubicacion_conductores'::text, 'gestionar_conductores'::text, 'ver_novedades_entrega'::text, 'gestionar_novedades_entrega'::text, 'ver_rutas_conductor'::text, 'confirmar_entrega_conductor'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_contratos'::text, 'editar_contratos'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ruta_paradas' AND policyname = 'paradas_write') THEN
    ALTER POLICY "paradas_write" ON "public"."ruta_paradas"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_rutas,confirmar_entrega_conductor}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_rutas,confirmar_entrega_conductor}'::text[]))));
  END IF;
END $mig$;

-- public.rutas_entrega
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rutas_entrega' AND policyname = 'rutas_read') THEN
    ALTER POLICY "rutas_read" ON "public"."rutas_entrega"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_logistica'::text, 'gestionar_rutas'::text, 'ver_monitoreo_entregas'::text, 'ver_ubicacion_conductores'::text, 'gestionar_conductores'::text, 'ver_novedades_entrega'::text, 'gestionar_novedades_entrega'::text, 'ver_rutas_conductor'::text, 'confirmar_entrega_conductor'::text, 'ver_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_reportes'::text, 'exportar_datos'::text])) OR (conductor_id IN ( SELECT conductores.id
     FROM conductores
    WHERE (conductores.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rutas_entrega' AND policyname = 'rutas_write') THEN
    ALTER POLICY "rutas_write" ON "public"."rutas_entrega"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_rutas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_rutas}'::text[]))));
  END IF;
END $mig$;

-- public.sede_etiquetas
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sede_etiquetas' AND policyname = 'sede_etiquetas_read') THEN
    ALTER POLICY "sede_etiquetas_read" ON "public"."sede_etiquetas"
      USING (( SELECT auth_permiso_any(ARRAY['ver_contratos'::text, 'editar_contratos'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_parametrizacion'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sede_etiquetas' AND policyname = 'sede_etiquetas_write') THEN
    ALTER POLICY "sede_etiquetas_write" ON "public"."sede_etiquetas"
      USING ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))));
  END IF;
END $mig$;

-- public.sede_horario_entrega
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sede_horario_entrega' AND policyname = 'horarios_read') THEN
    ALTER POLICY "horarios_read" ON "public"."sede_horario_entrega"
      USING (( SELECT auth_permiso_any(ARRAY['ver_logistica'::text, 'gestionar_horarios_entrega'::text, 'gestionar_rutas'::text, 'ver_monitoreo_entregas'::text, 'ver_ubicacion_conductores'::text, 'gestionar_conductores'::text, 'ver_rutas_conductor'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_contratos'::text, 'editar_contratos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sede_horario_entrega' AND policyname = 'horarios_write') THEN
    ALTER POLICY "horarios_write" ON "public"."sede_horario_entrega"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_horarios_entrega}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_horarios_entrega}'::text[]))));
  END IF;
END $mig$;

-- public.sede_productos
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sede_productos' AND policyname = 'sp_read') THEN
    ALTER POLICY "sp_read" ON "public"."sede_productos"
      USING (( SELECT auth_permiso_any(ARRAY['ver_parametrizacion'::text, 'gestionar_parametrizacion'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text, 'ver_productos'::text, 'ver_stock'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sede_productos' AND policyname = 'sp_write') THEN
    ALTER POLICY "sp_write" ON "public"."sede_productos"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_parametrizacion}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_parametrizacion}'::text[]))));
  END IF;
END $mig$;

-- public.sedes
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sedes' AND policyname = 'auth_read_sedes') THEN
    ALTER POLICY "auth_read_sedes" ON "public"."sedes"
      USING ((( SELECT auth_permiso_any(ARRAY['ver_contratos'::text, 'editar_contratos'::text, 'ver_parametrizacion'::text, 'gestionar_parametrizacion'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'importar_personas'::text, 'ver_planta_personal'::text, 'gestionar_planta_personal'::text, 'ver_documentos_rrhh'::text, 'gestionar_documentos_rrhh'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'ver_requisiciones'::text, 'gestionar_requisiciones'::text, 'ver_usuarios'::text, 'gestionar_usuarios'::text, 'ver_productos'::text, 'ver_stock'::text, 'ver_bodegas'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_arqueo'::text, 'ver_inventario_fisico'::text, 'ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_logistica'::text, 'gestionar_rutas'::text, 'ver_monitoreo_entregas'::text, 'gestionar_horarios_entrega'::text, 'ver_ubicacion_conductores'::text, 'ver_rutas_conductor'::text, 'ver_novedades_entrega'::text, 'gestionar_conductores'::text, 'ver_maquinaria'::text, 'gestionar_maquinaria'::text, 'ver_mantenimiento'::text, 'atender_mantenimiento'::text, 'gestionar_mantenimiento'::text, 'reportar_falla_maquinaria'::text, 'ver_servicios_hogar'::text, 'gestionar_solicitudes_hogar'::text, 'gestionar_agenda_hogar'::text, 'ver_directorio_correos'::text, 'gestionar_directorio_correos'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])) OR (id = ( SELECT u.sede_id
     FROM usuarios u
    WHERE (u.id = ( SELECT auth.uid() AS uid)))) OR (id IN ( SELECT p.sede_id
     FROM personas p
    WHERE (p.usuario_id = ( SELECT auth.uid() AS uid))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sedes' AND policyname = 'write_sedes') THEN
    ALTER POLICY "write_sedes" ON "public"."sedes"
      USING ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{editar_contratos}'::text[]))));
  END IF;
END $mig$;

-- public.solicitud_compra_items
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'solicitud_compra_items' AND policyname = 'sc_items_read') THEN
    ALTER POLICY "sc_items_read" ON "public"."solicitud_compra_items"
      USING (( SELECT auth_permiso_any('{solicitar_compras,ver_ordenes_compra,crear_ordenes_compra}'::text[])));
  END IF;
END $mig$;

-- public.solicitudes_compra
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'solicitudes_compra' AND policyname = 'sc_read') THEN
    ALTER POLICY "sc_read" ON "public"."solicitudes_compra"
      USING (( SELECT auth_permiso_any('{solicitar_compras,ver_ordenes_compra,crear_ordenes_compra}'::text[])));
  END IF;
END $mig$;

-- public.solicitudes_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'solicitudes_servicio_hogar' AND policyname = 'ssh_auth_read') THEN
    ALTER POLICY "ssh_auth_read" ON "public"."solicitudes_servicio_hogar"
      USING (((cliente_id = ( SELECT auth.uid() AS uid)) OR false OR ( SELECT auth_permiso_any('{ver_servicios_hogar}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'solicitudes_servicio_hogar' AND policyname = 'ssh_auth_write') THEN
    ALTER POLICY "ssh_auth_write" ON "public"."solicitudes_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar}'::text[]))));
  END IF;
END $mig$;

-- public.stock
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stock' AND policyname = 'auth_read_stock') THEN
    ALTER POLICY "auth_read_stock" ON "public"."stock"
      USING (( SELECT auth_permiso_any(ARRAY['ver_stock'::text, 'ajustar_stock'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'ver_arqueo'::text, 'realizar_arqueo'::text, 'ver_inventario_fisico'::text, 'cargar_inventario_fisico'::text, 'ver_reembasado'::text, 'gestionar_reembasado'::text, 'ver_bodegas'::text, 'gestionar_bodegas'::text, 'ver_aprovisionamiento'::text, 'editar_aprovisionamiento'::text, 'ver_parametrizacion'::text, 'gestionar_parametrizacion'::text, 'ver_ordenes_insumo'::text, 'crear_ordenes_insumo'::text, 'aprobar_ordenes_insumo'::text, 'alistar_ordenes_insumo'::text, 'recibir_ordenes_insumo'::text, 'ver_alistamiento'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stock' AND policyname = 'write_stock') THEN
    ALTER POLICY "write_stock" ON "public"."stock"
      USING ((false OR ( SELECT auth_permiso_any('{ajustar_stock}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{ajustar_stock}'::text[]))));
  END IF;
END $mig$;

-- public.stock_cce
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stock_cce' AND policyname = 'stock_cce_read') THEN
    ALTER POLICY "stock_cce_read" ON "public"."stock_cce"
      USING (( SELECT auth_permiso_any(ARRAY['ver_stock'::text, 'ajustar_stock'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_reportes'::text, 'importar_datos'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stock_cce' AND policyname = 'stock_cce_write') THEN
    ALTER POLICY "stock_cce_write" ON "public"."stock_cce"
      USING (( SELECT auth_permiso_any(ARRAY['ajustar_stock'::text, 'editar_productos'::text])))
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['ajustar_stock'::text, 'editar_productos'::text])));
  END IF;
END $mig$;

-- public.tarifas_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tarifas_servicio_hogar' AND policyname = 'tarifas_sh_write') THEN
    ALTER POLICY "tarifas_sh_write" ON "public"."tarifas_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_precios_servicio}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_precios_servicio}'::text[]))));
  END IF;
END $mig$;

-- public.tipos_documentales
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tipos_documentales' AND policyname = 'gh_read_tipos') THEN
    ALTER POLICY "gh_read_tipos" ON "public"."tipos_documentales"
      USING (( SELECT auth_permiso_any(ARRAY['ver_documentos_rrhh'::text, 'gestionar_documentos_rrhh'::text, 'gestionar_tipos_documentales'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'ver_planta_personal'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'ver_plantillas_documento'::text, 'gestionar_plantillas_documento'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tipos_documentales' AND policyname = 'gh_write_tipos') THEN
    ALTER POLICY "gh_write_tipos" ON "public"."tipos_documentales"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_tipos_documentales}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_tipos_documentales}'::text[]))));
  END IF;
END $mig$;

-- public.tipos_documentales_refs
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tipos_documentales_refs' AND policyname = 'gh_read_tiporefs') THEN
    ALTER POLICY "gh_read_tiporefs" ON "public"."tipos_documentales_refs"
      USING (( SELECT auth_permiso_any(ARRAY['ver_documentos_rrhh'::text, 'gestionar_documentos_rrhh'::text, 'gestionar_tipos_documentales'::text, 'ver_personas'::text, 'gestionar_personas'::text, 'ver_planta_personal'::text, 'ver_postulaciones'::text, 'gestionar_postulaciones'::text, 'ver_plantillas_documento'::text, 'gestionar_plantillas_documento'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tipos_documentales_refs' AND policyname = 'gh_write_tiporefs') THEN
    ALTER POLICY "gh_write_tiporefs" ON "public"."tipos_documentales_refs"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_tipos_documentales}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_tipos_documentales}'::text[]))));
  END IF;
END $mig$;

-- public.tipos_servicio_hogar
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tipos_servicio_hogar' AND policyname = 'tipos_sh_write') THEN
    ALTER POLICY "tipos_sh_write" ON "public"."tipos_servicio_hogar"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_tipos_servicio}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_tipos_servicio}'::text[]))));
  END IF;
END $mig$;

-- public.transacciones_pasarela
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transacciones_pasarela' AND policyname = 'tx_staff_read') THEN
    ALTER POLICY "tx_staff_read" ON "public"."transacciones_pasarela"
      USING ((( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario])));
  END IF;
END $mig$;

-- public.ubicaciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ubicaciones' AND policyname = 'auth_read_ubicaciones') THEN
    ALTER POLICY "auth_read_ubicaciones" ON "public"."ubicaciones"
      USING (( SELECT auth_permiso_any(ARRAY['ver_bodegas'::text, 'gestionar_bodegas'::text, 'ver_productos'::text, 'editar_productos'::text, 'ver_stock'::text, 'ajustar_stock'::text, 'ver_movimientos'::text, 'crear_movimientos'::text, 'eliminar_movimientos'::text, 'ver_arqueo'::text, 'ver_inventario_fisico'::text, 'ver_alistamiento'::text, 'alistar_ordenes_insumo'::text, 'ver_reportes'::text, 'exportar_datos'::text])));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ubicaciones' AND policyname = 'write_ubicaciones') THEN
    ALTER POLICY "write_ubicaciones" ON "public"."ubicaciones"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_bodegas}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_bodegas}'::text[]))));
  END IF;
END $mig$;

-- public.usuarios
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios' AND policyname = 'admin_write_usuarios') THEN
    ALTER POLICY "admin_write_usuarios" ON "public"."usuarios"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_usuarios}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_usuarios}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios' AND policyname = 'self_read_usuarios') THEN
    ALTER POLICY "self_read_usuarios" ON "public"."usuarios"
      USING (((id = ( SELECT auth.uid() AS uid)) OR false OR ( SELECT auth_permiso_any('{ver_usuarios}'::text[]))));
  END IF;
END $mig$;

-- public.vac_auditoria
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vac_auditoria' AND policyname = 'auditoria_staff') THEN
    ALTER POLICY "auditoria_staff" ON "public"."vac_auditoria"
      USING ((false OR ( SELECT auth_permiso_any('{ver_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.vac_empresa
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vac_empresa' AND policyname = 'vac_empresa_write') THEN
    ALTER POLICY "vac_empresa_write" ON "public"."vac_empresa"
      USING (( SELECT auth_permiso_any(ARRAY['gestionar_directorio_correos'::text, 'gestionar_postulaciones'::text])))
      WITH CHECK (( SELECT auth_permiso_any(ARRAY['gestionar_directorio_correos'::text, 'gestionar_postulaciones'::text])));
  END IF;
END $mig$;

-- public.vac_listas_opciones
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vac_listas_opciones' AND policyname = 'vac_listas_opciones_write') THEN
    ALTER POLICY "vac_listas_opciones_write" ON "public"."vac_listas_opciones"
      USING (( SELECT auth_permiso('gestionar_postulaciones'::text)))
      WITH CHECK (( SELECT auth_permiso('gestionar_postulaciones'::text)));
  END IF;
END $mig$;

-- public.vac_tipos_documentales
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vac_tipos_documentales' AND policyname = 'vac_tipos_documentales_write') THEN
    ALTER POLICY "vac_tipos_documentales_write" ON "public"."vac_tipos_documentales"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- public.vacantes
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vacantes' AND policyname = 'vacantes_write') THEN
    ALTER POLICY "vacantes_write" ON "public"."vacantes"
      USING ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))))
      WITH CHECK ((false OR ( SELECT auth_permiso_any('{gestionar_postulaciones}'::text[]))));
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Esquema storage (41 policies)
-- ─────────────────────────────────────────────────────────────────────────────

-- storage.objects
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'cp_staff_delete') THEN
    ALTER POLICY "cp_staff_delete" ON "storage"."objects"
      USING (((bucket_id = 'comprobantes-pago'::text) AND ( SELECT auth_permiso('gestionar_pagos_hogar'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'cp_staff_read') THEN
    ALTER POLICY "cp_staff_read" ON "storage"."objects"
      USING (((bucket_id = 'comprobantes-pago'::text) AND (( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documentos_sst_delete_perm') THEN
    ALTER POLICY "documentos_sst_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'documentos-sst'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documentos_sst_insert_perm') THEN
    ALTER POLICY "documentos_sst_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'documentos-sst'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documentos_sst_update_perm') THEN
    ALTER POLICY "documentos_sst_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'documentos-sst'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))))
      WITH CHECK (((bucket_id = 'documentos-sst'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'empresas_delete_perm') THEN
    ALTER POLICY "empresas_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'empresas'::text) AND ( SELECT auth_permiso_any('{gestionar_empresas_usuarias,editar_configuracion}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'empresas_insert_perm') THEN
    ALTER POLICY "empresas_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'empresas'::text) AND ( SELECT auth_permiso_any('{gestionar_empresas_usuarias,editar_configuracion}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'empresas_update_perm') THEN
    ALTER POLICY "empresas_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'empresas'::text) AND ( SELECT auth_permiso_any('{gestionar_empresas_usuarias,editar_configuracion}'::text[]))))
      WITH CHECK (((bucket_id = 'empresas'::text) AND ( SELECT auth_permiso_any('{gestionar_empresas_usuarias,editar_configuracion}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'galeria_fotos_delete_perm') THEN
    ALTER POLICY "galeria_fotos_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'galeria-fotos'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'galeria_fotos_insert_perm') THEN
    ALTER POLICY "galeria_fotos_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'galeria-fotos'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'galeria_fotos_update_perm') THEN
    ALTER POLICY "galeria_fotos_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'galeria-fotos'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))))
      WITH CHECK (((bucket_id = 'galeria-fotos'::text) AND ( SELECT auth_permiso_any('{subir_documentos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gestion_humana_delete_perm') THEN
    ALTER POLICY "gestion_humana_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'gestion-humana'::text) AND ( SELECT auth_permiso_any('{gestionar_documentos_rrhh,gestionar_personas}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gestion_humana_insert_perm') THEN
    ALTER POLICY "gestion_humana_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'gestion-humana'::text) AND ( SELECT auth_permiso_any('{gestionar_documentos_rrhh,gestionar_personas}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gestion_humana_update_perm') THEN
    ALTER POLICY "gestion_humana_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'gestion-humana'::text) AND ( SELECT auth_permiso_any('{gestionar_documentos_rrhh,gestionar_personas}'::text[]))))
      WITH CHECK (((bucket_id = 'gestion-humana'::text) AND ( SELECT auth_permiso_any('{gestionar_documentos_rrhh,gestionar_personas}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'logistica_evidencia_delete_perm') THEN
    ALTER POLICY "logistica_evidencia_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'logistica-evidencia'::text) AND ( SELECT auth_permiso_any('{gestionar_rutas,gestionar_novedades_entrega,confirmar_entrega_conductor,reportar_novedad_conductor}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'logistica_evidencia_insert_perm') THEN
    ALTER POLICY "logistica_evidencia_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'logistica-evidencia'::text) AND ( SELECT auth_permiso_any('{gestionar_rutas,gestionar_novedades_entrega,confirmar_entrega_conductor,reportar_novedad_conductor}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'logistica_evidencia_update_perm') THEN
    ALTER POLICY "logistica_evidencia_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'logistica-evidencia'::text) AND ( SELECT auth_permiso_any('{gestionar_rutas,gestionar_novedades_entrega,confirmar_entrega_conductor,reportar_novedad_conductor}'::text[]))))
      WITH CHECK (((bucket_id = 'logistica-evidencia'::text) AND ( SELECT auth_permiso_any('{gestionar_rutas,gestionar_novedades_entrega,confirmar_entrega_conductor,reportar_novedad_conductor}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mantenimiento_delete_perm') THEN
    ALTER POLICY "mantenimiento_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'mantenimiento'::text) AND ( SELECT auth_permiso('gestionar_mantenimiento'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mantenimiento_insert_perm') THEN
    ALTER POLICY "mantenimiento_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'mantenimiento'::text) AND ( SELECT auth_permiso_any('{reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'mantenimiento_update_perm') THEN
    ALTER POLICY "mantenimiento_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'mantenimiento'::text) AND ( SELECT auth_permiso('gestionar_mantenimiento'::text))))
      WITH CHECK (((bucket_id = 'mantenimiento'::text) AND ( SELECT auth_permiso('gestionar_mantenimiento'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'maquinaria_delete_perm') THEN
    ALTER POLICY "maquinaria_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'maquinaria'::text) AND ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'maquinaria_insert_perm') THEN
    ALTER POLICY "maquinaria_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'maquinaria'::text) AND ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'maquinaria_update_perm') THEN
    ALTER POLICY "maquinaria_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'maquinaria'::text) AND ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))))
      WITH CHECK (((bucket_id = 'maquinaria'::text) AND ( SELECT auth_permiso_any('{gestionar_maquinaria}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ordenes_insumo_delete_perm') THEN
    ALTER POLICY "ordenes_insumo_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'ordenes-insumo'::text) AND ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ordenes_insumo_insert_perm') THEN
    ALTER POLICY "ordenes_insumo_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'ordenes-insumo'::text) AND ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ordenes_insumo_update_perm') THEN
    ALTER POLICY "ordenes_insumo_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'ordenes-insumo'::text) AND ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))))
      WITH CHECK (((bucket_id = 'ordenes-insumo'::text) AND ( SELECT auth_permiso_any('{crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'plantillas_documentos_delete_perm') THEN
    ALTER POLICY "plantillas_documentos_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'plantillas-documentos'::text) AND ( SELECT auth_permiso('gestionar_plantillas_documento'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'plantillas_documentos_insert_perm') THEN
    ALTER POLICY "plantillas_documentos_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'plantillas-documentos'::text) AND ( SELECT auth_permiso('gestionar_plantillas_documento'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'plantillas_documentos_select') THEN
    ALTER POLICY "plantillas_documentos_select" ON "storage"."objects"
      USING (((bucket_id = 'plantillas-documentos'::text) AND ( SELECT auth_permiso_any(ARRAY['ver_plantillas_documento'::text, 'gestionar_plantillas_documento'::text, 'gestionar_postulaciones'::text]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'plantillas_documentos_update_perm') THEN
    ALTER POLICY "plantillas_documentos_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'plantillas-documentos'::text) AND ( SELECT auth_permiso('gestionar_plantillas_documento'::text))))
      WITH CHECK (((bucket_id = 'plantillas-documentos'::text) AND ( SELECT auth_permiso('gestionar_plantillas_documento'::text))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'productos_fotos_delete_perm') THEN
    ALTER POLICY "productos_fotos_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'productos-fotos'::text) AND ( SELECT auth_permiso_any('{editar_productos,importar_datos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'productos_fotos_insert_perm') THEN
    ALTER POLICY "productos_fotos_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'productos-fotos'::text) AND ( SELECT auth_permiso_any('{editar_productos,importar_datos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'productos_fotos_update_perm') THEN
    ALTER POLICY "productos_fotos_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'productos-fotos'::text) AND ( SELECT auth_permiso_any('{editar_productos,importar_datos}'::text[]))))
      WITH CHECK (((bucket_id = 'productos-fotos'::text) AND ( SELECT auth_permiso_any('{editar_productos,importar_datos}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rut_staff_read') THEN
    ALTER POLICY "rut_staff_read" ON "storage"."objects"
      USING (((bucket_id = 'rut-clientes'::text) AND (( SELECT auth_rol()) = ANY (ARRAY['SUPER_ADMIN'::rol_usuario, 'ADMIN'::rol_usuario, 'SUPERVISOR'::rol_usuario, 'COORDINADOR_COMPRAS'::rol_usuario]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rv_delete') THEN
    ALTER POLICY "rv_delete" ON "storage"."objects"
      USING (((bucket_id = 'registro-vacantes'::text) AND ((owner = ( SELECT auth.uid() AS uid)) OR ( SELECT auth_permiso('gestionar_postulaciones'::text)))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rv_select') THEN
    ALTER POLICY "rv_select" ON "storage"."objects"
      USING (((bucket_id = 'registro-vacantes'::text) AND ((owner = ( SELECT auth.uid() AS uid)) OR ( SELECT auth_permiso_any(ARRAY['ver_postulaciones'::text, 'gestionar_postulaciones'::text])) OR (EXISTS ( SELECT 1
     FROM candidatos c
    WHERE ((c.auth_uid = ( SELECT auth.uid() AS uid)) AND (c.foto_perfil_path = objects.name)))))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rv_update') THEN
    ALTER POLICY "rv_update" ON "storage"."objects"
      USING (((bucket_id = 'registro-vacantes'::text) AND ((owner = ( SELECT auth.uid() AS uid)) OR ( SELECT auth_permiso('gestionar_postulaciones'::text)))))
      WITH CHECK ((bucket_id = 'registro-vacantes'::text));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'servicios_hogar_delete_perm') THEN
    ALTER POLICY "servicios_hogar_delete_perm" ON "storage"."objects"
      USING (((bucket_id = 'servicios-hogar'::text) AND ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar,gestionar_tipos_servicio,gestionar_agenda_hogar}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'servicios_hogar_insert_perm') THEN
    ALTER POLICY "servicios_hogar_insert_perm" ON "storage"."objects"
      WITH CHECK (((bucket_id = 'servicios-hogar'::text) AND ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar,gestionar_tipos_servicio,gestionar_agenda_hogar}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'servicios_hogar_update_perm') THEN
    ALTER POLICY "servicios_hogar_update_perm" ON "storage"."objects"
      USING (((bucket_id = 'servicios-hogar'::text) AND ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar,gestionar_tipos_servicio,gestionar_agenda_hogar}'::text[]))))
      WITH CHECK (((bucket_id = 'servicios-hogar'::text) AND ( SELECT auth_permiso_any('{gestionar_solicitudes_hogar,gestionar_tipos_servicio,gestionar_agenda_hogar}'::text[]))));
  END IF;
END $mig$;
DO $mig$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'soporte_delete') THEN
    ALTER POLICY "soporte_delete" ON "storage"."objects"
      USING (((bucket_id = 'soporte'::text) AND ( SELECT auth_permiso('gestionar_soporte'::text))));
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación: que no quede NINGUNA llamada suelta.
--
-- No basta con mirar si la expresión contiene "SELECT auth_permiso": una policy
-- puede tener una llamada envuelta y otra suelta y pasaría la prueba. Así que se
-- cuentan las llamadas y las llamadas envueltas, y tienen que ser las mismas.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  sueltas bigint;
BEGIN
  SELECT coalesce(sum(todas - envueltas), 0) INTO sueltas
  FROM (
    SELECT
      (SELECT count(*) FROM regexp_matches(e, '(^|[^A-Za-z0-9_.])(auth_permiso_any|auth_permiso|auth_rol|auth[.]uid)[(]', 'g')) AS todas,
      (SELECT count(*) FROM regexp_matches(e, 'SELECT (auth_permiso_any|auth_permiso|auth_rol|auth[.]uid)[(]', 'g')) AS envueltas
    FROM (
      SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS e
      FROM pg_policies
      WHERE schemaname IN ('public', 'storage')
    ) p
  ) n;

  IF sueltas > 0 THEN
    RAISE EXCEPTION 'Quedaron % llamadas sueltas: se evaluarían fila por fila', sueltas;
  END IF;
  RAISE NOTICE 'RLS envuelta: ninguna policy evalúa los permisos fila por fila';
END $mig$;
