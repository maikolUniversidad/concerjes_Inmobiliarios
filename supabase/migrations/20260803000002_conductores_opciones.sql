-- =============================================================================
-- Vista conductores_opciones — lista de conductores para selectores
-- =============================================================================
-- PROBLEMA: el selector de conductor al despachar una orden de insumo cargaba
-- `conductores` con un join embebido a `usuarios(nombre)`. Pero la RLS de
-- `usuarios` (self_read_usuarios) solo deja leer la propia fila o a un ADMIN, así
-- que un BODEGUERO no podía leer el NOMBRE de los conductores → el join venía
-- nulo → la lista salía vacía. Le funcionaba al admin pero no al bodeguero.
--
-- SOLUCIÓN: una vista que expone SOLO (usuario_id, nombre, placa, tipo, activo).
-- Una vista normal se ejecuta con los privilegios de su DUEÑO (security_invoker
-- = false, el valor por defecto), así que salta la RLS de `usuarios` y devuelve
-- los nombres de los conductores sin exponer correos/roles.
-- =============================================================================

CREATE OR REPLACE VIEW public.conductores_opciones AS
  SELECT
    c.usuario_id,
    u.nombre,
    c.placa_vehiculo AS placa,
    c.tipo_vehiculo,
    c.activo
  FROM public.conductores c
  JOIN public.usuarios u ON u.id = c.usuario_id;

-- Cualquier usuario autenticado puede leer la lista para elegir conductor.
GRANT SELECT ON public.conductores_opciones TO authenticated;
