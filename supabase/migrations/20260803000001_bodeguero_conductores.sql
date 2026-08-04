-- =============================================================================
-- Bodeguero: habilitar la gestión de Conductores
-- =============================================================================
-- La migración 20260728000000_conductor_module.sql le dio al rol BODEGUERO los
-- permisos de despacho (ver_logistica, gestionar_rutas, ver_ubicacion_conductores,
-- ver_novedades_entrega) pero NO `gestionar_conductores`, por lo que el ítem
-- "Conductores" del menú (que se filtra por esa clave) no se desplegaba para él.
-- La RLS de las tablas de conductores ya incluye a BODEGUERO; solo faltaba el
-- permiso de la aplicación.
--
-- Merge no destructivo (permisos || {...}): solo agrega la clave, preserva el
-- resto. Idempotente.
-- =============================================================================

UPDATE public.roles
SET permisos = permisos || '{
  "gestionar_conductores": true,
  "gestionar_horarios_entrega": true,
  "gestionar_novedades_entrega": true
}'::jsonb
WHERE rol_base = 'BODEGUERO';
