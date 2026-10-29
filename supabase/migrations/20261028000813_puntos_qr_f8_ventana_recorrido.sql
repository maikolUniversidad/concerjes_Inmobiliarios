-- =============================================================================
-- F8 · El replay del recorrido tiene ventana hacia atrás
-- =============================================================================
-- Última de las tres cosas que la propuesta de reparto (§6) pedía hacer antes
-- de que `ver_recorrido_personas` estuviera en manos de alguien. Las otras dos
-- ya entraron: el replay respeta `comparte_seguimiento_vivo` (20261028000811) y
-- la purga corre sola cada hora (20261028000812).
--
-- QUÉ ESTABA MAL. `ronda_turnos_recorribles(p_desde, p_hasta)` aceptaba
-- cualquier rango hacia atrás, sin tope. Pedir «todo el último trimestre de esta
-- persona» costaba exactamente lo mismo que pedir «lo de ayer». Mientras la
-- purga no existía eso era, además, una ventana sin fondo.
--
-- Investigar lo de ayer o lo de la semana pasada es supervisión: alguien
-- reclama que no se hizo una ronda y hay que mirar. Reconstruir los tres meses
-- completos de una persona es otra cosa, y no debería costar lo mismo ni pasar
-- inadvertido. La ventana no lo prohíbe: lo vuelve una decisión del contrato,
-- escrita donde se ven las demás reglas, en vez de un parámetro que cualquiera
-- estira desde el cliente.
--
-- POR CONTRATO Y NO GLOBAL, como la retención y como todo lo demás de F8: un
-- contrato con obligación contractual de conservar y revisar más atrás pone el
-- número que necesite. Por omisión **30 días**.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA, a propósito:
--   · El rastro PROPIO. Las dos funciones ya exigen `ver_recorrido_personas`,
--     así que una persona nunca llegó a ellas: lo suyo lo ve por la política de
--     la tabla («lo propio siempre se ve», Ley 1581), que no pasa por aquí. La
--     ventana acota la herramienta de supervisión, no el derecho de acceso de
--     nadie a sus propios datos.
--   · La retención. Son dos cosas distintas y conviene no confundirlas: la
--     retención dice cuánto se GUARDA, la ventana cuánto se puede MIRAR de una
--     vez. Una ventana mayor que la retención no es un error —no habrá nada que
--     mostrar más atrás— y por eso no se comprueba una contra la otra.
-- =============================================================================

-- ── 1. El número, por contrato ──────────────────────────────────────────────
ALTER TABLE public.grupo_reglas
  ADD COLUMN IF NOT EXISTS recorrido_ventana_dias INTEGER NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grupo_reglas_recorrido_ventana_dias_ck') THEN
    ALTER TABLE public.grupo_reglas
      ADD CONSTRAINT grupo_reglas_recorrido_ventana_dias_ck
      CHECK (recorrido_ventana_dias BETWEEN 1 AND 3650);
  END IF;
END $$;

COMMENT ON COLUMN public.grupo_reglas.recorrido_ventana_dias IS
  'Cuántos días hacia atrás se puede reproducir el recorrido de una persona en este contrato. No es la retención (cuánto se guarda), es cuánto se puede mirar de una vez.';

-- ── 2. Una sola definición de «cuánto se puede mirar» ───────────────────────
-- Igual que `ronda_retencion_ubicacion_meses()`: el COALESCE del valor por
-- omisión vive en UN sitio. Tres copias del mismo COALESCE repartidas por el
-- esquema es exactamente cómo la RLS y las RPC se separaron la vez anterior.
CREATE OR REPLACE FUNCTION public.ronda_recorrido_ventana_dias(p_grupo UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT r.recorrido_ventana_dias FROM public.grupo_reglas r
                    WHERE r.grupo_id = p_grupo), 30)
$$;

REVOKE ALL ON FUNCTION public.ronda_recorrido_ventana_dias(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_recorrido_ventana_dias(UUID) TO authenticated, service_role;

-- ── 3. El selector del replay deja de mirar más atrás de la ventana ─────────
-- La condición va POR FILA con `t.grupo_id` y no con `p_grupo`: el selector se
-- puede pedir sin contrato (p_grupo NULL) y entonces mezcla turnos de varios,
-- cada uno con su propia ventana. Un tope calculado una sola vez con el
-- contrato del filtro sería el tope equivocado para todas las demás filas.
CREATE OR REPLACE FUNCTION public.ronda_turnos_recorribles(
  p_grupo UUID DEFAULT NULL, p_sede UUID DEFAULT NULL,
  p_desde DATE DEFAULT NULL, p_hasta DATE DEFAULT NULL, p_limite INTEGER DEFAULT 100)
RETURNS TABLE(turno_id UUID, persona_id UUID, persona_nombre TEXT, grupo_id UUID,
              sede_id UUID, sede_nombre TEXT, inicio_at TIMESTAMPTZ, fin_at TIMESTAMPTZ,
              fin_previsto_at TIMESTAMPTZ, estado TEXT, puntos_registrados INTEGER,
              metros_recorridos NUMERIC, ruta_codigo TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
     AND t.inicio_at >= now() - make_interval(days => public.ronda_recorrido_ventana_dias(t.grupo_id))
     AND t.puntos_registrados > 0
     AND (p_grupo IS NULL OR t.grupo_id = p_grupo)
     AND (p_sede  IS NULL OR t.sede_id  = p_sede)
     AND (p_desde IS NULL OR t.inicio_at >= p_desde::timestamptz)
     AND (p_hasta IS NULL OR t.inicio_at < (p_hasta + 1)::timestamptz)
   ORDER BY t.inicio_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 100), 500))
$$;

-- ── 4. Y el replay en sí, o la ventana sería solo un filtro de la lista ─────
-- Sin esto, basta con guardarse el id de un turno viejo para reproducirlo
-- igual: el selector lo escondería y la función lo serviría. El mensaje es
-- propio y no se mezcla con el de permiso ni con el del contrato apagado —son
-- tres razones distintas y quien atiende soporte tiene que poder separarlas.
CREATE OR REPLACE FUNCTION public.ronda_recorrido(p_turno UUID, p_max_puntos INTEGER DEFAULT 500)
RETURNS TABLE(orden INTEGER, lat NUMERIC, lng NUMERIC, precision_metros NUMERIC,
              velocidad_kmh NUMERIC, fuente TEXT, capturado_at TIMESTAMPTZ,
              metros_desde_anterior NUMERIC, punto_id UUID, punto_nombre TEXT, visita_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grupo  UUID;
  v_inicio TIMESTAMPTZ;
  v_dias   INT;
  v_total  INT;
  v_paso   INT;
  v_max    INT := GREATEST(10, LEAST(COALESCE(p_max_puntos, 500), 5000));
BEGIN
  SELECT t.grupo_id, t.inicio_at INTO v_grupo, v_inicio
    FROM public.ronda_turnos t WHERE t.id = p_turno;
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

  v_dias := public.ronda_recorrido_ventana_dias(v_grupo);
  IF v_inicio < now() - make_interval(days => v_dias) THEN
    RAISE EXCEPTION 'Ese turno quedó fuera de la ventana de % días que este contrato permite reproducir.', v_dias;
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

-- ── 5. Comprobación ─────────────────────────────────────────────────────────
DO $$
DECLARE v_falta TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'grupo_reglas' AND column_name = 'recorrido_ventana_dias') THEN
    v_falta := v_falta || ' la columna;';
  END IF;
  IF public.ronda_recorrido_ventana_dias(gen_random_uuid()) <> 30 THEN
    v_falta := v_falta || ' el valor por omisión de 30 días;';
  END IF;
  -- Que la ventana esté DE VERDAD en el selector y no solo en el replay.
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'ronda_turnos_recorribles')
       NOT LIKE '%ronda_recorrido_ventana_dias%' THEN
    v_falta := v_falta || ' la ventana en el selector;';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'ronda_recorrido')
       NOT LIKE '%ronda_recorrido_ventana_dias%' THEN
    v_falta := v_falta || ' la ventana en el replay;';
  END IF;
  IF v_falta <> '' THEN
    RAISE EXCEPTION 'Falta:%', v_falta;
  END IF;
END $$;

-- =============================================================================
-- FIN
-- =============================================================================
