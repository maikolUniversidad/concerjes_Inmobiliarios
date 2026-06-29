-- =============================================================================
-- Ajuste de roles existentes con los permisos de los módulos nuevos
-- (Arqueo, Bodegas, Generador de códigos, Exportar, Cargas masivas, Historial,
--  Notificaciones). Merge no destructivo: `permisos || {...}` solo agrega/activa
-- las claves nuevas según el rol base, preservando las existentes. Idempotente.
-- =============================================================================

-- SUPER_ADMIN y ADMIN: todos los módulos nuevos
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'realizar_arqueo', true,
  'ver_bodegas', true, 'gestionar_bodegas', true,
  'generar_codigos', true, 'exportar_datos', true,
  'importar_datos', true, 'ver_historial', true,
  'ver_notificaciones', true, 'gestionar_alertas', true
) WHERE rol_base IN ('SUPER_ADMIN', 'ADMIN');

-- SUPERVISOR
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'realizar_arqueo', true,
  'ver_bodegas', true, 'gestionar_bodegas', true,
  'exportar_datos', true, 'ver_historial', true, 'ver_notificaciones', true
) WHERE rol_base = 'SUPERVISOR';

-- BODEGUERO
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'realizar_arqueo', true,
  'ver_bodegas', true, 'gestionar_bodegas', true,
  'generar_codigos', true, 'ver_notificaciones', true
) WHERE rol_base = 'BODEGUERO';

-- COORDINADOR_COMPRAS
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'ver_bodegas', true,
  'exportar_datos', true, 'ver_notificaciones', true
) WHERE rol_base = 'COORDINADOR_COMPRAS';

-- AUDITOR (solo lectura)
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'ver_bodegas', true,
  'exportar_datos', true, 'ver_historial', true, 'ver_notificaciones', true
) WHERE rol_base = 'AUDITOR';

-- OPERADOR_SEDE
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_bodegas', true, 'ver_notificaciones', true
) WHERE rol_base = 'OPERADOR_SEDE';
