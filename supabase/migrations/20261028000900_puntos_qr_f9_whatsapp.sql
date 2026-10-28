-- =============================================================================
-- Puntos QR · F9 — El bot de WhatsApp
--
-- Qué es esto: la capa de transporte de WhatsApp del módulo de Puntos QR, como
-- la define docs/puntos-qr-whatsapp/adr-01-whatsapp.md con los ajustes que le
-- pide la §8.1 del complemento 2 (que manda sobre el ADR) y la nomenclatura de
-- docs/puntos-qr-whatsapp/03-nomenclatura.md (que manda sobre los dos).
--
-- NOMBRES, porque el ADR-01 usaba otros y la nomenclatura los cambió:
--   · `wa_*` del ADR-01          → `whatsapp_*` (lo que pertenece al canal de
--                                   WhatsApp: cuenta, credenciales, plantillas,
--                                   eventos entrantes, medios, excepciones)
--   · `visitas_*` del ADR-01     → ya son `ronda_*` y son de F4: NO se tocan
--   · conversaciones y mensajes  → `crm_*`, que es el prefijo que la §1 de la
--                                   nomenclatura reserva para «conversaciones y
--                                   envíos (WhatsApp y cualquier otro canal)»
--   · claves de permiso          → PLANAS en snake_case. `puntos_qr.crear` del
--                                   ADR-01 queda descartado: una clave con
--                                   punto no existe en el catálogo de
--                                   permisos.ts y `auth_permiso()` la
--                                   rechazaría para todo el mundo menos ADMIN.
--
-- QUÉ NO ESTÁ AQUÍ, a propósito:
--   · `crm_envios`, `crm_envio_destinos` y `crm_menu_opciones` son de F10.
--   · Los casos, etiquetas y SLA del CRM son de F11.
--   · Las tablas de `ronda_*`, `pqrs_*`, `activo_*`, `mant_*`,
--     `persona_ubicacion_*` y `ronda_rutas` no se tocan.
--   · El sincronizado de contactos e historial de la Coexistencia
--     (`smb_app_state_sync`) no tiene tabla todavía: no se puede construir ni
--     probar sin credenciales y corre UNA sola vez. Queda anotado en el informe.
--
-- LA REGLA DE ORO DEL MÓDULO (ADR-01 §10.3): si falta la configuración de Meta,
-- TODO funciona menos el envío real. El webhook recibe (firmado localmente), la
-- máquina de estados corre, la evidencia se guarda y el simulador deja ver cada
-- mensaje tal como saldría.
--
-- IDEMPOTENTE: se puede re-aplicar sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Permisos del canal
-- ──────────────────────────────────────────────────────────────────────────────
-- Tres claves, y están separadas porque son tres oficios distintos:
--   · `ver_whatsapp`       — leer conversaciones y mensajes (supervisión).
--   · `gestionar_whatsapp` — contestar a mano, reencolar, gestionar plantillas,
--                            autorizar un envío de emergencia fuera de jornada.
--   · `conectar_whatsapp`  — conectar o desconectar el NÚMERO de la empresa.
--     Va sola porque es la que puede dejar sin canal a 6.000 personas y la que
--     desvincula los dispositivos acompañantes de quien usaba WhatsApp Web.
--
-- Espejadas en apps/inventario/lib/permisos.ts, grupo «Operación Conserjería».
CREATE OR REPLACE FUNCTION public.whatsapp_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_whatsapp,gestionar_whatsapp}'::text[])
$$;
COMMENT ON FUNCTION public.whatsapp_acceso() IS
  'Lee conversaciones, mensajes y plantillas de WhatsApp dentro de su alcance de contratos.';
GRANT EXECUTE ON FUNCTION public.whatsapp_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.whatsapp_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_whatsapp')
$$;
COMMENT ON FUNCTION public.whatsapp_gestiona() IS
  'Contesta a mano, reencola lo omitido, gestiona plantillas y autoriza un envío de emergencia fuera de jornada.';
GRANT EXECUTE ON FUNCTION public.whatsapp_gestiona() TO authenticated;

CREATE OR REPLACE FUNCTION public.whatsapp_conecta()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('conectar_whatsapp')
$$;
COMMENT ON FUNCTION public.whatsapp_conecta() IS
  'Conecta o desconecta el número de la empresa. Va sola: es la clave que puede dejar a toda la operación sin canal.';
GRANT EXECUTE ON FUNCTION public.whatsapp_conecta() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. `whatsapp_cuentas` — el número conectado
-- ──────────────────────────────────────────────────────────────────────────────
-- Una fila por número. Hoy hay uno; el diseño admite varios porque la decisión
-- P-2 del ADR-01 (¿el número de clientes o uno de operación?) sigue abierta y
-- puede terminar en dos.
--
-- `transporte` es la decisión P-1 del ADR-01 hecha DATO y no constante: `META`
-- (directo contra graph.facebook.com), `BSP` (proveedor oficial) o `SIMULADOR`
-- (nada sale hacia un teléfono). Mientras no haya credenciales la cuenta nace
-- `SIMULADOR` / `SIMULADA`, que es lo que permite construir y probar el módulo
-- entero sin Meta.
--
-- `throughput_mps` arranca en 20 y no es un capricho: «numbers used with both
-- the WhatsApp Business app and Cloud API have a fixed throughput of 20 mps».
-- Para un número en coexistencia no hay upgrade posible.
CREATE TABLE IF NOT EXISTS whatsapp_cuentas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias                VARCHAR(60) NOT NULL,
  waba_id              VARCHAR(40),
  phone_number_id      VARCHAR(40),
  display_phone_number VARCHAR(30),
  nombre_visible       VARCHAR(120),
  platform_type        VARCHAR(16) CHECK (platform_type IS NULL
                         OR platform_type IN ('CLOUD_API','ON_PREMISE','NOT_APPLICABLE')),
  is_on_biz_app        BOOLEAN NOT NULL DEFAULT false,
  coexistencia         BOOLEAN NOT NULL DEFAULT true,
  throughput_mps       SMALLINT NOT NULL DEFAULT 20
                       CHECK (throughput_mps BETWEEN 1 AND 1000),
  transporte           VARCHAR(10) NOT NULL DEFAULT 'SIMULADOR'
                       CHECK (transporte IN ('META','BSP','SIMULADOR')),
  api_version          VARCHAR(10) NOT NULL DEFAULT 'v26.0',
  estado               VARCHAR(14) NOT NULL DEFAULT 'SIMULADA'
                       CHECK (estado IN ('SIMULADA','ACTIVA','SUSPENDIDA','DESCONECTADA')),
  suspension_motivo    TEXT,
  predeterminada       BOOLEAN NOT NULL DEFAULT false,
  conectado_at         TIMESTAMPTZ,
  conectado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una cuenta que dice ser real tiene que traer con qué hablarle a Meta.
  CONSTRAINT ck_wa_cuenta_real CHECK (
    transporte = 'SIMULADOR'
    OR (NULLIF(btrim(waba_id), '') IS NOT NULL
        AND NULLIF(btrim(phone_number_id), '') IS NOT NULL)
  ),
  CONSTRAINT ck_wa_cuenta_simulada CHECK (
    estado <> 'SIMULADA' OR transporte = 'SIMULADOR'
  ),
  CONSTRAINT ck_wa_cuenta_suspension CHECK (
    estado <> 'SUSPENDIDA' OR NULLIF(btrim(suspension_motivo), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_cuentas_alias ON whatsapp_cuentas(alias);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_cuentas_phone
  ON whatsapp_cuentas(phone_number_id) WHERE phone_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_cuentas_pred
  ON whatsapp_cuentas((predeterminada)) WHERE predeterminada;
CREATE INDEX IF NOT EXISTS idx_whatsapp_cuentas_upd ON whatsapp_cuentas(updated_at);

COMMENT ON TABLE whatsapp_cuentas IS
  'El número de WhatsApp conectado (era `wa_cuentas` en el ADR-01). Mientras no haya credenciales de Meta la cuenta vive en transporte SIMULADOR, y con eso el módulo se construye y se prueba entero: lo único que no pasa es que un mensaje salga hacia un teléfono.';
COMMENT ON COLUMN whatsapp_cuentas.transporte IS
  'META (directo) · BSP (proveedor oficial) · SIMULADOR (nada sale). Es la decisión P-1 del ADR-01 convertida en dato, para poder pasar de BSP a Meta sin tocar el motor.';
COMMENT ON COLUMN whatsapp_cuentas.throughput_mps IS
  'Caudal del número. 20 para un número en coexistencia y NO se puede subir: la cola de salida trabaja por debajo de este tope.';
COMMENT ON COLUMN whatsapp_cuentas.coexistencia IS
  'El número sigue funcionando en la app WhatsApp Business del teléfono. Implica: sin grupos, sin ubicación en vivo, sin llamadas, y los mensajes de la app NO abren la ventana de 24 h.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `whatsapp_credenciales` — los tokens, aparte y cifrados
-- ──────────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO SON VARIABLES DE ENTORNO: el business token es POR CLIENTE y se
-- obtiene en tiempo de ejecución cuando termina Embedded Signup. En el entorno
-- viven solo los secretos de la app de Meta, que son los mismos para todos.
--
-- Nunca en claro: se guarda el resultado de AES-256-GCM con una llave que vive
-- en WHATSAPP_TOKEN_LLAVE. Quien lea esta tabla sin la llave no tiene nada.
-- Y la RLS no concede NADA a `authenticated`: estas filas solo las lee el
-- servidor con la llave de servicio. Eso es deliberado y está más abajo.
CREATE TABLE IF NOT EXISTS whatsapp_credenciales (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id              UUID NOT NULL REFERENCES whatsapp_cuentas(id) ON DELETE CASCADE,
  tipo                   VARCHAR(16) NOT NULL
                         CHECK (tipo IN ('BUSINESS_TOKEN','SYSTEM_USER','BSP_API_KEY')),
  token_cifrado          TEXT NOT NULL,
  cifrado_alg            VARCHAR(20) NOT NULL DEFAULT 'aes-256-gcm',
  llave_id               VARCHAR(40) NOT NULL DEFAULT 'WHATSAPP_TOKEN_LLAVE',
  scopes                 TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  expira_at              TIMESTAMPTZ,
  data_access_expira_at  TIMESTAMPTZ,
  debug_revisado_at      TIMESTAMPTZ,
  estado                 VARCHAR(10) NOT NULL DEFAULT 'ACTIVA'
                         CHECK (estado IN ('ACTIVA','VENCIDA','REVOCADA')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un token se guarda como CADENA OPACA: no se valida su forma ni se recorta
  -- (la propia documentación de Meta lo pide). Lo único que se exige es que no
  -- esté vacío y que el ciphertext tenga pinta de ciphertext y no de token.
  CONSTRAINT ck_wa_cred_token CHECK (NULLIF(btrim(token_cifrado), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_cred_activa
  ON whatsapp_credenciales(cuenta_id, tipo) WHERE estado = 'ACTIVA';
CREATE INDEX IF NOT EXISTS idx_whatsapp_cred_vence ON whatsapp_credenciales(expira_at)
  WHERE estado = 'ACTIVA';

COMMENT ON TABLE whatsapp_credenciales IS
  'Tokens de Meta (era `wa_credenciales`), separados de la cuenta para poder rotarlos y auditarlos. Cifrados con AES-256-GCM y una llave de entorno: NUNCA en claro, nunca en el repositorio, nunca en un log. La RLS no concede nada a `authenticated` a propósito.';
COMMENT ON COLUMN whatsapp_credenciales.expira_at IS
  'Lo que devolvió GET /debug_token. Puede venir 0 o ausente (Meta no publica la expiración del Business Integration System User token): en ese caso se vigila que `scopes` siga trayendo los dos permisos y que las llamadas no devuelvan 190.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `whatsapp_plantillas` — el catálogo con su estado en Meta
-- ──────────────────────────────────────────────────────────────────────────────
-- La pide la §8.1 punto 3 del complemento: el catálogo de textos ya estaba
-- escrito en el ADR, pero faltaba dónde vive el ESTADO DE APROBACIÓN. Sin eso
-- el portero no sabe qué puede mandar fuera de la ventana de 24 horas.
--
-- `grupo_id` nullable: las plantillas se aprueban POR NÚMERO, no por contrato
-- (§2.4 del complemento). NULL = sirve para todos los contratos.
--
-- NINGUNA plantilla es MARKETING, y el CHECK lo impide: usar marketing para
-- asuntos de trabajo sería, además de caro, un problema del lado de la Ley 2191
-- de 2022. El dominio tiene dos valores y no tres.
--
-- Solo se puede enviar una plantilla en estado `APPROVED`. `PAUSED` por calidad
-- se SALTA y no se reintenta.
CREATE TABLE IF NOT EXISTS whatsapp_plantillas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       UUID REFERENCES whatsapp_cuentas(id) ON DELETE CASCADE,
  grupo_id        UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  nombre          VARCHAR(80) NOT NULL,
  categoria       VARCHAR(16) NOT NULL
                  CHECK (categoria IN ('UTILITY','AUTHENTICATION')),
  idioma          VARCHAR(10) NOT NULL DEFAULT 'es_CO',
  estado          VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE','EN_REVISION','APPROVED','REJECTED','PAUSED','DISABLED')),
  meta_id         VARCHAR(40),
  encabezado      VARCHAR(60),
  cuerpo          VARCHAR(1024) NOT NULL,
  pie             VARCHAR(60),
  botones         JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposito       TEXT,
  rechazo_motivo  TEXT,
  revisado_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Los nombres de plantilla de Meta van en minúscula con guion bajo.
  CONSTRAINT ck_wa_plantilla_nombre CHECK (nombre ~ '^[a-z][a-z0-9_]{2,79}$'),
  -- Hasta 10 botones (Meta). Más de 10 lo rechaza la API en producción, así que
  -- se rechaza aquí, donde el error se ve al crearla y no al mandarla.
  CONSTRAINT ck_wa_plantilla_botones CHECK (
    jsonb_typeof(botones) = 'array' AND jsonb_array_length(botones) <= 10
  ),
  -- Cada variable necesita su valor de EJEMPLO o Meta rechaza la plantilla.
  CONSTRAINT ck_wa_plantilla_variables CHECK (jsonb_typeof(variables) = 'array'),
  CONSTRAINT ck_wa_plantilla_rechazo CHECK (
    estado <> 'REJECTED' OR NULLIF(btrim(rechazo_motivo), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_plantillas_nombre
  ON whatsapp_plantillas(nombre, idioma, COALESCE(cuenta_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_whatsapp_plantillas_estado ON whatsapp_plantillas(estado);
CREATE INDEX IF NOT EXISTS idx_whatsapp_plantillas_grupo ON whatsapp_plantillas(grupo_id)
  WHERE grupo_id IS NOT NULL;

COMMENT ON TABLE whatsapp_plantillas IS
  'Catálogo de plantillas con su estado de aprobación en Meta. Solo una APPROVED puede salir fuera de la ventana de 24 h; una PAUSED por calidad se salta y no se reintenta. NINGUNA es MARKETING y el CHECK lo impide.';
COMMENT ON COLUMN whatsapp_plantillas.grupo_id IS
  'NULL = sirve para todos los contratos. Las plantillas se aprueban por NÚMERO, no por contrato (§2.4 del complemento 2).';
COMMENT ON COLUMN whatsapp_plantillas.variables IS
  'Una entrada por variable: {"pos":1,"ejemplo":"Ana","descripcion":"nombre de pila"}. Meta exige un valor de ejemplo por variable al crear la plantilla, o la rechaza. Todos los ejemplos son FICTICIOS: este repositorio es público.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `whatsapp_excepciones_jornada` — la Ley 2191, en tabla y no en código
-- ──────────────────────────────────────────────────────────────────────────────
-- La Ley 2191 de 2022 excluye del derecho a la desconexión a quienes desempeñan
-- cargos de dirección, confianza y manejo. Esa excepción va en una tabla, con
-- nombre y apellido de quien la autorizó, porque es una decisión laboral con
-- consecuencias y no un `if` en un archivo.
--
-- POR DEFECTO NADIE ESTÁ EXCEPTUADO. La tabla nace vacía.
CREATE TABLE IF NOT EXISTS whatsapp_excepciones_jornada (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id      UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  motivo          TEXT NOT NULL,
  autorizada_por  UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  vigente_desde   DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta   DATE,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_wa_excep_motivo CHECK (NULLIF(btrim(motivo), '') IS NOT NULL),
  CONSTRAINT ck_wa_excep_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE INDEX IF NOT EXISTS idx_wa_excep_persona ON whatsapp_excepciones_jornada(persona_id)
  WHERE activo;

COMMENT ON TABLE whatsapp_excepciones_jornada IS
  'Quién queda fuera del bloqueo por jornada (Ley 2191 de 2022, art. 3: cargos de dirección, confianza y manejo). Por defecto NADIE: la tabla nace vacía y cada excepción lleva motivo y quién la autorizó.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `whatsapp_eventos` — la cola de entrada, deduplicada
-- ──────────────────────────────────────────────────────────────────────────────
-- Hace falta porque Meta lo dice de tres maneras: reintenta durante 7 DÍAS si no
-- recibe 200, reintenta a TODAS las apps suscritas a la cuenta, y un solo POST
-- puede traer hasta 1.000 actualizaciones agrupadas. Y no hay API para
-- consultar webhooks históricos: lo que no se guarde, se pierde para siempre.
--
-- `dedup_clave` es el `wamid` cuando lo hay, y `sha256(tipo_campo || payload
-- normalizado)` cuando no (statuses, account_update). UNIQUE: si choca, ya lo
-- vimos y se responde 200 igual, que es el reintento haciendo su trabajo.
--
-- El POST del webhook hace TRES cosas y responde: verificar la firma, insertar
-- aquí, devolver 200. Objetivo < 300 ms. Todo lo demás es del trabajador.
CREATE TABLE IF NOT EXISTS whatsapp_eventos (
  id                  BIGSERIAL PRIMARY KEY,
  cuenta_id           UUID REFERENCES whatsapp_cuentas(id) ON DELETE SET NULL,
  dedup_clave         VARCHAR(200) NOT NULL,
  wamid               VARCHAR(200),
  tipo_campo          VARCHAR(30) NOT NULL,
  wa_id               VARCHAR(40),
  phone_number_id     VARCHAR(40),
  timestamp_meta      TIMESTAMPTZ,
  payload             JSONB NOT NULL,
  firma_ok            BOOLEAN NOT NULL DEFAULT true,
  simulado            BOOLEAN NOT NULL DEFAULT false,
  recibido_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tomado_at           TIMESTAMPTZ,
  procesado_at        TIMESTAMPTZ,
  intentos            SMALLINT NOT NULL DEFAULT 0,
  proximo_intento_at  TIMESTAMPTZ,
  ultimo_error        TEXT,
  estado              VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN ('PENDIENTE','EN_PROCESO','PROCESADO','DESCARTADO','ERROR')),
  descartado_motivo   TEXT,
  conversacion_id     UUID,
  CONSTRAINT ck_wa_evento_descarte CHECK (
    estado <> 'DESCARTADO' OR NULLIF(btrim(descartado_motivo), '') IS NOT NULL
  ),
  -- Un evento sin firma válida NO se encola para procesar. Si alguna vez llega
  -- aquí uno, es para dejar rastro, nunca para ejecutarlo.
  CONSTRAINT ck_wa_evento_firma CHECK (firma_ok = true OR estado = 'DESCARTADO')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_eventos_dedup ON whatsapp_eventos(dedup_clave);
CREATE INDEX IF NOT EXISTS idx_whatsapp_eventos_cola ON whatsapp_eventos(estado, proximo_intento_at, timestamp_meta)
  WHERE estado IN ('PENDIENTE','EN_PROCESO');
CREATE INDEX IF NOT EXISTS idx_whatsapp_eventos_wa ON whatsapp_eventos(wa_id, timestamp_meta);
CREATE INDEX IF NOT EXISTS idx_whatsapp_eventos_fecha ON whatsapp_eventos(recibido_at DESC);

COMMENT ON TABLE whatsapp_eventos IS
  'Cola de entrada del webhook (era `wa_eventos`). Deduplicada por `dedup_clave` UNIQUE porque Meta reintenta 7 días y a todas las apps suscritas: es el bug más probable del módulo. No hay API para recuperar webhooks viejos, así que lo que no quede aquí se pierde.';
COMMENT ON COLUMN whatsapp_eventos.dedup_clave IS
  'El `wamid` cuando lo hay; si no (statuses, account_update), sha256 del tipo de campo más el payload normalizado.';
COMMENT ON COLUMN whatsapp_eventos.simulado IS
  'El evento lo inyectó el simulador local, no Meta. La firma se verificó igual (el simulador firma con el app secret local): lo que cambia es que al otro lado no hay un teléfono.';

-- `whatsapp_eventos_rechazados` — lo que no trae firma válida.
-- SIN el cuerpo: guardar el payload de algo que no pudimos autenticar es
-- guardar lo que un desconocido quiso escribir en nuestra base.
CREATE TABLE IF NOT EXISTS whatsapp_eventos_rechazados (
  id           BIGSERIAL PRIMARY KEY,
  ip           INET,
  motivo       VARCHAR(24) NOT NULL
               CHECK (motivo IN ('SIN_FIRMA','FIRMA_INVALIDA','SIN_SECRETO',
                                 'CUERPO_INVALIDO','VERIFY_TOKEN','CUERPO_GRANDE')),
  user_agent   VARCHAR(300),
  bytes        INTEGER,
  ruta         VARCHAR(120),
  recibido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_rechazados_fecha ON whatsapp_eventos_rechazados(recibido_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_rechazados_motivo ON whatsapp_eventos_rechazados(motivo, recibido_at DESC);

COMMENT ON TABLE whatsapp_eventos_rechazados IS
  'Golpes al webhook sin firma válida. Se guarda la IP, el motivo y el tamaño, NUNCA el cuerpo: guardar el payload de algo que no se pudo autenticar es guardar lo que un desconocido quiso meter en la base.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. `crm_conversaciones` — una por número, con el estado de la máquina
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` y `sede_id` NULLABLE (§2.4 del complemento): una conversación puede
-- empezar sin contrato conocido — el primer «hola» de un número que todavía no
-- está identificado no tiene contrato ni sede, y rechazarlo sería perder el
-- único momento en que se puede identificar a la persona.
--
-- `estado` es la máquina de la §4.2 del ADR-01 completa: los nueve del flujo
-- feliz MÁS los nueve de espera y error, sin los cuales esto no se puede
-- implementar.
--
-- `ventana_vence_at` es la ventana de 24 horas de Meta, materializada: se abre y
-- se reinicia con CADA mensaje de la persona. Y en coexistencia, los mensajes
-- que la empresa manda desde la app del teléfono NO la abren ni la afectan.
CREATE TABLE IF NOT EXISTS crm_conversaciones (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id          UUID NOT NULL REFERENCES whatsapp_cuentas(id) ON DELETE CASCADE,
  canal              VARCHAR(10) NOT NULL DEFAULT 'WHATSAPP'
                     CHECK (canal IN ('WHATSAPP')),
  wa_id              VARCHAR(40) NOT NULL,
  perfil_nombre      VARCHAR(120),
  persona_id         UUID REFERENCES personas(id) ON DELETE SET NULL,
  persona_canal_id   UUID REFERENCES persona_canales(id) ON DELETE SET NULL,
  grupo_id           UUID REFERENCES grupos_contrato(id) ON DELETE SET NULL,
  sede_id            UUID REFERENCES sedes(id) ON DELETE SET NULL,
  estado             VARCHAR(28) NOT NULL DEFAULT 'SIN_VISITA'
                     CHECK (estado IN (
                       -- flujo feliz
                       'SIN_VISITA','PUNTO_IDENTIFICADO','UBICACION_VALIDADA',
                       'FOTO_INICIO_OK','EN_EJECUCION','FOTO_FIN_OK','RESUMEN',
                       'CONFIRMADA','CERRADA',
                       -- espera y error
                       'ESPERA_IDENTIDAD','ESPERA_CONSENTIMIENTO','ERROR_UBICACION',
                       'ERROR_FOTO','ESPERA_AGENTE','EN_ESPERA_FUERA_DE_JORNADA',
                       'EXPIRADA','CANCELADA','CERRADA_CON_NOVEDAD')),
  estado_desde       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visita_id          UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  punto_id           UUID REFERENCES ronda_puntos(id) ON DELETE SET NULL,
  -- Contexto de la máquina: qué pregunta está abierta, qué paso se está
  -- contestando, el wamid de la solicitud de ubicación para casar la respuesta
  -- con la pregunta (`context.id` del webhook), el resumen que se mostró…
  contexto           JSONB NOT NULL DEFAULT '{}'::jsonb,
  intentos           SMALLINT NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 20),
  espera_vence_at    TIMESTAMPTZ,
  ultimo_entrante_at TIMESTAMPTZ,
  ultimo_saliente_at TIMESTAMPTZ,
  ventana_vence_at   TIMESTAMPTZ,
  bloqueada          BOOLEAN NOT NULL DEFAULT false,
  bloqueo_motivo     TEXT,
  aviso_bloqueo_at   TIMESTAMPTZ,
  mensajes_entrantes INTEGER NOT NULL DEFAULT 0,
  mensajes_salientes INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_crm_conv_wa_id CHECK (wa_id ~ '^[1-9][0-9]{7,19}$'),
  CONSTRAINT ck_crm_conv_bloqueo CHECK (
    bloqueada = false OR NULLIF(btrim(bloqueo_motivo), '') IS NOT NULL
  ),
  -- Un estado de visita exige visita. Sin esto, una conversación podría decir
  -- que está ejecutando una visita que no existe y el resumen saldría vacío.
  CONSTRAINT ck_crm_conv_visita CHECK (
    estado NOT IN ('UBICACION_VALIDADA','FOTO_INICIO_OK','EN_EJECUCION',
                   'FOTO_FIN_OK','RESUMEN','CONFIRMADA')
    OR visita_id IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_conversaciones_wa ON crm_conversaciones(cuenta_id, wa_id);
CREATE INDEX IF NOT EXISTS idx_crm_conv_persona ON crm_conversaciones(persona_id)
  WHERE persona_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_conv_grupo   ON crm_conversaciones(grupo_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_conv_estado  ON crm_conversaciones(estado, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_conv_vence   ON crm_conversaciones(espera_vence_at)
  WHERE espera_vence_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_conv_visita  ON crm_conversaciones(visita_id)
  WHERE visita_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_conv_upd     ON crm_conversaciones(updated_at);

COMMENT ON TABLE crm_conversaciones IS
  'Una conversación por número (`cuenta_id` + `wa_id` UNIQUE), con el estado de la máquina de la §4 del ADR-01. `grupo_id` y `sede_id` son nullable a propósito: el primer mensaje de un número desconocido no tiene contrato, y es justo el momento en que hay que identificar a la persona.';
COMMENT ON COLUMN crm_conversaciones.wa_id IS
  'El `wa_id` del webhook en E.164 SIN el signo más (573001112233). OJO: la propia documentación de smb_message_echoes advierte que el wa_id y el número marcable pueden NO coincidir; el que manda para enrutar es este.';
COMMENT ON COLUMN crm_conversaciones.ventana_vence_at IS
  'Fin de la ventana de atención de 24 h. Se abre y se reinicia con cada mensaje de la PERSONA. En coexistencia, lo que la empresa manda desde la app del teléfono no la abre ni la afecta.';
COMMENT ON COLUMN crm_conversaciones.contexto IS
  'Estado de trabajo de la máquina: la pregunta abierta, el paso en curso, el wamid de la solicitud de ubicación (para casar la respuesta con la pregunta por `context.id`) y el texto exacto del resumen mostrado.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. `crm_mensajes` — todo lo que entra y todo lo que sale
-- ──────────────────────────────────────────────────────────────────────────────
-- Una sola tabla con `direccion`, y el buzón de salida es el subconjunto
-- `direccion = 'SALIENTE'`. El ADR-01 lo partía en dos (`wa_eventos` +
-- `wa_mensajes_salida`); se unifica porque la nomenclatura reserva `crm_` para
-- «conversaciones y envíos» y porque una conversación que se lee a medias —solo
-- lo que salió, o solo lo que entró— no sirve para supervisar nada.
--
-- El molde es `correo_saliente` + /api/cron/correo, que ya funciona en este
-- repositorio: filas PENDIENTE, `intentos`, `error`, un cron que toma un lote.
-- Lo que se le agrega, y que un correo no necesita:
--   · `prioridad` — primero las respuestas a una persona que está esperando en
--     un punto, después los avisos. El caudal del número es fijo (20 mps) y en
--     un aviso masivo alguien tiene que esperar: que no sea el conserje.
--   · `es_plantilla` — fuera de la ventana de 24 h SOLO sale una plantilla
--     aprobada, y esto es lo que lo distingue.
--   · `iniciado_por` — BOT o RESPUESTA. Es lo que implementa la Ley 2191: un
--     mensaje iniciado por el bot fuera de jornada NO sale.
--   · los estados `OMITIDO_*` — un mensaje que no se manda no se borra: queda
--     con su motivo, para que el supervisor lo vea desde la consola.
CREATE TABLE IF NOT EXISTS crm_mensajes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id     UUID NOT NULL REFERENCES crm_conversaciones(id) ON DELETE CASCADE,
  cuenta_id           UUID NOT NULL REFERENCES whatsapp_cuentas(id) ON DELETE CASCADE,
  direccion           VARCHAR(8) NOT NULL CHECK (direccion IN ('ENTRANTE','SALIENTE')),
  wamid               VARCHAR(200),
  tipo                VARCHAR(22) NOT NULL
                      CHECK (tipo IN ('TEXTO','IMAGEN','AUDIO','VIDEO','DOCUMENTO',
                                      'UBICACION','BOTONES','LISTA','SOLICITUD_UBICACION',
                                      'PLANTILLA','CONTACTO','STICKER','REACCION',
                                      'SISTEMA','NO_SOPORTADO')),
  texto               TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado              VARCHAR(24) NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN (
                        'RECIBIDO',
                        'PENDIENTE','EN_PROCESO','ENVIADO','ENTREGADO','LEIDO',
                        'SIMULADO','FALLIDO','CANCELADO','EN_ESPERA_CREDENCIAL',
                        'OMITIDO_VENTANA','OMITIDO_JORNADA','OMITIDO_CONSENTIMIENTO',
                        'OMITIDO_PLANTILLA','OMITIDO_BLOQUEADO')),
  iniciado_por        VARCHAR(10) CHECK (iniciado_por IS NULL
                        OR iniciado_por IN ('BOT','RESPUESTA','AGENTE','PERSONA')),
  es_plantilla        BOOLEAN NOT NULL DEFAULT false,
  plantilla_id        UUID REFERENCES whatsapp_plantillas(id) ON DELETE SET NULL,
  plantilla_nombre    VARCHAR(80),
  plantilla_variables JSONB,
  consentimiento      VARCHAR(12) CHECK (consentimiento IS NULL
                        OR consentimiento IN ('UBICACION','FOTOS','AUDIO','BIOMETRIA','WHATSAPP')),
  prioridad           SMALLINT NOT NULL DEFAULT 5 CHECK (prioridad BETWEEN 1 AND 9),
  programado_para     TIMESTAMPTZ,
  intentos            SMALLINT NOT NULL DEFAULT 0,
  proximo_intento_at  TIMESTAMPTZ,
  tomado_at           TIMESTAMPTZ,
  enviado_at          TIMESTAMPTZ,
  entregado_at        TIMESTAMPTZ,
  leido_at            TIMESTAMPTZ,
  error_codigo        VARCHAR(20),
  error               TEXT,
  omitido_motivo      TEXT,
  evento_id           BIGINT REFERENCES whatsapp_eventos(id) ON DELETE SET NULL,
  visita_id           UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  emergencia          BOOLEAN NOT NULL DEFAULT false,
  emergencia_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Lo que entra ya pasó: no tiene cola, ni intentos, ni plantilla.
  CONSTRAINT ck_crm_msg_entrante CHECK (
    direccion <> 'ENTRANTE'
    OR (estado = 'RECIBIDO' AND es_plantilla = false AND wamid IS NOT NULL)
  ),
  CONSTRAINT ck_crm_msg_saliente CHECK (direccion <> 'SALIENTE' OR estado <> 'RECIBIDO'),
  -- Una plantilla tiene que decir CUÁL.
  CONSTRAINT ck_crm_msg_plantilla CHECK (
    es_plantilla = false OR NULLIF(btrim(plantilla_nombre), '') IS NOT NULL
  ),
  CONSTRAINT ck_crm_msg_tipo_plantilla CHECK (
    (tipo = 'PLANTILLA') = (es_plantilla = true) OR direccion = 'ENTRANTE'
  ),
  -- Un mensaje omitido EXIGE motivo: «no se mandó» sin por qué no sirve de nada
  -- a quien lo tiene que resolver desde la consola.
  CONSTRAINT ck_crm_msg_omitido CHECK (
    estado NOT LIKE 'OMITIDO%' OR NULLIF(btrim(omitido_motivo), '') IS NOT NULL
  ),
  -- Un mensaje de EMERGENCIA fuera de jornada tiene que decir QUIÉN lo
  -- autorizó. Es un requisito de la Ley 2191, no una comodidad de auditoría.
  CONSTRAINT ck_crm_msg_emergencia CHECK (emergencia = false OR emergencia_por IS NOT NULL),
  CONSTRAINT ck_crm_msg_fallido CHECK (
    estado <> 'FALLIDO' OR NULLIF(btrim(error), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_mensajes_wamid ON crm_mensajes(wamid)
  WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_msg_conv ON crm_mensajes(conversacion_id, created_at DESC);
-- EL índice de la cola de salida: por prioridad y por hora programada.
CREATE INDEX IF NOT EXISTS idx_crm_msg_cola ON crm_mensajes(prioridad, programado_para, created_at)
  WHERE direccion = 'SALIENTE' AND estado IN ('PENDIENTE','EN_PROCESO');
CREATE INDEX IF NOT EXISTS idx_crm_msg_omitidos ON crm_mensajes(created_at DESC)
  WHERE estado LIKE 'OMITIDO%';
CREATE INDEX IF NOT EXISTS idx_crm_msg_visita ON crm_mensajes(visita_id)
  WHERE visita_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_msg_upd ON crm_mensajes(updated_at);

COMMENT ON TABLE crm_mensajes IS
  'Todo lo que entra y todo lo que sale de una conversación. El buzón de salida es el subconjunto `direccion = SALIENTE`, con el mismo molde de `correo_saliente` + /api/cron/correo que ya funciona en el repositorio, más prioridad, plantilla, `iniciado_por` y los estados OMITIDO_*.';
COMMENT ON COLUMN crm_mensajes.prioridad IS
  '1 = lo más urgente (la respuesta a alguien que está parado en un punto esperando), 9 = lo que puede esperar (un aviso masivo). El caudal del número es fijo en 20 mps: en un envío grande alguien tiene que esperar, y no puede ser el conserje.';
COMMENT ON COLUMN crm_mensajes.iniciado_por IS
  'BOT (lo inicia el sistema) o RESPUESTA (contesta algo que la persona escribió). Es lo que implementa el art. 3 de la Ley 2191 de 2022: un mensaje BOT fuera de jornada NO sale y queda OMITIDO_JORNADA.';
COMMENT ON COLUMN crm_mensajes.es_plantilla IS
  'Fuera de la ventana de 24 h solo sale una plantilla APPROVED. Lo verifica el portero al encolar Y otra vez al enviar, porque un mensaje programado puede quedar fuera de ventana entre las dos cosas.';
COMMENT ON COLUMN crm_mensajes.emergencia IS
  'Salta el bloqueo por jornada. No la decide el bot: la autoriza una persona con `gestionar_whatsapp` desde la consola, y `emergencia_por` es obligatorio.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. `whatsapp_medios` — lo que llega por el chat, bajado a Storage propio
-- ──────────────────────────────────────────────────────────────────────────────
-- El reloj corre y corre rápido: la URL que devuelve GET /{MEDIA_ID} vale 5
-- MINUTOS, y el media_id que llega por webhook expira a los 7 DÍAS. Pasado eso
-- no hay segunda oportunidad, y la foto de un trabajo hecho es la prueba de que
-- se hizo. Por eso se baja de inmediato y se sube a Storage propio.
--
-- `sha256_declarado` es el que manda WhatsApp en el payload; `sha256` el que
-- calculamos al bajar. Si no cuadran, la fila queda DUDOSA y lo consume el
-- ADR-02: no se borra, no se oculta, se marca.
CREATE TABLE IF NOT EXISTS whatsapp_medios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mensaje_id          UUID NOT NULL REFERENCES crm_mensajes(id) ON DELETE CASCADE,
  conversacion_id     UUID NOT NULL REFERENCES crm_conversaciones(id) ON DELETE CASCADE,
  wamid               VARCHAR(200),
  media_id            VARCHAR(100) NOT NULL,
  hito                VARCHAR(20) NOT NULL DEFAULT 'TAREA',
  bucket              VARCHAR(60),
  path                TEXT,
  mime                VARCHAR(120),
  bytes               BIGINT CHECK (bytes IS NULL OR bytes >= 0),
  sha256              CHAR(64),
  sha256_declarado    VARCHAR(120),
  integridad          VARCHAR(16) NOT NULL DEFAULT 'SIN_VERIFICAR'
                      CHECK (integridad IN ('SIN_VERIFICAR','OK','DUDOSA')),
  con_exif            BOOLEAN NOT NULL DEFAULT false,
  voz                 BOOLEAN NOT NULL DEFAULT false,
  transcripcion       TEXT,
  estado              VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN ('PENDIENTE','EN_PROCESO','DESCARGADO','ERROR','VENCIDO')),
  intentos            SMALLINT NOT NULL DEFAULT 0,
  proximo_intento_at  TIMESTAMPTZ,
  error               TEXT,
  descargado_at       TIMESTAMPTZ,
  vence_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  visita_id           UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  evidencia_id        UUID REFERENCES ronda_evidencias(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_wa_medio_descargado CHECK (
    estado <> 'DESCARGADO'
    OR (NULLIF(btrim(path), '') IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$'
        AND descargado_at IS NOT NULL)
  ),
  CONSTRAINT ck_wa_medio_error CHECK (
    estado <> 'ERROR' OR NULLIF(btrim(error), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_medios_mensaje ON whatsapp_medios(mensaje_id);
CREATE INDEX IF NOT EXISTS idx_wa_medios_cola ON whatsapp_medios(estado, proximo_intento_at)
  WHERE estado IN ('PENDIENTE','EN_PROCESO');
CREATE INDEX IF NOT EXISTS idx_wa_medios_vence ON whatsapp_medios(vence_at)
  WHERE estado <> 'DESCARGADO';
CREATE INDEX IF NOT EXISTS idx_wa_medios_visita ON whatsapp_medios(visita_id)
  WHERE visita_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_medios_sha ON whatsapp_medios(sha256) WHERE sha256 IS NOT NULL;

COMMENT ON TABLE whatsapp_medios IS
  'Fotos, audios, videos y documentos que llegan por el chat, bajados a Storage propio (bucket `rondas`). La URL de Meta vale 5 minutos y el media_id 7 días: pasado eso la prueba del trabajo se pierde y no hay API para recuperarla.';
COMMENT ON COLUMN whatsapp_medios.con_exif IS
  'TRUE cuando la imagen llegó como `document` y no como `image`: ahí WhatsApp sí conserva los metadatos. Una foto enviada como imagen pierde geolocalización, datos del dispositivo y software de edición, así que de ella NO se puede sacar ni la hora ni el lugar.';
COMMENT ON COLUMN whatsapp_medios.integridad IS
  'OK cuando el sha256 que calculamos al bajar coincide con el que declaró WhatsApp. DUDOSA cuando no: no se borra ni se oculta, se marca, y lo consume el adr-02.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. Triggers de `updated_at`
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_cuentas','whatsapp_credenciales','whatsapp_plantillas',
                           'whatsapp_excepciones_jornada','crm_conversaciones','crm_mensajes',
                           'whatsapp_medios']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_upd ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_upd BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. `whatsapp_jornada()` — ¿estamos dentro de la jornada de la persona?
-- ──────────────────────────────────────────────────────────────────────────────
-- Esto implementa el art. 3 de la Ley 2191 de 2022: nadie tiene que recibir
-- «contacto, por cualquier medio o herramienta, bien sea tecnológica o no, para
-- cuestiones relacionadas con su ámbito o actividad laboral» fuera de su
-- jornada. Un bot que manda recordatorios es exactamente eso.
--
-- ORDEN DE FUENTES, y la que se usó queda escrita en el evento:
--   1. Excepción vigente de `whatsapp_excepciones_jornada` → siempre dentro.
--   2. Persona RETIRADA o inactiva → NO hay jornada, ni la de respaldo.
--   3. `grupo_reglas.mensajeria_desde` / `_hasta` del contrato — la §8.1 punto 7
--      del complemento lo exige: la jornada de mensajería es una regla DEL
--      CONTRATO, no global.
--   4. Franja de respaldo que pasa quien llama (de WHATSAPP_JORNADA_FALLBACK).
--
-- LO QUE FALTA, y hay que decirlo: el ADR-01 §7.2 pone como fuente preferida el
-- TURNO PROGRAMADO de la persona y, después, su marcación real. Hoy eso no
-- existe: `programacion_fase1` dejó los PATRONES de turno (`turno_patrones`) y
-- los puestos, pero no hay ninguna tabla que diga qué turno le toca a qué
-- persona qué día, ni marcaciones. Cuando exista, se agrega como fuente 3 y las
-- demás bajan un puesto: por eso la respuesta trae `fuente`, para que el día que
-- cambie se vea en los eventos viejos qué se usó.
--
-- Turno de noche: si `desde > hasta` el intervalo CRUZA MEDIANOCHE y es una sola
-- jornada continua (22:00–06:00), no dos trozos.
-- Siempre en America/Bogota, con la fecha calculada en esa zona y no en UTC.
CREATE OR REPLACE FUNCTION public.whatsapp_jornada(
  p_persona  UUID,
  p_grupo    UUID        DEFAULT NULL,
  p_momento  TIMESTAMPTZ DEFAULT NOW(),
  p_desde    TIME        DEFAULT '06:00',
  p_hasta    TIME        DEFAULT '20:00',
  p_zona     TEXT        DEFAULT 'America/Bogota'
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hora   TIME;
  v_desde  TIME := p_desde;
  v_hasta  TIME := p_hasta;
  v_fuente TEXT := 'RESPALDO';
  v_estado TEXT;
  v_dentro BOOLEAN;
BEGIN
  v_hora := (p_momento AT TIME ZONE p_zona)::time;

  IF p_persona IS NOT NULL THEN
    -- 1. Excepción de la Ley 2191 (dirección, confianza y manejo).
    IF EXISTS (
      SELECT 1 FROM public.whatsapp_excepciones_jornada e
       WHERE e.persona_id = p_persona AND e.activo
         AND e.vigente_desde <= (p_momento AT TIME ZONE p_zona)::date
         AND (e.vigente_hasta IS NULL OR e.vigente_hasta >= (p_momento AT TIME ZONE p_zona)::date)
    ) THEN
      RETURN jsonb_build_object('dentro', true, 'fuente', 'EXCEPCION',
        'hora', v_hora, 'zona', p_zona);
    END IF;

    -- 2. Quien ya no trabaja aquí no recibe nada. Ni en la franja de respaldo.
    SELECT pe.estado INTO v_estado FROM public.personas pe WHERE pe.id = p_persona;
    IF v_estado IS NULL OR upper(v_estado) IN ('RETIRADO','INACTIVO') THEN
      RETURN jsonb_build_object('dentro', false, 'fuente', 'SIN_JORNADA',
        'hora', v_hora, 'zona', p_zona, 'motivo', 'La persona no está activa en la nómina.');
    END IF;
  END IF;

  -- 3. La jornada de mensajería del CONTRATO (§8.1 punto 7 del complemento).
  IF p_grupo IS NOT NULL THEN
    SELECT r.mensajeria_desde, r.mensajeria_hasta INTO v_desde, v_hasta
      FROM public.grupo_reglas r WHERE r.grupo_id = p_grupo;
    IF v_desde IS NOT NULL AND v_hasta IS NOT NULL THEN
      v_fuente := 'CONTRATO';
    ELSE
      v_desde := p_desde; v_hasta := p_hasta;
    END IF;
  END IF;

  -- Intervalo, no par de horas: si cruza medianoche es una jornada continua.
  IF v_desde = v_hasta THEN
    v_dentro := true;                                    -- 24 horas
  ELSIF v_desde < v_hasta THEN
    v_dentro := v_hora >= v_desde AND v_hora < v_hasta;
  ELSE
    v_dentro := v_hora >= v_desde OR v_hora < v_hasta;   -- 22:00–06:00
  END IF;

  RETURN jsonb_build_object('dentro', v_dentro, 'fuente', v_fuente,
    'desde', v_desde, 'hasta', v_hasta, 'hora', v_hora, 'zona', p_zona);
END $$;
COMMENT ON FUNCTION public.whatsapp_jornada(UUID, UUID, TIMESTAMPTZ, TIME, TIME, TEXT) IS
  '¿Se le puede escribir a esta persona AHORA? Implementa el art. 3 de la Ley 2191 de 2022. Fuentes en orden: excepción autorizada, persona no activa (nunca), jornada de mensajería del contrato, franja de respaldo. Devuelve también CUÁL se usó, para que el día que exista el turno programado se vea en los eventos viejos qué regía.';
GRANT EXECUTE ON FUNCTION public.whatsapp_jornada(UUID, UUID, TIMESTAMPTZ, TIME, TIME, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. `whatsapp_ventana_abierta()` — la ventana de 24 horas de Meta
-- ──────────────────────────────────────────────────────────────────────────────
-- «The customer service window opens and resets with each user message», y los
-- mensajes que no son plantilla «can only be used to respond — not reach out».
-- Se trabaja con un MARGEN (23 h por defecto): tomar la ventana justa es
-- garantizar que el mensaje que se encoló al minuto 1.439 llegue tarde.
CREATE OR REPLACE FUNCTION public.whatsapp_ventana_abierta(
  p_conversacion UUID,
  p_margen_horas NUMERIC     DEFAULT 23,
  p_momento      TIMESTAMPTZ DEFAULT NOW()
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT c.ultimo_entrante_at IS NOT NULL
       AND p_momento < c.ultimo_entrante_at + make_interval(mins => (p_margen_horas * 60)::int)
      FROM public.crm_conversaciones c WHERE c.id = p_conversacion
  ), false)
$$;
COMMENT ON FUNCTION public.whatsapp_ventana_abierta(UUID, NUMERIC, TIMESTAMPTZ) IS
  '¿Hay ventana de atención abierta? Se mide desde el ÚLTIMO mensaje de la persona, con un margen (23 h) sobre las 24 de Meta. Fuera de la ventana solo sale una plantilla APPROVED.';
GRANT EXECUTE ON FUNCTION public.whatsapp_ventana_abierta(UUID, NUMERIC, TIMESTAMPTZ) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. `whatsapp_portero()` — las cuatro preguntas, en un solo sitio
-- ──────────────────────────────────────────────────────────────────────────────
-- Devuelve el estado con el que debe nacer (o salir) un mensaje. Se llama DOS
-- veces en la vida de cada mensaje —al encolar y al enviar— porque un mensaje
-- programado puede quedar fuera de ventana o fuera de jornada entre las dos, y
-- la §4.4 del complemento lo exige explícitamente.
--
-- Orden: bloqueo → plantilla → ventana → jornada → consentimiento. El orden
-- importa para el MOTIVO que se registra: si un número está bloqueado, el
-- motivo útil es ese y no «fuera de jornada».
CREATE OR REPLACE FUNCTION public.whatsapp_portero(
  p_conversacion   UUID,
  p_iniciado_por   TEXT        DEFAULT 'BOT',
  p_plantilla      TEXT        DEFAULT NULL,
  p_consentimiento TEXT        DEFAULT NULL,
  p_emergencia     BOOLEAN     DEFAULT false,
  p_momento        TIMESTAMPTZ DEFAULT NOW(),
  p_jornada_desde  TIME        DEFAULT '06:00',
  p_jornada_hasta  TIME        DEFAULT '20:00',
  p_margen_horas   NUMERIC     DEFAULT 23,
  p_zona           TEXT        DEFAULT 'America/Bogota'
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv      RECORD;
  v_plantilla RECORD;
  -- Aparte del RECORD a propósito: plpgsql evalúa la expresión completa del
  -- RETURN, así que tocar `v_plantilla.id` cuando no hubo plantilla reventaría
  -- con «record is not assigned yet» aunque el CASE nunca llegue a esa rama.
  v_plant_id  UUID;
  v_jor       JSONB;
BEGIN
  SELECT c.*, cu.estado AS cuenta_estado, cu.transporte
    INTO v_conv
    FROM public.crm_conversaciones c
    JOIN public.whatsapp_cuentas cu ON cu.id = c.cuenta_id
   WHERE c.id = p_conversacion;
  IF NOT FOUND THEN RAISE EXCEPTION 'La conversación no existe.'; END IF;

  -- 1. Número bloqueado o canal dado de baja. Un número BLOQUEADO recibe UNA
  --    sola respuesta y después se ignora, pero sus eventos se siguen guardando.
  IF v_conv.bloqueada THEN
    RETURN jsonb_build_object('estado', 'OMITIDO_BLOQUEADO',
      'motivo', COALESCE(v_conv.bloqueo_motivo, 'El número está inhabilitado para el asistente.'));
  END IF;

  -- 2. Plantilla: tiene que existir y estar APPROVED. PENDIENTE, REJECTED,
  --    PAUSED o DISABLED se SALTAN y no se reintentan.
  IF p_plantilla IS NOT NULL THEN
    SELECT * INTO v_plantilla FROM public.whatsapp_plantillas t
      WHERE t.nombre = lower(btrim(p_plantilla))
        AND (t.cuenta_id IS NULL OR t.cuenta_id = v_conv.cuenta_id)
        AND (t.grupo_id IS NULL OR t.grupo_id = v_conv.grupo_id)
      ORDER BY t.cuenta_id NULLS LAST, t.grupo_id NULLS LAST
      LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('estado', 'OMITIDO_PLANTILLA',
        'motivo', format('La plantilla %s no está en el catálogo.', p_plantilla));
    END IF;
    IF v_plantilla.estado <> 'APPROVED' THEN
      RETURN jsonb_build_object('estado', 'OMITIDO_PLANTILLA', 'plantilla_id', v_plantilla.id,
        'motivo', format('La plantilla %s está %s en Meta: solo se puede enviar una APPROVED.',
                         v_plantilla.nombre, v_plantilla.estado));
    END IF;
    v_plant_id := v_plantilla.id;
  END IF;

  -- 3. Ventana de 24 h. Solo aplica a lo que NO es plantilla.
  IF p_plantilla IS NULL
     AND NOT public.whatsapp_ventana_abierta(p_conversacion, p_margen_horas, p_momento) THEN
    RETURN jsonb_build_object('estado', 'OMITIDO_VENTANA',
      'motivo', 'Se cerró la ventana de 24 horas: fuera de ella solo sale una plantilla aprobada.');
  END IF;

  -- 4. Jornada (Ley 2191). Solo frena lo que INICIA el bot: si la persona
  --    escribió, el contacto lo inició ella y responderle no viola nada.
  IF upper(COALESCE(p_iniciado_por, 'BOT')) = 'BOT' AND NOT COALESCE(p_emergencia, false) THEN
    v_jor := public.whatsapp_jornada(v_conv.persona_id, v_conv.grupo_id, p_momento,
                                     p_jornada_desde, p_jornada_hasta, p_zona);
    IF NOT (v_jor ->> 'dentro')::boolean THEN
      RETURN jsonb_build_object('estado', 'OMITIDO_JORNADA', 'jornada', v_jor,
        'motivo', format('Fuera de la jornada de la persona (fuente %s): el bot no inicia conversación.',
                         v_jor ->> 'fuente'));
    END IF;
  END IF;

  -- 5. Consentimiento vigente para lo que se va a pedir.
  IF p_consentimiento IS NOT NULL THEN
    IF v_conv.persona_id IS NULL THEN
      RETURN jsonb_build_object('estado', 'OMITIDO_CONSENTIMIENTO',
        'motivo', 'Todavía no se sabe quién es: no se le puede pedir un permiso a un número sin persona.');
    END IF;
    IF NOT public.persona_consiente(v_conv.persona_id, p_consentimiento) THEN
      RETURN jsonb_build_object('estado', 'OMITIDO_CONSENTIMIENTO',
        'motivo', format('No hay consentimiento vigente de tipo %s.', upper(p_consentimiento)));
    END IF;
  END IF;

  RETURN jsonb_build_object('estado', 'PENDIENTE', 'plantilla_id', v_plant_id);
END $$;
COMMENT ON FUNCTION public.whatsapp_portero(UUID, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIME, TIME, NUMERIC, TEXT) IS
  'El portero de la §4.1 del ADR-01: bloqueo, plantilla aprobada, ventana de 24 h, jornada (Ley 2191) y consentimiento, en ese orden. Devuelve PENDIENTE o el OMITIDO_* con su motivo. Se llama al encolar Y al enviar, porque un mensaje programado puede quedar fuera entre las dos.';
GRANT EXECUTE ON FUNCTION public.whatsapp_portero(UUID, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIME, TIME, NUMERIC, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. `crm_conversacion_resolver()` — el número → la persona
-- ──────────────────────────────────────────────────────────────────────────────
-- Al primer mensaje de un número: se busca en `persona_canales` por `wa_id` y,
-- si no está, por `valor` (que es E.164 CON el signo más, mientras el wa_id
-- viene sin él). Solo un canal VERIFICADO identifica: uno sin verificar es un
-- número que alguien escribió en un formulario.
--
-- Si no se resuelve, la conversación nace igual, sin persona y sin contrato, en
-- `ESPERA_IDENTIDAD`. Rechazarla sería perder el único momento en que se puede
-- identificar a quien escribe.
CREATE OR REPLACE FUNCTION public.crm_conversacion_resolver(
  p_cuenta UUID,
  p_wa_id  TEXT,
  p_perfil TEXT DEFAULT NULL
) RETURNS crm_conversaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wa    TEXT := regexp_replace(COALESCE(p_wa_id, ''), '[^0-9]', '', 'g');
  v_conv  crm_conversaciones;
  v_canal RECORD;
BEGIN
  IF v_wa = '' THEN RAISE EXCEPTION 'Falta el wa_id de quien escribe.'; END IF;
  IF p_cuenta IS NULL THEN RAISE EXCEPTION 'Falta la cuenta de WhatsApp.'; END IF;

  INSERT INTO public.crm_conversaciones (cuenta_id, wa_id, perfil_nombre, estado)
  VALUES (p_cuenta, v_wa, NULLIF(btrim(p_perfil), ''), 'ESPERA_IDENTIDAD')
  ON CONFLICT (cuenta_id, wa_id) DO UPDATE
    SET perfil_nombre = COALESCE(NULLIF(btrim(p_perfil), ''), crm_conversaciones.perfil_nombre)
  RETURNING * INTO v_conv;

  -- Ya identificada: nada que resolver.
  IF v_conv.persona_id IS NOT NULL THEN RETURN v_conv; END IF;

  SELECT pc.id, pc.persona_id, pe.sede_id, s.grupo_id, pc.activo, pc.bloqueado_at
    INTO v_canal
    FROM public.persona_canales pc
    JOIN public.personas pe ON pe.id = pc.persona_id
    LEFT JOIN public.sedes s ON s.id = pe.sede_id
   WHERE pc.canal = 'WHATSAPP' AND pc.verificado
     AND (pc.wa_id = v_wa OR pc.valor = '+' || v_wa)
   ORDER BY pc.principal DESC, pc.verificado_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN RETURN v_conv; END IF;

  UPDATE public.crm_conversaciones
     SET persona_id       = v_canal.persona_id,
         persona_canal_id = v_canal.id,
         sede_id          = COALESCE(sede_id, v_canal.sede_id),
         grupo_id         = COALESCE(grupo_id, v_canal.grupo_id),
         -- Un canal inhabilitado o dado de baja: identificado pero bloqueado.
         bloqueada        = (v_canal.bloqueado_at IS NOT NULL OR NOT v_canal.activo),
         bloqueo_motivo   = CASE
                              WHEN v_canal.bloqueado_at IS NOT NULL OR NOT v_canal.activo
                              THEN 'El canal de WhatsApp de esta persona está inhabilitado.'
                              ELSE bloqueo_motivo END,
         estado           = CASE WHEN estado = 'ESPERA_IDENTIDAD' THEN 'SIN_VISITA' ELSE estado END,
         estado_desde     = CASE WHEN estado = 'ESPERA_IDENTIDAD' THEN NOW() ELSE estado_desde END
   WHERE id = v_conv.id
  RETURNING * INTO v_conv;

  -- El wa_id del webhook puede no ser el número marcable: se guarda el que de
  -- verdad escribe, sin pisar el teléfono de la nómina.
  UPDATE public.persona_canales SET wa_id = v_wa
   WHERE id = v_canal.id AND (wa_id IS NULL OR wa_id <> v_wa);

  RETURN v_conv;
END $$;
COMMENT ON FUNCTION public.crm_conversacion_resolver(UUID, TEXT, TEXT) IS
  'Abre o recupera la conversación de un número y resuelve a qué persona pertenece, por `persona_canales` VERIFICADO (por wa_id o por el valor E.164 con el más). Si no se resuelve, la conversación nace sin persona en ESPERA_IDENTIDAD: ese es el único momento en que se puede identificar a quien escribe.';
REVOKE ALL ON FUNCTION public.crm_conversacion_resolver(UUID, TEXT, TEXT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. `whatsapp_evento_registrar()` — insertar sin duplicar
-- ──────────────────────────────────────────────────────────────────────────────
-- Devuelve el id insertado, o 0 si ya estaba. «Ya estaba» NO es un error: es el
-- reintento de Meta haciendo su trabajo, y el webhook responde 200 igual.
CREATE OR REPLACE FUNCTION public.whatsapp_evento_registrar(
  p_cuenta      UUID,
  p_dedup       TEXT,
  p_tipo_campo  TEXT,
  p_payload     JSONB,
  p_wamid       TEXT        DEFAULT NULL,
  p_wa_id       TEXT        DEFAULT NULL,
  p_phone_id    TEXT        DEFAULT NULL,
  p_timestamp   TIMESTAMPTZ DEFAULT NULL,
  p_simulado    BOOLEAN     DEFAULT false
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
  IF NULLIF(btrim(p_dedup), '') IS NULL THEN
    RAISE EXCEPTION 'Un evento necesita su llave de deduplicación.';
  END IF;
  INSERT INTO public.whatsapp_eventos (
    cuenta_id, dedup_clave, wamid, tipo_campo, wa_id, phone_number_id,
    timestamp_meta, payload, firma_ok, simulado, estado
  ) VALUES (
    p_cuenta, btrim(p_dedup), NULLIF(btrim(p_wamid), ''), p_tipo_campo,
    NULLIF(regexp_replace(COALESCE(p_wa_id, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(btrim(p_phone_id), ''), p_timestamp, p_payload, true,
    COALESCE(p_simulado, false), 'PENDIENTE'
  )
  ON CONFLICT (dedup_clave) DO NOTHING
  RETURNING id INTO v_id;
  RETURN COALESCE(v_id, 0);
END $$;
COMMENT ON FUNCTION public.whatsapp_evento_registrar(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) IS
  'Encola un evento del webhook. Devuelve 0 si ya estaba: eso NO es un error, es el reintento de Meta, y el webhook responde 200 igual sin volver a procesar.';
REVOKE ALL ON FUNCTION public.whatsapp_evento_registrar(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;

-- `whatsapp_evento_tomar()` — reclamo del trabajador de entrada.
-- UN evento por `wa_id` por vuelta, el más viejo por `timestamp_meta`, y nunca
-- si ya hay otro de ese mismo número EN_PROCESO. Eso es lo que garantiza que
-- dos invocaciones del cron no pisen la misma conversación y que los reintentos
-- desordenados de Meta se apliquen en orden dentro de cada chat.
CREATE OR REPLACE FUNCTION public.whatsapp_evento_tomar(p_limite INT DEFAULT 20)
RETURNS SETOF whatsapp_eventos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Huérfanos: lo que lleva más de 5 minutos EN_PROCESO se cayó con su función.
  UPDATE public.whatsapp_eventos
     SET estado = 'PENDIENTE', tomado_at = NULL
   WHERE estado = 'EN_PROCESO' AND tomado_at < NOW() - INTERVAL '5 minutes';

  RETURN QUERY
  WITH cand AS (
    SELECT DISTINCT ON (COALESCE(e.wa_id, e.dedup_clave)) e.id
      FROM public.whatsapp_eventos e
     WHERE e.estado = 'PENDIENTE'
       AND COALESCE(e.proximo_intento_at, e.recibido_at) <= NOW()
       AND NOT EXISTS (
         SELECT 1 FROM public.whatsapp_eventos o
          WHERE o.estado = 'EN_PROCESO' AND e.wa_id IS NOT NULL AND o.wa_id = e.wa_id)
     ORDER BY COALESCE(e.wa_id, e.dedup_clave),
              e.timestamp_meta NULLS FIRST, e.id
  ), lote AS (
    SELECT id FROM cand LIMIT GREATEST(COALESCE(p_limite, 20), 1)
  )
  UPDATE public.whatsapp_eventos e
     SET estado = 'EN_PROCESO', tomado_at = NOW(), intentos = e.intentos + 1
   WHERE e.id IN (SELECT id FROM lote)
  RETURNING e.*;
END $$;
COMMENT ON FUNCTION public.whatsapp_evento_tomar(INT) IS
  'Reclama un lote de eventos para el trabajador de entrada: UNO por número, el más viejo primero, y ninguno de un número que ya tiene otro EN_PROCESO. Así dos invocaciones del cron no pisan la misma conversación y los reintentos desordenados de Meta se aplican en orden.';
REVOKE ALL ON FUNCTION public.whatsapp_evento_tomar(INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_evento_cerrar(
  p_evento      BIGINT,
  p_estado      TEXT,
  p_error       TEXT DEFAULT NULL,
  p_motivo      TEXT DEFAULT NULL,
  p_conversacion UUID DEFAULT NULL
) RETURNS whatsapp_eventos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila whatsapp_eventos;
  v_est  TEXT := upper(COALESCE(p_estado, 'PROCESADO'));
  v_int  SMALLINT;
BEGIN
  SELECT intentos INTO v_int FROM public.whatsapp_eventos WHERE id = p_evento;
  IF NOT FOUND THEN RAISE EXCEPTION 'El evento % no existe.', p_evento; END IF;

  -- Retroceso de la §3.6: 1 min, 5, 15, 1 h, 6 h. A los 5 fallos queda ERROR.
  UPDATE public.whatsapp_eventos
     SET estado = CASE WHEN v_est = 'ERROR' AND v_int < 5 THEN 'PENDIENTE' ELSE v_est END,
         procesado_at = CASE WHEN v_est IN ('PROCESADO','DESCARTADO') THEN NOW() ELSE NULL END,
         tomado_at = NULL,
         ultimo_error = NULLIF(btrim(p_error), ''),
         descartado_motivo = CASE WHEN v_est = 'DESCARTADO'
                                  THEN COALESCE(NULLIF(btrim(p_motivo), ''), 'Sin motivo declarado')
                                  ELSE descartado_motivo END,
         conversacion_id = COALESCE(p_conversacion, conversacion_id),
         proximo_intento_at = CASE WHEN v_est = 'ERROR' AND v_int < 5
           THEN NOW() + (ARRAY['1 minute','5 minutes','15 minutes','1 hour','6 hours']::interval[])[LEAST(v_int, 5)]
           ELSE NULL END
   WHERE id = p_evento
  RETURNING * INTO v_fila;
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.whatsapp_evento_cerrar(BIGINT, TEXT, TEXT, TEXT, UUID) IS
  'Cierra un evento: PROCESADO, DESCARTADO (con motivo) o ERROR. Un ERROR con menos de 5 intentos vuelve a PENDIENTE con retroceso 1 min / 5 / 15 / 1 h / 6 h; al quinto queda ERROR y hay que mirarlo a mano.';
REVOKE ALL ON FUNCTION public.whatsapp_evento_cerrar(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 16. `whatsapp_registrar_entrante()` — el mensaje de la persona
-- ──────────────────────────────────────────────────────────────────────────────
-- Es lo que ABRE y REINICIA la ventana de 24 horas. Idempotente por `wamid`.
CREATE OR REPLACE FUNCTION public.whatsapp_registrar_entrante(
  p_conversacion UUID,
  p_wamid        TEXT,
  p_tipo         TEXT,
  p_texto        TEXT        DEFAULT NULL,
  p_payload      JSONB       DEFAULT '{}'::jsonb,
  p_evento       BIGINT      DEFAULT NULL,
  p_momento      TIMESTAMPTZ DEFAULT NOW()
) RETURNS crm_mensajes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila crm_mensajes;
  v_conv RECORD;
BEGIN
  IF NULLIF(btrim(p_wamid), '') IS NULL THEN
    RAISE EXCEPTION 'Un mensaje entrante necesita su wamid: es la llave de idempotencia.';
  END IF;
  SELECT * INTO v_fila FROM public.crm_mensajes WHERE wamid = btrim(p_wamid);
  IF FOUND THEN RETURN v_fila; END IF;

  SELECT c.cuenta_id, c.visita_id INTO v_conv
    FROM public.crm_conversaciones c WHERE c.id = p_conversacion;
  IF NOT FOUND THEN RAISE EXCEPTION 'La conversación no existe.'; END IF;

  INSERT INTO public.crm_mensajes (
    conversacion_id, cuenta_id, direccion, wamid, tipo, texto, payload,
    estado, iniciado_por, evento_id, visita_id, created_at
  ) VALUES (
    p_conversacion, v_conv.cuenta_id, 'ENTRANTE', btrim(p_wamid),
    upper(COALESCE(p_tipo, 'TEXTO')), NULLIF(btrim(p_texto), ''),
    COALESCE(p_payload, '{}'::jsonb), 'RECIBIDO', 'PERSONA', p_evento,
    v_conv.visita_id, COALESCE(p_momento, NOW())
  ) RETURNING * INTO v_fila;

  -- La ventana se abre y se reinicia con CADA mensaje de la persona.
  UPDATE public.crm_conversaciones
     SET ultimo_entrante_at = GREATEST(COALESCE(ultimo_entrante_at, p_momento), p_momento),
         ventana_vence_at   = GREATEST(COALESCE(ultimo_entrante_at, p_momento), p_momento)
                              + INTERVAL '24 hours',
         mensajes_entrantes = mensajes_entrantes + 1
   WHERE id = p_conversacion;

  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.whatsapp_registrar_entrante(UUID, TEXT, TEXT, TEXT, JSONB, BIGINT, TIMESTAMPTZ) IS
  'Guarda el mensaje de la persona y con él ABRE y REINICIA la ventana de 24 horas. Idempotente por wamid, porque Meta reintenta.';
REVOKE ALL ON FUNCTION public.whatsapp_registrar_entrante(UUID, TEXT, TEXT, TEXT, JSONB, BIGINT, TIMESTAMPTZ) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 17. `whatsapp_encolar()` — la única puerta de salida
-- ──────────────────────────────────────────────────────────────────────────────
-- Todo mensaje del bot pasa por aquí, y aquí pasa por el portero. No hay otra
-- forma de escribir en `crm_mensajes` con `direccion = 'SALIENTE'` que valga:
-- la RLS no concede INSERT a nadie, así que el camino es esta función.
--
-- Idempotente por `p_id`, que lo genera quien llama: el trabajador de entrada
-- puede reintentar el mismo evento y no se debe duplicar la respuesta.
--
-- `p_prioridad` es INT y no SMALLINT porque supabase-js manda los números como
-- enteros y PostgreSQL no resuelve la sobrecarga: con SMALLINT la llamada falla
-- con «function does not exist». Se recorta a smallint al insertar.
DROP FUNCTION IF EXISTS public.whatsapp_encolar(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TEXT, SMALLINT, TIMESTAMPTZ, BOOLEAN, UUID, UUID, UUID, TIME, TIME, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION public.whatsapp_encolar(
  p_conversacion   UUID,
  p_tipo           TEXT        DEFAULT 'TEXTO',
  p_texto          TEXT        DEFAULT NULL,
  p_payload        JSONB       DEFAULT '{}'::jsonb,
  p_iniciado_por   TEXT        DEFAULT 'BOT',
  p_plantilla      TEXT        DEFAULT NULL,
  p_variables      JSONB       DEFAULT NULL,
  p_consentimiento TEXT        DEFAULT NULL,
  p_prioridad      INT         DEFAULT 5,
  p_programado     TIMESTAMPTZ DEFAULT NULL,
  p_emergencia     BOOLEAN     DEFAULT false,
  p_emergencia_por UUID        DEFAULT NULL,
  p_visita         UUID        DEFAULT NULL,
  p_id             UUID        DEFAULT NULL,
  p_jornada_desde  TIME        DEFAULT '06:00',
  p_jornada_hasta  TIME        DEFAULT '20:00',
  p_margen_horas   NUMERIC     DEFAULT 23,
  p_zona           TEXT        DEFAULT 'America/Bogota'
) RETURNS crm_mensajes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila   crm_mensajes;
  v_conv   RECORD;
  v_dic    JSONB;
  v_estado TEXT;
  v_id     UUID := COALESCE(p_id, gen_random_uuid());
  v_tipo   TEXT := upper(COALESCE(p_tipo, 'TEXTO'));
BEGIN
  SELECT * INTO v_fila FROM public.crm_mensajes WHERE id = v_id;
  IF FOUND THEN RETURN v_fila; END IF;

  SELECT c.cuenta_id, c.grupo_id, c.persona_id INTO v_conv
    FROM public.crm_conversaciones c WHERE c.id = p_conversacion;
  IF NOT FOUND THEN RAISE EXCEPTION 'La conversación no existe.'; END IF;

  IF COALESCE(p_emergencia, false) AND p_emergencia_por IS NULL THEN
    RAISE EXCEPTION 'Un envío de emergencia tiene que decir quién lo autorizó: lo exige la Ley 2191 de 2022.';
  END IF;

  IF p_plantilla IS NOT NULL THEN v_tipo := 'PLANTILLA'; END IF;

  v_dic := public.whatsapp_portero(
    p_conversacion, p_iniciado_por, p_plantilla, p_consentimiento,
    COALESCE(p_emergencia, false), NOW(), p_jornada_desde, p_jornada_hasta,
    p_margen_horas, p_zona);
  v_estado := v_dic ->> 'estado';

  INSERT INTO public.crm_mensajes (
    id, conversacion_id, cuenta_id, direccion, tipo, texto, payload, estado,
    iniciado_por, es_plantilla, plantilla_id, plantilla_nombre, plantilla_variables,
    consentimiento, prioridad, programado_para, omitido_motivo, visita_id,
    emergencia, emergencia_por
  ) VALUES (
    v_id, p_conversacion, v_conv.cuenta_id, 'SALIENTE', v_tipo,
    NULLIF(btrim(p_texto), ''), COALESCE(p_payload, '{}'::jsonb), v_estado,
    upper(COALESCE(p_iniciado_por, 'BOT')), p_plantilla IS NOT NULL,
    NULLIF(v_dic ->> 'plantilla_id', '')::uuid, lower(NULLIF(btrim(p_plantilla), '')),
    p_variables, upper(NULLIF(btrim(p_consentimiento), '')),
    GREATEST(LEAST(COALESCE(p_prioridad, 5), 9), 1)::smallint, p_programado,
    CASE WHEN v_estado LIKE 'OMITIDO%' THEN v_dic ->> 'motivo' END,
    COALESCE(p_visita, (SELECT visita_id FROM public.crm_conversaciones WHERE id = p_conversacion)),
    COALESCE(p_emergencia, false), p_emergencia_por
  ) RETURNING * INTO v_fila;

  -- Lo que no se manda se registra. Es lo que el supervisor recoge después.
  IF v_estado LIKE 'OMITIDO%' THEN
    INSERT INTO public.ronda_eventos (
      grupo_id, entidad, entidad_id, accion, actor_tipo, actor_persona_id,
      canal, detalle)
    VALUES (v_conv.grupo_id, 'crm_mensajes', v_fila.id, v_estado, 'BOT',
            v_conv.persona_id, 'WHATSAPP',
            jsonb_build_object('motivo', v_dic ->> 'motivo', 'portero', v_dic,
                               'tipo', v_tipo, 'plantilla', p_plantilla));
  END IF;

  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.whatsapp_encolar(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TEXT, INT, TIMESTAMPTZ, BOOLEAN, UUID, UUID, UUID, TIME, TIME, NUMERIC, TEXT) IS
  'La ÚNICA puerta de salida: encola un mensaje del bot después de pasarlo por el portero (bloqueo, plantilla, ventana, jornada, consentimiento). Lo que no pasa nace OMITIDO_* con su motivo y queda registrado en ronda_eventos, no se descarta. Idempotente por p_id.';
REVOKE ALL ON FUNCTION public.whatsapp_encolar(UUID, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TEXT, INT, TIMESTAMPTZ, BOOLEAN, UUID, UUID, UUID, TIME, TIME, NUMERIC, TEXT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 18. La cola de salida: tomar, marcar enviado, marcar fallido
-- ──────────────────────────────────────────────────────────────────────────────
-- `whatsapp_salida_tomar()` hace tres cosas, y la tercera es la importante:
--   1. devuelve a PENDIENTE lo que lleva más de 5 minutos EN_PROCESO (huérfano);
--   2. reclama un lote por prioridad y antigüedad, con FOR UPDATE SKIP LOCKED;
--   3. VUELVE A PASAR CADA FILA POR EL PORTERO. Un mensaje programado para las
--      19:55 que sale a las 20:05 ya está fuera de jornada, y un mensaje libre
--      encolado hace 23 horas ya está fuera de ventana. La §4.4 del complemento
--      lo exige: el bloqueo se aplica «al encolar y al enviar».
CREATE OR REPLACE FUNCTION public.whatsapp_salida_tomar(
  p_cuenta        UUID        DEFAULT NULL,
  p_limite        INT         DEFAULT 50,
  p_jornada_desde TIME        DEFAULT '06:00',
  p_jornada_hasta TIME        DEFAULT '20:00',
  p_margen_horas  NUMERIC     DEFAULT 23,
  p_zona          TEXT        DEFAULT 'America/Bogota'
) RETURNS SETOF crm_mensajes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m   crm_mensajes;
  v_dic JSONB;
BEGIN
  UPDATE public.crm_mensajes
     SET estado = 'PENDIENTE', tomado_at = NULL
   WHERE direccion = 'SALIENTE' AND estado = 'EN_PROCESO'
     AND tomado_at < NOW() - INTERVAL '5 minutes';

  FOR v_m IN
    WITH lote AS (
      SELECT m.id FROM public.crm_mensajes m
       WHERE m.direccion = 'SALIENTE' AND m.estado = 'PENDIENTE'
         AND (p_cuenta IS NULL OR m.cuenta_id = p_cuenta)
         AND COALESCE(m.programado_para, m.created_at) <= NOW()
         AND COALESCE(m.proximo_intento_at, m.created_at) <= NOW()
       ORDER BY m.prioridad, COALESCE(m.programado_para, m.created_at), m.created_at
       LIMIT GREATEST(COALESCE(p_limite, 50), 1)
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.crm_mensajes m
       SET estado = 'EN_PROCESO', tomado_at = NOW()
     WHERE m.id IN (SELECT id FROM lote)
    RETURNING m.*
  LOOP
    v_dic := public.whatsapp_portero(
      v_m.conversacion_id, v_m.iniciado_por, v_m.plantilla_nombre,
      v_m.consentimiento, v_m.emergencia, NOW(),
      p_jornada_desde, p_jornada_hasta, p_margen_horas, p_zona);

    IF (v_dic ->> 'estado') = 'PENDIENTE' THEN
      RETURN NEXT v_m;
    ELSE
      UPDATE public.crm_mensajes
         SET estado = v_dic ->> 'estado', omitido_motivo = v_dic ->> 'motivo', tomado_at = NULL
       WHERE id = v_m.id;
      INSERT INTO public.ronda_eventos (entidad, entidad_id, accion, actor_tipo, canal, detalle)
      VALUES ('crm_mensajes', v_m.id, v_dic ->> 'estado', 'BOT', 'WHATSAPP',
              jsonb_build_object('motivo', v_dic ->> 'motivo', 'momento', 'ENVIO', 'portero', v_dic));
    END IF;
  END LOOP;
END $$;
COMMENT ON FUNCTION public.whatsapp_salida_tomar(UUID, INT, TIME, TIME, NUMERIC, TEXT) IS
  'Reclama el lote a enviar, por prioridad y antigüedad, y vuelve a pasar cada fila por el portero: un mensaje programado puede quedar fuera de jornada o fuera de ventana entre el encolado y el envío, y la §4.4 del complemento 2 exige el control en los dos momentos.';
REVOKE ALL ON FUNCTION public.whatsapp_salida_tomar(UUID, INT, TIME, TIME, NUMERIC, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_salida_enviado(
  p_mensaje UUID,
  p_wamid   TEXT DEFAULT NULL,
  p_estado  TEXT DEFAULT 'ENVIADO'
) RETURNS crm_mensajes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fila crm_mensajes;
BEGIN
  UPDATE public.crm_mensajes
     SET estado = upper(COALESCE(p_estado, 'ENVIADO')),
         wamid = COALESCE(NULLIF(btrim(p_wamid), ''), wamid),
         enviado_at = NOW(), tomado_at = NULL, error = NULL, error_codigo = NULL,
         intentos = intentos + 1
   WHERE id = p_mensaje
  RETURNING * INTO v_fila;
  IF NOT FOUND THEN RAISE EXCEPTION 'El mensaje % no existe.', p_mensaje; END IF;

  UPDATE public.crm_conversaciones
     SET ultimo_saliente_at = NOW(), mensajes_salientes = mensajes_salientes + 1
   WHERE id = v_fila.conversacion_id;
  RETURN v_fila;
END $$;
REVOKE ALL ON FUNCTION public.whatsapp_salida_enviado(UUID, TEXT, TEXT) FROM PUBLIC;

-- Retroceso por fila: 1 min, 5, 15, 1 h, 6 h. A los 5 fallos queda FALLIDO.
-- `130429` es el límite de caudal y NO cuenta como fallo del mensaje: se vuelve
-- a encolar enseguida, porque el problema es el ritmo, no el contenido.
-- `190` (token inválido) deja el mensaje EN_ESPERA_CREDENCIAL: la cola se
-- DETIENE, no se descarta, y en la consola sale el botón de reconectar.
CREATE OR REPLACE FUNCTION public.whatsapp_salida_fallido(
  p_mensaje UUID,
  p_codigo  TEXT DEFAULT NULL,
  p_error   TEXT DEFAULT 'Error de envío'
) RETURNS crm_mensajes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila crm_mensajes;
  v_int  SMALLINT;
  v_cod  TEXT := NULLIF(btrim(p_codigo), '');
BEGIN
  SELECT intentos INTO v_int FROM public.crm_mensajes WHERE id = p_mensaje;
  IF NOT FOUND THEN RAISE EXCEPTION 'El mensaje % no existe.', p_mensaje; END IF;

  UPDATE public.crm_mensajes
     SET estado = CASE
           WHEN v_cod = '190' THEN 'EN_ESPERA_CREDENCIAL'
           WHEN v_cod = '130429' THEN 'PENDIENTE'
           WHEN v_int >= 5 THEN 'FALLIDO'
           ELSE 'PENDIENTE' END,
         intentos = CASE WHEN v_cod IN ('130429','190') THEN intentos ELSE intentos + 1 END,
         tomado_at = NULL,
         error_codigo = v_cod,
         error = COALESCE(NULLIF(btrim(p_error), ''), 'Error de envío'),
         proximo_intento_at = CASE
           WHEN v_cod = '130429' THEN NOW() + INTERVAL '10 seconds'
           WHEN v_cod = '190'    THEN NULL
           WHEN v_int >= 5       THEN NULL
           ELSE NOW() + (ARRAY['1 minute','5 minutes','15 minutes','1 hour','6 hours']::interval[])[LEAST(GREATEST(v_int,0) + 1, 5)]
         END
   WHERE id = p_mensaje
  RETURNING * INTO v_fila;
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.whatsapp_salida_fallido(UUID, TEXT, TEXT) IS
  'Marca el fallo con retroceso 1 min / 5 / 15 / 1 h / 6 h. El 130429 (caudal) NO gasta intento y se reencola en 10 s, porque el problema es el ritmo y no el mensaje. El 190 (token inválido) deja EN_ESPERA_CREDENCIAL: la cola se detiene y no se descarta.';
REVOKE ALL ON FUNCTION public.whatsapp_salida_fallido(UUID, TEXT, TEXT) FROM PUBLIC;

-- `statuses` de Meta: sent → delivered → read. Idempotente por diseño y NUNCA
-- retrocede: un `sent` que llega tarde no desmarca un `read`.
CREATE OR REPLACE FUNCTION public.whatsapp_estado_entrega(
  p_wamid   TEXT,
  p_estado  TEXT,
  p_momento TIMESTAMPTZ DEFAULT NOW(),
  p_codigo  TEXT DEFAULT NULL,
  p_error   TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rank  INT;
  v_act   INT;
  v_id    UUID;
  v_est   TEXT := upper(COALESCE(p_estado, ''));
  v_orden TEXT[] := ARRAY['PENDIENTE','EN_PROCESO','ENVIADO','ENTREGADO','LEIDO'];
BEGIN
  SELECT id, array_position(v_orden, estado) INTO v_id, v_act
    FROM public.crm_mensajes WHERE wamid = btrim(p_wamid) AND direccion = 'SALIENTE';
  IF v_id IS NULL THEN RETURN false; END IF;

  IF v_est = 'FAILED' THEN
    PERFORM public.whatsapp_salida_fallido(v_id, p_codigo, COALESCE(p_error, 'Meta reportó failed'));
    RETURN true;
  END IF;

  v_est := CASE v_est WHEN 'SENT' THEN 'ENVIADO' WHEN 'DELIVERED' THEN 'ENTREGADO'
                      WHEN 'READ' THEN 'LEIDO' ELSE v_est END;
  v_rank := array_position(v_orden, v_est);
  IF v_rank IS NULL OR COALESCE(v_act, 0) >= v_rank THEN RETURN false; END IF;

  UPDATE public.crm_mensajes
     SET estado = v_est,
         entregado_at = CASE WHEN v_est IN ('ENTREGADO','LEIDO')
                             THEN COALESCE(entregado_at, p_momento) ELSE entregado_at END,
         leido_at = CASE WHEN v_est = 'LEIDO' THEN COALESCE(leido_at, p_momento) ELSE leido_at END
   WHERE id = v_id;
  RETURN true;
END $$;
COMMENT ON FUNCTION public.whatsapp_estado_entrega(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Aplica un `statuses` de Meta (sent / delivered / read / failed) al mensaje saliente. NUNCA retrocede: un `sent` que llega desordenado no desmarca un `read`.';
REVOKE ALL ON FUNCTION public.whatsapp_estado_entrega(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 19. `crm_conversacion_avanzar()` — la transición, con su rastro
-- ──────────────────────────────────────────────────────────────────────────────
-- Cada transición escribe en `ronda_eventos` (la auditoría encadenada de F2):
-- estado anterior, estado nuevo, qué lo disparó y con qué wamid. Es la prueba de
-- qué vio y qué tocó la persona.
DROP FUNCTION IF EXISTS public.crm_conversacion_avanzar(UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ, UUID, UUID, SMALLINT, TEXT);
CREATE OR REPLACE FUNCTION public.crm_conversacion_avanzar(
  p_conversacion UUID,
  p_estado       TEXT,
  p_disparador   TEXT        DEFAULT NULL,
  p_contexto     JSONB       DEFAULT NULL,
  p_espera_vence TIMESTAMPTZ DEFAULT NULL,
  p_visita       UUID        DEFAULT NULL,
  p_punto        UUID        DEFAULT NULL,
  p_intentos     INT         DEFAULT NULL,
  p_wamid        TEXT        DEFAULT NULL
) RETURNS crm_conversaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ant   TEXT;
  v_fila  crm_conversaciones;
  -- Escalares y no un RECORD: plpgsql evalúa la expresión completa del UPDATE,
  -- así que tocar `v_pto.grupo_id` cuando no se buscó ningún punto revienta con
  -- «record is not assigned yet» aunque el COALESCE nunca use ese lado.
  v_grupo UUID;
  v_sede  UUID;
BEGIN
  SELECT estado INTO v_ant FROM public.crm_conversaciones WHERE id = p_conversacion;
  IF v_ant IS NULL THEN RAISE EXCEPTION 'La conversación no existe.'; END IF;

  -- Al identificar el punto, el contrato y la sede de la conversación son los
  -- del punto: desnormalizados porque la RLS filtra por esa columna.
  IF p_punto IS NOT NULL THEN
    SELECT p.grupo_id, p.sede_id INTO v_grupo, v_sede
      FROM public.ronda_puntos p WHERE p.id = p_punto;
  END IF;

  UPDATE public.crm_conversaciones
     SET estado = upper(p_estado),
         estado_desde = CASE WHEN estado <> upper(p_estado) THEN NOW() ELSE estado_desde END,
         contexto = COALESCE(p_contexto, contexto),
         espera_vence_at = p_espera_vence,
         visita_id = COALESCE(p_visita, visita_id),
         punto_id = COALESCE(p_punto, punto_id),
         grupo_id = COALESCE(v_grupo, grupo_id),
         sede_id = COALESCE(v_sede, sede_id),
         intentos = COALESCE(p_intentos::smallint, CASE WHEN estado <> upper(p_estado) THEN 0 ELSE intentos END)
   WHERE id = p_conversacion
  RETURNING * INTO v_fila;

  INSERT INTO public.ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_persona_id,
    actor_nombre, canal, detalle)
  VALUES (
    v_fila.grupo_id, v_fila.sede_id, 'crm_conversaciones', v_fila.id,
    upper(p_estado), 'BOT', v_fila.persona_id, v_fila.perfil_nombre, 'WHATSAPP',
    jsonb_build_object('estado_anterior', v_ant, 'estado_nuevo', upper(p_estado),
                       'disparador', p_disparador, 'wamid', p_wamid,
                       'visita_id', v_fila.visita_id, 'punto_id', v_fila.punto_id,
                       'intentos', v_fila.intentos));
  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.crm_conversacion_avanzar(UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ, UUID, UUID, INT, TEXT) IS
  'Mueve la conversación de estado y deja el rastro en `ronda_eventos`: estado anterior, estado nuevo, qué lo disparó y con qué wamid. Es la prueba de qué vio y qué tocó la persona.';
REVOKE ALL ON FUNCTION public.crm_conversacion_avanzar(UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ, UUID, UUID, INT, TEXT) FROM PUBLIC;

-- `whatsapp_vencidos()` — los temporizadores de la §4, para el cron de cada
-- minuto. Un estado FINAL no vence: ya terminó.
CREATE OR REPLACE FUNCTION public.whatsapp_vencidos(p_limite INT DEFAULT 100)
RETURNS SETOF crm_conversaciones
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.* FROM public.crm_conversaciones c
   WHERE c.espera_vence_at IS NOT NULL AND c.espera_vence_at <= NOW()
     AND c.estado NOT IN ('CERRADA','CERRADA_CON_NOVEDAD','CANCELADA','EXPIRADA','SIN_VISITA')
   ORDER BY c.espera_vence_at
   LIMIT GREATEST(COALESCE(p_limite, 100), 1)
$$;
COMMENT ON FUNCTION public.whatsapp_vencidos(INT) IS
  'Conversaciones cuyo temporizador ya pasó, para el cron de vencimientos. Un estado final no vence.';
REVOKE ALL ON FUNCTION public.whatsapp_vencidos(INT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 19.bis `whatsapp_puntos_del_dia()` — la lista de «MIS PUNTOS»
-- ──────────────────────────────────────────────────────────────────────────────
-- Se resuelve EN SQL y no trayendo filas al servidor, por la razón de siempre:
-- Supabase corta a los 8 segundos y esta consulta cruza asignaciones, puntos y
-- visitas. Y se limita a 10 filas porque una lista de WhatsApp admite 10 EN
-- TOTAL: pedir más sería traer lo que no se puede mostrar.
--
-- Qué cuenta como «mi punto»: una asignación activa y vigente hoy, del día de
-- la semana de hoy, en la sede de la persona, asignada a ella por nombre o sin
-- responsable concreto (las que son del puesto, no de alguien). El estado sale
-- de si ya hay una visita de HOY en ese punto.
CREATE OR REPLACE FUNCTION public.whatsapp_puntos_del_dia(
  p_persona UUID,
  p_momento TIMESTAMPTZ DEFAULT NOW(),
  p_zona    TEXT DEFAULT 'America/Bogota',
  p_limite  INT DEFAULT 10
) RETURNS TABLE (
  punto_id    UUID,
  codigo      VARCHAR,
  nombre      VARCHAR,
  sede_nombre TEXT,
  estado      TEXT,
  orden       SMALLINT,
  desde       TIME
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH hoy AS (
    SELECT (p_momento AT TIME ZONE p_zona)::date       AS dia,
           EXTRACT(ISODOW FROM (p_momento AT TIME ZONE p_zona))::smallint AS dow
  ), mias AS (
    SELECT DISTINCT a.punto_id, MIN(a.ventana_desde) AS desde
      FROM public.ronda_asignaciones a
      JOIN public.personas pe ON pe.id = p_persona
      CROSS JOIN hoy h
     WHERE a.activo
       AND a.sede_id = pe.sede_id
       AND (a.persona_id = p_persona OR a.persona_id IS NULL)
       AND h.dow = ANY(a.dias)
       AND (a.vigente_desde IS NULL OR a.vigente_desde <= h.dia)
       AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= h.dia)
     GROUP BY a.punto_id
  )
  SELECT p.id, p.codigo, p.nombre,
         COALESCE(s.nombre, p.sede_nombre)::text,
         COALESCE((
           SELECT CASE WHEN v.estado IN ('COMPLETADA','INCOMPLETA') THEN 'CERRADO' ELSE 'EN_CURSO' END
             FROM public.ronda_visitas v
            WHERE v.punto_id = p.id AND v.persona_id = p_persona
              AND (v.inicio_servidor AT TIME ZONE p_zona)::date = (SELECT dia FROM hoy)
            ORDER BY v.inicio_servidor DESC LIMIT 1
         ), 'PENDIENTE')::text,
         p.orden, m.desde
    FROM mias m
    JOIN public.ronda_puntos p ON p.id = m.punto_id AND p.estado = 'ACTIVO'
    LEFT JOIN public.sedes s ON s.id = p.sede_id
   WHERE public.grupo_vigente(p.grupo_id)
   ORDER BY m.desde NULLS LAST, p.orden NULLS LAST, p.codigo
   LIMIT GREATEST(COALESCE(p_limite, 10), 1)
$$;
COMMENT ON FUNCTION public.whatsapp_puntos_del_dia(UUID, TIMESTAMPTZ, TEXT, INT) IS
  'Los puntos que le toca visitar hoy a una persona, con su estado (PENDIENTE · EN_CURSO · CERRADO). Resuelto en SQL y limitado a 10 filas, que es lo que admite una lista de WhatsApp EN TOTAL. Lo reutiliza F10 para «próxima ubicación».';
REVOKE ALL ON FUNCTION public.whatsapp_puntos_del_dia(UUID, TIMESTAMPTZ, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_puntos_del_dia(UUID, TIMESTAMPTZ, TEXT, INT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 20. Vistas de tablero — contar en SQL, nunca traer filas
-- ──────────────────────────────────────────────────────────────────────────────
-- Supabase corta las consultas a los 8 segundos. Un tablero que trae las filas
-- para contarlas en JavaScript es un tablero que un día deja de cargar.
CREATE OR REPLACE VIEW whatsapp_resumen_cola AS
SELECT
  m.cuenta_id,
  COUNT(*) FILTER (WHERE m.estado = 'PENDIENTE')              AS pendientes,
  COUNT(*) FILTER (WHERE m.estado = 'EN_PROCESO')             AS en_proceso,
  COUNT(*) FILTER (WHERE m.estado IN ('ENVIADO','ENTREGADO','LEIDO','SIMULADO')) AS salieron,
  COUNT(*) FILTER (WHERE m.estado = 'FALLIDO')                AS fallidos,
  COUNT(*) FILTER (WHERE m.estado = 'EN_ESPERA_CREDENCIAL')   AS sin_credencial,
  COUNT(*) FILTER (WHERE m.estado = 'OMITIDO_VENTANA')        AS omitidos_ventana,
  COUNT(*) FILTER (WHERE m.estado = 'OMITIDO_JORNADA')        AS omitidos_jornada,
  COUNT(*) FILTER (WHERE m.estado = 'OMITIDO_CONSENTIMIENTO') AS omitidos_consentimiento,
  COUNT(*) FILTER (WHERE m.estado = 'OMITIDO_PLANTILLA')      AS omitidos_plantilla,
  COUNT(*) FILTER (WHERE m.estado = 'OMITIDO_BLOQUEADO')      AS omitidos_bloqueado,
  MIN(COALESCE(m.programado_para, m.created_at)) FILTER (WHERE m.estado = 'PENDIENTE') AS espera_desde
FROM crm_mensajes m
WHERE m.direccion = 'SALIENTE'
GROUP BY m.cuenta_id;

COMMENT ON VIEW whatsapp_resumen_cola IS
  'Estado de la cola de salida por cuenta, contado en SQL. Supabase corta a los 8 segundos: un tablero que trae las filas para contarlas en JavaScript es un tablero que deja de cargar.';

CREATE OR REPLACE VIEW whatsapp_resumen_conversaciones AS
SELECT
  c.cuenta_id,
  c.grupo_id,
  c.estado,
  COUNT(*)                                                           AS conversaciones,
  COUNT(*) FILTER (WHERE c.persona_id IS NULL)                       AS sin_identificar,
  COUNT(*) FILTER (WHERE c.bloqueada)                                AS bloqueadas,
  COUNT(*) FILTER (WHERE c.ventana_vence_at > NOW())                 AS con_ventana,
  COUNT(*) FILTER (WHERE c.espera_vence_at IS NOT NULL
                     AND c.espera_vence_at <= NOW())                 AS vencidas,
  MAX(c.updated_at)                                                  AS ultimo_movimiento
FROM crm_conversaciones c
GROUP BY c.cuenta_id, c.grupo_id, c.estado;

COMMENT ON VIEW whatsapp_resumen_conversaciones IS
  'Conversaciones agrupadas por cuenta, contrato y estado de la máquina, contadas en SQL.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 21. RLS
-- ──────────────────────────────────────────────────────────────────────────────
-- `auth_permiso()` TAMBIÉN en las lecturas, que es la regla del repositorio.
-- Y alcance por contrato con `auth_ve_grupo()` donde el contrato se sabe.
--
-- Las escrituras NO tienen política: entran por las funciones SECURITY DEFINER
-- de arriba, llamadas desde un route handler con la llave de servicio. Es el
-- mismo patrón de /q/<token> y de /api/campo/rpc, y es lo que garantiza que el
-- portero no se pueda saltar: no hay otra puerta.
ALTER TABLE whatsapp_cuentas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_credenciales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_plantillas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_excepciones_jornada  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_eventos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_eventos_rechazados   ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_conversaciones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_mensajes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_medios               ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_cuentas_read ON whatsapp_cuentas;
CREATE POLICY whatsapp_cuentas_read ON whatsapp_cuentas
  FOR SELECT TO authenticated
  USING (public.whatsapp_acceso() OR public.whatsapp_conecta());

-- `whatsapp_credenciales`: RLS activa y NINGUNA política, a propósito. Un token
-- de Meta no lo lee un usuario de la consola ni para mirarlo: lo lee el
-- servidor con la llave de servicio, que se salta la RLS. Si algún día hace
-- falta mostrar el estado del token en pantalla, se expone una VISTA sin el
-- ciphertext, no esta tabla.
COMMENT ON TABLE whatsapp_credenciales IS
  'Tokens de Meta, cifrados. RLS ACTIVA Y SIN NINGUNA POLÍTICA a propósito: `authenticated` no lee nada de aquí. Solo el servidor con la llave de servicio. Para mostrar el estado del token en pantalla se expone una vista sin el ciphertext, nunca esta tabla.';

DROP POLICY IF EXISTS whatsapp_plantillas_read ON whatsapp_plantillas;
CREATE POLICY whatsapp_plantillas_read ON whatsapp_plantillas
  FOR SELECT TO authenticated
  USING (public.whatsapp_acceso()
         AND (grupo_id IS NULL OR public.auth_ve_grupo(grupo_id)));

DROP POLICY IF EXISTS whatsapp_excep_read ON whatsapp_excepciones_jornada;
CREATE POLICY whatsapp_excep_read ON whatsapp_excepciones_jornada
  FOR SELECT TO authenticated USING (public.whatsapp_gestiona());

DROP POLICY IF EXISTS whatsapp_eventos_read ON whatsapp_eventos;
CREATE POLICY whatsapp_eventos_read ON whatsapp_eventos
  FOR SELECT TO authenticated USING (public.whatsapp_gestiona());

DROP POLICY IF EXISTS whatsapp_rechazados_read ON whatsapp_eventos_rechazados;
CREATE POLICY whatsapp_rechazados_read ON whatsapp_eventos_rechazados
  FOR SELECT TO authenticated USING (public.whatsapp_gestiona());

-- Una conversación sin contrato conocido (el número que todavía no se identificó)
-- la ve solo quien gestiona: no hay alcance con el que filtrarla.
DROP POLICY IF EXISTS crm_conversaciones_read ON crm_conversaciones;
CREATE POLICY crm_conversaciones_read ON crm_conversaciones
  FOR SELECT TO authenticated
  USING (public.whatsapp_acceso()
         AND (CASE WHEN grupo_id IS NULL THEN public.whatsapp_gestiona()
                   ELSE public.auth_ve_grupo(grupo_id) END));

DROP POLICY IF EXISTS crm_mensajes_read ON crm_mensajes;
CREATE POLICY crm_mensajes_read ON crm_mensajes
  FOR SELECT TO authenticated
  USING (public.whatsapp_acceso() AND EXISTS (
    SELECT 1 FROM public.crm_conversaciones c
     WHERE c.id = crm_mensajes.conversacion_id
       AND (CASE WHEN c.grupo_id IS NULL THEN public.whatsapp_gestiona()
                 ELSE public.auth_ve_grupo(c.grupo_id) END)));

DROP POLICY IF EXISTS whatsapp_medios_read ON whatsapp_medios;
CREATE POLICY whatsapp_medios_read ON whatsapp_medios
  FOR SELECT TO authenticated
  USING (public.whatsapp_acceso() AND EXISTS (
    SELECT 1 FROM public.crm_conversaciones c
     WHERE c.id = whatsapp_medios.conversacion_id
       AND (CASE WHEN c.grupo_id IS NULL THEN public.whatsapp_gestiona()
                 ELSE public.auth_ve_grupo(c.grupo_id) END)));

-- Las vistas heredan la RLS de sus tablas, pero hay que poder leerlas.
GRANT SELECT ON whatsapp_resumen_cola TO authenticated;
GRANT SELECT ON whatsapp_resumen_conversaciones TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 22. El catálogo de plantillas de la §8 del ADR-01
-- ──────────────────────────────────────────────────────────────────────────────
-- Las diez, con sus textos en `es_CO`, todas en `PENDIENTE` porque ninguna se ha
-- presentado a Meta todavía. El portero las salta y registra OMITIDO_PLANTILLA
-- hasta que alguien las cree en el Business Manager y marque APPROVED aquí.
--
-- TODOS los nombres propios de los ejemplos son FICTICIOS: este repositorio es
-- público. Y ninguna es MARKETING: el CHECK de la tabla no lo permite.
INSERT INTO whatsapp_plantillas (nombre, categoria, idioma, encabezado, cuerpo, pie, botones, variables, proposito)
VALUES
  ('visita_pendiente_cierre', 'UTILITY', 'es_CO',
   'Visita sin cerrar',
   'Hola {{1}}. Quedó sin cerrar la visita del punto {{2}} — {{3}}, del {{4}}. ¿La retomamos para dejar el reporte completo?',
   'Si ya no aplica, tocá No retomar.',
   '[{"tipo":"RESPUESTA","texto":"Retomar visita"},{"tipo":"RESPUESTA","texto":"No retomar"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"K7M-4QX9"},{"pos":3,"ejemplo":"Portería principal"},{"pos":4,"ejemplo":"18 de octubre"}]'::jsonb,
   'Reabrir la conversación para terminar una visita que quedó a medias, siempre DENTRO de la jornada.'),

  ('ronda_asignada_hoy', 'UTILITY', 'es_CO',
   'Tu ronda de hoy',
   'Hola {{1}}. Hoy tenés {{2}} puntos en {{3}}, desde las {{4}}. Escribí MIS PUNTOS para verlos, o escaneá el QR del punto donde estés.',
   'Asistente de rondas',
   '[{"tipo":"RESPUESTA","texto":"Ver mis puntos"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"6"},{"pos":3,"ejemplo":"Conjunto Ejemplo"},{"pos":4,"ejemplo":"06:00"}]'::jsonb,
   'Avisar la ronda del día al empezar el turno.'),

  ('punto_asignado_nuevo', 'UTILITY', 'es_CO', NULL,
   '{{1}}, se agregó un punto a tu ronda de hoy: {{2}} — {{3}}. Sugerido para las {{4}}.',
   NULL,
   '[{"tipo":"RESPUESTA","texto":"Ver mis puntos"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"A1B-2C3D"},{"pos":3,"ejemplo":"Parqueadero sótano 1"},{"pos":4,"ejemplo":"10:30"}]'::jsonb,
   'Se agregó o cambió un punto de su ronda.'),

  ('visita_resumen_cierre', 'UTILITY', 'es_CO',
   'Reporte de tu visita',
   'Listo {{1}}: el punto {{2}} quedó cerrado con reporte {{3}}. Tareas hechas: {{4}}. Novedades: {{5}}.',
   'Gracias por tu trabajo.',
   '[{"tipo":"URL","texto":"Ver reporte"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"K7M-4QX9"},{"pos":3,"ejemplo":"RV-000147"},{"pos":4,"ejemplo":"3 de 4"},{"pos":5,"ejemplo":"1"}]'::jsonb,
   'Mandar el reporte cuando ya se cerró la ventana de 24 h.'),

  ('novedad_asignada_supervisor', 'UTILITY', 'es_CO',
   'Novedad para revisar',
   '{{1}}, entró una novedad en {{2}} — {{3}}: {{4}}. Ticket {{5}}.',
   NULL,
   '[{"tipo":"URL","texto":"Abrir ticket"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Camilo"},{"pos":2,"ejemplo":"Conjunto Ejemplo"},{"pos":3,"ejemplo":"Portería principal"},{"pos":4,"ejemplo":"Bombillo quemado"},{"pos":5,"ejemplo":"TK-10452"}]'::jsonb,
   'Avisarle a un supervisor que le llegó una novedad.'),

  ('novedad_respuesta_supervisor', 'UTILITY', 'es_CO', NULL,
   '{{1}}, tu novedad "{{2}}" del punto {{3}} pasó a {{4}}. {{5}}',
   NULL,
   '[{"tipo":"URL","texto":"Ver detalle"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"Bombillo quemado"},{"pos":3,"ejemplo":"K7M-4QX9"},{"pos":4,"ejemplo":"En compras"},{"pos":5,"ejemplo":"Llega el material el lunes."}]'::jsonb,
   'Contarle al conserje que su novedad avanzó.'),

  ('consentimiento_inicial', 'UTILITY', 'es_CO',
   'Asistente de rondas',
   'Hola {{1}}. Soy el asistente de rondas de {{2}}. Para empezar necesito tu permiso para pedirte ubicación, fotos y notas de voz durante las visitas. Te explico cada uno antes de usarlo.',
   'Podés revisar o retirar los permisos escribiendo PRIVACIDAD.',
   '[{"tipo":"RESPUESTA","texto":"Empezar"},{"tipo":"RESPUESTA","texto":"Más información"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"Conserjes Inmobiliarios"}]'::jsonb,
   'Primer contacto cuando no hay ventana abierta y hay que pedir permisos.'),

  ('vinculacion_numero_codigo', 'AUTHENTICATION', 'es_CO', NULL,
   '{{1}} es tu código para vincular un número nuevo al asistente de rondas. Vence en 10 minutos. Si no lo pediste, avisale a tu supervisor.',
   NULL,
   '[{"tipo":"COPIAR_CODIGO","texto":"Copiar código"}]'::jsonb,
   '[{"pos":1,"ejemplo":"472913"}]'::jsonb,
   'Segundo factor para vincular un número nuevo a una persona que ya tenía otro.'),

  ('agente_respuesta_pendiente', 'UTILITY', 'es_CO', NULL,
   '{{1}}, {{2}} te respondió sobre tu caso {{3}}. ¿Querés seguir la conversación por acá?',
   NULL,
   '[{"tipo":"RESPUESTA","texto":"Sí, continuar"},{"tipo":"RESPUESTA","texto":"Después"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"Tu supervisor"},{"pos":3,"ejemplo":"CS-2026-0088"}]'::jsonb,
   'Retomar un caso derivado a una persona cuando ya se cerró la ventana.'),

  ('recordatorio_punto_pendiente', 'UTILITY', 'es_CO', NULL,
   '{{1}}, te quedan {{2}} puntos de la ronda y tu turno termina a las {{3}}. ¿Seguimos con {{4}}?',
   NULL,
   '[{"tipo":"RESPUESTA","texto":"Sí, seguir"},{"tipo":"RESPUESTA","texto":"No alcanzo"}]'::jsonb,
   '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"2"},{"pos":3,"ejemplo":"14:00"},{"pos":4,"ejemplo":"A1B-2C3D"}]'::jsonb,
   'Punto de la ronda sin visitar faltando poco para el fin del turno, SOLO dentro de la jornada.')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 23. Permisos en los roles
-- ──────────────────────────────────────────────────────────────────────────────
-- `defaults || permisos`: lo que ya esté puesto gana, así que re-aplicar la
-- migración no revive un permiso que un administrador haya apagado a mano.
UPDATE public.roles
   SET permisos = jsonb_build_object('ver_whatsapp', true, 'gestionar_whatsapp', true) || permisos
 WHERE nombre IN ('Administrador', 'Gerencia', 'Supervisor de Conserjería');

-- `conectar_whatsapp` NO se reparte: conectar el número desvincula los
-- dispositivos acompañantes de quien usaba WhatsApp Web y deja el canal en
-- manos de quien lo haga. Se enciende a mano, a una persona, desde /roles.
UPDATE public.roles
   SET permisos = jsonb_build_object('conectar_whatsapp', true) || permisos
 WHERE nombre = 'Administrador';

-- Auditor: lee y no toca, el mismo criterio de PQRS y del catálogo de rondas.
UPDATE public.roles
   SET permisos = permisos || '{"ver_whatsapp": true}'::jsonb
 WHERE nombre = 'Auditor';

-- ──────────────────────────────────────────────────────────────────────────────
-- 24. Cuenta en modo simulador
-- ──────────────────────────────────────────────────────────────────────────────
-- Sin esta fila no hay dónde colgar una conversación, y el módulo entero
-- quedaría inarrancable hasta que alguien tenga credenciales de Meta. Nace en
-- `SIMULADOR` / `SIMULADA`: no puede mandar nada hacia un teléfono ni aunque
-- alguien se equivoque, porque el cliente de transporte mira esta columna.
INSERT INTO whatsapp_cuentas (alias, display_phone_number, nombre_visible, transporte,
                              estado, predeterminada, coexistencia, throughput_mps)
VALUES ('simulador', '+57 601 000 0000', 'Asistente de rondas (simulador)',
        'SIMULADOR', 'SIMULADA', true, true, 20)
ON CONFLICT (alias) DO NOTHING;

COMMENT ON COLUMN whatsapp_cuentas.alias IS
  'Nombre corto e interno de la cuenta («simulador», «operacion»). Es por el que la busca el código, para no depender de un phone_number_id que todavía no existe.';
