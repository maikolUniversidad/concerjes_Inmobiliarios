-- =============================================================================
-- PUNTOS QR — F10: MENSAJERÍA MASIVA INDIVIDUAL, MENÚ DEL BOT Y PRÓXIMA PARADA
-- =============================================================================
-- Alcance (§4.4 del complemento 2):
--   · `crm_envios`          — la audiencia (contrato, sede, turno, rol, lista o
--                             personas sueltas), el contenido, la programación,
--                             el costo estimado y el estado del envío.
--   · `crm_envio_destinos`  — UNA FILA POR PERSONA, con su estado y su marca de
--                             emergencia. Nunca un grupo de WhatsApp.
--   · `crm_menu_opciones`   — el menú del bot por contrato y por rol, hasta 10
--                             opciones (lo que admite una lista de WhatsApp).
--
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO:
--   · NO escribe un segundo control de caudal. El ritmo del número (20 msj/s
--     fijos en coexistencia, 15 de trabajo) lo impone `procesarSalida` de F9.
--     Aquí sólo se REPARTE la hora de cada destino con el mismo número de
--     mensajes por segundo, para que el buzón de salida no reciba 800 filas con
--     la misma marca de tiempo. El escalonado es obligatorio, no una mejora.
--   · NO manda un mensaje por su cuenta. Todo sale por `whatsapp_encolar()`,
--     que es la única puerta y la que pasa el portero (bloqueo, plantilla
--     aprobada, ventana de 24 h, jornada y consentimiento).
--   · NO crea `crm_casos`, `crm_etiquetas`, `crm_caso_etiquetas`,
--     `crm_asignaciones`, `crm_sla` ni `crm_sla_reglas`: son de F11.
--
-- LA JORNADA (Ley 2191 de 2022) se aplica DOS VECES, como exige la §4.4:
--   1. antes de encolar, en `crm_envio_tomar_lote()`: lo que cae fuera de la
--      jornada del contrato se APLAZA a la siguiente ventana en vez de nacer
--      omitido, y queda registrado en `ronda_eventos`;
--   2. al enviar, en el portero de F9, que vuelve a mirar.
--   La emergencia salta el bloqueo y exige quién la autorizó y por qué.
--
-- EL OPT-IN es `persona_consentimientos` tipo `WHATSAPP`. Sin esa fila la
-- persona no entra en ninguna audiencia: queda EXCLUIDO con su motivo, visible
-- en la consola, en vez de desaparecer sin explicación.
--
-- Idempotente: se puede aplicar dos veces sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Permisos de la fase
-- ──────────────────────────────────────────────────────────────────────────────
-- Tres claves nuevas, planas y en snake_case (una clave con punto no existiría
-- en el catálogo de /roles y `auth_permiso()` no la encontraría):
--
--   · `ver_envios_whatsapp`       — ver los envíos y sus destinos.
--   · `gestionar_envios_whatsapp` — crear, calcular, aprobar y cancelar.
--   · `gestionar_menu_whatsapp`   — configurar el menú del bot.
--
-- La EMERGENCIA fuera de jornada NO tiene clave propia: la autoriza quien tiene
-- `gestionar_whatsapp`, que es lo que F9 ya definió para eso. Inventar una
-- cuarta clave repartiría la misma decisión en dos sitios.
--
-- Las llamadas van envueltas en `(select …)` dentro de las policies para que se
-- evalúen una vez por consulta y no una por fila (migración 20261028000001).
CREATE OR REPLACE FUNCTION public.crm_envios_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_envios_whatsapp,gestionar_envios_whatsapp}'::text[])
$$;
COMMENT ON FUNCTION public.crm_envios_acceso() IS
  'Lee los envíos masivos de WhatsApp y sus destinos, dentro de su alcance de contratos.';
GRANT EXECUTE ON FUNCTION public.crm_envios_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_envios_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_envios_whatsapp')
$$;
COMMENT ON FUNCTION public.crm_envios_gestiona() IS
  'Crea, calcula la audiencia, aprueba y cancela un envío masivo. Un envío a una sede entera le llega al celular personal de cientos de personas: no es una lectura.';
GRANT EXECUTE ON FUNCTION public.crm_envios_gestiona() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_menu_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_menu_whatsapp')
$$;
COMMENT ON FUNCTION public.crm_menu_gestiona() IS
  'Configura el menú del bot por contrato y rol. Va aparte de gestionar_whatsapp: cambiar el menú cambia lo que ve toda la operación al escribir MENÚ.';
GRANT EXECUTE ON FUNCTION public.crm_menu_gestiona() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. `crm_envios` — la audiencia y el contenido
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id NOT NULL` y SIN `sede_id`, literalmente como manda la §2.4: «la
-- audiencia siempre es de un contrato». La sede es un FILTRO de la audiencia
-- (`audiencia_sedes`), no el eje de la fila.
--
-- POR QUÉ `audiencia_alcance` Y NO SÓLO LOS FILTROS: sin un alcance explícito,
-- un envío que sólo nombra tres personas sueltas no se distingue de un envío a
-- todo el contrato con tres personas anotadas al margen. El alcance dice de
-- dónde SALE la lista; `audiencia_cargos` y `audiencia_turno` la RECORTAN,
-- cualquiera sea el alcance.
--
-- `audiencia_cargos` es TEXT[] y no un arreglo de llaves foráneas porque
-- `personas.cargo` es texto libre en esta base: existe la tabla `cargos`, pero
-- `personas` no la referencia. Se compara normalizado (mayúsculas sin espacios
-- de más). El día que `personas` gane `cargo_id`, esta columna se puede
-- convertir sin tocar el resto. Y «rol» aquí es el CARGO de la nómina, no el
-- rol de `/roles`, que es el de los permisos de la consola: son dos cosas
-- distintas y mezclarlas sería un error de alcance.
CREATE TABLE IF NOT EXISTS crm_envios (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id           UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  cuenta_id          UUID NOT NULL REFERENCES whatsapp_cuentas(id) ON DELETE RESTRICT,
  nombre             VARCHAR(140) NOT NULL,
  tipo               VARCHAR(14) NOT NULL DEFAULT 'AVISO'
                     CHECK (tipo IN ('AVISO','RECORDATORIO','INSTRUCCION','CONVOCATORIA','EMERGENCIA')),

  -- ── Audiencia ──────────────────────────────────────────────────────────────
  audiencia_alcance  VARCHAR(10) NOT NULL DEFAULT 'CONTRATO'
                     CHECK (audiencia_alcance IN ('CONTRATO','SEDES','PERSONAS','LISTA')),
  audiencia_sedes    UUID[] NOT NULL DEFAULT '{}',
  audiencia_cargos   TEXT[] NOT NULL DEFAULT '{}',
  audiencia_turno    VARCHAR(12) NOT NULL DEFAULT 'CUALQUIERA'
                     CHECK (audiencia_turno IN ('CUALQUIERA','EN_TURNO','FUERA_TURNO')),
  audiencia_lista    VARCHAR(60) REFERENCES directorio_listas(codigo)
                     ON UPDATE CASCADE ON DELETE SET NULL,
  audiencia_personas UUID[] NOT NULL DEFAULT '{}',

  -- ── Contenido ──────────────────────────────────────────────────────────────
  plantilla_nombre   VARCHAR(80),
  variables          JSONB NOT NULL DEFAULT '[]'::jsonb,
  texto              TEXT,
  prioridad          SMALLINT NOT NULL DEFAULT 8 CHECK (prioridad BETWEEN 7 AND 9),

  -- ── Programación y ritmo ───────────────────────────────────────────────────
  programado_para    TIMESTAMPTZ,
  escalon_mps        NUMERIC(5,2) CHECK (escalon_mps IS NULL OR (escalon_mps > 0 AND escalon_mps <= 20)),

  -- ── Emergencia (Ley 2191) ──────────────────────────────────────────────────
  es_emergencia      BOOLEAN NOT NULL DEFAULT false,
  emergencia_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  emergencia_motivo  TEXT,

  -- ── Costo estimado (§4.1: se muestra ANTES de confirmar) ───────────────────
  costo_unitario     NUMERIC(10,4) CHECK (costo_unitario IS NULL OR costo_unitario >= 0),
  moneda             VARCHAR(3) NOT NULL DEFAULT 'COP',
  costo_estimado     NUMERIC(14,4),

  -- ── Estado y totales ───────────────────────────────────────────────────────
  estado             VARCHAR(10) NOT NULL DEFAULT 'BORRADOR'
                     CHECK (estado IN ('BORRADOR','CALCULADO','APROBADO','EN_CURSO','COMPLETADO','CANCELADO')),
  total_destinos     INT NOT NULL DEFAULT 0 CHECK (total_destinos >= 0),
  total_excluidos    INT NOT NULL DEFAULT 0 CHECK (total_excluidos >= 0),
  resumen            JSONB NOT NULL DEFAULT '{}'::jsonb,

  calculado_at       TIMESTAMPTZ,
  aprobado_at        TIMESTAMPTZ,
  aprobado_por       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  iniciado_at        TIMESTAMPTZ,
  terminado_at       TIMESTAMPTZ,
  cancelado_at       TIMESTAMPTZ,
  cancelado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  cancelacion_motivo TEXT,
  created_by         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un envío de emergencia dice QUIÉN lo autorizó y POR QUÉ. Es requisito de la
  -- Ley 2191, no comodidad de auditoría: es el único camino para escribirle a
  -- alguien fuera de su jornada.
  CONSTRAINT ck_crm_envio_emergencia CHECK (
    es_emergencia = false
    OR (emergencia_por IS NOT NULL AND NULLIF(btrim(emergencia_motivo), '') IS NOT NULL)
  ),
  -- Algo hay que mandar: o un texto, o una plantilla.
  CONSTRAINT ck_crm_envio_cuerpo CHECK (
    NULLIF(btrim(texto), '') IS NOT NULL OR NULLIF(btrim(plantilla_nombre), '') IS NOT NULL
  ),
  CONSTRAINT ck_crm_envio_variables CHECK (jsonb_typeof(variables) = 'array'),
  CONSTRAINT ck_crm_envio_cancelado CHECK (
    estado <> 'CANCELADO' OR cancelado_at IS NOT NULL
  ),
  -- Cada alcance exige lo suyo: un envío «a estas sedes» sin sedes es un envío
  -- a nadie que parece un envío a todos.
  CONSTRAINT ck_crm_envio_alcance CHECK (
    CASE audiencia_alcance
      WHEN 'SEDES'    THEN cardinality(audiencia_sedes) > 0
      WHEN 'PERSONAS' THEN cardinality(audiencia_personas) > 0
      WHEN 'LISTA'    THEN audiencia_lista IS NOT NULL
      ELSE true
    END
  )
);
CREATE INDEX IF NOT EXISTS idx_crm_envios_grupo ON crm_envios(grupo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_envios_estado ON crm_envios(estado, programado_para)
  WHERE estado IN ('APROBADO','EN_CURSO');
CREATE INDEX IF NOT EXISTS idx_crm_envios_upd ON crm_envios(updated_at);

DROP TRIGGER IF EXISTS tr_crm_envios_upd ON crm_envios;
CREATE TRIGGER tr_crm_envios_upd BEFORE UPDATE ON crm_envios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE crm_envios IS
  'Un envío masivo de WhatsApp: la audiencia (contrato, sede, turno, rol, lista o personas sueltas), qué se manda, cuándo y a qué ritmo. El destinatario NO es este registro: es una fila por persona en crm_envio_destinos, porque con coexistencia los grupos de WhatsApp no se sincronizan.';
COMMENT ON COLUMN crm_envios.audiencia_alcance IS
  'De dónde SALE la lista: CONTRATO (todo el contrato), SEDES, PERSONAS (sueltas) o LISTA (del directorio). `audiencia_cargos` y `audiencia_turno` la recortan en cualquiera de los cuatro.';
COMMENT ON COLUMN crm_envios.audiencia_cargos IS
  'Cargos de nómina (`personas.cargo`), normalizados en mayúsculas. Vacío = todos. Es el «rol» de la §4.4, que es el cargo del trabajador y NO el rol de /roles (ese es el de los permisos de la consola).';
COMMENT ON COLUMN crm_envios.audiencia_turno IS
  'EN_TURNO usa `ronda_turno_abierto()` de F8: turno ABIERTO y todavía vigente. No hay malla de turno programado en la base (F9 §15), así que «en turno» es el turno realmente abierto, no el que tocaba.';
COMMENT ON COLUMN crm_envios.escalon_mps IS
  'Mensajes por segundo con los que se reparte la hora de cada destino. Si es NULL se usa el caudal de la cuenta; nunca puede superarlo. No es un segundo control de ritmo: el que frena de verdad es el buzón de salida de F9.';
COMMENT ON COLUMN crm_envios.es_emergencia IS
  'Salta el bloqueo por jornada (Ley 2191 art. 3). Exige `emergencia_por` y `emergencia_motivo`, y cada destino queda marcado para que después se vea a quién se le escribió fuera de su jornada y con qué autorización.';
COMMENT ON COLUMN crm_envios.costo_unitario IS
  'Tarifa por mensaje con la que se calcula el costo estimado. Se CONFIGURA a mano: la §8.1 punto 2 dejó abierto de dónde sale la tarifa y Meta no la expone por API para este caso. Si es NULL, el envío no muestra costo en vez de mostrar uno inventado.';
COMMENT ON COLUMN crm_envios.variables IS
  'Variables de la plantilla, en orden, como PLANTILLA de texto: cada entrada es un literal o uno de los marcadores cerrados que resuelve `crm_envio_render()` ({nombre}, {sede}, {punto}…). El valor de cada persona se resuelve al encolar y queda en su destino.';
COMMENT ON COLUMN crm_envios.resumen IS
  'Desglose de la resolución de la audiencia: cuántos entraron y cuántos quedaron fuera por cada motivo. Se calcula EN SQL al resolver (Supabase corta a los 8 s: un envío a una sede entera son muchas filas y no se traen para contarlas).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `crm_envio_destinos` — UNA FILA POR PERSONA
-- ──────────────────────────────────────────────────────────────────────────────
-- Es la pieza que hace que el envío se pueda escalonar y auditar: cada persona
-- tiene su estado, su hora, su mensaje, su costo y su error. Sin esto, un envío
-- a 50 personas sería un botón que sale de golpe y del que no se sabe nada.
--
-- SIN `sede_id`, como dice la §2.4. La sede se sabe por la persona; agregarla
-- aquí sería un tercer sitio donde puede quedar desactualizada.
--
-- `canal_valor` se COPIA al resolver la audiencia y no se vuelve a leer: si la
-- persona cambia de número la semana siguiente, el registro sigue diciendo a qué
-- número se le escribió.
CREATE TABLE IF NOT EXISTS crm_envio_destinos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id         UUID NOT NULL REFERENCES crm_envios(id) ON DELETE CASCADE,
  grupo_id         UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  persona_id       UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  persona_canal_id UUID REFERENCES persona_canales(id) ON DELETE SET NULL,
  canal_valor      VARCHAR(160),
  conversacion_id  UUID REFERENCES crm_conversaciones(id) ON DELETE SET NULL,
  mensaje_id       UUID REFERENCES crm_mensajes(id) ON DELETE SET NULL,
  estado           VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (estado IN ('PENDIENTE','APLAZADO','ENCOLADO','ENVIADO','ENTREGADO',
                                     'LEIDO','RESPONDIDO','FALLIDO','OMITIDO','EXCLUIDO','CANCELADO')),
  exclusion_motivo VARCHAR(20)
                   CHECK (exclusion_motivo IS NULL OR exclusion_motivo IN (
                     'SIN_CANAL','SIN_CONSENTIMIENTO','CANAL_BLOQUEADO','PERSONA_INACTIVA',
                     'FUERA_DEL_CONTRATO','SIN_SEDE')),
  omitido_motivo   TEXT,
  es_emergencia    BOOLEAN NOT NULL DEFAULT false,
  programado_para  TIMESTAMPTZ,
  aplazos          SMALLINT NOT NULL DEFAULT 0 CHECK (aplazos >= 0),
  jornada          JSONB,
  variables        JSONB,
  externo_id       VARCHAR(200),
  costo            NUMERIC(10,4) CHECK (costo IS NULL OR costo >= 0),
  error_codigo     VARCHAR(20),
  error            TEXT,
  encolado_at      TIMESTAMPTZ,
  enviado_at       TIMESTAMPTZ,
  entregado_at     TIMESTAMPTZ,
  leido_at         TIMESTAMPTZ,
  respondido_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- EXCLUIDO y motivo son la misma cosa dicha dos veces: o van juntos, o no van.
  CONSTRAINT ck_crm_destino_excluido CHECK ((estado = 'EXCLUIDO') = (exclusion_motivo IS NOT NULL)),
  -- Quien no está excluido tiene un número al que escribirle.
  CONSTRAINT ck_crm_destino_canal CHECK (
    estado = 'EXCLUIDO' OR NULLIF(btrim(canal_valor), '') IS NOT NULL
  ),
  CONSTRAINT ck_crm_destino_omitido CHECK (
    estado <> 'OMITIDO' OR NULLIF(btrim(omitido_motivo), '') IS NOT NULL
  )
);
-- UNA fila por persona y por envío. No es una optimización: es la regla.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_envio_destino_persona
  ON crm_envio_destinos(envio_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_crm_envio_destinos_estado
  ON crm_envio_destinos(envio_id, estado);
-- El índice de la cola del cron: lo que todavía no salió, por su hora.
CREATE INDEX IF NOT EXISTS idx_crm_envio_destinos_cola
  ON crm_envio_destinos(programado_para, id)
  WHERE estado IN ('PENDIENTE','APLAZADO');
CREATE INDEX IF NOT EXISTS idx_crm_envio_destinos_mensaje
  ON crm_envio_destinos(mensaje_id) WHERE mensaje_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_envio_destinos_conv
  ON crm_envio_destinos(conversacion_id) WHERE conversacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_envio_destinos_persona
  ON crm_envio_destinos(persona_id, created_at DESC);

DROP TRIGGER IF EXISTS tr_crm_envio_destinos_upd ON crm_envio_destinos;
CREATE TRIGGER tr_crm_envio_destinos_upd BEFORE UPDATE ON crm_envio_destinos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE crm_envio_destinos IS
  'Una fila POR PERSONA de un envío masivo, con su estado, su hora dentro del escalonado, su mensaje y su marca de emergencia. Es lo que permite respetar el caudal del número: un envío de 50 personas no sale de golpe.';
COMMENT ON COLUMN crm_envio_destinos.estado IS
  'PENDIENTE (resuelto, esperando su turno) · APLAZADO (cayó fuera de la jornada y espera la siguiente ventana) · ENCOLADO · ENVIADO · ENTREGADO · LEIDO · RESPONDIDO · FALLIDO · OMITIDO (el portero lo frenó, con su motivo) · EXCLUIDO (no entró en la audiencia) · CANCELADO.';
COMMENT ON COLUMN crm_envio_destinos.exclusion_motivo IS
  'Por qué no entró: SIN_CANAL (sin WhatsApp verificado), SIN_CONSENTIMIENTO (sin el opt-in de persona_consentimientos), CANAL_BLOQUEADO, PERSONA_INACTIVA, FUERA_DEL_CONTRATO o SIN_SEDE. Se GUARDA en vez de descartar la fila: un envío que llega a 40 de 50 tiene que decir qué pasó con los otros 10.';
COMMENT ON COLUMN crm_envio_destinos.programado_para IS
  'Su lugar en el escalonado, o la apertura de la siguiente ventana si se aplazó. El cron sólo toma lo que ya venció.';
COMMENT ON COLUMN crm_envio_destinos.jornada IS
  'La respuesta de whatsapp_jornada() del momento en que se decidió: con qué fuente (excepción, contrato o respaldo) y con qué franja. Guardarla es lo que permite explicar un aplazamiento meses después, cuando la regla del contrato ya cambió.';
COMMENT ON COLUMN crm_envio_destinos.es_emergencia IS
  'Este destino concreto salió (o va a salir) fuera de la jornada por la autorización de emergencia del envío. Queda marcado persona por persona.';
COMMENT ON COLUMN crm_envio_destinos.externo_id IS
  'El `wamid` que devolvió WhatsApp. Es con lo que se cruzan los `statuses` de entrega.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `crm_menu_opciones` — el menú del bot por contrato y por rol
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` NULLABLE: NULL = «aplica a todos los contratos», el mismo patrón de
-- `ronda_instructivos` y `ronda_tipos_actividad` (§2.4). `cargo` igual.
--
-- Los límites de las columnas NO son redondeos: `etiqueta` 24 y `descripcion` 72
-- son exactamente lo que admite una fila de lista de WhatsApp (LIMITES de
-- lib/whatsapp/mensajes.ts), y el tope de 10 opciones es el máximo de filas de
-- una lista EN TOTAL. Un menú de 11 opciones no es un menú con una de más: es un
-- mensaje que WhatsApp rechaza.
--
-- `accion` es un CATÁLOGO CERRADO. Un menú configurable que ejecutara texto
-- libre sería una puerta para que quien configura el menú haga actuar al bot;
-- aquí cada opción sólo puede disparar algo que el bot ya sabe hacer.
CREATE TABLE IF NOT EXISTS crm_menu_opciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id         UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  cargo            TEXT,
  orden            SMALLINT NOT NULL DEFAULT 1 CHECK (orden BETWEEN 1 AND 10),
  etiqueta         VARCHAR(24) NOT NULL,
  descripcion      VARCHAR(72),
  accion           VARCHAR(20) NOT NULL
                   CHECK (accion IN ('MIS_PUNTOS','PROXIMA_UBICACION','MI_MAPA','NOVEDAD',
                                     'PQRS','SUPERVISOR','PRIVACIDAD','AYUDA','TEXTO')),
  texto            TEXT,
  requiere_permiso VARCHAR(60),
  activo           BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_crm_menu_etiqueta CHECK (NULLIF(btrim(etiqueta), '') IS NOT NULL),
  CONSTRAINT ck_crm_menu_texto CHECK (
    accion <> 'TEXTO' OR NULLIF(btrim(texto), '') IS NOT NULL
  )
);
-- `NULLS NOT DISTINCT` (PostgreSQL 15+) para que dos opciones «de todos los
-- contratos» no puedan compartir el orden: con la regla por defecto, NULL ≠ NULL
-- y el único índice no restringiría nada justo en el caso heredable.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_menu_orden
  ON crm_menu_opciones(grupo_id, cargo, orden) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_crm_menu_grupo ON crm_menu_opciones(grupo_id, cargo, orden)
  WHERE activo;

DROP TRIGGER IF EXISTS tr_crm_menu_upd ON crm_menu_opciones;
CREATE TRIGGER tr_crm_menu_upd BEFORE UPDATE ON crm_menu_opciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE crm_menu_opciones IS
  'El menú del bot, configurable por contrato y por rol (§4.2). grupo_id o cargo en NULL significan «aplica a todos». Máximo 10 opciones activas por combinación: es el tope de filas de una lista de WhatsApp, no una preferencia.';
COMMENT ON COLUMN crm_menu_opciones.cargo IS
  'Cargo de nómina (`personas.cargo`) normalizado en mayúsculas, o NULL para todos los cargos. Es el «rol» de la §4.2: el cargo del trabajador, no el rol de /roles.';
COMMENT ON COLUMN crm_menu_opciones.accion IS
  'Catálogo CERRADO de lo que el bot ya sabe hacer. Un menú que pudiera ejecutar texto libre convertiría a quien lo configura en quien maneja el bot.';
COMMENT ON COLUMN crm_menu_opciones.requiere_permiso IS
  'Clave de permiso que la persona debe tener para que la opción se le muestre (p. ej. `gestionar_qr_ronda`). NULL = se le muestra a cualquiera. Una opción que aparece y después dice «no tenés permiso» es una opción mal configurada.';

-- Tope de 10 opciones activas por (contrato, cargo). Se comprueba en un trigger
-- y no en un CHECK porque un CHECK no puede mirar otras filas.
CREATE OR REPLACE FUNCTION public.crm_menu_tope()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  IF NOT NEW.activo THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_n
    FROM public.crm_menu_opciones m
   WHERE m.activo
     AND m.grupo_id IS NOT DISTINCT FROM NEW.grupo_id
     AND m.cargo    IS NOT DISTINCT FROM NEW.cargo
     AND m.id <> NEW.id;
  IF v_n >= 10 THEN
    RAISE EXCEPTION 'El menú ya tiene 10 opciones activas: una lista de WhatsApp no admite más de 10 filas.';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.crm_menu_tope() IS
  'Impide pasar de 10 opciones activas por (contrato, cargo). El límite es de WhatsApp: una lista con 11 filas la rechaza la API.';

DROP TRIGGER IF EXISTS tr_crm_menu_tope ON crm_menu_opciones;
CREATE TRIGGER tr_crm_menu_tope BEFORE INSERT OR UPDATE ON crm_menu_opciones
  FOR EACH ROW EXECUTE FUNCTION public.crm_menu_tope();

-- El cargo se guarda normalizado, siempre, para que la comparación con
-- `personas.cargo` no dependa de cómo lo escribió quien configuró el menú.
CREATE OR REPLACE FUNCTION public.crm_menu_normalizar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.cargo := NULLIF(upper(btrim(COALESCE(NEW.cargo, ''))), '');
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.crm_menu_normalizar() IS
  'Guarda el cargo del menú en mayúsculas y sin espacios de más: es la forma en que se compara con personas.cargo.';

DROP TRIGGER IF EXISTS tr_crm_menu_norm ON crm_menu_opciones;
CREATE TRIGGER tr_crm_menu_norm BEFORE INSERT OR UPDATE ON crm_menu_opciones
  FOR EACH ROW EXECUTE FUNCTION public.crm_menu_normalizar();

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `crm_envio_siguiente_ventana()` — cuándo se abre la próxima jornada
-- ──────────────────────────────────────────────────────────────────────────────
-- Lo que la §4.4 llama «se aplaza a la siguiente ventana hábil». Se apoya en
-- `whatsapp_jornada()` de F9 para no tener dos definiciones de jornada.
--
-- Tres resultados, y los tres importan:
--   · el mismo momento, si ya estamos dentro;
--   · la próxima apertura de la franja, en la zona de Bogotá y no en UTC
--     (calcularlo en UTC daría el día anterior entre las 19:00 y la medianoche);
--   · NULL cuando la persona NO TIENE jornada (retirada o inactiva): no hay
--     ventana a la que aplazar, y quien llama tiene que tratarlo como un final,
--     no como un «más tarde».
--
-- DECISIÓN, y queda anotada: «hábil» aquí es la jornada del contrato, NO el día
-- hábil del calendario. Los festivos de `pqrs_dias_no_habiles` no se descuentan
-- porque la conserjería trabaja festivos: descontarlos aplazaría al martes el
-- aviso del lunes festivo de quien ese lunes está trabajando.
CREATE OR REPLACE FUNCTION public.crm_envio_siguiente_ventana(
  p_persona       UUID,
  p_grupo         UUID        DEFAULT NULL,
  p_desde         TIMESTAMPTZ DEFAULT NOW(),
  p_jornada_desde TIME        DEFAULT '06:00',
  p_jornada_hasta TIME        DEFAULT '20:00',
  p_zona          TEXT        DEFAULT 'America/Bogota'
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jor   JSONB;
  v_local TIMESTAMP;
  v_cand  TIMESTAMP;
  v_abre  TIME;
BEGIN
  v_jor := public.whatsapp_jornada(p_persona, p_grupo, p_desde,
                                   p_jornada_desde, p_jornada_hasta, p_zona);
  IF (v_jor ->> 'dentro')::boolean THEN RETURN p_desde; END IF;
  -- Sin jornada no hay ventana siguiente: ni la de respaldo.
  IF (v_jor ->> 'fuente') = 'SIN_JORNADA' THEN RETURN NULL; END IF;

  v_abre  := COALESCE((v_jor ->> 'desde')::time, p_jornada_desde);
  v_local := p_desde AT TIME ZONE p_zona;
  v_cand  := date_trunc('day', v_local) + v_abre;
  IF v_cand <= v_local THEN v_cand := v_cand + INTERVAL '1 day'; END IF;
  RETURN v_cand AT TIME ZONE p_zona;
END $$;
COMMENT ON FUNCTION public.crm_envio_siguiente_ventana(UUID, UUID, TIMESTAMPTZ, TIME, TIME, TEXT) IS
  'El próximo momento en que se le puede escribir a esta persona sin violar la Ley 2191: el mismo instante si ya estamos dentro de su jornada, la próxima apertura de su franja si no, o NULL si no tiene jornada (retirada o inactiva), caso en el que no hay a dónde aplazar.';
GRANT EXECUTE ON FUNCTION public.crm_envio_siguiente_ventana(UUID, UUID, TIMESTAMPTZ, TIME, TIME, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `crm_envio_render()` y `crm_envio_variables()` — los marcadores
-- ──────────────────────────────────────────────────────────────────────────────
-- Un envío masivo con el mismo texto para todos sirve para un aviso, pero no
-- para «tu próximo punto es X». De ahí los marcadores, que son una LISTA CERRADA
-- de ocho: nada de un lenguaje de plantillas, porque el texto lo escribe quien
-- arma el envío y un lenguaje con expresiones sería una vía para leer lo que no
-- le toca. Lo que no está en la lista se deja tal cual.
--
-- `{punto}` y `{punto_nombre}` son la «próxima ubicación» de la §4.3 dentro del
-- masivo, y salen de `ronda_proxima_parada()` de F8: la regla de cuál es la
-- siguiente parada vive en un solo sitio.
CREATE OR REPLACE FUNCTION public.crm_envio_render(
  p_texto   TEXT,
  p_persona UUID,
  p_grupo   UUID DEFAULT NULL,
  p_zona    TEXT DEFAULT 'America/Bogota'
) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out    TEXT := COALESCE(p_texto, '');
  v_pe     RECORD;
  v_par    JSONB;
  v_ahora  TIMESTAMP;
BEGIN
  IF v_out = '' OR position('{' IN v_out) = 0 THEN RETURN v_out; END IF;

  SELECT split_part(btrim(pe.nombres), ' ', 1) AS nombre,
         COALESCE(s.nombre, '')                AS sede,
         COALESCE(pe.cargo, '')                AS cargo,
         COALESCE(g.nombre, '')                AS contrato
    INTO v_pe
    FROM public.personas pe
    LEFT JOIN public.sedes s           ON s.id = pe.sede_id
    LEFT JOIN public.grupos_contrato g ON g.id = COALESCE(p_grupo, s.grupo_id)
   WHERE pe.id = p_persona;

  v_ahora := NOW() AT TIME ZONE p_zona;
  v_out := replace(v_out, '{nombre}',   COALESCE(v_pe.nombre, ''));
  v_out := replace(v_out, '{sede}',     COALESCE(v_pe.sede, ''));
  v_out := replace(v_out, '{cargo}',    COALESCE(v_pe.cargo, ''));
  v_out := replace(v_out, '{contrato}', COALESCE(v_pe.contrato, ''));
  v_out := replace(v_out, '{hora}',     to_char(v_ahora, 'HH24:MI'));
  v_out := replace(v_out, '{fecha}',    to_char(v_ahora, 'DD/MM/YYYY'));

  -- La próxima parada sólo se consulta si el texto la nombra: es la parte más
  -- cara del render (tres consultas de F8) y un aviso normal no la necesita.
  IF position('{punto' IN v_out) > 0 THEN
    v_par := public.ronda_proxima_parada(p_persona);
    IF (v_par ->> 'estado') = 'PARADA' THEN
      v_out := replace(v_out, '{punto_nombre}', COALESCE(v_par #>> '{punto,nombre}', ''));
      v_out := replace(v_out, '{punto}',        COALESCE(v_par #>> '{punto,codigo}', ''));
    ELSE
      -- Sin ruta de hoy no se inventa un punto: se deja dicho que no hay.
      v_out := replace(v_out, '{punto_nombre}', 'sin ruta asignada hoy');
      v_out := replace(v_out, '{punto}',        'sin ruta');
    END IF;
  END IF;

  RETURN v_out;
END $$;
COMMENT ON FUNCTION public.crm_envio_render(TEXT, UUID, UUID, TEXT) IS
  'Sustituye los marcadores de un envío masivo por los datos de una persona. Lista CERRADA: {nombre} {sede} {cargo} {contrato} {hora} {fecha} {punto} {punto_nombre}. Los dos últimos salen de ronda_proxima_parada() de F8, y si no hay ruta de hoy lo dicen en vez de inventar un punto.';
GRANT EXECUTE ON FUNCTION public.crm_envio_render(TEXT, UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_envio_variables(
  p_variables JSONB,
  p_persona   UUID,
  p_grupo     UUID DEFAULT NULL,
  p_zona      TEXT DEFAULT 'America/Bogota'
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(public.crm_envio_render(v.valor, p_persona, p_grupo, p_zona)
                            ORDER BY v.i), '[]'::jsonb)
    FROM jsonb_array_elements_text(COALESCE(p_variables, '[]'::jsonb))
         WITH ORDINALITY AS v(valor, i)
$$;
COMMENT ON FUNCTION public.crm_envio_variables(JSONB, UUID, UUID, TEXT) IS
  'Resuelve, en orden, las variables de la plantilla de un envío para una persona. Devuelve el arreglo que espera whatsapp_encolar().';
GRANT EXECUTE ON FUNCTION public.crm_envio_variables(JSONB, UUID, UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. `crm_envio_resolver()` — la audiencia, resuelta EN SQL
-- ──────────────────────────────────────────────────────────────────────────────
-- Escribe una fila por persona: PENDIENTE las que entran, EXCLUIDO con su motivo
-- las que no. TODO en una sola sentencia, porque Supabase corta a los 8 segundos
-- y la audiencia de un contrato grande son miles de personas: un bucle que las
-- recorriera de a una no terminaría.
--
-- De dónde sale el contrato de una persona: de SU SEDE (`personas.sede_id →
-- sedes.grupo_id`). La §2.3 lo dice: `persona_vinculaciones` todavía no ata a
-- cada persona con su contrato, y hasta que eso exista el camino por la sede es
-- el que hay. Quien no tiene sede no tiene contrato y queda SIN_SEDE.
--
-- NO SE BORRA lo que ya salió: recalcular un envío en curso no deshace lo
-- enviado. Sólo se rehacen las filas PENDIENTE y EXCLUIDO.
CREATE OR REPLACE FUNCTION public.crm_envio_resolver(p_envio UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e    crm_envios;
  v_res  JSONB;
BEGIN
  -- Una llamada CON sesión tiene que traer el permiso; una SIN sesión es el
  -- servidor con la llave de servicio (el mismo criterio de F9 con sus rutas).
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.crm_envios_gestiona() THEN
    RAISE EXCEPTION 'No tiene permiso para calcular la audiencia de un envío masivo.';
  END IF;

  SELECT * INTO v_e FROM public.crm_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El envío no existe.'; END IF;
  IF v_e.estado IN ('CANCELADO','COMPLETADO') THEN
    RAISE EXCEPTION 'El envío está %: ya no se puede recalcular su audiencia.', lower(v_e.estado);
  END IF;

  DELETE FROM public.crm_envio_destinos
   WHERE envio_id = p_envio AND estado IN ('PENDIENTE','EXCLUIDO');

  INSERT INTO public.crm_envio_destinos (
    envio_id, grupo_id, persona_id, persona_canal_id, canal_valor,
    estado, exclusion_motivo, es_emergencia)
  WITH lista AS (
    -- La lista del directorio se cruza por TELÉFONO contra un canal de WhatsApp
    -- verificado: `directorio_contactos` guarda correos y teléfonos, no personas.
    -- Un contacto de la lista que no corresponde a ninguna persona con WhatsApp
    -- verificado simplemente no produce destino, y el resumen lo cuenta.
    SELECT DISTINCT pc.persona_id
      FROM public.directorio_contactos dc
      JOIN public.persona_canales pc
        ON pc.canal = 'WHATSAPP'
       AND regexp_replace(COALESCE(NULLIF(pc.wa_id, ''), pc.valor), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(dc.telefono, ''), '[^0-9]', '', 'g')
     WHERE v_e.audiencia_lista IS NOT NULL
       AND dc.lista_codigo = v_e.audiencia_lista
       AND dc.activo
       AND length(regexp_replace(COALESCE(dc.telefono, ''), '[^0-9]', '', 'g')) >= 7
  ), base AS (
    SELECT pe.id                           AS persona_id,
           pe.sede_id,
           upper(COALESCE(pe.estado, ''))  AS persona_estado,
           s.grupo_id
      FROM public.personas pe
      LEFT JOIN public.sedes s ON s.id = pe.sede_id
     WHERE CASE v_e.audiencia_alcance
             WHEN 'CONTRATO' THEN s.grupo_id = v_e.grupo_id
             WHEN 'SEDES'    THEN s.grupo_id = v_e.grupo_id AND pe.sede_id = ANY(v_e.audiencia_sedes)
             WHEN 'PERSONAS' THEN pe.id = ANY(v_e.audiencia_personas)
             WHEN 'LISTA'    THEN pe.id IN (SELECT persona_id FROM lista)
             ELSE false
           END
       -- El rol (cargo de nómina), normalizado. Vacío = todos.
       AND (cardinality(v_e.audiencia_cargos) = 0
            OR upper(btrim(COALESCE(pe.cargo, ''))) = ANY(v_e.audiencia_cargos))
       -- El turno. En un CASE y no en un OR: así `ronda_turno_abierto()` sólo se
       -- evalúa cuando el envío de verdad filtra por turno (un OR no garantiza
       -- el orden de evaluación, y esto corre sobre miles de filas).
       AND CASE v_e.audiencia_turno
             WHEN 'EN_TURNO'    THEN public.ronda_turno_abierto(pe.id) IS NOT NULL
             WHEN 'FUERA_TURNO' THEN public.ronda_turno_abierto(pe.id) IS NULL
             ELSE true
           END
  ), concanal AS (
    SELECT b.*,
           pc.id           AS canal_id,
           pc.valor        AS canal_valor,
           pc.activo       AS canal_activo,
           pc.bloqueado_at AS canal_bloqueado
      FROM base b
      LEFT JOIN LATERAL (
        SELECT c.id, c.valor, c.activo, c.bloqueado_at
          FROM public.persona_canales c
         WHERE c.persona_id = b.persona_id AND c.canal = 'WHATSAPP' AND c.verificado
         ORDER BY c.principal DESC, c.verificado_at DESC NULLS LAST
         LIMIT 1
      ) pc ON true
  )
  SELECT p_envio,
         v_e.grupo_id,
         c.persona_id,
         c.canal_id,
         c.canal_valor,
         CASE WHEN m.motivo IS NULL THEN 'PENDIENTE' ELSE 'EXCLUIDO' END,
         m.motivo,
         v_e.es_emergencia
    FROM concanal c
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN c.sede_id IS NULL                      THEN 'SIN_SEDE'
               WHEN c.grupo_id IS DISTINCT FROM v_e.grupo_id THEN 'FUERA_DEL_CONTRATO'
               WHEN c.persona_estado IN ('RETIRADO','INACTIVO','SUSPENDIDO') THEN 'PERSONA_INACTIVA'
               WHEN c.canal_id IS NULL                     THEN 'SIN_CANAL'
               WHEN c.canal_bloqueado IS NOT NULL OR NOT c.canal_activo THEN 'CANAL_BLOQUEADO'
               -- El opt-in. `persona_consiente()` es la única definición de
               -- «dio permiso»; es SQL simple y el planificador la inserta en
               -- la consulta, así que no hay que reescribir su regla aquí.
               WHEN NOT public.persona_consiente(c.persona_id, 'WHATSAPP') THEN 'SIN_CONSENTIMIENTO'
             END AS motivo
    ) m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.crm_envio_destinos d
      WHERE d.envio_id = p_envio AND d.persona_id = c.persona_id
   );

  -- El desglose, contado EN SQL. Nunca se traen las filas para contarlas.
  SELECT jsonb_build_object(
           'destinos',  COUNT(*) FILTER (WHERE d.estado <> 'EXCLUIDO'),
           'excluidos', COUNT(*) FILTER (WHERE d.estado = 'EXCLUIDO'),
           'exclusiones', COALESCE(
             (SELECT jsonb_object_agg(x.exclusion_motivo, x.n)
                FROM (SELECT e2.exclusion_motivo, COUNT(*) AS n
                        FROM public.crm_envio_destinos e2
                       WHERE e2.envio_id = p_envio AND e2.exclusion_motivo IS NOT NULL
                       GROUP BY e2.exclusion_motivo) x), '{}'::jsonb),
           'alcance',  v_e.audiencia_alcance,
           'turno',    v_e.audiencia_turno,
           'calculado_at', NOW()
         )
    INTO v_res
    FROM public.crm_envio_destinos d
   WHERE d.envio_id = p_envio;

  UPDATE public.crm_envios
     SET total_destinos  = COALESCE((v_res ->> 'destinos')::int, 0),
         total_excluidos = COALESCE((v_res ->> 'excluidos')::int, 0),
         costo_estimado  = CASE WHEN costo_unitario IS NULL THEN NULL
                                ELSE costo_unitario * COALESCE((v_res ->> 'destinos')::int, 0) END,
         resumen         = v_res,
         calculado_at    = NOW(),
         estado          = CASE WHEN estado = 'BORRADOR' THEN 'CALCULADO' ELSE estado END
   WHERE id = p_envio;

  RETURN v_res;
END $$;
COMMENT ON FUNCTION public.crm_envio_resolver(UUID) IS
  'Resuelve la audiencia de un envío y escribe UNA FILA POR PERSONA: PENDIENTE las que entran, EXCLUIDO con su motivo las que no (sin opt-in, sin WhatsApp verificado, canal bloqueado, persona inactiva, fuera del contrato o sin sede). Todo en una sentencia: Supabase corta a los 8 s.';
REVOKE ALL ON FUNCTION public.crm_envio_resolver(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_envio_resolver(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. `crm_envio_aprobar()` — reparte la hora de cada destino (el escalonado)
-- ──────────────────────────────────────────────────────────────────────────────
-- EL ESCALONADO ES OBLIGATORIO (§4.4). El número tiene un tope fijo de 20
-- mensajes por segundo que no se puede subir; se trabaja por debajo. Aquí no se
-- envía nada: se le da a cada destino su instante, con el MISMO caudal con el
-- que el buzón de salida de F9 va a enviarlos. Si todos nacieran con la misma
-- hora, el cron de salida reclamaría un lote enorme y la prioridad dejaría de
-- significar algo.
--
-- Es UNA sentencia de aritmética, sin bucles y sin consultar jornadas: la
-- jornada se mira justo antes de encolar, en `crm_envio_tomar_lote()`, que es
-- donde de verdad importa (un envío aprobado a las 17:00 para las 19:55 tiene
-- que decidirse a las 19:55, no ahora).
CREATE OR REPLACE FUNCTION public.crm_envio_aprobar(
  p_envio    UUID,
  p_desde    TIMESTAMPTZ DEFAULT NULL,
  p_mps_tope NUMERIC     DEFAULT NULL
) RETURNS crm_envios
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e    crm_envios;
  v_mps  NUMERIC;
  v_tope NUMERIC;
  v_base TIMESTAMPTZ;
  v_n    INT;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.crm_envios_gestiona() THEN
    RAISE EXCEPTION 'No tiene permiso para aprobar un envío masivo.';
  END IF;

  SELECT * INTO v_e FROM public.crm_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El envío no existe.'; END IF;
  IF v_e.estado NOT IN ('CALCULADO','APROBADO') THEN
    RAISE EXCEPTION 'Un envío % no se puede aprobar: primero hay que calcular su audiencia.', lower(v_e.estado);
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.crm_envio_destinos
   WHERE envio_id = p_envio AND estado = 'PENDIENTE';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'La audiencia quedó vacía: no hay nadie a quien escribirle.';
  END IF;

  -- Un envío de emergencia lo autoriza una persona con `gestionar_whatsapp`, y
  -- eso se comprueba al aprobarlo, que es el momento en que de verdad sale.
  IF v_e.es_emergencia AND (SELECT auth.uid()) IS NOT NULL AND NOT public.whatsapp_gestiona() THEN
    RAISE EXCEPTION 'Un envío de emergencia fuera de jornada lo autoriza quien tiene gestionar_whatsapp.';
  END IF;

  -- El caudal: el menor entre lo que pide el envío, el tope de la aplicación y
  -- el que informó el número. Nunca por encima del número.
  SELECT COALESCE(cu.throughput_mps, 20) INTO v_tope
    FROM public.whatsapp_cuentas cu WHERE cu.id = v_e.cuenta_id;
  v_mps := LEAST(
    COALESCE(v_e.escalon_mps, p_mps_tope, v_tope, 15),
    COALESCE(p_mps_tope, v_tope, 20),
    COALESCE(v_tope, 20)
  );
  IF v_mps IS NULL OR v_mps <= 0 THEN v_mps := 1; END IF;

  v_base := GREATEST(COALESCE(p_desde, v_e.programado_para, NOW()), NOW());

  WITH ord AS (
    SELECT d.id, (row_number() OVER (ORDER BY d.created_at, d.id) - 1)::numeric AS n
      FROM public.crm_envio_destinos d
     WHERE d.envio_id = p_envio AND d.estado = 'PENDIENTE'
  )
  UPDATE public.crm_envio_destinos d
     SET programado_para = v_base + make_interval(secs => (o.n / v_mps)::double precision),
         es_emergencia   = v_e.es_emergencia
    FROM ord o
   WHERE d.id = o.id;

  UPDATE public.crm_envios
     SET estado      = 'APROBADO',
         aprobado_at = NOW(),
         aprobado_por = COALESCE(aprobado_por, (SELECT u.id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))),
         programado_para = v_base
   WHERE id = p_envio
  RETURNING * INTO v_e;

  INSERT INTO public.ronda_eventos (grupo_id, entidad, entidad_id, accion, actor_tipo, canal, detalle)
  VALUES (v_e.grupo_id, 'crm_envios', p_envio, 'ENVIO_APROBADO', 'USUARIO', 'WHATSAPP',
          jsonb_build_object('destinos', v_n, 'mps', v_mps, 'desde', v_base,
                             'emergencia', v_e.es_emergencia,
                             'emergencia_motivo', v_e.emergencia_motivo));
  RETURN v_e;
END $$;
COMMENT ON FUNCTION public.crm_envio_aprobar(UUID, TIMESTAMPTZ, NUMERIC) IS
  'Aprueba un envío y REPARTE la hora de cada destino al caudal del número (el escalonado obligatorio de la §4.4). No envía nada y no mira jornadas: eso se decide justo antes de encolar. Un envío de emergencia exige gestionar_whatsapp.';
REVOKE ALL ON FUNCTION public.crm_envio_aprobar(UUID, TIMESTAMPTZ, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_envio_aprobar(UUID, TIMESTAMPTZ, NUMERIC) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. `crm_envio_tomar_lote()` — el cron: encola lo que ya venció
-- ──────────────────────────────────────────────────────────────────────────────
-- Toma un LOTE de destinos cuya hora llegó y encola un mensaje POR PERSONA con
-- `whatsapp_encolar()`. Tres cosas que no son detalles:
--
--   · UN `whatsapp_encolar` POR PERSONA, nunca un grupo. Con coexistencia los
--     grupos no se sincronizan, y el estado por destinatario no existiría.
--   · EL ID DEL MENSAJE ES EL ID DEL DESTINO. `whatsapp_encolar` es idempotente
--     por `p_id`, así que un destino no puede generar dos mensajes ni aunque el
--     cron se solape consigo mismo.
--   · LA JORNADA SE MIRA ANTES. Lo que cae fuera se APLAZA a la siguiente
--     ventana con su motivo y su evento, en vez de nacer OMITIDO_JORNADA: un
--     aviso de las 21:00 que tiene que llegar mañana a las 06:00 no es un error,
--     es un aplazamiento. El portero lo vuelve a mirar al enviar, como exige la
--     §4.4, y ahí sí omite lo que haya cambiado entre medias.
--
-- Presupuesto por LOTE y no por envío: el cron corre cada minuto y lo que no
-- alcanza queda en la cola con su hora. Nada se procesa dos veces.
CREATE OR REPLACE FUNCTION public.crm_envio_tomar_lote(
  p_limite        INT     DEFAULT 100,
  p_jornada_desde TIME    DEFAULT '06:00',
  p_jornada_hasta TIME    DEFAULT '20:00',
  p_margen_horas  NUMERIC DEFAULT 23,
  p_zona          TEXT    DEFAULT 'America/Bogota',
  p_aplazos_tope  INT     DEFAULT 3
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_d        RECORD;
  v_conv     crm_conversaciones;
  v_msg      crm_mensajes;
  v_jor      JSONB;
  v_sig      TIMESTAMPTZ;
  v_texto    TEXT;
  v_vars     JSONB;
  v_wa       TEXT;
  v_encolados INT := 0;
  v_aplazados INT := 0;
  v_omitidos  INT := 0;
  v_fallidos  INT := 0;
  v_envios   UUID[] := '{}';
BEGIN
  FOR v_d IN
    SELECT d.id, d.persona_id, d.canal_valor, d.es_emergencia, d.aplazos,
           e.id AS envio_id, e.grupo_id, e.cuenta_id, e.plantilla_nombre,
           e.variables, e.texto, e.prioridad, e.emergencia_por, e.costo_unitario
      FROM public.crm_envio_destinos d
      JOIN public.crm_envios e ON e.id = d.envio_id
     WHERE d.estado IN ('PENDIENTE','APLAZADO')
       AND e.estado IN ('APROBADO','EN_CURSO')
       AND COALESCE(d.programado_para, e.programado_para, e.created_at) <= NOW()
     ORDER BY COALESCE(d.programado_para, e.created_at), d.id
     LIMIT GREATEST(COALESCE(p_limite, 100), 1)
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF NOT (v_d.envio_id = ANY(v_envios)) THEN v_envios := v_envios || v_d.envio_id; END IF;

    -- La jornada, antes de encolar. La emergencia la salta, y queda marcada.
    IF NOT v_d.es_emergencia THEN
      v_jor := public.whatsapp_jornada(v_d.persona_id, v_d.grupo_id, NOW(),
                                       p_jornada_desde, p_jornada_hasta, p_zona);
      IF NOT (v_jor ->> 'dentro')::boolean THEN
        v_sig := public.crm_envio_siguiente_ventana(v_d.persona_id, v_d.grupo_id, NOW(),
                                                    p_jornada_desde, p_jornada_hasta, p_zona);
        IF v_sig IS NULL OR v_d.aplazos >= GREATEST(COALESCE(p_aplazos_tope, 3), 1) THEN
          -- Sin ventana a la que aplazar (persona retirada o inactiva), o ya se
          -- aplazó demasiadas veces: se cierra con su motivo en vez de dar
          -- vueltas para siempre.
          UPDATE public.crm_envio_destinos
             SET estado = 'OMITIDO', jornada = v_jor,
                 omitido_motivo = COALESCE(v_jor ->> 'motivo',
                   'Fuera de la jornada de la persona y sin una ventana a la que aplazar.')
           WHERE id = v_d.id;
          v_omitidos := v_omitidos + 1;
        ELSE
          UPDATE public.crm_envio_destinos
             SET estado = 'APLAZADO', programado_para = v_sig,
                 aplazos = aplazos + 1, jornada = v_jor
           WHERE id = v_d.id;
          v_aplazados := v_aplazados + 1;
        END IF;
        INSERT INTO public.ronda_eventos (grupo_id, entidad, entidad_id, accion, actor_tipo,
                                          actor_persona_id, canal, detalle)
        VALUES (v_d.grupo_id, 'crm_envio_destinos', v_d.id, 'ENVIO_APLAZADO_JORNADA', 'BOT',
                v_d.persona_id, 'WHATSAPP',
                jsonb_build_object('jornada', v_jor, 'siguiente_ventana', v_sig,
                                   'aplazos', v_d.aplazos + 1, 'envio_id', v_d.envio_id));
        CONTINUE;
      END IF;
    ELSE
      v_jor := jsonb_build_object('dentro', true, 'fuente', 'EMERGENCIA');
    END IF;

    -- La conversación del número. `crm_conversacion_resolver` la abre o la
    -- recupera y resuelve la persona por `persona_canales`.
    v_wa := regexp_replace(COALESCE(v_d.canal_valor, ''), '[^0-9]', '', 'g');
    IF v_wa = '' THEN
      UPDATE public.crm_envio_destinos
         SET estado = 'FALLIDO', error_codigo = 'SIN_NUMERO',
             error = 'El destino no tiene un número al que escribir.'
       WHERE id = v_d.id;
      v_fallidos := v_fallidos + 1;
      CONTINUE;
    END IF;
    v_conv := public.crm_conversacion_resolver(v_d.cuenta_id, v_wa, NULL);

    v_texto := public.crm_envio_render(v_d.texto, v_d.persona_id, v_d.grupo_id, p_zona);
    v_vars  := public.crm_envio_variables(v_d.variables, v_d.persona_id, v_d.grupo_id, p_zona);

    v_msg := public.whatsapp_encolar(
      p_conversacion   => v_conv.id,
      p_tipo           => CASE WHEN NULLIF(btrim(COALESCE(v_d.plantilla_nombre, '')), '') IS NULL
                               THEN 'TEXTO' ELSE 'PLANTILLA' END,
      p_texto          => NULLIF(btrim(COALESCE(v_texto, '')), ''),
      p_payload        => CASE
                            WHEN NULLIF(btrim(COALESCE(v_d.plantilla_nombre, '')), '') IS NULL
                            THEN jsonb_build_object('tipo', 'TEXTO', 'texto', v_texto)
                            ELSE jsonb_build_object('tipo', 'PLANTILLA',
                                                    'nombre', v_d.plantilla_nombre,
                                                    'idioma', 'es_CO',
                                                    'variables', v_vars)
                          END,
      p_iniciado_por   => 'BOT',
      p_plantilla      => NULLIF(btrim(COALESCE(v_d.plantilla_nombre, '')), ''),
      p_variables      => v_vars,
      p_consentimiento => 'WHATSAPP',
      p_prioridad      => COALESCE(v_d.prioridad, 8)::int,
      p_programado     => NULL,
      p_emergencia     => v_d.es_emergencia,
      p_emergencia_por => CASE WHEN v_d.es_emergencia THEN v_d.emergencia_por END,
      p_visita         => NULL,
      -- El id del destino ES el id del mensaje: una persona, un mensaje, sin
      -- posibilidad de duplicarlo.
      p_id             => v_d.id,
      p_jornada_desde  => p_jornada_desde,
      p_jornada_hasta  => p_jornada_hasta,
      p_margen_horas   => p_margen_horas,
      p_zona           => p_zona);

    IF v_msg.estado LIKE 'OMITIDO%' THEN
      UPDATE public.crm_envio_destinos
         SET estado = 'OMITIDO', mensaje_id = v_msg.id, conversacion_id = v_conv.id,
             omitido_motivo = COALESCE(v_msg.omitido_motivo, 'El portero lo frenó.'),
             jornada = v_jor, variables = v_vars, encolado_at = NOW()
       WHERE id = v_d.id;
      v_omitidos := v_omitidos + 1;
    ELSE
      UPDATE public.crm_envio_destinos
         SET estado = 'ENCOLADO', mensaje_id = v_msg.id, conversacion_id = v_conv.id,
             jornada = v_jor, variables = v_vars, encolado_at = NOW(),
             costo = v_d.costo_unitario
       WHERE id = v_d.id;
      v_encolados := v_encolados + 1;
    END IF;
  END LOOP;

  -- Los envíos tocados pasan a EN_CURSO y guardan cuándo empezaron.
  UPDATE public.crm_envios e
     SET estado = 'EN_CURSO', iniciado_at = COALESCE(e.iniciado_at, NOW())
   WHERE e.id = ANY(v_envios) AND e.estado IN ('APROBADO','EN_CURSO');

  -- Y SE CIERRA LO QUE YA NO TIENE NADA POR SALIR, mirando TODOS los envíos en
  -- curso y no solo los de este lote. No es un detalle: el último mensaje de un
  -- envío se encola en una vuelta del cron y se ENVÍA en la siguiente, cuando
  -- esta función ya no tiene nada que tomar de ese envío y por lo tanto no lo
  -- volvería a mirar. Cerrándolo solo «si lo toqué», un envío terminado se
  -- quedaba EN_CURSO para siempre.
  --
  -- Son dos EXISTS sobre `idx_crm_envio_destinos_estado`, y el segundo evita
  -- cerrar un envío aprobado que todavía no tiene destinos.
  UPDATE public.crm_envios e
     SET estado = 'COMPLETADO', terminado_at = COALESCE(e.terminado_at, NOW())
   WHERE e.estado IN ('APROBADO','EN_CURSO')
     AND EXISTS (SELECT 1 FROM public.crm_envio_destinos d WHERE d.envio_id = e.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_envio_destinos d
        WHERE d.envio_id = e.id
          AND d.estado IN ('PENDIENTE','APLAZADO','ENCOLADO'));

  RETURN jsonb_build_object('encolados', v_encolados, 'aplazados', v_aplazados,
                            'omitidos', v_omitidos, 'fallidos', v_fallidos,
                            'envios', cardinality(v_envios));
END $$;
COMMENT ON FUNCTION public.crm_envio_tomar_lote(INT, TIME, TIME, NUMERIC, TEXT, INT) IS
  'El cron del envío masivo: toma los destinos cuya hora llegó y encola UN mensaje POR PERSONA con whatsapp_encolar(), usando el id del destino como id del mensaje (idempotente). Lo que cae fuera de la jornada se APLAZA a la siguiente ventana con su evento; la emergencia la salta y queda marcada.';
REVOKE ALL ON FUNCTION public.crm_envio_tomar_lote(INT, TIME, TIME, NUMERIC, TEXT, INT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. `crm_envio_crear()` y `crm_envio_cancelar()` — las escrituras de consola
-- ──────────────────────────────────────────────────────────────────────────────
-- Las escrituras entran por función y no por RLS, igual que en F9: así no hay
-- forma de crear un envío sin pasar por estas comprobaciones.
CREATE OR REPLACE FUNCTION public.crm_envio_crear(
  p_grupo             UUID,
  p_nombre            TEXT,
  p_tipo              TEXT        DEFAULT 'AVISO',
  p_alcance           TEXT        DEFAULT 'CONTRATO',
  p_sedes             UUID[]      DEFAULT '{}',
  p_cargos            TEXT[]      DEFAULT '{}',
  p_turno             TEXT        DEFAULT 'CUALQUIERA',
  p_lista             TEXT        DEFAULT NULL,
  p_personas          UUID[]      DEFAULT '{}',
  p_plantilla         TEXT        DEFAULT NULL,
  p_variables         JSONB       DEFAULT '[]'::jsonb,
  p_texto             TEXT        DEFAULT NULL,
  p_prioridad         INT         DEFAULT 8,
  p_programado        TIMESTAMPTZ DEFAULT NULL,
  p_escalon_mps       NUMERIC     DEFAULT NULL,
  p_emergencia        BOOLEAN     DEFAULT false,
  p_emergencia_motivo TEXT        DEFAULT NULL,
  p_costo_unitario    NUMERIC     DEFAULT NULL,
  p_cuenta            UUID        DEFAULT NULL
) RETURNS crm_envios
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e      crm_envios;
  v_cuenta UUID;
  v_uid    UUID := (SELECT auth.uid());
BEGIN
  IF v_uid IS NOT NULL AND NOT public.crm_envios_gestiona() THEN
    RAISE EXCEPTION 'No tiene permiso para crear un envío masivo de WhatsApp.';
  END IF;
  IF v_uid IS NOT NULL AND NOT public.auth_ve_grupo(p_grupo) THEN
    RAISE EXCEPTION 'Ese contrato no está en su alcance.';
  END IF;
  IF COALESCE(p_emergencia, false) THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Un envío de emergencia lo autoriza una persona, no el servidor.';
    END IF;
    IF NOT public.whatsapp_gestiona() THEN
      RAISE EXCEPTION 'Un envío de emergencia fuera de jornada lo autoriza quien tiene gestionar_whatsapp.';
    END IF;
    IF NULLIF(btrim(COALESCE(p_emergencia_motivo, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Una emergencia tiene que decir por qué: lo exige la Ley 2191 de 2022.';
    END IF;
  END IF;
  -- El contrato tiene que permitir WhatsApp. Es una regla del contrato
  -- (`grupo_reglas.permite_whatsapp`), no una preferencia de quien manda.
  IF EXISTS (SELECT 1 FROM public.grupo_reglas r
              WHERE r.grupo_id = p_grupo AND NOT r.permite_whatsapp) THEN
    RAISE EXCEPTION 'Este contrato no tiene habilitada la mensajería por WhatsApp.';
  END IF;

  SELECT COALESCE(p_cuenta, (SELECT cu.id FROM public.whatsapp_cuentas cu
                              WHERE cu.estado IN ('ACTIVA','SIMULADA')
                              ORDER BY cu.predeterminada DESC, cu.created_at
                              LIMIT 1)) INTO v_cuenta;
  IF v_cuenta IS NULL THEN RAISE EXCEPTION 'No hay un número de WhatsApp conectado.'; END IF;

  INSERT INTO public.crm_envios (
    grupo_id, cuenta_id, nombre, tipo, audiencia_alcance, audiencia_sedes,
    audiencia_cargos, audiencia_turno, audiencia_lista, audiencia_personas,
    plantilla_nombre, variables, texto, prioridad, programado_para, escalon_mps,
    es_emergencia, emergencia_por, emergencia_motivo, costo_unitario, created_by)
  VALUES (
    p_grupo, v_cuenta, btrim(p_nombre), upper(COALESCE(p_tipo, 'AVISO')),
    upper(COALESCE(p_alcance, 'CONTRATO')), COALESCE(p_sedes, '{}'),
    -- Los cargos se guardan normalizados: así se comparan con personas.cargo.
    COALESCE((SELECT array_agg(upper(btrim(x))) FROM unnest(COALESCE(p_cargos, '{}')) AS x
               WHERE NULLIF(btrim(x), '') IS NOT NULL), '{}'),
    upper(COALESCE(p_turno, 'CUALQUIERA')), NULLIF(btrim(COALESCE(p_lista, '')), ''),
    COALESCE(p_personas, '{}'),
    lower(NULLIF(btrim(COALESCE(p_plantilla, '')), '')), COALESCE(p_variables, '[]'::jsonb),
    NULLIF(btrim(COALESCE(p_texto, '')), ''),
    GREATEST(LEAST(COALESCE(p_prioridad, 8), 9), 7)::smallint,
    p_programado, p_escalon_mps,
    COALESCE(p_emergencia, false),
    CASE WHEN COALESCE(p_emergencia, false) THEN v_uid END,
    CASE WHEN COALESCE(p_emergencia, false) THEN btrim(p_emergencia_motivo) END,
    p_costo_unitario, v_uid)
  RETURNING * INTO v_e;

  INSERT INTO public.ronda_eventos (grupo_id, entidad, entidad_id, accion, actor_tipo, canal, detalle)
  VALUES (p_grupo, 'crm_envios', v_e.id, 'ENVIO_CREADO', 'USUARIO', 'WHATSAPP',
          jsonb_build_object('nombre', v_e.nombre, 'alcance', v_e.audiencia_alcance,
                             'emergencia', v_e.es_emergencia));
  RETURN v_e;
END $$;
COMMENT ON FUNCTION public.crm_envio_crear(UUID, TEXT, TEXT, TEXT, UUID[], TEXT[], TEXT, TEXT, UUID[], TEXT, JSONB, TEXT, INT, TIMESTAMPTZ, NUMERIC, BOOLEAN, TEXT, NUMERIC, UUID) IS
  'Crea un envío masivo en BORRADOR. Comprueba el permiso, el alcance de contratos del usuario, que el contrato permita WhatsApp y, si es de emergencia, que quien lo marca tenga gestionar_whatsapp y haya dicho por qué.';
REVOKE ALL ON FUNCTION public.crm_envio_crear(UUID, TEXT, TEXT, TEXT, UUID[], TEXT[], TEXT, TEXT, UUID[], TEXT, JSONB, TEXT, INT, TIMESTAMPTZ, NUMERIC, BOOLEAN, TEXT, NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_envio_crear(UUID, TEXT, TEXT, TEXT, UUID[], TEXT[], TEXT, TEXT, UUID[], TEXT, JSONB, TEXT, INT, TIMESTAMPTZ, NUMERIC, BOOLEAN, TEXT, NUMERIC, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_envio_cancelar(
  p_envio  UUID,
  p_motivo TEXT DEFAULT NULL
) RETURNS crm_envios
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e crm_envios; v_n INT;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.crm_envios_gestiona() THEN
    RAISE EXCEPTION 'No tiene permiso para cancelar un envío masivo.';
  END IF;

  SELECT * INTO v_e FROM public.crm_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El envío no existe.'; END IF;
  IF v_e.estado IN ('CANCELADO','COMPLETADO') THEN RETURN v_e; END IF;

  -- Se cancela lo que TODAVÍA NO SALIÓ. Lo encolado se cancela también en el
  -- buzón de salida; lo ya enviado no se puede desenviar y se deja como está.
  UPDATE public.crm_envio_destinos
     SET estado = 'CANCELADO'
   WHERE envio_id = p_envio AND estado IN ('PENDIENTE','APLAZADO','ENCOLADO');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.crm_mensajes m
     SET estado = 'CANCELADO'
   WHERE m.direccion = 'SALIENTE'
     AND m.estado IN ('PENDIENTE','EN_PROCESO')
     AND m.id IN (SELECT d.mensaje_id FROM public.crm_envio_destinos d
                   WHERE d.envio_id = p_envio AND d.mensaje_id IS NOT NULL);

  UPDATE public.crm_envios
     SET estado = 'CANCELADO', cancelado_at = NOW(),
         cancelado_por = (SELECT u.id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())),
         cancelacion_motivo = NULLIF(btrim(COALESCE(p_motivo, '')), ''),
         terminado_at = NOW()
   WHERE id = p_envio
  RETURNING * INTO v_e;

  INSERT INTO public.ronda_eventos (grupo_id, entidad, entidad_id, accion, actor_tipo, canal, detalle)
  VALUES (v_e.grupo_id, 'crm_envios', p_envio, 'ENVIO_CANCELADO', 'USUARIO', 'WHATSAPP',
          jsonb_build_object('motivo', v_e.cancelacion_motivo, 'destinos_cancelados', v_n));
  RETURN v_e;
END $$;
COMMENT ON FUNCTION public.crm_envio_cancelar(UUID, TEXT) IS
  'Cancela un envío: deja CANCELADO lo que todavía no salió, en el envío y en el buzón de salida. Lo ya enviado no se desenvía y se deja como está.';
REVOKE ALL ON FUNCTION public.crm_envio_cancelar(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_envio_cancelar(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. El espejo de estado: del mensaje al destino
-- ──────────────────────────────────────────────────────────────────────────────
-- El estado de entrega lo escribe F9 (`whatsapp_estado_entrega` con los
-- `statuses` de Meta) sobre `crm_mensajes`. Para no tener dos sitios que lo
-- interpreten, el destino lo ESPEJA con un trigger. Así `enviado`, `entregado`,
-- `leído` y `fallido` llegan al tablero del envío sin que nadie los copie a mano.
--
-- NUNCA RETROCEDE: un `sent` que llega desordenado no desmarca un `read`, igual
-- que en F9.
CREATE OR REPLACE FUNCTION public.crm_envio_rango(p_estado TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT array_position(ARRAY['PENDIENTE','APLAZADO','ENCOLADO','ENVIADO','ENTREGADO',
                              'LEIDO','RESPONDIDO'], upper(COALESCE(p_estado, '')))
$$;
COMMENT ON FUNCTION public.crm_envio_rango(TEXT) IS
  'Orden de avance de un destino, para que el espejo de estado nunca retroceda. Los estados finales (FALLIDO, OMITIDO, EXCLUIDO, CANCELADO) quedan fuera de la escala a propósito.';

CREATE OR REPLACE FUNCTION public.crm_envio_espejo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_nuevo TEXT;
BEGIN
  v_nuevo := CASE NEW.estado
               WHEN 'ENVIADO'   THEN 'ENVIADO'
               WHEN 'SIMULADO'  THEN 'ENVIADO'
               WHEN 'ENTREGADO' THEN 'ENTREGADO'
               WHEN 'LEIDO'     THEN 'LEIDO'
               WHEN 'FALLIDO'   THEN 'FALLIDO'
               WHEN 'CANCELADO' THEN 'CANCELADO'
               ELSE CASE WHEN NEW.estado LIKE 'OMITIDO%' THEN 'OMITIDO' END
             END;
  IF v_nuevo IS NULL THEN RETURN NULL; END IF;

  UPDATE public.crm_envio_destinos d
     SET estado = v_nuevo,
         externo_id   = COALESCE(NEW.wamid, d.externo_id),
         enviado_at   = COALESCE(d.enviado_at, NEW.enviado_at),
         entregado_at = COALESCE(d.entregado_at, NEW.entregado_at),
         leido_at     = COALESCE(d.leido_at, NEW.leido_at),
         error_codigo = CASE WHEN v_nuevo = 'FALLIDO' THEN NEW.error_codigo ELSE d.error_codigo END,
         error        = CASE WHEN v_nuevo = 'FALLIDO' THEN NEW.error ELSE d.error END,
         omitido_motivo = CASE WHEN v_nuevo = 'OMITIDO'
                               THEN COALESCE(NEW.omitido_motivo, d.omitido_motivo, 'El portero lo frenó.')
                               ELSE d.omitido_motivo END
   WHERE d.mensaje_id = NEW.id
     -- No retrocede, y no pisa un estado final que ya se decidió.
     AND d.estado NOT IN ('RESPONDIDO','EXCLUIDO','CANCELADO')
     AND (public.crm_envio_rango(v_nuevo) IS NULL
          OR public.crm_envio_rango(d.estado) IS NULL
          OR public.crm_envio_rango(v_nuevo) > public.crm_envio_rango(d.estado));
  RETURN NULL;
END $$;
COMMENT ON FUNCTION public.crm_envio_espejo() IS
  'Lleva al destino del envío el estado del mensaje (enviado, entregado, leído, fallido, omitido). Un solo sitio interpreta los `statuses` de Meta: el de F9. Nunca retrocede.';

DROP TRIGGER IF EXISTS tr_crm_envio_espejo ON crm_mensajes;
CREATE TRIGGER tr_crm_envio_espejo AFTER UPDATE OF estado ON crm_mensajes
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.crm_envio_espejo();

-- RESPONDIDO: alguien contestó. Se marca con el mensaje ENTRANTE, y sólo sobre
-- un destino al que se le escribió hace poco: una respuesta de tres semanas
-- después no es una respuesta a este envío.
CREATE OR REPLACE FUNCTION public.crm_envio_respondido()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.crm_envio_destinos d
     SET estado = 'RESPONDIDO', respondido_at = NOW()
   WHERE d.conversacion_id = NEW.conversacion_id
     AND d.estado IN ('ENVIADO','ENTREGADO','LEIDO')
     AND d.enviado_at IS NOT NULL
     AND d.enviado_at > NOW() - INTERVAL '48 hours';
  RETURN NULL;
END $$;
COMMENT ON FUNCTION public.crm_envio_respondido() IS
  'Marca RESPONDIDO el destino de un envío cuando la persona contesta dentro de 48 horas. Pasado ese plazo, lo que escriba es otra conversación y no la respuesta a este envío.';

DROP TRIGGER IF EXISTS tr_crm_envio_respondido ON crm_mensajes;
CREATE TRIGGER tr_crm_envio_respondido AFTER INSERT ON crm_mensajes
  FOR EACH ROW WHEN (NEW.direccion = 'ENTRANTE')
  EXECUTE FUNCTION public.crm_envio_respondido();

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. `crm_menu_para()` — el menú que le toca a una persona
-- ──────────────────────────────────────────────────────────────────────────────
-- Gana el conjunto MÁS ESPECÍFICO que exista, completo: (contrato + cargo),
-- después (contrato), después (cargo), después el general. No se mezclan filas
-- de dos niveles, porque mezclarlas daría menús que nadie configuró —y de los
-- que nadie podría explicar el orden.
CREATE OR REPLACE FUNCTION public.crm_menu_para(p_persona UUID)
RETURNS TABLE (
  id               UUID,
  orden            SMALLINT,
  etiqueta         TEXT,
  descripcion      TEXT,
  accion           TEXT,
  texto            TEXT,
  requiere_permiso TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH yo AS (
    SELECT pe.id,
           NULLIF(upper(btrim(COALESCE(pe.cargo, ''))), '') AS cargo,
           s.grupo_id
      FROM public.personas pe
      LEFT JOIN public.sedes s ON s.id = pe.sede_id
     WHERE pe.id = p_persona
  ), cand AS (
    SELECT m.*,
           CASE WHEN m.grupo_id IS NOT NULL AND m.cargo IS NOT NULL THEN 1
                WHEN m.grupo_id IS NOT NULL THEN 2
                WHEN m.cargo    IS NOT NULL THEN 3
                ELSE 4 END AS especificidad
      FROM public.crm_menu_opciones m
      LEFT JOIN yo ON true
     WHERE m.activo
       AND (m.grupo_id IS NULL OR m.grupo_id = yo.grupo_id)
       AND (m.cargo    IS NULL OR m.cargo    = yo.cargo)
  )
  SELECT c.id, c.orden, c.etiqueta::text, c.descripcion::text, c.accion::text,
         c.texto, c.requiere_permiso::text
    FROM cand c
   WHERE c.especificidad = (SELECT MIN(d.especificidad) FROM cand d)
   ORDER BY c.orden, c.etiqueta
   LIMIT 10
$$;
COMMENT ON FUNCTION public.crm_menu_para(UUID) IS
  'El menú del bot para una persona: gana el conjunto más específico que exista (contrato+cargo, contrato, cargo, general), completo y nunca mezclado, con el tope de 10 filas de una lista de WhatsApp.';
REVOKE ALL ON FUNCTION public.crm_menu_para(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_menu_para(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_menu_guardar(
  p_id       UUID    DEFAULT NULL,
  p_grupo    UUID    DEFAULT NULL,
  p_cargo    TEXT    DEFAULT NULL,
  p_orden    INT     DEFAULT 1,
  p_etiqueta TEXT    DEFAULT NULL,
  p_desc     TEXT    DEFAULT NULL,
  p_accion   TEXT    DEFAULT 'AYUDA',
  p_texto    TEXT    DEFAULT NULL,
  p_permiso  TEXT    DEFAULT NULL,
  p_activo   BOOLEAN DEFAULT true
) RETURNS crm_menu_opciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m crm_menu_opciones; v_uid UUID := (SELECT auth.uid());
BEGIN
  IF v_uid IS NOT NULL AND NOT public.crm_menu_gestiona() THEN
    RAISE EXCEPTION 'No tiene permiso para configurar el menú del bot.';
  END IF;
  IF p_grupo IS NOT NULL AND v_uid IS NOT NULL AND NOT public.auth_ve_grupo(p_grupo) THEN
    RAISE EXCEPTION 'Ese contrato no está en su alcance.';
  END IF;
  -- Un menú general (sin contrato) lo cambia toda la operación de golpe: eso no
  -- lo puede hacer quien sólo alcanza un contrato.
  IF p_grupo IS NULL AND v_uid IS NOT NULL AND NOT public.auth_permiso('gestionar_whatsapp') THEN
    RAISE EXCEPTION 'El menú general (todos los contratos) lo cambia quien además tiene gestionar_whatsapp.';
  END IF;

  INSERT INTO public.crm_menu_opciones (
    id, grupo_id, cargo, orden, etiqueta, descripcion, accion, texto,
    requiere_permiso, activo, created_by)
  VALUES (
    COALESCE(p_id, gen_random_uuid()), p_grupo, p_cargo,
    GREATEST(LEAST(COALESCE(p_orden, 1), 10), 1)::smallint,
    btrim(p_etiqueta), NULLIF(btrim(COALESCE(p_desc, '')), ''),
    upper(COALESCE(p_accion, 'AYUDA')), NULLIF(btrim(COALESCE(p_texto, '')), ''),
    NULLIF(btrim(COALESCE(p_permiso, '')), ''), COALESCE(p_activo, true), v_uid)
  ON CONFLICT (id) DO UPDATE SET
    grupo_id = EXCLUDED.grupo_id, cargo = EXCLUDED.cargo, orden = EXCLUDED.orden,
    etiqueta = EXCLUDED.etiqueta, descripcion = EXCLUDED.descripcion,
    accion = EXCLUDED.accion, texto = EXCLUDED.texto,
    requiere_permiso = EXCLUDED.requiere_permiso, activo = EXCLUDED.activo
  RETURNING * INTO v_m;
  RETURN v_m;
END $$;
COMMENT ON FUNCTION public.crm_menu_guardar(UUID, UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) IS
  'Crea o actualiza una opción del menú del bot. El menú GENERAL (sin contrato) exige además gestionar_whatsapp: cambia lo que ve toda la operación.';
REVOKE ALL ON FUNCTION public.crm_menu_guardar(UUID, UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_menu_guardar(UUID, UUID, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_menu_borrar(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m crm_menu_opciones; v_uid UUID := (SELECT auth.uid());
BEGIN
  SELECT * INTO v_m FROM public.crm_menu_opciones WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_uid IS NOT NULL AND NOT public.crm_menu_gestiona() THEN
    RAISE EXCEPTION 'No tiene permiso para configurar el menú del bot.';
  END IF;
  IF v_m.grupo_id IS NULL AND v_uid IS NOT NULL AND NOT public.auth_permiso('gestionar_whatsapp') THEN
    RAISE EXCEPTION 'El menú general (todos los contratos) lo cambia quien además tiene gestionar_whatsapp.';
  END IF;
  IF v_m.grupo_id IS NOT NULL AND v_uid IS NOT NULL AND NOT public.auth_ve_grupo(v_m.grupo_id) THEN
    RAISE EXCEPTION 'Ese contrato no está en su alcance.';
  END IF;
  DELETE FROM public.crm_menu_opciones WHERE id = p_id;
  RETURN true;
END $$;
COMMENT ON FUNCTION public.crm_menu_borrar(UUID) IS
  'Borra una opción del menú del bot, con las mismas reglas de alcance que crm_menu_guardar().';
REVOKE ALL ON FUNCTION public.crm_menu_borrar(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_menu_borrar(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. Vista de tablero — contar en SQL, nunca traer filas
-- ──────────────────────────────────────────────────────────────────────────────
-- `security_invoker = true` NO es un detalle: sin eso la vista se ejecutaría con
-- los permisos de su dueño y se saltaría la RLS de `crm_envios`, de modo que
-- cualquiera con permiso de lectura vería los envíos de TODOS los contratos. Es
-- la misma opción que ya usa `v_stock_flujo` en este repositorio.
CREATE OR REPLACE VIEW crm_envios_resumen WITH (security_invoker = true) AS
SELECT e.id                AS envio_id,
       e.grupo_id,
       g.nombre            AS contrato,
       e.nombre,
       e.tipo,
       e.estado,
       e.es_emergencia,
       e.plantilla_nombre,
       e.prioridad,
       e.programado_para,
       e.total_destinos,
       e.total_excluidos,
       e.costo_estimado,
       e.moneda,
       e.created_at,
       e.iniciado_at,
       e.terminado_at,
       COUNT(d.id) FILTER (WHERE d.estado = 'PENDIENTE')  AS pendientes,
       COUNT(d.id) FILTER (WHERE d.estado = 'APLAZADO')   AS aplazados,
       COUNT(d.id) FILTER (WHERE d.estado = 'ENCOLADO')   AS encolados,
       COUNT(d.id) FILTER (WHERE d.estado = 'ENVIADO')    AS enviados,
       COUNT(d.id) FILTER (WHERE d.estado = 'ENTREGADO')  AS entregados,
       COUNT(d.id) FILTER (WHERE d.estado = 'LEIDO')      AS leidos,
       COUNT(d.id) FILTER (WHERE d.estado = 'RESPONDIDO') AS respondidos,
       COUNT(d.id) FILTER (WHERE d.estado = 'FALLIDO')    AS fallidos,
       COUNT(d.id) FILTER (WHERE d.estado = 'OMITIDO')    AS omitidos,
       COUNT(d.id) FILTER (WHERE d.estado = 'EXCLUIDO')   AS excluidos,
       COUNT(d.id) FILTER (WHERE d.estado = 'CANCELADO')  AS cancelados,
       COUNT(d.id) FILTER (WHERE d.es_emergencia)         AS en_emergencia
  FROM crm_envios e
  LEFT JOIN grupos_contrato g      ON g.id = e.grupo_id
  LEFT JOIN crm_envio_destinos d   ON d.envio_id = e.id
 GROUP BY e.id, g.nombre;

COMMENT ON VIEW crm_envios_resumen IS
  'Un envío por fila, con sus destinos contados por estado EN SQL. Un tablero que trajera las filas para contarlas en JavaScript es un tablero que un día deja de cargar: Supabase corta a los 8 segundos y un envío a una sede son miles de filas.';

-- Los cargos que de verdad existen en la nómina, con cuánta gente alcanzable
-- tiene cada uno. Es lo que la consola ofrece como «rol» al armar una audiencia:
-- sin esto habría que escribir el cargo a mano y una letra de más daría un envío
-- a nadie. Contado EN SQL: son 6.600 personas y no se traen para contarlas.
CREATE OR REPLACE VIEW crm_cargos_audiencia WITH (security_invoker = true) AS
SELECT upper(btrim(pe.cargo))  AS cargo,
       s.grupo_id,
       COUNT(*)                AS personas,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM persona_canales pc
          WHERE pc.persona_id = pe.id AND pc.canal = 'WHATSAPP' AND pc.verificado
            AND pc.activo AND pc.bloqueado_at IS NULL
       ) AND public.persona_consiente(pe.id, 'WHATSAPP')) AS alcanzables
  FROM personas pe
  JOIN sedes s ON s.id = pe.sede_id
 WHERE NULLIF(btrim(COALESCE(pe.cargo, '')), '') IS NOT NULL
   AND upper(COALESCE(pe.estado, '')) NOT IN ('RETIRADO','INACTIVO','SUSPENDIDO')
 GROUP BY 1, 2;

COMMENT ON VIEW crm_cargos_audiencia IS
  'Cargos de la nómina por contrato, con cuántas personas tienen y cuántas son ALCANZABLES por WhatsApp (canal verificado y opt-in vigente). Es el catálogo del «rol» de una audiencia, y el número que evita armar un envío de 700 personas que le llega a 3.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. RLS
-- ──────────────────────────────────────────────────────────────────────────────
-- Lecturas con permiso Y alcance por contrato. Escrituras SIN política: entran
-- por las funciones SECURITY DEFINER de arriba, que es lo que garantiza que no
-- se pueda armar un envío saltándose las comprobaciones (ni el portero).
--
-- Las llamadas van envueltas en `(select …)` para que se evalúen una vez por
-- consulta y no una por fila: es la corrección de la migración 20261028000001, y
-- en estas tablas importa más que en ninguna porque un envío son miles de filas.
ALTER TABLE crm_envios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_envio_destinos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_menu_opciones   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_envios_read ON crm_envios;
CREATE POLICY crm_envios_read ON crm_envios
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_envios_acceso()) AND (SELECT public.auth_ve_grupo(crm_envios.grupo_id)));

DROP POLICY IF EXISTS crm_envio_destinos_read ON crm_envio_destinos;
CREATE POLICY crm_envio_destinos_read ON crm_envio_destinos
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_envios_acceso())
         AND (SELECT public.auth_ve_grupo(crm_envio_destinos.grupo_id)));

-- El menú lo lee quien ve WhatsApp o quien lo configura. Las opciones generales
-- (sin contrato) las ve cualquiera de los dos; las de un contrato, quien lo
-- alcanza.
DROP POLICY IF EXISTS crm_menu_read ON crm_menu_opciones;
CREATE POLICY crm_menu_read ON crm_menu_opciones
  FOR SELECT TO authenticated
  USING (((SELECT public.whatsapp_acceso()) OR (SELECT public.crm_menu_gestiona()))
         AND (crm_menu_opciones.grupo_id IS NULL
              OR (SELECT public.auth_ve_grupo(crm_menu_opciones.grupo_id))));

GRANT SELECT ON crm_envios_resumen TO authenticated;
GRANT SELECT ON crm_cargos_audiencia TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. Permisos sembrados
-- ──────────────────────────────────────────────────────────────────────────────
-- `defaults || permisos`: lo que ya esté puesto gana, así que re-aplicar la
-- migración no revive un permiso que un administrador haya apagado a mano.
UPDATE public.roles
   SET permisos = jsonb_build_object('ver_envios_whatsapp', true,
                                     'gestionar_envios_whatsapp', true,
                                     'gestionar_menu_whatsapp', true) || permisos
 WHERE nombre IN ('Administrador', 'Gerencia', 'Supervisor de Conserjería');

-- Auditor: lee y no toca, el mismo criterio que F9 y PQRS.
UPDATE public.roles
   SET permisos = permisos || '{"ver_envios_whatsapp": true}'::jsonb
 WHERE nombre = 'Auditor';

-- ──────────────────────────────────────────────────────────────────────────────
-- 16. La plantilla del aviso masivo
-- ──────────────────────────────────────────────────────────────────────────────
-- Un envío masivo cae casi siempre FUERA de la ventana de 24 horas (la persona
-- no escribió primero), y fuera de la ventana sólo sale una plantilla APPROVED.
-- Sin una plantilla para esto, el masivo nacería OMITIDO_VENTANA en todos sus
-- destinos. Nace `PENDIENTE`, como las diez de F9: aprobarla en Meta es un paso
-- que necesita credenciales y no se puede fingir desde aquí.
--
-- UTILITY y no MARKETING: es una instrucción de trabajo. El CHECK de la tabla ni
-- siquiera admite MARKETING.
INSERT INTO whatsapp_plantillas (nombre, categoria, idioma, encabezado, cuerpo, pie,
                                 botones, variables, proposito)
VALUES
  ('aviso_masivo_operacion', 'UTILITY', 'es_CO',
   'Aviso de operación',
   'Hola {{1}}. {{2}}',
   'Conserjes Inmobiliarios',
   '[]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana","descripcion":"nombre de pila"},{"pos":2,"ejemplo":"Mañana el ingreso a la sede es por la puerta 2.","descripcion":"el aviso"}]'::jsonb,
   'El aviso masivo de la §4.1: un mensaje por persona, dentro de su jornada, con el texto que escribe quien arma el envío.'),

  ('proxima_ubicacion_punto', 'UTILITY', 'es_CO',
   'Tu próximo punto',
   'Hola {{1}}. Tu próximo punto es {{2}} — {{3}}. Escribí MENÚ para ver las opciones.',
   'Asistente de rondas',
   '[{"tipo":"RESPUESTA","texto":"Ver el menú"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana","descripcion":"nombre de pila"},{"pos":2,"ejemplo":"K7M-4QX9","descripcion":"código del punto"},{"pos":3,"ejemplo":"Portería principal","descripcion":"nombre del punto"}]'::jsonb,
   'Avisar la próxima parada de la ruta cuando el bot inicia el contacto y la ventana de 24 h está cerrada (§4.3).')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 17. El menú por defecto (todos los contratos, todos los cargos)
-- ──────────────────────────────────────────────────────────────────────────────
-- Sin esto, escribir MENÚ no mostraría nada hasta que alguien configure uno, y
-- el bot tendría una puerta que no abre. Son las acciones que el bot ya sabe
-- hacer hoy; `MI_MAPA` y `PQRS` quedan fuera del menú sembrado a propósito,
-- porque el enlace firmado del mapa y la radicación por chat piden decisiones
-- que no son de esta fase (ver el informe).
INSERT INTO crm_menu_opciones (grupo_id, cargo, orden, etiqueta, descripcion, accion)
VALUES
  (NULL, NULL, 1, 'Mis puntos de hoy',  'Los puntos que te toca visitar hoy y cómo van', 'MIS_PUNTOS'),
  (NULL, NULL, 2, 'Mi próximo punto',   'A dónde seguís y cómo llegar',                  'PROXIMA_UBICACION'),
  (NULL, NULL, 3, 'Reportar novedad',   'Algo roto, algo que falta, algo que viste',      'NOVEDAD'),
  (NULL, NULL, 4, 'Hablar con alguien', 'Te paso con tu supervisor',                      'SUPERVISOR'),
  (NULL, NULL, 5, 'Mis datos',          'Qué permisos diste y cómo retirarlos',           'PRIVACIDAD'),
  (NULL, NULL, 6, 'Ayuda',              'Qué puedo hacer por acá',                        'AYUDA')
ON CONFLICT (grupo_id, cargo, orden) DO NOTHING;

-- =============================================================================
-- FIN F10
-- =============================================================================
