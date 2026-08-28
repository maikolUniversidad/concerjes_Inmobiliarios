-- =============================================================================
-- CIERRE DE LA AUDITORÍA DE PERMISOS Y ROLES
-- =============================================================================
-- Complementa `20260828000000_rls_permisos_dinamicos.sql` con lo que quedó
-- pendiente tras revisar las 150+ políticas del esquema una por una:
--
--   1) Escalamiento de privilegios al cambiar de rol: si el rol asignado no
--      tiene `rol_base`, el trigger CONSERVABA el enum anterior. Mover un
--      ADMIN a un rol restringido lo dejaba como ADMIN en la BD → bypass total.
--   2) `colombia_compra_eficiente`: la política comparaba `auth.jwt()->>'role'`
--      contra 'admin'/'superadmin'. Ese claim vale siempre 'authenticated' en
--      Supabase, así que la condición NUNCA se cumplía: nadie podía escribir.
--      (Es el mismo defecto que ya se corrigió en `stock_cce`.)
--   3) Borradores de movimiento y eventos de orden: escritura abierta a
--      cualquier usuario autenticado (`USING (true)`), sin permiso alguno.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ── 1) Mínimo privilegio al asignar un rol sin `rol_base` ───────────────────
CREATE OR REPLACE FUNCTION public.sync_usuario_rol()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rol_id IS NOT NULL THEN
    -- Antes: COALESCE(rol_base, NEW.rol, 'AUDITOR') → al pasar a un rol sin
    -- enum base se conservaba el rol anterior, de modo que un ADMIN degradado
    -- seguía siendo ADMIN para las políticas RLS. Ahora un rol personalizado
    -- sin `rol_base` cae siempre a AUDITOR (mínimo privilegio) y el acceso
    -- real lo dan sus permisos vía auth_permiso().
    NEW.rol := COALESCE(
      (SELECT rol_base FROM public.roles WHERE id = NEW.rol_id),
      'AUDITOR'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_usuarios_sync_rol ON public.usuarios;
CREATE TRIGGER tr_usuarios_sync_rol
  BEFORE INSERT OR UPDATE OF rol_id ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.sync_usuario_rol();

-- ── 2) Colombia Compra Eficiente: política que nunca se cumplía ──────────────
DROP POLICY IF EXISTS cce_write_admin ON public.colombia_compra_eficiente;
CREATE POLICY cce_write_admin ON public.colombia_compra_eficiente
  FOR ALL TO authenticated
  USING (public.auth_permiso_any(ARRAY['editar_productos', 'importar_datos']))
  WITH CHECK (public.auth_permiso_any(ARRAY['editar_productos', 'importar_datos']));

-- ── 3) Borradores de movimiento: exigir el permiso de movimientos ────────────
-- La lectura sigue abierta a usuarios autenticados (los borradores se arman
-- entre varias personas), pero escribir exige `crear_movimientos`.
DROP POLICY IF EXISTS movimiento_borradores_write ON public.movimiento_borradores;
CREATE POLICY movimiento_borradores_write ON public.movimiento_borradores
  FOR ALL TO authenticated
  USING (public.auth_permiso('crear_movimientos'))
  WITH CHECK (public.auth_permiso('crear_movimientos'));

DROP POLICY IF EXISTS movimiento_borrador_items_write ON public.movimiento_borrador_items;
CREATE POLICY movimiento_borrador_items_write ON public.movimiento_borrador_items
  FOR ALL TO authenticated
  USING (public.auth_permiso('crear_movimientos'))
  WITH CHECK (public.auth_permiso('crear_movimientos'));

DROP POLICY IF EXISTS movimiento_borrador_responsables_write ON public.movimiento_borrador_responsables;
CREATE POLICY movimiento_borrador_responsables_write ON public.movimiento_borrador_responsables
  FOR ALL TO authenticated
  USING (public.auth_permiso('crear_movimientos'))
  WITH CHECK (public.auth_permiso('crear_movimientos'));

-- ── 4) Bitácora de órdenes de insumo: solo quien participa del flujo ─────────
DROP POLICY IF EXISTS oi_ev_write ON public.orden_insumo_eventos;
CREATE POLICY oi_ev_write ON public.orden_insumo_eventos
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_permiso_any(ARRAY[
    'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
    'alistar_ordenes_insumo', 'recibir_ordenes_insumo'
  ]));

-- ── 5) Permisos de pagos del hogar en los roles operativos ──────────────────
-- Las claves ya existían en la BD pero no en el catálogo de la app (ahora sí).
-- Se garantiza que quien gestiona solicitudes pueda al menos VER los cobros.
UPDATE public.roles
SET permisos = permisos || jsonb_build_object('ver_pagos_hogar', true)
WHERE COALESCE(permisos ->> 'gestionar_solicitudes_hogar', 'false') = 'true'
  AND COALESCE(permisos ->> 'ver_pagos_hogar', 'false') <> 'true';
