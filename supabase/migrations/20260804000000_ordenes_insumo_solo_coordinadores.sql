-- =============================================================================
-- ÓRDENES DE INSUMO — solo los COORDINADORES generan y aprueban
-- =============================================================================
-- Se quita a supervisores (y operadores de sede) la capacidad de generar y
-- aprobar órdenes de insumo. Los coordinadores hacen ambas cosas.
-- El gating es 100% por claves de permiso (crear_ordenes_insumo /
-- aprobar_ordenes_insumo) que se validan en las server actions y en la UI,
-- por lo que basta con ajustar los permisos de los roles.
-- (SUPER_ADMIN y ADMIN conservan acceso: la app les da bypass total.)
-- =============================================================================

-- 1) Quitar generar y aprobar a supervisores / operadores de sede
UPDATE public.roles
SET permisos = permisos || '{"crear_ordenes_insumo": false, "aprobar_ordenes_insumo": false}'::jsonb
WHERE rol_base IN ('SUPERVISOR', 'OPERADOR_SEDE')
   OR nombre ILIKE 'supervisor%';

-- 2) Garantizar que los coordinadores generen y aprueben
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true, "aprobar_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS'
   OR nombre ILIKE 'coordinador%';
