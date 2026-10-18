-- Cierra las lecturas abiertas (USING (true)) del grupo "operación interna":
-- inventario, órdenes de insumo, bodegas, maquinaria, logística, sedes y los
-- catálogos de administración.
--
-- Cada tabla exige la lista de permisos de /roles de las pantallas que HOY la
-- leen. Las listas son largas a propósito: una tabla de dimensión como
-- `productos` o `sedes` se consulta desde casi todos los módulos, y los
-- embebidos de PostgREST (`sedes ( nombre )`) también pasan por RLS, así que
-- recortar la lista rompería pantallas de roles legítimos (p. ej. el Técnico de
-- Mantenimiento, que tiene 5 permisos y necesita `sedes` en /equipo, o el
-- Conductor, que necesita `productos` en /logistica/mis-rutas).
--
-- Tres tablas llevan además cláusula de "lo propio" porque /carnet y /perfil no
-- exigen permiso (son personales) y leen la sede, el grupo y el rol del propio
-- usuario. En `roles` esa cláusula es imprescindible: lib/permisos-server.ts
-- resuelve los permisos con el cliente del usuario
-- (`usuarios.select('rol, permisos, roles(permisos)')`) y si el embebido queda
-- filtrado por RLS, todo usuario no-admin se queda sin permisos en la UI.
--
-- Idempotente: se puede volver a aplicar sin daño.

-- ── Catálogo de productos ───────────────────────────────────────────────────
drop policy if exists auth_read_productos on productos;
create policy auth_read_productos on productos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_productos', 'editar_productos', 'generar_codigos',
    'ver_stock', 'ajustar_stock',
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_arqueo', 'realizar_arqueo',
    'ver_inventario_fisico', 'cargar_inventario_fisico',
    'ver_bodegas', 'gestionar_bodegas',
    'ver_reembasado', 'gestionar_reembasado',
    'ver_aprovisionamiento', 'editar_aprovisionamiento',
    'ver_parametrizacion', 'gestionar_parametrizacion',
    'ver_proveedores', 'editar_proveedores',
    'ver_ordenes_compra', 'crear_ordenes_compra',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_logistica', 'ver_monitoreo_entregas', 'gestionar_rutas', 'ver_rutas_conductor',
    'ver_reportes', 'importar_datos', 'exportar_datos'
  ]));

drop policy if exists fotos_select on producto_fotos;
create policy fotos_select on producto_fotos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_productos', 'editar_productos', 'generar_codigos',
    'ver_stock', 'ajustar_stock',
    'ver_movimientos', 'crear_movimientos',
    'ver_inventario_fisico', 'ver_arqueo',
    'ver_bodegas', 'ver_reembasado',
    'ver_parametrizacion', 'ver_proveedores',
    'ver_ordenes_compra', 'crear_ordenes_compra',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_reportes', 'importar_datos', 'exportar_datos'
  ]));

-- ── Stock ───────────────────────────────────────────────────────────────────
drop policy if exists auth_read_stock on stock;
create policy auth_read_stock on stock
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_stock', 'ajustar_stock',
    'ver_productos', 'editar_productos',
    'ver_movimientos', 'crear_movimientos',
    'ver_arqueo', 'realizar_arqueo',
    'ver_inventario_fisico', 'cargar_inventario_fisico',
    'ver_reembasado', 'gestionar_reembasado',
    'ver_bodegas', 'gestionar_bodegas',
    'ver_aprovisionamiento', 'editar_aprovisionamiento',
    'ver_parametrizacion', 'gestionar_parametrizacion',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_reportes', 'importar_datos', 'exportar_datos'
  ]));

-- ── Movimientos y borradores ────────────────────────────────────────────────
drop policy if exists auth_read_movimientos on movimientos;
create policy auth_read_movimientos on movimientos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_stock', 'ajustar_stock', 'ver_productos', 'editar_productos',
    'ver_bodegas', 'ver_arqueo', 'ver_inventario_fisico',
    'alistar_ordenes_insumo', 'ver_alistamiento',
    'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists movimiento_borradores_read on movimiento_borradores;
create policy movimiento_borradores_read on movimiento_borradores
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_alistamiento', 'alistar_ordenes_insumo'
  ]));

drop policy if exists movimiento_borrador_items_read on movimiento_borrador_items;
create policy movimiento_borrador_items_read on movimiento_borrador_items
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_alistamiento', 'alistar_ordenes_insumo'
  ]));

-- Nombres de los responsables del movimiento.
drop policy if exists movimiento_borrador_responsables_read on movimiento_borrador_responsables;
create policy movimiento_borrador_responsables_read on movimiento_borrador_responsables
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_alistamiento', 'alistar_ordenes_insumo'
  ]));

-- ── Arqueos e inventarios físicos ───────────────────────────────────────────
drop policy if exists auth_read_arqueos on arqueos;
create policy auth_read_arqueos on arqueos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_arqueo', 'realizar_arqueo', 'ver_inventario_fisico',
    'cargar_inventario_fisico', 'ver_stock', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists auth_read_arqueo_items on arqueo_items;
create policy auth_read_arqueo_items on arqueo_items
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_arqueo', 'realizar_arqueo', 'ver_inventario_fisico',
    'cargar_inventario_fisico', 'ver_stock', 'ver_reportes', 'exportar_datos'
  ]));

-- ── Reembasado / decantado ──────────────────────────────────────────────────
drop policy if exists reembasados_read on reembasados;
create policy reembasados_read on reembasados
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_reembasado', 'gestionar_reembasado', 'ver_productos', 'editar_productos',
    'ver_stock', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists reembasado_items_read on reembasado_items;
create policy reembasado_items_read on reembasado_items
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_reembasado', 'gestionar_reembasado', 'ver_productos', 'editar_productos',
    'ver_stock', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists reembasado_ejec_read on reembasado_ejecuciones;
create policy reembasado_ejec_read on reembasado_ejecuciones
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_reembasado', 'gestionar_reembasado', 'ver_stock', 'ver_movimientos',
    'ver_reportes', 'exportar_datos'
  ]));

-- ── Bodegas y ubicaciones ───────────────────────────────────────────────────
drop policy if exists auth_read_bodegas on bodegas;
create policy auth_read_bodegas on bodegas
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_bodegas', 'gestionar_bodegas',
    'ver_productos', 'editar_productos', 'ver_stock', 'ajustar_stock',
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_arqueo', 'ver_inventario_fisico',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists auth_read_bodega_pisos on bodega_pisos;
create policy auth_read_bodega_pisos on bodega_pisos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_bodegas', 'gestionar_bodegas', 'ver_productos', 'editar_productos',
    'ver_stock', 'ver_movimientos', 'crear_movimientos', 'ver_alistamiento'
  ]));

drop policy if exists auth_read_ubicaciones on ubicaciones;
create policy auth_read_ubicaciones on ubicaciones
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_bodegas', 'gestionar_bodegas',
    'ver_productos', 'editar_productos', 'ver_stock', 'ajustar_stock',
    'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
    'ver_arqueo', 'ver_inventario_fisico', 'ver_alistamiento',
    'alistar_ordenes_insumo', 'ver_reportes', 'exportar_datos'
  ]));

-- ── Órdenes de insumo ───────────────────────────────────────────────────────
-- La misma lista para la orden y sus tablas hijas: quien ve la orden ve su
-- detalle, sus eventos, sus responsables y sus devoluciones.
drop policy if exists oi_read on ordenes_insumo;
create policy oi_read on ordenes_insumo
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_logistica', 'ver_monitoreo_entregas', 'gestionar_rutas',
    'ver_rutas_conductor', 'confirmar_entrega_conductor', 'ver_novedades_entrega',
    'ver_movimientos', 'crear_movimientos', 'ver_stock', 'ver_productos',
    'ver_aprovisionamiento', 'ver_contratos', 'editar_contratos',
    'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists oi_items_read on orden_insumo_items;
create policy oi_items_read on orden_insumo_items
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_logistica', 'ver_monitoreo_entregas', 'gestionar_rutas',
    'ver_rutas_conductor', 'confirmar_entrega_conductor', 'ver_novedades_entrega',
    'ver_movimientos', 'crear_movimientos', 'ver_stock', 'ver_productos',
    'ver_aprovisionamiento', 'ver_contratos', 'editar_contratos',
    'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists oi_ev_read on orden_insumo_eventos;
create policy oi_ev_read on orden_insumo_eventos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_logistica', 'ver_monitoreo_entregas', 'gestionar_rutas',
    'ver_contratos', 'editar_contratos', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists oi_resp_read on orden_insumo_responsables;
create policy oi_resp_read on orden_insumo_responsables
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_logistica', 'ver_monitoreo_entregas', 'gestionar_rutas',
    'ver_contratos', 'editar_contratos', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists oi_dev_read on orden_insumo_devoluciones;
create policy oi_dev_read on orden_insumo_devoluciones
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_movimientos', 'ver_stock', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists oi_dev_items_read on orden_insumo_devolucion_items;
create policy oi_dev_items_read on orden_insumo_devolucion_items
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_movimientos', 'ver_stock', 'ver_reportes', 'exportar_datos'
  ]));

-- Parametrización por sede: también la lee /api/plantilla-pedido, que se
-- descarga desde /ordenes-insumo, no solo /parametrizacion.
drop policy if exists sp_read on sede_productos;
create policy sp_read on sede_productos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_parametrizacion', 'gestionar_parametrizacion',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'ver_alistamiento',
    'ver_aprovisionamiento', 'editar_aprovisionamiento',
    'ver_productos', 'ver_stock', 'ver_reportes', 'importar_datos', 'exportar_datos'
  ]));

-- ── Maquinaria y mantenimiento ──────────────────────────────────────────────
-- /equipo (el QR pegado en la máquina) ya exige reportar_falla_maquinaria o
-- ver_mantenimiento en el código, así que el escaneo sigue funcionando.
drop policy if exists maq_read on maquinaria;
create policy maq_read on maquinaria
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_maquinaria', 'gestionar_maquinaria', 'ver_mantenimiento',
    'atender_mantenimiento', 'gestionar_mantenimiento', 'reportar_falla_maquinaria',
    'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists maq_ev_read on maquinaria_eventos;
create policy maq_ev_read on maquinaria_eventos
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_maquinaria', 'gestionar_maquinaria', 'ver_mantenimiento',
    'atender_mantenimiento', 'gestionar_mantenimiento', 'reportar_falla_maquinaria',
    'ver_reportes', 'exportar_datos'
  ]));

-- ── Logística: rutas, paradas, novedades y horarios ─────────────────────────
drop policy if exists rutas_read on rutas_entrega;
create policy rutas_read on rutas_entrega
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_logistica', 'gestionar_rutas', 'ver_monitoreo_entregas',
      'ver_ubicacion_conductores', 'gestionar_conductores',
      'ver_novedades_entrega', 'gestionar_novedades_entrega',
      'ver_rutas_conductor', 'confirmar_entrega_conductor',
      'ver_ordenes_insumo', 'alistar_ordenes_insumo', 'recibir_ordenes_insumo',
      'ver_alistamiento', 'ver_reportes', 'exportar_datos'
    ])
    or conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
  );

drop policy if exists paradas_read on ruta_paradas;
create policy paradas_read on ruta_paradas
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_logistica', 'gestionar_rutas', 'ver_monitoreo_entregas',
    'ver_ubicacion_conductores', 'gestionar_conductores',
    'ver_novedades_entrega', 'gestionar_novedades_entrega',
    'ver_rutas_conductor', 'confirmar_entrega_conductor',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'alistar_ordenes_insumo',
    'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_contratos', 'editar_contratos', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists novedades_read on novedades_entrega;
create policy novedades_read on novedades_entrega
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_novedades_entrega', 'gestionar_novedades_entrega',
      'reportar_novedad_conductor', 'ver_logistica', 'gestionar_rutas',
      'ver_monitoreo_entregas', 'ver_ubicacion_conductores', 'gestionar_conductores',
      'ver_rutas_conductor', 'ver_ordenes_insumo', 'alistar_ordenes_insumo',
      'recibir_ordenes_insumo', 'ver_alistamiento', 'ver_reportes', 'exportar_datos'
    ])
    or conductor_id in (select id from conductores where usuario_id = (select auth.uid()))
  );

drop policy if exists horarios_read on sede_horario_entrega;
create policy horarios_read on sede_horario_entrega
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_logistica', 'gestionar_horarios_entrega', 'gestionar_rutas',
    'ver_monitoreo_entregas', 'ver_ubicacion_conductores', 'gestionar_conductores',
    'ver_rutas_conductor', 'ver_ordenes_insumo', 'crear_ordenes_insumo',
    'aprobar_ordenes_insumo', 'alistar_ordenes_insumo', 'ver_alistamiento',
    'ver_contratos', 'editar_contratos'
  ]));

-- ── Sedes y contratos ───────────────────────────────────────────────────────
-- Tabla de dimensión: casi todos los módulos la leen (directa o embebida).
-- Además, cualquier usuario ve SU sede, para /carnet y /perfil.
drop policy if exists auth_read_sedes on sedes;
create policy auth_read_sedes on sedes
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_contratos', 'editar_contratos',
      'ver_parametrizacion', 'gestionar_parametrizacion',
      'ver_personas', 'gestionar_personas', 'importar_personas',
      'ver_planta_personal', 'gestionar_planta_personal',
      'ver_documentos_rrhh', 'gestionar_documentos_rrhh',
      'ver_postulaciones', 'gestionar_postulaciones',
      'ver_requisiciones', 'gestionar_requisiciones',
      'ver_usuarios', 'gestionar_usuarios',
      'ver_productos', 'ver_stock', 'ver_bodegas',
      'ver_movimientos', 'crear_movimientos', 'eliminar_movimientos',
      'ver_arqueo', 'ver_inventario_fisico',
      'ver_aprovisionamiento', 'editar_aprovisionamiento',
      'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
      'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
      'ver_logistica', 'gestionar_rutas', 'ver_monitoreo_entregas',
      'gestionar_horarios_entrega', 'ver_ubicacion_conductores',
      'ver_rutas_conductor', 'ver_novedades_entrega', 'gestionar_conductores',
      'ver_maquinaria', 'gestionar_maquinaria', 'ver_mantenimiento',
      'atender_mantenimiento', 'gestionar_mantenimiento', 'reportar_falla_maquinaria',
      'ver_servicios_hogar', 'gestionar_solicitudes_hogar', 'gestionar_agenda_hogar',
      'ver_directorio_correos', 'gestionar_directorio_correos',
      'ver_reportes', 'importar_datos', 'exportar_datos'
    ])
    -- la sede del propio usuario y la de su ficha de persona (/carnet, /perfil)
    or id = (select u.sede_id from usuarios u where u.id = (select auth.uid()))
    or id in (select p.sede_id from personas p where p.usuario_id = (select auth.uid()))
  );

drop policy if exists auth_read_grupos on grupos_contrato;
create policy auth_read_grupos on grupos_contrato
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_contratos', 'editar_contratos',
      'ver_parametrizacion', 'gestionar_parametrizacion',
      'ver_usuarios', 'gestionar_usuarios',
      'ver_personas', 'gestionar_personas', 'ver_planta_personal',
      'ver_aprovisionamiento', 'editar_aprovisionamiento',
      'ver_movimientos', 'ver_productos', 'ver_stock',
      'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
      'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
      'ver_logistica', 'gestionar_rutas', 'ver_monitoreo_entregas',
      'ver_ubicacion_conductores', 'gestionar_horarios_entrega',
      'ver_reportes', 'importar_datos', 'exportar_datos'
    ])
    -- el grupo del propio usuario (/carnet, /perfil)
    or id = (select u.grupo_id from usuarios u where u.id = (select auth.uid()))
  );

-- Clasificación de sedes por etiquetas: la usa lib/clasificacion-server.ts,
-- que corre desde /movimientos y /ordenes-insumo además de /contratos.
drop policy if exists etiquetas_read on etiquetas;
create policy etiquetas_read on etiquetas
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_contratos', 'editar_contratos', 'ver_movimientos', 'crear_movimientos',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'alistar_ordenes_insumo',
    'ver_alistamiento', 'ver_parametrizacion', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists etiqueta_categorias_read on etiqueta_categorias;
create policy etiqueta_categorias_read on etiqueta_categorias
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_contratos', 'editar_contratos', 'ver_movimientos', 'crear_movimientos',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'alistar_ordenes_insumo',
    'ver_alistamiento', 'ver_parametrizacion', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists grupo_etiquetas_read on grupo_etiquetas;
create policy grupo_etiquetas_read on grupo_etiquetas
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_contratos', 'editar_contratos', 'ver_movimientos', 'crear_movimientos',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'alistar_ordenes_insumo',
    'ver_alistamiento', 'ver_parametrizacion', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists sede_etiquetas_read on sede_etiquetas;
create policy sede_etiquetas_read on sede_etiquetas
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_contratos', 'editar_contratos', 'ver_movimientos', 'crear_movimientos',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'alistar_ordenes_insumo',
    'ver_alistamiento', 'ver_parametrizacion', 'ver_reportes', 'exportar_datos'
  ]));

-- ── Catálogos de administración ─────────────────────────────────────────────
-- `roles` guarda el JSONB de permisos de cada rol. La cláusula del propio rol
-- es la que mantiene vivo lib/permisos-server.ts para los no-admin.
drop policy if exists roles_read on roles;
create policy roles_read on roles
  for select to authenticated
  using (
    auth_permiso_any(array[
      'gestionar_roles', 'ver_usuarios', 'gestionar_usuarios',
      'ver_personas', 'gestionar_personas', 'importar_personas',
      'ver_planta_personal', 'ver_postulaciones', 'gestionar_postulaciones',
      'importar_datos'
    ])
    -- el propio rol: /carnet lo muestra y permisos-server.ts lo necesita
    or id = (select u.rol_id from usuarios u where u.id = (select auth.uid()))
  );

drop policy if exists gh_read_empresas on empresas_usuarias;
create policy gh_read_empresas on empresas_usuarias
  for select to authenticated
  using (
    auth_permiso_any(array[
      'ver_empresas_usuarias', 'gestionar_empresas_usuarias',
      'ver_personas', 'gestionar_personas', 'importar_personas',
      'ver_planta_personal', 'gestionar_planta_personal',
      'ver_documentos_rrhh', 'gestionar_documentos_rrhh',
      'ver_postulaciones', 'gestionar_postulaciones',
      'ver_requisiciones', 'gestionar_requisiciones',
      'ver_directorio_correos', 'gestionar_directorio_correos', 'ver_notificaciones',
      'ver_reportes', 'importar_datos', 'exportar_datos'
    ])
    -- la empresa usuaria de la propia ficha de persona (/carnet)
    or id in (select p.empresa_usuaria_id from personas p where p.usuario_id = (select auth.uid()))
  );

-- Datos de facturación de las empresas del grupo (NIT, dirección, resolución).
drop policy if exists ee_read on empresas_emisoras;
create policy ee_read on empresas_emisoras
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_configuracion', 'editar_configuracion', 'gestionar_integraciones',
    'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
    'ver_ordenes_compra', 'crear_ordenes_compra',
    'ver_directorio_correos', 'gestionar_directorio_correos', 'ver_notificaciones',
    'gestionar_plantillas_correo', 'ver_flujos_notificacion', 'gestionar_flujos_notificacion',
    'ver_postulaciones', 'gestionar_postulaciones',
    'ver_pagos_hogar', 'gestionar_pagos_hogar',
    'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists gh_read_tipos on tipos_documentales;
create policy gh_read_tipos on tipos_documentales
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_documentos_rrhh', 'gestionar_documentos_rrhh', 'gestionar_tipos_documentales',
    'ver_personas', 'gestionar_personas', 'ver_planta_personal',
    'ver_postulaciones', 'gestionar_postulaciones',
    'ver_plantillas_documento', 'gestionar_plantillas_documento'
  ]));

drop policy if exists gh_read_tiporefs on tipos_documentales_refs;
create policy gh_read_tiporefs on tipos_documentales_refs
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_documentos_rrhh', 'gestionar_documentos_rrhh', 'gestionar_tipos_documentales',
    'ver_personas', 'gestionar_personas', 'ver_planta_personal',
    'ver_postulaciones', 'gestionar_postulaciones',
    'ver_plantillas_documento', 'gestionar_plantillas_documento'
  ]));

-- ── Notificaciones y alertas ────────────────────────────────────────────────
drop policy if exists eventos_notif_read on eventos_notificacion;
create policy eventos_notif_read on eventos_notificacion
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_flujos_notificacion', 'gestionar_flujos_notificacion',
    'ver_notificaciones', 'gestionar_alertas', 'gestionar_plantillas_correo',
    'ver_configuracion', 'editar_configuracion', 'gestionar_integraciones'
  ]));

drop policy if exists auth_read_reglas on reglas_alerta;
create policy auth_read_reglas on reglas_alerta
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_notificaciones', 'gestionar_alertas',
    'ver_configuracion', 'editar_configuracion',
    'ver_flujos_notificacion', 'gestionar_flujos_notificacion'
  ]));

-- `presentaciones` (litro, galón, unidad…) queda a propósito abierta a cualquier
-- cuenta logueada: es un catálogo de unidades de medida, sin información de
-- negocio, y lo usan los formularios de varias pantallas.
