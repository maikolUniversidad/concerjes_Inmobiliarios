-- =============================================================================
-- F8 · El replay del recorrido respeta `comparte_seguimiento_vivo`
-- =============================================================================
-- ARREGLA UN HUECO DE 20261028000800, QUE YA ESTÁ EN PRODUCCIÓN.
--
-- Qué estaba mal. La política RLS de `persona_ubicacion_historial` exige tres
-- cosas para leer el rastro de otra persona: el permiso, el alcance de contrato
-- y que el CONTRATO permita el seguimiento (`comparte_seguimiento_vivo`). Pero
-- las dos funciones del replay —`ronda_recorrido()` y
-- `ronda_turnos_recorribles()`— son `SECURITY DEFINER`, así que se ejecutan como
-- dueño de la tabla y la RLS no se les aplica; y por dentro solo comprobaban
-- `ronda_recorrido_acceso() AND auth_ve_grupo(...)`. **La tercera condición no
-- estaba.**
--
-- Consecuencia: un contrato que apagaba el seguimiento dejaba de mostrar el mapa
-- en vivo (eso sí pasa por `ronda_ubicacion_puede_ver()`, que lo comprueba
-- bien) pero su rastro PASADO seguía reproduciéndose. Es justo lo contrario de
-- lo que promete el comentario de `ronda_ubicacion_puede_ver()`: «revocar
-- `comparte_seguimiento_vivo` apaga la lectura en el acto sin borrar una sola
-- fila — que es lo que un contrato que retira el consentimiento necesita».
-- Un contrato que retira el consentimiento tiene derecho a que se apague TODO,
-- no solo lo de hoy.
--
-- Qué hace este archivo:
--   1. Saca el flag a su propia función, `ronda_seguimiento_activo()`, para que
--      exista UNA sola definición de «este contrato permite el seguimiento» y
--      no tres copias del mismo `COALESCE` repartidas por el esquema.
--   2. Reescribe `ronda_ubicacion_puede_ver()` sobre ella. Mismo resultado que
--      antes: esta función ya estaba bien y no cambia de comportamiento.
--   3. Añade `ronda_recorrido_puede_ver()`, su hermana para el rastro. NO se
--      puede reutilizar `ronda_ubicacion_puede_ver()` para el replay: esa pide
--      `ronda_mapa_acceso()`, que es «mapa O recorrido», y usarla aquí dejaría
--      reproducir el rastro a quien solo tiene `ver_mapa_operativo`. Eso
--      ABRIRÍA el permiso en vez de cerrar el hueco. Son dos claves distintas a
--      propósito y siguen siéndolo.
--   4. Vuelve a crear las dos funciones del replay con la comprobación puesta.
--   5. Reescribe las dos políticas de ubicación para que el flag lo pregunten
--      llamando a esa única función en vez de llevar el `COALESCE` copiado, que
--      es cómo la RLS y las RPC pudieron separarse. Las dos dicen lo mismo que
--      antes: la del historial ya exigía el flag y la de la posición actual
--      también.
--
-- Lo que NO cambia, y hay que verificarlo en las dos direcciones porque esto es
-- código en producción:
--   · un contrato con el seguimiento ENCENDIDO sigue reproduciendo su rastro
--     igual que antes;
--   · el MAPA EN VIVO de quien tiene `ver_mapa_operativo` no se toca: va por
--     `ronda_mapa_personas()` y `ronda_ubicacion_puede_ver()`, que ya
--     comprobaban el flag y siguen haciendo exactamente lo mismo;
--   · lo propio se sigue viendo siempre, sin permiso y sin flag (Ley 1581). La
--     cláusula de la política no se toca.
--
-- Orden de aplicación: este archivo se aplicó ANTES que 20261028000810 (el
-- reparto del permiso), para no repartir una clave sobre una función con el
-- hueco abierto. El número es posterior y no importa: los dos archivos tocan
-- objetos disjuntos —este, funciones y una política; el otro, `roles.permisos`—
-- así que en una base nueva el orden del nombre da el mismo resultado.
--
-- Idempotente: `CREATE OR REPLACE` y `DROP POLICY IF EXISTS`. No crea ni altera
-- ninguna tabla ni ninguna columna.
-- =============================================================================

-- ── 0. Dependencias ─────────────────────────────────────────────────────────
DO $$
DECLARE faltan TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF to_regclass('public.persona_ubicacion_historial') IS NULL THEN faltan := faltan || 'persona_ubicacion_historial (F8)'; END IF;
  IF to_regclass('public.ronda_turnos')                IS NULL THEN faltan := faltan || 'ronda_turnos (F8)'; END IF;
  IF to_regclass('public.grupo_reglas')                IS NULL THEN faltan := faltan || 'grupo_reglas (F1)'; END IF;
  IF to_regproc('public.ronda_recorrido_acceso')       IS NULL THEN faltan := faltan || 'ronda_recorrido_acceso() (F8)'; END IF;
  IF to_regproc('public.auth_ve_grupo')                IS NULL THEN faltan := faltan || 'auth_ve_grupo() (F1)'; END IF;
  IF array_length(faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Falta aplicar antes: %', array_to_string(faltan, ', ');
  END IF;
END $$;

-- ── 1. El flag, en un solo sitio ────────────────────────────────────────────
-- `COALESCE(..., false)`: un contrato SIN fila en `grupo_reglas` NO permite el
-- seguimiento. Que es como está hoy la base entera, y es el valor correcto por
-- defecto para un dato de este tipo.
CREATE OR REPLACE FUNCTION public.ronda_seguimiento_activo(p_grupo UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT r.comparte_seguimiento_vivo FROM public.grupo_reglas r
                    WHERE r.grupo_id = p_grupo), false)
$$;
COMMENT ON FUNCTION public.ronda_seguimiento_activo(UUID) IS
  'TRUE si ese contrato permite el seguimiento de ubicación. Un contrato sin fila en grupo_reglas NO lo permite. Es la ÚNICA definición de esta condición: la usan el mapa en vivo, el replay del recorrido y la RLS del historial.';
GRANT EXECUTE ON FUNCTION public.ronda_seguimiento_activo(UUID) TO authenticated;

-- ── 2. El mapa en vivo, reescrito sobre la función nueva ────────────────────
-- Mismo comportamiento que antes, carácter por carácter: permiso + alcance +
-- flag. Se reescribe solo para que el flag deje de estar copiado aquí.
CREATE OR REPLACE FUNCTION public.ronda_ubicacion_puede_ver(p_grupo UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_mapa_acceso()
     AND public.auth_ve_grupo(p_grupo)
     AND public.ronda_seguimiento_activo(p_grupo)
$$;
COMMENT ON FUNCTION public.ronda_ubicacion_puede_ver(UUID) IS
  'TRUE si el usuario puede leer la POSICIÓN de las personas de ese contrato: permiso de mapa (o de recorrido) + alcance + el contrato permitiéndolo. Apagar comparte_seguimiento_vivo apaga la lectura sin borrar ninguna fila.';
GRANT EXECUTE ON FUNCTION public.ronda_ubicacion_puede_ver(UUID) TO authenticated;

-- ── 3. La hermana para el RASTRO ────────────────────────────────────────────
-- Igual que la de arriba pero con `ronda_recorrido_acceso()` en lugar de
-- `ronda_mapa_acceso()`: el rastro pide su propia clave y no la del mapa.
CREATE OR REPLACE FUNCTION public.ronda_recorrido_puede_ver(p_grupo UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_recorrido_acceso()
     AND public.auth_ve_grupo(p_grupo)
     AND public.ronda_seguimiento_activo(p_grupo)
$$;
COMMENT ON FUNCTION public.ronda_recorrido_puede_ver(UUID) IS
  'TRUE si el usuario puede reproducir el RASTRO de las personas de ese contrato: ver_recorrido_personas + alcance + el contrato permitiéndolo. No vale ver_mapa_operativo: reconstruir los pasos de alguien no es ver el mapa del día (§10.3).';
GRANT EXECUTE ON FUNCTION public.ronda_recorrido_puede_ver(UUID) TO authenticated;

-- ── 4. El replay de un turno, con la comprobación puesta ────────────────────
-- Igual que en 20261028000800 salvo el bloque de comprobación. El orden de las
-- dos comprobaciones importa: primero el permiso y el alcance, y solo después
-- el flag. Al revés, el mensaje de «ese contrato tiene el seguimiento apagado»
-- le contaría la configuración del contrato a quien no tiene nada que ver con
-- él.
CREATE OR REPLACE FUNCTION public.ronda_recorrido(
  p_turno      UUID,
  p_max_puntos INT DEFAULT 500
) RETURNS TABLE (
  orden                 INT,
  lat                   DECIMAL,
  lng                   DECIMAL,
  precision_metros      DECIMAL,
  velocidad_kmh         DECIMAL,
  fuente                TEXT,
  capturado_at          TIMESTAMPTZ,
  metros_desde_anterior DECIMAL,
  punto_id              UUID,
  punto_nombre          TEXT,
  visita_id             UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grupo UUID;
  v_total INT;
  v_paso  INT;
  v_max   INT := GREATEST(10, LEAST(COALESCE(p_max_puntos, 500), 5000));
BEGIN
  SELECT t.grupo_id INTO v_grupo FROM public.ronda_turnos t WHERE t.id = p_turno;
  IF v_grupo IS NULL THEN RAISE EXCEPTION 'El turno no existe.'; END IF;

  IF NOT (public.ronda_recorrido_acceso() AND public.auth_ve_grupo(v_grupo)) THEN
    RAISE EXCEPTION 'No tienes permiso para ver el recorrido de ese turno.';
  END IF;
  -- La tercera condición, que es la que faltaba. Mensaje aparte del de permiso
  -- porque son dos cosas distintas y quien atiende el soporte tiene que poder
  -- distinguirlas: aquí no falta un permiso, el contrato retiró el seguimiento.
  IF NOT public.ronda_seguimiento_activo(v_grupo) THEN
    RAISE EXCEPTION 'El seguimiento de ubicación está desactivado en ese contrato: su rastro no se puede reproducir.';
  END IF;

  -- El conteo va por el contador del turno, no por un COUNT(*) del historial.
  SELECT t.puntos_registrados INTO v_total FROM public.ronda_turnos t WHERE t.id = p_turno;
  v_paso := GREATEST(1, ceil(COALESCE(v_total, 0)::numeric / v_max)::int);

  RETURN QUERY
  WITH numeradas AS (
    SELECT h.*, row_number() OVER (ORDER BY h.capturado_at, h.id) AS n,
           count(*) OVER () AS total
      FROM public.persona_ubicacion_historial h
     WHERE h.turno_id = p_turno
  )
  SELECT n.n::int, n.lat, n.lng, n.precision_metros, n.velocidad_kmh,
         n.fuente::text, n.capturado_at, n.metros_desde_anterior,
         n.punto_id, pt.nombre::text, n.visita_id
    FROM numeradas n
    LEFT JOIN public.ronda_puntos pt ON pt.id = n.punto_id
   -- El primero y el último SIEMPRE: un recorrido que empieza en el punto 7
   -- dibuja una línea que no sale de donde la persona empezó.
   WHERE n.n = 1 OR n.n = n.total OR (n.n % v_paso) = 0 OR n.punto_id IS NOT NULL
   ORDER BY n.capturado_at, n.n;
END $$;
COMMENT ON FUNCTION public.ronda_recorrido(UUID, INT) IS
  'El recorrido de UN turno para el replay, diezmado en SQL al tope pedido conservando el primero, el último y todo registro hecho en un punto de control. Exige las TRES condiciones de ronda_recorrido_puede_ver(): ver_recorrido_personas, alcance de contrato y que el contrato permita el seguimiento.';
REVOKE ALL ON FUNCTION public.ronda_recorrido(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_recorrido(UUID, INT) TO authenticated;

-- ── 5. El selector de turnos del replay ─────────────────────────────────────
-- Aquí la comprobación va desarmada a propósito y no como
-- `ronda_recorrido_puede_ver(t.grupo_id)`: el permiso se evalúa UNA vez para
-- toda la consulta y solo el flag se mira por fila, que es un acierto por clave
-- primaria en `grupo_reglas`. Metida entera en la función, la comprobación del
-- permiso se repetiría por cada turno, que es el patrón que la migración
-- 20261028000001 tuvo que venir a arreglar en las políticas (229 ms → 1,8 ms).
CREATE OR REPLACE FUNCTION public.ronda_turnos_recorribles(
  p_grupo  UUID DEFAULT NULL,
  p_sede   UUID DEFAULT NULL,
  p_desde  DATE DEFAULT NULL,
  p_hasta  DATE DEFAULT NULL,
  p_limite INT  DEFAULT 100
) RETURNS TABLE (
  turno_id           UUID,
  persona_id         UUID,
  persona_nombre     TEXT,
  grupo_id           UUID,
  sede_id            UUID,
  sede_nombre        TEXT,
  inicio_at          TIMESTAMPTZ,
  fin_at             TIMESTAMPTZ,
  fin_previsto_at    TIMESTAMPTZ,
  estado             TEXT,
  puntos_registrados INT,
  metros_recorridos  DECIMAL,
  ruta_codigo        TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.persona_id,
         btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, '')),
         t.grupo_id, t.sede_id, s.nombre::text,
         t.inicio_at, t.fin_at, t.fin_previsto_at, t.estado::text,
         t.puntos_registrados, t.metros_recorridos, r.codigo::text
    FROM public.ronda_turnos t
    JOIN public.personas pe ON pe.id = t.persona_id
    LEFT JOIN public.sedes s ON s.id = t.sede_id
    LEFT JOIN public.ronda_rutas r ON r.turno_id = t.id
   WHERE (SELECT public.ronda_recorrido_acceso())
     AND t.grupo_id IN (SELECT public.auth_grupos())
     AND public.ronda_seguimiento_activo(t.grupo_id)
     AND t.puntos_registrados > 0
     AND (p_grupo IS NULL OR t.grupo_id = p_grupo)
     AND (p_sede  IS NULL OR t.sede_id  = p_sede)
     AND (p_desde IS NULL OR t.inicio_at >= p_desde::timestamptz)
     AND (p_hasta IS NULL OR t.inicio_at < (p_hasta + 1)::timestamptz)
   ORDER BY t.inicio_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 100), 500))
$$;
COMMENT ON FUNCTION public.ronda_turnos_recorribles(UUID, UUID, DATE, DATE, INT) IS
  'Turnos con rastro que se pueden reproducir, con su resumen ya calculado (puntos y metros vienen del turno, no de un COUNT sobre el historial). Solo de contratos que permiten el seguimiento. Con tope de filas: el selector del replay nunca pide «todos».';
GRANT EXECUTE ON FUNCTION public.ronda_turnos_recorribles(UUID, UUID, DATE, DATE, INT) TO authenticated;

-- ── 6. Las dos políticas de ubicación, sobre la misma función del flag ──────
-- Antes cada una llevaba el `COALESCE` del flag escrito a mano. Ahora las dos
-- llaman a `ronda_seguimiento_activo()`, así que la condición del contrato está
-- definida en un solo sitio para la RLS y para las RPC, y no pueden volver a
-- separarse — que es exactamente cómo apareció este hueco.
--
-- Por qué aquí la comprobación va desarmada y no como una sola llamada a
-- `ronda_recorrido_puede_ver(grupo_id)`: un `(SELECT f(columna))` NO se puede
-- sacar del bucle de filas, porque depende de la fila, así que meter el permiso
-- dentro de esa llamada lo haría evaluarse una vez por fila. Es el patrón que
-- la migración 20261028000001 tuvo que venir a arreglar en todas las políticas
-- (229 ms → 1,8 ms). Así: el permiso en un `(SELECT …)` sin columnas, que el
-- planificador evalúa una sola vez, y por fila solo el flag, que es un acierto
-- por clave primaria en `grupo_reglas`.
DROP POLICY IF EXISTS persona_ubicacion_historial_read ON persona_ubicacion_historial;
CREATE POLICY persona_ubicacion_historial_read ON persona_ubicacion_historial
  FOR SELECT TO authenticated
  USING (
    -- El RASTRO pide la clave del recorrido, no la del mapa: son dos cosas
    -- distintas (§10.3) y por eso aquí no vale `ver_mapa_operativo`.
    ((SELECT public.ronda_recorrido_acceso())
      AND grupo_id IN (SELECT public.auth_grupos())
      AND public.ronda_seguimiento_activo(grupo_id))
    -- Lo propio siempre se ve: sin permiso, sin alcance y sin flag. Una persona
    -- tiene derecho a ver qué se registró de ella (Ley 1581), y que el contrato
    -- retire el seguimiento no le quita ese derecho sobre lo ya registrado.
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- La de la posición actual dice LO MISMO que antes; solo se desarma igual, para
-- que las dos políticas de ubicación se lean igual y nadie copie la forma
-- equivocada. El mapa en vivo no cambia de comportamiento.
DROP POLICY IF EXISTS persona_ubicacion_actual_read ON persona_ubicacion_actual;
CREATE POLICY persona_ubicacion_actual_read ON persona_ubicacion_actual
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.ronda_mapa_acceso())
      AND grupo_id IN (SELECT public.auth_grupos())
      AND public.ronda_seguimiento_activo(grupo_id))
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- =============================================================================
-- FIN
-- =============================================================================
