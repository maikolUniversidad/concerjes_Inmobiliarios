-- =============================================================================
-- PUNTOS QR · F7 (arreglo) · El escaneo de la placa y el KPI «en curso»
-- =============================================================================
-- Dos errores de F7 encontrados PROBANDO las pantallas, no leyendo el código.
-- `20261028001010` ya está aplicada y en producción, así que esto va en archivo
-- nuevo y no editando aquella.
--
-- ── 1) El escaneo de la placa no funcionaba ─────────────────────────────────
-- La placa de un activo (o de un punto) lleva impreso `https://<host>/q/<token>`
-- y debajo el código manual de 8 caracteres. La pantalla le pasaba a la base la
-- URL ENTERA, porque reutilizaba el extractor de la placa de un equipo propio
-- (`/equipo/<ref>`), que es otra cosa. Y `ronda_qr` se busca por token EXACTO.
-- Resultado: el técnico escaneaba una placa buena, recibía «esa placa no está
-- registrada» y quedaba empujado a la apertura MANUAL — justo la distinción que
-- el estado `EN_SITIO` existe para proteger, invertida.
--
-- El arreglo del lado del navegador es `clasificarEscaneoOT()`, que reutiliza
-- `codigoDeEscaneo` de `packages/ronda-core`. Aquí se arregla la otra mitad: la
-- RPC recibe ahora el CÓDIGO (`p_codigo`) y resuelve ella misma el token o el
-- código manual contra `ronda_qr`. Se hace en la base y no en el navegador por
-- dos razones:
--   · el código manual NO es un token: hay que buscarlo por `codigo_manual`, y
--     `ronda_qr_objeto_por_token` solo mira `token`. Dos caminos en el cliente
--     son dos sitios donde equivocarse;
--   · la RPC ya valida el alcance del activo, así que resolver aquí no obliga a
--     que el navegador pueda leer `ronda_qr`.
-- `p_qr` se conserva para quien ya tenga el id resuelto.
--
-- ── 2) El KPI «en curso» podía divergir de su pestaña ───────────────────────
-- `vw_mant_backlog.en_curso` enumeraba los seis estados EN POSITIVO, que es el
-- mismo modo de falla silencioso que F7 vino a cerrar en el frontend: un estado
-- nuevo del enum que nadie clasifique no se cuenta en el KPI, aunque
-- `faseTicket()` sí lo ponga en la pestaña «En curso». Medido: el KPI decía 6 y
-- la pestaña decía 7. `criticos` y `mios` ya estaban en negativo; `en_curso` se
-- pasó. Ahora los tres cuentan por lo que NO son.
-- =============================================================================

-- ── 1) El backlog, contando en negativo ────────────────────────────────────
-- Un estado nuevo del enum entra solo en «en curso» hasta que alguien decida
-- otra cosa, que es el mismo criterio que `FASE_SI_NO_SE_CONOCE` en el
-- frontend: visible y accionable antes que invisible.
DROP VIEW IF EXISTS vw_mant_backlog;
CREATE VIEW vw_mant_backlog WITH (security_invoker = true) AS
SELECT count(*) FILTER (WHERE estado = 'ABIERTO')                                        AS por_recibir,
       -- En negativo: lo que no es ninguno de los otros cuatro es trabajo en
       -- curso. La vista ya filtra los dos estados finales en el WHERE.
       count(*) FILTER (WHERE estado NOT IN ('ABIERTO','RESUELTO','APROBADO_CLIENTE'))    AS en_curso,
       count(*) FILTER (WHERE estado NOT IN ('RESUELTO','APROBADO_CLIENTE')
                          AND prioridad IN ('ALTA','CRITICA'))                           AS criticos,
       count(*) FILTER (WHERE estado = 'RESUELTO')                                       AS por_aprobar,
       count(*) FILTER (WHERE estado = 'APROBADO_CLIENTE')                               AS por_cerrar,
       count(*) FILTER (WHERE estado = 'RESUELTO' AND aprobacion_vence_at IS NOT NULL
                          AND aprobacion_vence_at <= now())                              AS aprobacion_vencida,
       count(*) FILTER (WHERE asignado_a = (SELECT auth.uid())
                          AND estado NOT IN ('RESUELTO','APROBADO_CLIENTE'))             AS mios,
       count(*) FILTER (WHERE sla_respuesta_vence_at IS NOT NULL
                          AND respondido_at IS NULL
                          AND sla_respuesta_vence_at <= now())                           AS sla_respuesta_vencido,
       count(*) FILTER (WHERE sla_solucion_vence_at IS NOT NULL
                          AND resuelto_at IS NULL
                          AND sla_solucion_vence_at <= now())                            AS sla_solucion_vencido
  FROM mantenimiento_tickets
 WHERE estado NOT IN ('CERRADO','CANCELADO');
COMMENT ON VIEW vw_mant_backlog IS
  'El trabajo pendiente, contado en SQL y en NEGATIVO: un estado nuevo del enum que nadie clasifique entra en «en curso» en vez de desaparecer del KPI. Una sola fila; hereda la RLS del ticket.';
GRANT SELECT ON vw_mant_backlog TO authenticated;

-- ── 2) `mant_abrir_visita` resuelve el código de la placa ──────────────────
-- Cambia de firma, así que se BORRA la vieja: `CREATE OR REPLACE` con un
-- parámetro nuevo dejaría una sobrecarga y Supabase, que llama por nombre,
-- fallaría con «could not choose the best candidate function».
DROP FUNCTION IF EXISTS public.mant_abrir_visita(UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.mant_abrir_visita(
  p_ticket             UUID,
  p_visita             UUID,
  p_qr                 UUID        DEFAULT NULL,
  p_lat                DECIMAL     DEFAULT NULL,
  p_lng                DECIMAL     DEFAULT NULL,
  p_precision          DECIMAL     DEFAULT NULL,
  p_motivo_fuera       TEXT        DEFAULT NULL,
  p_apertura_modo      TEXT        DEFAULT 'QR',
  p_plantilla_codigo   TEXT        DEFAULT NULL,
  p_inicio_dispositivo TIMESTAMPTZ DEFAULT NULL,
  -- NUEVO: el código tal como salió de la placa, ya limpio por
  -- `clasificarEscaneoOT()`. Puede ser el token de 21 caracteres o el código
  -- manual de 8. La RPC resuelve cuál es.
  p_codigo             TEXT        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t         mantenimiento_tickets%ROWTYPE;
  v_act     activos%ROWTYPE;
  v_visita  ronda_visitas;
  v_plant   UUID;
  v_codigo  TEXT := NULLIF(upper(btrim(p_plantilla_codigo)), '');
  v_qr      UUID := p_qr;
  v_placa   TEXT := NULLIF(upper(regexp_replace(COALESCE(p_codigo, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_modo    TEXT := upper(COALESCE(p_apertura_modo, 'QR'));
  v_nombre  VARCHAR(200);
  -- ¿La placa se resolvió por el TOKEN del QR o por el código manual impreso
  -- debajo? No da igual: el token lo lee la cámara de la placa y lleva firma;
  -- el manual lo TECLEA una persona, que puede hacerlo desde su casa. Solo el
  -- primero es prueba de que el técnico llegó, y es toda la razón de ser del
  -- estado `EN_SITIO`.
  v_por_token BOOLEAN := false;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF p_visita IS NULL THEN RAISE EXCEPTION 'La visita necesita un id (lo genera el dispositivo).'; END IF;

  SELECT * INTO t FROM mantenimiento_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado.'; END IF;
  IF t.activo_id IS NULL THEN
    RAISE EXCEPTION 'Solo una orden de trabajo sobre un activo del cliente se ejecuta como visita.';
  END IF;
  IF t.estado IN ('CERRADO','CANCELADO') THEN
    RAISE EXCEPTION 'La orden % ya está %.', t.numero, lower(t.estado::text);
  END IF;
  IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento,ejecutar_rondas}'::text[]) THEN
    RAISE EXCEPTION 'No tienes permiso para ejecutar órdenes de trabajo.';
  END IF;
  IF t.asignado_a IS NOT NULL AND t.asignado_a <> (SELECT auth.uid())
     AND NOT public.auth_permiso('gestionar_mantenimiento') THEN
    RAISE EXCEPTION 'Esa orden está asignada a otra persona.';
  END IF;
  IF NOT public.activo_en_alcance(t.activo_id) THEN
    RAISE EXCEPTION 'Ese activo no está en tu alcance.';
  END IF;

  SELECT * INTO v_act FROM activos WHERE id = t.activo_id;
  -- `ronda_visitas.punto_id` es NOT NULL y `activos.punto_id` es nullable: un
  -- activo sin punto de control no puede tener visita hoy. Se dice con claridad
  -- en vez de fallar con un error de restricción.
  IF v_act.punto_id IS NULL THEN
    RAISE EXCEPTION 'El activo % no está asociado a un punto de control, y la visita se abre sobre un punto. Asócialo en su ficha para poder ejecutar la orden en sitio.', v_act.codigo;
  END IF;

  -- El código de la placa → la fila de `ronda_qr`. Token de 21 o manual de 8:
  -- se prueban los dos, porque los dos están impresos en la misma placa, y se
  -- recuerda CUÁL coincidió.
  IF v_qr IS NULL AND v_placa IS NOT NULL THEN
    SELECT q.id, (q.token = v_placa) INTO v_qr, v_por_token
      FROM ronda_qr q
     WHERE q.token = v_placa OR q.codigo_manual = v_placa
     LIMIT 1;
    IF v_qr IS NULL THEN
      RAISE EXCEPTION 'El código % no corresponde a ninguna placa registrada. Si la placa está ilegible, abre la orden como apertura manual y escribe el motivo.', v_placa;
    END IF;
  ELSIF v_qr IS NOT NULL THEN
    -- Quien ya traía el id de la fila lo sacó de leer el QR.
    v_por_token := true;
  END IF;

  -- El QR: si es la placa del activo, se valida aquí y no se pasa a la visita,
  -- porque `ronda_registrar_visita` exige que el QR sea DEL PUNTO.
  IF v_qr IS NOT NULL THEN
    IF NOT public.ronda_qr_vigente(v_qr) THEN
      RAISE EXCEPTION 'El código QR con el que se abrió ya no sirve.';
    END IF;
    IF EXISTS (SELECT 1 FROM ronda_qr q WHERE q.id = v_qr AND q.activo_id = t.activo_id) THEN
      v_qr := NULL;                      -- es del activo: la visita va sin QR de punto
    ELSIF NOT EXISTS (SELECT 1 FROM ronda_qr q WHERE q.id = v_qr AND q.punto_id = v_act.punto_id) THEN
      RAISE EXCEPTION 'Esa placa no es de este activo ni de su punto de control.';
    END IF;
    -- La placa existe y es la correcta, pero el MODO lo decide cómo se leyó:
    -- por el token (cámara, con firma) es un escaneo; por el código manual
    -- (teclado) no, aunque la placa sea buena.
    v_modo := CASE WHEN v_por_token THEN 'QR' ELSE 'MANUAL' END;
  ELSIF v_modo = 'QR' THEN
    -- Sin placa no se puede decir que fue por escaneo.
    v_modo := 'MANUAL';
  END IF;
  IF v_modo = 'MANUAL' AND NULLIF(btrim(p_motivo_fuera), '') IS NULL THEN
    RAISE EXCEPTION 'Si abres la orden sin escanear la placa, escribe por qué (QR ilegible, sin placa…): queda marcado como apertura manual en el informe.';
  END IF;

  -- La tarea: la del parámetro, la primera del plan, o la genérica MANT-OT.
  IF v_codigo IS NULL THEN
    SELECT tr.plantilla_id, upper(tr.plantilla_codigo) INTO v_plant, v_codigo
      FROM mant_plan_tareas tr
     WHERE tr.plan_id = t.plan_id
     ORDER BY tr.orden LIMIT 1;
  END IF;
  IF v_plant IS NULL THEN
    v_plant := public.ronda_plantilla_vigente(COALESCE(v_codigo, 'MANT-OT'), v_act.grupo_id);
  END IF;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'No hay una plantilla de tarea publicada para ejecutar esta orden (se buscó %).', COALESCE(v_codigo, 'MANT-OT');
  END IF;

  v_visita := public.ronda_registrar_visita(
    p_visita, v_act.punto_id, v_plant, NULL, NULL, v_qr,
    CASE WHEN v_modo = 'QR' THEN 'QR' ELSE 'MANUAL' END,
    'APP', p_lat, p_lng, p_precision, p_inicio_dispositivo,
    NULLIF(btrim(p_motivo_fuera), ''), false, NULL, NULL);

  UPDATE ronda_visitas SET ticket_id = t.id WHERE id = v_visita.id;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = (SELECT auth.uid());
  PERFORM set_config('app.mant_ticket', t.id::text, true);

  UPDATE mantenimiento_tickets
     SET visita_id     = v_visita.id,
         en_sitio_at   = COALESCE(en_sitio_at, NOW()),
         en_sitio_modo = COALESCE(en_sitio_modo, v_modo),
         aceptado_at   = COALESCE(aceptado_at, NOW()),
         asignado_a    = COALESCE(asignado_a, (SELECT auth.uid())),
         recibido_por  = COALESCE(recibido_por, (SELECT auth.uid())),
         recibido_at   = COALESCE(recibido_at, NOW()),
         estado = CASE WHEN estado IN ('ABIERTO','RECIBIDO','ACEPTADO','EN_CAMINO')
                       THEN 'EN_SITIO'::estado_ticket_mant ELSE estado END
   WHERE id = t.id;

  PERFORM mant_sistema(t.id,
    'En sitio' || CASE WHEN v_modo = 'QR' THEN ' (placa escaneada)' ELSE ' (apertura manual: ' || btrim(p_motivo_fuera) || ')' END
    || ' · visita ' || v_visita.numero || ' por ' || COALESCE(v_nombre, 'el técnico') || '.');
  PERFORM mant_notificar('MANTENIMIENTO_ESTADO', t.id,
    jsonb_build_object('accion', 'EN_SITIO', 'detalle', 'En sitio', 'visita', v_visita.numero));

  RETURN jsonb_build_object('visita_id', v_visita.id, 'visita_numero', v_visita.numero,
                            'en_sitio_modo', v_modo, 'punto_id', v_act.punto_id,
                            'plantilla_id', v_plant);
END; $$;
COMMENT ON FUNCTION public.mant_abrir_visita(UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) IS
  'Abre la visita de una orden de trabajo con el motor de F4 y deja el ticket EN_SITIO. Resuelve el código de la placa (token de 21 o manual de 8) contra ronda_qr. El modo QR es la garantía de que el técnico llegó; la apertura manual exige motivo y se distingue en el informe.';
GRANT EXECUTE ON FUNCTION public.mant_abrir_visita(UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- Que la API vea la firma nueva y la vista reconstruida.
NOTIFY pgrst, 'reload schema';
