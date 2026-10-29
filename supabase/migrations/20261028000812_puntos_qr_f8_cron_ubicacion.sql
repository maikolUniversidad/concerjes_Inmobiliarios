-- =============================================================================
-- F8 · El mantenimiento del rastro pasa a ser SOLO del cron
-- =============================================================================
-- Acompaña a la ruta `/api/cron/ubicacion`, que por fin llama a las dos
-- funciones de mantenimiento que F8 dejó escritas y que no invocaba nadie.
--
-- QUÉ ARREGLA. Las dos son `SECURITY DEFINER`, no comprueban ningún permiso por
-- dentro —no les hacía falta mientras nadie pudiera llamarlas— y tenían el
-- EXECUTE que Supabase da por omisión a `anon` y `authenticated`. Es decir:
-- cualquiera con la llave pública del navegador podía pedir
-- `ronda_purgar_ubicacion(50000)` o `ronda_turnos_cerrar_vencidos(5000)`
-- cuantas veces quisiera.
--
-- El daño tenía techo, y conviene decirlo con precisión en vez de exagerarlo:
-- las dos solo tocan lo que YA estaba vencido —rastro pasado de la retención de
-- su contrato, turnos pasados de su hora prevista—, así que lo peor que se
-- conseguía era adelantar un trabajo que el cron iba a hacer igual, y de paso
-- obligar a la base a barrer en el momento que eligiera quien llamara. No había
-- forma de borrar un rastro vigente ni de cerrar un turno en curso.
--
-- Aun así no tienen por qué estar abiertas: desde esta migración son del cron,
-- que entra con la llave de servicio. Si mañana alguien les quita el techo —un
-- parámetro de fecha, un «purgar todo de este contrato»— el agujero dejaría de
-- tener techo y nadie se acordaría de cerrar esto.
--
-- `service_role` conserva el EXECUTE porque es con quien entra la ruta del cron.
-- `postgres` también, que es con quien corre `scripts/probar-puntos-qr-f8.mjs`
-- por `DIRECT_URL`. Ninguna pantalla ni acción de la app las llama: se comprobó
-- antes de revocar.
-- =============================================================================

REVOKE ALL ON FUNCTION public.ronda_purgar_ubicacion(INTEGER)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ronda_turnos_cerrar_vencidos(INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ronda_purgar_ubicacion(INTEGER)       TO service_role;
GRANT EXECUTE ON FUNCTION public.ronda_turnos_cerrar_vencidos(INTEGER) TO service_role;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Que quede dicho en la propia migración qué tiene que ser verdad al terminar,
-- y que falle acá y no en producción si alguna vez deja de serlo.
DO $$
DECLARE abiertas TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO abiertas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) ac
    JOIN pg_roles r ON r.oid = ac.grantee
   WHERE n.nspname = 'public'
     AND p.proname IN ('ronda_purgar_ubicacion', 'ronda_turnos_cerrar_vencidos')
     AND ac.privilege_type = 'EXECUTE'
     AND r.rolname IN ('anon', 'authenticated');
  IF abiertas IS NOT NULL THEN
    RAISE EXCEPTION 'El mantenimiento del rastro sigue abierto a anon/authenticated: %', abiertas;
  END IF;
END $$;

-- =============================================================================
-- FIN
-- =============================================================================
