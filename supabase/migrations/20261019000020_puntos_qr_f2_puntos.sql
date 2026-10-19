-- =============================================================================
-- PUNTOS QR — F2: ESTRUCTURA, PUNTOS DE CONTROL Y CÓDIGO QR
-- =============================================================================
-- Segunda migración del módulo de Puntos QR, Tareas y Bot de WhatsApp. F1
-- (20261019000010) dejó el contrato como eje; esta cuelga de él lo que se pega
-- a una pared: la zona, el punto de control y el QR con su ciclo de vida.
--
-- Plan: docs/puntos-qr-whatsapp/00-exploracion-y-plan.md §2.1, §2.2, §2.7,
-- ADR-B (firma y contenido del QR) y ADR-C (medios);
-- docs/puntos-qr-whatsapp/02-complemento-2-integracion.md §2.4 (qué columna
-- lleva cada tabla), §2.5 (vigencia efectiva), §4.3 (mapa operativo) y §7
-- (huecos del complemento 1); docs/puntos-qr-whatsapp/03-nomenclatura.md, que
-- manda sobre los cuatro.
--
-- Qué entra:
--   1. `ronda_zonas`  — piso o área dentro de la sede.
--   2. `ronda_puntos` — el punto físico: código corto, ubicación con la
--      precisión con que se capturó, geocerca, horario y estado.
--   3. `ronda_qr_lotes` — tanda de impresión, con consecutivo `LQ-000001`.
--   4. `ronda_qr` — una fila por VERSIÓN del código, con `tipo_objeto` porque
--      más adelante habrá QR de activo además de QR de punto.
--   5. `ronda_eventos` — auditoría append-only, con encadenado por entidad.
--   6. `ronda_qr_vigente()` — la vigencia EFECTIVA que pide §2.5: el QR sirve
--      solo si está ACTIVO **y** su contrato está vigente. Nada de UPDATE
--      masivo de estados al vencer un contrato.
--
-- Permisos nuevos (grupo "Operación Conserjería" de lib/permisos.ts, planos y
-- en snake_case como exige §2 de la nomenclatura):
--   ver_puntos_ronda        entra a /rondas/zonas y /rondas/puntos y lee.
--   gestionar_puntos_ronda  crea y edita zonas y puntos.
--   gestionar_qr_ronda      genera, imprime y revoca códigos QR.
-- Ojo con las que se parecen y son de otro módulo: `ver_puntos_hogar` es el
-- programa de recompensas, y `ver_contratos` / `editar_contratos` es /contratos
-- (clasificación de sedes para inventario), no /rondas/contratos.
--
-- RLS: todo lo nuevo la lleva, y también en las LECTURAS, con `auth_permiso*()`
-- como exige este repositorio. El alcance es `auth_grupos()` de F1: un usuario
-- de un contrato no lee los puntos de otro.
--
-- La ruta pública es **`/q/<token>`**, no `/p/` (§3 de la nomenclatura). Los
-- documentos 00 y 02 escriben `/p/` en varios lugares; donde lo digan hay que
-- leer `/q/`. Es la decisión más irreversible del módulo: el token va impreso
-- en una placa pegada a una pared.
--
-- DECISIONES Y HUECOS, ANOTADOS A PROPÓSITO:
--   · La firma del QR es **HMAC-SHA256** (ADR-B) y la llave NO está en la base:
--     vive en variables de entorno, una por cliente y versionada, y aquí solo
--     queda `ronda_qr.firma_llave_id`, el identificador de la que se usó. Por
--     eso el `token` lo calcula la aplicación y esta migración solo valida su
--     forma. El ADR-02 (antifraude) pide Ed25519 en vez de HMAC para poder
--     verificar el QR SIN conexión sin meter el secreto en el APK: ese choque
--     sigue abierto y NO se resuelve aquí — se decide antes de imprimir placas.
--   · `ronda_qr.foto_instalacion` y `ronda_puntos.fotos_referencia` son el
--     espacio RESERVADO para el complemento 1 (§7), que no ha llegado. No se
--     diseña ninguna tabla de anclas 360°: si C1 define anclas con rumbo y
--     "salud", eso es `ronda_anclas` y es de otra fase.
--   · Nada de niveles de rigor antifraude: `grupo_reglas.nivel_antifraude`
--     sigue TEXT sin CHECK (lo cierra C1) y el punto solo lleva
--     `exige_geocerca`, que es lo que §2.1 pide para los sótanos sin señal.
--   · El bucket `rondas` del ADR-C NO se crea todavía: la evidencia es de F4.
--     Las dos columnas de arriba guardan rutas de ese bucket cuando exista.
--
-- NUMERACIÓN: este archivo es `20261019000020`. La nomenclatura (§5) reservó la
-- banda `...000010`–`...000019` para el módulo; al correr dos fases en paralelo
-- se pasó a numerar de diez en diez para que las ramas no choquen, así que la
-- banda del módulo queda `20261019000010`–`20261019000099`. Sigue por fuera del
-- tramo de las otras ramas, que llega hasta `...000005`.
--
-- IDEMPOTENTE de punta a punta: se puede volver a aplicar sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. Alfabetos y cadenas sin ambigüedades
-- ──────────────────────────────────────────────────────────────────────────────
-- Dos alfabetos, y la diferencia importa:
--   · el `token` del QR lo lee una cámara, así que usa base32 sin ambigüedades
--     (Crockford: los 10 dígitos y las 26 letras menos I, L, O y U = 32
--     símbolos exactos, 5 bits por carácter);
--   · el `codigo_manual` lo TECLEA una persona mirando una placa, así que
--     además salen el 0 y el 1, que se confunden con O y con I/L (ADR-B).
--
-- La aleatoriedad sale de `gen_random_uuid()`, que en PostgreSQL ≥ 13 usa el
-- generador fuerte del servidor; no hace falta pgcrypto. El sesgo de módulo
-- (256 no es múltiplo de 30) baja la entropía en una fracción de bit sobre los
-- ~39 bits de un código de 8 caracteres: despreciable, y de todas formas el QR
-- no se defiende con el azar sino con la firma.

CREATE OR REPLACE FUNCTION public.ronda_cadena_aleatoria(p_largo INT, p_alfabeto TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT string_agg(
           substr(p_alfabeto,
                  1 + (get_byte(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 0)
                       % length(p_alfabeto)),
                  1), '')
    FROM generate_series(1, p_largo)
$$;
COMMENT ON FUNCTION public.ronda_cadena_aleatoria(INT, TEXT) IS
  'Cadena aleatoria del largo y el alfabeto que se le pasen, con el generador fuerte de gen_random_uuid(). La usan la clave pública del punto y el código manual del QR.';

/** Clave pública del punto: 8 caracteres de base32 sin ambigüedades, libre.
    Es lo que viaja DENTRO del token del QR para poder resolver el punto sin
    meter el UUID (que no cabe en una etiqueta legible a 50×50 mm). */
CREATE OR REPLACE FUNCTION public.ronda_clave_punto_libre()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE v TEXT; i INT := 0;
BEGIN
  LOOP
    v := public.ronda_cadena_aleatoria(8, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ronda_puntos p WHERE p.clave_publica = v);
    i := i + 1;
    IF i > 50 THEN RAISE EXCEPTION 'No se pudo generar una clave pública libre para el punto'; END IF;
  END LOOP;
  RETURN v;
END $$;

/** Código manual del QR: 8 caracteres SIN I, L, O, U, 0 ni 1, libre. */
CREATE OR REPLACE FUNCTION public.ronda_codigo_manual_libre()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE v TEXT; i INT := 0;
BEGIN
  LOOP
    v := public.ronda_cadena_aleatoria(8, '23456789ABCDEFGHJKMNPQRSTVWXYZ');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.ronda_qr q WHERE q.codigo_manual = v);
    i := i + 1;
    IF i > 50 THEN RAISE EXCEPTION 'No se pudo generar un código manual libre'; END IF;
  END LOOP;
  RETURN v;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. `ronda_zonas` — piso o área dentro de la sede
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` y `sede_id` NOT NULL los dos, como manda §2.4, y desnormalizados
-- aunque `grupo_id` sea derivable de la sede: es la columna por la que filtra la
-- RLS y un JOIN por fila en una política se paga en cada consulta.
-- `puesto_id` es opcional: la zona puede colgar del puesto comprado al cliente.
CREATE TABLE IF NOT EXISTS ronda_zonas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id   UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id    UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  -- La llave foránea a `puestos` se agrega abajo SOLO SI la tabla existe: la
  -- migración de programación (20261018000005) tampoco está aplicada en la base
  -- y exigirla aquí dejaría F2 sin poder correr. Ver el bloque de §1.1.
  puesto_id  UUID,
  codigo     VARCHAR(40) NOT NULL,
  nombre     VARCHAR(200) NOT NULL,
  piso       VARCHAR(20),                       -- texto: hay "SÓTANO 2", "MEZZANINE"
  orden      INT NOT NULL DEFAULT 0,            -- orden de recorrido
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_zonas_codigo ON ronda_zonas(sede_id, codigo);
CREATE INDEX IF NOT EXISTS idx_ronda_zonas_grupo  ON ronda_zonas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_zonas_sede   ON ronda_zonas(sede_id, orden, nombre);
CREATE INDEX IF NOT EXISTS idx_ronda_zonas_puesto ON ronda_zonas(puesto_id);
CREATE INDEX IF NOT EXISTS idx_ronda_zonas_upd    ON ronda_zonas(updated_at);

COMMENT ON TABLE ronda_zonas IS
  'Zona de la sede (piso, torre, área) donde se agrupan los puntos de control. grupo_id y sede_id van desnormalizados: son las columnas por las que filtra la RLS.';
COMMENT ON COLUMN ronda_zonas.piso IS
  'Texto libre a propósito: en la operación hay "SÓTANO 2" y "MEZZANINE", que un entero no representa.';
COMMENT ON COLUMN ronda_zonas.puesto_id IS
  'Puesto comprado al cliente del que cuelga la zona, cuando aplica. La llave foránea existe solo si la tabla `puestos` (migración de programación) ya está aplicada.';

-- ── 1.1 La llave foránea a `puestos`, cuando esa tabla exista ────────────────
-- `puestos` la crea 20261018000005 (programación, fase 1), que todavía NO está
-- aplicada. En vez de bloquear F2, la referencia se agrega cuando la tabla
-- aparezca: volver a correr esta migración después de aplicar programación deja
-- la llave puesta. Idempotente en los dos escenarios.
DO $$ BEGIN
  IF to_regclass('public.puestos') IS NOT NULL THEN
    BEGIN
      ALTER TABLE ronda_zonas
        ADD CONSTRAINT ronda_zonas_puesto_fk
        FOREIGN KEY (puesto_id) REFERENCES puestos(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN null; END;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. `ronda_puntos` — el punto de control físico
-- ──────────────────────────────────────────────────────────────────────────────
-- Lo que el mapa operativo (§4.3) espera de un punto y por eso está aquí:
-- ubicación con la precisión del GPS **del momento en que se capturó** (si fue
-- mala, la geocerca no es confiable y hay que poder decirlo), estado para
-- pintarlo en gris cuando el contrato no está vigente, piso y zona para los
-- planos por piso, y `orden` para el recorrido. Los polígonos de sede y los
-- planos dependen del levantamiento 2D/3D, que NO existe en el repositorio y
-- queda pendiente: el mapa arranca con `sedes.lat/lng` y el punto con radio.
CREATE TABLE IF NOT EXISTS ronda_puntos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id           UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  zona_id           UUID REFERENCES ronda_zonas(id) ON DELETE SET NULL,
  codigo            VARCHAR(20) NOT NULL,            -- código corto legible, único por sede
  -- Identificador público e INMUTABLE que viaja dentro del token del QR. No es
  -- el `codigo` (que la operación puede renombrar) ni el UUID (que no cabe).
  clave_publica     CHAR(8) NOT NULL,
  nombre            VARCHAR(200) NOT NULL,
  descripcion       TEXT,                            -- cómo llegar
  piso              VARCHAR(20),
  lat               DECIMAL(10,7),
  lng               DECIMAL(10,7),
  precision_metros  DECIMAL(8,2),
  geocerca_metros   SMALLINT NOT NULL DEFAULT 30 CHECK (geocerca_metros BETWEEN 5 AND 2000),
  exige_geocerca    BOOLEAN NOT NULL DEFAULT true,
  -- Hueco del complemento 1 (§7): rutas en el bucket `rondas` del ADR-C, que
  -- se crea en F4. SIN tabla de anclas 360°: eso lo define C1.
  fotos_referencia  TEXT[] NOT NULL DEFAULT '{}'::text[],
  horario_dias      SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'::smallint[],
  horario_desde     TIME,
  horario_hasta     TIME,
  orden             INT NOT NULL DEFAULT 0,
  estado            VARCHAR(12) NOT NULL DEFAULT 'BORRADOR'
                    CHECK (estado IN ('BORRADOR','ACTIVO','SUSPENDIDO','RETIRADO')),
  sede_nombre       VARCHAR(400),                    -- desnormalizado para listados
  created_by        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ronda_puntos_clave_chk CHECK (clave_publica ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  CONSTRAINT ronda_puntos_lat_chk   CHECK (lat IS NULL OR lat BETWEEN -90  AND 90),
  CONSTRAINT ronda_puntos_lng_chk   CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  CONSTRAINT ronda_puntos_prec_chk  CHECK (precision_metros IS NULL OR precision_metros >= 0),
  -- Las dos coordenadas o ninguna: media coordenada no ubica nada.
  CONSTRAINT ronda_puntos_coord_chk CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT ronda_puntos_horario_chk
    CHECK (horario_desde IS NULL OR horario_hasta IS NULL OR horario_hasta <> horario_desde),
  -- 1 = lunes … 7 = domingo, igual que `puestos.dias_cobertura`.
  CONSTRAINT ronda_puntos_dias_chk
    CHECK (horario_dias <@ '{1,2,3,4,5,6,7}'::smallint[] AND array_length(horario_dias, 1) >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_puntos_codigo ON ronda_puntos(sede_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_puntos_clave  ON ronda_puntos(clave_publica);
CREATE INDEX IF NOT EXISTS idx_ronda_puntos_grupo  ON ronda_puntos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_puntos_sede   ON ronda_puntos(sede_id, orden, nombre);
CREATE INDEX IF NOT EXISTS idx_ronda_puntos_zona   ON ronda_puntos(zona_id);
CREATE INDEX IF NOT EXISTS idx_ronda_puntos_estado ON ronda_puntos(estado);
CREATE INDEX IF NOT EXISTS idx_ronda_puntos_upd    ON ronda_puntos(updated_at);

COMMENT ON TABLE ronda_puntos IS
  'Punto de control físico: lo que tiene pegado un QR en la pared. Una visita deriva su contrato DE AQUÍ, porque persona_vinculaciones todavía no lleva grupo_id (pendiente de aprobación, F1).';
COMMENT ON COLUMN ronda_puntos.clave_publica IS
  'Identificador público e inmutable de 8 caracteres (base32 sin I, L, O ni U) que viaja dentro del token del QR. NO es el código que ve la operación: renombrar el punto no invalida las placas impresas.';
COMMENT ON COLUMN ronda_puntos.precision_metros IS
  'Precisión del GPS en el momento en que se capturó la ubicación. Si fue mala, la geocerca de este punto no es confiable y la pantalla lo avisa.';
COMMENT ON COLUMN ronda_puntos.geocerca_metros IS
  'Radio de la geocerca del punto, en metros. Por defecto 30; grupo_reglas.geocerca_radio_m es el valor por defecto del contrato y este lo sobreescribe.';
COMMENT ON COLUMN ronda_puntos.exige_geocerca IS
  'FALSE para los puntos sin señal (sótanos, cuartos técnicos), donde exigir la geocerca bloquearía la visita.';
COMMENT ON COLUMN ronda_puntos.fotos_referencia IS
  'HUECO RESERVADO del complemento 1 (§7): rutas de las fotos de referencia en el bucket `rondas` (ADR-C), que se crea en F4. Si C1 define anclas 360° con rumbo, eso será una tabla propia; no inventarla aquí.';
COMMENT ON COLUMN ronda_puntos.horario_dias IS
  'Días en que aplica el punto. 1 = lunes … 7 = domingo, la misma convención de puestos.dias_cobertura.';
COMMENT ON COLUMN ronda_puntos.estado IS
  'BORRADOR (se está levantando) · ACTIVO · SUSPENDIDO · RETIRADO. Que el punto SIRVA depende además de la vigencia del contrato: ver ronda_qr_vigente().';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `ronda_qr_lotes` — tanda de impresión
-- ──────────────────────────────────────────────────────────────────────────────
-- El consecutivo sale de una SEQUENCE, nunca de COUNT(*)+1 ni de un contador
-- por fecha (§4 de la nomenclatura): dos personas generando lotes en el mismo
-- segundo colisionan. Formato `LQ-000001`.
CREATE SEQUENCE IF NOT EXISTS ronda_lote_seq;

CREATE TABLE IF NOT EXISTS ronda_qr_lotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero       VARCHAR(12) NOT NULL,
  grupo_id     UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id      UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  nombre       VARCHAR(200),
  formato      VARCHAR(20) NOT NULL
               CHECK (formato IN ('STICKER_8X8','PLACA_A6','PLACA_A5','HOJA_A4')),
  cantidad     INT NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  pdf_path     TEXT,
  generado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  generado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observacion  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_lotes_numero ON ronda_qr_lotes(numero);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_lotes_grupo ON ronda_qr_lotes(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_lotes_sede  ON ronda_qr_lotes(sede_id, generado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_lotes_upd   ON ronda_qr_lotes(updated_at);

ALTER TABLE ronda_qr_lotes ALTER COLUMN numero SET DEFAULT
  'LQ-' || lpad(nextval('ronda_lote_seq')::text, 6, '0');

COMMENT ON TABLE ronda_qr_lotes IS
  'Tanda de impresión de QR: el arte es del CONTRATO (corregido por el complemento 2, §2.4), el lugar es la sede. El PDF se arma en la consola; `pdf_path` queda para cuando el bucket `rondas` del ADR-C exista (F4).';
COMMENT ON COLUMN ronda_qr_lotes.formato IS
  'STICKER_8X8 (sticker de 8×8 cm) · PLACA_A6 · PLACA_A5 · HOJA_A4 (varios por hoja, para imprimir en lote). En todos el QR se imprime a 50×50 mm como mínimo, que es la medida con la que el ADR-B lo da por legible.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `ronda_qr` — el código y su ciclo de vida
-- ──────────────────────────────────────────────────────────────────────────────
-- Un punto tiene MUCHAS filas de QR, una por versión; solo una ACTIVO.
--
-- `tipo_objeto` nace ya en F2 aunque hoy solo haya QR de punto: más adelante el
-- mismo flujo tiene que servir para el QR de un activo fijo del cliente
-- (`activos`, §3 del complemento 2), y agregar la columna después obligaría a
-- reinterpretar las filas ya emitidas. Mientras `activos` no exista, el CHECK
-- deja claro que PUNTO es el único tipo que se puede insertar; cuando llegue esa
-- fase agrega `activo_id` con su FK y amplía el CHECK.
--
-- El `token` lo calcula la APLICACIÓN, no la base: la firma es
-- HMAC-SHA256(llave_cliente_vN, "<v>|<punto_id>|<version>") y la llave vive en
-- variables de entorno (ADR-B). Aquí solo queda `firma_llave_id` —cuál se
-- usó— y la validación de la forma del token. Rotar la llave no invalida lo
-- impreso: los tokens ya emitidos siguen verificando con su `firma_llave_id`.
CREATE TABLE IF NOT EXISTS ronda_qr (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_objeto          VARCHAR(10) NOT NULL DEFAULT 'PUNTO'
                       CHECK (tipo_objeto IN ('PUNTO','ACTIVO')),
  punto_id             UUID REFERENCES ronda_puntos(id) ON DELETE CASCADE,
  grupo_id             UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id              UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  version              SMALLINT NOT NULL CHECK (version >= 1),
  token                VARCHAR(64) NOT NULL,
  firma_llave_id       VARCHAR(40) NOT NULL,
  codigo_manual        CHAR(8) NOT NULL,
  estado               VARCHAR(12) NOT NULL DEFAULT 'BORRADOR'
                       CHECK (estado IN ('BORRADOR','ACTIVO','REVOCADO','REEMPLAZADO')),
  reemplaza_a          UUID REFERENCES ronda_qr(id) ON DELETE SET NULL,
  motivo_cambio        VARCHAR(200),
  instalado_at         TIMESTAMPTZ,
  instalado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  instalado_persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  instalado_canal      VARCHAR(10) CHECK (instalado_canal IS NULL OR instalado_canal IN ('CONSOLA','APP','WHATSAPP')),
  instalado_nombre     VARCHAR(200),
  -- Hueco del complemento 1 (§7): una sola ruta, como ya estaba en el documento
  -- 00. Si C1 pide un conjunto 360°, se decide entonces; no se adelanta.
  foto_instalacion     TEXT,
  lat                  DECIMAL(10,7),
  lng                  DECIMAL(10,7),
  precision_metros     DECIMAL(8,2),
  lote_id              UUID REFERENCES ronda_qr_lotes(id) ON DELETE SET NULL,
  impresiones          SMALLINT NOT NULL DEFAULT 0 CHECK (impresiones >= 0),
  revocado_at          TIMESTAMPTZ,
  revocado_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Token: base32 sin ambigüedades. Lo lee una cámara, así que el 0 y el 1 sí
  -- entran; lo que no entran son I, L, O y U.
  CONSTRAINT ronda_qr_token_chk  CHECK (token ~ '^[0-9A-HJKMNP-TV-Z]{12,64}$'),
  -- Código manual: lo teclea una persona, así que fuera también el 0 y el 1.
  CONSTRAINT ronda_qr_manual_chk CHECK (codigo_manual ~ '^[2-9A-HJKMNP-TV-Z]{8}$'),
  CONSTRAINT ronda_qr_objeto_chk CHECK (
    (tipo_objeto = 'PUNTO' AND punto_id IS NOT NULL)
    OR (tipo_objeto <> 'PUNTO' AND punto_id IS NULL)
  ),
  CONSTRAINT ronda_qr_lat_chk  CHECK (lat IS NULL OR lat BETWEEN -90  AND 90),
  CONSTRAINT ronda_qr_lng_chk  CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  CONSTRAINT ronda_qr_coord_chk CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT ronda_qr_revocado_chk CHECK (
    estado NOT IN ('REVOCADO','REEMPLAZADO') OR revocado_at IS NOT NULL
  ),
  CONSTRAINT ronda_qr_no_se_reemplaza_solo CHECK (reemplaza_a IS NULL OR reemplaza_a <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_token  ON ronda_qr(token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_manual ON ronda_qr(codigo_manual);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_version ON ronda_qr(punto_id, version)
  WHERE punto_id IS NOT NULL;
-- La invariante del módulo: UN SOLO QR activo por punto. Es un índice único
-- parcial, no una regla de la aplicación, porque dos activos a la vez significan
-- dos placas válidas en la misma pared y eso no se puede permitir ni con una
-- carrera entre dos pestañas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_activo ON ronda_qr(punto_id)
  WHERE estado = 'ACTIVO' AND punto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_qr_grupo ON ronda_qr(grupo_id);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_sede  ON ronda_qr(sede_id);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_punto ON ronda_qr(punto_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_lote  ON ronda_qr(lote_id);
CREATE INDEX IF NOT EXISTS idx_ronda_qr_upd   ON ronda_qr(updated_at);

COMMENT ON TABLE ronda_qr IS
  'Una fila por VERSIÓN del código de un punto; solo una ACTIVO (índice único parcial ux_ronda_qr_activo). Revocar NO borra: deja la fila en REVOCADO y la siguiente versión nace al lado, para que un QR fotografiado antes del cambio se pueda rechazar.';
COMMENT ON COLUMN ronda_qr.tipo_objeto IS
  'PUNTO hoy; ACTIVO queda previsto para el QR del activo fijo del cliente. Mientras `activos` no exista, el CHECK ronda_qr_objeto_chk solo deja insertar PUNTO; esa fase agrega activo_id y amplía el CHECK.';
COMMENT ON COLUMN ronda_qr.token IS
  'Lo que viaja en el QR, dentro de la URL /q/<token>: <v><clave_publica del punto><version><firma>. La firma es HMAC-SHA256 y la calcula la APLICACIÓN; la llave NO está en la base (ADR-B).';
COMMENT ON COLUMN ronda_qr.firma_llave_id IS
  'IDENTIFICADOR de la llave HMAC con la que se firmó (p. ej. cli-demo-v1), nunca el secreto: el secreto vive en variables de entorno, una por cliente y versionada, y rota. Así rotar la llave no invalida lo ya impreso.';
COMMENT ON COLUMN ronda_qr.codigo_manual IS
  'Código de 8 caracteres que se imprime bajo el QR y se teclea cuando la cámara falla (se muestra en grupos de cuatro: K7M4-QX9T). Abre el MISMO flujo, marcando que la apertura fue manual.';
COMMENT ON COLUMN ronda_qr.foto_instalacion IS
  'HUECO RESERVADO del complemento 1 (§7): ruta de la foto de instalación en el bucket `rondas` (ADR-C), que se crea en F4.';
COMMENT ON COLUMN ronda_qr.impresiones IS
  'Cuántas veces se imprimió esta versión. Cada impresión queda además como evento IMPRIMIR en ronda_eventos, con el formato y el lote.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `ronda_eventos` — auditoría append-only (§2.7)
-- ──────────────────────────────────────────────────────────────────────────────
-- Solo se agrega: la RLS no concede UPDATE ni DELETE y la tabla no tiene
-- `updated_at`. Complementa `actividad_log`, que seguirá recibiendo lo de
-- siempre pero no es append-only ni encadenado.
--
-- `grupo_id` y `sede_id` son NULLABLE a propósito (§2.4: "lo que se sepa en el
-- momento"): un intento de abrir un token inválido no tiene contrato conocido, y
-- justo ese evento es el que hay que poder registrar.
CREATE TABLE IF NOT EXISTS ronda_eventos (
  id               BIGSERIAL PRIMARY KEY,
  grupo_id         UUID REFERENCES grupos_contrato(id) ON DELETE SET NULL,
  sede_id          UUID REFERENCES sedes(id) ON DELETE SET NULL,
  entidad          VARCHAR(40) NOT NULL,
  entidad_id       UUID,
  accion           VARCHAR(40) NOT NULL,
  actor_tipo       VARCHAR(10) NOT NULL DEFAULT 'SISTEMA'
                   CHECK (actor_tipo IN ('USUARIO','PERSONA','BOT','SISTEMA','ANONIMO')),
  actor_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  actor_persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  actor_nombre     VARCHAR(200),
  canal            VARCHAR(10)
                   CHECK (canal IS NULL OR canal IN ('CONSOLA','APP','WHATSAPP','PUBLICO','SISTEMA')),
  detalle          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip               INET,
  hash_anterior    CHAR(64),
  hash             CHAR(64),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ronda_eventos_entidad ON ronda_eventos(entidad, entidad_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_eventos_fecha   ON ronda_eventos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_eventos_grupo   ON ronda_eventos(grupo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ronda_eventos_accion  ON ronda_eventos(accion, created_at DESC);

COMMENT ON TABLE ronda_eventos IS
  'Auditoría del módulo, SOLO AGREGAR: la RLS no concede UPDATE ni DELETE. Encadenada por entidad con SHA-256. Aquí quedan los rechazos de la ruta pública /q/<token>, que son la mejor señal de fraude y hoy no se registran en ningún lado.';
COMMENT ON COLUMN ronda_eventos.actor_tipo IS
  'USUARIO · PERSONA (sin cuenta) · BOT · SISTEMA · ANONIMO (la ruta pública, donde todavía no se sabe quién escaneó).';
COMMENT ON COLUMN ronda_eventos.hash IS
  'sha256(hash_anterior || entidad || entidad_id || accion || detalle || created_at), calculado en un trigger BEFORE INSERT. El encadenado es POR ENTIDAD: cada punto y cada QR tienen su propia cadena.';

-- ── 5.1 Encadenado ───────────────────────────────────────────────────────────
-- El candado de aviso por entidad es lo que evita que dos inserciones
-- simultáneas del mismo punto lean el mismo `hash_anterior` y rompan la cadena.
-- Es por entidad, no global, así que no serializa el módulo entero.
CREATE OR REPLACE FUNCTION public.ronda_eventos_encadenar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prev CHAR(64);
BEGIN
  IF NEW.created_at IS NULL THEN NEW.created_at := NOW(); END IF;
  IF NEW.entidad_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.entidad), hashtext(NEW.entidad_id::text));
    SELECT e.hash INTO v_prev
      FROM public.ronda_eventos e
     WHERE e.entidad = NEW.entidad AND e.entidad_id = NEW.entidad_id
     ORDER BY e.id DESC
     LIMIT 1;
  END IF;
  NEW.hash_anterior := v_prev;
  NEW.hash := encode(sha256(convert_to(
                COALESCE(v_prev, '')
                || NEW.entidad
                || COALESCE(NEW.entidad_id::text, '')
                || NEW.accion
                || COALESCE(NEW.detalle::text, '')
                || NEW.created_at::text, 'UTF8')), 'hex');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_eventos_hash ON ronda_eventos;
CREATE TRIGGER tr_ronda_eventos_hash BEFORE INSERT ON ronda_eventos
  FOR EACH ROW EXECUTE FUNCTION public.ronda_eventos_encadenar();

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Derivaciones y coherencia (triggers)
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` se DERIVA de la sede, no se recibe: si la aplicación lo mandara, un
-- error de pantalla podría meter un punto de un contrato dentro de otro, y la
-- RLS filtra justamente por esa columna. Los BEFORE triggers corren ANTES del
-- WITH CHECK de la política, así que el valor derivado también se verifica
-- contra el alcance del usuario.

CREATE OR REPLACE FUNCTION public.ronda_zonas_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_grupo UUID; v_ok BOOLEAN;
BEGIN
  SELECT s.grupo_id INTO v_grupo FROM public.sedes s WHERE s.id = NEW.sede_id;
  IF v_grupo IS NULL THEN
    RAISE EXCEPTION 'La sede % no existe o no tiene contrato', NEW.sede_id;
  END IF;
  NEW.grupo_id := v_grupo;
  -- La comprobación del puesto va por SQL dinámico para que el trigger no
  -- dependa de que `puestos` exista (ver §1.1): sin la tabla no hay puestos que
  -- asignar, y con ella la coherencia se exige igual.
  IF NEW.puesto_id IS NOT NULL AND to_regclass('public.puestos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.puestos p WHERE p.id = $1 AND p.sede_id = $2)'
      INTO v_ok USING NEW.puesto_id, NEW.sede_id;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'El puesto no pertenece a la sede de la zona';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_zonas_derivar ON ronda_zonas;
CREATE TRIGGER tr_ronda_zonas_derivar BEFORE INSERT OR UPDATE ON ronda_zonas
  FOR EACH ROW EXECUTE FUNCTION public.ronda_zonas_derivar();

CREATE OR REPLACE FUNCTION public.ronda_puntos_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s RECORD;
BEGIN
  SELECT sd.grupo_id, sd.nombre INTO s FROM public.sedes sd WHERE sd.id = NEW.sede_id;
  IF s.grupo_id IS NULL THEN
    RAISE EXCEPTION 'La sede % no existe o no tiene contrato', NEW.sede_id;
  END IF;
  NEW.grupo_id    := s.grupo_id;
  NEW.sede_nombre := s.nombre;
  IF NEW.zona_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ronda_zonas z
                      WHERE z.id = NEW.zona_id AND z.sede_id = NEW.sede_id) THEN
    RAISE EXCEPTION 'La zona no pertenece a la sede del punto';
  END IF;
  -- La clave pública es INMUTABLE: cambiarla dejaría muertas las placas ya
  -- pegadas, que es justo lo que el módulo no puede permitirse.
  IF TG_OP = 'INSERT' THEN
    IF NEW.clave_publica IS NULL THEN
      NEW.clave_publica := public.ronda_clave_punto_libre();
    END IF;
  ELSE
    NEW.clave_publica := OLD.clave_publica;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_puntos_derivar ON ronda_puntos;
CREATE TRIGGER tr_ronda_puntos_derivar BEFORE INSERT OR UPDATE ON ronda_puntos
  FOR EACH ROW EXECUTE FUNCTION public.ronda_puntos_derivar();

CREATE OR REPLACE FUNCTION public.ronda_qr_lotes_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_grupo UUID;
BEGIN
  SELECT s.grupo_id INTO v_grupo FROM public.sedes s WHERE s.id = NEW.sede_id;
  IF v_grupo IS NULL THEN
    RAISE EXCEPTION 'La sede % no existe o no tiene contrato', NEW.sede_id;
  END IF;
  NEW.grupo_id := v_grupo;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_qr_lotes_derivar ON ronda_qr_lotes;
CREATE TRIGGER tr_ronda_qr_lotes_derivar BEFORE INSERT OR UPDATE ON ronda_qr_lotes
  FOR EACH ROW EXECUTE FUNCTION public.ronda_qr_lotes_derivar();

CREATE OR REPLACE FUNCTION public.ronda_qr_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p RECORD;
BEGIN
  -- El token y el código manual van impresos en una placa: una vez emitidos no
  -- se editan, y el QR no se puede mudar de punto. Para cambiar cualquiera de
  -- las tres cosas se revoca la versión y se emite la siguiente. Esto va
  -- PRIMERO para que lo que se derive abajo se derive del punto de verdad.
  IF TG_OP = 'UPDATE' THEN
    NEW.token         := OLD.token;
    NEW.codigo_manual := OLD.codigo_manual;
    NEW.version       := OLD.version;
    NEW.punto_id      := OLD.punto_id;
    NEW.tipo_objeto   := OLD.tipo_objeto;
  END IF;

  IF NEW.tipo_objeto = 'PUNTO' THEN
    SELECT pt.grupo_id, pt.sede_id INTO p
      FROM public.ronda_puntos pt WHERE pt.id = NEW.punto_id;
    IF p.grupo_id IS NULL THEN
      RAISE EXCEPTION 'El punto % no existe', NEW.punto_id;
    END IF;
    NEW.grupo_id := p.grupo_id;
    NEW.sede_id  := p.sede_id;
    IF TG_OP = 'INSERT' AND NEW.version IS NULL THEN
      SELECT COALESCE(MAX(q.version), 0) + 1 INTO NEW.version
        FROM public.ronda_qr q WHERE q.punto_id = NEW.punto_id;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.codigo_manual IS NULL THEN
    NEW.codigo_manual := public.ronda_codigo_manual_libre();
  END IF;
  IF NEW.estado IN ('REVOCADO','REEMPLAZADO') AND NEW.revocado_at IS NULL THEN
    NEW.revocado_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ronda_qr_derivar ON ronda_qr;
CREATE TRIGGER tr_ronda_qr_derivar BEFORE INSERT OR UPDATE ON ronda_qr
  FOR EACH ROW EXECUTE FUNCTION public.ronda_qr_derivar();

-- Nota de por qué `version`, `codigo_manual` y `clave_publica` pueden ser
-- NOT NULL aunque los llene un trigger: en PostgreSQL los triggers BEFORE ROW
-- corren ANTES de que se verifiquen NOT NULL, los CHECK y el WITH CHECK de la
-- política, así que la aplicación puede omitirlos y la base los completa.

-- ── 6.1 `updated_at` ─────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ronda_zonas','ronda_puntos','ronda_qr_lotes','ronda_qr'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Vigencia EFECTIVA del QR (§2.5 del complemento 2)
-- ──────────────────────────────────────────────────────────────────────────────
-- "Contrato vencido apaga sus QR" se implementa PREGUNTANDO, no con un UPDATE
-- masivo de estados: un UPDATE pierde el estado real de cada QR y no se puede
-- deshacer al renovar. Al renovar el contrato, los QR vuelven a servir sin que
-- se toque ni una fila, que es exactamente lo que pide §1.2 del complemento
-- ("al renovar se conservan histórico, QR y referencias 360°").
--
-- La consulta la hacen la ruta pública /q/<token>, la RPC de apertura de visita
-- (F4) y el bot (F9). La consola muestra el punto en gris, como dice §3.1.
CREATE OR REPLACE FUNCTION public.ronda_qr_vigente(p_qr UUID, p_fecha DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT q.estado = 'ACTIVO' AND public.grupo_vigente(q.grupo_id, p_fecha)
      FROM public.ronda_qr q
     WHERE q.id = p_qr
  ), false)
$$;
COMMENT ON FUNCTION public.ronda_qr_vigente(UUID, DATE) IS
  'TRUE si el QR sirve: está ACTIVO Y su contrato está vigente (grupo_vigente() de F1). Vigencia CALCULADA, nunca un UPDATE masivo de estados: al renovar el contrato los QR vuelven a servir sin tocar ninguna fila (§2.5 del complemento 2).';
GRANT EXECUTE ON FUNCTION public.ronda_qr_vigente(UUID, DATE) TO authenticated;

/** Lo mismo, pero resolviendo por token. Es lo que consulta /q/<token>. */
CREATE OR REPLACE FUNCTION public.ronda_qr_por_token(p_token TEXT)
RETURNS TABLE (
  qr_id UUID, punto_id UUID, grupo_id UUID, sede_id UUID,
  version SMALLINT, estado TEXT, firma_llave_id TEXT,
  codigo_manual TEXT, vigente BOOLEAN, contrato_vigente BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.punto_id, q.grupo_id, q.sede_id, q.version, q.estado::text,
         q.firma_llave_id::text, q.codigo_manual::text,
         q.estado = 'ACTIVO' AND public.grupo_vigente(q.grupo_id),
         public.grupo_vigente(q.grupo_id)
    FROM public.ronda_qr q
   WHERE q.token = upper(btrim(p_token))
$$;
COMMENT ON FUNCTION public.ronda_qr_por_token(TEXT) IS
  'Resuelve un token a su QR y dice si sirve. NO verifica la firma HMAC: eso lo hace la aplicación, que es la única que tiene la llave (ADR-B). Devuelve cero filas si el token no existe.';

-- PostgreSQL concede EXECUTE a PUBLIC por omisión en cada función nueva, y
-- `anon` está dentro de PUBLIC. Estas cuatro son SECURITY DEFINER y pasan por
-- encima de la RLS, así que se les quita: el resolutor de tokens lo llama la
-- ruta pública con la llave de servicio (que no pasa por estos GRANT), y los
-- generadores de códigos no tienen por qué poder llamarse desde el navegador.
REVOKE ALL ON FUNCTION public.ronda_qr_por_token(TEXT)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ronda_cadena_aleatoria(INT, TEXT)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ronda_clave_punto_libre()           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ronda_codigo_manual_libre()         FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Acceso al módulo de puntos
-- ──────────────────────────────────────────────────────────────────────────────
-- Tres funciones, al estilo de `grupo_acceso()` / `grupo_gestiona()` de F1, para
-- que las políticas no repitan la lista de claves.
CREATE OR REPLACE FUNCTION public.ronda_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_puntos_ronda,gestionar_puntos_ronda,gestionar_qr_ronda}'::text[])
$$;
COMMENT ON FUNCTION public.ronda_acceso() IS
  'Entra a las pantallas de zonas, puntos y QR y lee lo que esté en su alcance de contratos.';
GRANT EXECUTE ON FUNCTION public.ronda_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_gestiona_puntos()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_puntos_ronda')
$$;
COMMENT ON FUNCTION public.ronda_gestiona_puntos() IS
  'Crea y edita zonas y puntos de control.';
GRANT EXECUTE ON FUNCTION public.ronda_gestiona_puntos() TO authenticated;

CREATE OR REPLACE FUNCTION public.ronda_gestiona_qr()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_qr_ronda')
$$;
COMMENT ON FUNCTION public.ronda_gestiona_qr() IS
  'Genera, imprime y revoca códigos QR. Va aparte de gestionar_puntos_ronda porque emitir un código es lo que manda a imprimir placas.';
GRANT EXECUTE ON FUNCTION public.ronda_gestiona_qr() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. Revocar y reemplazar un QR
-- ──────────────────────────────────────────────────────────────────────────────
-- La máquina de estados va en la base, no en la pantalla: revocar tiene que
-- dejar la fila anterior en REVOCADO (o REEMPLAZADO) y liberar el índice único
-- parcial para que nazca la siguiente versión. El token de la versión nueva lo
-- calcula la aplicación —es la única que tiene la llave HMAC—, así que esta RPC
-- solo cierra la anterior y deja constancia.
CREATE OR REPLACE FUNCTION public.ronda_qr_revocar(
  p_qr     UUID,
  p_motivo TEXT DEFAULT NULL,
  p_estado TEXT DEFAULT 'REVOCADO'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q RECORD;
BEGIN
  IF p_estado NOT IN ('REVOCADO','REEMPLAZADO') THEN
    RAISE EXCEPTION 'Estado no válido para revocar: %', p_estado;
  END IF;
  SELECT * INTO q FROM public.ronda_qr WHERE id = p_qr FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El código QR no existe'; END IF;
  IF NOT public.ronda_gestiona_qr() OR NOT public.auth_ve_grupo(q.grupo_id) THEN
    RAISE EXCEPTION 'No tienes permiso para revocar códigos de ese contrato';
  END IF;
  IF q.estado IN ('REVOCADO','REEMPLAZADO') THEN
    RETURN q.id;                      -- idempotente: ya estaba cerrado
  END IF;

  UPDATE public.ronda_qr
     SET estado        = p_estado,
         motivo_cambio = COALESCE(p_motivo, motivo_cambio),
         revocado_at   = NOW(),
         revocado_por  = (SELECT auth.uid())
   WHERE id = p_qr;

  INSERT INTO public.ronda_eventos
    (grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_usuario_id, canal, detalle)
  VALUES
    (q.grupo_id, q.sede_id, 'ronda_qr', q.id, p_estado, 'USUARIO', (SELECT auth.uid()), 'CONSOLA',
     jsonb_build_object('version', q.version, 'motivo', p_motivo,
                        'codigo_manual', q.codigo_manual));
  RETURN q.id;
END $$;
COMMENT ON FUNCTION public.ronda_qr_revocar(UUID, TEXT, TEXT) IS
  'Cierra una versión de QR (REVOCADO o REEMPLAZADO), libera el índice ux_ronda_qr_activo y deja el evento. El token de la versión siguiente lo calcula la aplicación, que es la única que tiene la llave HMAC. Idempotente: revocar dos veces no falla.';
GRANT EXECUTE ON FUNCTION public.ronda_qr_revocar(UUID, TEXT, TEXT) TO authenticated;

/** Siguiente número de versión de un punto. La usa la consola al reemplazar. */
CREATE OR REPLACE FUNCTION public.ronda_qr_siguiente_version(p_punto UUID)
RETURNS SMALLINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (COALESCE(MAX(q.version), 0) + 1)::smallint
    FROM public.ronda_qr q WHERE q.punto_id = p_punto
$$;
GRANT EXECUTE ON FUNCTION public.ronda_qr_siguiente_version(UUID) TO authenticated;

/** Suma una impresión y la registra. El contador por sí solo no dice cuándo ni
    en qué formato se imprimió; el evento sí. */
CREATE OR REPLACE FUNCTION public.ronda_qr_registrar_impresion(
  p_qr      UUID,
  p_formato TEXT,
  p_lote    UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q RECORD;
BEGIN
  SELECT * INTO q FROM public.ronda_qr WHERE id = p_qr;
  IF NOT FOUND THEN RAISE EXCEPTION 'El código QR no existe'; END IF;
  IF NOT public.ronda_gestiona_qr() OR NOT public.auth_ve_grupo(q.grupo_id) THEN
    RAISE EXCEPTION 'No tienes permiso para imprimir códigos de ese contrato';
  END IF;

  UPDATE public.ronda_qr
     SET impresiones = impresiones + 1,
         lote_id     = COALESCE(p_lote, lote_id)
   WHERE id = p_qr;

  INSERT INTO public.ronda_eventos
    (grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_usuario_id, canal, detalle)
  VALUES
    (q.grupo_id, q.sede_id, 'ronda_qr', q.id, 'IMPRIMIR', 'USUARIO', (SELECT auth.uid()), 'CONSOLA',
     jsonb_build_object('formato', p_formato, 'lote_id', p_lote, 'version', q.version));
END $$;
COMMENT ON FUNCTION public.ronda_qr_registrar_impresion(UUID, TEXT, UUID) IS
  'Suma una impresión al QR y deja el evento IMPRIMIR con el formato y el lote. Se llama al confirmar la impresión, no al abrir la vista previa.';
GRANT EXECUTE ON FUNCTION public.ronda_qr_registrar_impresion(UUID, TEXT, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. RLS — también en las lecturas
-- ──────────────────────────────────────────────────────────────────────────────
-- Lectura   = acceso al módulo Y el contrato en el alcance (`auth_grupos()`).
-- Escritura = la clave de gestión que corresponda Y el contrato en el alcance.
-- Un ADMIN está en todos los alcances por `auth_grupos()`, así que ve todo.
--
-- `ronda_eventos` no recibe políticas de UPDATE ni DELETE: sin política, esos
-- comandos quedan prohibidos para `authenticated`, y eso es exactamente lo que
-- "append-only" significa aquí.
ALTER TABLE ronda_zonas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_puntos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_qr_lotes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_qr        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ronda_eventos   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('ronda_zonas',    'ronda_gestiona_puntos'),
      ('ronda_puntos',   'ronda_gestiona_puntos'),
      ('ronda_qr_lotes', 'ronda_gestiona_qr'),
      ('ronda_qr',       'ronda_gestiona_qr')
    ) AS v(tabla, gestiona)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', r.tabla, r.tabla);
    EXECUTE format($p$CREATE POLICY %I_read ON public.%I
      FOR SELECT TO authenticated
      USING ((SELECT public.ronda_acceso()) AND grupo_id IN (SELECT public.auth_grupos()))$p$,
      r.tabla, r.tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', r.tabla, r.tabla);
    EXECUTE format($p$CREATE POLICY %I_write ON public.%I
      FOR ALL TO authenticated
      USING ((SELECT public.%I()) AND grupo_id IN (SELECT public.auth_grupos()))
      WITH CHECK ((SELECT public.%I()) AND grupo_id IN (SELECT public.auth_grupos()))$p$,
      r.tabla, r.tabla, r.gestiona, r.gestiona);
  END LOOP;
END $$;

-- `ronda_eventos`: se lee lo del propio alcance. Los eventos SIN contrato
-- (`grupo_id IS NULL`) son los rechazos de un token que no se pudo resolver:
-- no contienen datos de ningún contrato y son justo los que la operación tiene
-- que poder revisar, así que los ve cualquiera con acceso al módulo.
DROP POLICY IF EXISTS ronda_eventos_read ON ronda_eventos;
CREATE POLICY ronda_eventos_read ON ronda_eventos
  FOR SELECT TO authenticated
  USING (
    (SELECT public.ronda_acceso())
    AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
  );

DROP POLICY IF EXISTS ronda_eventos_insert ON ronda_eventos;
CREATE POLICY ronda_eventos_insert ON ronda_eventos
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.ronda_acceso())
    AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. Sincronización incremental (packages/offline)
-- ──────────────────────────────────────────────────────────────────────────────
-- Los índices por `updated_at` ya quedaron arriba, con cada tabla, para que el
-- PULL por watermark del paquete offline no haga seq scan. `ronda_eventos` no
-- lo necesita: es append-only y se pagina por `id`.
