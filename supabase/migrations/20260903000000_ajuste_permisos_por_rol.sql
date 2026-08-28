-- =============================================================================
-- AJUSTE DE LOS PERMISOS DE CADA ROL
-- =============================================================================
-- Una vez que /roles pasó a mandar de verdad quedó a la vista que la
-- configuración de cada rol estaba incoherente. Tres tipos de problema:
--
--   a) Permisos de acción sin su lectura: el Coordinador podía cerrar un arqueo
--      pero no ajustar stock (y cerrar un arqueo APLICA el ajuste, así que
--      fallaba); Compras registraba movimientos que no podía ver; varios roles
--      gestionaban reembasado sin ver la pantalla.
--   b) Herencias del esquema viejo por rol enum: Bodeguero y Compras habían
--      quedado gestionando Servicios del Hogar y creando conductores, rutas y
--      horarios; Conserje y Operador de Sede podían editar el plan de compras.
--   c) Alcances que no correspondían al oficio: Compras no podía mantener el
--      catálogo de productos siendo quien negocia precios y presentaciones, y
--      el Auditor —rol de solo lectura— no veía media aplicación.
--
-- Los roles con `rol_base` ADMIN/SUPER_ADMIN (Administrador, Gerencia, Super
-- Administrador) no se tocan: tienen acceso total implícito por diseño.
--
-- IDEMPOTENTE: usa `||` para activar y `-` para quitar claves puntuales.
-- =============================================================================

SET search_path TO public;

-- ── Coordinador (operación / conserjería) ───────────────────────────────────
-- Cierra arqueos → necesita ajustar_stock. Hace cargue masivo de personas →
-- esa pantalla es /importar, que exige importar_datos.
UPDATE public.roles SET permisos = permisos || '{
  "ajustar_stock": true,
  "importar_datos": true,
  "ver_aprovisionamiento": true,
  "ver_reembasado": true
}'::jsonb WHERE nombre = 'Coordinador';

-- ── Supervisor de Conserjería ───────────────────────────────────────────────
UPDATE public.roles SET permisos = permisos || '{
  "ajustar_stock": true,
  "ver_reembasado": true
}'::jsonb WHERE nombre = 'Supervisor de Conserjería';

-- ── Coordinador de Compras ──────────────────────────────────────────────────
-- Pasa a mantener el catálogo (nombres, presentaciones, precios de lista y
-- códigos de barras). Sigue SIN alistar ni despachar: eso es de bodega.
UPDATE public.roles SET permisos = permisos || '{
  "editar_productos": true,
  "generar_codigos": true,
  "ver_movimientos": true,
  "ver_reembasado": true
}'::jsonb WHERE nombre = 'Coordinador de Compras';

-- Herencias que no son de compras. Conserva la LECTURA de logística
-- (ver_logistica, ver_ubicacion_conductores, ver_novedades_entrega) porque
-- necesita seguir sus despachos.
UPDATE public.roles SET permisos = permisos
  - 'ver_servicios_hogar' - 'gestionar_solicitudes_hogar' - 'gestionar_agenda_hogar'
  - 'ver_pagos_hogar' - 'gestionar_pagos_hogar' - 'parametrizar_pagos_hogar'
  - 'gestionar_conductores' - 'gestionar_rutas' - 'gestionar_horarios_entrega'
  - 'gestionar_novedades_entrega' - 'gestionar_reembasado'
WHERE nombre = 'Coordinador de Compras';

-- ── Bodeguero ───────────────────────────────────────────────────────────────
-- Herencias que no son de bodega. Igual que compras, conserva la lectura de
-- logística para seguir sus despachos.
UPDATE public.roles SET permisos = permisos
  - 'ver_servicios_hogar' - 'gestionar_solicitudes_hogar' - 'gestionar_agenda_hogar'
  - 'ver_pagos_hogar'
  - 'gestionar_conductores' - 'gestionar_rutas' - 'gestionar_horarios_entrega'
  - 'gestionar_novedades_entrega'
WHERE nombre = 'Bodeguero';

-- ── Conserje y Operador de Sede ─────────────────────────────────────────────
-- Editar el plan de compras era herencia de `pedidos_sede` (modelo viejo).
-- Conservan ejecutar reembasado en sede, que sí es su tarea.
UPDATE public.roles SET permisos = (permisos - 'editar_aprovisionamiento') || '{
  "ver_reembasado": true
}'::jsonb WHERE nombre IN ('Conserje', 'Operador de Sede');

UPDATE public.roles SET permisos = permisos || '{
  "ver_movimientos": true
}'::jsonb WHERE nombre = 'Operador de Sede';

-- ── Conductor ───────────────────────────────────────────────────────────────
-- Reportaba novedades que después no podía consultar.
UPDATE public.roles SET permisos = permisos || '{
  "ver_novedades_entrega": true
}'::jsonb WHERE nombre = 'Conductor';

-- ── Auditor ─────────────────────────────────────────────────────────────────
-- Rol de solo lectura: TODAS las claves `ver_*` del catálogo más la exportación
-- a Excel, y ninguna de escritura. Se reemplaza el objeto completo para que no
-- queden permisos de acción sueltos de configuraciones anteriores.
-- (`ver_rutas_conductor` queda fuera: es la vista personal del conductor.)
UPDATE public.roles SET permisos = '{
  "ver_productos": true,
  "ver_stock": true,
  "ver_movimientos": true,
  "ver_arqueo": true,
  "ver_bodegas": true,
  "ver_reembasado": true,
  "ver_maquinaria": true,
  "ver_aprovisionamiento": true,
  "ver_contratos": true,
  "ver_parametrizacion": true,
  "ver_proveedores": true,
  "ver_ordenes_compra": true,
  "ver_ordenes_insumo": true,
  "ver_alistamiento": true,
  "ver_reportes": true,
  "exportar_datos": true,
  "ver_documentos": true,
  "ver_usuarios": true,
  "ver_actividad_log": true,
  "ver_historial": true,
  "ver_notificaciones": true,
  "ver_configuracion": true,
  "ver_flujos_notificacion": true,
  "ver_personas": true,
  "ver_empresas_usuarias": true,
  "ver_documentos_rrhh": true,
  "ver_postulaciones": true,
  "ver_pqrs": true,
  "ver_no_conformes": true,
  "ver_contratos_conserjeria": true,
  "ver_panel_gerencia": true,
  "ver_servicios_hogar": true,
  "ver_pagos_hogar": true,
  "ver_logistica": true,
  "ver_monitoreo_entregas": true,
  "ver_ubicacion_conductores": true,
  "ver_novedades_entrega": true
}'::jsonb WHERE nombre = 'Auditor';
