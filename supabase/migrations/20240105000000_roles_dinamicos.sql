-- =============================================================================
-- ROLES DINÁMICOS — vincular usuarios ↔ tabla `roles`
-- =============================================================================
-- Objetivo: que la asignación de rol a un usuario y sus permisos provengan de
-- la tabla `roles` (editable desde /roles) y no de valores quemados.
--
-- Compatibilidad: se conserva la columna enum `usuarios.rol` (la usan las
-- políticas RLS vía auth_rol()). Un trigger la mantiene sincronizada a partir
-- del `rol_base` del rol asignado, de modo que la seguridad a nivel BD sigue
-- funcionando aunque la UI trabaje con roles dinámicos.
-- =============================================================================

-- ── 1) Enum base por rol (para RLS) ──────────────────────────────────────────
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS rol_base public.rol_usuario;

COMMENT ON COLUMN public.roles.rol_base IS
  'Rol enum base usado por las políticas RLS. Los roles personalizados pueden dejarlo en NULL (se asume AUDITOR / mínimo privilegio).';

-- Mapear los roles de referencia a su enum base
UPDATE public.roles SET rol_base = 'SUPER_ADMIN'         WHERE nombre = 'Super Administrador'    AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'ADMIN'               WHERE nombre = 'Administrador'           AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'SUPERVISOR'          WHERE nombre = 'Supervisor'              AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'COORDINADOR_COMPRAS' WHERE nombre = 'Coordinador de Compras'  AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'BODEGUERO'           WHERE nombre = 'Bodeguero'               AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'AUDITOR'             WHERE nombre = 'Auditor'                 AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'OPERADOR_SEDE'       WHERE nombre = 'Operador de Sede'        AND rol_base IS NULL;

-- ── 2) FK usuarios.rol_id → roles ────────────────────────────────────────────
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS rol_id UUID REFERENCES public.roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_rol_id ON public.usuarios(rol_id);

-- Backfill: asignar rol_id según el enum actual de cada usuario
UPDATE public.usuarios u
SET rol_id = r.id
FROM public.roles r
WHERE r.rol_base = u.rol
  AND u.rol_id IS NULL;

-- ── 3) Mantener el enum `rol` sincronizado desde el rol asignado ─────────────
-- Así las políticas RLS existentes (auth_rol()) siguen siendo válidas.
CREATE OR REPLACE FUNCTION public.sync_usuario_rol()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rol_id IS NOT NULL THEN
    NEW.rol := COALESCE(
      (SELECT rol_base FROM public.roles WHERE id = NEW.rol_id),
      NEW.rol,
      'AUDITOR'  -- mínimo privilegio para roles personalizados sin enum base
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_usuarios_sync_rol ON public.usuarios;
CREATE TRIGGER tr_usuarios_sync_rol
  BEFORE INSERT OR UPDATE OF rol_id ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.sync_usuario_rol();

-- ── 4) Permisos efectivos del usuario autenticado (para la app) ──────────────
-- Combina los permisos del rol asignado con overrides individuales en
-- usuarios.permisos (estos últimos ganan). SECURITY DEFINER para leer `roles`.
CREATE OR REPLACE FUNCTION public.auth_permisos()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.permisos, '{}'::jsonb) || COALESCE(u.permisos, '{}'::jsonb)
  FROM public.usuarios u
  LEFT JOIN public.roles r ON r.id = u.rol_id
  WHERE u.id = (SELECT auth.uid())
$$;

GRANT EXECUTE ON FUNCTION public.auth_permisos() TO authenticated;
