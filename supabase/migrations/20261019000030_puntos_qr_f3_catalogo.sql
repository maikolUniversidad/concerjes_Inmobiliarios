-- =============================================================================
-- PUNTOS QR — F3: CATÁLOGO PARAMETRIZABLE Y ASIGNACIONES
-- =============================================================================
-- Tercera fase del módulo de Puntos QR, Tareas y Bot de WhatsApp. Depende de
-- F1 (20261019000010_puntos_qr_f1_contrato.sql), de la que toma el eje
-- `grupo_id` y las funciones de alcance `auth_grupos()` / `auth_ve_grupo()` y
-- de vigencia `grupo_vigente()`. Va en paralelo con F2 (zonas, puntos y QR):
-- no comparten tablas.
--
-- Plan: docs/puntos-qr-whatsapp/00-exploracion-y-plan.md §2.3 y ADR-C,
-- docs/puntos-qr-whatsapp/02-complemento-2-integracion.md §2.4, §4.1 y §4.5,
-- y docs/puntos-qr-whatsapp/03-nomenclatura.md (que manda en los nombres).
--
-- Qué es esta fase: el TRABAJO, parametrizado. Qué actividades existen, cómo se
-- hace cada una paso a paso, con qué material se explica y dónde, cuándo y
-- quién tiene que hacerla. Nada de esto se ejecuta aquí: ejecutar es F4.
--
-- Qué entra:
--   1. `ronda_tipos_actividad` — catálogo plano, sembrado, no enum: limpieza,
--      desinfección, ronda de seguridad, extintor, medidor, basuras, baño y
--      novedad. Se agregan más DESDE LA CONSOLA, sin migración.
--   2. `ronda_instructivos` — el material que explica cómo se hace (foto,
--      video, PDF o audio), versionado, con idioma y duración, en el bucket
--      privado `rondas` y leído siempre con URL firmada corta (ADR-C).
--   3. `ronda_plantillas` — la actividad VERSIONADA. Las versiones son filas
--      distintas y, una vez publicadas, QUEDAN CONGELADAS: ni la plantilla ni
--      sus pasos se pueden tocar. Eso es lo que hace que publicar la versión 2
--      no mueva ni una respuesta guardada con la versión 1 (F4 guarda
--      `plantilla_id` y `paso_id`, que apuntan a filas inmutables).
--   4. `ronda_plantilla_pasos` — los pasos ordenados, con `config JSONB`
--      validado por CHECK según el tipo, y el PASO CONDICIONAL
--      (`condicion_paso_id` + `condicion_valor`).
--   5. `ronda_asignaciones` — qué plantilla aplica en qué punto, con qué
--      frecuencia, en qué ventana, con cuánta tolerancia, quién responde, con
--      qué prioridad y con qué ANS.
--   6. `ronda_tareas_aplicables(punto, momento, solo_ahora)` — la consulta que
--      responde «qué tareas aplican en este punto a esta hora y este día». Es
--      función de base de datos a propósito: la van a llamar la PWA (F4), el
--      bot de WhatsApp (F9) y la cola offline, y los tres tienen que obtener la
--      MISMA respuesta.
--
-- Permisos nuevos (catálogo en lib/permisos.ts, grupo Operación Conserjería):
--   ver_catalogo_rondas         ver tipos, plantillas, pasos e instructivos
--   gestionar_catalogo_rondas   crear, editar, publicar y versionar el catálogo
--   ver_asignaciones_rondas     ver qué tarea aplica en qué punto
--   gestionar_asignaciones_rondas  asignar plantillas a puntos
-- Son cuatro claves planas en snake_case, como exige §2 de la nomenclatura: una
-- clave con punto no existiría en /roles y `auth_permiso()` no la reconocería.
-- OJO con los parecidos de otros módulos: `gestionar_tipos_servicio` es de
-- Servicios del Hogar y `gestionar_rutas` es de Logística; ninguna sirve aquí.
--
-- RLS: en todo lo nuevo y TAMBIÉN EN LAS LECTURAS, con `auth_permiso*()`, como
-- exige este repositorio. El alcance de los CATÁLOGOS es «el contrato en
-- `auth_grupos()` O `grupo_id IS NULL`», porque NULL significa «aplica a todos
-- los contratos» (§2.4 del complemento 2); el de las asignaciones es solo
-- `auth_grupos()`, que ahí `grupo_id` es NOT NULL.
--
-- LO QUE NO ENTRA, A PROPÓSITO:
--   · El reto aleatorio durante la ejecución (C1§3). El complemento 1 no ha
--     llegado y §7 del complemento 2 explica por qué no se nombra: fijar ahora
--     un tipo de paso o un campo de resultado obligaría a adivinar un formato
--     que C1 puede contradecir. NO hay tipo de paso `RETO` ni columna para él.
--   · La llave foránea de `ronda_asignaciones.punto_id` a `ronda_puntos`.
--     `ronda_puntos` es de F2 y vive en otra rama; la restricción va en la
--     migración 20261019000031, que se aplica DESPUÉS de las dos.
--   · La herencia de la ventana horaria del `puesto` de la zona (§2.3 del
--     documento 00). `ronda_zonas` es de F2: aquí una ventana NULL significa
--     «todo el día», y así lo dice el comentario de la columna.
--
-- IDEMPOTENTE de punta a punta: se puede volver a aplicar sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. Acceso al catálogo y a las asignaciones
-- ──────────────────────────────────────────────────────────────────────────────
-- Cuatro funciones, al estilo de `grupo_acceso()` / `grupo_gestiona()` de F1,
-- para que las políticas no repitan la lista de claves y para que cambiar el
-- criterio sea un `CREATE OR REPLACE` y no veinte políticas.

CREATE OR REPLACE FUNCTION public.ronda_catalogo_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_catalogo_rondas,gestionar_catalogo_rondas}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_catalogo_acceso() IS
  'Lee el catálogo de trabajo: tipos de actividad, plantillas, pasos e instructivos (dentro de su alcance).';
GRANT EXECUTE ON FUNCTION public.ronda_catalogo_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_catalogo_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_catalogo_rondas')
$$;
COMMENT ON FUNCTION public.ronda_catalogo_gestiona() IS
  'Crea, edita, publica y versiona el catálogo de trabajo.';
GRANT EXECUTE ON FUNCTION public.ronda_catalogo_gestiona() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_asignaciones_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Quien gestiona el catálogo también las lee: no tiene sentido parametrizar
  -- plantillas a ciegas, sin ver dónde se aplican.
  SELECT public.auth_permiso_any(
    '{ver_asignaciones_rondas,gestionar_asignaciones_rondas,gestionar_catalogo_rondas}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_asignaciones_acceso() IS
  'Lee las asignaciones de plantillas a puntos (dentro de su alcance de contratos).';
GRANT EXECUTE ON FUNCTION public.ronda_asignaciones_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_asignaciones_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_asignaciones_rondas')
$$;
COMMENT ON FUNCTION public.ronda_asignaciones_gestiona() IS
  'Asigna plantillas a puntos: frecuencia, ventana, responsable, prioridad y ANS.';
GRANT EXECUTE ON FUNCTION public.ronda_asignaciones_gestiona() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. `ronda_tipos_actividad` — el catálogo de actividades
-- ──────────────────────────────────────────────────────────────────────────────
-- Tabla sembrada, NO enum, al estilo de `pqrs_plazos` y `turno_patrones`: el
-- cliente que pide «inspección de parqueadero» no debería costar una
-- migración. `grupo_id` nullable: NULL = aplica a todos los contratos (§2.4).
--
-- `categoria` usa el MISMO vocabulario que `grupo_servicios.servicio` de F1,
-- más tres valores para lo que no es un servicio vendido. Así la consola puede
-- ocultar los tipos cuyo servicio el contrato no tiene contratado.
CREATE TABLE IF NOT EXISTS ronda_tipos_actividad (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id    UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  codigo      VARCHAR(40) NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  descripcion TEXT,
  categoria   VARCHAR(20) NOT NULL DEFAULT 'OTRA'
              CHECK (categoria IN ('ASEO','CONSERJERIA','MANTENIMIENTO','SEGURIDAD',
                                   'HSEQ','ADMINISTRATIVA','OTRA')),
  icono       VARCHAR(40),
  color       VARCHAR(20),
  orden       INT NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_tipo_actividad_codigo CHECK (codigo = upper(codigo) AND codigo <> '')
);

-- Dos índices parciales en vez de UNIQUE (codigo, grupo_id): en un índice único
-- corriente dos NULL no chocan, así que el catálogo general podría terminar con
-- diez filas 'ASEO'. `NULLS NOT DISTINCT` existe desde PG 15, pero los índices
-- parciales funcionan en cualquier versión y dicen mejor lo que pasa.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_tipos_general
  ON ronda_tipos_actividad(codigo) WHERE grupo_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_tipos_grupo
  ON ronda_tipos_actividad(codigo, grupo_id) WHERE grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_tipos_grupo  ON ronda_tipos_actividad(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_tipos_activo ON ronda_tipos_actividad(activo) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_ronda_tipos_upd    ON ronda_tipos_actividad(updated_at);

COMMENT ON TABLE ronda_tipos_actividad IS
  'Qué clases de actividad existen (limpieza, ronda de seguridad, lectura de medidor…). Tabla sembrada y editable desde la consola, NO un enum: agregar un tipo que pida el cliente no cuesta una migración.';
COMMENT ON COLUMN ronda_tipos_actividad.grupo_id IS
  'Contrato dueño del tipo. NULL = catálogo general, aplica a todos los contratos (§2.4 del complemento 2).';
COMMENT ON COLUMN ronda_tipos_actividad.categoria IS
  'Mismo vocabulario que grupo_servicios.servicio (ASEO/CONSERJERIA/MANTENIMIENTO/SEGURIDAD) más HSEQ, ADMINISTRATIVA y OTRA. Permite ocultar los tipos de un servicio que el contrato no compró.';
COMMENT ON COLUMN ronda_tipos_actividad.icono IS
  'Nombre del icono de lucide-react (el mismo juego que usa el menú), para que la consola y la PWA pinten lo mismo.';

-- Siembra: las ocho actividades que nombró el usuario, en el catálogo general.
-- Son un punto de partida, no un dominio cerrado.
INSERT INTO ronda_tipos_actividad (grupo_id, codigo, nombre, descripcion, categoria, icono, color, orden) VALUES
  (NULL, 'ASEO',                'Limpieza',                'Limpieza de un área o un elemento del punto.',                         'ASEO',          'Sparkles',      '#0ea5e9', 10),
  (NULL, 'DESINFECCION',        'Desinfección',            'Desinfección de superficies de contacto frecuente.',                   'ASEO',          'SprayCan',      '#06b6d4', 20),
  (NULL, 'RONDA_SEGURIDAD',     'Ronda de seguridad',      'Recorrido de verificación del punto y su entorno.',                    'SEGURIDAD',     'ShieldCheck',   '#6366f1', 30),
  (NULL, 'REVISION_EXTINTOR',   'Revisión de extintor',    'Estado, presión, precinto y fecha de recarga del extintor.',           'HSEQ',          'FireExtinguisher','#ef4444', 40),
  (NULL, 'LECTURA_MEDIDOR',     'Lectura de medidor',      'Toma de lectura de un contador de agua, luz o gas.',                   'MANTENIMIENTO', 'Gauge',         '#f59e0b', 50),
  (NULL, 'RECOLECCION_BASURAS', 'Recolección de basuras',  'Recolección y disposición de residuos, con separación en la fuente.',   'ASEO',          'Trash2',        '#84cc16', 60),
  (NULL, 'INSPECCION_BANO',     'Inspección de baño',      'Revisión de aseo, dotación y daños en un baño.',                       'ASEO',          'ClipboardCheck','#14b8a6', 70),
  (NULL, 'NOVEDAD',             'Novedad',                 'Reporte de algo que no estaba previsto y hay que dejar registrado.',   'CONSERJERIA',   'TriangleAlert', '#dc2626', 80)
ON CONFLICT (codigo) WHERE grupo_id IS NULL DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. `ronda_instructivos` — el material que explica cómo se hace
-- ──────────────────────────────────────────────────────────────────────────────
-- Versionado como las plantillas y por la misma razón: un instructivo que se
-- corrige no puede cambiar lo que vio quien ya ejecutó con la versión vieja.
-- El archivo vive en el bucket PRIVADO `rondas`, ruta
-- `instructivos/{instructivo_id}/{archivo}`, y se lee SIEMPRE con
-- `createSignedUrl` de 300 segundos (ADR-C). Nunca URL pública.
--
-- Se asocia de dos maneras, y las dos hacen falta:
--   · a una ACTIVIDAD (`tipo_actividad_id`): «así se revisa un extintor», vale
--     para todas las plantillas de ese tipo;
--   · a un PASO (`ronda_plantilla_pasos.instructivo_id`): «así se toma esta
--     foto en concreto».
-- `momento` dice si se muestra ANTES de empezar o DURANTE la ejecución.
CREATE TABLE IF NOT EXISTS ronda_instructivos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  tipo_actividad_id UUID REFERENCES ronda_tipos_actividad(id) ON DELETE SET NULL,
  codigo            VARCHAR(40) NOT NULL,
  version           SMALLINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  titulo            VARCHAR(200) NOT NULL,
  tipo              VARCHAR(5) NOT NULL CHECK (tipo IN ('FOTO','VIDEO','PDF','AUDIO')),
  momento           VARCHAR(7) NOT NULL DEFAULT 'ANTES' CHECK (momento IN ('ANTES','DURANTE')),
  idioma            VARCHAR(5) NOT NULL DEFAULT 'es-CO',
  archivo_path      TEXT,
  mime              VARCHAR(120),
  tamano            BIGINT CHECK (tamano IS NULL OR tamano > 0),
  duracion_seg      INT CHECK (duracion_seg IS NULL OR duracion_seg > 0),
  texto             TEXT,
  estado            VARCHAR(10) NOT NULL DEFAULT 'BORRADOR'
                    CHECK (estado IN ('BORRADOR','PUBLICADO','ARCHIVADO')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_instructivo_codigo CHECK (codigo = upper(codigo) AND codigo <> ''),
  -- Un instructivo PUBLICADO sin archivo no sirve de nada.
  CONSTRAINT ck_instructivo_archivo CHECK (estado <> 'PUBLICADO' OR archivo_path IS NOT NULL),
  -- El video y el audio tienen duración; la foto y el PDF, no.
  CONSTRAINT ck_instructivo_duracion CHECK (
    tipo IN ('VIDEO','AUDIO') OR duracion_seg IS NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_instructivos_general
  ON ronda_instructivos(codigo, version) WHERE grupo_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_instructivos_grupo
  ON ronda_instructivos(codigo, grupo_id, version) WHERE grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_instructivos_grupo ON ronda_instructivos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_instructivos_tipo_act ON ronda_instructivos(tipo_actividad_id);
CREATE INDEX IF NOT EXISTS idx_ronda_instructivos_upd   ON ronda_instructivos(updated_at);

COMMENT ON TABLE ronda_instructivos IS
  'Material que explica cómo se hace una actividad o un paso: foto, video, PDF o audio, versionado y con idioma. El archivo está en el bucket privado `rondas` (instructivos/{id}/{archivo}) y se lee con URL firmada de 300 s (ADR-C).';
COMMENT ON COLUMN ronda_instructivos.grupo_id IS
  'Contrato dueño del instructivo. NULL = material general, lo ven todos los contratos (§2.4 del complemento 2).';
COMMENT ON COLUMN ronda_instructivos.texto IS
  'Transcripción o descripción. Sirve para buscar, para que el bot de WhatsApp lo pueda LEER cuando el conserje no puede ver video, y para accesibilidad.';
COMMENT ON COLUMN ronda_instructivos.momento IS
  'ANTES de empezar la actividad o DURANTE la ejecución. En un paso manda ronda_plantilla_pasos.instructivo_momento, que puede ser otro.';
COMMENT ON COLUMN ronda_instructivos.archivo_path IS
  'Ruta DENTRO del bucket `rondas`: instructivos/{instructivo_id}/{archivo}. Nunca una URL: las URL se firman al leer y caducan en 300 s.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `ronda_plantillas` — la actividad, versionada
-- ──────────────────────────────────────────────────────────────────────────────
-- Las versiones son FILAS DISTINTAS, no un número que se sube en el sitio. Es
-- la decisión más importante de la fase y la razón es la de §2.3 del documento
-- 00: una respuesta ya guardada tiene que seguir apuntando a la versión con la
-- que se contestó. F4 guardará `ronda_respuestas.plantilla_id` y `paso_id`;
-- esas filas quedan congeladas al publicar (ver §5), así que publicar la
-- versión 2 NO puede cambiar nada de lo guardado con la versión 1.
--
-- `grupo_id` nullable = «catálogo heredable y ajustable por contrato» (§4.1):
--   · fila con `grupo_id IS NULL`  → la plantilla general de la empresa;
--   · fila con `grupo_id` = contrato → el ajuste de ESE contrato, que tapa a la
--     general para el mismo `codigo`. `origen_plantilla_id` deja dicho de qué
--     plantilla general salió, para poder comparar.
-- Quien resuelve «cuál mando aquí» es `ronda_plantilla_vigente()`, abajo.
CREATE TABLE IF NOT EXISTS ronda_plantillas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id              UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  tipo_actividad_id     UUID NOT NULL REFERENCES ronda_tipos_actividad(id),
  origen_plantilla_id   UUID REFERENCES ronda_plantillas(id) ON DELETE SET NULL,
  codigo                VARCHAR(40) NOT NULL,
  version               SMALLINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  nombre                VARCHAR(200) NOT NULL,
  descripcion           TEXT,
  estado                VARCHAR(10) NOT NULL DEFAULT 'BORRADOR'
                        CHECK (estado IN ('BORRADOR','PUBLICADA','ARCHIVADA')),
  duracion_estimada_min SMALLINT CHECK (duracion_estimada_min IS NULL
                                        OR duracion_estimada_min BETWEEN 1 AND 1440),
  exige_firma           BOOLEAN NOT NULL DEFAULT false,
  exige_geocerca        BOOLEAN NOT NULL DEFAULT false,
  publicada_at          TIMESTAMPTZ,
  publicada_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_plantilla_codigo CHECK (codigo = upper(codigo) AND codigo <> ''),
  CONSTRAINT ck_plantilla_publicada CHECK (estado = 'BORRADOR' OR publicada_at IS NOT NULL)
);

-- La versión es única por código DENTRO de su dueño. El documento 00 proponía
-- `UNIQUE (codigo, version)` a secas, pero eso fue antes de que el complemento
-- 2 le pusiera `grupo_id` a la tabla: con la clave global, el contrato A que
-- saca su versión 2 de ASEO_BANOS le bloquearía la versión 2 al contrato B.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_plantillas_general
  ON ronda_plantillas(codigo, version) WHERE grupo_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_plantillas_grupo
  ON ronda_plantillas(codigo, grupo_id, version) WHERE grupo_id IS NOT NULL;

-- Una sola PUBLICADA por código y dueño: es la que usan las asignaciones, que
-- apuntan al CÓDIGO y no a la versión. Que la base lo impida evita el error más
-- caro posible: dos versiones vivas del mismo trabajo al mismo tiempo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_plantillas_pub_general
  ON ronda_plantillas(codigo) WHERE estado = 'PUBLICADA' AND grupo_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_plantillas_pub_grupo
  ON ronda_plantillas(codigo, grupo_id) WHERE estado = 'PUBLICADA' AND grupo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ronda_plantillas_grupo  ON ronda_plantillas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_plantillas_tipo   ON ronda_plantillas(tipo_actividad_id);
CREATE INDEX IF NOT EXISTS idx_ronda_plantillas_codigo ON ronda_plantillas(codigo, estado);
CREATE INDEX IF NOT EXISTS idx_ronda_plantillas_upd    ON ronda_plantillas(updated_at);

COMMENT ON TABLE ronda_plantillas IS
  'Actividad parametrizada y VERSIONADA: cada versión es una fila, y al publicarse queda congelada. Por eso publicar la versión 2 no cambia ninguna respuesta guardada con la versión 1 (las respuestas de F4 apuntan a plantilla_id y paso_id).';
COMMENT ON COLUMN ronda_plantillas.grupo_id IS
  'NULL = plantilla general de la empresa. Con contrato = el ajuste de ese contrato, que tapa a la general con el mismo codigo (§4.1: catálogo heredable y ajustable por contrato).';
COMMENT ON COLUMN ronda_plantillas.origen_plantilla_id IS
  'De qué plantilla salió esta: la versión anterior del mismo código, o la plantilla general que un contrato ajustó. Sirve para ver el historial y para comparar el ajuste con el original.';
COMMENT ON COLUMN ronda_plantillas.duracion_estimada_min IS
  'Tiempo estándar de la tarea, en minutos. Es el que los informes de eficiencia (F12, §4.5 del complemento 2) comparan contra el tiempo real de la visita.';
COMMENT ON COLUMN ronda_plantillas.exige_geocerca IS
  'Puede ENDURECER la geocerca del punto, nunca relajarla: F4 exige geocerca si la pide el punto O la plantilla.';
COMMENT ON COLUMN ronda_plantillas.estado IS
  'BORRADOR (se edita) · PUBLICADA (en uso, CONGELADA) · ARCHIVADA (ya no se asigna, pero sus respuestas siguen siendo legibles). Solo se permite BORRADOR→PUBLICADA (por ronda_plantilla_publicar) y PUBLICADA→ARCHIVADA.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `ronda_plantilla_pasos` — los pasos, con su config validada
-- ──────────────────────────────────────────────────────────────────────────────
-- Un `tipo` por paso y lo específico en `config JSONB`, validado por CHECK. La
-- alternativa —una columna por cada opción de cada tipo— dejaría la tabla con
-- treinta columnas nulas en casi toda fila.
--
-- El contrato de `config` está espejado en apps/inventario/lib/ronda/pasos.ts,
-- que es lógica pura y testeable (ADR-E). Si cambia uno, cambia el otro.

/** ¿La clave no viene, o viene con el tipo JSON esperado? */
CREATE OR REPLACE FUNCTION public.ronda_jsonb_es(p JSONB, k TEXT, t TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT (p ? k) OR jsonb_typeof(p->k) = t
$$;
COMMENT ON FUNCTION public.ronda_jsonb_es(JSONB, TEXT, TEXT) IS
  'Ayuda de ronda_paso_config_valida(): TRUE si la clave falta o es del tipo JSON pedido. Evita que un "min": "dos" revienta el CHECK con un error de casteo en vez de rechazar la fila.';

/** Número de una clave de `config`, o el valor por defecto si no viene. */
CREATE OR REPLACE FUNCTION public.ronda_jsonb_num(p JSONB, k TEXT, d NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p->k) = 'number' THEN (p->>k)::numeric ELSE d END
$$;

/**
 * ¿La `config` de un paso es válida para su tipo? Se usa en un CHECK, así que
 * es IMMUTABLE y no mira ninguna tabla.
 *
 * Las claves que no están aquí se ignoran a propósito: agregar una opción nueva
 * a un tipo no debería invalidar las filas que ya existen.
 */
CREATE OR REPLACE FUNCTION public.ronda_paso_config_valida(p_tipo TEXT, p_config JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  -- El COALESCE final no es adorno: un CHECK que se evalúa a NULL PASA, así que
  -- sin él una `config` a la que le falta una clave obligatoria entraría.
  SELECT COALESCE(CASE
    WHEN p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN false

    -- Las opciones son SÍ / NO / NO APLICA, siempre; lo único configurable es
    -- si un "NO" exige motivo. El motivo lo obliga `ronda_respuestas` en F4.
    WHEN p_tipo = 'CASILLA' THEN
      public.ronda_jsonb_es(p_config, 'motivo_obligatorio_si_no', 'boolean')

    WHEN p_tipo = 'FOTO' THEN
      public.ronda_jsonb_es(p_config, 'min', 'number')
      AND public.ronda_jsonb_es(p_config, 'max', 'number')
      AND public.ronda_jsonb_es(p_config, 'solo_camara_vivo', 'boolean')
      AND public.ronda_jsonb_es(p_config, 'exige_qr_en_encuadre', 'boolean')
      AND public.ronda_jsonb_num(p_config, 'min', 1) BETWEEN 0 AND 20
      AND public.ronda_jsonb_num(p_config, 'max', 1) BETWEEN 1 AND 20
      -- Solo se comparan si vienen las dos: «mínimo 3 fotos, sin tope» es
      -- válido, y con un tope por defecto quedaría rechazado.
      AND (NOT (p_config ? 'min' AND p_config ? 'max')
           OR public.ronda_jsonb_num(p_config, 'max', 1)
              >= public.ronda_jsonb_num(p_config, 'min', 1))

    WHEN p_tipo = 'VIDEO' THEN
      public.ronda_jsonb_es(p_config, 'segundos_max', 'number')
      AND public.ronda_jsonb_num(p_config, 'segundos_max', 15) BETWEEN 3 AND 300

    WHEN p_tipo = 'TEXTO' THEN
      public.ronda_jsonb_es(p_config, 'min_caracteres', 'number')
      AND public.ronda_jsonb_es(p_config, 'max_caracteres', 'number')
      AND public.ronda_jsonb_num(p_config, 'min_caracteres', 0) BETWEEN 0 AND 4000
      AND public.ronda_jsonb_num(p_config, 'max_caracteres', 500) BETWEEN 1 AND 4000
      AND (NOT (p_config ? 'min_caracteres' AND p_config ? 'max_caracteres')
           OR public.ronda_jsonb_num(p_config, 'max_caracteres', 500)
              >= public.ronda_jsonb_num(p_config, 'min_caracteres', 0))

    WHEN p_tipo = 'NOTA_VOZ' THEN
      public.ronda_jsonb_es(p_config, 'segundos_max', 'number')
      AND public.ronda_jsonb_es(p_config, 'transcribir', 'boolean')
      AND public.ronda_jsonb_num(p_config, 'segundos_max', 60) BETWEEN 3 AND 600

    WHEN p_tipo = 'NUMERO' THEN
      public.ronda_jsonb_es(p_config, 'min', 'number')
      AND public.ronda_jsonb_es(p_config, 'max', 'number')
      AND public.ronda_jsonb_es(p_config, 'decimales', 'number')
      AND public.ronda_jsonb_es(p_config, 'unidad', 'string')
      AND public.ronda_jsonb_num(p_config, 'decimales', 0) BETWEEN 0 AND 4
      AND (NOT (p_config ? 'min' AND p_config ? 'max')
           OR public.ronda_jsonb_num(p_config, 'max', 0)
              >= public.ronda_jsonb_num(p_config, 'min', 0))

    WHEN p_tipo = 'SELECCION' THEN
      public.ronda_jsonb_es(p_config, 'multiple', 'boolean')
      AND jsonb_typeof(p_config->'opciones') = 'array'
      AND jsonb_array_length(p_config->'opciones') >= 1
      -- El COALESCE es necesario: sin él, una opción SIN `valor` da
      -- jsonb_typeof(NULL) = NULL, el WHERE no la ve y el EXISTS la aprueba.
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_config->'opciones') o
         WHERE jsonb_typeof(o) <> 'object'
            OR COALESCE(jsonb_typeof(o->'valor'), '') <> 'string'
            OR COALESCE(jsonb_typeof(o->'etiqueta'), '') <> 'string'
      )

    -- Resuelve contra `productos` (código del insumo) o `maquinaria`. El
    -- dominio es cerrado porque son las dos tablas que existen hoy.
    WHEN p_tipo = 'ESCANEO' THEN
      COALESCE(p_config->>'entidad', '') IN ('producto','maquinaria')
      AND public.ronda_jsonb_es(p_config, 'exige_existente', 'boolean')

    WHEN p_tipo = 'FIRMA' THEN
      COALESCE(p_config->>'quien', '') IN ('trabajador','cliente')
      AND public.ronda_jsonb_es(p_config, 'permite_facial', 'boolean')

    ELSE false
  END, false)
$$;
COMMENT ON FUNCTION public.ronda_paso_config_valida(TEXT, JSONB) IS
  'Valida la `config` de un paso según su tipo. Espejada en apps/inventario/lib/ronda/pasos.ts; si cambia una, cambia la otra. NO existe un tipo de paso para el reto aleatorio: el complemento 1 no ha llegado (§7 del complemento 2).';

CREATE TABLE IF NOT EXISTS ronda_plantilla_pasos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plantilla_id        UUID NOT NULL REFERENCES ronda_plantillas(id) ON DELETE CASCADE,
  orden               SMALLINT NOT NULL CHECK (orden BETWEEN 1 AND 200),
  tipo                VARCHAR(10) NOT NULL
                      CHECK (tipo IN ('CASILLA','FOTO','VIDEO','TEXTO','NOTA_VOZ',
                                      'NUMERO','SELECCION','ESCANEO','FIRMA')),
  titulo              VARCHAR(200) NOT NULL,
  ayuda               TEXT,
  obligatorio         BOOLEAN NOT NULL DEFAULT true,
  -- Sin ON DELETE: borrar un instructivo que un paso usa tiene que fallar. Un
  -- SET NULL dispararía el UPDATE de un paso congelado y rompería el borrado
  -- con un error mucho menos claro.
  instructivo_id      UUID REFERENCES ronda_instructivos(id),
  instructivo_momento VARCHAR(7) CHECK (instructivo_momento IN ('ANTES','DURANTE')),
  -- Paso condicional: solo se muestra si `condicion_paso_id` respondió
  -- `condicion_valor`. Sin ON DELETE por lo mismo: borrar un paso del que
  -- depende otro falla, y borrar la plantilla entera sí funciona porque la
  -- comprobación es al final de la sentencia, no fila por fila.
  condicion_paso_id   UUID REFERENCES ronda_plantilla_pasos(id),
  condicion_valor     VARCHAR(100),
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_paso_condicion CHECK ((condicion_paso_id IS NULL) = (condicion_valor IS NULL)),
  CONSTRAINT ck_paso_no_se_condiciona_a_si_mismo CHECK (condicion_paso_id IS NULL OR condicion_paso_id <> id),
  CONSTRAINT ck_paso_instructivo CHECK ((instructivo_id IS NULL) OR (instructivo_momento IS NOT NULL)),
  CONSTRAINT ck_paso_config CHECK (public.ronda_paso_config_valida(tipo, config))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_pasos_orden
  ON ronda_plantilla_pasos(plantilla_id, orden);
CREATE INDEX IF NOT EXISTS idx_ronda_pasos_plantilla   ON ronda_plantilla_pasos(plantilla_id, orden);
CREATE INDEX IF NOT EXISTS idx_ronda_pasos_instructivo ON ronda_plantilla_pasos(instructivo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_pasos_condicion   ON ronda_plantilla_pasos(condicion_paso_id);
CREATE INDEX IF NOT EXISTS idx_ronda_pasos_upd         ON ronda_plantilla_pasos(updated_at);

COMMENT ON TABLE ronda_plantilla_pasos IS
  'Pasos ordenados de una plantilla. Un `tipo` por paso y lo específico en `config`, validado por CHECK contra ronda_paso_config_valida(). Se congelan cuando la plantilla se publica.';
COMMENT ON COLUMN ronda_plantilla_pasos.condicion_paso_id IS
  'PASO CONDICIONAL: este paso solo se muestra si el paso referenciado respondió `condicion_valor`. Tiene que ser un paso de la MISMA plantilla (lo obliga un trigger) y, al publicar, de orden menor que este.';
COMMENT ON COLUMN ronda_plantilla_pasos.config IS
  'Opciones del tipo. CASILLA {motivo_obligatorio_si_no} · FOTO {min,max,solo_camara_vivo,exige_qr_en_encuadre} · VIDEO {segundos_max} · TEXTO {min_caracteres,max_caracteres} · NOTA_VOZ {segundos_max,transcribir} · NUMERO {min,max,decimales,unidad} · SELECCION {multiple,opciones[]} · ESCANEO {entidad,exige_existente} · FIRMA {quien,permite_facial}.';
COMMENT ON COLUMN ronda_plantilla_pasos.obligatorio IS
  'Si es obligatorio, F4 no deja cerrar la visita sin respuesta. Un paso condicional obligatorio solo obliga cuando su condición se cumple.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. El congelado: lo publicado no se toca
-- ──────────────────────────────────────────────────────────────────────────────
-- ESTA es la garantía del versionado, y está en la base, no en la UI: publicar
-- la versión 2 no puede cambiar ninguna respuesta guardada con la versión 1
-- porque la versión 1 —fila de plantilla y filas de pasos— ya no se puede
-- modificar. Sin esto, el versionado sería una convención que cualquier
-- `UPDATE` rompe en silencio, y las respuestas de F4 quedarían contestando
-- preguntas que ya no son las que se hicieron.

CREATE OR REPLACE FUNCTION public.ronda_plantilla_congelar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- El contrato dueño ya no está: esto es la cascada de su borrado. Si se
    -- bloqueara, un contrato con catálogo propio publicado sería imposible de
    -- eliminar, y eso no es lo que el congelado quiere proteger.
    IF OLD.grupo_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.grupos_contrato g WHERE g.id = OLD.grupo_id) THEN
      RETURN OLD;
    END IF;
    IF OLD.estado <> 'BORRADOR' THEN
      RAISE EXCEPTION 'No se puede borrar la plantilla % v% porque está %: archívala en vez de borrarla.',
        OLD.codigo, OLD.version, OLD.estado;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.estado = 'BORRADOR' THEN
    RETURN NEW;                       -- en borrador se edita todo
  END IF;

  -- Publicada o archivada: solo se admite archivar, y nada del contenido.
  IF NEW.estado <> OLD.estado AND NOT (OLD.estado = 'PUBLICADA' AND NEW.estado = 'ARCHIVADA') THEN
    RAISE EXCEPTION 'Cambio de estado no permitido en % v%: % → %. Para cambiar una plantilla publicada se saca una versión nueva.',
      OLD.codigo, OLD.version, OLD.estado, NEW.estado;
  END IF;

  IF (to_jsonb(NEW) - 'estado' - 'updated_at' - 'publicada_at' - 'publicada_por')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'estado' - 'updated_at' - 'publicada_at' - 'publicada_por') THEN
    RAISE EXCEPTION 'La plantilla % v% está % y no se puede modificar. Saca una versión nueva con ronda_plantilla_nueva_version().',
      OLD.codigo, OLD.version, OLD.estado;
  END IF;

  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.ronda_plantilla_congelar() IS
  'Congela la plantilla cuando deja de ser BORRADOR: solo se permite PUBLICADA→ARCHIVADA, nunca un cambio de contenido ni un borrado. Es lo que garantiza que publicar la v2 no altere nada de lo guardado con la v1. Deja pasar la cascada del borrado del contrato, que es cuando el contrato dueño ya no existe.';

CREATE OR REPLACE FUNCTION public.ronda_paso_congelar()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_estado TEXT; v_codigo TEXT; v_version SMALLINT;
BEGIN
  SELECT p.estado, p.codigo, p.version INTO v_estado, v_codigo, v_version
    FROM public.ronda_plantillas p
   WHERE p.id = COALESCE(NEW.plantilla_id, OLD.plantilla_id);

  -- La plantilla ya no está: esto es la cascada de su borrado (o del borrado
  -- del contrato). No hay nada que congelar y bloquearlo dejaría contratos
  -- imposibles de borrar.
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Los pasos de % v% no se pueden tocar: la plantilla está %. Saca una versión nueva.',
      v_codigo, v_version, v_estado;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;
COMMENT ON FUNCTION public.ronda_paso_congelar() IS
  'Impide agregar, cambiar o borrar pasos de una plantilla que ya no es BORRADOR. Deja pasar la cascada del borrado de la plantilla o del contrato, que es cuando la fila padre ya no existe.';

/**
 * Un paso condicional solo puede depender de un paso de SU plantilla. Que
 * dependiera de otra haría imposible resolver la visita, y la llave foránea
 * sola no lo impide porque apunta a la misma tabla.
 */
CREATE OR REPLACE FUNCTION public.ronda_paso_condicion_valida()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_plantilla UUID;
BEGIN
  IF NEW.condicion_paso_id IS NULL THEN RETURN NEW; END IF;

  SELECT plantilla_id INTO v_plantilla
    FROM public.ronda_plantilla_pasos WHERE id = NEW.condicion_paso_id;
  IF v_plantilla IS DISTINCT FROM NEW.plantilla_id THEN
    RAISE EXCEPTION 'El paso del que depende «%» es de otra plantilla.', NEW.titulo;
  END IF;

  -- Sin ciclos. El orden no sirve de garantía porque en borrador se reordena;
  -- el camino de condiciones se recorre y tiene que terminar.
  IF EXISTS (
    WITH RECURSIVE cadena(id) AS (
      SELECT NEW.condicion_paso_id
      UNION
      SELECT p.condicion_paso_id FROM public.ronda_plantilla_pasos p
        JOIN cadena c ON c.id = p.id
       WHERE p.condicion_paso_id IS NOT NULL
    )
    SELECT 1 FROM cadena WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'La condición de «%» forma un ciclo con otro paso.', NEW.titulo;
  END IF;

  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.ronda_paso_condicion_valida() IS
  'Obliga a que un paso condicional dependa de un paso de la misma plantilla y sin ciclos. Que la dependencia sea de orden MENOR se verifica al publicar, para no estorbar el reordenado en borrador.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Triggers de integridad del catálogo
-- ──────────────────────────────────────────────────────────────────────────────
-- `tr_*_congelar` va antes que `tr_*_upd` por orden alfabético del nombre, que
-- es el orden en que PostgreSQL dispara los BEFORE: así el congelado compara
-- OLD y NEW antes de que `set_updated_at()` toque `updated_at`.
DROP TRIGGER IF EXISTS tr_ronda_plantillas_congelar ON ronda_plantillas;
CREATE TRIGGER tr_ronda_plantillas_congelar
  BEFORE UPDATE OR DELETE ON ronda_plantillas
  FOR EACH ROW EXECUTE FUNCTION public.ronda_plantilla_congelar();

DROP TRIGGER IF EXISTS tr_ronda_pasos_congelar ON ronda_plantilla_pasos;
CREATE TRIGGER tr_ronda_pasos_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON ronda_plantilla_pasos
  FOR EACH ROW EXECUTE FUNCTION public.ronda_paso_congelar();

DROP TRIGGER IF EXISTS tr_ronda_pasos_condicion ON ronda_plantilla_pasos;
CREATE TRIGGER tr_ronda_pasos_condicion
  BEFORE INSERT OR UPDATE ON ronda_plantilla_pasos
  FOR EACH ROW EXECUTE FUNCTION public.ronda_paso_condicion_valida();

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Publicar y versionar — por RPC, no por la UI
-- ──────────────────────────────────────────────────────────────────────────────
-- ADR-E: lo que tiene máquina de estados y validación que la RLS no puede
-- expresar va por RPC `SECURITY DEFINER`. Publicar valida la plantilla entera,
-- archiva la versión anterior y sella quién y cuándo, todo en una sola
-- transacción; sacar una versión nueva clona la plantilla y sus pasos
-- RECALCULANDO las referencias de los pasos condicionales, que es justo lo que
-- un copiar-pegar desde la UI haría mal.

/**
 * Qué plantilla manda para un código en un contrato: la PUBLICADA del contrato
 * si la hay, y si no la PUBLICADA general. Es la que usan las asignaciones (que
 * apuntan al código) y la que resuelve `ronda_tareas_aplicables()`.
 */
CREATE OR REPLACE FUNCTION public.ronda_plantilla_vigente(p_codigo TEXT, p_grupo UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id
    FROM public.ronda_plantillas p
   WHERE p.codigo = p_codigo
     AND p.estado = 'PUBLICADA'
     AND (p.grupo_id IS NULL OR p.grupo_id = p_grupo)
   -- El ajuste del contrato tapa a la general: los NOT NULL van primero.
   ORDER BY (p.grupo_id IS NULL), p.version DESC
   LIMIT 1
$$;
COMMENT ON FUNCTION public.ronda_plantilla_vigente(TEXT, UUID) IS
  'Plantilla PUBLICADA que manda para un código en un contrato: el ajuste del contrato si existe, si no la general (§4.1: catálogo heredable y ajustable por contrato).';
GRANT EXECUTE ON FUNCTION public.ronda_plantilla_vigente(TEXT, UUID) TO authenticated;

/** ¿La plantilla está en el alcance del usuario? Para las políticas de pasos,
    que no llevan `grupo_id` y lo heredan de la plantilla (§2.4). */
CREATE OR REPLACE FUNCTION public.ronda_plantilla_en_alcance(p_plantilla UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ronda_plantillas p
     WHERE p.id = p_plantilla
       AND (p.grupo_id IS NULL OR public.auth_ve_grupo(p.grupo_id))
  )
$$;
COMMENT ON FUNCTION public.ronda_plantilla_en_alcance(UUID) IS
  'TRUE si la plantilla es del catálogo general o de un contrato al que alcanza el usuario. Lo usan las políticas de ronda_plantilla_pasos, que heredan el alcance de la plantilla.';
GRANT EXECUTE ON FUNCTION public.ronda_plantilla_en_alcance(UUID) TO authenticated;

/**
 * Publica una plantilla en BORRADOR: la valida, archiva la versión anterior
 * del mismo código y dueño, y la sella. Devuelve el id.
 */
CREATE OR REPLACE FUNCTION public.ronda_plantilla_publicar(p_plantilla UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p RECORD; v_pasos INT; v_mal TEXT;
BEGIN
  IF NOT public.ronda_catalogo_gestiona() THEN
    RAISE EXCEPTION 'No tienes permiso para publicar plantillas (gestionar_catalogo_rondas).';
  END IF;

  SELECT * INTO p FROM public.ronda_plantillas WHERE id = p_plantilla;
  IF NOT FOUND THEN RAISE EXCEPTION 'La plantilla no existe.'; END IF;
  IF p.grupo_id IS NOT NULL AND NOT public.auth_ve_grupo(p.grupo_id) THEN
    RAISE EXCEPTION 'Esa plantilla es de un contrato que no está en tu alcance.';
  END IF;
  IF p.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La plantilla % v% ya está %.', p.codigo, p.version, p.estado;
  END IF;

  SELECT count(*) INTO v_pasos FROM public.ronda_plantilla_pasos WHERE plantilla_id = p_plantilla;
  IF v_pasos = 0 THEN
    RAISE EXCEPTION 'No se puede publicar % v% sin un solo paso.', p.codigo, p.version;
  END IF;

  -- Un paso condicional que dependa de un paso POSTERIOR nunca se mostraría:
  -- en la ejecución su condición no está respondida todavía. En borrador se
  -- deja reordenar libremente; aquí ya tiene que cuadrar.
  SELECT string_agg(h.titulo, ', ' ORDER BY h.orden) INTO v_mal
    FROM public.ronda_plantilla_pasos h
    JOIN public.ronda_plantilla_pasos d ON d.id = h.condicion_paso_id
   WHERE h.plantilla_id = p_plantilla AND d.orden >= h.orden;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'Estos pasos dependen de un paso que va después: %. Súbelos o reordena.', v_mal;
  END IF;

  -- No se renumeran los pasos. Borrar un paso en borrador deja un hueco en
  -- `orden` y eso no molesta a nadie: la UI y la PWA ordenan POR `orden`, no
  -- cuentan. Renumerar obligaría a pasar por valores fuera del rango del CHECK
  -- para no chocar con el índice único, y no compra nada.

  -- La anterior se archiva ANTES de publicar esta: el índice único parcial solo
  -- admite una PUBLICADA por código y dueño.
  UPDATE public.ronda_plantillas
     SET estado = 'ARCHIVADA'
   WHERE codigo = p.codigo
     AND grupo_id IS NOT DISTINCT FROM p.grupo_id
     AND estado = 'PUBLICADA';

  UPDATE public.ronda_plantillas
     SET estado = 'PUBLICADA', publicada_at = NOW(), publicada_por = (SELECT auth.uid())
   WHERE id = p_plantilla;

  RETURN p_plantilla;
END $$;
COMMENT ON FUNCTION public.ronda_plantilla_publicar(UUID) IS
  'Publica una plantilla en borrador: valida que tenga pasos y que ningún paso condicional dependa de uno posterior, archiva la versión anterior del mismo código y dueño, y sella quién publicó y cuándo. Va por RPC porque es una máquina de estados (ADR-E).';
GRANT EXECUTE ON FUNCTION public.ronda_plantilla_publicar(UUID) TO authenticated;

/**
 * Saca una versión nueva (en BORRADOR) de una plantilla, clonando sus pasos.
 * Si `p_grupo` viene, la copia es el AJUSTE de ese contrato sobre la plantilla
 * general (§4.1); si no, es la versión siguiente del mismo dueño.
 */
CREATE OR REPLACE FUNCTION public.ronda_plantilla_nueva_version(
  p_plantilla UUID,
  p_grupo     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p RECORD; v_grupo UUID; v_version SMALLINT; v_nueva UUID;
BEGIN
  IF NOT public.ronda_catalogo_gestiona() THEN
    RAISE EXCEPTION 'No tienes permiso para versionar plantillas (gestionar_catalogo_rondas).';
  END IF;

  SELECT * INTO p FROM public.ronda_plantillas WHERE id = p_plantilla;
  IF NOT FOUND THEN RAISE EXCEPTION 'La plantilla no existe.'; END IF;
  IF p.grupo_id IS NOT NULL AND NOT public.auth_ve_grupo(p.grupo_id) THEN
    RAISE EXCEPTION 'Esa plantilla es de un contrato que no está en tu alcance.';
  END IF;

  -- Ajustar para un contrato: la copia es de ESE contrato. Sin p_grupo, hereda
  -- el dueño de la original.
  v_grupo := COALESCE(p_grupo, p.grupo_id);
  IF v_grupo IS NOT NULL AND NOT public.auth_ve_grupo(v_grupo) THEN
    RAISE EXCEPTION 'Ese contrato no está en tu alcance.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ronda_plantillas
              WHERE codigo = p.codigo AND grupo_id IS NOT DISTINCT FROM v_grupo
                AND estado = 'BORRADOR') THEN
    RAISE EXCEPTION 'Ya hay un borrador de % sin publicar: termínalo o descártalo.', p.codigo;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.ronda_plantillas
   WHERE codigo = p.codigo AND grupo_id IS NOT DISTINCT FROM v_grupo;

  INSERT INTO public.ronda_plantillas (
    grupo_id, tipo_actividad_id, origen_plantilla_id, codigo, version, nombre,
    descripcion, estado, duracion_estimada_min, exige_firma, exige_geocerca)
  VALUES (v_grupo, p.tipo_actividad_id, p.id, p.codigo, v_version, p.nombre,
          p.descripcion, 'BORRADOR', p.duracion_estimada_min, p.exige_firma, p.exige_geocerca)
  RETURNING id INTO v_nueva;

  -- Los pasos se clonan en dos pasadas: primero sin condiciones y luego
  -- rehaciéndolas DENTRO de la copia. En una sola pasada el paso clonado
  -- seguiría apuntando al paso de la versión vieja —y el trigger de condición
  -- lo rechazaría, que es justo lo que se quiere que pase—, y hacerlo todo en
  -- un solo INSERT tampoco sirve: el trigger es BEFORE ROW y buscaría un
  -- hermano que todavía no está insertado.
  --
  -- No hace falta una tabla de mapeo: `(plantilla_id, orden)` es único, así que
  -- el `orden` es la llave natural entre el original y su copia.
  INSERT INTO public.ronda_plantilla_pasos (
    plantilla_id, orden, tipo, titulo, ayuda, obligatorio,
    instructivo_id, instructivo_momento, config)
  SELECT v_nueva, s.orden, s.tipo, s.titulo, s.ayuda, s.obligatorio,
         s.instructivo_id, s.instructivo_momento, s.config
    FROM public.ronda_plantilla_pasos s
   WHERE s.plantilla_id = p.id
   ORDER BY s.orden;

  UPDATE public.ronda_plantilla_pasos nuevo
     SET condicion_paso_id = copia_cond.id,
         condicion_valor   = viejo.condicion_valor
    FROM public.ronda_plantilla_pasos viejo
    JOIN public.ronda_plantilla_pasos cond ON cond.id = viejo.condicion_paso_id
    JOIN public.ronda_plantilla_pasos copia_cond
      ON copia_cond.plantilla_id = v_nueva AND copia_cond.orden = cond.orden
   WHERE viejo.plantilla_id = p.id
     AND nuevo.plantilla_id = v_nueva
     AND nuevo.orden = viejo.orden;

  RETURN v_nueva;
END $$;
COMMENT ON FUNCTION public.ronda_plantilla_nueva_version(UUID, UUID) IS
  'Clona una plantilla y sus pasos en una versión nueva en BORRADOR, rehaciendo las referencias de los pasos condicionales dentro de la copia. Con p_grupo, la copia es el ajuste de ese contrato sobre la plantilla general.';
GRANT EXECUTE ON FUNCTION public.ronda_plantilla_nueva_version(UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. `ronda_asignaciones` — qué plantilla, en qué punto, cuándo y quién
-- ──────────────────────────────────────────────────────────────────────────────
-- La frecuencia y la ventana SIGUEN EL CRITERIO QUE YA HAY EN EL REPO, no uno
-- nuevo:
--   · `dias SMALLINT[]` con 1 = lunes … 7 = domingo y `CHECK (dias <@ 1..7)`,
--     igual que `puestos.dias_cobertura` y `turno_patrones.dias`
--     (20261018000005). Un array, no siete booleanos ni una tabla hija.
--   · `ventana_desde` / `ventana_hasta TIME` con la regla «o están las dos o
--     ninguna» de `turno_patrones`, y `cruza_medianoche` CALCULADA, que es
--     exactamente la trampa que esa migración dejó resuelta: una ventana que
--     acaba a una hora menor o igual que la de inicio pasa de medianoche, y
--     olvidarlo descuadra todos los turnos de noche.
--   · `CADA_N_HORAS` + `cada_horas` es el criterio de `maquinaria`
--     (`frecuencia_mant_dias`, 20260914000000): el periodo como número y no
--     como una expresión cron, para que se pueda sumar y comparar en SQL.
-- Lo que NO se reutiliza y por qué: no se cuelga de `turno_patrones` ni de
-- `puestos`. Un punto de control no es un puesto —hay varios puntos dentro de
-- un puesto— y una tarea de 3 minutos no es un turno de 8 horas. Lo que se
-- comparte es el VOCABULARIO, no la tabla.
CREATE TABLE IF NOT EXISTS ronda_asignaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- §2.4: NOT NULL los dos, desnormalizados aunque sean derivables del punto.
  grupo_id          UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id           UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  -- La llave foránea a `ronda_puntos` la pone 20261019000031: esa tabla es de
  -- F2 y vive en otra rama. La columna sí nace aquí, con su índice.
  punto_id          UUID NOT NULL,
  -- Apunta al CÓDIGO, no a la versión: la asignación usa siempre la versión
  -- PUBLICADA que resuelva `ronda_plantilla_vigente()`. Así publicar la v2 no
  -- obliga a repasar mil asignaciones.
  plantilla_codigo  VARCHAR(40) NOT NULL,
  frecuencia        VARCHAR(12) NOT NULL
                    CHECK (frecuencia IN ('CADA_N_HORAS','POR_TURNO','DIARIA',
                                          'SEMANAL','MENSUAL','POR_EVENTO')),
  cada_horas        SMALLINT CHECK (cada_horas IS NULL OR cada_horas BETWEEN 1 AND 168),
  veces_por_periodo SMALLINT NOT NULL DEFAULT 1 CHECK (veces_por_periodo BETWEEN 1 AND 96),
  dias              SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  ventana_desde     TIME,
  ventana_hasta     TIME,
  tolerancia_min    SMALLINT NOT NULL DEFAULT 30 CHECK (tolerancia_min BETWEEN 0 AND 720),
  evento            VARCHAR(40),
  rol_id            UUID REFERENCES roles(id) ON DELETE SET NULL,
  cargo_id          UUID REFERENCES cargos(id) ON DELETE SET NULL,
  persona_id        UUID REFERENCES personas(id) ON DELETE SET NULL,
  prioridad         VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                    CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  sla_min           SMALLINT CHECK (sla_min IS NULL OR sla_min BETWEEN 1 AND 1440),
  vigente_desde     DATE,
  vigente_hasta     DATE,
  activo            BOOLEAN NOT NULL DEFAULT true,
  observacion       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_asignacion_dias CHECK (dias <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]
                                       AND array_length(dias, 1) >= 1),
  -- O están las dos horas, o ninguna (criterio de turno_patrones).
  CONSTRAINT ck_asignacion_ventana CHECK ((ventana_desde IS NULL) = (ventana_hasta IS NULL)),
  -- `cada_horas` solo tiene sentido —y es obligatorio— en CADA_N_HORAS.
  CONSTRAINT ck_asignacion_cada_horas CHECK ((frecuencia = 'CADA_N_HORAS') = (cada_horas IS NOT NULL)),
  -- `evento` solo tiene sentido —y es obligatorio— en POR_EVENTO.
  CONSTRAINT ck_asignacion_evento CHECK ((frecuencia = 'POR_EVENTO') = (evento IS NOT NULL)),
  CONSTRAINT ck_asignacion_responsable CHECK (
    rol_id IS NOT NULL OR cargo_id IS NOT NULL OR persona_id IS NOT NULL
  ),
  CONSTRAINT ck_asignacion_vigencia CHECK (
    vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde
  )
);

ALTER TABLE ronda_asignaciones DROP COLUMN IF EXISTS cruza_medianoche;
ALTER TABLE ronda_asignaciones ADD COLUMN cruza_medianoche BOOLEAN
  GENERATED ALWAYS AS (ventana_desde IS NOT NULL AND ventana_hasta <= ventana_desde) STORED;

-- La misma plantilla puede ir dos veces en el mismo punto si son ventanas
-- distintas (una ronda en la mañana y otra en la tarde), pero no dos veces en
-- la misma ventana. El COALESCE es para que las dos sin ventana también choquen.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_asignaciones_punto_plantilla
  ON ronda_asignaciones(punto_id, plantilla_codigo, frecuencia,
                        COALESCE(ventana_desde, '00:00'::time));
CREATE INDEX IF NOT EXISTS idx_ronda_asignaciones_punto ON ronda_asignaciones(punto_id) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_ronda_asignaciones_grupo ON ronda_asignaciones(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_asignaciones_sede  ON ronda_asignaciones(sede_id);
CREATE INDEX IF NOT EXISTS idx_ronda_asignaciones_plant ON ronda_asignaciones(plantilla_codigo);
CREATE INDEX IF NOT EXISTS idx_ronda_asignaciones_pers  ON ronda_asignaciones(persona_id);
CREATE INDEX IF NOT EXISTS idx_ronda_asignaciones_upd   ON ronda_asignaciones(updated_at);

COMMENT ON TABLE ronda_asignaciones IS
  'Qué plantilla aplica en qué punto, con qué frecuencia, en qué ventana, con cuánta tolerancia, quién responde, con qué prioridad y con qué ANS. La consulta «qué aplica aquí y ahora» la responde ronda_tareas_aplicables().';
COMMENT ON COLUMN ronda_asignaciones.punto_id IS
  'Punto de control (ronda_puntos, F2). La llave foránea la agrega la migración 20261019000031, que se aplica después de F2 y F3: en la rama de F3 esa tabla todavía no existe.';
COMMENT ON COLUMN ronda_asignaciones.plantilla_codigo IS
  'Código de la plantilla, NO su id: la asignación usa siempre la versión PUBLICADA (ronda_plantilla_vigente()), así que publicar una versión nueva no obliga a tocar las asignaciones.';
COMMENT ON COLUMN ronda_asignaciones.dias IS
  'Días en que aplica, 1 = lunes … 7 = domingo. Mismo formato que puestos.dias_cobertura y turno_patrones.dias.';
COMMENT ON COLUMN ronda_asignaciones.ventana_desde IS
  'Inicio de la ventana en hora local de Bogotá. NULL (con ventana_hasta NULL) = todo el día. La herencia de la ventana del puesto de la zona queda para cuando exista ronda_zonas (F2).';
COMMENT ON COLUMN ronda_asignaciones.cruza_medianoche IS
  'CALCULADA: la ventana termina a una hora menor o igual que la de inicio, así que pasa de medianoche. Es la trampa que turno_patrones ya dejó resuelta y que descuadra cualquier conteo nocturno si se olvida.';
COMMENT ON COLUMN ronda_asignaciones.tolerancia_min IS
  'Minutos que se puede pasar del fin de la ventana sin que cuente como incumplimiento.';
COMMENT ON COLUMN ronda_asignaciones.evento IS
  'Qué dispara la tarea cuando la frecuencia es POR_EVENTO (una novedad, una PQRS, una alarma). Sin CHECK a propósito: el catálogo de eventos lo cierra F4, igual que grupo_entregables.tipo_informe en F1.';
COMMENT ON COLUMN ronda_asignaciones.sla_min IS
  'Minutos máximos entre abrir y cerrar la visita. Se queda corto frente a grupo_sla, que es el ANS del contrato: este es el de ESTA tarea en ESTE punto.';
COMMENT ON COLUMN ronda_asignaciones.rol_id IS
  'Responsable por rol. Con cargo_id (por cargo) y persona_id (nominal) forman las tres formas de asignar; un CHECK obliga a que haya al menos una.';

-- ── 8.1 Triggers de `updated_at` ─────────────────────────────────────────────
-- Van aquí, al final de las cinco tablas, para que el bucle no tenga que
-- adivinar cuáles existen ya.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ronda_tipos_actividad','ronda_instructivos','ronda_plantillas',
                           'ronda_plantilla_pasos','ronda_asignaciones'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. `ronda_tareas_aplicables()` — «qué aplica en este punto a esta hora»
-- ──────────────────────────────────────────────────────────────────────────────
-- Es LA consulta del módulo: la hacen la PWA al escanear el QR (F4), el bot de
-- WhatsApp (F9) y la cola offline. Va en la base, no en la UI, por eso mismo:
-- si cada canal la escribiera, cada canal contestaría distinto, y el que
-- contesta distinto es el que termina dejando una tarea sin hacer.
--
-- Lo que resuelve, y que es fácil equivocar fuera de aquí:
--   · el día y la hora en `America/Bogota`, no en UTC. A las 21:00 de Bogotá en
--     UTC ya es el día siguiente: filtrar por `EXTRACT(ISODOW FROM now())`
--     daría el día equivocado todas las noches.
--   · las ventanas que CRUZAN MEDIANOCHE. Una ronda de 22:00 a 06:00 que
--     empezó ayer sigue aplicando a la 01:00 de hoy, y el día que hay que
--     mirar en `dias` es el de AYER. Por eso se evalúan dos fechas base.
--   · la tolerancia, que estira el final de la ventana.
--   · la vigencia del CONTRATO (`grupo_vigente()` de F1): contrato vencido, no
--     hay tareas. Es la misma regla de §2.5 que apaga los QR, preguntando y
--     no con un UPDATE masivo.
--   · qué VERSIÓN de la plantilla mostrar, con el ajuste del contrato por
--     delante de la general.
--
-- SECURITY DEFINER con el alcance adentro: la llama un conserje que NO tiene
-- `ver_catalogo_rondas` (no entra a la consola), pero jamás puede ver las
-- tareas de un contrato que no es suyo — se exige `auth_ve_grupo()`. No se
-- concede a `anon`: la ruta pública del QR es de F2 y decide ella qué muestra
-- sin sesión.
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
  WITH ahora AS (
    -- Una sola conversión a hora de Bogotá, de la que cuelga todo lo demás.
    SELECT (p_momento AT TIME ZONE 'America/Bogota') AS local
  ),
  base AS (
    SELECT a.*, h.local,
           -- Fechas base a evaluar: hoy y, solo si la ventana cruza
           -- medianoche, también ayer (la ventana que arrancó anoche).
           d.dia
      FROM public.ronda_asignaciones a
      CROSS JOIN ahora h
      CROSS JOIN LATERAL (
        SELECT (h.local::date) AS dia
        UNION ALL
        SELECT (h.local::date - 1) WHERE a.cruza_medianoche
      ) d
     WHERE a.punto_id = p_punto
       AND a.activo
       AND public.auth_ve_grupo(a.grupo_id)
       AND (a.vigente_desde IS NULL OR a.vigente_desde <= h.local::date)
       AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= h.local::date)
       AND public.grupo_vigente(a.grupo_id, h.local::date)
       -- El día que manda es el de la fecha base, no el de hoy: una ronda que
       -- empezó el domingo a las 22:00 aplica el domingo, aunque ya sea lunes.
       AND EXTRACT(ISODOW FROM d.dia)::smallint = ANY (a.dias)
  ),
  conventana AS (
    SELECT b.*,
           -- Ventana NULL = todo el día: de 00:00 de la fecha base a 00:00 del
           -- día siguiente.
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
      -- La plantilla se resuelve por CÓDIGO: la publicada del contrato si la
      -- hay, si no la general. Un INNER JOIN a propósito: una asignación cuyo
      -- código no tiene versión publicada no es una tarea ejecutable, y
      -- mostrarla sería ofrecer trabajo que la PWA no puede abrir.
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
         r.rol_id, r.cargo_id, r.persona_id
    FROM resuelta r
    JOIN public.ronda_tipos_actividad t ON t.id = r.tipo_actividad_id
   WHERE NOT p_solo_ahora OR r.dentro_tol
   ORDER BY CASE r.prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1
                             WHEN 'MEDIA' THEN 2 ELSE 3 END,
            r.ini, t.orden, r.plantilla_codigo, r.id
$$;
COMMENT ON FUNCTION public.ronda_tareas_aplicables(UUID, TIMESTAMPTZ, BOOLEAN) IS
  'Qué tareas aplican en un punto a una hora y un día: resuelve el día y la hora en America/Bogota, las ventanas que cruzan medianoche, la tolerancia, la vigencia del contrato y QUÉ VERSIÓN de la plantilla mostrar. Con p_solo_ahora devuelve solo lo que aplica en este momento. La usan la PWA (F4), el bot (F9) y la cola offline: un solo camino de lectura para los tres.';
GRANT EXECUTE ON FUNCTION public.ronda_tareas_aplicables(UUID, TIMESTAMPTZ, BOOLEAN) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. RLS — también en las lecturas
-- ──────────────────────────────────────────────────────────────────────────────
-- Catálogos (`grupo_id` nullable):
--   lectura   = acceso al catálogo Y (es general O el contrato está en el alcance)
--   escritura = gestiona el catálogo Y lo mismo
-- Asignaciones (`grupo_id` NOT NULL): el alcance es `auth_grupos()` a secas.
-- Un ADMIN está en todos los alcances por `auth_grupos()`, así que ve todo.
ALTER TABLE ronda_tipos_actividad   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_instructivos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_plantillas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_plantilla_pasos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_asignaciones      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ronda_tipos_actividad','ronda_instructivos','ronda_plantillas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_read ON public.%I
      FOR SELECT TO authenticated
      USING ((SELECT public.ronda_catalogo_acceso())
             AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())))$p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_write ON public.%I
      FOR ALL TO authenticated
      USING ((SELECT public.ronda_catalogo_gestiona())
             AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())))
      WITH CHECK ((SELECT public.ronda_catalogo_gestiona())
             AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())))$p$, t, t);
  END LOOP;
END $$;

-- Los pasos no llevan `grupo_id`: heredan el alcance de su plantilla (§2.4).
DROP POLICY IF EXISTS ronda_plantilla_pasos_read ON ronda_plantilla_pasos;
CREATE POLICY ronda_plantilla_pasos_read ON ronda_plantilla_pasos
  FOR SELECT TO authenticated
  USING ((SELECT public.ronda_catalogo_acceso())
         AND public.ronda_plantilla_en_alcance(plantilla_id));

DROP POLICY IF EXISTS ronda_plantilla_pasos_write ON ronda_plantilla_pasos;
CREATE POLICY ronda_plantilla_pasos_write ON ronda_plantilla_pasos
  FOR ALL TO authenticated
  USING ((SELECT public.ronda_catalogo_gestiona())
         AND public.ronda_plantilla_en_alcance(plantilla_id))
  WITH CHECK ((SELECT public.ronda_catalogo_gestiona())
         AND public.ronda_plantilla_en_alcance(plantilla_id));

DROP POLICY IF EXISTS ronda_asignaciones_read ON ronda_asignaciones;
CREATE POLICY ronda_asignaciones_read ON ronda_asignaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.ronda_asignaciones_acceso())
         AND grupo_id IN (SELECT public.auth_grupos()));

DROP POLICY IF EXISTS ronda_asignaciones_write ON ronda_asignaciones;
CREATE POLICY ronda_asignaciones_write ON ronda_asignaciones
  FOR ALL TO authenticated
  USING ((SELECT public.ronda_asignaciones_gestiona())
         AND grupo_id IN (SELECT public.auth_grupos()))
  WITH CHECK ((SELECT public.ronda_asignaciones_gestiona())
         AND grupo_id IN (SELECT public.auth_grupos()));

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. Storage: el bucket `rondas` y la carpeta de los instructivos (ADR-C)
-- ──────────────────────────────────────────────────────────────────────────────
-- Un bucket PRIVADO para todo el módulo, 50 MB por archivo, igual que `pqrs` y
-- `soporte`. El `ON CONFLICT DO UPDATE` lo hace idempotente y además deja que
-- F2 declare el mismo bucket en su migración sin que importe cuál se aplique
-- primero.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rondas', 'rondas', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

/** Id del instructivo que lleva una ruta `instructivos/{id}/{archivo}`. */
CREATE OR REPLACE FUNCTION public.ronda_instructivo_de_ruta(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF split_part(p_name, '/', 1) <> 'instructivos' THEN RETURN NULL; END IF;
  RETURN split_part(p_name, '/', 2)::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;
COMMENT ON FUNCTION public.ronda_instructivo_de_ruta(TEXT) IS
  'Saca el id del instructivo de una ruta instructivos/{instructivo_id}/{archivo} del bucket `rondas`. NULL si la ruta es de otra carpeta del bucket (ADR-C reparte el bucket en varias).';

/** ¿Puede subir material de instructivo a esta ruta? */
CREATE OR REPLACE FUNCTION public.ronda_instructivo_puede_subir(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Se admite la carpeta de un instructivo que todavía no existe (se está
  -- creando) o de uno que ya está en el alcance, igual que `pqrs_puede_subir`.
  SELECT public.ronda_instructivo_de_ruta(p_name) IS NOT NULL
     AND public.ronda_catalogo_gestiona()
     AND (NOT EXISTS (SELECT 1 FROM public.ronda_instructivos
                       WHERE id = public.ronda_instructivo_de_ruta(p_name))
          OR EXISTS (SELECT 1 FROM public.ronda_instructivos i
                      WHERE i.id = public.ronda_instructivo_de_ruta(p_name)
                        AND (i.grupo_id IS NULL OR public.auth_ve_grupo(i.grupo_id))))
$$;
GRANT EXECUTE ON FUNCTION public.ronda_instructivo_puede_subir(TEXT) TO authenticated;

/** ¿Puede leer el material de esta ruta? */
CREATE OR REPLACE FUNCTION public.ronda_instructivo_puede_ver(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ronda_instructivos i
     WHERE i.id = public.ronda_instructivo_de_ruta(p_name)
       AND (i.grupo_id IS NULL OR public.auth_ve_grupo(i.grupo_id))
  )
$$;
GRANT EXECUTE ON FUNCTION public.ronda_instructivo_puede_ver(TEXT) TO authenticated;

-- Las políticas se nombran y se acotan POR CARPETA (`instructivos/…`) a
-- propósito: el bucket `rondas` lo comparten la evidencia de las visitas (F4),
-- las fotos de los puntos (F2) y los reportes. Políticas con nombre genérico se
-- pisarían entre ramas; así cada fase trae las suyas y se suman, que es como
-- funcionan las políticas permisivas de storage.
DROP POLICY IF EXISTS ronda_instructivos_storage_select ON storage.objects;
CREATE POLICY ronda_instructivos_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rondas'
         AND (owner = (SELECT auth.uid()) OR public.ronda_instructivo_puede_ver(name)));

DROP POLICY IF EXISTS ronda_instructivos_storage_insert ON storage.objects;
CREATE POLICY ronda_instructivos_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rondas' AND public.ronda_instructivo_puede_subir(name));

DROP POLICY IF EXISTS ronda_instructivos_storage_update ON storage.objects;
CREATE POLICY ronda_instructivos_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'rondas' AND public.ronda_instructivo_puede_subir(name))
  WITH CHECK (bucket_id = 'rondas' AND public.ronda_instructivo_puede_subir(name));

DROP POLICY IF EXISTS ronda_instructivos_storage_delete ON storage.objects;
CREATE POLICY ronda_instructivos_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rondas' AND public.ronda_instructivo_puede_subir(name));

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. Auditoría: mirar sin tocar
-- ──────────────────────────────────────────────────────────────────────────────
-- Mismo criterio que PQRS: el rol Auditor lee el catálogo y no lo cambia.
UPDATE public.roles
   SET permisos = permisos || '{"ver_catalogo_rondas": true, "ver_asignaciones_rondas": true}'::jsonb
 WHERE nombre = 'Auditor';
