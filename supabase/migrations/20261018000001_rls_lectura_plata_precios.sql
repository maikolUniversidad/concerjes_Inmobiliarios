-- Cierra las lecturas abiertas (USING (true)) del grupo "plata y precios".
--
-- Hoy cualquiera de las ~890 cuentas (853 con el rol Empleado, cero permisos)
-- lee los 462 precios de proveedor, las órdenes de compra con sus costos, el
-- catálogo de precios de referencia de Colombia Compra Eficiente y el plan de
-- compras. Pasa a exigir los permisos de /roles de las pantallas que lo leen.
--
-- Nota: `productos.precio_lista` sigue visible para quien vea el catálogo
-- (migración del grupo C); separarlo pediría seguridad por columna.
-- Idempotente: se puede volver a aplicar sin daño.

-- ── Proveedores y sus precios ───────────────────────────────────────────────
-- Sin `ver_reportes`: ningún informe de /reportes lee esta tabla (solo
-- /comparador-precios y las OC), y añadirlo le daba los costos al rol Jefe de
-- Mantenimiento, que tiene `ver_reportes` para el tablero de mantenimiento.
drop policy if exists auth_read_precios on precios_proveedor;
create policy auth_read_precios on precios_proveedor
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_proveedores', 'editar_proveedores', 'ver_ordenes_compra',
    'crear_ordenes_compra'
  ]));

-- Los proveedores también se leen desde el catálogo de productos (marca/origen)
-- y desde el directorio de correos de notificaciones.
drop policy if exists auth_read_proveedores on proveedores;
create policy auth_read_proveedores on proveedores
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_proveedores', 'editar_proveedores', 'ver_ordenes_compra',
    'crear_ordenes_compra', 'ver_productos', 'editar_productos',
    'ver_directorio_correos', 'gestionar_directorio_correos', 'ver_notificaciones',
    'ver_postulaciones', 'gestionar_postulaciones',
    'importar_datos', 'ver_reportes', 'exportar_datos'
  ]));

-- ── Órdenes de compra ───────────────────────────────────────────────────────
drop policy if exists auth_read_oc on ordenes_compra;
create policy auth_read_oc on ordenes_compra
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_compra', 'crear_ordenes_compra', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists auth_read_oc_items on oc_items;
create policy auth_read_oc_items on oc_items
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_ordenes_compra', 'crear_ordenes_compra', 'ver_reportes', 'exportar_datos'
  ]));

drop policy if exists oc_eventos_read on oc_eventos;
create policy oc_eventos_read on oc_eventos
  for select to authenticated
  using (auth_permiso_any(array['ver_ordenes_compra', 'crear_ordenes_compra']));

-- ── Colombia Compra Eficiente (precios de referencia del Estado) ────────────
drop policy if exists cce_read_all on colombia_compra_eficiente;
create policy cce_read_all on colombia_compra_eficiente
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_productos', 'editar_productos', 'ver_stock', 'ajustar_stock',
    'ver_proveedores', 'ver_reportes', 'importar_datos', 'exportar_datos'
  ]));

drop policy if exists stock_cce_read on stock_cce;
create policy stock_cce_read on stock_cce
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_stock', 'ajustar_stock', 'ver_productos', 'editar_productos',
    'ver_reportes', 'importar_datos', 'exportar_datos'
  ]));

-- ── Plan de compras y rotación ──────────────────────────────────────────────
-- Tampoco llevan `ver_reportes`: /reportes no las consulta.
drop policy if exists auth_read_aprov on aprovisionamiento;
create policy auth_read_aprov on aprovisionamiento
  for select to authenticated
  using (auth_permiso_any(array['ver_aprovisionamiento', 'editar_aprovisionamiento']));

drop policy if exists auth_read_pedidos on pedidos_sede;
create policy auth_read_pedidos on pedidos_sede
  for select to authenticated
  using (auth_permiso_any(array['ver_aprovisionamiento', 'editar_aprovisionamiento']));

drop policy if exists auth_read_rotacion on rotacion;
create policy auth_read_rotacion on rotacion
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_aprovisionamiento', 'editar_aprovisionamiento', 'ver_productos', 'editar_productos'
  ]));

-- ── Parámetros de cobro de Servicios del Hogar ──────────────────────────────
-- IVA, anticipos, recargos de mora, consecutivo de cobro e instrucciones de pago.
drop policy if exists param_pago_read on parametros_pago_hogar;
create policy param_pago_read on parametros_pago_hogar
  for select to authenticated
  using (auth_permiso_any(array[
    'ver_pagos_hogar', 'gestionar_pagos_hogar', 'parametrizar_pagos_hogar',
    'ver_servicios_hogar', 'gestionar_solicitudes_hogar', 'gestionar_agenda_hogar'
  ]));
