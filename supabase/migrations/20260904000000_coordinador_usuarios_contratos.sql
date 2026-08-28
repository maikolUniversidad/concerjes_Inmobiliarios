-- =============================================================================
-- COORDINADOR: gestión de usuarios y edición de contratos / sedes
-- =============================================================================
-- El Coordinador (7 usuarios activos, el rol más usado) pasa a poder:
--   · crear y editar usuarios  → `gestionar_usuarios` (+ `ver_usuarios`, que no
--     tenía: sin la lectura la pantalla /usuarios no abre)
--   · crear y editar contratos, grupos y sedes → `editar_contratos`
--
-- OJO — escalamiento de privilegios: `gestionar_usuarios` permite cambiarle el
-- rol a cualquier usuario, incluido el propio. Un Coordinador puede asignarse
-- el rol Administrador y quedar con acceso total, aunque no tenga
-- `gestionar_roles`. Es inherente a poder administrar usuarios; si se quiere
-- cerrar, hay que impedir por separado que quien no sea admin asigne roles con
-- `rol_base` ADMIN/SUPER_ADMIN o se edite su propia fila.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

UPDATE public.roles SET permisos = permisos || '{
  "ver_usuarios": true,
  "gestionar_usuarios": true,
  "editar_contratos": true
}'::jsonb WHERE nombre = 'Coordinador';
