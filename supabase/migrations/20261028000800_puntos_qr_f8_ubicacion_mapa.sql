-- =============================================================================
-- PUNTOS QR — F8: UBICACIÓN Y MAPA OPERATIVO
-- =============================================================================
-- Octava migración del módulo (F1 contrato, F2 puntos y QR, F3 catálogo,
-- F4 ejecución). Con esta, un supervisor abre un mapa y ve dónde está cada
-- quien, qué ruta tiene asignada y puede reproducir el recorrido de un turno
-- que ya pasó.
--
-- Plan: docs/puntos-qr-whatsapp/02-complemento-2-integracion.md §4.3 («Mapa
-- operativo», con R1 y R2, que son los dos requisitos NO NEGOCIABLES de esta
-- fase), §2.4 (qué columna de alcance lleva cada tabla), §5 (las cuatro tablas
-- de esta fase), §6 (la fila F8 depende de F4) y §10.3 (lo legal);
-- docs/puntos-qr-whatsapp/00-exploracion-y-plan.md Parte 4 (Ley 1581 de 2012,
-- finalidad y minimización) y §2.5 (persona_consentimientos);
-- y docs/puntos-qr-whatsapp/03-nomenclatura.md, que manda en los nombres.
--
-- Qué entra:
--   1. `ronda_turnos` — el turno abierto. NO estaba en la lista de la fase y
--      hace falta: R1 dice «fuera del turno no se registra ni se muestra», y en
--      el repositorio NO existe ninguna tabla de turno por persona. La
--      programación (`puestos`, `turno_patrones`) describe la COBERTURA que el
--      cliente compró, no quién está dentro de su turno ahora mismo. Sin esta
--      tabla, R1 no tiene contra qué preguntar y se quedaría en una regla de
--      interfaz, que es exactamente lo que el documento prohíbe.
--   2. `persona_ubicacion_actual` — una fila por persona, con realtime, para el
--      «en vivo». Calcada de `conductor_ubicacion_actual` (§3 del complemento).
--   3. `persona_ubicacion_historial` — append, para el recorrido del turno.
--   4. `ronda_rutas` y `ronda_ruta_paradas` — la ruta del turno y sus paradas en
--      orden, calcadas de `rutas_entrega` / `ruta_paradas`.
--   5. Las RPC: `ronda_turno_abrir`, `ronda_turno_cerrar`,
--      `ronda_registrar_ubicacion` (la que cumple R1), `ronda_mapa_personas`
--      (la que cumple R2), `ronda_recorrido`, `ronda_proxima_parada` (el gancho
--      que F10 necesita) y las dos tareas del cron.
--   6. Cuatro parámetros nuevos en `grupo_reglas` (frescura, intervalo,
--      retención de ubicación y visibilidad para el cliente) y el tipo de
--      consentimiento `SEGUIMIENTO`.
--
-- Qué NO entra, a propósito:
--   · Polígonos de sede y planos por piso. Dependen del levantamiento 2D/3D que
--     §3.1 da por existente y que NO existe en el repositorio (pendiente §10.1
--     nº 3). El mapa dibuja la sede como punto con radio, que es lo que los
--     datos de hoy permiten.
--   · Seguimiento continuo en segundo plano. Eso solo lo da la app nativa
--     (§1.1); la PWA reporta mientras la pantalla está abierta. El valor
--     `APP_NATIVA` de `fuente` queda previsto y sin productor.
--   · La ubicación por WhatsApp. El valor `WHATSAPP` queda previsto; quien lo
--     escribe es F9/F10.
--
-- LAS DOS DECISIONES DE DISEÑO QUE ESTA FASE NO PODÍA DEJAR ABIERTAS
--
-- A) VOLUMEN. El historial de ubicación es la tabla que más rápido crece de
--    todo el módulo. Tres frenos, y ninguno es opcional:
--      · intervalo mínimo entre registros (`grupo_reglas.ubicacion_intervalo_seg`,
--        120 s por defecto): un punto que llega antes se IGNORA sin insertar.
--        Eso acota el historial a ~240 filas por persona y turno de 8 horas;
--      · tope duro de `ubicacion_max_puntos_turno` (1.000) por turno: a partir
--        de ahí se ignora. Un bucle en el cliente no puede llenar la tabla;
--      · retención propia y más corta que la de la evidencia (ver B).
--    Y el mapa NUNCA lee el historial: lee `persona_ubicacion_actual`, que
--    tiene una fila por persona. El recorrido lee UN turno, con tope de puntos
--    y diezmado en SQL. Supabase corta a los 8 s: contar o traer el historial
--    entero es justo lo que haría saltar ese corte.
--
-- B) RETENCIÓN. §1.3 fijó 12 meses como PARÁMETRO para la evidencia y dijo que
--    aplica también a `persona_ubicacion_historial`. Aquí se respeta que sea un
--    parámetro y se le da **columna propia con un valor por defecto más corto:
--    3 meses** (`grupo_reglas.retencion_ubicacion_meses`, ajustable de 1 a 120,
--    así que un contrato que necesite 12 los pone). El motivo es el criterio de
--    minimización de la Parte 4 del documento 00 y la proporcionalidad que pide
--    §3.2: la miga de pan de por dónde caminó una persona es el dato más
--    sensible del módulo y el que menos se necesita a largo plazo.
--    Lo que SÍ se conserva 12 meses es la PRUEBA de presencia, que no está
--    aquí: es la coordenada de apertura y cierre de la visita, que vive en
--    `ronda_visitas` y la rige `retencion_evidencia_meses` (F4).
--    Y para que purgar el rastro no borre la historia operativa, cada turno
--    guarda su RESUMEN (primer y último punto, metros recorridos, nº de
--    registros): eso sobrevive a la purga y es lo que un informe necesita.
--
-- Idempotente: se puede correr dos veces seguidas. Verificada con
-- scripts/probar-puntos-qr-f8.mjs.
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. Dependencias
-- ──────────────────────────────────────────────────────────────────────────────
-- F8 depende de F4 (§6): cuelga de `personas`, `ronda_puntos`, `ronda_visitas`,
-- `persona_consentimientos`, `ronda_sesiones`, `grupo_reglas` y `auth_grupos()`.
-- Mejor un mensaje claro que un `relation does not exist` a mitad del archivo.
DO $$
DECLARE faltan TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF to_regclass('public.grupos_contrato')          IS NULL THEN faltan := faltan || 'grupos_contrato'; END IF;
  IF to_regclass('public.grupo_reglas')             IS NULL THEN faltan := faltan || 'grupo_reglas (F1)'; END IF;
  IF to_regclass('public.ronda_puntos')             IS NULL THEN faltan := faltan || 'ronda_puntos (F2)'; END IF;
  IF to_regclass('public.ronda_eventos')            IS NULL THEN faltan := faltan || 'ronda_eventos (F2)'; END IF;
  IF to_regclass('public.ronda_visitas')            IS NULL THEN faltan := faltan || 'ronda_visitas (F4)'; END IF;
  IF to_regclass('public.ronda_sesiones')           IS NULL THEN faltan := faltan || 'ronda_sesiones (F4)'; END IF;
  IF to_regclass('public.persona_consentimientos')  IS NULL THEN faltan := faltan || 'persona_consentimientos (F4)'; END IF;
  IF to_regproc('public.auth_grupos')               IS NULL THEN faltan := faltan || 'auth_grupos() (F1)'; END IF;
  IF to_regproc('public.ronda_distancia_m')         IS NULL THEN faltan := faltan || 'ronda_distancia_m() (F4)'; END IF;
  IF array_length(faltan, 1) > 0 THEN
    RAISE EXCEPTION 'F8 necesita F1, F2 y F4 aplicadas. Falta: %', array_to_string(faltan, ', ');
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Parámetros del contrato que esta fase necesita
-- ──────────────────────────────────────────────────────────────────────────────
-- Aditivo sobre `grupo_reglas` (F1), que ya es la tabla de reglas por contrato
-- y ya trae `comparte_seguimiento_vivo` y `retencion_evidencia_meses`.
--
-- `comparte_seguimiento_vivo` es el INTERRUPTOR DE REGISTRO, y no es una
-- reinterpretación: R1 lo dice literalmente — «`grupo_reglas` tiene que
-- permitir el seguimiento en vivo para que la RPC acepte; si el contrato no lo
-- permite, tampoco se registra». Por defecto es `false`, así que un contrato
-- recién creado NO rastrea a nadie hasta que alguien lo encienda a propósito.
--
-- Que el CLIENTE pueda ver esa posición es otra cosa y va en otra columna
-- (`ubicacion_visible_cliente`): el §9 del complemento pide una política que
-- «oculte la ubicación de personas salvo que `grupo_reglas` lo permita», y
-- mezclar las dos cosas en un flag significaría que encender el registro
-- para operar se lo enseña al cliente de regalo.
ALTER TABLE grupo_reglas ADD COLUMN IF NOT EXISTS ubicacion_frescura_seg INT NOT NULL DEFAULT 300;
ALTER TABLE grupo_reglas ADD COLUMN IF NOT EXISTS ubicacion_intervalo_seg INT NOT NULL DEFAULT 120;
ALTER TABLE grupo_reglas ADD COLUMN IF NOT EXISTS ubicacion_max_puntos_turno INT NOT NULL DEFAULT 1000;
ALTER TABLE grupo_reglas ADD COLUMN IF NOT EXISTS retencion_ubicacion_meses INT NOT NULL DEFAULT 3;
ALTER TABLE grupo_reglas ADD COLUMN IF NOT EXISTS ubicacion_visible_cliente BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE grupo_reglas ADD COLUMN IF NOT EXISTS turno_duracion_max_horas INT NOT NULL DEFAULT 12;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grupo_reglas_frescura') THEN
    ALTER TABLE grupo_reglas ADD CONSTRAINT ck_grupo_reglas_frescura
      CHECK (ubicacion_frescura_seg BETWEEN 30 AND 3600);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grupo_reglas_intervalo') THEN
    ALTER TABLE grupo_reglas ADD CONSTRAINT ck_grupo_reglas_intervalo
      CHECK (ubicacion_intervalo_seg BETWEEN 15 AND 3600);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grupo_reglas_max_puntos') THEN
    ALTER TABLE grupo_reglas ADD CONSTRAINT ck_grupo_reglas_max_puntos
      CHECK (ubicacion_max_puntos_turno BETWEEN 10 AND 20000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grupo_reglas_retencion_ubic') THEN
    ALTER TABLE grupo_reglas ADD CONSTRAINT ck_grupo_reglas_retencion_ubic
      CHECK (retencion_ubicacion_meses BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grupo_reglas_turno_max') THEN
    ALTER TABLE grupo_reglas ADD CONSTRAINT ck_grupo_reglas_turno_max
      CHECK (turno_duracion_max_horas BETWEEN 1 AND 24);
  END IF;
END $$;

COMMENT ON COLUMN grupo_reglas.ubicacion_frescura_seg IS
  'Segundos tras los cuales una posición deja de ser «en vivo» y el mapa la dibuja como «último registro» (R2). 300 s por defecto, que es los 5 minutos propuestos en el pendiente §10.1 nº 6. Es un parámetro del contrato, nunca una constante del código.';
COMMENT ON COLUMN grupo_reglas.ubicacion_intervalo_seg IS
  'Intervalo mínimo entre dos registros de ubicación de la misma persona en el mismo turno. Un punto que llega antes se IGNORA sin insertar: es el freno principal al crecimiento del historial.';
COMMENT ON COLUMN grupo_reglas.ubicacion_max_puntos_turno IS
  'Tope duro de registros por turno. Pasado el tope se ignora: un bucle en el cliente no puede llenar la tabla.';
COMMENT ON COLUMN grupo_reglas.retencion_ubicacion_meses IS
  'Meses que se conserva el RASTRO de ubicación (persona_ubicacion_historial). 3 por defecto, más corto que los 12 de la evidencia a propósito: es el dato más sensible del módulo y el que menos se necesita a largo plazo (minimización, Ley 1581 de 2012 y la proporcionalidad de §3.2). Subirlo a 12 es cambiar este número. La PRUEBA de presencia no está aquí: es la coordenada de la visita, que rige retencion_evidencia_meses.';
COMMENT ON COLUMN grupo_reglas.ubicacion_visible_cliente IS
  'Si el papel CLIENTE del contrato puede ver la ubicación de las personas. APARTE de comparte_seguimiento_vivo, que es lo que autoriza a REGISTRARLA: encender el registro para poder operar no debe enseñárselo al cliente de regalo (§9 del complemento).';
COMMENT ON COLUMN grupo_reglas.turno_duracion_max_horas IS
  'Tope de duración de un turno abierto sin hora de fin prevista. Pasado ese tiempo el turno deja de contar como abierto y la ubicación se rechaza, aunque nadie lo haya cerrado: si no, un turno olvidado abierto convertiría R1 en papel mojado.';

-- `SEGUIMIENTO`: el consentimiento APARTE que pide §10.3 para el seguimiento
-- continuo. El `UBICACION` de F4 cubre la coordenada puntual de la visita, y su
-- texto dice textualmente «no se sigue tu ubicación entre visitas ni fuera de
-- tu turno». Reutilizarlo para el rastreo durante el turno sería usar un «sí»
-- que se dio para otra cosa. Ampliar el CHECK es aditivo y no toca ninguna fila.
DO $$
DECLARE v_nombre TEXT;
BEGIN
  SELECT conname INTO v_nombre FROM pg_constraint
   WHERE conrelid = 'public.persona_consentimientos'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%BIOMETRIA%'
   LIMIT 1;
  IF v_nombre IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.persona_consentimientos DROP CONSTRAINT %I', v_nombre);
  END IF;
  ALTER TABLE public.persona_consentimientos ADD CONSTRAINT persona_consentimientos_tipo_check
    CHECK (tipo IN ('UBICACION','FOTOS','AUDIO','BIOMETRIA','WHATSAPP','SEGUIMIENTO'));
END $$;

COMMENT ON COLUMN persona_consentimientos.tipo IS
  'BIOMETRIA va aparte de FOTOS: sin ese consentimiento la firma facial no se ofrece y se firma con trazo, y negarse NUNCA bloquea el trabajo. SEGUIMIENTO va aparte de UBICACION por lo mismo: UBICACION es la coordenada puntual de la visita y su texto promete que no se sigue a nadie entre visitas; el rastreo durante el turno (F8) necesita su propio sí, explícito, como exige §10.3.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Permisos de la fase
-- ──────────────────────────────────────────────────────────────────────────────
-- Claves planas en snake_case (§2 de la nomenclatura), espejadas en
-- apps/inventario/lib/permisos.ts. Una clave que no esté en ese catálogo no
-- aparece en /roles, nadie la puede marcar, y la política que la exija rechaza
-- a todo el mundo menos ADMIN.
--
-- Son CUATRO claves y no una, porque son cuatro oficios distintos:
--   · `ver_mapa_operativo` — ver dónde está la gente AHORA. Es el dato en vivo.
--   · `ver_recorrido_personas` — reproducir por dónde anduvo alguien en un turno
--     que ya pasó. Va aparte y es más restrictiva a propósito: ver un mapa para
--     coordinar el trabajo de hoy no es lo mismo que reconstruir los pasos de
--     una persona, que es tratamiento de datos de desempeño (§10.3) y pide
--     contexto. Quien coordina necesita lo primero; lo segundo, casi nadie.
--   · `ver_rutas_ronda` / `gestionar_rutas_ronda` — la ruta y sus paradas.
--     `gestionar_rutas` NO sirve: es de Logística (rutas de entrega).
--   · `reportar_ubicacion_campo` — mandar la propia ubicación desde la PWA.
CREATE OR REPLACE FUNCTION public.ronda_mapa_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_mapa_operativo,ver_recorrido_personas}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_mapa_acceso() IS
  'Ve el mapa operativo: la posición de las personas de su alcance de contratos, con su antigüedad y su fuente.';
GRANT EXECUTE ON FUNCTION public.ronda_mapa_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_recorrido_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('ver_recorrido_personas')
$$;
COMMENT ON FUNCTION public.ronda_recorrido_acceso() IS
  'Reproduce el recorrido de un turno pasado. Va sola: reconstruir los pasos de una persona es tratamiento de datos de desempeño, no coordinación del día (§10.3).';
GRANT EXECUTE ON FUNCTION public.ronda_recorrido_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_rutas_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_rutas_ronda,gestionar_rutas_ronda}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_rutas_acceso() IS
  'Lee las rutas de ronda y sus paradas dentro de su alcance de contratos.';
GRANT EXECUTE ON FUNCTION public.ronda_rutas_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_rutas_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_rutas_ronda')
$$;
COMMENT ON FUNCTION public.ronda_rutas_gestiona() IS
  'Arma rutas de ronda: crea la ruta, ordena sus paradas y la asigna a una persona.';
GRANT EXECUTE ON FUNCTION public.ronda_rutas_gestiona() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `ronda_turnos` — contra qué pregunta R1
-- ──────────────────────────────────────────────────────────────────────────────
-- No está en la lista de la §5 y hace falta. R1 exige que la base sepa si una
-- persona está DENTRO de su turno, y hoy no hay dónde preguntarlo:
-- `turno_patrones` son los 15 patrones de horario del ATS y `puestos` es la
-- cobertura que el cliente compró; ninguna de las dos dice quién entró hoy.
-- Mientras no exista la malla de programación por persona, el turno se abre
-- explícitamente (la persona entra a turno en la PWA, o lo abre el supervisor),
-- y el patrón queda GUARDADO para que, cuando la malla llegue, se pueda cruzar.
--
-- `fin_previsto_at` es NOT NULL y es la clave de R1: la ubicación se acepta
-- hasta esa hora, no hasta que alguien se acuerde de cerrar el turno. Un turno
-- que nadie cierra deja de aceptar ubicación solo. Eso es lo que convierte
-- «fuera del turno no se registra» en una regla de la base.
CREATE TABLE IF NOT EXISTS ronda_turnos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id         UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  usuario_id         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  sesion_id          UUID REFERENCES ronda_sesiones(id) ON DELETE SET NULL,
  -- §2.4: el contrato NOT NULL; la sede también, porque un turno se hace en un
  -- sitio y es el segundo filtro del alcance.
  grupo_id           UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id            UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  -- Sin llave foránea en la declaración: `puestos` y `turno_patrones` las crea
  -- la migración de programación (20261018000005), que puede no estar aplicada.
  -- Las referencias se agregan abajo si las tablas existen, igual que hizo F2
  -- con `ronda_zonas.puesto_id`. Bloquear F8 por eso sería absurdo.
  puesto_id          UUID,
  turno_patron       VARCHAR(40),
  inicio_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fin_previsto_at    TIMESTAMPTZ NOT NULL,
  fin_at             TIMESTAMPTZ,
  estado             VARCHAR(10) NOT NULL DEFAULT 'ABIERTO'
                     CHECK (estado IN ('ABIERTO','CERRADO','ANULADO')),
  cierre_motivo      VARCHAR(12)
                     CHECK (cierre_motivo IS NULL OR cierre_motivo IN ('PERSONA','CONSOLA','AUTOMATICO')),
  origen             VARCHAR(10) NOT NULL DEFAULT 'APP'
                     CHECK (origen IN ('APP','CONSOLA','ESCANEO','WHATSAPP','AUTO')),
  -- Resumen del recorrido. Se mantiene al vuelo con cada registro aceptado y
  -- SOBREVIVE A LA PURGA del rastro: cuando el historial de este turno se
  -- borre por retención, esto sigue diciendo que el turno existió, cuánto
  -- caminó y cuántos registros tuvo. Es lo que un informe necesita, y es el
  -- motivo por el que la retención corta del rastro no borra la historia.
  puntos_registrados INT NOT NULL DEFAULT 0 CHECK (puntos_registrados >= 0),
  metros_recorridos  DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (metros_recorridos >= 0),
  primera_lat        DECIMAL(10,7),
  primera_lng        DECIMAL(10,7),
  ultima_lat         DECIMAL(10,7),
  ultima_lng         DECIMAL(10,7),
  ultima_posicion_at TIMESTAMPTZ,
  observacion        TEXT,
  created_by         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_turno_fin_previsto CHECK (fin_previsto_at > inicio_at),
  CONSTRAINT ck_turno_fin CHECK (fin_at IS NULL OR fin_at >= inicio_at),
  -- Un turno cerrado tiene hora de cierre y motivo; uno abierto no tiene
  -- ninguna de las dos. Sin esto, «abierto con fin_at» sería un estado posible
  -- y R1 tendría que adivinar cuál de los dos campos manda.
  CONSTRAINT ck_turno_cerrado CHECK (
    (estado = 'ABIERTO' AND fin_at IS NULL AND cierre_motivo IS NULL)
    OR (estado <> 'ABIERTO' AND fin_at IS NOT NULL AND cierre_motivo IS NOT NULL)
  ),
  CONSTRAINT ck_turno_coord_primera CHECK ((primera_lat IS NULL) = (primera_lng IS NULL)),
  CONSTRAINT ck_turno_coord_ultima  CHECK ((ultima_lat IS NULL) = (ultima_lng IS NULL))
);

-- UN SOLO turno abierto por persona. Es un índice único parcial, no una regla
-- de la aplicación: dos turnos abiertos harían que la ubicación entrara en uno
-- cualquiera y el recorrido saliera partido en dos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_turnos_abierto
  ON ronda_turnos(persona_id) WHERE estado = 'ABIERTO';
CREATE INDEX IF NOT EXISTS idx_ronda_turnos_persona ON ronda_turnos(persona_id, inicio_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_turnos_grupo   ON ronda_turnos(grupo_id, inicio_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_turnos_sede    ON ronda_turnos(sede_id, inicio_at DESC);
-- Para el cron que cierra los vencidos: solo mira los abiertos.
CREATE INDEX IF NOT EXISTS idx_ronda_turnos_vencidos
  ON ronda_turnos(fin_previsto_at) WHERE estado = 'ABIERTO';
CREATE INDEX IF NOT EXISTS idx_ronda_turnos_upd     ON ronda_turnos(updated_at);

COMMENT ON TABLE ronda_turnos IS
  'El turno de trabajo de una persona. Es contra esta tabla contra la que pregunta R1 («fuera del turno no se registra ni se muestra la ubicación de nadie»): en el repositorio no existía ninguna tabla de turno por persona, porque turno_patrones son patrones de horario y puestos es la cobertura comprada. Un turno abierto por persona, garantizado por índice único parcial.';
COMMENT ON COLUMN ronda_turnos.fin_previsto_at IS
  'Hora a la que el turno deja de aceptar ubicación, LA CIERREN O NO. Es la mitad de R1: si el corte dependiera de que alguien pulse «salir de turno», un turno olvidado abierto rastrearía a la persona toda la noche.';
COMMENT ON COLUMN ronda_turnos.turno_patron IS
  'Patrón de horario del ATS con el que se abrió (turno_patrones.codigo), si se sabe. Se guarda para poder cruzar con la malla de programación cuando exista; hoy no hay malla por persona y el turno se abre explícitamente.';
COMMENT ON COLUMN ronda_turnos.metros_recorridos IS
  'Suma de las distancias entre registros consecutivos aceptados, calculada al vuelo con ronda_distancia_m(). SOBREVIVE a la purga del rastro: es el resumen que queda cuando el historial de este turno se borra por retención.';
COMMENT ON COLUMN ronda_turnos.puntos_registrados IS
  'Registros de ubicación ACEPTADOS en el turno. Es el contador contra el que se compara grupo_reglas.ubicacion_max_puntos_turno, y evita un COUNT(*) sobre el historial en cada registro — que es exactamente la consulta que haría saltar el corte de 8 s de Supabase.';

DROP TRIGGER IF EXISTS tr_ronda_turnos_upd ON ronda_turnos;
CREATE TRIGGER tr_ronda_turnos_upd BEFORE UPDATE ON ronda_turnos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Las llaves foráneas a programación, cuando esa migración esté aplicada.
-- Volver a correr F8 después de aplicarla deja las llaves puestas. Idempotente
-- en los dos escenarios (mismo patrón que `ronda_zonas.puesto_id` en F2).
DO $$ BEGIN
  IF to_regclass('public.puestos') IS NOT NULL THEN
    BEGIN
      ALTER TABLE ronda_turnos ADD CONSTRAINT ronda_turnos_puesto_fk
        FOREIGN KEY (puesto_id) REFERENCES puestos(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN null; END;
  END IF;
  IF to_regclass('public.turno_patrones') IS NOT NULL THEN
    BEGIN
      ALTER TABLE ronda_turnos ADD CONSTRAINT ronda_turnos_patron_fk
        FOREIGN KEY (turno_patron) REFERENCES turno_patrones(codigo) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN null; END;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ronda_turnos_puesto ON ronda_turnos(puesto_id)
  WHERE puesto_id IS NOT NULL;

-- ── 3.1 ¿Está esta persona dentro de su turno AHORA? ─────────────────────────
-- La función que cumple la primera mitad de R1. Devuelve el id del turno
-- abierto y vigente, o NULL. «Vigente» es las dos cosas: estado ABIERTO y
-- NOW() todavía dentro de [inicio_at, fin_previsto_at].
CREATE OR REPLACE FUNCTION public.ronda_turno_abierto(p_persona UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id
    FROM public.ronda_turnos t
   WHERE t.persona_id = p_persona
     AND t.estado = 'ABIERTO'
     AND NOW() >= t.inicio_at
     AND NOW() <= t.fin_previsto_at
   ORDER BY t.inicio_at DESC
   LIMIT 1
$$;
COMMENT ON FUNCTION public.ronda_turno_abierto(UUID) IS
  'Id del turno abierto Y vigente de la persona, o NULL. Es la primera mitad de R1: un turno cuya hora de fin prevista ya pasó NO cuenta como abierto, aunque nadie lo haya cerrado.';
GRANT EXECUTE ON FUNCTION public.ronda_turno_abierto(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `ronda_rutas` y `ronda_ruta_paradas`
-- ──────────────────────────────────────────────────────────────────────────────
-- Calcadas de `rutas_entrega` / `ruta_paradas` (§3 del complemento dice copiar
-- el patrón y no reutilizar las tablas, porque aquellas cuelgan de
-- `ordenes_insumo` y de un conductor). Lo que cambia: la parada es un PUNTO DE
-- CONTROL, no una orden; y el eje es el contrato.
--
-- El código sale de una SEQUENCE, como `pqrs_numero_seq` y
-- `mantenimiento_ticket_seq`: nunca COUNT(*)+1 ni un contador por fecha.
CREATE SEQUENCE IF NOT EXISTS ronda_ruta_seq;

CREATE TABLE IF NOT EXISTS ronda_rutas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          VARCHAR(20) NOT NULL UNIQUE,
  grupo_id        UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id         UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  nombre          VARCHAR(200) NOT NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  -- A quién le toca. `persona_id` nullable: una ruta se puede planear antes de
  -- saber quién la hace (es lo que hace `rutas_entrega` con el conductor, que
  -- ahí sí es obligatorio porque la ruta nace de un despacho).
  persona_id      UUID REFERENCES personas(id) ON DELETE SET NULL,
  -- Sin llave foránea declarada: ver la nota de `ronda_turnos.turno_patron`.
  turno_patron    VARCHAR(40),
  turno_id        UUID REFERENCES ronda_turnos(id) ON DELETE SET NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'PLANEADA'
                  CHECK (estado IN ('PLANEADA','EN_CURSO','COMPLETADA','CANCELADA')),
  hora_inicio     TIME,
  iniciado_at     TIMESTAMPTZ,
  finalizado_at   TIMESTAMPTZ,
  observacion     TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_ruta_nombre CHECK (NULLIF(btrim(nombre), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ronda_rutas_grupo   ON ronda_rutas(grupo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_rutas_sede    ON ronda_rutas(sede_id, fecha DESC);
-- El índice de «la ruta de esta persona hoy», que es la consulta que F10 hace
-- para contestar «¿cuál es tu próxima parada?».
CREATE INDEX IF NOT EXISTS idx_ronda_rutas_persona ON ronda_rutas(persona_id, fecha DESC)
  WHERE persona_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_rutas_turno   ON ronda_rutas(turno_id) WHERE turno_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_rutas_estado  ON ronda_rutas(estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_rutas_upd     ON ronda_rutas(updated_at);

COMMENT ON TABLE ronda_rutas IS
  'La ruta de ronda de un turno: qué puntos se recorren, en qué orden y a qué hora. Calcada de rutas_entrega, que no se puede reutilizar porque sus paradas son órdenes de insumo y su responsable es un conductor.';
COMMENT ON COLUMN ronda_rutas.codigo IS
  'RR-000001, desde la SEQUENCE ronda_ruta_seq. Nunca un contador por fecha: dos rutas creadas en el mismo segundo colisionarían.';

DROP TRIGGER IF EXISTS tr_ronda_rutas_upd ON ronda_rutas;
CREATE TRIGGER tr_ronda_rutas_upd BEFORE UPDATE ON ronda_rutas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ronda_ruta_paradas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id        UUID NOT NULL REFERENCES ronda_rutas(id) ON DELETE CASCADE,
  punto_id       UUID NOT NULL REFERENCES ronda_puntos(id) ON DELETE CASCADE,
  -- §2.4: desnormalizados aunque sean derivables del punto, para que la RLS no
  -- tenga que saltar a `ronda_rutas` ni a `ronda_puntos`. Los pone un trigger,
  -- no la aplicación: si los mandara la pantalla, un error metería la parada de
  -- un contrato dentro de otro, que es justo la columna por la que filtra.
  grupo_id       UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id        UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  numero_parada  SMALLINT NOT NULL DEFAULT 1 CHECK (numero_parada BETWEEN 1 AND 500),
  hora_estimada  TIME,
  tolerancia_min SMALLINT NOT NULL DEFAULT 30 CHECK (tolerancia_min BETWEEN 0 AND 720),
  estado         VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE'
                 CHECK (estado IN ('PENDIENTE','EN_CURSO','CUMPLIDA','OMITIDA')),
  llegado_at     TIMESTAMPTZ,
  visita_id      UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  observacion    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_parada_cumplida CHECK (estado <> 'CUMPLIDA' OR llegado_at IS NOT NULL)
);
-- Un punto una sola vez por ruta, y un número de parada una sola vez por ruta:
-- dos paradas con el mismo número dejarían el orden del recorrido indefinido.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_paradas_punto  ON ronda_ruta_paradas(ruta_id, punto_id);

-- El número de parada va en una restricción **DIFERIBLE**, no en un índice
-- único normal, y esto no es un detalle: reordenar una ruta cruza números (la
-- 2 pasa a 3 mientras la 3 pasa a 2), y con la restricción inmediata ese UPDATE
-- choca en la fila intermedia aunque el resultado final sea perfectamente
-- válido. La alternativa —renumerar en dos pasadas por números fuera de rango—
-- obligaría a abrir el CHECK de 1..500 para dejar pasar valores que no son
-- números de parada. Diferirla al final de la transacción es lo correcto.
DO $$ BEGIN
  -- Si quedó el índice de una versión anterior de esta migración, se sustituye.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_ronda_paradas_numero') THEN
    DROP INDEX IF EXISTS public.ux_ronda_paradas_numero;
    ALTER TABLE ronda_ruta_paradas ADD CONSTRAINT ux_ronda_paradas_numero
      UNIQUE (ruta_id, numero_parada) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ronda_paradas_ruta   ON ronda_ruta_paradas(ruta_id, numero_parada);
CREATE INDEX IF NOT EXISTS idx_ronda_paradas_punto  ON ronda_ruta_paradas(punto_id);
CREATE INDEX IF NOT EXISTS idx_ronda_paradas_grupo  ON ronda_ruta_paradas(grupo_id);
-- El índice que resuelve «la próxima parada pendiente de esta ruta» (F10).
CREATE INDEX IF NOT EXISTS idx_ronda_paradas_pend   ON ronda_ruta_paradas(ruta_id, numero_parada)
  WHERE estado IN ('PENDIENTE','EN_CURSO');
CREATE INDEX IF NOT EXISTS idx_ronda_paradas_upd    ON ronda_ruta_paradas(updated_at);

COMMENT ON TABLE ronda_ruta_paradas IS
  'Las paradas de una ruta de ronda, en orden. La parada es un PUNTO DE CONTROL, no una orden de insumo; cuando se cumple queda enlazada a la visita que la cumplió.';

DROP TRIGGER IF EXISTS tr_ronda_paradas_upd ON ronda_ruta_paradas;
CREATE TRIGGER tr_ronda_paradas_upd BEFORE UPDATE ON ronda_ruta_paradas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/** Deriva `grupo_id` y `sede_id` de la parada desde su PUNTO, y comprueba que
 *  el punto sea del mismo contrato que la ruta. Una ruta de un contrato con una
 *  parada de otro sería un agujero de alcance, no un error de datos. */
CREATE OR REPLACE FUNCTION public.ronda_paradas_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p RECORD; v_r RECORD;
BEGIN
  SELECT p.grupo_id, p.sede_id, p.estado INTO v_p
    FROM public.ronda_puntos p WHERE p.id = NEW.punto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El punto de control no existe.'; END IF;
  IF v_p.estado = 'RETIRADO' THEN
    RAISE EXCEPTION 'El punto está RETIRADO: no se puede poner como parada de una ruta.';
  END IF;
  SELECT r.grupo_id INTO v_r FROM public.ronda_rutas r WHERE r.id = NEW.ruta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La ruta no existe.'; END IF;
  IF v_r.grupo_id <> v_p.grupo_id THEN
    RAISE EXCEPTION 'El punto es de otro contrato que la ruta: una ruta no puede cruzar contratos.';
  END IF;
  NEW.grupo_id := v_p.grupo_id;
  NEW.sede_id  := v_p.sede_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_ronda_paradas_derivar ON ronda_ruta_paradas;
CREATE TRIGGER tr_ronda_paradas_derivar BEFORE INSERT OR UPDATE OF punto_id, ruta_id
  ON ronda_ruta_paradas FOR EACH ROW EXECUTE FUNCTION public.ronda_paradas_derivar();

/** Numera la ruta al crearla, si no viene con código. */
CREATE OR REPLACE FUNCTION public.ronda_rutas_numerar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sede RECORD;
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.codigo, '')), '') IS NULL THEN
    NEW.codigo := 'RR-' || lpad(nextval('public.ronda_ruta_seq')::text, 6, '0');
  END IF;
  -- La sede tiene que ser del contrato de la ruta: `sedes.grupo_id` es NOT NULL,
  -- así que esto siempre se puede comprobar.
  SELECT s.grupo_id INTO v_sede FROM public.sedes s WHERE s.id = NEW.sede_id;
  IF FOUND AND v_sede.grupo_id IS NOT NULL AND v_sede.grupo_id <> NEW.grupo_id THEN
    RAISE EXCEPTION 'La sede no pertenece al contrato de la ruta.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_ronda_rutas_numerar ON ronda_rutas;
CREATE TRIGGER tr_ronda_rutas_numerar BEFORE INSERT ON ronda_rutas
  FOR EACH ROW EXECUTE FUNCTION public.ronda_rutas_numerar();

DO $$ BEGIN
  IF to_regclass('public.turno_patrones') IS NOT NULL THEN
    BEGIN
      ALTER TABLE ronda_rutas ADD CONSTRAINT ronda_rutas_patron_fk
        FOREIGN KEY (turno_patron) REFERENCES turno_patrones(codigo) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN null; END;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `persona_ubicacion_actual` — la posición en vivo
-- ──────────────────────────────────────────────────────────────────────────────
-- Una fila por persona, con realtime, calcada de `conductor_ubicacion_actual`
-- (§3 del complemento) y colgando de `personas`, no de `conductores`.
--
-- `turno_id` es NOT NULL y eso es R1 escrito en el esquema: una posición SOLO
-- existe dentro de un turno. No hay forma de guardar una posición «sin turno»,
-- ni por error de la aplicación ni por una inserción a mano.
--
-- LOS TRES RELOJES, como en `ronda_visitas` (F4) y por el mismo motivo:
--   · `capturado_at` — cuándo se tomó la lectura. Es la que vale para R2 y la
--     RPC la acota a NOW() y al inicio del turno: un reloj de celular adelantado
--     no puede hacer parecer actual una posición vieja.
--   · `capturado_dispositivo` — lo que decía el celular. Es DATO, no verdad.
--   · `recibido_at` — cuándo llegó al servidor. La diferencia con `capturado_at`
--     es el retardo de la cola, no un reloj torcido.
-- `antiguedad_seg` NO es una columna: se calcula en cada lectura contra NOW()
-- del servidor, porque una antigüedad almacenada envejece mal por definición.
CREATE TABLE IF NOT EXISTS persona_ubicacion_actual (
  persona_id            UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
  turno_id              UUID NOT NULL REFERENCES ronda_turnos(id) ON DELETE CASCADE,
  -- §2.4: `grupo_id` NOT NULL (el contrato del turno), `sede_id` nullable.
  grupo_id              UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id               UUID REFERENCES sedes(id) ON DELETE SET NULL,
  ruta_id               UUID REFERENCES ronda_rutas(id) ON DELETE SET NULL,
  visita_id             UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  punto_id              UUID REFERENCES ronda_puntos(id) ON DELETE SET NULL,
  lat                   DECIMAL(10,7) NOT NULL,
  lng                   DECIMAL(10,7) NOT NULL,
  precision_metros      DECIMAL(8,2),
  velocidad_kmh         DECIMAL(6,2),
  rumbo                 DECIMAL(5,2),
  fuente                VARCHAR(12) NOT NULL
                        CHECK (fuente IN ('APP_VIVO','APP_NATIVA','WHATSAPP','ESCANEO','EVENTO')),
  capturado_at          TIMESTAMPTZ NOT NULL,
  capturado_dispositivo TIMESTAMPTZ,
  desfase_reloj_seg     INT,
  recibido_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_ubic_act_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT ck_ubic_act_lng CHECK (lng BETWEEN -180 AND 180),
  CONSTRAINT ck_ubic_act_prec CHECK (precision_metros IS NULL OR precision_metros >= 0),
  CONSTRAINT ck_ubic_act_rumbo CHECK (rumbo IS NULL OR rumbo BETWEEN 0 AND 360)
);
CREATE INDEX IF NOT EXISTS idx_ubic_actual_grupo ON persona_ubicacion_actual(grupo_id, capturado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ubic_actual_sede  ON persona_ubicacion_actual(sede_id, capturado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ubic_actual_turno ON persona_ubicacion_actual(turno_id);

COMMENT ON TABLE persona_ubicacion_actual IS
  'Última posición conocida de cada persona, con realtime, para el «en vivo» del mapa. UNA fila por persona: el mapa nunca lee el historial, que es lo que lo mantendría por debajo del corte de 8 s de Supabase con cualquier volumen.';
COMMENT ON COLUMN persona_ubicacion_actual.turno_id IS
  'NOT NULL, y es R1 escrito en el esquema: una posición solo existe dentro de un turno. No hay forma de guardar una posición «sin turno», ni por error de la aplicación.';
COMMENT ON COLUMN persona_ubicacion_actual.capturado_at IS
  'Cuándo se tomó la lectura, acotada por la RPC a NOW() y al inicio del turno. Es la que vale para calcular la antigüedad (R2): el reloj del navegador NO se usa para esto.';
COMMENT ON COLUMN persona_ubicacion_actual.recibido_at IS
  'Cuándo llegó al servidor. Su diferencia con capturado_at es el retardo de la cola offline, no un reloj torcido — mezclarlas haría que toda ronda de sótano pareciera fraude.';
COMMENT ON COLUMN persona_ubicacion_actual.fuente IS
  'APP_VIVO (la PWA con la pantalla abierta) · APP_NATIVA (segundo plano; solo la app nativa, §1.1) · WHATSAPP (ubicación puntual que manda la persona; F9/F10) · ESCANEO (la lectura de una visita) · EVENTO. Viaja SIEMPRE junto a la antigüedad, porque R2 exige rotular las dos.';

-- Realtime, igual que `conductor_ubicacion_actual`. Idempotente: añadir una
-- tabla que ya está en la publicación es un error, no un no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = 'persona_ubicacion_actual'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.persona_ubicacion_actual;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `persona_ubicacion_historial` — el rastro del turno
-- ──────────────────────────────────────────────────────────────────────────────
-- Append. Es la tabla que crece, y sus índices están elegidos por las TRES
-- consultas que de verdad se hacen, no por las que se podrían hacer:
--   1. el recorrido de UN turno, en orden → (turno_id, capturado_at);
--   2. el día de UNA persona → (persona_id, capturado_at DESC);
--   3. la purga por retención → BRIN sobre capturado_at.
-- El BRIN no es adorno: los datos entran en orden de tiempo, así que sus
-- rangos por bloque quedan perfectamente correlacionados; ocupa unas pocas
-- páginas frente a los cientos de megas de un B-tree sobre la misma columna, y
-- la purga es exactamente el barrido por rango para el que sirve.
--
-- NO hay índice por `grupo_id` solo: el alcance se resuelve por el turno o por
-- la persona, y un índice más en una tabla que recibe una escritura cada dos
-- minutos por persona se paga en cada inserción.
CREATE TABLE IF NOT EXISTS persona_ubicacion_historial (
  id                    BIGSERIAL PRIMARY KEY,
  persona_id            UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  turno_id              UUID NOT NULL REFERENCES ronda_turnos(id) ON DELETE CASCADE,
  grupo_id              UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id               UUID REFERENCES sedes(id) ON DELETE SET NULL,
  ruta_id               UUID REFERENCES ronda_rutas(id) ON DELETE SET NULL,
  visita_id             UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  punto_id              UUID REFERENCES ronda_puntos(id) ON DELETE SET NULL,
  lat                   DECIMAL(10,7) NOT NULL,
  lng                   DECIMAL(10,7) NOT NULL,
  precision_metros      DECIMAL(8,2),
  velocidad_kmh         DECIMAL(6,2),
  rumbo                 DECIMAL(5,2),
  fuente                VARCHAR(12) NOT NULL
                        CHECK (fuente IN ('APP_VIVO','APP_NATIVA','WHATSAPP','ESCANEO','EVENTO')),
  -- Metros desde el registro anterior del mismo turno. Se guarda calculado para
  -- que el recorrido no tenga que recalcular haversine sobre miles de filas al
  -- dibujarse, y para que el resumen del turno sea una suma.
  metros_desde_anterior DECIMAL(10,2),
  capturado_at          TIMESTAMPTZ NOT NULL,
  capturado_dispositivo TIMESTAMPTZ,
  desfase_reloj_seg     INT,
  recibido_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_ubic_hist_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT ck_ubic_hist_lng CHECK (lng BETWEEN -180 AND 180),
  CONSTRAINT ck_ubic_hist_prec CHECK (precision_metros IS NULL OR precision_metros >= 0),
  CONSTRAINT ck_ubic_hist_rumbo CHECK (rumbo IS NULL OR rumbo BETWEEN 0 AND 360)
);
CREATE INDEX IF NOT EXISTS idx_ubic_hist_turno   ON persona_ubicacion_historial(turno_id, capturado_at);
CREATE INDEX IF NOT EXISTS idx_ubic_hist_persona ON persona_ubicacion_historial(persona_id, capturado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ubic_hist_purga   ON persona_ubicacion_historial USING BRIN (capturado_at);

COMMENT ON TABLE persona_ubicacion_historial IS
  'Rastro de ubicación, append-only, para reproducir el recorrido de un turno. Es la tabla que más rápido crece del módulo: la acotan el intervalo mínimo y el tope por turno de grupo_reglas, y la purga su propia retención (retencion_ubicacion_meses, 3 meses por defecto — más corta que los 12 de la evidencia a propósito). El mapa NUNCA la lee: para el «en vivo» está persona_ubicacion_actual.';
COMMENT ON COLUMN persona_ubicacion_historial.metros_desde_anterior IS
  'Distancia al registro anterior del mismo turno, calculada al insertar. Guardarla evita recalcular haversine sobre miles de filas cada vez que se dibuja un recorrido.';
COMMENT ON INDEX idx_ubic_hist_purga IS
  'BRIN, no B-tree: los datos entran en orden de tiempo, así que los rangos por bloque quedan correlacionados y el índice ocupa unas páginas en vez de cientos de megas. Sirve para el barrido por rango de la purga, que es lo único que consulta por fecha sin filtrar por turno ni por persona.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. `ronda_turno_abrir` / `ronda_turno_cerrar`
-- ──────────────────────────────────────────────────────────────────────────────
-- Un solo camino de escritura (ADR-E). `ronda_actor()` (F4) resuelve quién
-- escribe: cuenta de Supabase Auth, sesión de campo de enlace + PIN, o la
-- consola con la llave de servicio.
--
-- Con un añadido que F4 no podía prever: `ronda_actor()` exige
-- `ejecutar_rondas` a toda cuenta autenticada, porque en F4 todo lo que
-- escribía era una visita. Aquí no: un supervisor que cierra el turno que
-- alguien se dejó abierto, o que lo abre por teléfono, NO ejecuta rondas y no
-- tiene por qué tener esa clave. Así que el actor se resuelve por este
-- envoltorio, que abre el camino de la consola con `gestionar_rutas_ronda` y
-- para todo lo demás delega en `ronda_actor()` tal cual.
CREATE OR REPLACE FUNCTION public.ronda_turno_actor(
  p_persona UUID DEFAULT NULL,
  p_sesion  UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := (SELECT auth.uid()); v_propia UUID; v_nombre TEXT; v_persona UUID;
BEGIN
  -- Camino de consola: cuenta autenticada, con permiso de gestión, actuando
  -- sobre una persona concreta. Sin `p_persona` no hay camino de consola:
  -- «abrir mi turno» siempre es el camino normal.
  IF v_uid IS NOT NULL AND p_persona IS NOT NULL AND p_sesion IS NULL
     AND public.auth_permiso_any('{gestionar_rutas_ronda,gestionar_visitas_rondas}'::text[]) THEN
    SELECT pe.id INTO v_propia FROM public.personas pe WHERE pe.usuario_id = v_uid LIMIT 1;
    SELECT btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, '')), pe.id
      INTO v_nombre, v_persona FROM public.personas pe WHERE pe.id = p_persona;
    IF v_persona IS NULL THEN RAISE EXCEPTION 'La persona no existe.'; END IF;
    RETURN jsonb_build_object(
      'usuario_id', v_uid, 'persona_id', v_persona, 'nombre', v_nombre,
      'metodo', CASE WHEN v_persona = v_propia THEN 'CUENTA' ELSE 'CONSOLA' END,
      'sesion_id', NULL);
  END IF;
  RETURN public.ronda_actor(p_persona, p_sesion);
END $$;
COMMENT ON FUNCTION public.ronda_turno_actor(UUID, UUID) IS
  'Resuelve quién abre o cierra un turno. Igual que ronda_actor(), más el camino de la consola: quien tiene gestionar_rutas_ronda puede abrir o cerrar el turno de otra persona SIN tener ejecutar_rondas, porque un supervisor que cierra un turno olvidado no está ejecutando una ronda.';
REVOKE ALL ON FUNCTION public.ronda_turno_actor(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_turno_actor(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_turno_abrir(
  p_sede            UUID,
  p_fin_previsto    TIMESTAMPTZ DEFAULT NULL,
  p_puesto          UUID        DEFAULT NULL,
  p_patron          TEXT        DEFAULT NULL,
  p_origen          TEXT        DEFAULT 'APP',
  p_observacion     TEXT        DEFAULT NULL,
  p_persona         UUID        DEFAULT NULL,
  p_sesion          UUID        DEFAULT NULL
) RETURNS ronda_turnos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor   JSONB := public.ronda_turno_actor(p_persona, p_sesion);
  v_persona UUID  := (v_actor ->> 'persona_id')::uuid;
  v_grupo   UUID;
  v_abierto UUID;
  v_max     INT;
  v_fin     TIMESTAMPTZ;
  v_turno   ronda_turnos;
BEGIN
  SELECT s.grupo_id INTO v_grupo FROM public.sedes s WHERE s.id = p_sede;
  IF v_grupo IS NULL THEN
    RAISE EXCEPTION 'La sede no existe o no tiene contrato.';
  END IF;

  -- Vigencia EFECTIVA del contrato, preguntando a `grupo_vigente()` de F1 y no
  -- reimplementando la regla: es la misma función que apaga los QR (§2.5), con
  -- las prórrogas de `grupo_vigencias` ya tenidas en cuenta.
  IF NOT public.grupo_vigente(v_grupo) THEN
    RAISE EXCEPTION 'El contrato de esa sede no está vigente: no se puede abrir turno.';
  END IF;

  -- Si ya hay turno abierto y vigente, se devuelve ese. Idempotente: la PWA
  -- reintenta y no debe acabar con dos turnos (el índice único lo impediría,
  -- pero con un error feo en vez de la respuesta correcta).
  v_abierto := public.ronda_turno_abierto(v_persona);
  IF v_abierto IS NOT NULL THEN
    SELECT * INTO v_turno FROM public.ronda_turnos WHERE id = v_abierto;
    RETURN v_turno;
  END IF;

  -- Un turno vencido que nadie cerró se cierra aquí antes de abrir el nuevo:
  -- el índice único es por `estado = 'ABIERTO'` y no mira la hora.
  UPDATE public.ronda_turnos
     SET estado = 'CERRADO', fin_at = fin_previsto_at, cierre_motivo = 'AUTOMATICO'
   WHERE persona_id = v_persona AND estado = 'ABIERTO';

  SELECT COALESCE(r.turno_duracion_max_horas, 12) INTO v_max
    FROM public.grupo_reglas r WHERE r.grupo_id = v_grupo;
  v_max := COALESCE(v_max, 12);

  -- La hora de fin: la que pida el patrón, la que manden, o el tope. Nunca más
  -- allá del tope del contrato: es lo que evita turnos de 30 horas que
  -- rastrearían a alguien un día entero.
  v_fin := COALESCE(p_fin_previsto, NOW() + make_interval(hours => v_max));
  IF v_fin > NOW() + make_interval(hours => v_max) THEN
    v_fin := NOW() + make_interval(hours => v_max);
  END IF;
  IF v_fin <= NOW() THEN
    RAISE EXCEPTION 'La hora de fin del turno ya pasó.';
  END IF;

  INSERT INTO public.ronda_turnos (
    persona_id, usuario_id, sesion_id, grupo_id, sede_id, puesto_id, turno_patron,
    inicio_at, fin_previsto_at, origen, observacion, created_by
  ) VALUES (
    v_persona, (v_actor ->> 'usuario_id')::uuid, (v_actor ->> 'sesion_id')::uuid,
    v_grupo, p_sede, p_puesto, NULLIF(btrim(COALESCE(p_patron, '')), ''),
    NOW(), v_fin, COALESCE(upper(NULLIF(btrim(p_origen), '')), 'APP'),
    NULLIF(btrim(COALESCE(p_observacion, '')), ''), (v_actor ->> 'usuario_id')::uuid
  ) RETURNING * INTO v_turno;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle
  ) VALUES (
    v_grupo, p_sede, 'ronda_turnos', v_turno.id, 'TURNO_ABIERTO',
    CASE WHEN v_actor ->> 'usuario_id' IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    (v_actor ->> 'usuario_id')::uuid, v_persona, v_actor ->> 'nombre',
    CASE WHEN COALESCE(upper(p_origen), 'APP') = 'CONSOLA' THEN 'CONSOLA' ELSE 'APP' END,
    jsonb_build_object('fin_previsto_at', v_fin, 'origen', upper(COALESCE(p_origen, 'APP')))
  );

  RETURN v_turno;
END $$;
COMMENT ON FUNCTION public.ronda_turno_abrir(UUID, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, UUID) IS
  'Abre el turno de la persona en una sede. Idempotente: si ya hay uno abierto y vigente lo devuelve. La hora de fin prevista nunca pasa del tope del contrato (turno_duracion_max_horas), que es lo que evita un turno de 30 horas rastreando a alguien.';
REVOKE ALL ON FUNCTION public.ronda_turno_abrir(UUID, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_turno_abrir(UUID, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_turno_cerrar(
  p_turno   UUID DEFAULT NULL,
  p_persona UUID DEFAULT NULL,
  p_sesion  UUID DEFAULT NULL
) RETURNS ronda_turnos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor   JSONB := public.ronda_turno_actor(p_persona, p_sesion);
  v_persona UUID  := (v_actor ->> 'persona_id')::uuid;
  v_id      UUID  := p_turno;
  v_turno   ronda_turnos;
  v_motivo  TEXT;
BEGIN
  IF v_id IS NULL THEN
    SELECT t.id INTO v_id FROM public.ronda_turnos t
     WHERE t.persona_id = v_persona AND t.estado = 'ABIERTO'
     ORDER BY t.inicio_at DESC LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No hay turno abierto que cerrar.'; END IF;

  SELECT * INTO v_turno FROM public.ronda_turnos WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El turno no existe.'; END IF;
  IF v_turno.estado <> 'ABIERTO' THEN RETURN v_turno; END IF;

  -- Cerrar el turno de otra persona es cosa de la consola, con permiso.
  IF v_turno.persona_id <> v_persona THEN
    IF NOT ((SELECT auth.uid()) IS NOT NULL
            AND public.auth_permiso_any('{gestionar_rutas_ronda,gestionar_visitas_rondas}'::text[])
            AND public.auth_ve_grupo(v_turno.grupo_id)) THEN
      RAISE EXCEPTION 'Ese turno es de otra persona.';
    END IF;
    v_motivo := 'CONSOLA';
  ELSE
    v_motivo := 'PERSONA';
  END IF;

  UPDATE public.ronda_turnos
     SET estado = 'CERRADO', fin_at = NOW(), cierre_motivo = v_motivo
   WHERE id = v_id RETURNING * INTO v_turno;

  -- Al cerrar el turno la persona DESAPARECE del mapa en vivo: su fila de
  -- posición actual se borra. El rastro del turno sigue en el historial, que es
  -- lo que R1 pide («sigue existiendo en el historial del turno, para el
  -- recorrido de ese día»). Esto es lo que hace que el mapa no muestre a nadie
  -- fuera de turno ni por un segundo.
  DELETE FROM public.persona_ubicacion_actual WHERE turno_id = v_id;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle
  ) VALUES (
    v_turno.grupo_id, v_turno.sede_id, 'ronda_turnos', v_id, 'TURNO_CERRADO',
    CASE WHEN v_actor ->> 'usuario_id' IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    (v_actor ->> 'usuario_id')::uuid, v_persona, v_actor ->> 'nombre',
    CASE WHEN v_motivo = 'CONSOLA' THEN 'CONSOLA' ELSE 'APP' END,
    jsonb_build_object('motivo', v_motivo, 'puntos', v_turno.puntos_registrados,
                       'metros', v_turno.metros_recorridos)
  );

  RETURN v_turno;
END $$;
COMMENT ON FUNCTION public.ronda_turno_cerrar(UUID, UUID, UUID) IS
  'Cierra el turno y BORRA la fila de posición actual de la persona: al salir de turno desaparece del mapa en vivo en el acto, y su rastro queda solo en el historial del turno (R1).';
REVOKE ALL ON FUNCTION public.ronda_turno_cerrar(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_turno_cerrar(UUID, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. `ronda_registrar_ubicacion` — R1, en la base
-- ──────────────────────────────────────────────────────────────────────────────
-- «Fuera del turno no se registra ni se muestra la ubicación de nadie. No es
-- una regla de interfaz: se cumple en la base de datos.» Esta función es esa
-- mitad del requisito, y RECHAZA sin dejar rastro parcial: valida todo antes de
-- la primera escritura, así que una ubicación rechazada no inserta nada en
-- ninguna de las dos tablas.
--
-- El orden de las comprobaciones es deliberado — primero quién, luego si puede
-- haber registro, y solo al final el dato:
--   1. el actor (F4 `ronda_actor`);
--   2. TURNO ABIERTO Y VIGENTE. Sin él, excepción;
--   3. el CONTRATO permite seguimiento en vivo (`comparte_seguimiento_vivo`).
--      Sin eso, excepción, aunque el turno esté abierto;
--   4. el CONSENTIMIENTO de la persona: `SEGUIMIENTO` para el rastreo continuo,
--      o `UBICACION` cuando la posición viene de una visita (`ESCANEO`), que es
--      la finalidad que ese consentimiento sí cubre. Sin él, excepción;
--   5. la coordenada es una coordenada;
--   6. el intervalo mínimo y el tope del turno. Esto NO es un rechazo: es un
--      «no hacía falta», y devuelve IGNORADA sin error, porque un cliente que
--      reporta cada 30 s no está haciendo nada malo.
--
-- Los rechazos de los puntos 2, 3 y 4 quedan en `ronda_eventos`: un intento de
-- registrar ubicación fuera de turno es justo la señal que hay que poder
-- auditar. Los IGNORADA no se auditan: serían ruido a razón de uno por minuto.
--
-- POR QUÉ UN RECHAZO **DEVUELVE** `RECHAZADA` EN VEZ DE LANZAR EXCEPCIÓN:
-- porque si lanzara, la excepción abortaría la transacción y se llevaría por
-- delante el INSERT de la auditoría — el rechazo quedaría sin rastro, que es
-- justo lo contrario de lo que hace falta. Así que la RPC no lanza en los
-- rechazos de R1: devuelve `{estado: 'RECHAZADA', motivo, mensaje}`, el evento
-- queda escrito, y es el route handler el que traduce eso a un 403. El efecto
-- para quien llama es el mismo —no se escribió NI UNA fila de ubicación— y
-- además queda la prueba de que se intentó.
-- Las excepciones se reservan para lo que es un error de programa (coordenada
-- inválida, fuente desconocida), donde no hay nada que auditar.

/** Deja el rechazo en la auditoría. Aparte para que la RPC no repita seis veces
 *  el mismo INSERT, y porque un intento de registrar ubicación fuera de turno
 *  es la señal que de verdad hay que poder revisar después. */
CREATE OR REPLACE FUNCTION public.ronda_ubicacion_rechazo(
  p_actor JSONB, p_turno UUID, p_motivo TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grupo UUID; v_sede UUID;
BEGIN
  IF p_turno IS NOT NULL THEN
    SELECT t.grupo_id, t.sede_id INTO v_grupo, v_sede
      FROM public.ronda_turnos t WHERE t.id = p_turno;
  END IF;
  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle
  ) VALUES (
    v_grupo, v_sede, 'persona_ubicacion', p_turno, 'UBICACION_RECHAZADA',
    CASE WHEN p_actor ->> 'usuario_id' IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    (p_actor ->> 'usuario_id')::uuid, (p_actor ->> 'persona_id')::uuid,
    p_actor ->> 'nombre', 'APP', jsonb_build_object('motivo', p_motivo)
  );
END $$;
COMMENT ON FUNCTION public.ronda_ubicacion_rechazo(JSONB, UUID, TEXT) IS
  'Deja en ronda_eventos el rechazo de una ubicación (sin turno, contrato que no lo permite, sin consentimiento). Los IGNORADA por intervalo NO se auditan: serían ruido a razón de uno por minuto por persona.';
REVOKE ALL ON FUNCTION public.ronda_ubicacion_rechazo(JSONB, UUID, TEXT) FROM PUBLIC;

/** Quién manda su ubicación. Igual que `ronda_actor()` (F4), más un camino:
 *  quien tiene `reportar_ubicacion_campo` puede mandar LA SUYA sin tener
 *  `ejecutar_rondas`. Son dos oficios distintos —hay quien está en el turno y
 *  comparte dónde está sin ejecutar ninguna ronda—, y sin esto la clave
 *  `reportar_ubicacion_campo` existiría en /roles sin servir para nada.
 *  Ojo: este camino NO deja mandar la ubicación de OTRA persona. Para eso hay
 *  que pasar por `ronda_actor()`, que pide el permiso de ejecución. */
CREATE OR REPLACE FUNCTION public.ronda_ubicacion_actor(
  p_persona UUID DEFAULT NULL,
  p_sesion  UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := (SELECT auth.uid()); v_propia UUID; v_nombre TEXT;
BEGIN
  IF v_uid IS NOT NULL AND p_sesion IS NULL
     AND public.auth_permiso('reportar_ubicacion_campo') THEN
    SELECT pe.id, btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, ''))
      INTO v_propia, v_nombre
      FROM public.personas pe WHERE pe.usuario_id = v_uid LIMIT 1;
    -- Solo la propia: si pide otra persona, cae al camino normal, que exige
    -- el permiso de ejecución.
    IF v_propia IS NOT NULL AND (p_persona IS NULL OR p_persona = v_propia) THEN
      RETURN jsonb_build_object(
        'usuario_id', v_uid, 'persona_id', v_propia, 'nombre', v_nombre,
        'metodo', 'CUENTA', 'sesion_id', NULL);
    END IF;
  END IF;
  RETURN public.ronda_actor(p_persona, p_sesion);
END $$;
COMMENT ON FUNCTION public.ronda_ubicacion_actor(UUID, UUID) IS
  'Resuelve quién manda una ubicación. Igual que ronda_actor(), más el camino de quien tiene reportar_ubicacion_campo, que puede mandar LA SUYA sin tener ejecutar_rondas. La de otra persona sigue pidiendo el permiso de ejecución.';
REVOKE ALL ON FUNCTION public.ronda_ubicacion_actor(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_ubicacion_actor(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_registrar_ubicacion(
  p_lat        DECIMAL,
  p_lng        DECIMAL,
  p_precision  DECIMAL     DEFAULT NULL,
  p_velocidad  DECIMAL     DEFAULT NULL,
  p_rumbo      DECIMAL     DEFAULT NULL,
  p_fuente     TEXT        DEFAULT 'APP_VIVO',
  p_capturado  TIMESTAMPTZ DEFAULT NULL,
  p_visita     UUID        DEFAULT NULL,
  p_punto      UUID        DEFAULT NULL,
  p_persona    UUID        DEFAULT NULL,
  p_sesion     UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    JSONB := public.ronda_ubicacion_actor(p_persona, p_sesion);
  v_persona  UUID  := (v_actor ->> 'persona_id')::uuid;
  v_turno    ronda_turnos;
  v_turno_id UUID;
  v_reglas   RECORD;
  v_fuente   TEXT := upper(COALESCE(NULLIF(btrim(p_fuente), ''), 'APP_VIVO'));
  v_cap      TIMESTAMPTZ;
  v_disp     TIMESTAMPTZ := p_capturado;
  v_desfase  INT;
  v_ult      RECORD;
  v_metros   DECIMAL;
  v_ruta     UUID;
  v_sede     UUID;
BEGIN
  IF v_fuente NOT IN ('APP_VIVO','APP_NATIVA','WHATSAPP','ESCANEO','EVENTO') THEN
    RAISE EXCEPTION 'Fuente de ubicación desconocida: %', v_fuente;
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'La coordenada no es válida.';
  END IF;

  -- ── R1, primera mitad: turno abierto ──────────────────────────────────────
  v_turno_id := public.ronda_turno_abierto(v_persona);
  IF v_turno_id IS NULL THEN
    PERFORM public.ronda_ubicacion_rechazo(v_actor, NULL, 'SIN_TURNO');
    RETURN jsonb_build_object('estado', 'RECHAZADA', 'motivo', 'SIN_TURNO',
      'mensaje', 'Fuera de turno no se registra ubicación. Entra a turno primero.');
  END IF;
  SELECT * INTO v_turno FROM public.ronda_turnos WHERE id = v_turno_id;

  -- ── R1, segunda mitad: el contrato tiene que permitirlo ───────────────────
  SELECT COALESCE(r.comparte_seguimiento_vivo, false)   AS vivo,
         COALESCE(r.ubicacion_intervalo_seg, 120)       AS intervalo,
         COALESCE(r.ubicacion_max_puntos_turno, 1000)   AS tope
    INTO v_reglas
    FROM public.grupo_reglas r WHERE r.grupo_id = v_turno.grupo_id;
  IF NOT FOUND THEN
    -- Sin fila de reglas rige el valor por defecto de la columna, que es FALSE.
    -- Un contrato sin configurar NO rastrea a nadie.
    PERFORM public.ronda_ubicacion_rechazo(v_actor, v_turno_id, 'CONTRATO_SIN_REGLAS');
    RETURN jsonb_build_object('estado', 'RECHAZADA', 'motivo', 'CONTRATO_SIN_REGLAS',
      'mensaje', 'El contrato no tiene habilitado el seguimiento de ubicación.',
      'turno_id', v_turno_id);
  END IF;
  IF NOT v_reglas.vivo THEN
    PERFORM public.ronda_ubicacion_rechazo(v_actor, v_turno_id, 'CONTRATO_NO_PERMITE');
    RETURN jsonb_build_object('estado', 'RECHAZADA', 'motivo', 'CONTRATO_NO_PERMITE',
      'mensaje', 'El contrato no tiene habilitado el seguimiento de ubicación.',
      'turno_id', v_turno_id);
  END IF;

  -- ── Consentimiento ────────────────────────────────────────────────────────
  -- `ESCANEO` es la coordenada de una visita: eso lo cubre `UBICACION`, que es
  -- el consentimiento cuyo texto habla justamente de abrir y cerrar visitas.
  -- Todo lo demás es rastreo durante el turno y pide `SEGUIMIENTO`, que §10.3
  -- exige «aparte».
  IF v_fuente = 'ESCANEO' THEN
    IF NOT public.persona_consiente(v_persona, 'UBICACION') THEN
      PERFORM public.ronda_ubicacion_rechazo(v_actor, v_turno_id, 'SIN_CONSENTIMIENTO_UBICACION');
      RETURN jsonb_build_object('estado', 'RECHAZADA', 'motivo', 'SIN_CONSENTIMIENTO_UBICACION',
        'mensaje', 'No autorizaste el uso de tu ubicación.', 'turno_id', v_turno_id);
    END IF;
  ELSIF NOT public.persona_consiente(v_persona, 'SEGUIMIENTO') THEN
    PERFORM public.ronda_ubicacion_rechazo(v_actor, v_turno_id, 'SIN_CONSENTIMIENTO_SEGUIMIENTO');
    RETURN jsonb_build_object('estado', 'RECHAZADA', 'motivo', 'SIN_CONSENTIMIENTO_SEGUIMIENTO',
      'mensaje', 'No autorizaste compartir tu ubicación durante el turno.', 'turno_id', v_turno_id);
  END IF;

  -- ── R2: el reloj ──────────────────────────────────────────────────────────
  -- `capturado_at` se ACOTA: nunca en el futuro (un reloj adelantado haría
  -- parecer actual una posición vieja, que es exactamente lo que R2 prohíbe) y
  -- nunca antes del inicio del turno (una posición de antes del turno no es una
  -- posición del turno).
  v_cap := COALESCE(p_capturado, NOW());
  IF v_cap > NOW() THEN v_cap := NOW(); END IF;
  IF v_cap < v_turno.inicio_at THEN v_cap := v_turno.inicio_at; END IF;
  IF v_disp IS NOT NULL THEN
    v_desfase := round(EXTRACT(EPOCH FROM (v_disp - NOW())))::int;
  END IF;

  -- ── Volumen: intervalo mínimo y tope del turno ────────────────────────────
  -- El contador vive en el turno, así que esto NO es un COUNT(*) sobre el
  -- historial: es leer una columna de una fila que ya está en memoria.
  IF v_turno.puntos_registrados >= v_reglas.tope THEN
    RETURN jsonb_build_object('estado', 'IGNORADA', 'motivo', 'TOPE_TURNO',
                              'turno_id', v_turno_id);
  END IF;

  SELECT h.lat, h.lng, h.capturado_at INTO v_ult
    FROM public.persona_ubicacion_historial h
   WHERE h.turno_id = v_turno_id
   ORDER BY h.capturado_at DESC, h.id DESC
   LIMIT 1;

  IF v_ult.capturado_at IS NOT NULL THEN
    -- Estrictamente MÁS VIEJA. La lectura del mismo instante cae en la
    -- comprobación de intervalo de abajo, que la ignora igual pero con el
    -- motivo útil («vuelve a intentarlo en N segundos») en vez de uno que
    -- suena a cola desordenada.
    IF v_cap < v_ult.capturado_at THEN
      -- Llegó una lectura más vieja que la última. Pasa con la cola offline y
      -- NO es un error: se descarta para no desordenar el recorrido ni pisar
      -- una posición más nueva con una más vieja.
      RETURN jsonb_build_object('estado', 'IGNORADA', 'motivo', 'FUERA_DE_ORDEN',
                                'turno_id', v_turno_id);
    END IF;
    IF EXTRACT(EPOCH FROM (v_cap - v_ult.capturado_at)) < v_reglas.intervalo THEN
      RETURN jsonb_build_object('estado', 'IGNORADA', 'motivo', 'INTERVALO',
                                'turno_id', v_turno_id,
                                'proximo_en_seg',
                                ceil(v_reglas.intervalo - EXTRACT(EPOCH FROM (v_cap - v_ult.capturado_at))));
    END IF;
    v_metros := public.ronda_distancia_m(v_ult.lat, v_ult.lng, p_lat, p_lng);
  END IF;

  -- La ruta y la sede del momento: la ruta en curso del turno, si hay.
  SELECT r.id INTO v_ruta FROM public.ronda_rutas r
   WHERE r.turno_id = v_turno_id AND r.estado IN ('PLANEADA','EN_CURSO')
   ORDER BY (r.estado = 'EN_CURSO') DESC, r.created_at LIMIT 1;
  v_sede := COALESCE((SELECT p.sede_id FROM public.ronda_puntos p WHERE p.id = p_punto),
                     v_turno.sede_id);

  INSERT INTO public.persona_ubicacion_historial (
    persona_id, turno_id, grupo_id, sede_id, ruta_id, visita_id, punto_id,
    lat, lng, precision_metros, velocidad_kmh, rumbo, fuente,
    metros_desde_anterior, capturado_at, capturado_dispositivo, desfase_reloj_seg
  ) VALUES (
    v_persona, v_turno_id, v_turno.grupo_id, v_sede, v_ruta, p_visita, p_punto,
    p_lat, p_lng, p_precision, p_velocidad, p_rumbo, v_fuente,
    v_metros, v_cap, v_disp, v_desfase
  );

  -- `persona_ubicacion_actual` solo avanza: el `WHERE` del `DO UPDATE` impide
  -- que una lectura más vieja que la guardada pise la posición en vivo. Sin él,
  -- una cola que se vacía en desorden dejaría a la persona dibujada donde
  -- estaba hace media hora.
  INSERT INTO public.persona_ubicacion_actual (
    persona_id, turno_id, grupo_id, sede_id, ruta_id, visita_id, punto_id,
    lat, lng, precision_metros, velocidad_kmh, rumbo, fuente,
    capturado_at, capturado_dispositivo, desfase_reloj_seg, recibido_at, updated_at
  ) VALUES (
    v_persona, v_turno_id, v_turno.grupo_id, v_sede, v_ruta, p_visita, p_punto,
    p_lat, p_lng, p_precision, p_velocidad, p_rumbo, v_fuente,
    v_cap, v_disp, v_desfase, NOW(), NOW()
  )
  ON CONFLICT (persona_id) DO UPDATE SET
    turno_id = EXCLUDED.turno_id, grupo_id = EXCLUDED.grupo_id,
    sede_id = EXCLUDED.sede_id, ruta_id = EXCLUDED.ruta_id,
    visita_id = EXCLUDED.visita_id, punto_id = EXCLUDED.punto_id,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    precision_metros = EXCLUDED.precision_metros,
    velocidad_kmh = EXCLUDED.velocidad_kmh, rumbo = EXCLUDED.rumbo,
    fuente = EXCLUDED.fuente, capturado_at = EXCLUDED.capturado_at,
    capturado_dispositivo = EXCLUDED.capturado_dispositivo,
    desfase_reloj_seg = EXCLUDED.desfase_reloj_seg,
    recibido_at = NOW(), updated_at = NOW()
  WHERE persona_ubicacion_actual.capturado_at < EXCLUDED.capturado_at;

  UPDATE public.ronda_turnos t
     SET puntos_registrados = t.puntos_registrados + 1,
         metros_recorridos  = t.metros_recorridos + COALESCE(v_metros, 0),
         primera_lat        = COALESCE(t.primera_lat, p_lat),
         primera_lng        = COALESCE(t.primera_lng, p_lng),
         ultima_lat         = p_lat,
         ultima_lng         = p_lng,
         ultima_posicion_at = v_cap
   WHERE t.id = v_turno_id;

  RETURN jsonb_build_object(
    'estado', 'REGISTRADA', 'turno_id', v_turno_id, 'capturado_at', v_cap,
    'metros_desde_anterior', v_metros,
    'proximo_en_seg', v_reglas.intervalo
  );
END $$;
COMMENT ON FUNCTION public.ronda_registrar_ubicacion(DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, UUID) IS
  'Registra una posición. Es R1 en la base: sin turno abierto y vigente, sin seguimiento habilitado en el contrato o sin el consentimiento de la persona devuelve RECHAZADA y NO inserta ni una fila de ubicación (devuelve en vez de lanzar para que el INSERT de la auditoría del rechazo no se vaya con la excepción; el route handler lo traduce a un 403). Un punto que llega antes del intervalo mínimo, fuera de orden o pasado el tope del turno devuelve IGNORADA: eso no es fraude, es una app reportando de más.';
REVOKE ALL ON FUNCTION public.ronda_registrar_ubicacion(DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_registrar_ubicacion(DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, TIMESTAMPTZ, UUID, UUID, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. `ronda_mapa_personas` — R2, en la capa de datos
-- ──────────────────────────────────────────────────────────────────────────────
-- «El mapa nunca muestra una posición vieja como si fuera actual.» Por eso
-- `antiguedad_seg` la calcula ESTA función contra NOW() del servidor, viaja
-- junto a `fuente` y a `en_vivo`, y la pantalla no tiene ninguna forma de
-- dibujar un marcador sin tener las tres cosas en la mano.
--
-- Y es también la otra mitad de R1 en la lectura: solo devuelve personas con
-- TURNO ABIERTO Y VIGENTE. Una posición cuyo turno ya cerró no sale de aquí
-- —sigue en el historial, para el recorrido de ese día—, y la fila de posición
-- actual se borra al cerrar el turno, así que no hay dos verdades.
--
-- Una sola consulta con agregación en SQL: nada de traer filas para contar en
-- JavaScript. Con una fila por persona, esto no se acerca al corte de 8 s.
CREATE OR REPLACE FUNCTION public.ronda_mapa_personas(
  p_grupo UUID DEFAULT NULL,
  p_sede  UUID DEFAULT NULL
) RETURNS TABLE (
  persona_id       UUID,
  persona_nombre   TEXT,
  turno_id         UUID,
  grupo_id         UUID,
  grupo_nombre     TEXT,
  sede_id          UUID,
  sede_nombre      TEXT,
  ruta_id          UUID,
  ruta_codigo      TEXT,
  punto_id         UUID,
  punto_nombre     TEXT,
  lat              DECIMAL,
  lng              DECIMAL,
  precision_metros DECIMAL,
  velocidad_kmh    DECIMAL,
  rumbo            DECIMAL,
  fuente           TEXT,
  capturado_at     TIMESTAMPTZ,
  antiguedad_seg   INT,
  frescura_seg     INT,
  en_vivo          BOOLEAN,
  turno_inicio_at  TIMESTAMPTZ,
  turno_fin_previsto_at TIMESTAMPTZ,
  puntos_registrados INT,
  metros_recorridos  DECIMAL
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    u.persona_id,
    btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, '')) AS persona_nombre,
    u.turno_id, u.grupo_id, g.nombre::text AS grupo_nombre,
    u.sede_id, s.nombre::text AS sede_nombre,
    u.ruta_id, r.codigo::text AS ruta_codigo,
    u.punto_id, pt.nombre::text AS punto_nombre,
    u.lat, u.lng, u.precision_metros, u.velocidad_kmh, u.rumbo,
    u.fuente::text,
    u.capturado_at,
    -- Calculada AQUÍ, en el servidor. El reloj del navegador no se usa (R2).
    GREATEST(0, round(EXTRACT(EPOCH FROM (NOW() - u.capturado_at)))::int) AS antiguedad_seg,
    COALESCE(gr.ubicacion_frescura_seg, 300) AS frescura_seg,
    (EXTRACT(EPOCH FROM (NOW() - u.capturado_at)) <= COALESCE(gr.ubicacion_frescura_seg, 300))
      AS en_vivo,
    t.inicio_at, t.fin_previsto_at, t.puntos_registrados, t.metros_recorridos
  FROM public.persona_ubicacion_actual u
  JOIN public.ronda_turnos t ON t.id = u.turno_id
  JOIN public.personas pe    ON pe.id = u.persona_id
  JOIN public.grupos_contrato g ON g.id = u.grupo_id
  LEFT JOIN public.sedes s   ON s.id = u.sede_id
  LEFT JOIN public.ronda_rutas r ON r.id = u.ruta_id
  LEFT JOIN public.ronda_puntos pt ON pt.id = u.punto_id
  LEFT JOIN public.grupo_reglas gr ON gr.grupo_id = u.grupo_id
 WHERE public.ronda_mapa_acceso()
   AND u.grupo_id IN (SELECT public.auth_grupos())
   -- R1 en la lectura: solo turnos abiertos y vigentes.
   AND t.estado = 'ABIERTO'
   AND NOW() BETWEEN t.inicio_at AND t.fin_previsto_at
   -- El contrato tiene que seguir permitiendo el seguimiento: revocarlo apaga
   -- el mapa en el acto, sin tener que borrar ni una fila.
   AND COALESCE(gr.comparte_seguimiento_vivo, false)
   AND (p_grupo IS NULL OR u.grupo_id = p_grupo)
   AND (p_sede  IS NULL OR u.sede_id  = p_sede)
 ORDER BY persona_nombre, u.persona_id
$$;
COMMENT ON FUNCTION public.ronda_mapa_personas(UUID, UUID) IS
  'Las personas EN TURNO con su última posición, para el mapa. Cumple R2: devuelve antiguedad_seg calculada en el servidor, la fuente y en_vivo según la frescura del contrato, así que la pantalla no puede dibujar un marcador sin saber de cuándo es. Y R1 en la lectura: una posición cuyo turno ya cerró no sale de aquí.';
GRANT EXECUTE ON FUNCTION public.ronda_mapa_personas(UUID, UUID) TO authenticated;

-- Las personas en turno SIN ninguna posición. R2 dice que esas aparecen «en la
-- lista como sin ubicación, no en el mapa», así que van por separado a
-- propósito: si vinieran en la misma función, la pantalla tendría que acordarse
-- de filtrarlas y antes o después se dibujarían en el centro del mapa.
CREATE OR REPLACE FUNCTION public.ronda_mapa_sin_ubicacion(
  p_grupo UUID DEFAULT NULL,
  p_sede  UUID DEFAULT NULL
) RETURNS TABLE (
  persona_id     UUID,
  persona_nombre TEXT,
  turno_id       UUID,
  grupo_id       UUID,
  sede_id        UUID,
  sede_nombre    TEXT,
  turno_inicio_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.persona_id,
         btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, '')),
         t.id, t.grupo_id, t.sede_id, s.nombre::text, t.inicio_at
    FROM public.ronda_turnos t
    JOIN public.personas pe ON pe.id = t.persona_id
    LEFT JOIN public.sedes s ON s.id = t.sede_id
   WHERE public.ronda_mapa_acceso()
     AND t.grupo_id IN (SELECT public.auth_grupos())
     AND t.estado = 'ABIERTO'
     AND NOW() BETWEEN t.inicio_at AND t.fin_previsto_at
     AND NOT EXISTS (SELECT 1 FROM public.persona_ubicacion_actual u WHERE u.turno_id = t.id)
     AND (p_grupo IS NULL OR t.grupo_id = p_grupo)
     AND (p_sede  IS NULL OR t.sede_id  = p_sede)
   ORDER BY 2, t.persona_id
$$;
COMMENT ON FUNCTION public.ronda_mapa_sin_ubicacion(UUID, UUID) IS
  'Personas en turno de las que no se tiene NINGUNA posición. Van aparte del mapa porque R2 dice que aparecen en la lista como «sin ubicación» y NO en el mapa: en la misma función acabarían dibujadas en el centro del mapa el día que alguien olvide filtrarlas.';
GRANT EXECUTE ON FUNCTION public.ronda_mapa_sin_ubicacion(UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. `ronda_recorrido` — el replay de un turno
-- ──────────────────────────────────────────────────────────────────────────────
-- Lee el historial de UN turno, nunca el historial entero. Y lo DIEZMA en SQL:
-- si el turno tiene más puntos que el tope pedido, devuelve uno de cada N
-- conservando siempre el primero y el último. Un turno de 12 horas reportando
-- cada minuto son 720 puntos; mandar eso a Leaflet para dibujar una línea de
-- 400 px es gastar red y memoria para nada, y es la clase de consulta que se
-- come los 8 s cuando alguien pide un mes.
--
-- Pide `ver_recorrido_personas` (no basta `ver_mapa_operativo`): reconstruir
-- los pasos de una persona es tratamiento de datos de desempeño (§10.3).
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
  'El recorrido de UN turno para el replay, diezmado en SQL al tope pedido conservando el primero, el último y todo registro hecho en un punto de control. Pide ver_recorrido_personas: reconstruir los pasos de alguien no es lo mismo que ver el mapa del día.';
REVOKE ALL ON FUNCTION public.ronda_recorrido(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_recorrido(UUID, INT) TO authenticated;

-- Los turnos que se pueden reproducir, con su resumen. Lista paginada y contada
-- en SQL: el selector del replay no se trae turnos para contarlos.
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
   WHERE public.ronda_recorrido_acceso()
     AND t.grupo_id IN (SELECT public.auth_grupos())
     AND t.puntos_registrados > 0
     AND (p_grupo IS NULL OR t.grupo_id = p_grupo)
     AND (p_sede  IS NULL OR t.sede_id  = p_sede)
     AND (p_desde IS NULL OR t.inicio_at >= p_desde::timestamptz)
     AND (p_hasta IS NULL OR t.inicio_at < (p_hasta + 1)::timestamptz)
   ORDER BY t.inicio_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 100), 500))
$$;
COMMENT ON FUNCTION public.ronda_turnos_recorribles(UUID, UUID, DATE, DATE, INT) IS
  'Turnos con rastro que se pueden reproducir, con su resumen ya calculado (puntos y metros vienen del turno, no de un COUNT sobre el historial). Con tope de filas: el selector del replay nunca pide «todos».';
GRANT EXECUTE ON FUNCTION public.ronda_turnos_recorribles(UUID, UUID, DATE, DATE, INT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. `ronda_proxima_parada` — el gancho que F10 necesita
-- ──────────────────────────────────────────────────────────────────────────────
-- F10 («próxima ubicación por WhatsApp») tiene que poder contestar, para una
-- persona, cuál es su siguiente parada y cómo llegar. Eso se resuelve AQUÍ y
-- una sola vez, para que el bot no reimplemente la regla de cuál es «la
-- siguiente» —que no es obvia: es la primera PENDIENTE o EN_CURSO por número
-- de parada, de la ruta de HOY de esa persona, y «hoy» es el día en Bogotá.
--
-- Devuelve JSONB y no una fila porque el bot manda un mensaje, no pinta una
-- tabla, y porque así F10 puede crecer el contenido sin cambiar la firma.
-- `estado` dice siempre qué pasó: SIN_RUTA, RUTA_TERMINADA o PARADA.
CREATE OR REPLACE FUNCTION public.ronda_proxima_parada(p_persona UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoy    DATE := (NOW() AT TIME ZONE 'America/Bogota')::date;
  v_ruta   RECORD;
  v_parada RECORD;
  v_pend   INT;
BEGIN
  SELECT r.id, r.codigo, r.nombre, r.grupo_id, r.sede_id, r.estado
    INTO v_ruta
    FROM public.ronda_rutas r
   WHERE r.persona_id = p_persona
     AND r.activo
     AND r.fecha = v_hoy
     AND r.estado IN ('PLANEADA','EN_CURSO')
   ORDER BY (r.estado = 'EN_CURSO') DESC, r.hora_inicio NULLS LAST, r.created_at
   LIMIT 1;

  IF v_ruta.id IS NULL THEN
    RETURN jsonb_build_object('estado', 'SIN_RUTA', 'fecha', v_hoy);
  END IF;

  SELECT count(*) INTO v_pend FROM public.ronda_ruta_paradas pa
   WHERE pa.ruta_id = v_ruta.id AND pa.estado IN ('PENDIENTE','EN_CURSO');

  SELECT pa.id, pa.numero_parada, pa.hora_estimada, pa.tolerancia_min, pa.estado,
         pt.id AS punto_id, pt.codigo AS punto_codigo, pt.nombre AS punto_nombre,
         pt.descripcion, pt.piso, pt.lat, pt.lng, pt.fotos_referencia,
         z.nombre AS zona_nombre, s.nombre AS sede_nombre
    INTO v_parada
    FROM public.ronda_ruta_paradas pa
    JOIN public.ronda_puntos pt ON pt.id = pa.punto_id
    LEFT JOIN public.ronda_zonas z ON z.id = pt.zona_id
    LEFT JOIN public.sedes s ON s.id = pt.sede_id
   WHERE pa.ruta_id = v_ruta.id
     AND pa.estado IN ('PENDIENTE','EN_CURSO')
   ORDER BY pa.numero_parada
   LIMIT 1;

  IF v_parada.id IS NULL THEN
    RETURN jsonb_build_object(
      'estado', 'RUTA_TERMINADA', 'fecha', v_hoy,
      'ruta', jsonb_build_object('id', v_ruta.id, 'codigo', v_ruta.codigo,
                                 'nombre', v_ruta.nombre));
  END IF;

  RETURN jsonb_build_object(
    'estado', 'PARADA',
    'fecha', v_hoy,
    'paradas_pendientes', v_pend,
    'ruta', jsonb_build_object('id', v_ruta.id, 'codigo', v_ruta.codigo,
                               'nombre', v_ruta.nombre, 'estado', v_ruta.estado,
                               'grupo_id', v_ruta.grupo_id, 'sede_id', v_ruta.sede_id),
    'parada', jsonb_build_object(
      'id', v_parada.id, 'numero', v_parada.numero_parada,
      'estado', v_parada.estado,
      'hora_estimada', v_parada.hora_estimada,
      'tolerancia_min', v_parada.tolerancia_min),
    'punto', jsonb_build_object(
      'id', v_parada.punto_id, 'codigo', v_parada.punto_codigo,
      'nombre', v_parada.punto_nombre, 'como_llegar', v_parada.descripcion,
      'piso', v_parada.piso, 'zona', v_parada.zona_nombre,
      'sede', v_parada.sede_nombre,
      'lat', v_parada.lat, 'lng', v_parada.lng,
      'fotos_referencia', to_jsonb(COALESCE(v_parada.fotos_referencia, '{}'::text[])))
  );
END $$;
COMMENT ON FUNCTION public.ronda_proxima_parada(UUID) IS
  'La siguiente parada de la ruta de HOY (día en Bogotá) de una persona, con el punto, cómo llegar y sus fotos de referencia. ES EL GANCHO DE F10: el bot de «próxima ubicación» llama esto y no reimplementa la regla de cuál es la siguiente. Devuelve estado SIN_RUTA | RUTA_TERMINADA | PARADA.';
REVOKE ALL ON FUNCTION public.ronda_proxima_parada(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_proxima_parada(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. Las dos tareas del cron
-- ──────────────────────────────────────────────────────────────────────────────
-- R1: «la purga es un trabajo del cron, no una tarea manual».
CREATE OR REPLACE FUNCTION public.ronda_retencion_ubicacion_meses(p_grupo UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT r.retencion_ubicacion_meses FROM public.grupo_reglas r
                    WHERE r.grupo_id = p_grupo), 3)
$$;
COMMENT ON FUNCTION public.ronda_retencion_ubicacion_meses(UUID) IS
  'Meses de retención del RASTRO de ubicación del contrato. 3 por defecto, parámetro y no constante. La evidencia de la visita tiene su propia retención (ronda_retencion_meses, 12).';
GRANT EXECUTE ON FUNCTION public.ronda_retencion_ubicacion_meses(UUID) TO authenticated;

-- Borra el rastro vencido POR LOTES. Devuelve cuántas filas borró, para que el
-- cron sepa si tiene que volver a llamar. Sin lote, un primer barrido de meses
-- de datos se quedaría colgado contra el corte de 8 s.
CREATE OR REPLACE FUNCTION public.ronda_purgar_ubicacion(
  p_lote INT DEFAULT 5000
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  WITH vencidas AS (
    SELECT h.id
      FROM public.persona_ubicacion_historial h
     WHERE h.capturado_at
           < NOW() - make_interval(months => public.ronda_retencion_ubicacion_meses(h.grupo_id))
     ORDER BY h.capturado_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_lote, 5000), 50000))
  )
  DELETE FROM public.persona_ubicacion_historial h
   USING vencidas v WHERE h.id = v.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.ronda_purgar_ubicacion(INT) IS
  'Borra por lotes el rastro de ubicación que pasó la retención de SU contrato y devuelve cuántas filas borró, para que el cron sepa si debe volver a llamar. El resumen del turno (metros y nº de registros) NO se borra: es lo que deja constancia de que el turno existió cuando su rastro ya no está.';
REVOKE ALL ON FUNCTION public.ronda_purgar_ubicacion(INT) FROM PUBLIC;

-- Cierra los turnos cuya hora prevista ya pasó. No es cosmético: el índice
-- único de «un turno abierto por persona» mira el estado, no la hora, así que
-- un turno vencido sin cerrar impide abrir el siguiente. La ubicación ya estaba
-- rechazada desde `fin_previsto_at` por `ronda_turno_abierto()`, que no se fía
-- del estado solo.
CREATE OR REPLACE FUNCTION public.ronda_turnos_cerrar_vencidos(
  p_lote INT DEFAULT 500
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids UUID[]; v_n INT;
BEGIN
  -- El UPDATE primero y sus ids a un arreglo: `GET DIAGNOSTICS` después de un
  -- CTE que acaba en DELETE contaría las posiciones borradas, no los turnos
  -- cerrados, y el cron usa este número para saber si debe volver a llamar.
  WITH vencidos AS (
    SELECT t.id FROM public.ronda_turnos t
     WHERE t.estado = 'ABIERTO' AND t.fin_previsto_at < NOW()
     ORDER BY t.fin_previsto_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_lote, 500), 5000))
  ), cerrados AS (
    UPDATE public.ronda_turnos t
       SET estado = 'CERRADO', fin_at = t.fin_previsto_at, cierre_motivo = 'AUTOMATICO'
     WHERE t.id IN (SELECT id FROM vencidos)
    RETURNING t.id
  )
  SELECT array_agg(id) INTO v_ids FROM cerrados;

  v_n := COALESCE(array_length(v_ids, 1), 0);
  IF v_n > 0 THEN
    DELETE FROM public.persona_ubicacion_actual u WHERE u.turno_id = ANY(v_ids);
  END IF;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.ronda_turnos_cerrar_vencidos(INT) IS
  'Cierra los turnos cuya hora prevista pasó y borra su posición en vivo. La ubicación ya se rechazaba desde esa hora (ronda_turno_abierto no se fía del estado solo); esto limpia la fila del mapa y libera el índice único para el turno siguiente.';
REVOKE ALL ON FUNCTION public.ronda_turnos_cerrar_vencidos(INT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. Escrituras de rutas desde la consola
-- ──────────────────────────────────────────────────────────────────────────────
-- La ruta se arma desde la consola, así que su INSERT/UPDATE sí se abre a
-- `authenticated` con política (no hay cola offline que armar rutas). Lo que va
-- por RPC es ordenar las paradas de golpe, porque `ux_ronda_paradas_numero`
-- impide renumerar fila a fila: pasar la 2 a la 3 choca con la 3 que ya existe.
CREATE OR REPLACE FUNCTION public.ronda_ruta_ordenar(
  p_ruta    UUID,
  p_paradas UUID[]
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grupo UUID; v_i INT := 0;
BEGIN
  SELECT r.grupo_id INTO v_grupo FROM public.ronda_rutas r WHERE r.id = p_ruta;
  IF v_grupo IS NULL THEN RAISE EXCEPTION 'La ruta no existe.'; END IF;
  IF NOT (public.ronda_rutas_gestiona() AND public.auth_ve_grupo(v_grupo)) THEN
    RAISE EXCEPTION 'No tienes permiso para ordenar las paradas de esa ruta.';
  END IF;
  IF p_paradas IS NULL OR array_length(p_paradas, 1) IS NULL THEN
    RAISE EXCEPTION 'No se recibió ninguna parada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ronda_ruta_paradas pa
     WHERE pa.ruta_id = p_ruta AND pa.id <> ALL(p_paradas)
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_paradas) x(id)
     WHERE NOT EXISTS (SELECT 1 FROM public.ronda_ruta_paradas pa
                        WHERE pa.id = x.id AND pa.ruta_id = p_ruta)
  ) THEN
    RAISE EXCEPTION 'La lista de paradas no coincide con las de la ruta: ordenar tiene que mandar TODAS.';
  END IF;

  -- Una sola pasada, con la restricción de unicidad diferida al final de la
  -- transacción: a mitad del UPDATE hay números repetidos, y eso está bien
  -- mientras al terminar no queden. Es para esto que la restricción es
  -- DEFERRABLE (ver la nota junto a `ux_ronda_paradas_numero`).
  SET CONSTRAINTS ux_ronda_paradas_numero DEFERRED;
  UPDATE public.ronda_ruta_paradas pa
     SET numero_parada = x.n
    FROM unnest(p_paradas) WITH ORDINALITY AS x(id, n)
   WHERE pa.id = x.id AND pa.ruta_id = p_ruta;
  GET DIAGNOSTICS v_i = ROW_COUNT;
  RETURN v_i;
END $$;
COMMENT ON FUNCTION public.ronda_ruta_ordenar(UUID, UUID[]) IS
  'Renumera TODAS las paradas de una ruta en el orden del arreglo, en una pasada y con ux_ronda_paradas_numero diferida: a mitad del UPDATE hay números repetidos y eso es válido mientras al terminar no queden.';
REVOKE ALL ON FUNCTION public.ronda_ruta_ordenar(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_ruta_ordenar(UUID, UUID[]) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. RLS
-- ──────────────────────────────────────────────────────────────────────────────
-- `auth_permiso()` también en las LECTURAS, que es la regla del repositorio, y
-- alcance por contrato con `auth_grupos()`.
--
-- La ubicación tiene una regla de lectura que ninguna otra tabla del módulo
-- tiene: **lo propio siempre se ve** (una persona tiene derecho a ver qué se
-- registró de ella, Ley 1581) y **el resto solo con permiso, dentro de su
-- alcance y si el contrato permite el seguimiento**. Las escrituras no se abren
-- a nadie: van por `ronda_registrar_ubicacion`, que es donde vive R1.
ALTER TABLE ronda_turnos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_rutas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_ruta_paradas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_ubicacion_actual    ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_ubicacion_historial ENABLE ROW LEVEL SECURITY;

/** ¿Puede este usuario ver la ubicación de las personas de este contrato?
 *  Tres condiciones a la vez: el permiso, el alcance y que el CONTRATO permita
 *  el seguimiento. Revocar `comparte_seguimiento_vivo` apaga la lectura en el
 *  acto sin borrar una sola fila — que es lo que un contrato que retira el
 *  consentimiento necesita. */
CREATE OR REPLACE FUNCTION public.ronda_ubicacion_puede_ver(p_grupo UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_mapa_acceso()
     AND public.auth_ve_grupo(p_grupo)
     AND COALESCE((SELECT r.comparte_seguimiento_vivo FROM public.grupo_reglas r
                    WHERE r.grupo_id = p_grupo), false)
$$;
COMMENT ON FUNCTION public.ronda_ubicacion_puede_ver(UUID) IS
  'TRUE si el usuario puede leer la ubicación de las personas de ese contrato: permiso + alcance + el contrato permitiéndolo. Apagar comparte_seguimiento_vivo apaga la lectura sin borrar ninguna fila.';
GRANT EXECUTE ON FUNCTION public.ronda_ubicacion_puede_ver(UUID) TO authenticated;

DROP POLICY IF EXISTS ronda_turnos_read ON ronda_turnos;
CREATE POLICY ronda_turnos_read ON ronda_turnos
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.auth_permiso_any('{ver_mapa_operativo,ver_recorrido_personas,ver_rutas_ronda,gestionar_rutas_ronda,ver_visitas_rondas,gestionar_visitas_rondas}'::text[]))
      AND grupo_id IN (SELECT public.auth_grupos()))
    OR usuario_id = (SELECT auth.uid())
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- Abrir y cerrar turno van por RPC (ahí está R1 y el tope de duración). Lo
-- único que se abre es el UPDATE de la consola para anular o corregir.
DROP POLICY IF EXISTS ronda_turnos_update ON ronda_turnos;
CREATE POLICY ronda_turnos_update ON ronda_turnos
  FOR UPDATE TO authenticated
  USING ((SELECT public.ronda_rutas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()))
  WITH CHECK ((SELECT public.ronda_rutas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()));

DROP POLICY IF EXISTS ronda_rutas_read ON ronda_rutas;
CREATE POLICY ronda_rutas_read ON ronda_rutas
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.auth_permiso_any('{ver_rutas_ronda,gestionar_rutas_ronda,ver_mapa_operativo}'::text[]))
      AND grupo_id IN (SELECT public.auth_grupos()))
    -- La ruta propia se ve sin permiso: el conserje tiene que poder ver qué le
    -- toca hoy, y pedirle una clave de consola para eso sería absurdo.
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS ronda_rutas_write ON ronda_rutas;
CREATE POLICY ronda_rutas_write ON ronda_rutas
  FOR ALL TO authenticated
  USING ((SELECT public.ronda_rutas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()))
  WITH CHECK ((SELECT public.ronda_rutas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()));

DROP POLICY IF EXISTS ronda_paradas_read ON ronda_ruta_paradas;
CREATE POLICY ronda_paradas_read ON ronda_ruta_paradas
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.auth_permiso_any('{ver_rutas_ronda,gestionar_rutas_ronda,ver_mapa_operativo}'::text[]))
      AND grupo_id IN (SELECT public.auth_grupos()))
    OR ruta_id IN (SELECT r.id FROM public.ronda_rutas r
                    JOIN public.personas pe ON pe.id = r.persona_id
                   WHERE pe.usuario_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS ronda_paradas_write ON ronda_ruta_paradas;
CREATE POLICY ronda_paradas_write ON ronda_ruta_paradas
  FOR ALL TO authenticated
  USING ((SELECT public.ronda_rutas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()))
  WITH CHECK ((SELECT public.ronda_rutas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()));

-- Ubicación: SOLO LECTURA para `authenticated`, y con las tres condiciones.
-- Sin política de INSERT/UPDATE/DELETE, esos comandos quedan prohibidos y el
-- único camino de escritura es la RPC — que es lo que hace que R1 no se pueda
-- esquivar escribiendo directo desde el navegador.
DROP POLICY IF EXISTS persona_ubicacion_actual_read ON persona_ubicacion_actual;
CREATE POLICY persona_ubicacion_actual_read ON persona_ubicacion_actual
  FOR SELECT TO authenticated
  USING (
    (SELECT public.ronda_ubicacion_puede_ver(grupo_id))
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS persona_ubicacion_historial_read ON persona_ubicacion_historial;
CREATE POLICY persona_ubicacion_historial_read ON persona_ubicacion_historial
  FOR SELECT TO authenticated
  USING (
    -- El RASTRO pide la clave del recorrido, no la del mapa: son dos cosas
    -- distintas (§10.3) y por eso aquí no vale `ver_mapa_operativo`.
    ((SELECT public.ronda_recorrido_acceso())
      AND grupo_id IN (SELECT public.auth_grupos())
      AND COALESCE((SELECT r.comparte_seguimiento_vivo FROM public.grupo_reglas r
                     WHERE r.grupo_id = persona_ubicacion_historial.grupo_id), false))
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. Las claves de permiso, sembradas en los roles de administración
-- ──────────────────────────────────────────────────────────────────────────────
-- /roles es la única fuente de verdad, así que esto es solo el arranque: las
-- claves se reparten desde la pantalla. `auth_permiso()` ya deja pasar a
-- SUPER_ADMIN y ADMIN por `usuarios.rol`, así que esos no hay que sembrarlos.
-- Los nombres de rol son los de la pantalla ('Supervisor de Conserjería'), como
-- ya hacen F3 y F4 con 'Auditor'.
--
-- `ver_recorrido_personas` NO se siembra en NINGÚN rol, a propósito: reproducir
-- los pasos de una persona es tratamiento de datos de desempeño (§10.3) y
-- tiene que ser una decisión consciente de quien administra, con su contexto,
-- no algo que venga encendido de fábrica. Quien la necesite, la enciende en
-- /roles y queda registrado que alguien la encendió.
DO $$ BEGIN
  IF to_regclass('public.roles') IS NULL THEN RETURN; END IF;

  -- Quien coordina la operación: ve el mapa del día y arma las rutas.
  UPDATE public.roles
     SET permisos = COALESCE(permisos, '{}'::jsonb)
                    || '{"ver_mapa_operativo": true, "ver_rutas_ronda": true,
                         "gestionar_rutas_ronda": true}'::jsonb
   WHERE nombre IN ('Supervisor de Conserjería', 'Coordinador');

  -- Quien hace la ronda: manda su propia ubicación y ve su ruta.
  UPDATE public.roles
     SET permisos = COALESCE(permisos, '{}'::jsonb)
                    || '{"reportar_ubicacion_campo": true, "ver_rutas_ronda": true}'::jsonb
   WHERE nombre IN ('Conserje', 'Técnico de Mantenimiento');

  -- El Auditor mira sin tocar (mismo criterio que PQRS, F3 y F4), pero solo la
  -- RUTA planeada: la ubicación de las personas no se le abre de oficio.
  UPDATE public.roles
     SET permisos = COALESCE(permisos, '{}'::jsonb) || '{"ver_rutas_ronda": true}'::jsonb
   WHERE nombre = 'Auditor';
END $$;

-- =============================================================================
-- FIN F8
-- =============================================================================
