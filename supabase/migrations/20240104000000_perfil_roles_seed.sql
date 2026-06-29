-- =============================================================================
-- PERFIL DE USUARIO + ROLES DE REFERENCIA
-- =============================================================================
-- 1) Bucket de avatares (idempotente).
-- 2) RPC update_mi_perfil: cada usuario edita SOLO su propia fila y SOLO los
--    campos seguros (nombre, teléfono, avatar). No puede cambiar su rol/permisos.
-- 3) Seed de roles de referencia en la tabla `roles` con permisos convenientes.
-- =============================================================================

-- ── 1) Bucket de avatares ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatares', 'avatares', true)
ON CONFLICT (id) DO NOTHING;

-- ── 2) RPC: actualizar mi perfil (campos seguros) ────────────────────────────
-- SECURITY DEFINER para poder escribir en `usuarios` sin abrir una política de
-- UPDATE general (que permitiría a un usuario auto-asignarse rol de admin).
CREATE OR REPLACE FUNCTION public.update_mi_perfil(
  p_nombre     TEXT,
  p_telefono   TEXT,
  p_avatar_url TEXT
)
RETURNS public.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fila public.usuarios;
BEGIN
  UPDATE public.usuarios
  SET nombre     = COALESCE(NULLIF(trim(p_nombre), ''), nombre),
      telefono   = NULLIF(trim(p_telefono), ''),
      avatar_url = NULLIF(trim(p_avatar_url), '')
  WHERE id = (SELECT auth.uid())
  RETURNING * INTO fila;

  RETURN fila;
END;
$$;

REVOKE ALL ON FUNCTION public.update_mi_perfil(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_mi_perfil(TEXT, TEXT, TEXT) TO authenticated;

-- ── 3) Roles de referencia ───────────────────────────────────────────────────
-- Las claves de permisos coinciden con el catálogo de la pantalla /roles.
-- Solo se almacenan los permisos en `true`; la UI completa el resto en `false`.
INSERT INTO public.roles (nombre, descripcion, permisos, activo) VALUES
  (
    'Super Administrador',
    'Control total del sistema, incluida la gestión de roles y configuración.',
    jsonb_build_object(
      'ver_productos', true, 'editar_productos', true, 'ver_stock', true, 'ajustar_stock', true,
      'ver_movimientos', true, 'crear_movimientos', true, 'usar_scanner', true,
      'ver_aprovisionamiento', true, 'editar_aprovisionamiento', true, 'ver_contratos', true,
      'editar_contratos', true, 'ver_proveedores', true, 'editar_proveedores', true,
      'ver_ordenes_compra', true, 'crear_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'subir_documentos', true, 'ver_usuarios', true, 'gestionar_usuarios', true,
      'gestionar_roles', true, 'ver_actividad_log', true, 'ver_configuracion', true, 'editar_configuracion', true,
      'usar_ia_vision', true, 'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Administrador',
    'Gestiona operación, inventario, compras y usuarios. No administra roles.',
    jsonb_build_object(
      'ver_productos', true, 'editar_productos', true, 'ver_stock', true, 'ajustar_stock', true,
      'ver_movimientos', true, 'crear_movimientos', true, 'usar_scanner', true,
      'ver_aprovisionamiento', true, 'editar_aprovisionamiento', true, 'ver_contratos', true,
      'editar_contratos', true, 'ver_proveedores', true, 'editar_proveedores', true,
      'ver_ordenes_compra', true, 'crear_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'subir_documentos', true, 'ver_usuarios', true, 'gestionar_usuarios', true,
      'ver_actividad_log', true, 'ver_configuracion', true, 'editar_configuracion', true,
      'usar_ia_vision', true, 'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Supervisor',
    'Supervisa operación y consulta indicadores. Registra movimientos.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'ver_movimientos', true, 'crear_movimientos', true,
      'ver_aprovisionamiento', true, 'ver_contratos', true, 'ver_proveedores', true,
      'ver_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'ver_usuarios', true, 'ver_actividad_log', true,
      'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Coordinador de Compras',
    'Planifica aprovisionamiento, gestiona proveedores y órdenes de compra.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true,
      'ver_aprovisionamiento', true, 'editar_aprovisionamiento', true,
      'ver_proveedores', true, 'editar_proveedores', true,
      'ver_ordenes_compra', true, 'crear_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Bodeguero',
    'Maneja stock físico, registra entradas/salidas y usa el escáner.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'ajustar_stock', true,
      'ver_movimientos', true, 'crear_movimientos', true, 'usar_scanner', true,
      'ver_documentos', true
    ),
    true
  ),
  (
    'Auditor',
    'Acceso de solo lectura a toda la operación y al log de actividad.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'ver_movimientos', true,
      'ver_aprovisionamiento', true, 'ver_contratos', true, 'ver_proveedores', true,
      'ver_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'ver_usuarios', true, 'ver_actividad_log', true,
      'ver_configuracion', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Operador de Sede',
    'Personal en sede: consulta inventario, escanea y registra movimientos básicos.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'usar_scanner', true,
      'crear_movimientos', true, 'usar_ia_asistente', true
    ),
    true
  )
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      permisos    = EXCLUDED.permisos,
      updated_at  = NOW();
