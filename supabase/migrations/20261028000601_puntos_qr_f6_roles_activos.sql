-- =============================================================================
-- F6 · Activos — reparto de los tres permisos entre los roles
-- =============================================================================
-- La migración 20261028000600 dejó las tres claves en el catálogo y solo le dio
-- la de lectura al Auditor. Esto las reparte entre los roles que de verdad
-- trabajan con el activo, con el mismo criterio de `20261018000005`
-- (programación): quien ARMA el inventario va aparte de quien REPORTA en sitio.
--
--   ver_activos_ronda          entra a /rondas/activos y lee la ficha.
--   gestionar_activos_ronda    da de alta tipos y activos, sube documentos,
--                              define medidores y borra una lectura mal tomada.
--   registrar_lecturas_activos toma la lectura del medidor y nada más.
--
-- Reparto:
--   Coordinador                 ver + gestionar + registrar
--   Supervisor de Conserjería   ver + gestionar + registrar
--   Jefe de Mantenimiento       ver (ya lo tiene) + gestionar + registrar
--   Técnico de Mantenimiento    ver (ya lo tiene) + registrar
--   Conserje                    ver + registrar
--   Operador de Sede            ver + registrar
--   Auditor                     ver (ya lo tiene en 20261028000600)
--
-- Por qué el técnico y el conserje SÍ registran lecturas pero NO gestionan: la
-- ficha del activo es dato maestro del contrato y una lectura es un hecho de
-- campo. El que pasa por la sede anota el contador; cambiar marca, serial o
-- garantía es otra cosa. `activo_registra_lecturas()` ya está escrita así.
--
-- Por qué Mantenimiento entra aquí y no se deja para F7: los planes por medidor
-- de F7 leen `activo_medidores.valor_actual`, y ese valor solo se mueve cuando
-- alguien registra una lectura. Sin este permiso en Mantenimiento, un plan por
-- horas o por ciclos no avanza nunca.
--
-- Gerencia, Administrador y Super Administrador NO se siembran: `auth_permiso()`
-- le da paso libre a los roles base ADMIN y SUPER_ADMIN.
--
-- `defaults || permisos` y no al revés: lo que ya esté puesto en el rol gana, así
-- que re-aplicar esta migración no revive un permiso que alguien haya apagado a
-- mano en /roles.
-- =============================================================================

-- ── 1. Quien arma el inventario de activos del contrato ─────────────────────
UPDATE public.roles
   SET permisos = jsonb_build_object(
         'ver_activos_ronda', true,
         'gestionar_activos_ronda', true,
         'registrar_lecturas_activos', true
       ) || permisos
 WHERE nombre IN ('Coordinador', 'Supervisor de Conserjería', 'Jefe de Mantenimiento');

-- ── 2. Quien está en sitio y solo anota el contador ─────────────────────────
UPDATE public.roles
   SET permisos = jsonb_build_object(
         'ver_activos_ronda', true,
         'registrar_lecturas_activos', true
       ) || permisos
 WHERE nombre IN ('Conserje', 'Operador de Sede', 'Técnico de Mantenimiento');

-- ── 3. Comprobación: nadie puede registrar sin poder ver ────────────────────
-- `activo_acceso()` deja entrar a quien solo registra lecturas, pero la pantalla
-- /rondas/activos y el ítem del menú exigen `ver_activos_ronda`. Un rol que
-- registre sin ver pasaría la RLS y se chocaría con el guard de la pantalla.
DO $$
DECLARE incoherentes TEXT;
BEGIN
  SELECT string_agg(nombre, ', ') INTO incoherentes
    FROM public.roles
   WHERE COALESCE((permisos->>'ver_activos_ronda')::boolean, false) IS NOT TRUE
     AND (COALESCE((permisos->>'gestionar_activos_ronda')::boolean, false)
          OR COALESCE((permisos->>'registrar_lecturas_activos')::boolean, false));
  IF incoherentes IS NOT NULL THEN
    RAISE EXCEPTION 'Roles que escriben activos sin poder verlos: %', incoherentes;
  END IF;
END $$;

-- =============================================================================
-- FIN
-- =============================================================================
