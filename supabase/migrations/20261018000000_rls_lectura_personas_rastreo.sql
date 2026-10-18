-- Cierra las lecturas abiertas (USING (true)) del grupo "personas y rastreo".
--
-- Contexto: la base nació cuando "authenticated" eran 27 personas de confianza.
-- Hoy hay ~890 cuentas, 853 de ellas con el rol Empleado (cero permisos), así
-- que una política de lectura abierta expone el rastreo GPS de los conductores,
-- las firmas y cédulas de quien recibe en sede, y el historial de cambios de
-- CUALQUIER tabla (incluidos salarios y precios) a casi toda la empresa.
--
-- Las claves exigidas ya existen en apps/inventario/lib/permisos.ts y están
-- sembradas en los roles (/roles es la única fuente de verdad).
--
-- Cada tabla exige los permisos de las pantallas que hoy la leen; el conductor
-- conserva lo suyo por la cláusula de "lo propio" para que /logistica/mis-rutas
-- siga funcionando con sus 7 permisos.
-- Idempotente: se puede volver a aplicar sin daño.

-- ── Conductores ─────────────────────────────────────────────────────────────
-- Nombre, teléfono, placa y categoría de licencia de una persona.
drop policy if exists cond_read on conductores;
create policy cond_read on conductores
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_logistica', 'gestionar_conductores', 'ver_monitoreo_entregas',
      'gestionar_rutas', 'ver_novedades_entrega', 'gestionar_novedades_entrega',
      'ver_ubicacion_conductores'
    ])
    -- el propio conductor (su ficha la muestra /logistica/mis-rutas)
    or usuario_id = (select auth.uid())
  );

-- ── Rastreo GPS ─────────────────────────────────────────────────────────────
-- Posición de una persona en el tiempo: el dato más sensible del módulo.
drop policy if exists gps_act_read on conductor_ubicacion_actual;
create policy gps_act_read on conductor_ubicacion_actual
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_ubicacion_conductores', 'ver_monitoreo_entregas', 'gestionar_rutas',
      'gestionar_conductores'
    ])
    or conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
  );

-- `gps_act_write` es ALL con USING (true OR ...), es decir USING true: dejaba la
-- lectura (y el UPDATE/DELETE de la fila) abierta a cualquier cuenta por detrás
-- de la política de SELECT. El WITH CHECK ya estaba bien y se mantiene.
drop policy if exists gps_act_write on conductor_ubicacion_actual;
create policy gps_act_write on conductor_ubicacion_actual
  for all to authenticated
  using (
    auth_permiso_any(array['gestionar_rutas', 'gestionar_conductores'])
    or conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
  )
  with check (
    conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
    or auth_permiso_any(array['actualizar_gps_conductor', 'gestionar_rutas', 'gestionar_conductores'])
  );

drop policy if exists gps_hist_read on conductor_ubicacion_historial;
create policy gps_hist_read on conductor_ubicacion_historial
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_ubicacion_conductores', 'ver_monitoreo_entregas', 'gestionar_rutas',
      'gestionar_conductores'
    ])
    or conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
  );

-- ── Confirmaciones de entrega ───────────────────────────────────────────────
-- Nombre, cédula y firma de quien recibe en la sede, más foto y coordenadas.
drop policy if exists conf_read on confirmaciones_entrega;
create policy conf_read on confirmaciones_entrega
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_logistica', 'ver_monitoreo_entregas', 'gestionar_rutas',
      'gestionar_conductores', 'recibir_ordenes_insumo', 'ver_ordenes_insumo',
      'ver_alistamiento', 'alistar_ordenes_insumo'
    ])
    or conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
  );

-- ── Historial de cambios ────────────────────────────────────────────────────
-- 13.458 filas con datos_anteriores/datos_nuevos de cualquier tabla: es la
-- puerta de atrás a todo lo que las demás políticas protegen.
drop policy if exists auth_read_historial on historial_cambios;
create policy auth_read_historial on historial_cambios
  for select to authenticated
  using (auth_permiso_any(array['ver_historial', 'ver_actividad_log']));

-- ── Importaciones ───────────────────────────────────────────────────────────
-- Qué archivo cargó quién, con el detalle de errores.
drop policy if exists auth_read_importaciones on importaciones;
create policy auth_read_importaciones on importaciones
  for select to authenticated
  using (
    auth_permiso_any(array[
      'importar_datos', 'importar_personas', 'ver_historial', 'ver_actividad_log'
    ])
    or usuario_id = (select auth.uid())
  );
