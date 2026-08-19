-- =============================================================================
-- VISTA usuarios_opciones (id + nombre + rol) legible por cualquier autenticado
-- =============================================================================
-- La RLS de `usuarios` solo deja ver el propio registro (o a los admins), así
-- que un coordinador no puede resolver el nombre de quien creó una orden. Esta
-- vista (como `conductores_opciones`) expone id/nombre/rol para poder mostrar y
-- filtrar por "creado por" en Operaciones, sin abrir la tabla `usuarios`.
-- Es una vista normal (no security_invoker): corre con privilegios del dueño y
-- por tanto no aplica la RLS de la tabla base.
-- =============================================================================

CREATE OR REPLACE VIEW usuarios_opciones AS
  SELECT u.id, u.nombre, u.rol, u.activo
  FROM usuarios u;

GRANT SELECT ON usuarios_opciones TO authenticated;
