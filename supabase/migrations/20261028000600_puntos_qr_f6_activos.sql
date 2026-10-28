-- =============================================================================
-- PUNTOS QR — F6: ACTIVOS DEL CLIENTE
-- =============================================================================
-- Sexta migración del módulo de Puntos QR, Tareas y Bot de WhatsApp. F1
-- (20261019000010) dejó el contrato como eje y F2 (20261019000020) dejó el
-- punto con su QR; esta cuelga del contrato lo que se MANTIENE: el extintor, el
-- ascensor, la bomba, la luminaria, la grifería y la puerta automática de la
-- sede del cliente, con su ficha técnica, su garantía, sus medidores y su
-- propio código QR.
--
-- Plan: docs/puntos-qr-whatsapp/02-complemento-2-integracion.md §4.2
-- (mantenimiento: por qué `activos` se crea y no se mete en `maquinaria`), §2.4
-- (qué columna de alcance lleva cada tabla), §5 (resumen del modelo) y §6 (F6
-- depende de F1 y F2); docs/puntos-qr-whatsapp/03-nomenclatura.md, que manda
-- sobre los cuatro documentos.
--
-- Qué entra:
--   1. `activo_tipos`     — catálogo de clases de activo. `grupo_id` NULLABLE:
--      NULL = aplica a todos los contratos (el mismo patrón de
--      `ronda_tipos_actividad` y `ronda_instructivos`).
--   2. `activos`          — la instalación del cliente, fija en su sede.
--   3. `activo_documentos`— ficha técnica, manual, garantía y certificados, en
--      el bucket privado `rondas`, carpeta `activos/`.
--   4. `activo_medidores` — HORAS / CICLOS / LECTURA, con `valor_actual`.
--   5. `activo_lecturas`  — append: cada lectura, y de ahí sale `valor_actual`.
--   6. `ronda_qr.activo_id` + el CHECK ampliado: el QR del activo reutiliza el
--      motor de F2 TAL CUAL, sin una segunda tabla de códigos.
--
-- POR QUÉ `activos` NO ES `maquinaria` (§4.2, la decisión menos obvia):
--   · `maquinaria` es equipo PROPIO y MÓVIL de la empresa, con semántica
--     patrimonial (`valor`, `fecha_adquisicion`, `responsable`) y un estado que
--     incluye `BAJA`. El activo de F6 es una INSTALACIÓN DEL CLIENTE, fija en
--     una zona de su sede, que no se da de baja ni se valora: se mantiene
--     mientras dure el contrato.
--   · Y el motivo decisivo es de seguridad: `mant_puede_participar()` no tiene
--     NINGÚN alcance por sede ni por contrato — es solo
--     `auth_permiso_any('{ver_mantenimiento,…}')`
--     (20260914000000_mantenimiento_maquinaria.sql:233) —, y de ella cuelgan
--     las políticas de lectura de tickets y actividades. Meter los activos de
--     los clientes en `maquinaria` haría que cualquiera con `ver_mantenimiento`
--     leyera los activos de TODOS los clientes. Con una tabla propia, `activos`
--     nace con alcance por `grupo_id` desde el primer día y no hay que reabrir
--     la RLS de un módulo que ya está en producción.
--
-- CÓMO CONVIVEN LOS DOS QR DE EQUIPO (decisión de esta fase, documentada):
--   · El que YA existe: `/equipo/<ref>`, donde `<ref>` es el `codigo` (o el id)
--     de `maquinaria` en claro, SIN firma, y la página EXIGE SESIÓN y permiso
--     de mantenimiento. Sirve a la máquina propia de la empresa. NO SE TOCA.
--   · El que entra aquí: `/q/<token>` con `ronda_qr.tipo_objeto = 'ACTIVO'`,
--     token FIRMADO con HMAC (ADR-B), que resuelve sin sesión y deja auditoría
--     en `ronda_eventos`. Sirve al activo del cliente.
--   Son dos tablas, dos rutas y dos semánticas distintas; no comparten ni
--   código ni espacio de nombres, así que un QR de `maquinaria` nunca resuelve
--   a un activo ni al contrario. Un activo que FUESE una máquina propia metida
--   en la sede del cliente se registra en `maquinaria`, como hoy.
--
-- Permisos nuevos (grupo "Operación Conserjería" de lib/permisos.ts, planos y
-- en snake_case como exige §2 de la nomenclatura):
--   ver_activos_ronda          entra a /rondas/activos y lee lo de su alcance.
--   gestionar_activos_ronda    da de alta tipos y activos, sube documentos,
--                              define medidores y borra una lectura mal tomada.
--   registrar_lecturas_activos registra lecturas y nada más (es lo que hace el
--                              técnico en sitio, que no tiene por qué poder
--                              editar la ficha del activo).
-- El QR del activo NO trae permiso nuevo: reutiliza `gestionar_qr_ronda`, que
-- es la clave de "mandar a imprimir una placa", y da igual si la placa va en
-- una pared o en el costado de un ascensor.
--
-- Lo que esta fase NO hace, a propósito:
--   · NO toca `mantenimiento_tickets` ni el enum `estado_ticket_mant`: eso es
--     F7, y §6 dice que su primer entregable es el ACUERDO sobre los estados
--     nuevos, no el SQL.
--   · NO crea `mant_planes` ni `mant_plan_tareas`: también F7. Lo que sí deja
--     listo es de lo que esos planes van a leer (ver §12 al final).
--
-- Idempotente: se puede volver a aplicar sin daño.
-- =============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. Comprobación de dependencias (F1 y F2)
-- ──────────────────────────────────────────────────────────────────────────────
-- Fallar aquí con un mensaje claro es mucho mejor que fallar 400 líneas abajo
-- con un "relation does not exist".
DO $$
BEGIN
  IF to_regclass('public.grupos_contrato') IS NULL THEN
    RAISE EXCEPTION 'Falta F1: no existe grupos_contrato. Aplica 20261019000010 primero.';
  END IF;
  IF to_regclass('public.ronda_qr') IS NULL THEN
    RAISE EXCEPTION 'Falta F2: no existe ronda_qr. Aplica 20261019000020 primero.';
  END IF;
  IF to_regprocedure('public.auth_grupos()') IS NULL THEN
    RAISE EXCEPTION 'Falta F1: no existe auth_grupos(). Aplica 20261019000010 primero.';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Clave pública libre para CUALQUIER objeto que lleve QR
-- ──────────────────────────────────────────────────────────────────────────────
-- La clave pública es lo que viaja DENTRO del token (`<v><clave><ver><firma>`,
-- packages/ronda-core/src/codigo.ts) para poder resolver el objeto sin meter el
-- UUID, que no cabe en una placa legible a 50×50 mm.
--
-- Desde F6 hay DOS tablas con clave pública (`ronda_puntos` y `activos`), así
-- que el generador tiene que mirar las dos. Una clave repetida entre un punto y
-- un activo no sería ambigua para la máquina —el token completo es único porque
-- la firma lleva el UUID del objeto—, pero sí lo sería para la persona que lee
-- la placa y para el soporte que la busca. Se evita.
CREATE OR REPLACE FUNCTION public.ronda_clave_objeto_libre()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v TEXT;
  i INT := 0;
  v_hay_activos BOOLEAN := to_regclass('public.activos') IS NOT NULL;
  v_ocupada BOOLEAN;
BEGIN
  LOOP
    v := public.ronda_cadena_aleatoria(8, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    v_ocupada := EXISTS (SELECT 1 FROM public.ronda_puntos p WHERE p.clave_publica = v);
    -- SQL dinámico para que esta función siga sirviendo si alguna vez se aplica
    -- sin `activos` (por ejemplo al reconstruir la base desde F2).
    IF NOT v_ocupada AND v_hay_activos THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.activos a WHERE a.clave_publica = $1)'
        INTO v_ocupada USING v;
    END IF;
    EXIT WHEN NOT v_ocupada;
    i := i + 1;
    IF i > 50 THEN RAISE EXCEPTION 'No se pudo generar una clave pública libre'; END IF;
  END LOOP;
  RETURN v;
END $$;
COMMENT ON FUNCTION public.ronda_clave_objeto_libre() IS
  'Clave pública de 8 caracteres (base32 sin ambigüedades) libre en ronda_puntos Y en activos. Es lo que viaja dentro del token del QR. Reemplaza el uso directo de ronda_clave_punto_libre(), que solo miraba los puntos.';
REVOKE ALL ON FUNCTION public.ronda_clave_objeto_libre() FROM PUBLIC;

-- `ronda_clave_punto_libre()` (F2) pasa a delegar: así los puntos que se creen
-- de aquí en adelante tampoco choquen con un activo, sin tener que tocar el
-- trigger de `ronda_puntos`.
CREATE OR REPLACE FUNCTION public.ronda_clave_punto_libre()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT public.ronda_clave_objeto_libre()
$$;
COMMENT ON FUNCTION public.ronda_clave_punto_libre() IS
  'Compatibilidad con F2: delega en ronda_clave_objeto_libre(), que desde F6 mira también la tabla `activos`.';
REVOKE ALL ON FUNCTION public.ronda_clave_punto_libre() FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. `activo_tipos` — qué clases de activo existen
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` NULLABLE, con NULL = "aplica a todos los contratos" (§2.4). Un
-- cliente con un activo raro (una planta de tratamiento, una barrera vehicular
-- con un mantenimiento propio) se da de alta un tipo suyo sin ensuciar el
-- catálogo general.
--
-- El tipo es lo que F7 va a usar para los planes POR TIPO ("todos los
-- extintores, recarga anual"), así que lleva ya las dos cosas de las que un
-- plan por tipo depende: si el activo suele tener medidor y si su
-- mantenimiento es una exigencia normativa.
CREATE TABLE IF NOT EXISTS activo_tipos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  codigo            VARCHAR(30) NOT NULL,
  nombre            VARCHAR(120) NOT NULL,
  descripcion       TEXT,
  -- Para agrupar en la pantalla, no para decidir nada.
  categoria         VARCHAR(20) NOT NULL DEFAULT 'OTRO'
                    CHECK (categoria IN ('SEGURIDAD','HIDRAULICO','ELECTRICO','MECANICO',
                                         'TRANSPORTE_VERTICAL','ILUMINACION','OBRA','OTRO')),
  icono             VARCHAR(40),
  -- Lo que el tipo SUGIERE al dar de alta un activo; nada de esto obliga.
  criticidad_sugerida VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                    CHECK (criticidad_sugerida IN ('BAJA','MEDIA','ALTA','CRITICA')),
  vida_util_meses   SMALLINT CHECK (vida_util_meses IS NULL OR vida_util_meses > 0),
  exige_medidor     BOOLEAN NOT NULL DEFAULT false,
  medidor_tipo      VARCHAR(10) CHECK (medidor_tipo IS NULL OR medidor_tipo IN ('HORAS','CICLOS','LECTURA')),
  medidor_unidad    VARCHAR(20),
  -- La recarga anual del extintor de §2.2: no es una política de la empresa,
  -- es la ley. F7 lo lee para marcar el plan como `obligatorio_normativo`.
  obligatorio_normativo BOOLEAN NOT NULL DEFAULT false,
  normativa         VARCHAR(120),
  orden             INT NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activo_tipos_codigo_chk CHECK (codigo ~ '^[A-Z0-9_]{2,30}$'),
  -- Si el tipo dice que exige medidor, tiene que decir de qué clase: un plan
  -- por medidor sin tipo de medidor no se puede programar.
  CONSTRAINT activo_tipos_medidor_chk CHECK (NOT exige_medidor OR medidor_tipo IS NOT NULL)
);
-- Dos índices únicos parciales en vez de uno sobre (grupo_id, codigo): en
-- PostgreSQL NULL no es igual a NULL, así que un UNIQUE normal dejaría meter
-- dos veces el mismo código general.
CREATE UNIQUE INDEX IF NOT EXISTS ux_activo_tipos_codigo_grupo
  ON activo_tipos(grupo_id, codigo) WHERE grupo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_activo_tipos_codigo_general
  ON activo_tipos(codigo) WHERE grupo_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_activo_tipos_grupo ON activo_tipos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_activo_tipos_upd   ON activo_tipos(updated_at);

COMMENT ON TABLE activo_tipos IS
  'Clases de activo del cliente (extintor, ascensor, bomba…). grupo_id NULL = catálogo general que aplica a todos los contratos; con grupo_id = tipo propio de ese contrato (§2.4). NO es `tipos_servicio` (Servicios del Hogar) ni `maquinaria.tipo` (equipo propio).';
COMMENT ON COLUMN activo_tipos.exige_medidor IS
  'El tipo suele llevar medidor (horas de una bomba, ciclos de una puerta automática). Lo lee la pantalla de alta para proponer el medidor, y F7 para los planes por medidor.';
COMMENT ON COLUMN activo_tipos.obligatorio_normativo IS
  'El mantenimiento de este tipo lo exige una norma, no la empresa (la recarga anual del extintor de §2.2). F7 lo copia al plan como `obligatorio_normativo`, que es lo que impide posponerlo.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `activos` — la instalación del cliente
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` y `sede_id` NOT NULL los dos (§2.4): el activo es del cliente, en
-- su sede. `grupo_id` va desnormalizado aunque se derive de la sede porque es
-- la columna por la que filtra la RLS, y un JOIN por fila en una política se
-- paga en cada consulta.
--
-- `punto_id` es lo que resuelve §2.1 del complemento ("asociar un activo a un
-- QR de punto existente"): un activo que está justo donde ya hay una placa no
-- necesita placa propia; se cuelga del punto y el QR del punto lo muestra.
-- `padre_id` es el activo padre/hijo de §2.1 (el ascensor y su cuarto de
-- máquinas, la bomba y su motor).
CREATE SEQUENCE IF NOT EXISTS activo_codigo_seq;

CREATE TABLE IF NOT EXISTS activos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id          UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id           UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  zona_id           UUID REFERENCES ronda_zonas(id) ON DELETE SET NULL,
  punto_id          UUID REFERENCES ronda_puntos(id) ON DELETE SET NULL,
  activo_tipo_id    UUID REFERENCES activo_tipos(id) ON DELETE SET NULL,
  padre_id          UUID REFERENCES activos(id) ON DELETE SET NULL,
  -- Único POR CONTRATO (§4.2). Si no se escribe, lo pone la secuencia: §4 de la
  -- nomenclatura — un consecutivo sale de una SEQUENCE, nunca de COUNT(*)+1.
  codigo            VARCHAR(30) NOT NULL,
  -- Identificador público e INMUTABLE que viaja dentro del token del QR, igual
  -- que `ronda_puntos.clave_publica`.
  clave_publica     CHAR(8) NOT NULL,
  nombre            VARCHAR(200) NOT NULL,
  descripcion       TEXT,
  marca             VARCHAR(80),
  modelo            VARCHAR(80),
  serial            VARCHAR(80),
  -- Dónde está, en palabras, para quien nunca ha ido: "cuarto de bombas, sótano 2".
  ubicacion_texto   VARCHAR(200),
  piso              VARCHAR(20),
  fecha_instalacion DATE,
  garantia_hasta    DATE,
  proveedor_id      UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  criticidad        VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                    CHECK (criticidad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  -- Sin `BAJA`: un activo del cliente no se da de baja, se RETIRA de la
  -- operación. La diferencia con `maquinaria` es a propósito (§4.2).
  estado            VARCHAR(14) NOT NULL DEFAULT 'OPERATIVO'
                    CHECK (estado IN ('OPERATIVO','DEGRADADO','FUERA_SERVICIO','RETIRADO')),
  -- Rutas en el bucket privado `rondas`, carpeta `activos/<id>/`.
  fotos             TEXT[] NOT NULL DEFAULT '{}'::text[],
  observaciones     TEXT,
  activo            BOOLEAN NOT NULL DEFAULT true,
  sede_nombre       VARCHAR(400),            -- desnormalizado, para listados
  created_by        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activos_clave_chk  CHECK (clave_publica ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  CONSTRAINT activos_codigo_chk CHECK (btrim(codigo) <> ''),
  CONSTRAINT activos_padre_chk  CHECK (padre_id IS NULL OR padre_id <> id),
  CONSTRAINT activos_garantia_chk
    CHECK (garantia_hasta IS NULL OR fecha_instalacion IS NULL OR garantia_hasta >= fecha_instalacion)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_activos_codigo ON activos(grupo_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS ux_activos_clave  ON activos(clave_publica);
CREATE INDEX IF NOT EXISTS idx_activos_grupo  ON activos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_activos_sede   ON activos(sede_id, codigo);
CREATE INDEX IF NOT EXISTS idx_activos_zona   ON activos(zona_id);
CREATE INDEX IF NOT EXISTS idx_activos_punto  ON activos(punto_id);
CREATE INDEX IF NOT EXISTS idx_activos_tipo   ON activos(activo_tipo_id);
CREATE INDEX IF NOT EXISTS idx_activos_padre  ON activos(padre_id);
CREATE INDEX IF NOT EXISTS idx_activos_estado ON activos(estado);
CREATE INDEX IF NOT EXISTS idx_activos_upd    ON activos(updated_at);
-- La garantía que vence es lo que la pantalla y F7 van a preguntar seguido.
CREATE INDEX IF NOT EXISTS idx_activos_garantia ON activos(garantia_hasta)
  WHERE garantia_hasta IS NOT NULL;

COMMENT ON TABLE activos IS
  'Instalación FIJA del cliente que se mantiene mientras dure el contrato (extintor, ascensor, bomba, luminaria, grifería, puerta automática). NO es `maquinaria`, que es el equipo propio y móvil de la empresa: la razón está en §4.2 del complemento 2 y es de seguridad, porque mant_puede_participar() no tiene alcance por contrato.';
COMMENT ON COLUMN activos.codigo IS
  'Código corto legible, único POR CONTRATO. Si se omite al insertar, el trigger lo pone desde activo_codigo_seq como AC-000001 (§4 de la nomenclatura: nunca COUNT(*)+1).';
COMMENT ON COLUMN activos.clave_publica IS
  'Identificador público e INMUTABLE que viaja dentro del token del QR del activo. Cambiarla dejaría muertas las placas ya pegadas.';
COMMENT ON COLUMN activos.punto_id IS
  'Punto de control del que cuelga el activo, si está donde ya hay una placa. Es lo que resuelve §2.1 del complemento ("asociar un activo a un QR de punto existente"): así el activo no necesita placa propia y el QR del punto lo muestra.';
COMMENT ON COLUMN activos.padre_id IS
  'Activo padre (el ascensor del que es parte el cuarto de máquinas). Jerarquía libre; el trigger impide el ciclo y que el padre sea de otro contrato.';
COMMENT ON COLUMN activos.estado IS
  'OPERATIVO · DEGRADADO (funciona a medias) · FUERA_SERVICIO · RETIRADO (ya no hace parte de la operación). Sin BAJA: el activo es del cliente, no se da de baja patrimonialmente.';
COMMENT ON COLUMN activos.fotos IS
  'Rutas en el bucket privado `rondas`, carpeta activos/<activo_id>/. Nunca URL públicas.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `activo_documentos` — ficha técnica, manual, garantía
-- ──────────────────────────────────────────────────────────────────────────────
-- Se reutiliza el patrón de `documentos_persona` (archivo en bucket privado,
-- `archivo_path` + `mime` + `tamano`), como dice §4.2.
--
-- SIN `grupo_id`: §2.4 solo se lo exige a `activos`, `activo_medidores` y
-- `activo_lecturas`. El documento hereda el alcance de su activo y se llega a
-- él por `activo_id`, igual que `ronda_plantilla_pasos` hereda de su plantilla.
CREATE TABLE IF NOT EXISTS activo_documentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo_id       UUID NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  tipo            VARCHAR(16) NOT NULL DEFAULT 'OTRO'
                  CHECK (tipo IN ('FICHA_TECNICA','MANUAL','GARANTIA','CERTIFICADO',
                                  'PLANO','POLIZA','FACTURA','OTRO')),
  nombre          VARCHAR(200) NOT NULL,
  nombre_archivo  VARCHAR(255),
  archivo_path    TEXT NOT NULL,            -- ruta en el bucket privado `rondas`
  mime            VARCHAR(120),
  tamano          BIGINT CHECK (tamano IS NULL OR tamano >= 0),
  -- Un certificado de recarga o una póliza vencen; una ficha técnica no.
  vence_at        DATE,
  notas           TEXT,
  subido_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activo_documentos_path_chk CHECK (btrim(archivo_path) <> '')
);
CREATE INDEX IF NOT EXISTS idx_activo_docs_activo ON activo_documentos(activo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activo_docs_tipo   ON activo_documentos(tipo);
CREATE INDEX IF NOT EXISTS idx_activo_docs_vence  ON activo_documentos(vence_at)
  WHERE vence_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activo_docs_upd    ON activo_documentos(updated_at);
-- El mismo archivo no se sube dos veces al mismo activo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_activo_docs_path ON activo_documentos(archivo_path);

COMMENT ON TABLE activo_documentos IS
  'Ficha técnica, manual, garantía y certificados del activo. El archivo vive en el bucket PRIVADO `rondas`, carpeta activos/<activo_id>/; aquí solo queda la ruta, como en documentos_persona. Hereda el alcance de su activo (§2.4), no lleva grupo_id.';
COMMENT ON COLUMN activo_documentos.vence_at IS
  'Vencimiento del documento, cuando lo tiene (certificado de recarga, póliza). NULL para lo que no vence, como un manual.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `activo_medidores` — horas, ciclos o lectura
-- ──────────────────────────────────────────────────────────────────────────────
-- `valor_actual` es una CACHÉ de la última lectura, no la fuente de verdad: la
-- fuente es `activo_lecturas` y un trigger recalcula esta columna en cada
-- inserción y en cada borrado. Se guarda porque es lo que F7 va a consultar
-- para los planes por medidor, y una subconsulta por activo en cada cálculo de
-- plan no se paga.
CREATE TABLE IF NOT EXISTS activo_medidores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo_id       UUID NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  grupo_id        UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id         UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  codigo          VARCHAR(20) NOT NULL DEFAULT 'PRINCIPAL',
  nombre          VARCHAR(120) NOT NULL,
  tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('HORAS','CICLOS','LECTURA')),
  unidad          VARCHAR(20) NOT NULL DEFAULT 'h',
  -- Última lectura, recalculada por trigger desde activo_lecturas.
  valor_actual    DECIMAL(14,3) NOT NULL DEFAULT 0,
  leido_at        TIMESTAMPTZ,
  -- Un contador (horas, ciclos) solo sube. Una LECTURA de instrumento puede
  -- bajar (la presión de una bomba, el nivel de un tanque), y por eso esto es
  -- una columna y no una regla fija por `tipo`.
  acumulativo     BOOLEAN NOT NULL DEFAULT true,
  decimales       SMALLINT NOT NULL DEFAULT 0 CHECK (decimales BETWEEN 0 AND 3),
  -- Para que la pantalla avise antes de que el medidor llegue al límite del
  -- fabricante; F7 lo puede usar como disparo de plan.
  valor_alerta    DECIMAL(14,3),
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activo_medidores_codigo_chk CHECK (codigo ~ '^[A-Z0-9_]{2,20}$'),
  CONSTRAINT activo_medidores_alerta_chk CHECK (valor_alerta IS NULL OR valor_alerta > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_activo_medidores_codigo
  ON activo_medidores(activo_id, codigo);
CREATE INDEX IF NOT EXISTS idx_activo_medidores_activo ON activo_medidores(activo_id);
CREATE INDEX IF NOT EXISTS idx_activo_medidores_grupo  ON activo_medidores(grupo_id);
CREATE INDEX IF NOT EXISTS idx_activo_medidores_upd    ON activo_medidores(updated_at);

COMMENT ON TABLE activo_medidores IS
  'Medidor de un activo: HORAS (bomba, planta), CICLOS (puerta automática, ascensor) o LECTURA (presión, nivel). Un activo puede tener varios. valor_actual es CACHÉ de la última lectura; la fuente de verdad es activo_lecturas.';
COMMENT ON COLUMN activo_medidores.valor_actual IS
  'CACHÉ de la última lectura, recalculada por el trigger tr_activo_lecturas_refrescar en cada INSERT y DELETE de activo_lecturas. No se escribe a mano: un UPDATE directo lo deja desincronizado hasta la lectura siguiente.';
COMMENT ON COLUMN activo_medidores.acumulativo IS
  'TRUE para un contador, que solo sube: una lectura menor que alguna anterior se rechaza, porque es un error de digitación o un contador reemplazado (y eso se registra cambiando el medidor, no bajándolo). FALSE para un instrumento, cuya lectura puede bajar.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `activo_lecturas` — solo se agrega
-- ──────────────────────────────────────────────────────────────────────────────
-- Append, como dice §4.2: no hay política de UPDATE, así que una lectura NO se
-- corrige editándola. Sí se puede BORRAR (con `gestionar_activos_ronda`), y es
-- a propósito: en un contador acumulativo una digitación de más —999999 en vez
-- de 9999— bloquearía el medidor para siempre si no hubiera forma de deshacerla.
-- Al borrar, el trigger recalcula `valor_actual` desde la lectura que quede.
--
-- `visita_id` y `persona_id` los pide §4.2 explícitamente: la lectura que toma
-- el técnico durante una visita queda atada a esa visita, que es lo que permite
-- auditar de dónde salió el número.
CREATE TABLE IF NOT EXISTS activo_lecturas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medidor_id    UUID NOT NULL REFERENCES activo_medidores(id) ON DELETE CASCADE,
  activo_id     UUID NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  grupo_id      UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  sede_id       UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  valor         DECIMAL(14,3) NOT NULL,
  -- Se guardan calculados para no tener que mirar la fila anterior cada vez que
  -- se dibuja la gráfica de consumo.
  valor_anterior DECIMAL(14,3),
  delta          DECIMAL(14,3),
  leido_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visita_id     UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,
  persona_id    UUID REFERENCES personas(id) ON DELETE SET NULL,
  usuario_id    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  origen        VARCHAR(10) NOT NULL DEFAULT 'CONSOLA'
                CHECK (origen IN ('CONSOLA','APP','WHATSAPP','IOT','SISTEMA')),
  nota          VARCHAR(300),
  foto          TEXT,                       -- ruta en el bucket `rondas`
  -- `clock_timestamp()` y NO `NOW()`: `NOW()` es la hora de la TRANSACCIÓN y
  -- vale lo mismo para todas las filas que entren en ella, así que dos lecturas
  -- del mismo medidor en una transacción empatarían y el desempate caería en el
  -- UUID, que es aleatorio — "la última lectura" saldría al azar. Con
  -- `clock_timestamp()` el orden de inserción se conserva.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Para una tabla que ya existía (re-aplicar la migración no recrea la tabla).
ALTER TABLE activo_lecturas ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS idx_activo_lecturas_medidor
  ON activo_lecturas(medidor_id, leido_at DESC);
CREATE INDEX IF NOT EXISTS idx_activo_lecturas_activo
  ON activo_lecturas(activo_id, leido_at DESC);
CREATE INDEX IF NOT EXISTS idx_activo_lecturas_grupo  ON activo_lecturas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_activo_lecturas_visita ON activo_lecturas(visita_id)
  WHERE visita_id IS NOT NULL;
-- Append-only: se pagina por `created_at` + `id`, no hace falta `updated_at`.
CREATE INDEX IF NOT EXISTS idx_activo_lecturas_creado ON activo_lecturas(created_at DESC);

COMMENT ON TABLE activo_lecturas IS
  'Lecturas de un medidor, SOLO AGREGAR: la RLS no concede UPDATE. Se permite DELETE con gestionar_activos_ronda para deshacer una digitación mala, y el trigger recalcula activo_medidores.valor_actual. Es la fuente de verdad del medidor.';
COMMENT ON COLUMN activo_lecturas.visita_id IS
  'Visita de ronda (F4) en la que se tomó la lectura, cuando viene de campo. Es lo que permite auditar de dónde salió el número.';
COMMENT ON COLUMN activo_lecturas.delta IS
  'valor - valor_anterior, calculado en el trigger. NULL en la primera lectura del medidor.';
COMMENT ON COLUMN activo_lecturas.created_at IS
  'Cuándo se GUARDÓ (clock_timestamp(), no NOW()): es el desempate del orden cuando dos lecturas traen el mismo leido_at, que es lo que decide cuál es "la última". Con NOW() todas las de una misma transacción empatan y el desempate caería en el UUID.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. `ronda_qr.activo_id` — el QR del activo, con el motor de F2 TAL CUAL
-- ──────────────────────────────────────────────────────────────────────────────
-- F2 ya dejó `tipo_objeto` ('PUNTO' / 'ACTIVO') y su CHECK decía que mientras
-- `activos` no existiera solo se podía insertar PUNTO. Ahora existe: entra la
-- columna, se amplía el CHECK a "exactamente uno de los dos" (§4.2) y se
-- replican para el activo los dos índices que protegen al punto.
ALTER TABLE ronda_qr
  ADD COLUMN IF NOT EXISTS activo_id UUID REFERENCES activos(id) ON DELETE CASCADE;

ALTER TABLE ronda_qr DROP CONSTRAINT IF EXISTS ronda_qr_objeto_chk;
ALTER TABLE ronda_qr ADD CONSTRAINT ronda_qr_objeto_chk CHECK (
  (tipo_objeto = 'PUNTO'  AND punto_id IS NOT NULL AND activo_id IS NULL)
  OR (tipo_objeto = 'ACTIVO' AND activo_id IS NOT NULL AND punto_id IS NULL)
);

-- Una versión por activo, y UN SOLO QR activo por activo. Mismo criterio que en
-- F2 y por el mismo motivo: dos placas válidas en el mismo ascensor no se puede
-- permitir ni con una carrera entre dos pestañas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_version_act
  ON ronda_qr(activo_id, version) WHERE activo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ronda_qr_unico_act
  ON ronda_qr(activo_id) WHERE estado = 'ACTIVO' AND activo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ronda_qr_activo_obj
  ON ronda_qr(activo_id, version DESC) WHERE activo_id IS NOT NULL;

COMMENT ON COLUMN ronda_qr.activo_id IS
  'Activo del cliente al que pertenece esta placa, cuando tipo_objeto = ACTIVO (F6). Exactamente uno de punto_id / activo_id, por el CHECK ronda_qr_objeto_chk.';
COMMENT ON COLUMN ronda_qr.tipo_objeto IS
  'PUNTO (placa de un punto de control, F2) o ACTIVO (placa de un activo del cliente, F6). Decide de qué tabla se derivan grupo_id y sede_id y sobre qué UUID se firma el token.';

-- `ronda_qr_derivar()` (F2) aprende el caso ACTIVO. Se redefine completa, no se
-- parchea, para que el archivo de F2 siga leyéndose como lo que hace la base.
CREATE OR REPLACE FUNCTION public.ronda_qr_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p RECORD;
BEGIN
  -- El token y el código manual van impresos en una placa: una vez emitidos no
  -- se editan, y el QR no se puede mudar de objeto. Para cambiar cualquiera de
  -- esas cosas se revoca la versión y se emite la siguiente. Esto va PRIMERO
  -- para que lo que se derive abajo se derive del objeto de verdad.
  IF TG_OP = 'UPDATE' THEN
    NEW.token         := OLD.token;
    NEW.codigo_manual := OLD.codigo_manual;
    NEW.version       := OLD.version;
    NEW.punto_id      := OLD.punto_id;
    NEW.activo_id     := OLD.activo_id;
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

  ELSIF NEW.tipo_objeto = 'ACTIVO' THEN
    -- F6: el QR del activo hereda el contrato y la sede del ACTIVO, igual que
    -- el del punto los hereda del punto. La pantalla nunca manda grupo_id.
    SELECT a.grupo_id, a.sede_id INTO p
      FROM public.activos a WHERE a.id = NEW.activo_id;
    IF p.grupo_id IS NULL THEN
      RAISE EXCEPTION 'El activo % no existe', NEW.activo_id;
    END IF;
    NEW.grupo_id := p.grupo_id;
    NEW.sede_id  := p.sede_id;
    IF TG_OP = 'INSERT' AND NEW.version IS NULL THEN
      SELECT COALESCE(MAX(q.version), 0) + 1 INTO NEW.version
        FROM public.ronda_qr q WHERE q.activo_id = NEW.activo_id;
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

-- Resolver un token tiene que decir también QUÉ se escaneó, y eso son dos
-- columnas más de las que devuelve `ronda_qr_por_token()` de F2.
--
-- Esas dos columnas NO se le agregan a esa función, y el motivo es concreto:
-- en PostgreSQL no se puede cambiar el tipo de fila que devuelve una función
-- con `CREATE OR REPLACE`; habría que soltarla y volverla a crear. Y F2 la
-- declara con `CREATE OR REPLACE`, así que volver a aplicar la migración de F2
-- —que es lo que hace su propio script de pruebas— fallaría con "cannot change
-- return type of existing function". Una fase no puede dejar a la anterior sin
-- poder re-aplicarse.
--
-- Así que F6 trae su propia función, superconjunto de la de F2. Las dos quedan:
-- `ronda_qr_por_token` para lo que ya la usaba y esta para lo que necesita
-- distinguir punto de activo (la ruta pública lee la tabla directamente, pero
-- el bot de F9 y los informes van a necesitar esto resuelto en una llamada).
CREATE OR REPLACE FUNCTION public.ronda_qr_objeto_por_token(p_token TEXT)
RETURNS TABLE (
  qr_id UUID, tipo_objeto TEXT, punto_id UUID, activo_id UUID,
  grupo_id UUID, sede_id UUID, version SMALLINT, estado TEXT,
  firma_llave_id TEXT, codigo_manual TEXT, vigente BOOLEAN, contrato_vigente BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.tipo_objeto::text, q.punto_id, q.activo_id,
         q.grupo_id, q.sede_id, q.version, q.estado::text,
         q.firma_llave_id::text, q.codigo_manual::text,
         q.estado = 'ACTIVO' AND public.grupo_vigente(q.grupo_id),
         public.grupo_vigente(q.grupo_id)
    FROM public.ronda_qr q
   WHERE q.token = upper(btrim(p_token))
$$;
COMMENT ON FUNCTION public.ronda_qr_objeto_por_token(TEXT) IS
  'Como ronda_qr_por_token (F2), pero diciendo QUÉ se escaneó: tipo_objeto PUNTO o ACTIVO y el id del objeto. NO verifica la firma HMAC: eso lo hace la aplicación, que es la única que tiene la llave (ADR-B). Devuelve cero filas si el token no existe.';
REVOKE ALL ON FUNCTION public.ronda_qr_objeto_por_token(TEXT) FROM PUBLIC;

-- Si una versión anterior de ESTA migración ya le había cambiado la forma a la
-- función de F2, se la devuelve: así la migración de F2 se puede volver a
-- aplicar sobre una base que ya tiene F6.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'ronda_qr_por_token'
       -- proallargtypes cuenta el parámetro MÁS las columnas de salida: la de
       -- F2 son 1 + 10 = 11; la que llegó a existir con las dos columnas de
       -- más, 1 + 12 = 13. Solo esa se suelta.
       AND array_length(p.proallargtypes, 1) = 13
  ) THEN
    DROP FUNCTION public.ronda_qr_por_token(TEXT);
  END IF;
END $$;

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
REVOKE ALL ON FUNCTION public.ronda_qr_por_token(TEXT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Triggers de los activos
-- ──────────────────────────────────────────────────────────────────────────────

/** Deriva el contrato y la sede, valida la coherencia y pone lo que la pantalla
    no tiene por qué mandar (clave pública, código). */
CREATE OR REPLACE FUNCTION public.activos_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s RECORD; v_padre RECORD; v_tipo RECORD; v_cursor UUID; i INT := 0;
BEGIN
  SELECT sd.grupo_id, sd.nombre INTO s FROM public.sedes sd WHERE sd.id = NEW.sede_id;
  IF s.grupo_id IS NULL THEN
    RAISE EXCEPTION 'La sede % no existe o no tiene contrato', NEW.sede_id;
  END IF;
  NEW.grupo_id    := s.grupo_id;
  NEW.sede_nombre := s.nombre;

  -- La zona y el punto tienen que ser de la MISMA sede: si no, el activo
  -- quedaría ubicado en un edificio y colgado de otro.
  IF NEW.zona_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ronda_zonas z
                      WHERE z.id = NEW.zona_id AND z.sede_id = NEW.sede_id) THEN
    RAISE EXCEPTION 'La zona no pertenece a la sede del activo';
  END IF;
  IF NEW.punto_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ronda_puntos pt
                      WHERE pt.id = NEW.punto_id AND pt.sede_id = NEW.sede_id) THEN
    RAISE EXCEPTION 'El punto de control no pertenece a la sede del activo';
  END IF;

  -- El tipo: o es general (grupo_id NULL) o es de este mismo contrato.
  IF NEW.activo_tipo_id IS NOT NULL THEN
    SELECT t.grupo_id INTO v_tipo FROM public.activo_tipos t WHERE t.id = NEW.activo_tipo_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El tipo de activo % no existe', NEW.activo_tipo_id;
    END IF;
    IF v_tipo.grupo_id IS NOT NULL AND v_tipo.grupo_id <> NEW.grupo_id THEN
      RAISE EXCEPTION 'Ese tipo de activo es de otro contrato';
    END IF;
  END IF;

  -- El padre: del mismo contrato y sin ciclo. El ciclo se busca subiendo por la
  -- cadena, que es corta por definición (un activo no tiene veinte abuelos) y
  -- se corta a las 20 vueltas para no colgarse si alguna vez hay uno.
  IF NEW.padre_id IS NOT NULL THEN
    SELECT a.grupo_id INTO v_padre FROM public.activos a WHERE a.id = NEW.padre_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El activo padre % no existe', NEW.padre_id;
    END IF;
    IF v_padre.grupo_id <> NEW.grupo_id THEN
      RAISE EXCEPTION 'El activo padre es de otro contrato';
    END IF;
    v_cursor := NEW.padre_id;
    WHILE v_cursor IS NOT NULL LOOP
      IF v_cursor = NEW.id THEN
        RAISE EXCEPTION 'El activo no puede ser descendiente de sí mismo';
      END IF;
      i := i + 1;
      IF i > 20 THEN
        RAISE EXCEPTION 'La jerarquía de activos es demasiado profunda o tiene un ciclo';
      END IF;
      SELECT a.padre_id INTO v_cursor FROM public.activos a WHERE a.id = v_cursor;
    END LOOP;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.clave_publica IS NULL THEN
      NEW.clave_publica := public.ronda_clave_objeto_libre();
    END IF;
    IF NEW.codigo IS NULL OR btrim(NEW.codigo) = '' THEN
      NEW.codigo := 'AC-' || lpad(nextval('activo_codigo_seq')::text, 6, '0');
    END IF;
  ELSE
    -- La clave pública es INMUTABLE: cambiarla dejaría muerta la placa ya
    -- pegada al activo, que es justo lo que el módulo no puede permitirse.
    NEW.clave_publica := OLD.clave_publica;
  END IF;
  NEW.codigo := upper(btrim(NEW.codigo));
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.activos_derivar() IS
  'Deriva grupo_id y sede_nombre de la sede, exige que zona, punto, tipo y padre sean coherentes con ella, genera la clave pública y el código, y protege la clave pública de los UPDATE.';

DROP TRIGGER IF EXISTS tr_activos_derivar ON activos;
CREATE TRIGGER tr_activos_derivar BEFORE INSERT OR UPDATE ON activos
  FOR EACH ROW EXECUTE FUNCTION public.activos_derivar();

/** El medidor hereda contrato y sede de su activo. */
CREATE OR REPLACE FUNCTION public.activo_medidores_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a RECORD;
BEGIN
  SELECT ac.grupo_id, ac.sede_id INTO a FROM public.activos ac WHERE ac.id = NEW.activo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El activo % no existe', NEW.activo_id;
  END IF;
  NEW.grupo_id := a.grupo_id;
  NEW.sede_id  := a.sede_id;
  IF TG_OP = 'UPDATE' THEN
    -- Mudar un medidor de activo dejaría sus lecturas apuntando a dos sitios.
    NEW.activo_id := OLD.activo_id;
  END IF;
  NEW.codigo := upper(btrim(NEW.codigo));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_activo_medidores_derivar ON activo_medidores;
CREATE TRIGGER tr_activo_medidores_derivar BEFORE INSERT OR UPDATE ON activo_medidores
  FOR EACH ROW EXECUTE FUNCTION public.activo_medidores_derivar();

/** Valida la lectura y la completa: contrato, sede, activo, anterior y delta. */
CREATE OR REPLACE FUNCTION public.activo_lecturas_derivar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m RECORD; v_max DECIMAL(14,3); v_ant DECIMAL(14,3);
BEGIN
  SELECT md.activo_id, md.grupo_id, md.sede_id, md.acumulativo, md.activo, md.nombre
    INTO m FROM public.activo_medidores md WHERE md.id = NEW.medidor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El medidor % no existe', NEW.medidor_id;
  END IF;
  IF NOT m.activo THEN
    RAISE EXCEPTION 'El medidor "%" está inactivo: no admite lecturas nuevas', m.nombre;
  END IF;
  NEW.activo_id := m.activo_id;
  NEW.grupo_id  := m.grupo_id;
  NEW.sede_id   := m.sede_id;

  -- Una lectura del futuro es siempre un reloj mal puesto. Se dejan 5 minutos
  -- de holgura porque el del celular del técnico casi nunca está en hora.
  IF NEW.leido_at > NOW() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'La fecha de la lectura está en el futuro';
  END IF;

  IF m.acumulativo THEN
    -- Un contador solo sube. Una lectura menor que CUALQUIERA de las anteriores
    -- es una digitación mala o un contador reemplazado, y lo segundo se
    -- registra cambiando el medidor, no bajándolo.
    SELECT MAX(l.valor) INTO v_max
      FROM public.activo_lecturas l WHERE l.medidor_id = NEW.medidor_id;
    IF v_max IS NOT NULL AND NEW.valor < v_max THEN
      RAISE EXCEPTION 'activo_lecturas_contador: el medidor es acumulativo y la lectura (%) es menor que la mayor registrada (%)', NEW.valor, v_max;
    END IF;
  END IF;

  SELECT l.valor INTO v_ant
    FROM public.activo_lecturas l
   WHERE l.medidor_id = NEW.medidor_id AND l.leido_at <= NEW.leido_at
   ORDER BY l.leido_at DESC, l.created_at DESC, l.id DESC
   LIMIT 1;
  NEW.valor_anterior := v_ant;
  NEW.delta := CASE WHEN v_ant IS NULL THEN NULL ELSE NEW.valor - v_ant END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_activo_lecturas_derivar ON activo_lecturas;
CREATE TRIGGER tr_activo_lecturas_derivar BEFORE INSERT ON activo_lecturas
  FOR EACH ROW EXECUTE FUNCTION public.activo_lecturas_derivar();

/** Recalcula `valor_actual` y `leido_at` del medidor desde las lecturas. Corre
    después de insertar y después de borrar: la caché nunca se escribe a mano. */
CREATE OR REPLACE FUNCTION public.activo_lecturas_refrescar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_medidor UUID; u RECORD;
BEGIN
  v_medidor := COALESCE(NEW.medidor_id, OLD.medidor_id);
  SELECT l.valor, l.leido_at INTO u
    FROM public.activo_lecturas l
   WHERE l.medidor_id = v_medidor
   ORDER BY l.leido_at DESC, l.created_at DESC, l.id DESC
   LIMIT 1;
  UPDATE public.activo_medidores
     SET valor_actual = COALESCE(u.valor, 0),
         leido_at     = u.leido_at,
         updated_at   = NOW()
   WHERE id = v_medidor;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_activo_lecturas_refrescar ON activo_lecturas;
CREATE TRIGGER tr_activo_lecturas_refrescar AFTER INSERT OR DELETE ON activo_lecturas
  FOR EACH ROW EXECUTE FUNCTION public.activo_lecturas_refrescar();

-- `updated_at` en las cuatro tablas que lo tienen (`activo_lecturas` no: es
-- append-only y no se edita).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['activo_tipos','activos','activo_documentos','activo_medidores'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. Acceso al módulo de activos
-- ──────────────────────────────────────────────────────────────────────────────
-- Tres funciones, al estilo de `ronda_acceso()` / `ronda_gestiona_puntos()` de
-- F2, para que las políticas no repitan la lista de claves. Van con
-- `auth_permiso()`, que es lo que exige /roles como única fuente de verdad, y
-- se usan TAMBIÉN en las políticas de lectura.
CREATE OR REPLACE FUNCTION public.activo_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_activos_ronda,gestionar_activos_ronda,registrar_lecturas_activos}'::text[])
$$;
COMMENT ON FUNCTION public.activo_acceso() IS
  'Entra a /rondas/activos y lee los activos de los contratos a su alcance. Incluye a quien solo registra lecturas: para tomar una lectura hay que poder ver el activo.';
GRANT EXECUTE ON FUNCTION public.activo_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.activo_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_activos_ronda')
$$;
COMMENT ON FUNCTION public.activo_gestiona() IS
  'Da de alta tipos y activos, sube documentos, define medidores y borra una lectura mal tomada.';
GRANT EXECUTE ON FUNCTION public.activo_gestiona() TO authenticated;

CREATE OR REPLACE FUNCTION public.activo_registra_lecturas()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{registrar_lecturas_activos,gestionar_activos_ronda}'::text[])
$$;
COMMENT ON FUNCTION public.activo_registra_lecturas() IS
  'Registra lecturas de medidor. Va aparte de gestionar_activos_ronda porque el técnico que toma la lectura en sitio no tiene por qué poder editar la ficha del activo.';
GRANT EXECUTE ON FUNCTION public.activo_registra_lecturas() TO authenticated;

/** ¿Este activo está en el alcance de contratos del usuario? Lo usan las
    políticas de `activo_documentos`, que no lleva `grupo_id` (§2.4), y lo va a
    usar F7 para la RLS de la orden de trabajo atada a un activo. */
CREATE OR REPLACE FUNCTION public.activo_en_alcance(p_activo UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.activos a
     WHERE a.id = p_activo
       AND public.auth_ve_grupo(a.grupo_id)
  )
$$;
COMMENT ON FUNCTION public.activo_en_alcance(UUID) IS
  'TRUE si el activo pertenece a un contrato al alcance del usuario (auth_grupos() de F1). Para lo que cuelga del activo y no lleva grupo_id propio: documentos hoy, y la orden de trabajo de F7.';
GRANT EXECUTE ON FUNCTION public.activo_en_alcance(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. RLS
-- ──────────────────────────────────────────────────────────────────────────────
-- Igual que en F2 y F3: `auth_permiso()` TAMBIÉN en las lecturas, y el alcance
-- por contrato con `auth_grupos()`. Sin esto, cualquiera con sesión leería los
-- activos de todos los clientes, que es exactamente lo que §4.2 quiere evitar.
ALTER TABLE activo_tipos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activo_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE activo_medidores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE activo_lecturas   ENABLE ROW LEVEL SECURITY;

-- `activo_tipos`: catálogo con `grupo_id` nullable — NULL = aplica a todos.
DROP POLICY IF EXISTS activo_tipos_read ON activo_tipos;
CREATE POLICY activo_tipos_read ON activo_tipos
  FOR SELECT TO authenticated
  USING ((SELECT public.activo_acceso())
         AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())));

DROP POLICY IF EXISTS activo_tipos_write ON activo_tipos;
CREATE POLICY activo_tipos_write ON activo_tipos
  FOR ALL TO authenticated
  USING ((SELECT public.activo_gestiona())
         AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())))
  WITH CHECK ((SELECT public.activo_gestiona())
         AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos())));

-- `activos` y `activo_medidores`: `grupo_id` NOT NULL, alcance directo.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['activos','activo_medidores'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_read ON public.%I
      FOR SELECT TO authenticated
      USING ((SELECT public.activo_acceso())
             AND grupo_id IN (SELECT public.auth_grupos()))$p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_write ON public.%I
      FOR ALL TO authenticated
      USING ((SELECT public.activo_gestiona())
             AND grupo_id IN (SELECT public.auth_grupos()))
      WITH CHECK ((SELECT public.activo_gestiona())
             AND grupo_id IN (SELECT public.auth_grupos()))$p$, t, t);
  END LOOP;
END $$;

-- `activo_documentos`: hereda el alcance de su activo.
DROP POLICY IF EXISTS activo_documentos_read ON activo_documentos;
CREATE POLICY activo_documentos_read ON activo_documentos
  FOR SELECT TO authenticated
  USING ((SELECT public.activo_acceso()) AND public.activo_en_alcance(activo_id));

DROP POLICY IF EXISTS activo_documentos_write ON activo_documentos;
CREATE POLICY activo_documentos_write ON activo_documentos
  FOR ALL TO authenticated
  USING ((SELECT public.activo_gestiona()) AND public.activo_en_alcance(activo_id))
  WITH CHECK ((SELECT public.activo_gestiona()) AND public.activo_en_alcance(activo_id));

-- `activo_lecturas`: se AGREGA con `registrar_lecturas_activos` y se BORRA solo
-- con `gestionar_activos_ronda`. No hay política de UPDATE: una lectura no se
-- edita, se borra y se vuelve a tomar, y así el histórico no miente.
DROP POLICY IF EXISTS activo_lecturas_read ON activo_lecturas;
CREATE POLICY activo_lecturas_read ON activo_lecturas
  FOR SELECT TO authenticated
  USING ((SELECT public.activo_acceso())
         AND grupo_id IN (SELECT public.auth_grupos()));

DROP POLICY IF EXISTS activo_lecturas_insert ON activo_lecturas;
CREATE POLICY activo_lecturas_insert ON activo_lecturas
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.activo_registra_lecturas())
         AND grupo_id IN (SELECT public.auth_grupos()));

DROP POLICY IF EXISTS activo_lecturas_delete ON activo_lecturas;
CREATE POLICY activo_lecturas_delete ON activo_lecturas
  FOR DELETE TO authenticated
  USING ((SELECT public.activo_gestiona())
         AND grupo_id IN (SELECT public.auth_grupos()));

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. Storage: la carpeta `activos/` del bucket privado `rondas` (ADR-C)
-- ──────────────────────────────────────────────────────────────────────────────
-- El bucket es el mismo de F2, F3 y F4, declarado otra vez para que da igual
-- cuál migración se aplique primero. Las políticas se nombran y se acotan POR
-- CARPETA, como las de los instructivos: así cada fase trae las suyas y se
-- suman, que es como funcionan las políticas permisivas de storage.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('rondas', 'rondas', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

/** Id del activo que lleva una ruta `activos/{id}/{archivo}`. */
CREATE OR REPLACE FUNCTION public.activo_de_ruta(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF split_part(p_name, '/', 1) <> 'activos' THEN RETURN NULL; END IF;
  RETURN split_part(p_name, '/', 2)::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;
COMMENT ON FUNCTION public.activo_de_ruta(TEXT) IS
  'Saca el id del activo de una ruta activos/{activo_id}/{archivo} del bucket `rondas`. NULL si la ruta es de otra carpeta del bucket (el ADR-C reparte el bucket en varias).';

/** ¿Puede subir un documento o una foto a la carpeta de este activo? */
CREATE OR REPLACE FUNCTION public.activo_archivo_puede_subir(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Se admite la carpeta de un activo que todavía no existe (se está creando),
  -- igual que `ronda_instructivo_puede_subir` y `pqrs_puede_subir`.
  SELECT public.activo_de_ruta(p_name) IS NOT NULL
     AND public.activo_gestiona()
     AND (NOT EXISTS (SELECT 1 FROM public.activos
                       WHERE id = public.activo_de_ruta(p_name))
          OR public.activo_en_alcance(public.activo_de_ruta(p_name)))
$$;
GRANT EXECUTE ON FUNCTION public.activo_archivo_puede_subir(TEXT) TO authenticated;

/** ¿Puede ver los archivos de la carpeta de este activo? */
CREATE OR REPLACE FUNCTION public.activo_archivo_puede_ver(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.activo_de_ruta(p_name) IS NOT NULL
     AND public.activo_acceso()
     AND public.activo_en_alcance(public.activo_de_ruta(p_name))
$$;
GRANT EXECUTE ON FUNCTION public.activo_archivo_puede_ver(TEXT) TO authenticated;

DROP POLICY IF EXISTS activos_storage_select ON storage.objects;
CREATE POLICY activos_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rondas'
         AND (owner = (SELECT auth.uid()) OR public.activo_archivo_puede_ver(name)));

DROP POLICY IF EXISTS activos_storage_insert ON storage.objects;
CREATE POLICY activos_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rondas' AND public.activo_archivo_puede_subir(name));

DROP POLICY IF EXISTS activos_storage_update ON storage.objects;
CREATE POLICY activos_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'rondas' AND public.activo_archivo_puede_subir(name))
  WITH CHECK (bucket_id = 'rondas' AND public.activo_archivo_puede_subir(name));

DROP POLICY IF EXISTS activos_storage_delete ON storage.objects;
CREATE POLICY activos_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rondas' AND public.activo_archivo_puede_subir(name));

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. Lo que F7 va a leer de aquí
-- ──────────────────────────────────────────────────────────────────────────────
-- F7 (planes preventivos y órdenes de trabajo) depende de F6. Para que no tenga
-- que adivinar, esta fase deja:
--   · `activos.id`          — a lo que apunta `mantenimiento_tickets.activo_id`
--                             (lo agrega F7, nullable, con el CHECK de que esté
--                             `maquinaria_id` O `activo_id`).
--   · `activos.grupo_id`    — lo que F7 copia a `mantenimiento_tickets.grupo_id`
--                             para darle al ticket el alcance por contrato.
--   · `activo_tipos.id`     — el plan POR TIPO de `mant_planes.activo_tipo_id`.
--   · `activo_tipos.obligatorio_normativo` y `vida_util_meses` — de donde sale
--                             el plan normativo de §2.2 sin volver a escribirlo.
--   · `activo_medidores.id`, `.valor_actual`, `.leido_at` — el plan POR MEDIDOR
--                             de `mant_planes.frecuencia_tipo = 'MEDIDOR'`.
--   · `activo_en_alcance(UUID)` — la función con la que F7 puede filtrar por
--                             contrato la orden de trabajo de un activo SIN
--                             tocar `mant_puede_participar()`, que no tiene
--                             alcance y del que cuelga el módulo en producción.
--   · la vista `vw_activos_medidor_vencido` de abajo, para no recalcularlo.
--
-- Lo que F7 tiene que hacer y F6 NO hizo: agregar las columnas a
-- `mantenimiento_tickets`, los valores nuevos al enum `estado_ticket_mant` y
-- `ronda_visitas.ticket_id`. Nada de eso se adelanta aquí.

/** Medidores que pasaron su `valor_alerta`, con el activo y la sede ya
    resueltos. Contar y filtrar en la VISTA, no trayendo filas: Supabase corta
    las consultas a los 8 segundos. */
-- `security_invoker = true` NO es opcional: una vista normal corre con los
-- privilegios de su DUEÑO y se salta la RLS de las tablas que lee, así que sin
-- esto cualquiera con sesión vería los medidores de todos los contratos.
DROP VIEW IF EXISTS vw_activos_medidor_vencido;
CREATE VIEW vw_activos_medidor_vencido
WITH (security_invoker = true) AS
SELECT m.id            AS medidor_id,
       m.activo_id,
       m.grupo_id,
       m.sede_id,
       a.codigo        AS activo_codigo,
       a.nombre        AS activo_nombre,
       a.sede_nombre,
       a.criticidad,
       m.nombre        AS medidor_nombre,
       m.tipo          AS medidor_tipo,
       m.unidad,
       m.valor_actual,
       m.valor_alerta,
       m.leido_at,
       (m.valor_actual - m.valor_alerta) AS excedido_en
  FROM public.activo_medidores m
  JOIN public.activos a ON a.id = m.activo_id
 WHERE m.activo
   AND a.activo
   AND a.estado <> 'RETIRADO'
   AND m.valor_alerta IS NOT NULL
   AND m.valor_actual >= m.valor_alerta;

COMMENT ON VIEW vw_activos_medidor_vencido IS
  'Medidores que llegaron o pasaron su valor de alerta, con el activo resuelto. La vista hereda la RLS de activo_medidores y activos, así que cada quien ve lo de su alcance. Para el tablero de F6 y los planes por medidor de F7.';
GRANT SELECT ON vw_activos_medidor_vencido TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. Catálogo general de tipos (los seis de §2.1, más los dos de siempre)
-- ──────────────────────────────────────────────────────────────────────────────
-- Son los tipos GENERALES (`grupo_id IS NULL`): aplican a todos los contratos y
-- la operación puede desactivarlos o agregar los suyos. No son datos de muestra
-- —son catálogo— así que se quedan.
INSERT INTO activo_tipos
  (grupo_id, codigo, nombre, descripcion, categoria, icono, criticidad_sugerida,
   vida_util_meses, exige_medidor, medidor_tipo, medidor_unidad,
   obligatorio_normativo, normativa, orden)
VALUES
  (NULL, 'EXTINTOR', 'Extintor', 'Extintor portátil. La recarga es anual y la exige la norma, no el contrato.',
   'SEGURIDAD', 'flame-kindling', 'ALTA', 120, false, NULL, NULL,
   true, 'NTC 2885 · recarga anual', 10),
  (NULL, 'ASCENSOR', 'Ascensor', 'Ascensor de pasajeros o de carga. Mantenimiento por ciclos y revisión periódica obligatoria.',
   'TRANSPORTE_VERTICAL', 'move-vertical', 'CRITICA', 300, true, 'CICLOS', 'ciclos',
   true, 'NTC 5926 · revisión periódica', 20),
  (NULL, 'BOMBA', 'Bomba de agua', 'Bomba de presión o eyectora. El mantenimiento va por horas de funcionamiento.',
   'HIDRAULICO', 'waves', 'ALTA', 120, true, 'HORAS', 'h',
   false, NULL, 30),
  (NULL, 'LUMINARIA', 'Luminaria', 'Luminaria de zona común, parqueadero o fachada.',
   'ILUMINACION', 'lightbulb', 'BAJA', 60, false, NULL, NULL,
   false, NULL, 40),
  (NULL, 'GRIFERIA', 'Grifería', 'Grifería y aparatos sanitarios de zonas comunes.',
   'HIDRAULICO', 'droplets', 'BAJA', 96, false, NULL, NULL,
   false, NULL, 50),
  (NULL, 'PUERTA_AUTOMATICA', 'Puerta automática', 'Puerta o portón automático, incluida la barrera vehicular. Mantenimiento por ciclos.',
   'MECANICO', 'door-open', 'ALTA', 120, true, 'CICLOS', 'ciclos',
   false, NULL, 60),
  (NULL, 'PLANTA_ELECTRICA', 'Planta eléctrica', 'Planta de emergencia. Prueba periódica y mantenimiento por horas.',
   'ELECTRICO', 'zap', 'CRITICA', 240, true, 'HORAS', 'h',
   false, NULL, 70),
  (NULL, 'TANQUE_AGUA', 'Tanque de agua', 'Tanque de almacenamiento. El lavado y la desinfección son obligatorios.',
   'HIDRAULICO', 'container', 'ALTA', NULL, false, NULL, NULL,
   true, 'Resolución 2115 de 2007 · lavado semestral', 80)
ON CONFLICT (codigo) WHERE grupo_id IS NULL DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. Auditoría: mirar sin tocar
-- ──────────────────────────────────────────────────────────────────────────────
-- Mismo criterio que PQRS y que el catálogo de F3: el rol Auditor lee los
-- activos y no los cambia.
UPDATE public.roles
   SET permisos = permisos || '{"ver_activos_ronda": true}'::jsonb
 WHERE upper(nombre) LIKE '%AUDITOR%'
   AND COALESCE((permisos->>'ver_activos_ronda')::boolean, false) IS DISTINCT FROM true;

-- =============================================================================
-- FIN F6
-- =============================================================================
