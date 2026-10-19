-- =============================================================================
-- PUNTOS QR — F4: LA EJECUCIÓN DE LA VISITA
-- =============================================================================
-- Cuarta migración del módulo (F1 contrato, F2 puntos y QR, F3 catálogo y
-- asignaciones). Con esta el módulo existe de punta a punta: alguien escanea la
-- placa, se identifica, hace las tareas que aplican a esa hora, deja evidencia
-- con su huella, firma y queda un reporte en PDF con su sha256.
--
-- Plan: docs/puntos-qr-whatsapp/00-exploracion-y-plan.md §2.4 y §2.5 (el modelo
-- de datos de esta fase), los ADR A (identidad), C (medios y URLs firmadas),
-- D (cola offline) y E (RPC frente a server actions);
-- docs/puntos-qr-whatsapp/02-complemento-2-integracion.md §1.1 (las dos apps con
-- el núcleo compartido, que corrige el ADR-A), §1.3 (retención como parámetro),
-- §2.4 (qué columna de alcance lleva cada tabla) y §2.5 (vigencia efectiva);
-- docs/puntos-qr-whatsapp/adr-02-antifraude-ia.md §2.6, §2.7 y §2.9 (qué se
-- guarda como prueba de cada evidencia y qué se valida en el dispositivo frente
-- a qué se valida al sincronizar);
-- y docs/puntos-qr-whatsapp/03-nomenclatura.md, que manda en los nombres.
--
-- Qué entra:
--   1. `persona_canales` y `persona_consentimientos` — el canal verificado al
--      que se manda el enlace de un uso, y el consentimiento versionado.
--   2. `ronda_sesiones` — el enlace de un uso + PIN del ADR-A, para las ~5.700
--      personas que NO tienen fila en `usuarios`.
--   3. `ronda_visitas`, `ronda_respuestas`, `ronda_evidencias`, `ronda_firmas`,
--      `ronda_reportes`, `ronda_novedades`.
--   4. Las RPC del ADR-E: un solo camino de escritura para la PWA, la cola
--      offline y —cuando llegue F9— el bot.
--   5. El bucket privado `rondas` del ADR-C con sus políticas por carpeta.
--   6. La retención de evidencia leyendo `grupo_reglas.retencion_evidencia_meses`
--      (12 por defecto, parámetro y no constante).
--
-- Qué NO entra, a propósito:
--   · NADA del complemento 1: ni reto aleatorio ni anclas 360°. La visita se
--     ejecuta sin reto y con el nivel de rigor por defecto (§7 del complemento
--     2). No hay ninguna columna ni tipo que nombre un reto.
--   · El PUNTAJE de confianza. `ronda_visitas.puntaje_confianza` nace y se queda
--     en NULL: la fórmula, los pesos y los vetos son de F13 (ADR-02). Esta fase
--     registra las señales —origen de la foto, hash, QR en la imagen, distancia,
--     precisión, desfase de reloj, método de identidad— para que F13 puntúe sin
--     tener que volver al terreno.
--   · La verificación FACIAL. Queda el método usado y, cuando se firma con
--     trazo porque no hay consentimiento biométrico, el motivo. Negarse a la
--     biometría no bloquea el trabajo: lo garantiza un trigger, no la pantalla.
--   · El rediseño de `mantenimiento_tickets` (estados nuevos, `grupo_id`,
--     ticket sin equipo). Eso es F7; aquí la novedad usa el esquema de HOY.
--
-- Idempotente: se puede correr dos veces seguidas. Verificada sin aplicar, con
-- BEGIN … ROLLBACK, por scripts/probar-puntos-qr-f4.mjs.
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. Dependencias
-- ──────────────────────────────────────────────────────────────────────────────
-- F2 y F3 tienen que estar aplicadas: esta fase cuelga de `ronda_puntos`,
-- `ronda_qr`, `ronda_plantillas` y `ronda_plantilla_pasos`, y una llave foránea
-- que falte deja la mitad del esquema a medio hacer. Mejor un mensaje claro que
-- un `relation does not exist` a mitad del archivo.
DO $$
DECLARE faltan TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF to_regclass('public.ronda_puntos')          IS NULL THEN faltan := faltan || 'ronda_puntos (F2)'; END IF;
  IF to_regclass('public.ronda_qr')              IS NULL THEN faltan := faltan || 'ronda_qr (F2)'; END IF;
  IF to_regclass('public.ronda_eventos')         IS NULL THEN faltan := faltan || 'ronda_eventos (F2)'; END IF;
  IF to_regclass('public.ronda_plantillas')      IS NULL THEN faltan := faltan || 'ronda_plantillas (F3)'; END IF;
  IF to_regclass('public.ronda_plantilla_pasos') IS NULL THEN faltan := faltan || 'ronda_plantilla_pasos (F3)'; END IF;
  IF to_regclass('public.ronda_asignaciones')    IS NULL THEN faltan := faltan || 'ronda_asignaciones (F3)'; END IF;
  IF array_length(faltan, 1) > 0 THEN
    RAISE EXCEPTION 'F4 necesita F2 y F3 aplicadas. Falta: %', array_to_string(faltan, ', ');
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Consecutivo de la visita y de su reporte
-- ──────────────────────────────────────────────────────────────────────────────
-- Una sola SEQUENCE y un solo número. La §4 de la nomenclatura nombra la serie
-- «Reporte de visita» con formato `RV-000001` y secuencia `ronda_reporte_seq`;
-- el documento 00 numera la VISITA con ese mismo formato. No son dos números:
-- el número de la visita ES el del reporte que la cierra, y `ronda_reportes`
-- copia el de su visita. Así nadie tiene que cruzar dos consecutivos para
-- encontrar el papel de una ronda.
--
-- Nunca COUNT(*)+1 ni un contador por fecha: en un cambio de turno dos celulares
-- cierran visita en el mismo segundo y colisionan.
CREATE SEQUENCE IF NOT EXISTS ronda_reporte_seq;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Permisos del módulo de ejecución
-- ──────────────────────────────────────────────────────────────────────────────
-- Claves planas en snake_case, como manda la §2 de la nomenclatura, y espejadas
-- en apps/inventario/lib/permisos.ts al final del grupo «Operación Conserjería».
-- Una clave que no esté en ese catálogo no aparece en /roles, nadie la puede
-- marcar, y la política que la exija rechaza a todo el mundo menos ADMIN.
--
-- `ejecutar_rondas` va aparte de `ver_visitas_rondas` porque son dos oficios
-- distintos: el conserje ejecuta y no tiene por qué leer el tablero de nadie;
-- quien supervisa lee todo su alcance y no ejecuta.
CREATE OR REPLACE FUNCTION public.ronda_visitas_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_visitas_rondas,gestionar_visitas_rondas}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_visitas_acceso() IS
  'Lee las visitas, su evidencia y sus reportes dentro de su alcance de contratos.';
GRANT EXECUTE ON FUNCTION public.ronda_visitas_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_ejecuta()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ejecutar_rondas,gestionar_visitas_rondas}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_ejecuta() IS
  'Abre visitas, responde pasos, adjunta evidencia y firma desde la PWA del trabajador.';
GRANT EXECUTE ON FUNCTION public.ronda_ejecuta() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_visitas_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_visitas_rondas')
$$;
COMMENT ON FUNCTION public.ronda_visitas_gestiona() IS
  'Anula visitas, corrige lo cerrado y purga evidencia vencida. Es la clave que puede borrar prueba, así que va sola.';
GRANT EXECUTE ON FUNCTION public.ronda_visitas_gestiona() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_accesos_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_accesos_campo')
$$;
COMMENT ON FUNCTION public.ronda_accesos_gestiona() IS
  'Manda el enlace de un uso y el PIN a quien no tiene cuenta, y puede dictarlo por teléfono (entrega asistida).';
GRANT EXECUTE ON FUNCTION public.ronda_accesos_gestiona() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `persona_canales` — el canal verificado de la persona
-- ──────────────────────────────────────────────────────────────────────────────
-- Es a dónde se manda el enlace de un uso del ADR-A, y mañana el WhatsApp de
-- F9. `UNIQUE (canal, valor)`: un número pertenece a UNA persona, porque si dos
-- personas comparten un número, un enlace de acceso puede terminar en el
-- celular equivocado.
--
-- `verificado` no es decoración: el enlace SOLO se manda a un canal verificado.
-- Un canal sin verificar es un número que alguien escribió en un formulario.
CREATE TABLE IF NOT EXISTS persona_canales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  canal               VARCHAR(10) NOT NULL CHECK (canal IN ('WHATSAPP','SMS','CORREO')),
  valor               VARCHAR(160) NOT NULL,
  wa_id               VARCHAR(40),
  verificado          BOOLEAN NOT NULL DEFAULT false,
  verificado_at       TIMESTAMPTZ,
  verificacion_metodo VARCHAR(10) CHECK (verificacion_metodo IS NULL
                                         OR verificacion_metodo IN ('OTP','CONSOLA')),
  principal           BOOLEAN NOT NULL DEFAULT false,
  activo              BOOLEAN NOT NULL DEFAULT true,
  bloqueado_at        TIMESTAMPTZ,
  bloqueo_motivo      TEXT,
  created_by          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- E.164 para WhatsApp y SMS (`+57…`), correo para CORREO. Validación de
  -- FORMA, no de existencia: que el número exista lo dice la verificación.
  CONSTRAINT ck_persona_canal_valor CHECK (
    CASE canal
      WHEN 'CORREO' THEN valor ~ '^[^@[:space:]]+@[^@[:space:]]+[.][A-Za-z]{2,}$'
      ELSE valor ~ '^[+][1-9][0-9]{7,14}$'
    END
  ),
  CONSTRAINT ck_persona_canal_verificado CHECK (
    verificado = false OR (verificado_at IS NOT NULL AND verificacion_metodo IS NOT NULL)
  ),
  CONSTRAINT ck_persona_canal_bloqueo CHECK (
    bloqueado_at IS NULL OR NULLIF(btrim(bloqueo_motivo), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_persona_canales_valor ON persona_canales(canal, valor);
CREATE UNIQUE INDEX IF NOT EXISTS ux_persona_canales_principal
  ON persona_canales(persona_id, canal) WHERE principal;
CREATE INDEX IF NOT EXISTS idx_persona_canales_persona ON persona_canales(persona_id, canal);
CREATE INDEX IF NOT EXISTS idx_persona_canales_wa      ON persona_canales(wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_persona_canales_upd     ON persona_canales(updated_at);

COMMENT ON TABLE persona_canales IS
  'Canales de contacto de una persona (WhatsApp, SMS, correo). A un canal VERIFICADO se le manda el enlace de un uso del ADR-A; a uno sin verificar, nunca.';
COMMENT ON COLUMN persona_canales.valor IS
  'E.164 para WhatsApp y SMS (+57…), dirección de correo para CORREO. El CHECK valida la FORMA; que el número exista lo dice la verificación.';
COMMENT ON COLUMN persona_canales.verificado IS
  'Solo a un canal verificado se le manda el enlace de acceso. Un canal sin verificar es texto que alguien escribió en un formulario.';
COMMENT ON COLUMN persona_canales.bloqueado_at IS
  'Canal bloqueado (el dueño pidió no ser contactado, o hubo abuso). Un canal bloqueado no recibe enlaces ni mensajes, y el motivo es obligatorio.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `persona_consentimientos` — versionado y revocable
-- ──────────────────────────────────────────────────────────────────────────────
-- Calcado de `consentimientos` del ATS (20240114000000_registro_vacantes.sql),
-- pero colgando de `personas`. Se guarda el TEXTO que la persona leyó —su
-- versión y su hash—, no solo un «sí»: un consentimiento sin el texto que se
-- aceptó no prueba nada (Ley 1581 de 2012, y la Parte 4 del documento 00).
--
-- `BIOMETRIA` es un tipo APARTE de `FOTOS` a propósito: la foto de una llave de
-- paso y la foto de una cara no son el mismo dato, y quien no consiente la
-- biometría tiene que poder seguir trabajando. Sin él la firma facial no se
-- ofrece y se usa el trazo, con el motivo registrado en `ronda_firmas`.
CREATE TABLE IF NOT EXISTS persona_consentimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id    UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  tipo          VARCHAR(12) NOT NULL
                CHECK (tipo IN ('UBICACION','FOTOS','AUDIO','BIOMETRIA','WHATSAPP')),
  otorgado      BOOLEAN NOT NULL,
  texto_version TEXT NOT NULL,
  texto_hash    TEXT NOT NULL,
  canal         VARCHAR(10) NOT NULL DEFAULT 'APP'
                CHECK (canal IN ('APP','WHATSAPP','CONSOLA','PAPEL')),
  ip            INET,
  user_agent    TEXT,
  registrado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revocado_at   TIMESTAMPTZ,
  CONSTRAINT ck_consentimiento_texto CHECK (
    NULLIF(btrim(texto_version), '') IS NOT NULL AND NULLIF(btrim(texto_hash), '') IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_persona_consent_persona ON persona_consentimientos(persona_id, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_persona_consent_fecha   ON persona_consentimientos(created_at DESC);

COMMENT ON TABLE persona_consentimientos IS
  'Consentimiento VERSIONADO de la persona por tipo de dato (ubicación, fotos, audio, biometría, WhatsApp). Append-only: revocar agrega la revocación, no borra la fila. Calcado de `consentimientos` del ATS.';
COMMENT ON COLUMN persona_consentimientos.tipo IS
  'BIOMETRIA va aparte de FOTOS: sin ese consentimiento la firma facial no se ofrece y se firma con trazo, y negarse NUNCA bloquea el trabajo (lo garantiza el trigger de ronda_firmas, no la pantalla).';
COMMENT ON COLUMN persona_consentimientos.texto_hash IS
  'SHA-256 del texto exacto que la persona leyó. Un «sí» sin el texto aceptado no prueba nada.';

/** ¿La persona tiene este consentimiento vigente? La última fila manda. */
CREATE OR REPLACE FUNCTION public.persona_consiente(p_persona UUID, p_tipo TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT c.otorgado AND c.revocado_at IS NULL
      FROM public.persona_consentimientos c
     WHERE c.persona_id = p_persona AND c.tipo = upper(p_tipo)
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1
  ), false)
$$;
COMMENT ON FUNCTION public.persona_consiente(UUID, TEXT) IS
  'TRUE si la ÚLTIMA declaración de la persona para ese tipo fue otorgarlo y no está revocada. La tabla es append-only, así que «el último manda» es la regla de lectura.';
GRANT EXECUTE ON FUNCTION public.persona_consiente(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `ronda_sesiones` — enlace de un uso + PIN (ADR-A)
-- ──────────────────────────────────────────────────────────────────────────────
-- TABLA QUE NO ESTABA EN LA LISTA DE LA FASE, y por qué hace falta: la decisión
-- aprobada dice «enlace de un uso + PIN enviado al persona_canales verificado,
-- que crea una sesión acotada ligada a persona_id». Eso es estado: hay que
-- guardar el token del enlace, el PIN (hasheado), a quién se le mandó, cuándo
-- vence, si ya se usó y cuántas veces se erró el PIN. Sin tabla, el enlace de un
-- uso no tendría dónde quemarse y sería un enlace de muchos usos.
--
-- Qué NO es: no es una sesión de Supabase Auth. Quien entra así NO tiene
-- `auth.uid()`, así que su cuenta no existe para la RLS. Sus escrituras entran
-- por las RPC llamadas desde un route handler con la llave de servicio, que es
-- el mismo patrón que ya usa la ruta pública /q/<token> (app/q/puerta-supabase.ts).
-- La cookie firmada que lleva el navegador la emite la aplicación, no Postgres.
--
-- Ni el token ni el PIN se guardan en claro: se guardan sus SHA-256. Quien lea
-- la tabla no puede entrar con lo que leyó.
CREATE TABLE IF NOT EXISTS ronda_sesiones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id       UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  persona_nombre   VARCHAR(250),
  canal_id         UUID REFERENCES persona_canales(id) ON DELETE SET NULL,
  canal            VARCHAR(10) NOT NULL CHECK (canal IN ('WHATSAPP','SMS','CORREO','CONSOLA')),
  destino_enmascarado VARCHAR(40),
  token_hash       CHAR(64) NOT NULL,
  pin_hash         CHAR(64) NOT NULL,
  -- El alcance de la sesión: el punto por el que entró y su contrato. Una
  -- sesión de campo no tiene «todos los contratos»: tiene el de la placa que
  -- escaneó, y es con ese con el que se le responde qué tareas hay.
  grupo_id         UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  punto_id         UUID REFERENCES ronda_puntos(id) ON DELETE SET NULL,
  destino_ruta     TEXT,
  estado           VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (estado IN ('PENDIENTE','ACTIVA','VENCIDA','ANULADA')),
  entrega_estado   VARCHAR(16) NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (entrega_estado IN ('PENDIENTE','ENVIADO','SIN_CANAL','ASISTIDA','FALLIDO')),
  entrega_detalle  TEXT,
  intentos_pin     SMALLINT NOT NULL DEFAULT 0 CHECK (intentos_pin >= 0),
  vence_at         TIMESTAMPTZ NOT NULL,
  usado_at         TIMESTAMPTZ,
  sesion_vence_at  TIMESTAMPTZ,
  ip_solicitud     INET,
  ip_uso           INET,
  user_agent       TEXT,
  creado_por       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  anulada_motivo   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_sesion_activa CHECK (
    estado <> 'ACTIVA' OR (usado_at IS NOT NULL AND sesion_vence_at IS NOT NULL)
  ),
  CONSTRAINT ck_sesion_anulada CHECK (
    estado <> 'ANULADA' OR NULLIF(btrim(anulada_motivo), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_sesiones_token ON ronda_sesiones(token_hash);
CREATE INDEX IF NOT EXISTS idx_ronda_sesiones_persona ON ronda_sesiones(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_sesiones_estado  ON ronda_sesiones(estado, vence_at);
CREATE INDEX IF NOT EXISTS idx_ronda_sesiones_grupo   ON ronda_sesiones(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_sesiones_upd     ON ronda_sesiones(updated_at);

COMMENT ON TABLE ronda_sesiones IS
  'Enlace de un uso + PIN del ADR-A, para las personas sin fila en `usuarios` (son ~6.564 personas y ~859 cuentas). NO es una sesión de Supabase Auth: quien entra así no tiene auth.uid(), y sus escrituras pasan por las RPC desde un route handler con la llave de servicio, igual que la ruta pública /q/<token>.';
COMMENT ON COLUMN ronda_sesiones.token_hash IS
  'SHA-256 del token del enlace. El token en claro solo existe en el mensaje que se le manda a la persona: quien lea esta tabla no puede entrar con lo que leyó.';
COMMENT ON COLUMN ronda_sesiones.pin_hash IS
  'SHA-256 de `pin + token` (el token hace de sal). Un PIN de 6 dígitos hasheado solo nunca sobreviviría a una tabla filtrada: con el token como sal, hay que tener el enlace Y el PIN.';
COMMENT ON COLUMN ronda_sesiones.entrega_estado IS
  'PENDIENTE · ENVIADO · SIN_CANAL (no hay transporte para ese canal todavía: WhatsApp es F9) · ASISTIDA (el supervisor lo dictó por teléfono, con gestionar_accesos_campo) · FALLIDO.';
COMMENT ON COLUMN ronda_sesiones.intentos_pin IS
  'Errores de PIN acumulados. Al quinto el enlace se anula: seis dígitos se adivinan por fuerza bruta si se deja intentar sin tope.';
COMMENT ON COLUMN ronda_sesiones.grupo_id IS
  'Contrato del punto por el que entró. Es TODO el alcance de la sesión: una sesión de campo no ve nada de otro contrato.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `ronda_visitas` — la visita
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` y `sede_id` NOT NULL los dos (§2.4), derivados del punto por un
-- trigger y no recibidos: si la aplicación los mandara, un error de pantalla
-- metería una visita de un contrato dentro de otro, y la RLS filtra justamente
-- por esa columna.
--
-- `plantilla_id` apunta a la VERSIÓN exacta que se usó, no al código. Es lo que
-- hace que publicar la v2 no reinterprete las respuestas de la v1 (el congelado
-- de F3 garantiza que esa versión ya no se puede tocar).
--
-- Los TRES relojes, que es la parte que se equivoca sola si no se escribe con
-- cuidado (ADR-02 §2.9):
--   · `inicio_servidor` / `fin_servidor` — NOW() del servidor. **Es la que
--     vale**, y es la única que nadie puede mover desde un celular.
--   · `inicio_dispositivo` / `fin_dispositivo` — lo que decía el celular. Es
--     DATO, no verdad: el reloj se cambia en dos toques.
--   · `desfase_reloj_seg` — la diferencia entre los dos, y SOLO tiene sentido
--     cuando la visita llegó en línea. En una visita que viene de la cola,
--     la diferencia es el tiempo que estuvo guardada, no un reloj torcido: eso
--     va en `demora_sync_seg`. Mezclarlas haría que toda visita de sótano
--     pareciera fraude.
-- La cadena monotónica con ancla firmada del ADR-02 §2.9 NO está aquí: es de
-- F13, y meter media cadena ahora daría una señal que no se puede verificar.
CREATE TABLE IF NOT EXISTS ronda_visitas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                VARCHAR(12) NOT NULL,
  grupo_id              UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id               UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  zona_id               UUID REFERENCES ronda_zonas(id) ON DELETE SET NULL,
  punto_id              UUID NOT NULL REFERENCES ronda_puntos(id) ON DELETE RESTRICT,
  asignacion_id         UUID REFERENCES ronda_asignaciones(id) ON DELETE SET NULL,
  plantilla_id          UUID NOT NULL REFERENCES ronda_plantillas(id) ON DELETE RESTRICT,
  plantilla_codigo      VARCHAR(40),
  plantilla_version     SMALLINT,
  -- La persona es el sujeto; el usuario puede ser NULL (la mayoría no tiene
  -- cuenta). El nombre va desnormalizado porque quien ve el tablero puede no
  -- tener `ver_personas`: la RLS de `personas` no le dejaría resolver el join.
  persona_id            UUID NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,
  usuario_id            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  persona_nombre        VARCHAR(250),
  canal                 VARCHAR(10) NOT NULL DEFAULT 'APP'
                        CHECK (canal IN ('APP','WHATSAPP','CONSOLA')),
  identidad_metodo      VARCHAR(12) NOT NULL DEFAULT 'CUENTA'
                        CHECK (identidad_metodo IN ('CUENTA','ENLACE_PIN','CONSOLA','BOT')),
  sesion_id             UUID REFERENCES ronda_sesiones(id) ON DELETE SET NULL,
  qr_id                 UUID REFERENCES ronda_qr(id) ON DELETE SET NULL,
  qr_version            SMALLINT,
  apertura_modo         VARCHAR(10) NOT NULL DEFAULT 'QR'
                        CHECK (apertura_modo IN ('QR','MANUAL','ASISTIDA')),
  inicio_servidor       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fin_servidor          TIMESTAMPTZ,
  inicio_dispositivo    TIMESTAMPTZ,
  fin_dispositivo       TIMESTAMPTZ,
  desfase_reloj_seg     INT,
  demora_sync_seg       INT,
  duracion_seg          INT CHECK (duracion_seg IS NULL OR duracion_seg >= 0),
  lat                   DECIMAL(10,7),
  lng                   DECIMAL(10,7),
  precision_metros      DECIMAL(8,2),
  distancia_metros      DECIMAL(8,2),
  dentro_geocerca       BOOLEAN,
  ubicacion_dudosa      BOOLEAN NOT NULL DEFAULT false,
  motivo_fuera_geocerca TEXT,
  estado                VARCHAR(12) NOT NULL DEFAULT 'ABIERTA'
                        CHECK (estado IN ('ABIERTA','EN_CURSO','COMPLETADA','INCOMPLETA','ANULADA','VENCIDA')),
  incompleta_motivo     TEXT,
  faltantes             JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 0–100, lo define adr-02-antifraude-ia.md. F4 lo deja en NULL a propósito:
  -- registra las señales, no puntúa.
  puntaje_confianza     SMALLINT CHECK (puntaje_confianza IS NULL
                                        OR puntaje_confianza BETWEEN 0 AND 100),
  offline               BOOLEAN NOT NULL DEFAULT false,
  sincronizada_at       TIMESTAMPTZ,
  observacion           TEXT,
  anulada_motivo        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_visita_lat  CHECK (lat IS NULL OR lat BETWEEN -90  AND 90),
  CONSTRAINT ck_visita_lng  CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  CONSTRAINT ck_visita_coord CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT ck_visita_prec CHECK (precision_metros IS NULL OR precision_metros >= 0),
  -- LA regla de la geocerca: una visita marcada fuera de cerca EXIGE motivo.
  -- Está aquí y no en la pantalla porque el bot y la cola offline escriben por
  -- el mismo sitio y se la saltarían.
  CONSTRAINT ck_visita_fuera_geocerca CHECK (
    dentro_geocerca IS DISTINCT FROM false
    OR NULLIF(btrim(motivo_fuera_geocerca), '') IS NOT NULL
  ),
  CONSTRAINT ck_visita_cerrada CHECK (
    estado NOT IN ('COMPLETADA','INCOMPLETA') OR fin_servidor IS NOT NULL
  ),
  CONSTRAINT ck_visita_incompleta CHECK (
    estado <> 'INCOMPLETA' OR NULLIF(btrim(incompleta_motivo), '') IS NOT NULL
  ),
  CONSTRAINT ck_visita_anulada CHECK (
    estado <> 'ANULADA' OR NULLIF(btrim(anulada_motivo), '') IS NOT NULL
  ),
  -- Una visita que dice venir de la cola tiene que decir CUÁNDO llegó.
  CONSTRAINT ck_visita_offline CHECK (offline = false OR sincronizada_at IS NOT NULL),
  -- El desfase de reloj es señal de reloj torcido y solo se mide en línea; la
  -- demora de sincronización solo existe para lo que vino de la cola.
  CONSTRAINT ck_visita_relojes CHECK (
    (offline = false OR desfase_reloj_seg IS NULL)
    AND (offline = true OR demora_sync_seg IS NULL)
  ),
  CONSTRAINT ck_visita_sesion CHECK (identidad_metodo <> 'ENLACE_PIN' OR sesion_id IS NOT NULL)
);
-- `identidad_debil` es CALCULADA: quien entró con enlace + PIN quedó
-- identificado más débilmente que quien tiene cuenta, y eso pesa MENOS en el
-- puntaje que calculará F13. Se guarda como columna y no como regla de lectura
-- para que un informe no la pueda calcular distinto.
ALTER TABLE ronda_visitas DROP COLUMN IF EXISTS identidad_debil;
ALTER TABLE ronda_visitas ADD COLUMN identidad_debil BOOLEAN
  GENERATED ALWAYS AS (identidad_metodo <> 'CUENTA') STORED;

ALTER TABLE ronda_visitas ALTER COLUMN numero SET DEFAULT
  'RV-' || lpad(nextval('ronda_reporte_seq')::text, 6, '0');

CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_visitas_numero ON ronda_visitas(numero);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_grupo   ON ronda_visitas(grupo_id, inicio_servidor DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_sede    ON ronda_visitas(sede_id, inicio_servidor DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_punto   ON ronda_visitas(punto_id, inicio_servidor DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_persona ON ronda_visitas(persona_id, inicio_servidor DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_usuario ON ronda_visitas(usuario_id) WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_estado  ON ronda_visitas(estado, inicio_servidor DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_asign   ON ronda_visitas(asignacion_id, inicio_servidor DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_abiertas ON ronda_visitas(persona_id, punto_id)
  WHERE estado IN ('ABIERTA','EN_CURSO');
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_upd     ON ronda_visitas(updated_at);

COMMENT ON TABLE ronda_visitas IS
  'Una visita a un punto de control: quién, cuándo, desde dónde, con qué versión de la plantilla y cómo se identificó. Es la fila de la que cuelgan respuestas, evidencia, firmas, reporte y novedades.';
COMMENT ON COLUMN ronda_visitas.numero IS
  'Consecutivo RV-000001 de `ronda_reporte_seq`. Es el MISMO número que lleva el reporte de la visita: no son dos series (§4 de la nomenclatura).';
COMMENT ON COLUMN ronda_visitas.plantilla_id IS
  'La VERSIÓN exacta de la plantilla que se usó, no el código. Por eso publicar la v2 no cambia lo que esta visita contestó.';
COMMENT ON COLUMN ronda_visitas.inicio_servidor IS
  'Hora del SERVIDOR al abrir: la que vale. La del celular va en inicio_dispositivo y es dato, no verdad.';
COMMENT ON COLUMN ronda_visitas.desfase_reloj_seg IS
  'Segundos entre el reloj del celular y el del servidor. Solo para visitas EN LÍNEA: en una que vino de la cola la diferencia es cuánto estuvo guardada, y eso es demora_sync_seg.';
COMMENT ON COLUMN ronda_visitas.demora_sync_seg IS
  'Segundos entre la hora del dispositivo al abrir y la llegada al servidor. Solo para visitas de la cola offline. No es una señal de fraude por sí misma: un sótano sin señal es el caso normal.';
COMMENT ON COLUMN ronda_visitas.ubicacion_dudosa IS
  'La precisión reportada por el GPS es PEOR que el radio de la geocerca, así que «dentro» y «fuera» no se pueden distinguir. No se rechaza en silencio: la visita queda abierta, marcada, y el motivo se pide igual que si estuviera fuera.';
COMMENT ON COLUMN ronda_visitas.motivo_fuera_geocerca IS
  'Obligatorio cuando dentro_geocerca = false (lo exige ck_visita_fuera_geocerca, no la pantalla).';
COMMENT ON COLUMN ronda_visitas.identidad_debil IS
  'CALCULADA: TRUE cuando no se entró con una cuenta de Supabase Auth. La identidad por enlace + PIN es más débil y pesa MENOS en el puntaje de F13 (ADR-A).';
COMMENT ON COLUMN ronda_visitas.puntaje_confianza IS
  'Puntaje de confianza 0–100 del ADR-02. F4 lo deja en NULL: registra las señales, no puntúa. Lo calcula F13.';
COMMENT ON COLUMN ronda_visitas.faltantes IS
  'Qué quedó sin hacer al cerrar, como lo devuelve ronda_validar_cierre(). Se guarda para no tener que recalcularlo con una plantilla que ya cambió.';
COMMENT ON COLUMN ronda_visitas.estado IS
  'ABIERTA → EN_CURSO → COMPLETADA o INCOMPLETA. ANULADA (con motivo) y VENCIDA (la cierra el cron de F13). Una visita INCOMPLETA se cierra igual: el trabajador nunca queda atrapado, pero el motivo es obligatorio.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. `ronda_respuestas` — una fila por paso contestado
-- ──────────────────────────────────────────────────────────────────────────────
-- `plantilla_id`, `orden` y `tipo` van redundantes (los deriva el trigger del
-- paso): dejan explícita la versión con la que se contestó y permiten leer el
-- reporte sin tocar el catálogo, que puede haber archivado la plantilla.
--
-- Una casilla en NO exige motivo y lo exige LA BASE. `motivo_exigido` lo
-- deriva el trigger de `config->>'motivo_obligatorio_si_no'` del paso (F3 dejó
-- dicho que «el motivo lo obliga ronda_respuestas en F4»), así que la regla
-- queda donde la RLS no se puede saltar y además respeta la parametrización de
-- la plantilla en vez de imponer un absoluto.
CREATE TABLE IF NOT EXISTS ronda_respuestas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visita_id              UUID NOT NULL REFERENCES ronda_visitas(id) ON DELETE CASCADE,
  paso_id                UUID NOT NULL REFERENCES ronda_plantilla_pasos(id) ON DELETE RESTRICT,
  plantilla_id           UUID NOT NULL REFERENCES ronda_plantillas(id) ON DELETE RESTRICT,
  orden                  SMALLINT NOT NULL,
  tipo                   VARCHAR(10) NOT NULL
                         CHECK (tipo IN ('CASILLA','FOTO','VIDEO','TEXTO','NOTA_VOZ',
                                         'NUMERO','SELECCION','ESCANEO','FIRMA')),
  valor_bool             BOOLEAN,
  valor_texto            TEXT,
  valor_numero           DECIMAL(14,4),
  valor_opciones         TEXT[],
  motivo                 TEXT,
  motivo_exigido         BOOLEAN NOT NULL DEFAULT true,
  transcripcion          TEXT,
  entidad_tipo           VARCHAR(12) CHECK (entidad_tipo IS NULL
                                            OR entidad_tipo IN ('producto','maquinaria')),
  entidad_id             UUID,
  entidad_codigo         VARCHAR(60),
  omitido                BOOLEAN NOT NULL DEFAULT false,
  omision_motivo         TEXT,
  respondido_dispositivo TIMESTAMPTZ,
  respondido_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- UNA respuesta por paso: corregir en el resumen actualiza la fila, no agrega
  -- otra, y así el reporte no puede mostrar dos respuestas a la misma pregunta.
  CONSTRAINT ux_ronda_respuestas_paso UNIQUE (visita_id, paso_id),
  CONSTRAINT ck_respuesta_casilla_motivo CHECK (
    NOT (tipo = 'CASILLA' AND valor_bool = false AND motivo_exigido
         AND NULLIF(btrim(motivo), '') IS NULL)
  ),
  CONSTRAINT ck_respuesta_omitido CHECK (
    omitido = false OR NULLIF(btrim(omision_motivo), '') IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_ronda_respuestas_visita ON ronda_respuestas(visita_id, orden);
CREATE INDEX IF NOT EXISTS idx_ronda_respuestas_paso   ON ronda_respuestas(paso_id);
CREATE INDEX IF NOT EXISTS idx_ronda_respuestas_upd    ON ronda_respuestas(updated_at);

COMMENT ON TABLE ronda_respuestas IS
  'Una fila por paso contestado, con UNIQUE (visita_id, paso_id): corregir en el resumen actualiza la fila. Guarda la versión de la plantilla y el tipo del paso para que el reporte se pueda leer aunque el catálogo haya cambiado.';
COMMENT ON COLUMN ronda_respuestas.valor_bool IS
  'CASILLA: true = Sí, false = No, NULL = No aplica (y valor_texto guarda SI/NO/NO_APLICA tal cual). Un NO sin motivo lo rechaza ck_respuesta_casilla_motivo.';
COMMENT ON COLUMN ronda_respuestas.motivo_exigido IS
  'Derivado de config.motivo_obligatorio_si_no del paso por el trigger. Así el CHECK respeta la parametrización de la plantilla en vez de imponer un absoluto, y sigue viviendo en la base.';
COMMENT ON COLUMN ronda_respuestas.omitido IS
  'El paso se saltó. Siempre con motivo: un paso obligatorio que se omite sin explicación es lo mismo que no hacer la tarea.';
COMMENT ON COLUMN ronda_respuestas.respondido_dispositivo IS
  'Hora del celular al contestar. Como en la visita: dato, no verdad. La que vale es respondido_at, del servidor.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. `ronda_evidencias` — los medios, con su huella
-- ──────────────────────────────────────────────────────────────────────────────
-- Esta tabla es la prueba. Por cada archivo se guarda lo que el ADR-02 pide
-- para poder decidir después (§2.6): `sha256` (el mismo archivo, exacto),
-- `hash_perceptual` (la misma foto recomprimida o recortada), `origen` (cámara
-- en vivo o galería), dimensiones, ubicación, hora del dispositivo y, cuando el
-- paso lo exige, el token que se leyó DENTRO de la imagen y si coincide con el
-- punto.
--
-- Append-only: sin `updated_at` y sin política de UPDATE. Una evidencia que se
-- puede editar no es evidencia. Lo que se corrige es la RESPUESTA; el archivo
-- se reemplaza adjuntando otro y borrando el anterior, que queda en auditoría.
--
-- La repetición NO se bloquea con un índice único: se DETECTA y se registra.
-- Bloquear convertiría un caso legítimo (la misma foto en dos pasos de la misma
-- visita) en un error de la aplicación, y además quien decide qué hacer con una
-- foto repetida es el puntaje de F13, no un constraint.
CREATE TABLE IF NOT EXISTS ronda_evidencias (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visita_id              UUID NOT NULL REFERENCES ronda_visitas(id) ON DELETE CASCADE,
  respuesta_id           UUID REFERENCES ronda_respuestas(id) ON DELETE SET NULL,
  paso_id                UUID REFERENCES ronda_plantilla_pasos(id) ON DELETE SET NULL,
  tipo                   VARCHAR(5) NOT NULL CHECK (tipo IN ('FOTO','VIDEO','AUDIO')),
  archivo_path           TEXT NOT NULL,
  mime                   VARCHAR(100),
  tamano                 BIGINT CHECK (tamano IS NULL OR tamano >= 0),
  ancho                  INT CHECK (ancho IS NULL OR ancho > 0),
  alto                   INT CHECK (alto IS NULL OR alto > 0),
  duracion_seg           DECIMAL(8,2) CHECK (duracion_seg IS NULL OR duracion_seg >= 0),
  sha256                 CHAR(64) NOT NULL,
  hash_perceptual        VARCHAR(32),
  exif                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  origen                 VARCHAR(12) NOT NULL
                         CHECK (origen IN ('CAMARA_VIVO','GALERIA','WHATSAPP','CONSOLA')),
  recaptura_resultado    VARCHAR(12) NOT NULL DEFAULT 'SIN_DATO'
                         CHECK (recaptura_resultado IN ('LIMPIA','SOSPECHOSA','PANTALLA','SIN_DATO')),
  recaptura_detalle      JSONB NOT NULL DEFAULT '{}'::jsonb,
  qr_detectado           VARCHAR(64),
  qr_coincide            BOOLEAN,
  -- Detección de repetición, puesta por el trigger. `repetida_motivo` dice CÓMO
  -- se detectó, porque un sha256 igual y un hash perceptual parecido no son la
  -- misma acusación.
  repetida_de_id         UUID REFERENCES ronda_evidencias(id) ON DELETE SET NULL,
  repetida_motivo        VARCHAR(12) CHECK (repetida_motivo IS NULL
                                            OR repetida_motivo IN ('SHA256','PERCEPTUAL')),
  repetida_misma_visita  BOOLEAN,
  lat                    DECIMAL(10,7),
  lng                    DECIMAL(10,7),
  precision_metros       DECIMAL(8,2),
  capturado_dispositivo  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_evidencia_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_evidencia_lat CHECK (lat IS NULL OR lat BETWEEN -90  AND 90),
  CONSTRAINT ck_evidencia_lng CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  CONSTRAINT ck_evidencia_coord CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT ck_evidencia_path CHECK (NULLIF(btrim(archivo_path), '') IS NOT NULL),
  CONSTRAINT ck_evidencia_repetida CHECK ((repetida_de_id IS NULL) = (repetida_motivo IS NULL)),
  CONSTRAINT ck_evidencia_no_se_repite_a_si_misma CHECK (repetida_de_id IS NULL OR repetida_de_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_evidencias_path ON ronda_evidencias(archivo_path);
CREATE INDEX IF NOT EXISTS idx_ronda_evidencias_visita ON ronda_evidencias(visita_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ronda_evidencias_resp   ON ronda_evidencias(respuesta_id);
-- Los dos índices con los que se cruzan las repeticiones (ADR-02 §2.6.3).
CREATE INDEX IF NOT EXISTS idx_ronda_evidencias_sha    ON ronda_evidencias(sha256);
CREATE INDEX IF NOT EXISTS idx_ronda_evidencias_phash  ON ronda_evidencias(hash_perceptual)
  WHERE hash_perceptual IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_evidencias_rep    ON ronda_evidencias(repetida_de_id)
  WHERE repetida_de_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_evidencias_fecha  ON ronda_evidencias(created_at);

COMMENT ON TABLE ronda_evidencias IS
  'Medios de una visita con su huella: sha256, hash perceptual, origen de la captura, dimensiones, ubicación, hora del dispositivo y el QR leído dentro de la imagen. Append-only: no tiene updated_at ni política de UPDATE, porque una evidencia editable no es evidencia.';
COMMENT ON COLUMN ronda_evidencias.sha256 IS
  'SHA-256 del archivo tal como se subió. Sirve para detectar el MISMO archivo reusado dentro del sistema; entre canales no sirve (WhatsApp recomprime), y ahí el que vale es el hash perceptual.';
COMMENT ON COLUMN ronda_evidencias.hash_perceptual IS
  'dHash/pHash de la imagen: atrapa la misma foto recomprimida, recortada o reenviada. El cálculo robusto es de F13 (services/facial); aquí se guarda lo que el dispositivo o el worker reporten.';
COMMENT ON COLUMN ronda_evidencias.origen IS
  'CAMARA_VIVO · GALERIA · WHATSAPP · CONSOLA. Si el paso exige cámara en vivo, un archivo de galería se RECHAZA en la base (trigger ronda_evidencias_validar), no solo en la pantalla.';
COMMENT ON COLUMN ronda_evidencias.exif IS
  'EXIF si llegó. Nunca es obligatorio y NO pesa en el puntaje: WhatsApp lo borra y el DateTimeOriginal se edita con cualquier app (ADR-02 §2.8).';
COMMENT ON COLUMN ronda_evidencias.qr_detectado IS
  'Token leído DENTRO de la imagen cuando el paso lo exige (config.exige_qr_en_encuadre). Lo decide el dispositivo al encuadrar y lo revalida el worker de F13.';
COMMENT ON COLUMN ronda_evidencias.qr_coincide IS
  'TRUE si el token leído en la imagen es el del QR con el que se abrió la visita. NULL = no se pidió o no se pudo leer; FALSE = la foto trae OTRO punto, que es la señal más fuerte que hay.';
COMMENT ON COLUMN ronda_evidencias.repetida_de_id IS
  'Evidencia anterior con el mismo sha256 (o el mismo hash perceptual) que esta. Se DETECTA y se registra, no se bloquea: qué hacer con una foto repetida lo decide el puntaje de F13, no un índice único.';
COMMENT ON COLUMN ronda_evidencias.recaptura_resultado IS
  'Foto de una pantalla. Nace SIN_DATO: la heurística es de F13 (ADR-02 §3.3). La columna existe ya para no migrar la tabla después.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. `ronda_firmas`
-- ──────────────────────────────────────────────────────────────────────────────
-- `metodo` registra CÓMO se firmó y `alternativa_motivo` por qué no fue facial
-- cuando la plantilla lo ofrecía. La verificación facial es de F13: aquí no se
-- conecta nada, pero el hueco queda con nombre para que F13 solo tenga que
-- llenar `facial_score`, `facial_liveness` y la versión del modelo.
--
-- Y la regla que no se negocia: NEGARSE A LA BIOMETRÍA NO BLOQUEA EL TRABAJO.
-- Lo garantiza el trigger, que si no hay consentimiento `BIOMETRIA` escribe el
-- motivo él mismo en vez de hacer fallar la firma.
CREATE TABLE IF NOT EXISTS ronda_firmas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visita_id             UUID NOT NULL REFERENCES ronda_visitas(id) ON DELETE CASCADE,
  respuesta_id          UUID REFERENCES ronda_respuestas(id) ON DELETE SET NULL,
  quien                 VARCHAR(12) NOT NULL
                        CHECK (quien IN ('TRABAJADOR','CLIENTE','SUPERVISOR')),
  metodo                VARCHAR(8) NOT NULL DEFAULT 'TRAZO'
                        CHECK (metodo IN ('TRAZO','FACIAL','OTP','NINGUNA')),
  trazo_path            TEXT,
  facial_score          DECIMAL(5,4) CHECK (facial_score IS NULL OR facial_score BETWEEN 0 AND 1),
  facial_liveness       DECIMAL(5,4) CHECK (facial_liveness IS NULL OR facial_liveness BETWEEN 0 AND 1),
  facial_modelo_version VARCHAR(40),
  facial_pedido         BOOLEAN NOT NULL DEFAULT false,
  alternativa_motivo    TEXT,
  nombre_firmante       VARCHAR(200),
  documento_firmante    VARCHAR(30),
  sha256_firmado        CHAR(64),
  ip                    INET,
  user_agent            TEXT,
  firmado_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_ronda_firmas_quien UNIQUE (visita_id, quien),
  CONSTRAINT ck_firma_trazo CHECK (metodo <> 'TRAZO' OR NULLIF(btrim(trazo_path), '') IS NOT NULL),
  -- Si la plantilla ofrecía facial y se firmó de otra forma, hay que decir por
  -- qué. El trigger lo rellena solo cuando la razón es la obvia (no hay
  -- consentimiento biométrico), así que esto nunca deja a nadie sin firmar.
  CONSTRAINT ck_firma_alternativa CHECK (
    facial_pedido = false OR metodo = 'FACIAL'
    OR NULLIF(btrim(alternativa_motivo), '') IS NOT NULL
  ),
  CONSTRAINT ck_firma_sha CHECK (sha256_firmado IS NULL OR sha256_firmado ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_ronda_firmas_visita ON ronda_firmas(visita_id);
CREATE INDEX IF NOT EXISTS idx_ronda_firmas_fecha  ON ronda_firmas(firmado_at DESC);

COMMENT ON TABLE ronda_firmas IS
  'Firma de la visita: del trabajador, del cliente o del supervisor. Guarda el MÉTODO y, si la plantilla ofrecía facial y se firmó con trazo, el motivo. La verificación facial se conecta en F13; aquí solo queda el hueco con nombre.';
COMMENT ON COLUMN ronda_firmas.metodo IS
  'TRAZO (el PadFirma que ya existe en el repositorio) · FACIAL (F13) · OTP · NINGUNA. El trazo es la alternativa SIEMPRE disponible, y por eso negarse a la biometría no puede impedir cerrar una visita.';
COMMENT ON COLUMN ronda_firmas.facial_pedido IS
  'La plantilla ofrecía firma facial (config.permite_facial del paso FIRMA). Lo deriva el trigger: si es TRUE y el método no fue FACIAL, el motivo es obligatorio.';
COMMENT ON COLUMN ronda_firmas.alternativa_motivo IS
  'Por qué no se firmó con facial. Cuando la persona no tiene consentimiento BIOMETRIA vigente, lo escribe el trigger (SIN_CONSENTIMIENTO_BIOMETRICO): la negativa queda registrada y el trabajo sigue.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. `ronda_reportes` — el PDF cerrado
-- ──────────────────────────────────────────────────────────────────────────────
-- Un reporte por visita (`visita_id` UNIQUE) y su `sha256`: el papel que se le
-- manda al cliente tiene que poder verificarse después. El PDF se arma en una
-- server action / route handler (Postgres no es el lugar para eso, ADR-E) y se
-- REGISTRA aquí con su hash.
--
-- Las imágenes van EMBEBIDAS en el PDF, no por URL: una URL firmada vence a los
-- 300 segundos y un reporte guardado tiene que seguir teniendo sus fotos el año
-- que viene (ADR-C).
CREATE TABLE IF NOT EXISTS ronda_reportes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visita_id        UUID NOT NULL REFERENCES ronda_visitas(id) ON DELETE CASCADE,
  numero           VARCHAR(12) NOT NULL,
  plantilla_doc_id UUID,
  html_render      TEXT,
  pdf_path         TEXT,
  sha256           CHAR(64),
  paginas          SMALLINT CHECK (paginas IS NULL OR paginas > 0),
  tamano           BIGINT CHECK (tamano IS NULL OR tamano >= 0),
  generado_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  enviado_a        TEXT[] NOT NULL DEFAULT '{}'::text[],
  enviado_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_ronda_reportes_visita UNIQUE (visita_id),
  CONSTRAINT ck_reporte_sha CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_reporte_pdf CHECK (pdf_path IS NULL OR sha256 IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_reportes_numero ON ronda_reportes(numero);
CREATE INDEX IF NOT EXISTS idx_ronda_reportes_fecha ON ronda_reportes(generado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_reportes_upd   ON ronda_reportes(updated_at);

COMMENT ON TABLE ronda_reportes IS
  'El PDF que cierra la visita, con su sha256 para poder verificarlo después. Uno por visita. El PDF se arma fuera de la base (ADR-E) y se registra aquí por RPC.';
COMMENT ON COLUMN ronda_reportes.numero IS
  'El mismo número de la visita (RV-000001). No hay una segunda serie: el consecutivo de la visita ES el del reporte.';
COMMENT ON COLUMN ronda_reportes.sha256 IS
  'SHA-256 del PDF. Obligatorio si hay pdf_path: un archivo sin huella no se puede verificar, y entonces no sirve como entregable.';
COMMENT ON COLUMN ronda_reportes.plantilla_doc_id IS
  'Plantilla HTML de /documentos con la que se compuso, cuando se use una. Sin llave foránea todavía: el reporte de hoy se arma con una plantilla propia y el enganche con /documentos es de F12.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. `ronda_novedades` — el puente al ticket que YA existe
-- ──────────────────────────────────────────────────────────────────────────────
-- No se crea un módulo de novedades: lo que el trabajador reporta crea un
-- ticket en `mantenimiento_tickets` (o una PQRS, o un ticket de soporte) y aquí
-- queda el puente, con `grupo_id` y `sede_id` NOT NULL para poder filtrar sin
-- pasar por la visita (§2.4).
--
-- LÍMITE REAL DEL ESQUEMA DE HOY, y no se rediseña porque eso es F7:
-- `mantenimiento_tickets.maquinaria_id` es NOT NULL y apunta a `maquinaria`
-- (equipo propio: aspiradora, brilladora). Una novedad de ronda suele ser de un
-- LUGAR («la llave del baño del piso 3 gotea»), no de un equipo. Así que:
--   · con equipo identificado (un paso de ESCANEO de maquinaria, o el
--     trabajador lo elige) → se llama `mant_reportar()` y queda el ticket;
--   · sin equipo → la novedad se guarda con `estado_destino =
--     'PENDIENTE_TICKET'` y SIN ticket. No se inventa un equipo cualquiera para
--     poder insertar, porque eso ensucia la ficha de un equipo real.
-- F7, que extiende el ticket (grupo_id, estados nuevos, OT sin equipo), es la
-- que convierte esas novedades en órdenes de trabajo.
CREATE TABLE IF NOT EXISTS ronda_novedades (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visita_id      UUID NOT NULL REFERENCES ronda_visitas(id) ON DELETE CASCADE,
  respuesta_id   UUID REFERENCES ronda_respuestas(id) ON DELETE SET NULL,
  grupo_id       UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id        UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  clase          VARCHAR(14) NOT NULL
                 CHECK (clase IN ('MANTENIMIENTO','PQRS','SOPORTE')),
  titulo         VARCHAR(200) NOT NULL,
  descripcion    TEXT,
  prioridad      VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                 CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  maquinaria_id  UUID REFERENCES maquinaria(id) ON DELETE SET NULL,
  ticket_id      UUID REFERENCES mantenimiento_tickets(id) ON DELETE SET NULL,
  pqrs_id        UUID REFERENCES pqrs(id) ON DELETE SET NULL,
  soporte_id     UUID REFERENCES soporte_tickets(id) ON DELETE SET NULL,
  estado_destino VARCHAR(16) NOT NULL DEFAULT 'PENDIENTE_TICKET'
                 CHECK (estado_destino IN ('CREADO','PENDIENTE_TICKET','FALLIDO')),
  destino_detalle TEXT,
  reportado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  persona_id     UUID REFERENCES personas(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_novedad_titulo CHECK (NULLIF(btrim(titulo), '') IS NOT NULL),
  -- Si dice CREADO, tiene que haber un destino de verdad.
  CONSTRAINT ck_novedad_creado CHECK (
    estado_destino <> 'CREADO'
    OR ticket_id IS NOT NULL OR pqrs_id IS NOT NULL OR soporte_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_ronda_novedades_visita ON ronda_novedades(visita_id);
CREATE INDEX IF NOT EXISTS idx_ronda_novedades_grupo  ON ronda_novedades(grupo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_novedades_sede   ON ronda_novedades(sede_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_novedades_ticket ON ronda_novedades(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_novedades_pend   ON ronda_novedades(estado_destino, created_at DESC)
  WHERE estado_destino <> 'CREADO';

COMMENT ON TABLE ronda_novedades IS
  'Puente entre lo que se reporta en una visita y el módulo que lo atiende: mantenimiento_tickets, pqrs o soporte_tickets, todos existentes. No se crea un módulo de novedades.';
COMMENT ON COLUMN ronda_novedades.estado_destino IS
  'CREADO (hay ticket, PQRS o soporte) · PENDIENTE_TICKET (no se pudo crear porque mantenimiento_tickets exige maquinaria_id y la novedad es de un lugar, no de un equipo: lo resuelve F7) · FALLIDO (con el detalle del error).';
COMMENT ON COLUMN ronda_novedades.maquinaria_id IS
  'Equipo al que se refiere la novedad, cuando se identificó (paso de ESCANEO de maquinaria o elección del trabajador). Es lo que permite crear el ticket con el esquema de hoy.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. Geometría: distancia y evaluación de la geocerca
-- ──────────────────────────────────────────────────────────────────────────────
-- Haversine con radio medio de la Tierra. No hay PostGIS en el proyecto y para
-- distancias de decenas de metros sobra: el error del modelo esférico es muy
-- inferior al error del GPS de un celular de gama baja, que es de lo que
-- estamos hablando.
CREATE OR REPLACE FUNCTION public.ronda_distancia_m(
  p_lat1 DECIMAL, p_lng1 DECIMAL, p_lat2 DECIMAL, p_lng2 DECIMAL
) RETURNS DECIMAL
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE round((
      2 * 6371008.8 * asin(sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
          * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    )::numeric, 2)
  END
$$;
COMMENT ON FUNCTION public.ronda_distancia_m(DECIMAL, DECIMAL, DECIMAL, DECIMAL) IS
  'Distancia en metros entre dos coordenadas (haversine). Sin PostGIS a propósito: para decenas de metros el error del modelo esférico es muy inferior al del GPS de un celular. Espejada en packages/ronda-core/src/geocerca.ts.';

/**
 * Evalúa una lectura de GPS contra un punto. UNA sola implementación en la base
 * y su espejo en `packages/ronda-core/src/geocerca.ts`, que es la que usa la
 * pantalla para avisar ANTES de mandar.
 *
 * La regla que el usuario pidió explícitamente: si la PRECISIÓN reportada es
 * peor que el radio, no se puede saber si está dentro o fuera. Eso NO se
 * rechaza en silencio ni se da por bueno: se marca `dudosa`, se pide reintentar
 * y, si la persona insiste, se exige motivo igual que si estuviera fuera.
 * Rechazar sin decir nada deja al conserje mirando un botón que no hace nada.
 */
CREATE OR REPLACE FUNCTION public.ronda_geocerca_evaluar(
  p_punto     UUID,
  p_lat       DECIMAL,
  p_lng       DECIMAL,
  p_precision DECIMAL,
  p_plantilla UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p      RECORD;
  v_radio  NUMERIC;
  v_exige  BOOLEAN;
  v_dist   NUMERIC;
  v_dentro BOOLEAN;
  v_dudosa BOOLEAN := false;
BEGIN
  SELECT p.lat, p.lng, p.geocerca_metros, p.exige_geocerca, p.grupo_id
    INTO v_p
    FROM public.ronda_puntos p WHERE p.id = p_punto;
  IF NOT FOUND THEN RAISE EXCEPTION 'El punto de control no existe'; END IF;

  -- El radio del punto manda; `grupo_reglas.geocerca_radio_m` es el valor por
  -- defecto del contrato y el punto lo sobreescribe (F1 y F2 ya lo dicen así).
  v_radio := COALESCE(v_p.geocerca_metros,
                      (SELECT r.geocerca_radio_m FROM public.grupo_reglas r
                        WHERE r.grupo_id = v_p.grupo_id), 30);
  -- La plantilla puede ENDURECER, nunca relajar (comentario de F3 en
  -- ronda_plantillas.exige_geocerca).
  v_exige := COALESCE(v_p.exige_geocerca, true)
             OR COALESCE((SELECT t.exige_geocerca FROM public.ronda_plantillas t
                           WHERE t.id = p_plantilla), false);

  IF p_lat IS NULL OR p_lng IS NULL OR v_p.lat IS NULL OR v_p.lng IS NULL THEN
    -- Sin coordenadas no se puede decir nada. `dentro` queda NULL —ni dentro ni
    -- fuera— y por eso el CHECK de la visita no exige motivo: no hay nada que
    -- justificar si el punto todavía no se ha levantado con GPS.
    RETURN jsonb_build_object(
      'exige', v_exige, 'radio_m', v_radio, 'distancia_m', NULL,
      'dentro', NULL, 'dudosa', false, 'sin_gps', true,
      'pedir_reintento', v_exige AND (p_lat IS NULL),
      'exige_motivo', false);
  END IF;

  v_dist := public.ronda_distancia_m(p_lat, p_lng, v_p.lat, v_p.lng);
  v_dentro := v_dist <= v_radio;
  IF p_precision IS NOT NULL AND p_precision > v_radio THEN
    v_dudosa := true;
  END IF;

  RETURN jsonb_build_object(
    'exige', v_exige,
    'radio_m', v_radio,
    'distancia_m', v_dist,
    'dentro', v_dentro,
    'dudosa', v_dudosa,
    'sin_gps', false,
    -- Lo que la pantalla tiene que hacer antes de insistir.
    'pedir_reintento', v_dudosa OR (v_exige AND NOT v_dentro),
    -- Y lo que la base va a exigir si insiste.
    'exige_motivo', (NOT v_dentro) OR v_dudosa);
END $$;
COMMENT ON FUNCTION public.ronda_geocerca_evaluar(UUID, DECIMAL, DECIMAL, DECIMAL, UUID) IS
  'Evalúa una lectura de GPS contra un punto: distancia, dentro/fuera, y «dudosa» cuando la precisión reportada es PEOR que el radio (ahí no se puede distinguir dentro de fuera). Nunca rechaza en silencio: devuelve pedir_reintento y exige_motivo para que la pantalla explique. Espejada en packages/ronda-core/src/geocerca.ts.';
GRANT EXECUTE ON FUNCTION public.ronda_geocerca_evaluar(UUID, DECIMAL, DECIMAL, DECIMAL, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. Derivaciones y coherencia (triggers)
-- ──────────────────────────────────────────────────────────────────────────────
-- Mismo criterio que F2: lo que se puede derivar NO se recibe. El alcance
-- (`grupo_id`, `sede_id`) sale del punto, y los BEFORE triggers corren antes
-- del WITH CHECK de la política, así que el valor derivado también se verifica
-- contra el alcance de quien escribe.

CREATE OR REPLACE FUNCTION public.ronda_visitas_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p RECORD; v_t RECORD;
BEGIN
  SELECT p.grupo_id, p.sede_id, p.zona_id, p.estado
    INTO v_p FROM public.ronda_puntos p WHERE p.id = NEW.punto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El punto de control no existe'; END IF;
  NEW.grupo_id := v_p.grupo_id;
  NEW.sede_id  := v_p.sede_id;
  IF NEW.zona_id IS NULL THEN NEW.zona_id := v_p.zona_id; END IF;

  SELECT t.codigo, t.version, t.estado INTO v_t
    FROM public.ronda_plantillas t WHERE t.id = NEW.plantilla_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La plantilla de la tarea no existe'; END IF;
  NEW.plantilla_codigo  := v_t.codigo;
  NEW.plantilla_version := v_t.version;

  IF NEW.persona_nombre IS NULL THEN
    SELECT btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, ''))
      INTO NEW.persona_nombre FROM public.personas pe WHERE pe.id = NEW.persona_id;
  END IF;

  IF NEW.qr_id IS NOT NULL AND NEW.qr_version IS NULL THEN
    SELECT q.version INTO NEW.qr_version FROM public.ronda_qr q WHERE q.id = NEW.qr_id;
  END IF;

  -- Duración: con la hora del servidor, que es la que vale. Si la visita vino
  -- de la cola, la del servidor mide el viaje y no el trabajo, así que ahí se
  -- usan las dos horas del dispositivo —las únicas que miden lo que duró de
  -- verdad— y se deja dicho que la oficial sigue siendo la del servidor.
  IF NEW.fin_servidor IS NOT NULL THEN
    IF NEW.offline AND NEW.inicio_dispositivo IS NOT NULL AND NEW.fin_dispositivo IS NOT NULL THEN
      NEW.duracion_seg := GREATEST(0, EXTRACT(EPOCH FROM (NEW.fin_dispositivo - NEW.inicio_dispositivo))::int);
    ELSE
      NEW.duracion_seg := GREATEST(0, EXTRACT(EPOCH FROM (NEW.fin_servidor - NEW.inicio_servidor))::int);
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.ronda_visitas_derivar() IS
  'Deriva el alcance (grupo_id, sede_id, zona_id) del punto, la versión de la plantilla, el nombre de la persona y la duración. Nada de eso se recibe de la aplicación: un error de pantalla podría meter la visita en otro contrato, y la RLS filtra por esa columna.';

DROP TRIGGER IF EXISTS tr_ronda_visitas_derivar ON ronda_visitas;
CREATE TRIGGER tr_ronda_visitas_derivar BEFORE INSERT OR UPDATE ON ronda_visitas
  FOR EACH ROW EXECUTE FUNCTION public.ronda_visitas_derivar();

/** Deriva de su paso todo lo que la respuesta repite, y de la `config` del paso
 *  si un «No» exige motivo. También comprueba que el paso sea de la plantilla
 *  de ESTA visita: contestar el paso de otra plantilla es un error de la
 *  aplicación que no debe quedar guardado. */
CREATE OR REPLACE FUNCTION public.ronda_respuestas_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paso RECORD; v_plantilla UUID;
BEGIN
  SELECT s.plantilla_id, s.orden, s.tipo, s.config, s.titulo
    INTO v_paso FROM public.ronda_plantilla_pasos s WHERE s.id = NEW.paso_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El paso de la plantilla no existe'; END IF;

  SELECT v.plantilla_id INTO v_plantilla FROM public.ronda_visitas v WHERE v.id = NEW.visita_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe'; END IF;
  IF v_plantilla <> v_paso.plantilla_id THEN
    RAISE EXCEPTION 'El paso "%" no es de la plantilla con la que se abrió la visita', v_paso.titulo;
  END IF;

  NEW.plantilla_id := v_paso.plantilla_id;
  NEW.orden        := v_paso.orden;
  NEW.tipo         := v_paso.tipo;
  -- F3 dejó la parametrización («lo único configurable es si un NO exige
  -- motivo») y dijo que el motivo lo obliga esta tabla. Por defecto SÍ: la
  -- plantilla nace con motivo_obligatorio_si_no = true.
  NEW.motivo_exigido := COALESCE((v_paso.config ->> 'motivo_obligatorio_si_no')::boolean, true);
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.ronda_respuestas_derivar() IS
  'Deriva plantilla, orden, tipo y motivo_exigido del paso, y rechaza contestar un paso que no es de la plantilla con la que se abrió la visita.';

DROP TRIGGER IF EXISTS tr_ronda_respuestas_derivar ON ronda_respuestas;
CREATE TRIGGER tr_ronda_respuestas_derivar BEFORE INSERT OR UPDATE ON ronda_respuestas
  FOR EACH ROW EXECUTE FUNCTION public.ronda_respuestas_derivar();

/**
 * Valida y marca cada evidencia. Es el trigger más importante de la fase:
 *
 *   1. CÁMARA EN VIVO. Si el paso exige `solo_camara_vivo`, un archivo de
 *      galería se RECHAZA aquí. Tiene que estar en la base: la pantalla ya no
 *      ofrece el selector de archivos, pero el bot y la cola offline escriben
 *      por el mismo sitio y una pantalla no es un control.
 *   2. QR EN EL ENCUADRE. Si el paso lo exige y se leyó un token, se compara
 *      con el del QR de la visita y queda `qr_coincide`. No se rechaza una foto
 *      sin QR legible: una foto a contraluz es mala suerte, no fraude, y eso
 *      lo pesa F13.
 *   3. REPETICIÓN. Se busca una evidencia anterior con el mismo sha256 y, si no
 *      hay, con el mismo hash perceptual. Se registra, no se bloquea.
 */
CREATE OR REPLACE FUNCTION public.ronda_evidencias_validar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paso   RECORD;
  v_token  TEXT;
  v_prev   RECORD;
BEGIN
  IF NEW.paso_id IS NULL AND NEW.respuesta_id IS NOT NULL THEN
    SELECT r.paso_id INTO NEW.paso_id FROM public.ronda_respuestas r WHERE r.id = NEW.respuesta_id;
  END IF;

  IF NEW.paso_id IS NOT NULL THEN
    SELECT s.tipo, s.config, s.titulo INTO v_paso
      FROM public.ronda_plantilla_pasos s WHERE s.id = NEW.paso_id;
    IF FOUND AND v_paso.tipo = 'FOTO' THEN
      -- 1. Cámara en vivo obligatoria.
      IF COALESCE((v_paso.config ->> 'solo_camara_vivo')::boolean, false)
         AND NEW.origen <> 'CAMARA_VIVO' THEN
        RAISE EXCEPTION
          'El paso "%" exige foto tomada con la cámara en vivo: un archivo de la galería no se acepta (origen %).',
          v_paso.titulo, NEW.origen;
      END IF;
      -- 2. ¿El QR de la foto es el de este punto?
      IF COALESCE((v_paso.config ->> 'exige_qr_en_encuadre')::boolean, false)
         AND NEW.qr_detectado IS NOT NULL THEN
        SELECT q.token INTO v_token
          FROM public.ronda_visitas v
          JOIN public.ronda_qr q ON q.id = v.qr_id
         WHERE v.id = NEW.visita_id;
        NEW.qr_coincide := (v_token IS NOT NULL
                            AND upper(btrim(NEW.qr_detectado)) = upper(btrim(v_token)));
      END IF;
    END IF;
  END IF;

  -- 3. La misma foto otra vez. Primero el archivo exacto; si no, la imagen
  --    parecida. Se mira SIEMPRE, también dentro de la misma visita, y se
  --    guarda si fue en la misma o en otra: repetir una foto entre dos visitas
  --    distintas no es lo mismo que usarla en dos pasos de la misma.
  IF NEW.repetida_de_id IS NULL THEN
    SELECT e.id, e.visita_id INTO v_prev
      FROM public.ronda_evidencias e
     WHERE e.sha256 = NEW.sha256 AND e.id <> NEW.id
     ORDER BY e.created_at, e.id
     LIMIT 1;
    IF FOUND THEN
      NEW.repetida_de_id  := v_prev.id;
      NEW.repetida_motivo := 'SHA256';
      NEW.repetida_misma_visita := (v_prev.visita_id = NEW.visita_id);
    ELSIF NEW.hash_perceptual IS NOT NULL THEN
      SELECT e.id, e.visita_id INTO v_prev
        FROM public.ronda_evidencias e
       WHERE e.hash_perceptual = NEW.hash_perceptual AND e.id <> NEW.id
       ORDER BY e.created_at, e.id
       LIMIT 1;
      IF FOUND THEN
        NEW.repetida_de_id  := v_prev.id;
        NEW.repetida_motivo := 'PERCEPTUAL';
        NEW.repetida_misma_visita := (v_prev.visita_id = NEW.visita_id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.ronda_evidencias_validar() IS
  'Rechaza una foto de galería donde el paso exige cámara en vivo, compara el QR leído en la imagen con el de la visita y marca la evidencia repetida (por sha256 o por hash perceptual) sin bloquearla. Está en la base porque el bot y la cola offline escriben por el mismo sitio.';

DROP TRIGGER IF EXISTS tr_ronda_evidencias_validar ON ronda_evidencias;
CREATE TRIGGER tr_ronda_evidencias_validar BEFORE INSERT ON ronda_evidencias
  FOR EACH ROW EXECUTE FUNCTION public.ronda_evidencias_validar();

/**
 * La firma: deriva si la plantilla ofrecía facial y, cuando se firma de otra
 * forma por falta de consentimiento biométrico, ESCRIBE el motivo en vez de
 * hacer fallar la firma.
 *
 * Esto es la regla «negarse a la biometría nunca puede bloquear el trabajo»
 * puesta en la base. Si en vez de rellenar el motivo lanzáramos una excepción,
 * la persona que no consiente biometría no podría cerrar su visita, que es
 * exactamente lo que la Ley 1581 y la §5.2 del ADR-02 prohíben.
 */
CREATE OR REPLACE FUNCTION public.ronda_firmas_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_persona UUID; v_pide BOOLEAN;
BEGIN
  SELECT v.persona_id INTO v_persona FROM public.ronda_visitas v WHERE v.id = NEW.visita_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe'; END IF;

  -- ¿Algún paso FIRMA de la plantilla de esta visita ofrecía facial?
  SELECT COALESCE(bool_or((s.config ->> 'permite_facial')::boolean), false) INTO v_pide
    FROM public.ronda_visitas v
    JOIN public.ronda_plantilla_pasos s ON s.plantilla_id = v.plantilla_id
   WHERE v.id = NEW.visita_id AND s.tipo = 'FIRMA';
  NEW.facial_pedido := COALESCE(v_pide, false);

  IF NEW.nombre_firmante IS NULL AND NEW.quien = 'TRABAJADOR' THEN
    SELECT btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, ''))
      INTO NEW.nombre_firmante FROM public.personas pe WHERE pe.id = v_persona;
  END IF;

  IF NEW.facial_pedido AND NEW.metodo <> 'FACIAL'
     AND NULLIF(btrim(NEW.alternativa_motivo), '') IS NULL THEN
    IF NEW.quien = 'TRABAJADOR' AND NOT public.persona_consiente(v_persona, 'BIOMETRIA') THEN
      NEW.alternativa_motivo := 'SIN_CONSENTIMIENTO_BIOMETRICO';
    ELSE
      -- Para cualquier otro caso (el cliente que firma, o el trabajador que sí
      -- consiente pero el facial falló) el motivo es de quien firma: lo exige
      -- ck_firma_alternativa y la pantalla lo pregunta.
      NEW.alternativa_motivo := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.ronda_firmas_derivar() IS
  'Deriva facial_pedido de la config del paso FIRMA y, cuando se firma con trazo porque la persona no consiente biometría, escribe el motivo él mismo. Así negarse a la biometría queda registrado y NO bloquea el cierre de la visita.';

DROP TRIGGER IF EXISTS tr_ronda_firmas_derivar ON ronda_firmas;
CREATE TRIGGER tr_ronda_firmas_derivar BEFORE INSERT OR UPDATE ON ronda_firmas
  FOR EACH ROW EXECUTE FUNCTION public.ronda_firmas_derivar();

/** La novedad hereda el alcance de su visita, igual que todo lo demás. */
CREATE OR REPLACE FUNCTION public.ronda_novedades_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v RECORD;
BEGIN
  SELECT x.grupo_id, x.sede_id, x.persona_id INTO v
    FROM public.ronda_visitas x WHERE x.id = NEW.visita_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe'; END IF;
  NEW.grupo_id := v.grupo_id;
  NEW.sede_id  := v.sede_id;
  IF NEW.persona_id IS NULL THEN NEW.persona_id := v.persona_id; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_novedades_derivar ON ronda_novedades;
CREATE TRIGGER tr_ronda_novedades_derivar BEFORE INSERT OR UPDATE ON ronda_novedades
  FOR EACH ROW EXECUTE FUNCTION public.ronda_novedades_derivar();

/** El reporte lleva el número de SU visita, no uno nuevo. */
CREATE OR REPLACE FUNCTION public.ronda_reportes_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT v.numero INTO NEW.numero FROM public.ronda_visitas v WHERE v.id = NEW.visita_id;
  IF NEW.numero IS NULL THEN RAISE EXCEPTION 'La visita no existe'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_reportes_derivar ON ronda_reportes;
CREATE TRIGGER tr_ronda_reportes_derivar BEFORE INSERT OR UPDATE ON ronda_reportes
  FOR EACH ROW EXECUTE FUNCTION public.ronda_reportes_derivar();

-- ── 13.1 `updated_at` ────────────────────────────────────────────────────────
-- Solo donde hay UPDATE. `ronda_evidencias`, `ronda_firmas`,
-- `ronda_novedades` y `persona_consentimientos` no lo llevan: son append-only y
-- la cola offline las sincroniza por `created_at` (modo `append`).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['persona_canales','ronda_sesiones','ronda_visitas',
                           'ronda_respuestas','ronda_reportes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. Quién escribe: el actor de una escritura de campo
-- ──────────────────────────────────────────────────────────────────────────────
-- Las RPC de esta fase las llaman TRES clientes distintos (ADR-E: un solo
-- camino de escritura para los tres canales), y cada uno llega con una prueba
-- de identidad diferente:
--
--   · la PWA de quien TIENE cuenta — con su JWT de Supabase Auth, así que
--     `auth.uid()` existe y se le exige `ejecutar_rondas`;
--   · la PWA de quien NO tiene cuenta — su navegador lleva una cookie firmada
--     por la aplicación; el route handler la valida y llama con la llave de
--     SERVICIO pasando `p_sesion`, que esta función comprueba contra
--     `ronda_sesiones`. Es el mismo patrón que ya usa la ruta pública
--     /q/<token> (app/q/puerta-supabase.ts): la autoridad es la firma, no una
--     cookie que Postgres pueda leer;
--   · la consola — un usuario con cuenta registrando la visita de otra persona
--     (apertura ASISTIDA), que queda marcada como tal.
--
-- Las RPC están REVOCADAS de PUBLIC (y por tanto de `anon`): sin JWT y sin
-- sesión, solo puede entrar la llave de servicio. Eso es lo que hace que el
-- camino de `p_persona` sin prueba no sea un agujero abierto al navegador.
CREATE OR REPLACE FUNCTION public.ronda_actor(
  p_persona UUID DEFAULT NULL,
  p_sesion  UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := (SELECT auth.uid());
  v_persona UUID;
  v_propia  UUID;
  v_ses     RECORD;
  v_nombre  TEXT;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT public.ronda_ejecuta() THEN
      RAISE EXCEPTION 'No tienes permiso para ejecutar rondas.';
    END IF;
    SELECT pe.id INTO v_propia FROM public.personas pe WHERE pe.usuario_id = v_uid LIMIT 1;
    v_persona := COALESCE(p_persona, v_propia);
    IF v_persona IS NULL THEN
      RAISE EXCEPTION 'Esta cuenta no está vinculada a una persona: la visita necesita saber QUIÉN la hizo.';
    END IF;
    SELECT btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, ''))
      INTO v_nombre FROM public.personas pe WHERE pe.id = v_persona;
    RETURN jsonb_build_object(
      'usuario_id', v_uid, 'persona_id', v_persona, 'nombre', v_nombre,
      'metodo', CASE WHEN v_persona = v_propia THEN 'CUENTA' ELSE 'CONSOLA' END,
      'sesion_id', NULL);
  END IF;

  IF p_sesion IS NOT NULL THEN
    SELECT * INTO v_ses FROM public.ronda_sesiones s WHERE s.id = p_sesion;
    IF NOT FOUND THEN RAISE EXCEPTION 'La sesión de campo no existe.'; END IF;
    IF v_ses.estado <> 'ACTIVA' OR v_ses.sesion_vence_at < NOW() THEN
      RAISE EXCEPTION 'La sesión de campo ya no está vigente: vuelve a entrar con un enlace nuevo.';
    END IF;
    IF p_persona IS NOT NULL AND p_persona <> v_ses.persona_id THEN
      RAISE EXCEPTION 'La sesión de campo no corresponde a esa persona.';
    END IF;
    RETURN jsonb_build_object(
      'usuario_id', NULL, 'persona_id', v_ses.persona_id,
      'nombre', v_ses.persona_nombre, 'metodo', 'ENLACE_PIN', 'sesion_id', v_ses.id);
  END IF;

  IF p_persona IS NULL THEN
    RAISE EXCEPTION 'Hay que decir quién hace la visita (sesión de campo o persona).';
  END IF;
  SELECT btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, ''))
    INTO v_nombre FROM public.personas pe WHERE pe.id = p_persona;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'La persona no existe.'; END IF;
  RETURN jsonb_build_object(
    'usuario_id', NULL, 'persona_id', p_persona, 'nombre', v_nombre,
    'metodo', 'CONSOLA', 'sesion_id', NULL);
END $$;
COMMENT ON FUNCTION public.ronda_actor(UUID, UUID) IS
  'Resuelve quién está escribiendo: cuenta de Supabase Auth (con permiso ejecutar_rondas), sesión de campo de enlace + PIN, o llamada con la llave de servicio desde la consola. Devuelve usuario_id, persona_id, nombre y el método de identidad que se guarda en la visita.';
REVOKE ALL ON FUNCTION public.ronda_actor(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_actor(UUID, UUID) TO authenticated;

/** ¿Puede escribir en ESTA visita? La propia siempre; la de otro, solo con
 *  `gestionar_visitas_rondas` y dentro de su alcance de contratos. */
CREATE OR REPLACE FUNCTION public.ronda_visita_escribible(p_visita UUID, p_actor JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v RECORD;
BEGIN
  SELECT x.persona_id, x.grupo_id, x.estado INTO v
    FROM public.ronda_visitas x WHERE x.id = p_visita;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe.'; END IF;
  IF v.estado IN ('COMPLETADA','INCOMPLETA','ANULADA','VENCIDA') THEN
    -- Una visita cerrada no se sigue contestando. Corregir lo cerrado es otra
    -- cosa y pide `gestionar_visitas_rondas`.
    IF NOT ((SELECT auth.uid()) IS NOT NULL AND public.ronda_visitas_gestiona()) THEN
      RAISE EXCEPTION 'La visita % ya está cerrada.', p_visita;
    END IF;
  END IF;
  IF (p_actor ->> 'persona_id')::uuid = v.persona_id THEN RETURN true; END IF;
  IF (SELECT auth.uid()) IS NOT NULL
     AND public.ronda_visitas_gestiona() AND public.auth_ve_grupo(v.grupo_id) THEN
    RETURN true;
  END IF;
  RAISE EXCEPTION 'Esta visita es de otra persona.';
END $$;
REVOKE ALL ON FUNCTION public.ronda_visita_escribible(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_visita_escribible(UUID, JSONB) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. `ronda_registrar_visita()` — abrir la visita
-- ──────────────────────────────────────────────────────────────────────────────
-- IDEMPOTENTE POR `p_visita`, y eso no es un detalle: el `id` lo genera el
-- dispositivo y la cola offline reintenta el mismo intent hasta que recibe
-- respuesta. Sin idempotencia, una mala señal duplicaría visitas con todas sus
-- fotos. Si la visita ya existe, se devuelve tal cual.
--
-- Qué valida, en este orden:
--   1. el actor (sección 14);
--   2. el punto existe y no está RETIRADO;
--   3. el contrato está VIGENTE — es la misma regla que apaga los QR (§2.5),
--      preguntando y no con un UPDATE masivo;
--   4. el QR, si se abrió escaneando, sirve (`ronda_qr_vigente`) y es de ESE
--      punto: un token válido de otro punto no abre esta visita;
--   5. la plantilla está PUBLICADA y es la vigente para el contrato;
--   6. la geocerca, con la precisión incluida.
CREATE OR REPLACE FUNCTION public.ronda_registrar_visita(
  p_visita             UUID,
  p_punto              UUID,
  p_plantilla          UUID        DEFAULT NULL,
  p_plantilla_codigo   TEXT        DEFAULT NULL,
  p_asignacion         UUID        DEFAULT NULL,
  p_qr                 UUID        DEFAULT NULL,
  p_apertura_modo      TEXT        DEFAULT 'QR',
  p_canal              TEXT        DEFAULT 'APP',
  p_lat                DECIMAL     DEFAULT NULL,
  p_lng                DECIMAL     DEFAULT NULL,
  p_precision          DECIMAL     DEFAULT NULL,
  p_inicio_dispositivo TIMESTAMPTZ DEFAULT NULL,
  p_motivo_fuera       TEXT        DEFAULT NULL,
  p_offline            BOOLEAN     DEFAULT false,
  p_persona            UUID        DEFAULT NULL,
  p_sesion             UUID        DEFAULT NULL
) RETURNS ronda_visitas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila     ronda_visitas;
  v_punto    RECORD;
  v_plant    UUID := p_plantilla;
  v_estado   TEXT;
  v_geo      JSONB;
  v_ahora    TIMESTAMPTZ := NOW();
  v_desfase  INT;
  v_demora   INT;
  v_motivo   TEXT := NULLIF(btrim(p_motivo_fuera), '');
BEGIN
  IF p_visita IS NULL THEN RAISE EXCEPTION 'La visita necesita un id (lo genera el dispositivo).'; END IF;

  SELECT * INTO v_fila FROM public.ronda_visitas WHERE id = p_visita;
  IF FOUND THEN RETURN v_fila; END IF;   -- reintento de la cola: ya estaba

  SELECT p.id, p.grupo_id, p.sede_id, p.estado, p.codigo, p.nombre
    INTO v_punto FROM public.ronda_puntos p WHERE p.id = p_punto;
  IF NOT FOUND THEN RAISE EXCEPTION 'El punto de control no existe.'; END IF;
  IF v_punto.estado = 'RETIRADO' THEN
    RAISE EXCEPTION 'El punto % está retirado de la operación.', v_punto.codigo;
  END IF;
  IF NOT public.grupo_vigente(v_punto.grupo_id) THEN
    RAISE EXCEPTION 'El contrato de esta sede no está vigente: los puntos no se pueden usar.';
  END IF;

  IF p_qr IS NOT NULL THEN
    IF NOT public.ronda_qr_vigente(p_qr) THEN
      RAISE EXCEPTION 'El código QR con el que se abrió ya no sirve.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ronda_qr q
                    WHERE q.id = p_qr AND q.punto_id = p_punto) THEN
      RAISE EXCEPTION 'Ese código QR no es de este punto de control.';
    END IF;
  END IF;

  -- La plantilla: por id, o resolviendo el código a la versión publicada que
  -- corresponda al contrato (el ajuste del contrato tapa a la general, F3).
  IF v_plant IS NULL THEN
    IF NULLIF(btrim(p_plantilla_codigo), '') IS NULL THEN
      RAISE EXCEPTION 'Hay que decir qué tarea se va a hacer.';
    END IF;
    v_plant := public.ronda_plantilla_vigente(upper(btrim(p_plantilla_codigo)), v_punto.grupo_id);
    IF v_plant IS NULL THEN
      RAISE EXCEPTION 'La tarea % no tiene una versión publicada para este contrato.',
        upper(btrim(p_plantilla_codigo));
    END IF;
  END IF;
  SELECT t.estado INTO v_estado FROM public.ronda_plantillas t WHERE t.id = v_plant;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'La plantilla de la tarea no existe.'; END IF;
  IF v_estado <> 'PUBLICADA' THEN
    RAISE EXCEPTION 'La plantilla de la tarea está % y no se puede ejecutar.', v_estado;
  END IF;

  -- La geocerca. Si la lectura obliga a justificar (fuera de cerca, o precisión
  -- peor que el radio) y no viene motivo, se dice EXACTAMENTE qué pasó: nada de
  -- rechazar en silencio.
  v_geo := public.ronda_geocerca_evaluar(p_punto, p_lat, p_lng, p_precision, v_plant);
  IF (v_geo ->> 'exige_motivo')::boolean AND v_motivo IS NULL THEN
    IF (v_geo ->> 'dudosa')::boolean THEN
      RAISE EXCEPTION 'La ubicación llegó con precisión de % m, peor que la geocerca de % m: vuelve a intentar al aire libre o escribe por qué la abres así.',
        round(p_precision), (v_geo ->> 'radio_m');
    ELSE
      RAISE EXCEPTION 'Estás a % m del punto y la geocerca es de % m: escribe por qué abres la visita desde aquí.',
        round((v_geo ->> 'distancia_m')::numeric), (v_geo ->> 'radio_m');
    END IF;
  END IF;

  -- Los relojes (ADR-02 §2.9). En línea, la diferencia mide un reloj torcido;
  -- de la cola, mide cuánto esperó la visita a tener señal.
  IF p_inicio_dispositivo IS NOT NULL THEN
    IF p_offline THEN
      v_demora := GREATEST(0, EXTRACT(EPOCH FROM (v_ahora - p_inicio_dispositivo))::int);
    ELSE
      v_desfase := ABS(EXTRACT(EPOCH FROM (v_ahora - p_inicio_dispositivo))::int);
    END IF;
  END IF;

  INSERT INTO public.ronda_visitas (
    id, punto_id, asignacion_id, plantilla_id, persona_id, usuario_id, persona_nombre,
    canal, identidad_metodo, sesion_id, qr_id, apertura_modo,
    inicio_servidor, inicio_dispositivo, desfase_reloj_seg, demora_sync_seg,
    lat, lng, precision_metros, distancia_metros, dentro_geocerca, ubicacion_dudosa,
    motivo_fuera_geocerca, estado, offline, sincronizada_at,
    grupo_id, sede_id
  ) VALUES (
    p_visita, p_punto, p_asignacion, v_plant,
    (v_actor ->> 'persona_id')::uuid, (v_actor ->> 'usuario_id')::uuid, v_actor ->> 'nombre',
    upper(COALESCE(p_canal, 'APP')),
    CASE WHEN p_canal = 'WHATSAPP' THEN 'BOT' ELSE v_actor ->> 'metodo' END,
    (v_actor ->> 'sesion_id')::uuid, p_qr, upper(COALESCE(p_apertura_modo, 'QR')),
    v_ahora, p_inicio_dispositivo, v_desfase, v_demora,
    p_lat, p_lng, p_precision,
    NULLIF(v_geo ->> 'distancia_m', '')::numeric,
    CASE WHEN v_geo ->> 'dentro' IS NULL THEN NULL ELSE (v_geo ->> 'dentro')::boolean END,
    (v_geo ->> 'dudosa')::boolean,
    v_motivo, 'ABIERTA', COALESCE(p_offline, false),
    CASE WHEN COALESCE(p_offline, false) THEN v_ahora ELSE NULL END,
    -- Los derivará el trigger; van para no violar el NOT NULL.
    v_punto.grupo_id, v_punto.sede_id
  ) RETURNING * INTO v_fila;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle)
  VALUES (
    v_fila.grupo_id, v_fila.sede_id, 'ronda_visitas', v_fila.id, 'ABRIR',
    CASE WHEN v_fila.usuario_id IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    v_fila.usuario_id, v_fila.persona_id, v_fila.persona_nombre, v_fila.canal,
    jsonb_build_object('numero', v_fila.numero, 'punto', v_punto.codigo,
                       'plantilla', v_fila.plantilla_codigo, 'version', v_fila.plantilla_version,
                       'apertura', v_fila.apertura_modo, 'identidad', v_fila.identidad_metodo,
                       'geocerca', v_geo, 'offline', v_fila.offline));
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_registrar_visita(UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, DECIMAL, DECIMAL, DECIMAL, TIMESTAMPTZ, TEXT, BOOLEAN, UUID, UUID) IS
  'Abre una visita. IDEMPOTENTE por p_visita (el id lo genera el dispositivo y la cola offline reintenta el mismo intent). Valida punto, vigencia del contrato, QR del punto, plantilla publicada y geocerca con la precisión incluida; deja evento de auditoría.';
REVOKE ALL ON FUNCTION public.ronda_registrar_visita(UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, DECIMAL, DECIMAL, DECIMAL, TIMESTAMPTZ, TEXT, BOOLEAN, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_registrar_visita(UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, DECIMAL, DECIMAL, DECIMAL, TIMESTAMPTZ, TEXT, BOOLEAN, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 16. `ronda_responder_paso()`
-- ──────────────────────────────────────────────────────────────────────────────
-- Upsert por (visita, paso): corregir en el resumen vuelve a llamar la misma
-- RPC y actualiza la fila. El valor llega en un JSONB para no tener nueve
-- parámetros que siempre vienen en NULL; el tipo del paso decide qué columna
-- se llena, y eso lo decide la BASE y no la pantalla.
CREATE OR REPLACE FUNCTION public.ronda_responder_paso(
  p_visita       UUID,
  p_paso         UUID,
  -- El id de la fila lo puede generar el DISPOSITIVO, y no es un capricho: la
  -- evidencia apunta a `respuesta_id`, y sin señal el celular tiene que poder
  -- encolar «esta foto es de esta respuesta» antes de que el servidor haya
  -- creado ninguna de las dos. Si se omite, lo pone la base.
  p_id           UUID        DEFAULT NULL,
  p_valor        JSONB       DEFAULT '{}'::jsonb,
  p_motivo       TEXT        DEFAULT NULL,
  p_omitido      BOOLEAN     DEFAULT false,
  p_omision      TEXT        DEFAULT NULL,
  p_dispositivo  TIMESTAMPTZ DEFAULT NULL,
  p_persona      UUID        DEFAULT NULL,
  p_sesion       UUID        DEFAULT NULL
) RETURNS ronda_respuestas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor JSONB := public.ronda_actor(p_persona, p_sesion);
  v_paso  RECORD;
  v_fila  ronda_respuestas;
  v_bool  BOOLEAN;
  v_texto TEXT;
  v_num   NUMERIC;
  v_ops   TEXT[];
BEGIN
  PERFORM public.ronda_visita_escribible(p_visita, v_actor);
  SELECT s.tipo, s.config, s.titulo, s.plantilla_id, s.orden INTO v_paso
    FROM public.ronda_plantilla_pasos s WHERE s.id = p_paso;
  IF NOT FOUND THEN RAISE EXCEPTION 'El paso no existe.'; END IF;

  -- Qué columna lleva el valor, por tipo.
  IF v_paso.tipo = 'CASILLA' THEN
    v_texto := upper(COALESCE(p_valor ->> 'casilla', p_valor ->> 'texto', ''));
    IF v_texto NOT IN ('SI','NO','NO_APLICA') THEN
      RAISE EXCEPTION 'La casilla "%" se contesta SI, NO o NO_APLICA.', v_paso.titulo;
    END IF;
    v_bool := CASE v_texto WHEN 'SI' THEN true WHEN 'NO' THEN false ELSE NULL END;
  ELSIF v_paso.tipo IN ('TEXTO','ESCANEO') THEN
    v_texto := NULLIF(btrim(COALESCE(p_valor ->> 'texto', p_valor ->> 'codigo', '')), '');
  ELSIF v_paso.tipo = 'NUMERO' THEN
    IF jsonb_typeof(p_valor -> 'numero') = 'number' THEN v_num := (p_valor ->> 'numero')::numeric; END IF;
    IF NOT COALESCE(p_omitido, false) AND v_num IS NULL THEN
      RAISE EXCEPTION 'El paso "%" espera un número.', v_paso.titulo;
    END IF;
    -- Rango del paso: lo valida la base porque el bot también escribe aquí.
    IF v_num IS NOT NULL THEN
      IF (v_paso.config ? 'min') AND v_num < (v_paso.config ->> 'min')::numeric THEN
        RAISE EXCEPTION 'El valor de "%" no puede ser menor que %.', v_paso.titulo, v_paso.config ->> 'min';
      END IF;
      IF (v_paso.config ? 'max') AND v_num > (v_paso.config ->> 'max')::numeric THEN
        RAISE EXCEPTION 'El valor de "%" no puede ser mayor que %.', v_paso.titulo, v_paso.config ->> 'max';
      END IF;
    END IF;
  ELSIF v_paso.tipo = 'SELECCION' THEN
    SELECT array_agg(x) INTO v_ops FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_valor -> 'opciones') = 'array' THEN p_valor -> 'opciones' ELSE '[]'::jsonb END) x;
    IF NOT COALESCE(p_omitido, false) THEN
      IF v_ops IS NULL OR array_length(v_ops, 1) IS NULL THEN
        RAISE EXCEPTION 'Hay que escoger al menos una opción en "%".', v_paso.titulo;
      END IF;
      IF NOT COALESCE((v_paso.config ->> 'multiple')::boolean, false)
         AND array_length(v_ops, 1) > 1 THEN
        RAISE EXCEPTION 'El paso "%" admite una sola opción.', v_paso.titulo;
      END IF;
      IF EXISTS (
        SELECT 1 FROM unnest(v_ops) o
         WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_paso.config -> 'opciones') c
                            WHERE c ->> 'valor' = o)) THEN
        RAISE EXCEPTION 'Una de las opciones escogidas no es de la lista del paso "%".', v_paso.titulo;
      END IF;
    END IF;
    v_texto := array_to_string(v_ops, ',');
  END IF;

  INSERT INTO public.ronda_respuestas (
    id, visita_id, paso_id, plantilla_id, orden, tipo,
    valor_bool, valor_texto, valor_numero, valor_opciones,
    motivo, transcripcion, entidad_tipo, entidad_id, entidad_codigo,
    omitido, omision_motivo, respondido_dispositivo, respondido_at
  ) VALUES (
    COALESCE(p_id, gen_random_uuid()), p_visita, p_paso,
    v_paso.plantilla_id, v_paso.orden, v_paso.tipo,
    v_bool, v_texto, v_num, v_ops,
    NULLIF(btrim(p_motivo), ''), NULLIF(btrim(p_valor ->> 'transcripcion'), ''),
    NULLIF(p_valor ->> 'entidad_tipo', ''), NULLIF(p_valor ->> 'entidad_id', '')::uuid,
    NULLIF(p_valor ->> 'entidad_codigo', ''),
    COALESCE(p_omitido, false), NULLIF(btrim(p_omision), ''), p_dispositivo, NOW()
  )
  ON CONFLICT (visita_id, paso_id) DO UPDATE SET
    valor_bool = EXCLUDED.valor_bool,
    valor_texto = EXCLUDED.valor_texto,
    valor_numero = EXCLUDED.valor_numero,
    valor_opciones = EXCLUDED.valor_opciones,
    motivo = EXCLUDED.motivo,
    transcripcion = EXCLUDED.transcripcion,
    entidad_tipo = EXCLUDED.entidad_tipo,
    entidad_id = EXCLUDED.entidad_id,
    entidad_codigo = EXCLUDED.entidad_codigo,
    omitido = EXCLUDED.omitido,
    omision_motivo = EXCLUDED.omision_motivo,
    respondido_dispositivo = EXCLUDED.respondido_dispositivo,
    respondido_at = NOW()
  RETURNING * INTO v_fila;

  -- La visita pasa a EN_CURSO en la primera respuesta.
  UPDATE public.ronda_visitas SET estado = 'EN_CURSO'
   WHERE id = p_visita AND estado = 'ABIERTA';
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_responder_paso(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, UUID, UUID) IS
  'Contesta (o corrige) un paso. Upsert por (visita, paso). El tipo del paso decide qué columna se llena y la base valida el dominio: SI/NO/NO_APLICA, rango del número, opciones de la lista. El motivo obligatorio de un «No» lo exige el CHECK de la tabla, no esta función.';
REVOKE ALL ON FUNCTION public.ronda_responder_paso(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_responder_paso(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 17. `ronda_adjuntar_evidencia()`
-- ──────────────────────────────────────────────────────────────────────────────
-- El archivo YA está en el bucket cuando se llama esto: primero sube el medio
-- (directo del cliente al bucket, ADR-C) y después se registra, que es el orden
-- que la cola offline respeta (la evidencia antes del cierre, ADR-D).
--
-- Idempotente por `p_id`, por lo mismo que la apertura: el intent se reintenta.
-- La ruta tiene que ser de la carpeta de ESTA visita; si no, una visita podría
-- apuntar a la evidencia de otra.
CREATE OR REPLACE FUNCTION public.ronda_adjuntar_evidencia(
  p_id        UUID,
  p_visita    UUID,
  p_respuesta UUID        DEFAULT NULL,
  p_tipo      TEXT        DEFAULT 'FOTO',
  p_path      TEXT        DEFAULT NULL,
  p_meta      JSONB       DEFAULT '{}'::jsonb,
  p_persona   UUID        DEFAULT NULL,
  p_sesion    UUID        DEFAULT NULL
) RETURNS ronda_evidencias
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila  ronda_evidencias;
  v_path  TEXT := NULLIF(btrim(p_path), '');
BEGIN
  PERFORM public.ronda_visita_escribible(p_visita, v_actor);
  SELECT * INTO v_fila FROM public.ronda_evidencias WHERE id = p_id;
  IF FOUND THEN RETURN v_fila; END IF;

  IF v_path IS NULL THEN RAISE EXCEPTION 'Falta la ruta del archivo en el bucket.'; END IF;
  IF split_part(v_path, '/', 1) <> p_visita::text THEN
    RAISE EXCEPTION 'La evidencia tiene que estar en la carpeta de su visita (%/…).', p_visita;
  END IF;
  IF p_respuesta IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ronda_respuestas r
                      WHERE r.id = p_respuesta AND r.visita_id = p_visita) THEN
    RAISE EXCEPTION 'Esa respuesta no es de esta visita.';
  END IF;
  IF COALESCE(p_meta ->> 'sha256', '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Cada archivo tiene que llegar con su sha256: sin huella no es prueba.';
  END IF;

  INSERT INTO public.ronda_evidencias (
    id, visita_id, respuesta_id, tipo, archivo_path, mime, tamano, ancho, alto,
    duracion_seg, sha256, hash_perceptual, exif, origen, qr_detectado,
    lat, lng, precision_metros, capturado_dispositivo
  ) VALUES (
    p_id, p_visita, p_respuesta, upper(COALESCE(p_tipo, 'FOTO')), v_path,
    NULLIF(p_meta ->> 'mime', ''),
    NULLIF(p_meta ->> 'tamano', '')::bigint,
    NULLIF(p_meta ->> 'ancho', '')::int,
    NULLIF(p_meta ->> 'alto', '')::int,
    NULLIF(p_meta ->> 'duracion_seg', '')::numeric,
    lower(p_meta ->> 'sha256'),
    NULLIF(p_meta ->> 'hash_perceptual', ''),
    COALESCE(p_meta -> 'exif', '{}'::jsonb),
    upper(COALESCE(NULLIF(p_meta ->> 'origen', ''), 'CAMARA_VIVO')),
    NULLIF(p_meta ->> 'qr_detectado', ''),
    NULLIF(p_meta ->> 'lat', '')::numeric,
    NULLIF(p_meta ->> 'lng', '')::numeric,
    NULLIF(p_meta ->> 'precision_metros', '')::numeric,
    NULLIF(p_meta ->> 'capturado_dispositivo', '')::timestamptz
  ) RETURNING * INTO v_fila;

  -- La repetición queda en auditoría: es la señal que F13 va a querer leer sin
  -- recorrer toda la tabla de evidencias.
  IF v_fila.repetida_de_id IS NOT NULL THEN
    INSERT INTO public.ronda_eventos (
      grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
      actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle)
    SELECT v.grupo_id, v.sede_id, 'ronda_evidencias', v_fila.id, 'EVIDENCIA_REPETIDA',
           CASE WHEN v.usuario_id IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
           v.usuario_id, v.persona_id, v.persona_nombre, v.canal,
           jsonb_build_object('visita', v.numero, 'motivo', v_fila.repetida_motivo,
                              'repetida_de', v_fila.repetida_de_id,
                              'misma_visita', v_fila.repetida_misma_visita)
      FROM public.ronda_visitas v WHERE v.id = p_visita;
  END IF;
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_adjuntar_evidencia(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, UUID) IS
  'Registra un medio ya subido al bucket `rondas`. Idempotente por p_id (la cola reintenta). Exige sha256, exige que la ruta sea la carpeta de la visita, y deja que el trigger rechace la galería donde se pide cámara en vivo y marque las repeticiones.';
REVOKE ALL ON FUNCTION public.ronda_adjuntar_evidencia(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_adjuntar_evidencia(UUID, UUID, UUID, TEXT, TEXT, JSONB, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 18. `ronda_firmar()`
-- ──────────────────────────────────────────────────────────────────────────────
-- Upsert por (visita, quien): volver a firmar reemplaza el trazo anterior.
-- El método facial NO se acepta todavía: `services/facial` corre hoy con
-- LIVENESS_MODE=none y aceptar un `facial_score` sin prueba de vida sería
-- guardar como fuerte una identidad que no lo es. Lo habilita F13.
CREATE OR REPLACE FUNCTION public.ronda_firmar(
  p_visita     UUID,
  p_quien      TEXT    DEFAULT 'TRABAJADOR',
  p_metodo     TEXT    DEFAULT 'TRAZO',
  p_trazo_path TEXT    DEFAULT NULL,
  p_nombre     TEXT    DEFAULT NULL,
  p_documento  TEXT    DEFAULT NULL,
  p_motivo     TEXT    DEFAULT NULL,
  p_sha256     TEXT    DEFAULT NULL,
  p_ip         INET    DEFAULT NULL,
  p_user_agent TEXT    DEFAULT NULL,
  p_persona    UUID    DEFAULT NULL,
  p_sesion     UUID    DEFAULT NULL
) RETURNS ronda_firmas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila   ronda_firmas;
  v_metodo TEXT := upper(COALESCE(p_metodo, 'TRAZO'));
BEGIN
  PERFORM public.ronda_visita_escribible(p_visita, v_actor);
  IF v_metodo = 'FACIAL' THEN
    RAISE EXCEPTION 'La firma facial se habilita en F13 (hoy el servicio corre sin prueba de vida): firma con trazo.';
  END IF;
  IF v_metodo = 'TRAZO' AND NULLIF(btrim(p_trazo_path), '') IS NULL THEN
    RAISE EXCEPTION 'Falta el trazo de la firma.';
  END IF;

  INSERT INTO public.ronda_firmas (
    visita_id, quien, metodo, trazo_path, nombre_firmante, documento_firmante,
    alternativa_motivo, sha256_firmado, ip, user_agent, firmado_at)
  VALUES (
    p_visita, upper(COALESCE(p_quien, 'TRABAJADOR')), v_metodo,
    NULLIF(btrim(p_trazo_path), ''), NULLIF(btrim(p_nombre), ''),
    NULLIF(btrim(p_documento), ''), NULLIF(btrim(p_motivo), ''),
    lower(NULLIF(btrim(p_sha256), '')), p_ip, p_user_agent, NOW())
  ON CONFLICT (visita_id, quien) DO UPDATE SET
    metodo = EXCLUDED.metodo,
    trazo_path = EXCLUDED.trazo_path,
    nombre_firmante = EXCLUDED.nombre_firmante,
    documento_firmante = EXCLUDED.documento_firmante,
    alternativa_motivo = EXCLUDED.alternativa_motivo,
    sha256_firmado = EXCLUDED.sha256_firmado,
    ip = EXCLUDED.ip,
    user_agent = EXCLUDED.user_agent,
    firmado_at = NOW()
  RETURNING * INTO v_fila;
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_firmar(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT, UUID, UUID) IS
  'Firma la visita con el trazo del PadFirma. Upsert por (visita, quien). FACIAL se rechaza a propósito: el servicio corre hoy sin prueba de vida y lo habilita F13. El motivo de no haber firmado con facial lo rellena el trigger cuando falta el consentimiento biométrico.';
REVOKE ALL ON FUNCTION public.ronda_firmar(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_firmar(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 19. `ronda_validar_cierre()` — qué falta para cerrar
-- ──────────────────────────────────────────────────────────────────────────────
-- UNA sola implementación de «qué falta», y aquí, porque la usan la pantalla
-- del resumen (para avisar antes), la RPC de cierre (para decidir si la visita
-- queda COMPLETADA o INCOMPLETA) y mañana el bot.
--
-- Qué cuenta como pendiente:
--   · un paso obligatorio sin responder;
--   · un paso obligatorio omitido (con su motivo: la omisión queda, pero la
--     visita no es completa);
--   · un paso de FOTO con menos fotos que su mínimo;
--   · un paso de FIRMA sin firma de quien la plantilla pide, y la firma del
--     trabajador si la plantilla la exige.
--
-- Los pasos CONDICIONALES solo cuentan cuando su condición se cumple: un paso
-- «¿qué se rompió?» que depende de «¿está en buen estado? = NO» no es un
-- pendiente cuando todo estaba bien.
CREATE OR REPLACE FUNCTION public.ronda_validar_cierre(p_visita UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v        RECORD;
  v_falta  JSONB := '[]'::jsonb;
  r        RECORD;
BEGIN
  SELECT x.id, x.plantilla_id, x.persona_id INTO v
    FROM public.ronda_visitas x WHERE x.id = p_visita;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe.'; END IF;

  FOR r IN
    SELECT s.id, s.orden, s.titulo, s.tipo, s.obligatorio, s.config,
           s.condicion_paso_id, s.condicion_valor,
           rp.id AS respuesta_id, rp.omitido, rp.omision_motivo,
           -- ¿La condición del paso se cumple? Se compara contra el valor
           -- guardado del paso del que depende (CASILLA o SELECCION).
           CASE WHEN s.condicion_paso_id IS NULL THEN true ELSE EXISTS (
             SELECT 1 FROM public.ronda_respuestas c
              WHERE c.visita_id = p_visita AND c.paso_id = s.condicion_paso_id
                AND (c.valor_texto = s.condicion_valor
                     OR s.condicion_valor = ANY (COALESCE(c.valor_opciones, '{}'::text[])))
           ) END AS aplica,
           (SELECT count(*) FROM public.ronda_evidencias e
             WHERE e.visita_id = p_visita AND e.respuesta_id = rp.id
               AND e.tipo = 'FOTO') AS fotos
      FROM public.ronda_plantilla_pasos s
      LEFT JOIN public.ronda_respuestas rp
             ON rp.visita_id = p_visita AND rp.paso_id = s.id
     WHERE s.plantilla_id = v.plantilla_id
     ORDER BY s.orden
  LOOP
    IF NOT r.aplica THEN CONTINUE; END IF;

    IF r.tipo = 'FIRMA' THEN
      IF r.obligatorio AND NOT EXISTS (
        SELECT 1 FROM public.ronda_firmas f
         WHERE f.visita_id = p_visita
           AND f.quien = upper(COALESCE(r.config ->> 'quien', 'trabajador'))) THEN
        v_falta := v_falta || jsonb_build_object(
          'paso_id', r.id, 'orden', r.orden, 'titulo', r.titulo,
          'tipo', r.tipo, 'falta', 'FIRMA');
      END IF;
      CONTINUE;
    END IF;

    IF r.respuesta_id IS NULL THEN
      IF r.obligatorio THEN
        v_falta := v_falta || jsonb_build_object(
          'paso_id', r.id, 'orden', r.orden, 'titulo', r.titulo,
          'tipo', r.tipo, 'falta', 'SIN_RESPONDER');
      END IF;
      CONTINUE;
    END IF;

    IF r.omitido THEN
      IF r.obligatorio THEN
        v_falta := v_falta || jsonb_build_object(
          'paso_id', r.id, 'orden', r.orden, 'titulo', r.titulo,
          'tipo', r.tipo, 'falta', 'OMITIDO', 'motivo', r.omision_motivo);
      END IF;
      CONTINUE;
    END IF;

    IF r.tipo = 'FOTO' AND r.fotos < COALESCE((r.config ->> 'min')::int, 1) THEN
      v_falta := v_falta || jsonb_build_object(
        'paso_id', r.id, 'orden', r.orden, 'titulo', r.titulo, 'tipo', r.tipo,
        'falta', 'FOTOS', 'tiene', r.fotos, 'minimo', COALESCE((r.config ->> 'min')::int, 1));
    END IF;
  END LOOP;

  -- La firma del trabajador que exige la plantilla entera, aunque no haya un
  -- paso de tipo FIRMA.
  IF EXISTS (SELECT 1 FROM public.ronda_plantillas t
              WHERE t.id = v.plantilla_id AND t.exige_firma)
     AND NOT EXISTS (SELECT 1 FROM public.ronda_firmas f
                      WHERE f.visita_id = p_visita AND f.quien = 'TRABAJADOR') THEN
    v_falta := v_falta || jsonb_build_object('falta', 'FIRMA_TRABAJADOR',
                                             'titulo', 'Firma del trabajador');
  END IF;

  RETURN jsonb_build_object(
    'completa', jsonb_array_length(v_falta) = 0,
    'faltantes', v_falta);
END $$;
COMMENT ON FUNCTION public.ronda_validar_cierre(UUID) IS
  'Qué falta para cerrar la visita: pasos obligatorios sin responder u omitidos, fotos por debajo del mínimo y firmas pendientes, saltándose los pasos condicionales cuya condición no se cumple. La usan el resumen de la PWA, la RPC de cierre y el bot: una sola definición de «completa».';
GRANT EXECUTE ON FUNCTION public.ronda_validar_cierre(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 20. `ronda_cerrar_visita()`
-- ──────────────────────────────────────────────────────────────────────────────
-- La visita SIEMPRE se puede cerrar. Es una decisión del ADR-02 (§2.9: «nunca
-- bloquea el trabajo: el conserje siempre puede cerrar y seguir») y de sentido
-- común operativo: dejar a alguien atrapado a las 2 de la mañana con un botón
-- que no responde hace que la próxima ronda se haga en papel.
--
-- Lo que la base sí exige es que lo incompleto se declare: si falta algo, la
-- visita queda INCOMPLETA y el motivo es obligatorio. Lo que faltaba se guarda
-- en `faltantes` tal como estaba, para no tener que recalcularlo con una
-- plantilla que mañana puede estar archivada.
CREATE OR REPLACE FUNCTION public.ronda_cerrar_visita(
  p_visita      UUID,
  p_fin_dispositivo TIMESTAMPTZ DEFAULT NULL,
  p_observacion TEXT    DEFAULT NULL,
  p_motivo_incompleta TEXT DEFAULT NULL,
  p_persona     UUID    DEFAULT NULL,
  p_sesion      UUID    DEFAULT NULL
) RETURNS ronda_visitas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila  ronda_visitas;
  v_val   JSONB;
  v_est   TEXT;
BEGIN
  SELECT * INTO v_fila FROM public.ronda_visitas WHERE id = p_visita FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe.'; END IF;
  -- Idempotente: la cola puede reintentar el cierre.
  IF v_fila.estado IN ('COMPLETADA','INCOMPLETA') THEN RETURN v_fila; END IF;
  IF v_fila.estado IN ('ANULADA','VENCIDA') THEN
    RAISE EXCEPTION 'La visita está % y no se puede cerrar.', v_fila.estado;
  END IF;
  PERFORM public.ronda_visita_escribible(p_visita, v_actor);

  v_val := public.ronda_validar_cierre(p_visita);
  IF (v_val ->> 'completa')::boolean THEN
    v_est := 'COMPLETADA';
  ELSE
    v_est := 'INCOMPLETA';
    IF NULLIF(btrim(p_motivo_incompleta), '') IS NULL THEN
      RAISE EXCEPTION 'Faltan % cosas por hacer: puedes cerrar igual, pero hay que escribir por qué queda incompleta.',
        jsonb_array_length(v_val -> 'faltantes');
    END IF;
  END IF;

  UPDATE public.ronda_visitas SET
    estado            = v_est,
    fin_servidor      = NOW(),
    fin_dispositivo   = COALESCE(p_fin_dispositivo, fin_dispositivo),
    observacion       = COALESCE(NULLIF(btrim(p_observacion), ''), observacion),
    incompleta_motivo = CASE WHEN v_est = 'INCOMPLETA'
                             THEN NULLIF(btrim(p_motivo_incompleta), '') ELSE NULL END,
    faltantes         = v_val -> 'faltantes'
   WHERE id = p_visita
  RETURNING * INTO v_fila;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle)
  VALUES (
    v_fila.grupo_id, v_fila.sede_id, 'ronda_visitas', v_fila.id, 'CERRAR',
    CASE WHEN v_fila.usuario_id IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    v_fila.usuario_id, v_fila.persona_id, v_fila.persona_nombre, v_fila.canal,
    jsonb_build_object('numero', v_fila.numero, 'estado', v_est,
                       'duracion_seg', v_fila.duracion_seg,
                       'faltantes', v_fila.faltantes,
                       'offline', v_fila.offline,
                       'demora_sync_seg', v_fila.demora_sync_seg));
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_cerrar_visita(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID) IS
  'Cierra la visita. Si ronda_validar_cierre() dice que falta algo, queda INCOMPLETA y el motivo es OBLIGATORIO, pero nunca se impide cerrar (ADR-02 §2.9). Idempotente: la cola puede reintentar.';
REVOKE ALL ON FUNCTION public.ronda_cerrar_visita(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_cerrar_visita(UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 21. `ronda_reportar_novedad()` — al módulo que ya existe
-- ──────────────────────────────────────────────────────────────────────────────
-- MANTENIMIENTO con equipo identificado → `mant_reportar()`, que es la RPC que
-- ya crea el ticket, su mensaje de sistema y su notificación. No se duplica
-- nada de eso.
-- MANTENIMIENTO sin equipo → la novedad queda PENDIENTE_TICKET, porque
-- `mantenimiento_tickets.maquinaria_id` es NOT NULL en el esquema de HOY y
-- F7 es la fase que lo cambia. Inventar un equipo para poder insertar
-- ensuciaría la ficha de un equipo real.
-- PQRS → `pqrs_radicar()`, que exige `auth.uid()`: desde una sesión de campo
-- (sin cuenta) la novedad queda PENDIENTE_TICKET con el detalle, y la consola
-- la radica. Se deja dicho en `destino_detalle` y no se finge que se creó.
CREATE OR REPLACE FUNCTION public.ronda_reportar_novedad(
  p_id          UUID,
  p_visita      UUID,
  p_clase       TEXT    DEFAULT 'MANTENIMIENTO',
  p_titulo      TEXT    DEFAULT NULL,
  p_descripcion TEXT    DEFAULT NULL,
  p_prioridad   TEXT    DEFAULT 'MEDIA',
  p_respuesta   UUID    DEFAULT NULL,
  p_maquinaria  UUID    DEFAULT NULL,
  p_persona     UUID    DEFAULT NULL,
  p_sesion      UUID    DEFAULT NULL
) RETURNS ronda_novedades
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila  ronda_novedades;
  v_clase TEXT := upper(COALESCE(p_clase, 'MANTENIMIENTO'));
  v_prio  TEXT := upper(COALESCE(p_prioridad, 'MEDIA'));
  v_tk    JSONB;
  v_ticket UUID;
  v_estado TEXT := 'PENDIENTE_TICKET';
  v_detalle TEXT;
  v_pqrs_id UUID;
  v_pqrs   pqrs;
  v        RECORD;
BEGIN
  PERFORM public.ronda_visita_escribible(p_visita, v_actor);
  SELECT * INTO v_fila FROM public.ronda_novedades WHERE id = p_id;
  IF FOUND THEN RETURN v_fila; END IF;
  IF NULLIF(btrim(p_titulo), '') IS NULL THEN
    RAISE EXCEPTION 'Describe en una línea qué pasó.';
  END IF;
  SELECT x.grupo_id, x.sede_id, x.numero INTO v
    FROM public.ronda_visitas x WHERE x.id = p_visita;

  IF v_clase = 'MANTENIMIENTO' AND p_maquinaria IS NOT NULL
     AND (SELECT auth.uid()) IS NOT NULL THEN
    BEGIN
      v_tk := public.mant_reportar(
        p_maquinaria, 'CORRECTIVO', v_prio,
        btrim(p_titulo),
        COALESCE(NULLIF(btrim(p_descripcion), '') || E'\n', '')
          || 'Reportado en la visita ' || COALESCE(v.numero, '') || '.');
      v_ticket := (v_tk ->> 'id')::uuid;
      v_estado := 'CREADO';
      v_detalle := 'Ticket ' || COALESCE(v_tk ->> 'numero', '');
    EXCEPTION WHEN OTHERS THEN
      -- Que no se pueda crear el ticket NO puede perder la novedad: el
      -- trabajador ya se fue del sitio y lo que vio es el dato valioso.
      v_estado := 'FALLIDO';
      v_detalle := 'No se pudo crear el ticket: ' || SQLERRM;
    END;
  ELSIF v_clase = 'MANTENIMIENTO' AND p_maquinaria IS NULL THEN
    v_detalle := 'Sin equipo identificado: mantenimiento_tickets exige maquinaria_id en el esquema de hoy. La orden de trabajo sin equipo es de F7.';
  ELSIF v_clase = 'MANTENIMIENTO' THEN
    v_detalle := 'Con equipo, pero reportado desde una sesión de campo sin cuenta: mant_reportar() exige auth.uid(). La consola lo convierte en ticket.';
  ELSIF v_clase = 'PQRS' THEN
    IF (SELECT auth.uid()) IS NOT NULL THEN
      BEGIN
        v_pqrs := public.pqrs_radicar(
          gen_random_uuid(), 'PETICION', 'SEDE', v.sede_id, btrim(p_titulo),
          COALESCE(NULLIF(btrim(p_descripcion), ''), btrim(p_titulo)),
          false, '{}'::jsonb, (v_actor ->> 'persona_id')::uuid, v_prio);
        v_pqrs_id := v_pqrs.id;
        v_estado := 'CREADO';
        v_detalle := 'PQRS ' || v_pqrs.numero;
      EXCEPTION WHEN OTHERS THEN
        v_estado := 'FALLIDO';
        v_detalle := 'No se pudo radicar la PQRS: ' || SQLERRM;
      END;
    ELSE
      v_detalle := 'La radicación de PQRS exige una cuenta (pqrs_radicar usa auth.uid()); desde una sesión de campo queda para que la consola la radique.';
    END IF;
  ELSE
    v_detalle := 'Soporte: el ticket se crea desde la consola (soporte_tickets no se escribe desde campo).';
  END IF;

  INSERT INTO public.ronda_novedades (
    id, visita_id, respuesta_id, clase, titulo, descripcion, prioridad,
    maquinaria_id, ticket_id, pqrs_id, estado_destino, destino_detalle,
    reportado_por, persona_id, grupo_id, sede_id)
  VALUES (
    p_id, p_visita, p_respuesta, v_clase, btrim(p_titulo),
    NULLIF(btrim(p_descripcion), ''), v_prio,
    p_maquinaria, v_ticket, v_pqrs_id,
    v_estado, v_detalle,
    (v_actor ->> 'usuario_id')::uuid, (v_actor ->> 'persona_id')::uuid,
    v.grupo_id, v.sede_id)
  RETURNING * INTO v_fila;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle)
  VALUES (
    v.grupo_id, v.sede_id, 'ronda_novedades', v_fila.id, 'NOVEDAD',
    CASE WHEN (v_actor ->> 'usuario_id') IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    (v_actor ->> 'usuario_id')::uuid, (v_actor ->> 'persona_id')::uuid,
    v_actor ->> 'nombre', 'APP',
    jsonb_build_object('visita', v.numero, 'clase', v_clase,
                       'estado', v_estado, 'detalle', v_detalle));
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_reportar_novedad(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID) IS
  'Reporta una novedad de la visita y la manda al módulo que ya existe: mant_reportar() cuando hay equipo identificado, pqrs_radicar() cuando quien reporta tiene cuenta. Si no se puede crear el destino, la novedad NO se pierde: queda PENDIENTE_TICKET o FALLIDO con el detalle. El ticket sin equipo es de F7.';
REVOKE ALL ON FUNCTION public.ronda_reportar_novedad(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_reportar_novedad(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 22. `ronda_registrar_reporte()` y `ronda_anular_visita()`
-- ──────────────────────────────────────────────────────────────────────────────
-- El PDF se arma fuera de Postgres (ADR-E) y se registra aquí con su sha256.
-- Upsert por visita: volver a generar el reporte reemplaza la fila y su hash,
-- que es lo correcto cuando se corrige una visita cerrada.
CREATE OR REPLACE FUNCTION public.ronda_registrar_reporte(
  p_visita   UUID,
  p_pdf_path TEXT  DEFAULT NULL,
  p_sha256   TEXT  DEFAULT NULL,
  p_paginas  INT   DEFAULT NULL,
  p_tamano   BIGINT DEFAULT NULL,
  p_html     TEXT  DEFAULT NULL,
  p_persona  UUID  DEFAULT NULL,
  p_sesion   UUID  DEFAULT NULL
) RETURNS ronda_reportes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila  ronda_reportes;
  v       RECORD;
BEGIN
  SELECT x.id, x.estado, x.grupo_id, x.sede_id, x.numero INTO v
    FROM public.ronda_visitas x WHERE x.id = p_visita;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe.'; END IF;
  IF v.estado NOT IN ('COMPLETADA','INCOMPLETA') THEN
    RAISE EXCEPTION 'El reporte se genera cuando la visita está cerrada (está %).', v.estado;
  END IF;
  IF p_pdf_path IS NOT NULL AND COALESCE(lower(p_sha256), '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'El PDF tiene que llegar con su sha256.';
  END IF;
  IF p_pdf_path IS NOT NULL AND split_part(p_pdf_path, '/', 1) <> 'reportes' THEN
    RAISE EXCEPTION 'El reporte va en reportes/{visita_id}/… del bucket `rondas`.';
  END IF;

  INSERT INTO public.ronda_reportes (
    visita_id, numero, pdf_path, sha256, paginas, tamano, html_render,
    generado_at, generado_por)
  VALUES (
    p_visita, v.numero, NULLIF(btrim(p_pdf_path), ''), lower(NULLIF(btrim(p_sha256), '')),
    p_paginas, p_tamano, p_html, NOW(), (v_actor ->> 'usuario_id')::uuid)
  ON CONFLICT (visita_id) DO UPDATE SET
    pdf_path = EXCLUDED.pdf_path,
    sha256 = EXCLUDED.sha256,
    paginas = EXCLUDED.paginas,
    tamano = EXCLUDED.tamano,
    html_render = EXCLUDED.html_render,
    generado_at = NOW(),
    generado_por = EXCLUDED.generado_por
  RETURNING * INTO v_fila;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, actor_nombre, canal, detalle)
  VALUES (
    v.grupo_id, v.sede_id, 'ronda_reportes', v_fila.id, 'REPORTE',
    CASE WHEN (v_actor ->> 'usuario_id') IS NOT NULL THEN 'USUARIO' ELSE 'PERSONA' END,
    (v_actor ->> 'usuario_id')::uuid, (v_actor ->> 'persona_id')::uuid,
    v_actor ->> 'nombre', 'APP',
    jsonb_build_object('numero', v_fila.numero, 'sha256', v_fila.sha256,
                       'paginas', v_fila.paginas));
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_registrar_reporte(UUID, TEXT, TEXT, INT, BIGINT, TEXT, UUID, UUID) IS
  'Registra el PDF de la visita con su sha256 (el PDF se arma fuera de Postgres, ADR-E). Upsert por visita: regenerar reemplaza la fila y el hash. Exige que la visita esté cerrada y que el archivo esté en reportes/{visita_id}/…';
REVOKE ALL ON FUNCTION public.ronda_registrar_reporte(UUID, TEXT, TEXT, INT, BIGINT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_registrar_reporte(UUID, TEXT, TEXT, INT, BIGINT, TEXT, UUID, UUID) TO authenticated;

/** Anular una visita: NO borra nada. Pide `gestionar_visitas_rondas` y motivo. */
CREATE OR REPLACE FUNCTION public.ronda_anular_visita(p_visita UUID, p_motivo TEXT)
RETURNS ronda_visitas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fila ronda_visitas;
BEGIN
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Anular una visita exige motivo: queda en el histórico.';
  END IF;
  SELECT * INTO v_fila FROM public.ronda_visitas WHERE id = p_visita FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La visita no existe.'; END IF;
  IF NOT (public.ronda_visitas_gestiona() AND public.auth_ve_grupo(v_fila.grupo_id)) THEN
    RAISE EXCEPTION 'No tienes permiso para anular visitas de ese contrato.';
  END IF;
  UPDATE public.ronda_visitas
     SET estado = 'ANULADA', anulada_motivo = btrim(p_motivo)
   WHERE id = p_visita RETURNING * INTO v_fila;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_nombre, canal, detalle)
  VALUES (
    v_fila.grupo_id, v_fila.sede_id, 'ronda_visitas', v_fila.id, 'ANULAR',
    'USUARIO', (SELECT auth.uid()),
    (SELECT nombre FROM public.usuarios WHERE id = (SELECT auth.uid())), 'CONSOLA',
    jsonb_build_object('numero', v_fila.numero, 'motivo', btrim(p_motivo)));
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.ronda_anular_visita(UUID, TEXT) IS
  'Marca la visita como ANULADA con motivo. No borra respuestas ni evidencia: lo anulado se tiene que poder auditar.';
REVOKE ALL ON FUNCTION public.ronda_anular_visita(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_anular_visita(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 23. Identidad: el enlace de un uso y el PIN (ADR-A, decisión §1.2)
-- ──────────────────────────────────────────────────────────────────────────────
-- Dos RPC: pedir el enlace y quemarlo. El token y el PIN se GENERAN aquí y se
-- devuelven UNA sola vez al que llama (el route handler, que los manda al canal
-- verificado); en la tabla solo quedan sus SHA-256.
--
-- El PIN se hashea con el token como sal: seis dígitos hasheados solos se
-- rompen con un diccionario de un millón de entradas en un segundo. Con el
-- token como sal, hay que tener el enlace Y el PIN.
CREATE OR REPLACE FUNCTION public.ronda_acceso_solicitar(
  p_documento TEXT,
  p_canal     TEXT DEFAULT 'WHATSAPP',
  p_punto     UUID DEFAULT NULL,
  p_destino   TEXT DEFAULT NULL,
  p_ip        INET DEFAULT NULL,
  p_minutos   INT  DEFAULT 15
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := (SELECT auth.uid());
  v_persona RECORD;
  v_canal   RECORD;
  v_token   TEXT;
  v_pin     TEXT;
  v_grupo   UUID;
  v_id      UUID;
  v_entrega TEXT;
  v_recientes INT;
BEGIN
  -- Quién puede pedir un enlace: la aplicación con la llave de servicio (el
  -- route handler, que además limita por IP), o un usuario con
  -- `gestionar_accesos_campo` para dictarlo por teléfono (entrega asistida).
  IF v_uid IS NOT NULL AND NOT public.ronda_accesos_gestiona() THEN
    RAISE EXCEPTION 'No tienes permiso para mandar enlaces de acceso de campo.';
  END IF;

  SELECT pe.id, btrim(COALESCE(pe.nombres, '') || ' ' || COALESCE(pe.apellidos, '')) AS nombre,
         pe.estado, pe.usuario_id
    INTO v_persona
    FROM public.personas pe
   WHERE pe.documento = btrim(p_documento);
  -- A propósito NO se dice si el documento existe o no: eso convertiría la
  -- pantalla de entrada en un verificador de cédulas de 6.564 personas.
  IF NOT FOUND OR v_persona.estado <> 'ACTIVO' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'SIN_CANAL');
  END IF;

  SELECT count(*)::int INTO v_recientes FROM public.ronda_sesiones s
   WHERE s.persona_id = v_persona.id AND s.created_at > NOW() - INTERVAL '10 minutes';
  IF v_recientes >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'DEMASIADOS_INTENTOS');
  END IF;

  SELECT c.id, c.canal, c.valor INTO v_canal
    FROM public.persona_canales c
   WHERE c.persona_id = v_persona.id
     AND c.canal = upper(COALESCE(p_canal, 'WHATSAPP'))
     AND c.verificado AND c.activo AND c.bloqueado_at IS NULL
   ORDER BY c.principal DESC, c.verificado_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN
    -- Sin canal verificado no se manda nada. El supervisor con
    -- `gestionar_accesos_campo` puede entregarlo en persona, y entonces el
    -- canal de la sesión es CONSOLA.
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'SIN_CANAL');
    END IF;
  END IF;

  IF p_punto IS NOT NULL THEN
    SELECT p.grupo_id INTO v_grupo FROM public.ronda_puntos p WHERE p.id = p_punto;
  END IF;

  v_token := public.ronda_cadena_aleatoria(24, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  v_pin   := public.ronda_cadena_aleatoria(6, '0123456789');
  v_entrega := CASE
    WHEN v_canal.id IS NULL THEN 'ASISTIDA'
    WHEN v_canal.canal = 'CORREO' THEN 'ENVIADO'
    -- WhatsApp y SMS no tienen transporte todavía: eso es F9. Se dice, no se
    -- finge que se mandó.
    ELSE 'SIN_CANAL' END;

  INSERT INTO public.ronda_sesiones (
    persona_id, persona_nombre, canal_id, canal, destino_enmascarado,
    token_hash, pin_hash, grupo_id, punto_id, destino_ruta,
    estado, entrega_estado, entrega_detalle, vence_at, ip_solicitud, creado_por)
  VALUES (
    v_persona.id, v_persona.nombre, v_canal.id,
    COALESCE(v_canal.canal, 'CONSOLA'),
    CASE WHEN v_canal.valor IS NULL THEN NULL
         WHEN v_canal.canal = 'CORREO'
           THEN left(v_canal.valor, 2) || '***' || substring(v_canal.valor from position('@' in v_canal.valor))
         ELSE '***' || right(v_canal.valor, 4) END,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    encode(sha256(convert_to(v_pin || v_token, 'UTF8')), 'hex'),
    v_grupo, p_punto, NULLIF(btrim(p_destino), ''),
    'PENDIENTE', v_entrega,
    CASE WHEN v_entrega = 'SIN_CANAL'
         THEN 'El envío por WhatsApp/SMS llega con F9: hoy el PIN se entrega desde la consola.' END,
    NOW() + make_interval(mins => GREATEST(5, LEAST(COALESCE(p_minutos, 15), 120))),
    p_ip, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.ronda_eventos (
    grupo_id, entidad, entidad_id, accion, actor_tipo, actor_persona_id,
    actor_nombre, canal, detalle, ip)
  VALUES (
    v_grupo, 'ronda_sesiones', v_id, 'ACCESO_SOLICITADO',
    CASE WHEN v_uid IS NOT NULL THEN 'USUARIO' ELSE 'SISTEMA' END,
    v_persona.id, v_persona.nombre, 'APP',
    jsonb_build_object('canal', COALESCE(v_canal.canal, 'CONSOLA'), 'entrega', v_entrega),
    p_ip);

  -- El token y el PIN salen de aquí UNA vez. Quien recibe esto los manda y los
  -- olvida: no se escriben en ningún log.
  RETURN jsonb_build_object(
    'ok', true, 'sesion_id', v_id, 'token', v_token, 'pin', v_pin,
    'canal', COALESCE(v_canal.canal, 'CONSOLA'), 'entrega', v_entrega,
    'persona_nombre', v_persona.nombre,
    'tiene_cuenta', v_persona.usuario_id IS NOT NULL);
END $$;
COMMENT ON FUNCTION public.ronda_acceso_solicitar(TEXT, TEXT, UUID, TEXT, INET, INT) IS
  'Crea un enlace de un uso + PIN para una persona sin cuenta y los devuelve UNA vez (en la tabla solo quedan sus SHA-256). No revela si el documento existe, limita a 3 solicitudes cada 10 minutos y solo usa canales VERIFICADOS. Mientras F9 no exista, WhatsApp y SMS quedan SIN_CANAL y el PIN se entrega desde la consola.';
REVOKE ALL ON FUNCTION public.ronda_acceso_solicitar(TEXT, TEXT, UUID, TEXT, INET, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_acceso_solicitar(TEXT, TEXT, UUID, TEXT, INET, INT) TO authenticated;

/**
 * Quema el enlace: valida token y PIN, deja la sesión ACTIVA y devuelve con qué
 * alcance. El enlace es de UN uso —`usado_at` lo marca— y el PIN tiene cinco
 * intentos: seis dígitos sin tope se adivinan por fuerza bruta.
 */
CREATE OR REPLACE FUNCTION public.ronda_acceso_verificar(
  p_token      TEXT,
  p_pin        TEXT,
  p_ip         INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_horas      INT  DEFAULT 12
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v RECORD;
BEGIN
  SELECT * INTO v FROM public.ronda_sesiones
   WHERE token_hash = encode(sha256(convert_to(btrim(p_token), 'UTF8')), 'hex')
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'NO_EXISTE'); END IF;

  IF v.estado = 'ANULADA' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'ANULADA'); END IF;
  IF v.estado = 'ACTIVA' THEN
    IF v.sesion_vence_at > NOW() THEN
      -- Ya se usó y la sesión sigue viva: no se vuelve a abrir con el mismo
      -- enlace, pero tampoco se trata como un error.
      RETURN jsonb_build_object('ok', false, 'motivo', 'YA_USADA');
    END IF;
    RETURN jsonb_build_object('ok', false, 'motivo', 'VENCIDA');
  END IF;
  IF v.vence_at < NOW() THEN
    UPDATE public.ronda_sesiones SET estado = 'VENCIDA' WHERE id = v.id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'VENCIDA');
  END IF;
  IF v.intentos_pin >= 5 THEN
    UPDATE public.ronda_sesiones
       SET estado = 'ANULADA', anulada_motivo = 'Demasiados intentos de PIN'
     WHERE id = v.id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'BLOQUEADA');
  END IF;

  IF v.pin_hash <> encode(sha256(convert_to(btrim(p_pin) || btrim(p_token), 'UTF8')), 'hex') THEN
    UPDATE public.ronda_sesiones SET intentos_pin = intentos_pin + 1 WHERE id = v.id;
    INSERT INTO public.ronda_eventos (grupo_id, entidad, entidad_id, accion, actor_tipo,
                                      actor_persona_id, canal, detalle, ip)
    VALUES (v.grupo_id, 'ronda_sesiones', v.id, 'ACCESO_PIN_ERRADO', 'ANONIMO',
            v.persona_id, 'APP', jsonb_build_object('intentos', v.intentos_pin + 1), p_ip);
    RETURN jsonb_build_object('ok', false, 'motivo', 'PIN_INCORRECTO',
                              'intentos_restantes', 5 - (v.intentos_pin + 1));
  END IF;

  UPDATE public.ronda_sesiones SET
    estado = 'ACTIVA', usado_at = NOW(), ip_uso = p_ip, user_agent = p_user_agent,
    sesion_vence_at = NOW() + make_interval(hours => GREATEST(1, LEAST(COALESCE(p_horas, 12), 24)))
   WHERE id = v.id
  RETURNING * INTO v;

  INSERT INTO public.ronda_eventos (grupo_id, entidad, entidad_id, accion, actor_tipo,
                                    actor_persona_id, actor_nombre, canal, detalle, ip)
  VALUES (v.grupo_id, 'ronda_sesiones', v.id, 'ACCESO_CONCEDIDO', 'PERSONA',
          v.persona_id, v.persona_nombre, 'APP',
          jsonb_build_object('vence', v.sesion_vence_at), p_ip);

  RETURN jsonb_build_object(
    'ok', true, 'sesion_id', v.id, 'persona_id', v.persona_id,
    'persona_nombre', v.persona_nombre, 'grupo_id', v.grupo_id,
    'punto_id', v.punto_id, 'destino_ruta', v.destino_ruta,
    'vence_at', v.sesion_vence_at);
END $$;
COMMENT ON FUNCTION public.ronda_acceso_verificar(TEXT, TEXT, INET, TEXT, INT) IS
  'Quema el enlace de un uso: valida token y PIN (cinco intentos), deja la sesión ACTIVA con vencimiento y devuelve persona, contrato y punto. Cada error de PIN queda en ronda_eventos: es la señal de que alguien está probando enlaces.';
REVOKE ALL ON FUNCTION public.ronda_acceso_verificar(TEXT, TEXT, INET, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_acceso_verificar(TEXT, TEXT, INET, TEXT, INT) TO authenticated;

/** Cierra la sesión de campo (el «salir» de la PWA, o un supervisor). */
CREATE OR REPLACE FUNCTION public.ronda_sesion_cerrar(p_sesion UUID, p_motivo TEXT DEFAULT 'Cierre de sesión')
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ronda_sesiones
     SET estado = 'ANULADA', anulada_motivo = COALESCE(NULLIF(btrim(p_motivo), ''), 'Cierre de sesión')
   WHERE id = p_sesion AND estado IN ('PENDIENTE','ACTIVA');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.ronda_sesion_cerrar(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_sesion_cerrar(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 24. Consentimientos
-- ──────────────────────────────────────────────────────────────────────────────
-- Append-only: otorgar y revocar son dos filas, nunca un UPDATE. Se guarda el
-- texto y su hash, y quien lo registró.
CREATE OR REPLACE FUNCTION public.persona_consentimiento_registrar(
  p_persona    UUID,
  p_tipo       TEXT,
  p_otorgado   BOOLEAN,
  p_version    TEXT,
  p_hash       TEXT,
  p_canal      TEXT DEFAULT 'APP',
  p_ip         INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_sesion     UUID DEFAULT NULL
) RETURNS persona_consentimientos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor JSONB := public.ronda_actor(p_persona, p_sesion);
  v_fila  persona_consentimientos;
BEGIN
  IF (v_actor ->> 'persona_id')::uuid <> p_persona
     AND NOT ((SELECT auth.uid()) IS NOT NULL AND public.ronda_accesos_gestiona()) THEN
    RAISE EXCEPTION 'Un consentimiento solo lo da su dueño (o lo registra quien tiene gestionar_accesos_campo).';
  END IF;

  INSERT INTO public.persona_consentimientos (
    persona_id, tipo, otorgado, texto_version, texto_hash, canal, ip, user_agent,
    registrado_por, revocado_at)
  VALUES (
    p_persona, upper(p_tipo), p_otorgado, btrim(p_version), lower(btrim(p_hash)),
    upper(COALESCE(p_canal, 'APP')), p_ip, p_user_agent,
    (v_actor ->> 'usuario_id')::uuid,
    CASE WHEN p_otorgado THEN NULL ELSE NOW() END)
  RETURNING * INTO v_fila;
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.persona_consentimiento_registrar(UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT, INET, TEXT, UUID) IS
  'Registra que la persona otorgó o negó un consentimiento, con el texto que leyó y su hash. Append-only: negar después de otorgar es otra fila, y la última manda (persona_consiente()).';
REVOKE ALL ON FUNCTION public.persona_consentimiento_registrar(UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT, INET, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persona_consentimiento_registrar(UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT, INET, TEXT, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 25. «Qué aplica aquí y ahora» para una sesión de campo
-- ──────────────────────────────────────────────────────────────────────────────
-- F3 dejó `ronda_tareas_aplicables()`, que filtra por `auth_ve_grupo()`. Una
-- sesión de enlace + PIN NO tiene `auth.uid()`, así que esa función le devuelve
-- cero filas: quien entra sin cuenta vería un punto sin tareas.
--
-- En vez de duplicar la consulta —que es la que resuelve la hora de Bogotá, las
-- ventanas que cruzan medianoche y la tolerancia, y duplicarla significa que un
-- día las dos copias contestarán distinto—, el cuerpo se MUEVE a
-- `ronda_tareas_punto()` (sin filtro de alcance, revocada de PUBLIC) y
-- `ronda_tareas_aplicables()` queda como la misma función de F3 con el filtro
-- puesto por encima. Mismo nombre, misma firma, mismas columnas: lo que F3
-- prueba sigue valiendo.
--
-- Quién puede llamar a la versión sin filtro: solo la llave de servicio, desde
-- el route handler que ya validó la cookie de la sesión de campo. La autoridad
-- es la misma de la ruta pública /q/<token>: la firma del QR.
CREATE OR REPLACE FUNCTION public.ronda_tareas_punto(
  p_punto      UUID,
  p_momento    TIMESTAMPTZ DEFAULT NOW(),
  p_solo_ahora BOOLEAN DEFAULT false
)
RETURNS TABLE (
  asignacion_id         UUID,
  plantilla_id          UUID,
  plantilla_codigo      TEXT,
  plantilla_version     SMALLINT,
  plantilla_nombre      TEXT,
  tipo_actividad_codigo TEXT,
  tipo_actividad_nombre TEXT,
  icono                 TEXT,
  color                 TEXT,
  duracion_estimada_min SMALLINT,
  pasos                 INT,
  frecuencia            TEXT,
  cada_horas            SMALLINT,
  veces_por_periodo     SMALLINT,
  prioridad             TEXT,
  sla_min               SMALLINT,
  tolerancia_min        SMALLINT,
  ventana_desde         TIME,
  ventana_hasta         TIME,
  dia_ventana           DATE,
  en_ventana            BOOLEAN,
  en_tolerancia         BOOLEAN,
  exige_firma           BOOLEAN,
  exige_geocerca        BOOLEAN,
  responsable_rol_id    UUID,
  responsable_cargo_id  UUID,
  responsable_persona_id UUID,
  grupo_id              UUID
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ahora AS (
    SELECT (p_momento AT TIME ZONE 'America/Bogota') AS local
  ),
  base AS (
    SELECT a.*, h.local, d.dia
      FROM public.ronda_asignaciones a
      CROSS JOIN ahora h
      CROSS JOIN LATERAL (
        SELECT (h.local::date) AS dia
        UNION ALL
        SELECT (h.local::date - 1) WHERE a.cruza_medianoche
      ) d
     WHERE a.punto_id = p_punto
       AND a.activo
       AND (a.vigente_desde IS NULL OR a.vigente_desde <= h.local::date)
       AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= h.local::date)
       AND public.grupo_vigente(a.grupo_id, h.local::date)
       AND EXTRACT(ISODOW FROM d.dia)::smallint = ANY (a.dias)
  ),
  conventana AS (
    SELECT b.*,
           CASE WHEN b.ventana_desde IS NULL THEN b.dia::timestamp
                ELSE b.dia + b.ventana_desde END AS ini,
           CASE WHEN b.ventana_desde IS NULL THEN b.dia + INTERVAL '1 day'
                WHEN b.cruza_medianoche THEN b.dia + b.ventana_hasta + INTERVAL '1 day'
                ELSE b.dia + b.ventana_hasta END AS fin
      FROM base b
  ),
  marcada AS (
    SELECT c.*,
           (c.local >= c.ini AND c.local <= c.fin) AS dentro,
           (c.local >= c.ini
            AND c.local <= c.fin + make_interval(mins => c.tolerancia_min)) AS dentro_tol
      FROM conventana c
  ),
  resuelta AS (
    SELECT m.*, p.id AS pid, p.version AS pver, p.nombre AS pnombre,
           p.duracion_estimada_min AS pdur, p.exige_firma AS pfirma,
           p.exige_geocerca AS pgeo, p.tipo_actividad_id,
           (SELECT count(*)::int FROM public.ronda_plantilla_pasos s WHERE s.plantilla_id = p.id) AS npasos
      FROM marcada m
      JOIN public.ronda_plantillas p
        ON p.id = public.ronda_plantilla_vigente(m.plantilla_codigo, m.grupo_id)
  )
  SELECT r.id, r.pid, r.plantilla_codigo::text, r.pver, r.pnombre::text,
         t.codigo::text, t.nombre::text, t.icono::text, t.color::text,
         r.pdur, r.npasos,
         r.frecuencia::text, r.cada_horas, r.veces_por_periodo,
         r.prioridad::text, r.sla_min, r.tolerancia_min,
         r.ventana_desde, r.ventana_hasta, r.dia,
         r.dentro, r.dentro_tol, r.pfirma, r.pgeo,
         r.rol_id, r.cargo_id, r.persona_id, r.grupo_id
    FROM resuelta r
    JOIN public.ronda_tipos_actividad t ON t.id = r.tipo_actividad_id
   WHERE NOT p_solo_ahora OR r.dentro_tol
   ORDER BY CASE r.prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1
                             WHEN 'MEDIA' THEN 2 ELSE 3 END,
            r.ini, t.orden, r.plantilla_codigo, r.id
$$;
COMMENT ON FUNCTION public.ronda_tareas_punto(UUID, TIMESTAMPTZ, BOOLEAN) IS
  'El cuerpo de ronda_tareas_aplicables() SIN el filtro de alcance: resuelve la hora de Bogotá, las ventanas que cruzan medianoche, la tolerancia y qué versión de la plantilla mostrar. La llama la PWA de una sesión de enlace + PIN a través del route handler con la llave de servicio (que ya validó la cookie), igual que la ruta pública /q/<token>. Revocada de PUBLIC: no se llama desde el navegador.';
REVOKE ALL ON FUNCTION public.ronda_tareas_punto(UUID, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;

-- Y `ronda_tareas_aplicables()` queda igual que en F3 —misma firma y mismas
-- columnas— pero delegando, para que la lógica difícil exista UNA sola vez.
CREATE OR REPLACE FUNCTION public.ronda_tareas_aplicables(
  p_punto      UUID,
  p_momento    TIMESTAMPTZ DEFAULT NOW(),
  p_solo_ahora BOOLEAN DEFAULT false
)
RETURNS TABLE (
  asignacion_id         UUID,
  plantilla_id          UUID,
  plantilla_codigo      TEXT,
  plantilla_version     SMALLINT,
  plantilla_nombre      TEXT,
  tipo_actividad_codigo TEXT,
  tipo_actividad_nombre TEXT,
  icono                 TEXT,
  color                 TEXT,
  duracion_estimada_min SMALLINT,
  pasos                 INT,
  frecuencia            TEXT,
  cada_horas            SMALLINT,
  veces_por_periodo     SMALLINT,
  prioridad             TEXT,
  sla_min               SMALLINT,
  tolerancia_min        SMALLINT,
  ventana_desde         TIME,
  ventana_hasta         TIME,
  dia_ventana           DATE,
  en_ventana            BOOLEAN,
  en_tolerancia         BOOLEAN,
  exige_firma           BOOLEAN,
  exige_geocerca        BOOLEAN,
  responsable_rol_id    UUID,
  responsable_cargo_id  UUID,
  responsable_persona_id UUID
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.asignacion_id, t.plantilla_id, t.plantilla_codigo, t.plantilla_version,
         t.plantilla_nombre, t.tipo_actividad_codigo, t.tipo_actividad_nombre,
         t.icono, t.color, t.duracion_estimada_min, t.pasos, t.frecuencia,
         t.cada_horas, t.veces_por_periodo, t.prioridad, t.sla_min, t.tolerancia_min,
         t.ventana_desde, t.ventana_hasta, t.dia_ventana, t.en_ventana,
         t.en_tolerancia, t.exige_firma, t.exige_geocerca,
         t.responsable_rol_id, t.responsable_cargo_id, t.responsable_persona_id
    FROM public.ronda_tareas_punto(p_punto, p_momento, p_solo_ahora) t
   WHERE public.auth_ve_grupo(t.grupo_id)
$$;
COMMENT ON FUNCTION public.ronda_tareas_aplicables(UUID, TIMESTAMPTZ, BOOLEAN) IS
  'Qué tareas aplican en un punto a una hora y un día, dentro del alcance de contratos del usuario autenticado. F4 movió el cuerpo a ronda_tareas_punto() para que la PWA de quien no tiene cuenta use la MISMA consulta; la firma, las columnas y el comportamiento no cambian.';
GRANT EXECUTE ON FUNCTION public.ronda_tareas_aplicables(UUID, TIMESTAMPTZ, BOOLEAN) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 26. Retención: 12 meses por defecto, PARÁMETRO del contrato (§1.3)
-- ──────────────────────────────────────────────────────────────────────────────
-- El número NO está en el código: sale de `grupo_reglas.retencion_evidencia_meses`,
-- que F1 creó con 12 por defecto y rango de 1 a 120. Esta RPC la llama el cron
-- (route handler con CRON_SECRET), no una persona.
--
-- Borra el REGISTRO de la evidencia y devuelve las rutas para que el que llama
-- borre los archivos del bucket: Postgres no puede borrar del storage, y una
-- fila sin archivo es menos malo que un archivo sin fila (huérfano invisible).
CREATE OR REPLACE FUNCTION public.ronda_retencion_meses(p_grupo UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT r.retencion_evidencia_meses FROM public.grupo_reglas r
                    WHERE r.grupo_id = p_grupo), 12)
$$;
COMMENT ON FUNCTION public.ronda_retencion_meses(UUID) IS
  'Meses de retención de evidencia del contrato: grupo_reglas.retencion_evidencia_meses, 12 por defecto. Parámetro, nunca una constante en el código (decisión §1.3 del complemento 2).';
GRANT EXECUTE ON FUNCTION public.ronda_retencion_meses(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_purgar_evidencia(
  p_grupo UUID DEFAULT NULL,
  p_tope  INT  DEFAULT 500
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rutas TEXT[]; v_n INT;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.ronda_visitas_gestiona() THEN
    RAISE EXCEPTION 'No tienes permiso para purgar evidencia.';
  END IF;
  WITH vencidas AS (
    SELECT e.id, e.archivo_path
      FROM public.ronda_evidencias e
      JOIN public.ronda_visitas v ON v.id = e.visita_id
     WHERE (p_grupo IS NULL OR v.grupo_id = p_grupo)
       AND e.created_at < NOW() - make_interval(months => public.ronda_retencion_meses(v.grupo_id))
     ORDER BY e.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_tope, 500), 5000))
  ), borradas AS (
    DELETE FROM public.ronda_evidencias e
     USING vencidas x WHERE e.id = x.id
     RETURNING e.archivo_path
  )
  SELECT array_agg(archivo_path), count(*)::int INTO v_rutas, v_n FROM borradas;

  IF COALESCE(v_n, 0) > 0 THEN
    INSERT INTO public.ronda_eventos (grupo_id, entidad, accion, actor_tipo,
                                      actor_usuario_id, canal, detalle)
    VALUES (p_grupo, 'ronda_evidencias', 'PURGA', 'SISTEMA', (SELECT auth.uid()), 'SISTEMA',
            jsonb_build_object('borradas', v_n));
  END IF;
  RETURN jsonb_build_object('borradas', COALESCE(v_n, 0),
                            'rutas', COALESCE(to_jsonb(v_rutas), '[]'::jsonb));
END $$;
COMMENT ON FUNCTION public.ronda_purgar_evidencia(UUID, INT) IS
  'Borra el registro de la evidencia que pasó la retención del CONTRATO (grupo_reglas.retencion_evidencia_meses) y devuelve las rutas para que el que llama borre los archivos del bucket. Por lotes, para que el cron no se quede colgado.';
REVOKE ALL ON FUNCTION public.ronda_purgar_evidencia(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ronda_purgar_evidencia(UUID, INT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 27. RLS — también en las lecturas
-- ──────────────────────────────────────────────────────────────────────────────
-- Mismo criterio que F1, F2 y F3: lectura = acceso al módulo Y el contrato en
-- el alcance; escritura = la clave de gestión Y el alcance. Y dos cosas propias
-- de esta fase:
--
--   · LO PROPIO. Quien ejecuta rondas ve SUS visitas aunque no tenga
--     `ver_visitas_rondas`: un conserje no entra a la consola, pero tiene que
--     poder ver lo que él mismo hizo (y la PWA lo necesita para pintar la cola).
--     En scripts/verificar-lecturas.mjs estas tablas quedan marcadas con (p).
--   · ESCRITURA SOLO POR RPC. Las políticas de escritura de las tablas de
--     evidencia NO se abren a `authenticated`: se escribe por las RPC
--     SECURITY DEFINER del ADR-E, que es lo que garantiza que la geocerca, el
--     motivo obligatorio y los mínimos de foto se validen en los tres canales.
--     Sin política de INSERT/UPDATE, esos comandos quedan prohibidos para
--     `authenticated`, igual que `ronda_eventos` es append-only en F2.
ALTER TABLE persona_canales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_sesiones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_visitas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_respuestas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_evidencias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_firmas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_reportes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_novedades         ENABLE ROW LEVEL SECURITY;

/** ¿Puedo leer esta visita? Por alcance, o porque es mía. */
CREATE OR REPLACE FUNCTION public.ronda_visita_puede_ver(p_visita UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ronda_visitas v
     WHERE v.id = p_visita
       AND (
         (public.ronda_visitas_acceso() AND public.auth_ve_grupo(v.grupo_id))
         OR v.usuario_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.personas pe
                     WHERE pe.id = v.persona_id AND pe.usuario_id = (SELECT auth.uid()))
       )
  )
$$;
COMMENT ON FUNCTION public.ronda_visita_puede_ver(UUID) IS
  'TRUE si el usuario puede leer la visita: por su alcance de contratos con ver_visitas_rondas, o porque la visita es suya. Lo propio no necesita permiso: un conserje tiene que poder ver lo que él mismo hizo.';
GRANT EXECUTE ON FUNCTION public.ronda_visita_puede_ver(UUID) TO authenticated;

-- ── 27.1 Las tablas con alcance propio ───────────────────────────────────────
DROP POLICY IF EXISTS ronda_visitas_read ON ronda_visitas;
CREATE POLICY ronda_visitas_read ON ronda_visitas
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.ronda_visitas_acceso()) AND grupo_id IN (SELECT public.auth_grupos()))
    OR usuario_id = (SELECT auth.uid())
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- UPDATE para la consola: anular y corregir lo cerrado. El INSERT no se abre:
-- abrir una visita es `ronda_registrar_visita()`, que es la que valida la
-- geocerca y la vigencia del contrato.
DROP POLICY IF EXISTS ronda_visitas_update ON ronda_visitas;
CREATE POLICY ronda_visitas_update ON ronda_visitas
  FOR UPDATE TO authenticated
  USING ((SELECT public.ronda_visitas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()))
  WITH CHECK ((SELECT public.ronda_visitas_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()));

DROP POLICY IF EXISTS ronda_novedades_read ON ronda_novedades;
CREATE POLICY ronda_novedades_read ON ronda_novedades
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.ronda_visitas_acceso()) AND grupo_id IN (SELECT public.auth_grupos()))
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- ── 27.2 Las hijas de la visita: se llega por `visita_id` ────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ronda_respuestas','ronda_evidencias','ronda_firmas','ronda_reportes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_read ON public.%I
      FOR SELECT TO authenticated
      USING ((SELECT public.ronda_visita_puede_ver(visita_id)))$p$, t, t);
  END LOOP;
END $$;

-- ── 27.3 Canales, consentimientos y sesiones ─────────────────────────────────
-- Son datos personales. Se leen con `ver_personas` (la clave que ya protege la
-- ficha) o si son de la propia persona. Las escrituras van por RPC.
DROP POLICY IF EXISTS persona_canales_read ON persona_canales;
CREATE POLICY persona_canales_read ON persona_canales
  FOR SELECT TO authenticated
  USING (
    (SELECT public.auth_permiso_any('{ver_personas,gestionar_accesos_campo}'::text[]))
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS persona_canales_write ON persona_canales;
CREATE POLICY persona_canales_write ON persona_canales
  FOR ALL TO authenticated
  USING ((SELECT public.ronda_accesos_gestiona()))
  WITH CHECK ((SELECT public.ronda_accesos_gestiona()));

DROP POLICY IF EXISTS persona_consentimientos_read ON persona_consentimientos;
CREATE POLICY persona_consentimientos_read ON persona_consentimientos
  FOR SELECT TO authenticated
  USING (
    (SELECT public.auth_permiso_any('{ver_personas,gestionar_accesos_campo}'::text[]))
    OR persona_id IN (SELECT pe.id FROM public.personas pe WHERE pe.usuario_id = (SELECT auth.uid()))
  );

-- `ronda_sesiones` guarda hashes de credenciales: no la lee `authenticated`
-- salvo quien manda los enlaces, y nunca se escribe desde el navegador.
DROP POLICY IF EXISTS ronda_sesiones_read ON ronda_sesiones;
CREATE POLICY ronda_sesiones_read ON ronda_sesiones
  FOR SELECT TO authenticated
  USING ((SELECT public.ronda_accesos_gestiona())
         AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())));

-- ──────────────────────────────────────────────────────────────────────────────
-- 28. Storage: el bucket `rondas` y las carpetas de esta fase (ADR-C)
-- ──────────────────────────────────────────────────────────────────────────────
-- El bucket lo declaran también F2 y F3 con el mismo `ON CONFLICT DO UPDATE`,
-- así que no importa el orden en que se apliquen.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rondas', 'rondas', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

-- Rutas (ADR-C):
--   {visita_id}/{respuesta_id}/{uuid}.jpg      evidencia
--   reportes/{visita_id}/{numero}.pdf          reporte firmado
--   puntos/{punto_id}/{uuid}.jpg               fotos del punto (F2 / C1)
--   instructivos/{instructivo_id}/{archivo}    material (F3, ya tiene políticas)
--
-- Nada se sirve público: siempre `createSignedUrl` de 300 segundos.

/** Visita a la que pertenece una ruta de evidencia, o NULL si la ruta es de
 *  otra carpeta del bucket. */
CREATE OR REPLACE FUNCTION public.ronda_visita_de_ruta(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_primera TEXT := split_part(p_name, '/', 1);
BEGIN
  IF v_primera IN ('reportes') THEN RETURN split_part(p_name, '/', 2)::uuid; END IF;
  IF v_primera IN ('instructivos','puntos') THEN RETURN NULL; END IF;
  RETURN v_primera::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;
COMMENT ON FUNCTION public.ronda_visita_de_ruta(TEXT) IS
  'Saca el id de la visita de una ruta del bucket `rondas`: {visita_id}/… para la evidencia y reportes/{visita_id}/… para el PDF. NULL si la ruta es de las carpetas de instructivos o de puntos, que tienen sus propias políticas.';

/** ¿Puede subir a esta ruta? Es la dueña de la visita, o quien gestiona. */
CREATE OR REPLACE FUNCTION public.ronda_evidencia_puede_subir(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_visita_de_ruta(p_name) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.ronda_visitas v
        WHERE v.id = public.ronda_visita_de_ruta(p_name)
          AND v.estado IN ('ABIERTA','EN_CURSO','COMPLETADA','INCOMPLETA')
          AND (
            EXISTS (SELECT 1 FROM public.personas pe
                     WHERE pe.id = v.persona_id AND pe.usuario_id = (SELECT auth.uid()))
            OR v.usuario_id = (SELECT auth.uid())
            OR (public.ronda_visitas_gestiona() AND public.auth_ve_grupo(v.grupo_id))
          )
     )
$$;
COMMENT ON FUNCTION public.ronda_evidencia_puede_subir(TEXT) IS
  'TRUE si quien sube es el dueño de la visita de esa carpeta (o la gestiona). Quien entra con enlace + PIN no tiene auth.uid() y por eso sube por el route handler con la llave de servicio, que valida la cookie antes.';
GRANT EXECUTE ON FUNCTION public.ronda_evidencia_puede_subir(TEXT) TO authenticated;

/** ¿Puede leer esta ruta? Lo mismo que para leer la visita. */
CREATE OR REPLACE FUNCTION public.ronda_evidencia_puede_ver(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_visita_de_ruta(p_name) IS NOT NULL
     AND public.ronda_visita_puede_ver(public.ronda_visita_de_ruta(p_name))
$$;
GRANT EXECUTE ON FUNCTION public.ronda_evidencia_puede_ver(TEXT) TO authenticated;

-- Políticas nombradas POR CARPETA, como ya hizo F3: el bucket lo comparten
-- varias fases y un nombre genérico se pisaría entre ramas.
DROP POLICY IF EXISTS ronda_evidencia_storage_select ON storage.objects;
CREATE POLICY ronda_evidencia_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rondas'
         AND (owner = (SELECT auth.uid()) OR public.ronda_evidencia_puede_ver(name)));

DROP POLICY IF EXISTS ronda_evidencia_storage_insert ON storage.objects;
CREATE POLICY ronda_evidencia_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rondas' AND public.ronda_evidencia_puede_subir(name));

-- NO hay política de UPDATE para la evidencia: un archivo de prueba que se
-- puede sobrescribir no prueba nada. Se adjunta otro y el anterior queda.
DROP POLICY IF EXISTS ronda_evidencia_storage_delete ON storage.objects;
CREATE POLICY ronda_evidencia_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rondas'
         AND public.ronda_visita_de_ruta(name) IS NOT NULL
         AND (SELECT public.ronda_visitas_gestiona()));

-- Las fotos de los puntos (`puntos/{punto_id}/…`) las sube quien gestiona
-- puntos y las lee cualquiera con acceso al módulo: son el hueco que el
-- complemento 1 va a llenar, y F2 dejó la columna sin políticas de storage.
CREATE OR REPLACE FUNCTION public.ronda_punto_de_ruta(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF split_part(p_name, '/', 1) <> 'puntos' THEN RETURN NULL; END IF;
  RETURN split_part(p_name, '/', 2)::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.ronda_punto_foto_puede_subir(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_punto_de_ruta(p_name) IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ronda_puntos p
                  WHERE p.id = public.ronda_punto_de_ruta(p_name)
                    AND public.ronda_gestiona_puntos() AND public.auth_ve_grupo(p.grupo_id))
$$;
GRANT EXECUTE ON FUNCTION public.ronda_punto_foto_puede_subir(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_punto_foto_puede_ver(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ronda_punto_de_ruta(p_name) IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ronda_puntos p
                  WHERE p.id = public.ronda_punto_de_ruta(p_name)
                    AND public.auth_ve_grupo(p.grupo_id))
$$;
GRANT EXECUTE ON FUNCTION public.ronda_punto_foto_puede_ver(TEXT) TO authenticated;

DROP POLICY IF EXISTS ronda_puntos_storage_select ON storage.objects;
CREATE POLICY ronda_puntos_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rondas' AND public.ronda_punto_foto_puede_ver(name));

DROP POLICY IF EXISTS ronda_puntos_storage_insert ON storage.objects;
CREATE POLICY ronda_puntos_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rondas' AND public.ronda_punto_foto_puede_subir(name));

DROP POLICY IF EXISTS ronda_puntos_storage_delete ON storage.objects;
CREATE POLICY ronda_puntos_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rondas' AND public.ronda_punto_foto_puede_subir(name));

-- ──────────────────────────────────────────────────────────────────────────────
-- 29. Auditoría: mirar sin tocar
-- ──────────────────────────────────────────────────────────────────────────────
-- Mismo criterio que PQRS y que F3: el Auditor lee la ejecución y no la cambia.
UPDATE public.roles
   SET permisos = permisos || '{"ver_visitas_rondas": true}'::jsonb
 WHERE nombre = 'Auditor';

-- ──────────────────────────────────────────────────────────────────────────────
-- 30. Sincronización incremental (packages/offline)
-- ──────────────────────────────────────────────────────────────────────────────
-- Los índices por `updated_at` quedaron arriba con cada tabla que tiene UPDATE.
-- Las append-only (`ronda_evidencias`, `ronda_firmas`, `ronda_novedades`,
-- `persona_consentimientos`) se sincronizan por `created_at`, en modo `append`,
-- y por eso llevan índice por esa columna.
