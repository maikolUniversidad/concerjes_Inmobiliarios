-- =============================================================================
-- PUNTOS QR · F5 — PQRS POR EL MISMO QR
-- =============================================================================
-- Un residente escanea la placa de un punto de control con su celular, no tiene
-- cuenta y quiere avisar que el baño del piso 3 está sucio. Eso tiene que caer
-- en el MÓDULO DE PQRS QUE YA EXISTE (20261018000004_pqrs.sql), atado al punto
-- y al contrato correctos, y seguir la misma vida que cualquier otra PQRS:
-- plazo en días hábiles, bitácora inmutable, responsable, respuesta y cierre.
--
-- Por eso esta fase NO crea un módulo nuevo. Es la reutilización más importante
-- del complemento 2 (§4.6): el módulo ya resuelve lo difícil —estados, plazos
-- hábiles con `pqrs_sumar_habiles()`, bitácora con adjuntos y realtime, bucket
-- privado, alcance por rol, escrituras por RPC, eventos de notificación— y su
-- `canal` ya admitía WHATSAPP y PORTAL. Aquí solo se le agrega lo que le falta
-- para recibir del QR.
--
-- Lo que esta migración agrega, y nada más:
--   1. `pqrs_categorias`: catálogo parametrizable POR CONTRATO (grupo_id NULL =
--      aplica a todos, el mismo patrón de `ronda_instructivos` y de la §2.4).
--   2. Columnas nuevas en `pqrs`: `punto_id`, `zona_id`, `qr_id`, `categoria_id`,
--      `ip_hash`, `satisfaccion` + `satisfaccion_at`, y el valor `QR` en `canal`.
--      Más dos nombres desnormalizados (`punto_nombre`, `categoria_nombre`),
--      por la misma razón que ya existe `persona_nombre`: quien atiende la PQRS
--      desde /pqrs puede no tener `ver_puntos_ronda`, y tiene que ver de qué
--      punto le están hablando.
--   3. Columnas nuevas en `pqrs_bitacora`: `canal` y `direccion`, para que el
--      hilo por correo o por WhatsApp entre al mismo caso (§4.6).
--   4. `pqrs_radicar_publica()`: la ÚNICA puerta de escritura pública.
--   5. El límite antispam por `ip_hash` y por punto.
--
-- DECISIONES QUE SE TOMAN AQUÍ (y por qué)
--
-- · La escritura pública va por RPC, no por una política `anon` de INSERT.
--   Una política no puede validar el token del QR, ni la vigencia del contrato,
--   ni el límite por hora. La RPC sí, y es la misma idea del resto del módulo:
--   la base valida, el cliente solo pide.
--
-- · La RPC NO se le concede a `anon`. La llama el SERVIDOR con la llave de
--   servicio, igual que `/q/<token>` resuelve el punto con `getAdmin()`
--   (app/q/puerta-supabase.ts). Dos razones:
--     – el `ip_hash` tiene que calcularlo el servidor con su sal; si lo mandara
--       el navegador, saltarse el límite sería cambiar un campo del formulario;
--     – la FIRMA del token se verifica en el servidor (lib/puntos-qr-firma.ts,
--       la llave vive en variables de entorno, nunca en la base), así que la
--       autoridad de la página ya es del servidor.
--   La RPC vuelve a validar TODO lo que puede validar sin la llave —que el QR
--   exista, esté ACTIVO, el contrato esté vigente, el punto no esté retirado,
--   el contrato tenga PQRS pública encendida, la categoría aplique y el límite
--   no esté excedido—, para que un error del lado del servidor no abra la
--   puerta. Defensa en profundidad, no confianza.
--
-- · `ip_hash` admite NULL. Si el despliegue no tiene sal configurada, se radica
--   igual y se guarda NULL: NUNCA se guarda la IP en claro (dato personal, Ley
--   1581 de 2012). En ese caso el límite que protege es el del PUNTO, que no
--   necesita conocer el origen. La IP en claro no entra a esta tabla jamás.
--
-- · El desafío tipo captcha de §6.2 queda PENDIENTE: no hay ninguno en el
--   repositorio y elegirlo es una decisión del usuario (§10.1). El freno de hoy
--   es el límite por hora más la firma del QR, que es lo que impide fabricar un
--   punto para radicar en masa.
--
-- · Las PQRS públicas nacen SIN responsable y con prioridad de la categoría.
--   Nadie con cuenta las radicó, así que `radicada_por` es NULL y
--   `radicada_nombre` dice por dónde entró. La política de lectura de `pqrs`
--   ya las muestra por sede, que es el alcance correcto.
--
-- IDEMPOTENTE: se puede correr dos veces sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo de categorías (parametrizable por contrato)
-- ──────────────────────────────────────────────────────────────────────────────
-- Las seis de §6.2 vienen sembradas como catálogo GENERAL (`grupo_id IS NULL`).
-- Un contrato puede agregar las suyas o apagar las generales creando su propia
-- fila; lo que NO se hace es borrar una categoría usada, porque dejaría PQRS
-- radicadas sin categoría (la llave foránea es ON DELETE SET NULL por eso).
CREATE TABLE IF NOT EXISTS pqrs_categorias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = aplica a todos los contratos. Mismo patrón que `ronda_instructivos`.
  grupo_id      UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  codigo        VARCHAR(30) NOT NULL,
  nombre        VARCHAR(80) NOT NULL,
  descripcion   VARCHAR(200),
  -- Qué tipo de PQRS se radica por defecto cuando el residente elige esto. Es
  -- una SUGERENCIA: quien atiende la puede cambiar como cualquier otra PQRS.
  tipo_sugerido VARCHAR(14) NOT NULL DEFAULT 'QUEJA'
                CHECK (tipo_sugerido IN ('PETICION','QUEJA','RECLAMO','SUGERENCIA','FELICITACION')),
  prioridad_sugerida VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                CHECK (prioridad_sugerida IN ('BAJA','MEDIA','ALTA','CRITICA')),
  orden         INT NOT NULL DEFAULT 0,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pqrs_categorias_codigo_chk CHECK (codigo ~ '^[A-Z0-9_]{2,30}$')
);

COMMENT ON TABLE pqrs_categorias IS
  'Categorías de la PQRS que se radica desde el QR de un punto (limpieza, insumos, olores, basuras, daño, otro). Parametrizable por contrato: grupo_id NULL = aplica a todos (§4.6 del complemento 2).';
COMMENT ON COLUMN pqrs_categorias.tipo_sugerido IS
  'Tipo de PQRS con el que nace lo radicado en esta categoría. Sugerencia, no camisa de fuerza: coordinación lo cambia como en cualquier PQRS.';

-- Único por contrato, y único entre las generales. Dos índices parciales porque
-- en un UNIQUE normal dos NULL no chocan y se podrían sembrar dos "LIMPIEZA"
-- generales.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pqrs_categorias_grupo
  ON pqrs_categorias (grupo_id, codigo) WHERE grupo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pqrs_categorias_general
  ON pqrs_categorias (codigo) WHERE grupo_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_pqrs_categorias_activas
  ON pqrs_categorias (grupo_id, orden, nombre) WHERE activo;

DROP TRIGGER IF EXISTS tr_pqrs_categorias_upd ON pqrs_categorias;
CREATE TRIGGER tr_pqrs_categorias_upd BEFORE UPDATE ON pqrs_categorias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Las seis de §6.2. `ON CONFLICT DO NOTHING` sobre el índice de las generales:
-- si alguien ya les cambió el nombre o el orden, no se le pisa.
INSERT INTO pqrs_categorias (grupo_id, codigo, nombre, descripcion, tipo_sugerido, prioridad_sugerida, orden)
VALUES
  (NULL, 'LIMPIEZA',  'Aseo y limpieza',      'Una zona quedó sucia o no se ha limpiado.',              'QUEJA',      'MEDIA',  10),
  (NULL, 'INSUMOS',   'Faltan insumos',       'No hay jabón, papel, bolsas u otro insumo del punto.',   'PETICION',   'MEDIA',  20),
  (NULL, 'OLORES',    'Malos olores',         'Hay un olor que no corresponde en la zona.',             'QUEJA',      'MEDIA',  30),
  (NULL, 'BASURAS',   'Basuras',              'Canecas llenas, bolsas fuera de lugar o shut tapado.',   'QUEJA',      'ALTA',   40),
  (NULL, 'DANO',      'Daño o avería',        'Algo está roto, dañado o no funciona.',                  'RECLAMO',    'ALTA',   50),
  (NULL, 'OTRO',      'Otro',                 'Cualquier otra cosa que quieras informar.',              'PETICION',   'MEDIA',  90)
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Lo que se le agrega a `pqrs`
-- ──────────────────────────────────────────────────────────────────────────────
-- Nada de `grupo_id` ni `sede_id`: la tabla YA los tiene y el trigger de
-- denormalización de 20261018000004 los deriva de la sede (§2.4).
ALTER TABLE pqrs
  ADD COLUMN IF NOT EXISTS punto_id         UUID REFERENCES ronda_puntos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zona_id          UUID REFERENCES ronda_zonas(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qr_id            UUID REFERENCES ronda_qr(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS categoria_id     UUID REFERENCES pqrs_categorias(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS punto_nombre     VARCHAR(240),
  ADD COLUMN IF NOT EXISTS categoria_nombre VARCHAR(80),
  ADD COLUMN IF NOT EXISTS ip_hash          TEXT,
  ADD COLUMN IF NOT EXISTS satisfaccion     SMALLINT,
  ADD COLUMN IF NOT EXISTS satisfaccion_at  TIMESTAMPTZ;

COMMENT ON COLUMN pqrs.punto_id IS
  'Punto de control por cuyo QR entró la PQRS (F5). NULL en las que se radican desde la consola.';
COMMENT ON COLUMN pqrs.qr_id IS
  'Versión exacta de la placa que se escaneó. Sirve para saber si una placa concreta está generando reportes raros.';
COMMENT ON COLUMN pqrs.ip_hash IS
  'SHA-256 con sal de la IP de quien radicó desde el QR. Solo para limitar envíos por hora; la IP en claro NUNCA se guarda (Ley 1581 de 2012). NULL cuando el despliegue no tiene sal configurada.';
COMMENT ON COLUMN pqrs.satisfaccion IS
  'Conformidad de quien radicó, 1 a 5, preguntada después de la respuesta (§6.3). Lo escribe el enlace público de seguimiento, no la consola.';
COMMENT ON COLUMN pqrs.punto_nombre IS
  'Desnormalizado: quien atiende la PQRS puede no tener `ver_puntos_ronda` y la RLS de ronda_puntos no le dejaría leer el nombre. Misma razón que persona_nombre.';

DO $$ BEGIN
  ALTER TABLE pqrs ADD CONSTRAINT pqrs_satisfaccion_chk
    CHECK (satisfaccion IS NULL OR satisfaccion BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Coherencia: si entró por un QR, se sabe de qué punto. Y al contrario, una
-- PQRS de la consola puede llevar punto (alguien la radica a mano sobre un
-- punto) sin haber escaneado nada.
DO $$ BEGIN
  ALTER TABLE pqrs ADD CONSTRAINT pqrs_canal_qr_chk
    CHECK (canal <> 'QR' OR punto_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `canal` gana el valor QR. El CHECK se reemplaza por el mismo con un valor más.
DO $$
DECLARE v_nombre TEXT;
BEGIN
  SELECT k.conname INTO v_nombre
    FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
   WHERE t.relname = 'pqrs' AND k.contype = 'c'
     AND pg_get_constraintdef(k.oid) ILIKE '%canal%'
     AND pg_get_constraintdef(k.oid) ILIKE '%SEDE%'
   LIMIT 1;
  IF v_nombre IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pqrs DROP CONSTRAINT %I', v_nombre);
  END IF;
  ALTER TABLE pqrs ADD CONSTRAINT pqrs_canal_chk
    CHECK (canal IN ('SEDE','TELEFONO','CORREO','WHATSAPP','PORTAL','QR','OTRO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El índice que de verdad se consulta: ¿cuántas radicaciones de este origen en
-- la última hora? Mismo criterio de 20260906000000_empresas_cotizacion_rate_limit.
CREATE INDEX IF NOT EXISTS idx_pqrs_ip_hash_fecha
  ON pqrs (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pqrs_punto
  ON pqrs (punto_id, created_at DESC) WHERE punto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pqrs_categoria
  ON pqrs (categoria_id) WHERE categoria_id IS NOT NULL;

-- Los dos nombres desnormalizados, en SU PROPIO trigger y no dentro de
-- `tr_pqrs_denormalizar()`: si alguna vez se vuelve a correr la migración de
-- PQRS, ese `CREATE OR REPLACE` no se lleva por delante lo de F5.
CREATE OR REPLACE FUNCTION public.tr_pqrs_denormalizar_f5()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.punto_id IS DISTINCT FROM OLD.punto_id THEN
    SELECT left(p.codigo || ' · ' || p.nombre, 240) INTO NEW.punto_nombre
      FROM ronda_puntos p WHERE p.id = NEW.punto_id;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.categoria_id IS DISTINCT FROM OLD.categoria_id THEN
    NEW.categoria_nombre := (SELECT nombre FROM pqrs_categorias WHERE id = NEW.categoria_id);
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION public.tr_pqrs_denormalizar_f5() IS
  'Copia el punto y la categoría a texto en la propia PQRS, para que /pqrs los muestre sin exigir ver_puntos_ronda.';
DROP TRIGGER IF EXISTS tr_pqrs_denormalizar_f5 ON pqrs;
CREATE TRIGGER tr_pqrs_denormalizar_f5 BEFORE INSERT OR UPDATE ON pqrs
  FOR EACH ROW EXECUTE FUNCTION public.tr_pqrs_denormalizar_f5();

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Lo que se le agrega a `pqrs_bitacora`
-- ──────────────────────────────────────────────────────────────────────────────
-- Para que el hilo por correo o por WhatsApp entre al MISMO caso y se sepa
-- quién habló hacia dónde. Hoy todo lo que escribe la consola es
-- PLATAFORMA/SALIDA; los otros canales los llenan F9 y el buzón de correo.
ALTER TABLE pqrs_bitacora
  ADD COLUMN IF NOT EXISTS canal     VARCHAR(12) NOT NULL DEFAULT 'PLATAFORMA',
  ADD COLUMN IF NOT EXISTS direccion VARCHAR(8)  NOT NULL DEFAULT 'SALIDA';

DO $$ BEGIN
  ALTER TABLE pqrs_bitacora ADD CONSTRAINT pqrs_bitacora_canal_chk
    CHECK (canal IN ('PLATAFORMA','CORREO','WHATSAPP','QR'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE pqrs_bitacora ADD CONSTRAINT pqrs_bitacora_direccion_chk
    CHECK (direccion IN ('ENTRADA','SALIDA'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN pqrs_bitacora.canal IS
  'Por dónde entró o salió este mensaje. PLATAFORMA es la consola; CORREO y WHATSAPP los llenan la recepción de correo y el bot (F9), para que el hilo caiga en el mismo caso (§4.6).';
COMMENT ON COLUMN pqrs_bitacora.direccion IS
  'ENTRADA = lo dijo quien radicó o un tercero; SALIDA = lo dijo la empresa.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Quién ve y quién parametriza el catálogo
-- ──────────────────────────────────────────────────────────────────────────────
-- La clave nueva es `parametrizar_pqrs`: cambiar el catálogo de categorías es
-- cambiar lo que ve un residente en la calle, y no es lo mismo que atender una
-- PQRS. Las lecturas también pasan por `auth_permiso()`, como manda el repo.
CREATE OR REPLACE FUNCTION public.pqrs_parametriza()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('parametrizar_pqrs')
$$;
COMMENT ON FUNCTION public.pqrs_parametriza() IS
  'Puede cambiar el catálogo de categorías de PQRS (clave parametrizar_pqrs).';
GRANT EXECUTE ON FUNCTION public.pqrs_parametriza() TO authenticated;

ALTER TABLE pqrs_categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pqrs_categorias_read ON pqrs_categorias;
CREATE POLICY pqrs_categorias_read ON pqrs_categorias FOR SELECT TO authenticated
  USING ((SELECT public.pqrs_acceso()) OR (SELECT public.pqrs_parametriza()));

DROP POLICY IF EXISTS pqrs_categorias_write ON pqrs_categorias;
CREATE POLICY pqrs_categorias_write ON pqrs_categorias FOR ALL TO authenticated
  USING ((SELECT public.pqrs_parametriza()))
  WITH CHECK ((SELECT public.pqrs_parametriza()));

/**
 * Categorías que aplican a un contrato: las suyas más las generales. Es lo que
 * ofrece el formulario público y lo que ofrece la consola al radicar.
 * Si el contrato definió una categoría con el MISMO código que una general, la
 * del contrato gana: así se "apaga" una general sin tocar el catálogo de todos.
 */
CREATE OR REPLACE FUNCTION public.pqrs_categorias_de(p_grupo UUID)
RETURNS TABLE (id UUID, codigo VARCHAR, nombre VARCHAR, descripcion VARCHAR,
               tipo_sugerido VARCHAR, prioridad_sugerida VARCHAR, propia BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.codigo, c.nombre, c.descripcion,
         c.tipo_sugerido, c.prioridad_sugerida, (c.grupo_id IS NOT NULL)
    FROM pqrs_categorias c
   WHERE c.activo
     AND (c.grupo_id = p_grupo
       OR (c.grupo_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM pqrs_categorias d
                            WHERE d.grupo_id = p_grupo AND d.codigo = c.codigo)))
   ORDER BY c.orden, c.nombre, c.id
$$;
COMMENT ON FUNCTION public.pqrs_categorias_de(UUID) IS
  'Catálogo efectivo de un contrato: sus categorías más las generales que no haya reemplazado por código.';
-- Primero se le quita a PUBLIC (que es por donde entraría `anon`) y después se
-- concede a quien sí la usa: la consola con la sesión del usuario, y el
-- servidor para la página pública.
REVOKE ALL ON FUNCTION public.pqrs_categorias_de(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pqrs_categorias_de(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Antispam: cuántas van en la última hora
-- ──────────────────────────────────────────────────────────────────────────────
-- Dos límites, porque frenan cosas distintas:
--   · por ORIGEN (`ip_hash`): un script radicando desde una máquina;
--   · por PUNTO: diez personas distintas reportando el mismo baño en una hora,
--     que no es ataque pero tampoco son diez PQRS que haya que responder una
--     por una. Al llegar al tope se le dice que ya está reportado.
-- Los topes son constantes de la función y no tabla: hoy no hay pantalla que
-- los cambie, y una tabla de parámetros que nadie edita es peor que un número
-- con nombre. Si el usuario los quiere mover, pasan a `pqrs_plazos` y listo.
CREATE OR REPLACE FUNCTION public.pqrs_publica_cupo(p_ip_hash TEXT, p_punto UUID)
RETURNS TABLE (por_origen INT, por_punto INT, tope_origen INT, tope_punto INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((SELECT count(*)::int FROM pqrs
               WHERE p_ip_hash IS NOT NULL AND ip_hash = p_ip_hash
                 AND created_at > NOW() - INTERVAL '1 hour'), 0),
    COALESCE((SELECT count(*)::int FROM pqrs
               WHERE punto_id = p_punto AND canal = 'QR'
                 AND created_at > NOW() - INTERVAL '1 hour'), 0),
    5, 10
$$;
COMMENT ON FUNCTION public.pqrs_publica_cupo(TEXT, UUID) IS
  'Radicaciones de la última hora por origen y por punto, con sus topes. Lo consulta pqrs_radicar_publica() antes de escribir.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `pqrs_radicar_publica()` — la única puerta de escritura pública
-- ──────────────────────────────────────────────────────────────────────────────
-- Devuelve la PQRS creada (con su `numero`, que es lo que el residente anota).
-- El orden de las validaciones importa, y es el mismo criterio de
-- `app/q/decidir.ts`: primero lo que no revela nada, al final lo que sí.
--
-- Qué NO valida: la FIRMA del token. No puede: la llave vive en variables de
-- entorno del servidor (ADR-B) y no en la base. La firma la verifica
-- `resolverCodigo()` antes de llegar aquí. Lo que esta función garantiza es que
-- aunque ese paso se saltara, nada se escribe sobre un QR revocado, un contrato
-- vencido, un punto retirado, un contrato sin PQRS pública o por encima del
-- límite.
CREATE OR REPLACE FUNCTION public.pqrs_radicar_publica(
  p_codigo       TEXT,                  -- token del QR o código manual de 8
  p_categoria    UUID,
  p_asunto       TEXT,
  p_descripcion  TEXT,
  p_anonima      BOOLEAN DEFAULT true,
  p_solicitante  JSONB   DEFAULT '{}',  -- {nombre, calidad, telefono, email}
  p_ip_hash      TEXT    DEFAULT NULL,
  p_modo         TEXT    DEFAULT 'QR',  -- QR | MANUAL (cómo se abrió la placa)
  p_adjuntos     JSONB   DEFAULT '[]',  -- [{path, nombre, mime, bytes}]
  -- Lo genera el servidor para poder subir la foto ANTES, a `pqrs/{id}/…`,
  -- igual que hace `pqrs_radicar` con su `p_id`.
  p_id           UUID    DEFAULT NULL
) RETURNS pqrs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Se normaliza igual que `normalizar()` en packages/ronda-core: el código
  -- impreso se lee «7PP6-WNGB» y la base guarda `7PP6WNGB`. No se "corrige"
  -- nada más: si alguien escribe una O donde va un 0, el código es otro y tiene
  -- que fallar, no abrir el punto de al lado.
  v_cod      TEXT := regexp_replace(upper(btrim(COALESCE(p_codigo, ''))), '[^0-9A-Z]', '', 'g');
  v_qr       RECORD;
  v_punto    RECORD;
  v_cat      RECORD;
  v_cupo     RECORD;
  v_id       UUID := COALESCE(p_id, gen_random_uuid());
  v_nom      TEXT := NULLIF(btrim(p_solicitante ->> 'nombre'), '');
  v_calidad  TEXT := upper(COALESCE(NULLIF(btrim(p_solicitante ->> 'calidad'), ''), 'RESIDENTE'));
  v_anon     BOOLEAN := COALESCE(p_anonima, true);
  v_modo     TEXT := upper(COALESCE(NULLIF(btrim(p_modo), ''), 'QR'));
  v_dias     INT;
  p_row      pqrs;
  a          JSONB;
BEGIN
  IF v_cod = '' THEN RAISE EXCEPTION 'Falta el código del punto.'; END IF;
  IF v_modo NOT IN ('QR','MANUAL') THEN RAISE EXCEPTION 'Modo de apertura inválido: %', p_modo; END IF;

  -- ── El QR ──────────────────────────────────────────────────────────────────
  SELECT q.id, q.punto_id, q.grupo_id, q.sede_id, q.estado
    INTO v_qr
    FROM ronda_qr q
   WHERE (q.token = v_cod OR q.codigo_manual = v_cod)
     AND q.tipo_objeto = 'PUNTO'
   LIMIT 1;
  IF v_qr.id IS NULL THEN RAISE EXCEPTION 'Este código no corresponde a ningún punto de control.'; END IF;
  IF v_qr.estado <> 'ACTIVO' THEN
    RAISE EXCEPTION 'Esta placa ya no está en uso. Busca la placa nueva en el mismo lugar.';
  END IF;
  -- Vigencia EFECTIVA del contrato (§2.5): la misma función que usa /q/<token>.
  IF NOT public.ronda_qr_vigente(v_qr.id) THEN
    RAISE EXCEPTION 'El contrato de esta sede no está vigente.';
  END IF;

  SELECT p.id, p.zona_id, p.sede_id, p.estado, p.codigo, p.nombre
    INTO v_punto
    FROM ronda_puntos p WHERE p.id = v_qr.punto_id;
  IF v_punto.id IS NULL THEN RAISE EXCEPTION 'Este punto de control ya no existe.'; END IF;
  IF v_punto.estado = 'RETIRADO' THEN RAISE EXCEPTION 'Este punto de control está retirado.'; END IF;

  -- ── ¿Este contrato recibe PQRS por el QR? ──────────────────────────────────
  -- Sin fila de reglas, el valor por defecto de la columna es `false`: NO se
  -- reciben. Encenderlo es una decisión por contrato, no el estado natural.
  IF NOT COALESCE((SELECT r.pqrs_publico FROM grupo_reglas r WHERE r.grupo_id = v_qr.grupo_id), false) THEN
    RAISE EXCEPTION 'Este contrato no recibe PQRS por el código del punto.';
  END IF;

  -- ── La categoría ───────────────────────────────────────────────────────────
  SELECT c.* INTO v_cat FROM public.pqrs_categorias_de(v_qr.grupo_id) c WHERE c.id = p_categoria;
  IF v_cat.id IS NULL THEN RAISE EXCEPTION 'Elige de qué se trata.'; END IF;

  -- ── El texto ───────────────────────────────────────────────────────────────
  IF NULLIF(btrim(p_descripcion), '') IS NULL THEN RAISE EXCEPTION 'Cuéntanos qué pasó.'; END IF;
  IF length(btrim(p_descripcion)) < 10 THEN
    RAISE EXCEPTION 'Cuéntanos un poco más: con menos de diez letras no se puede atender.';
  END IF;
  IF NOT v_anon AND v_nom IS NULL THEN
    RAISE EXCEPTION 'Escribe tu nombre, o marca el reporte como anónimo.';
  END IF;
  IF v_calidad NOT IN ('RESIDENTE','PROPIETARIO','ADMINISTRACION','EMPRESA_USUARIA','COLABORADOR','PROVEEDOR','OTRO') THEN
    RAISE EXCEPTION 'Calidad del solicitante inválida: %', v_calidad;
  END IF;

  -- ── El límite ──────────────────────────────────────────────────────────────
  SELECT * INTO v_cupo FROM public.pqrs_publica_cupo(p_ip_hash, v_punto.id);
  IF v_cupo.por_origen >= v_cupo.tope_origen THEN
    RAISE EXCEPTION 'Ya enviaste varios reportes en la última hora. Espera un momento antes de enviar otro.';
  END IF;
  IF v_cupo.por_punto >= v_cupo.tope_punto THEN
    RAISE EXCEPTION 'Este punto ya tiene varios reportes en la última hora; el equipo está en eso. Vuelve a intentar más tarde.';
  END IF;

  -- ── A escribir ─────────────────────────────────────────────────────────────
  v_dias := COALESCE((SELECT dias_habiles FROM pqrs_plazos WHERE tipo = v_cat.tipo_sugerido), 15);

  INSERT INTO pqrs (
    id, numero, tipo, canal, prioridad, anonima,
    solicitante_nombre, solicitante_calidad, solicitante_telefono, solicitante_email,
    sede_id, asunto, descripcion,
    punto_id, zona_id, qr_id, categoria_id, ip_hash,
    dias_plazo, fecha_limite, radicada_por, radicada_nombre)
  VALUES (
    v_id,
    'PQ-' || lpad(nextval('pqrs_numero_seq')::text, 5, '0'),
    v_cat.tipo_sugerido, 'QR', v_cat.prioridad_sugerida, v_anon,
    CASE WHEN v_anon THEN NULL ELSE left(v_nom, 200) END,
    v_calidad,
    left(NULLIF(btrim(p_solicitante ->> 'telefono'), ''), 30),
    left(NULLIF(btrim(p_solicitante ->> 'email'), ''), 160),
    v_punto.sede_id,
    left(COALESCE(NULLIF(btrim(p_asunto), ''), v_cat.nombre || ' · ' || v_punto.nombre), 200),
    btrim(p_descripcion),
    v_punto.id, v_punto.zona_id, v_qr.id, v_cat.id, p_ip_hash,
    v_dias, public.pqrs_sumar_habiles(CURRENT_DATE, v_dias),
    NULL,
    CASE WHEN v_modo = 'MANUAL' THEN 'Código del punto (tecleado)' ELSE 'QR del punto' END)
  RETURNING * INTO p_row;

  INSERT INTO pqrs_bitacora (pqrs_id, tipo, mensaje, estado_nuevo, canal, direccion)
  VALUES (p_row.id, 'SISTEMA',
          'Radicada desde el ' || CASE WHEN v_modo = 'MANUAL' THEN 'código impreso' ELSE 'QR' END
          || ' del punto ' || v_punto.codigo || ' (' || v_punto.nombre || '), categoría '
          || v_cat.nombre || ' · responder antes del '
          || to_char(p_row.fecha_limite, 'DD/MM/YYYY') || ' (' || v_dias || ' días hábiles).',
          'RADICADA', 'QR', 'ENTRADA');

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]')) LOOP
    IF (a ->> 'path') NOT LIKE p_row.id::text || '/%' THEN RAISE EXCEPTION 'Ruta de adjunto inválida.'; END IF;
    INSERT INTO pqrs_bitacora (pqrs_id, tipo, mensaje, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes, canal, direccion)
    VALUES (p_row.id, 'ADJUNTO', 'Evidencia de quien reportó', a ->> 'path',
            left(a ->> 'nombre', 255), left(a ->> 'mime', 120), (a ->> 'bytes')::bigint, 'QR', 'ENTRADA');
  END LOOP;

  -- Auditoría del módulo de puntos: el escaneo que terminó en PQRS queda en la
  -- misma bitácora append-only donde están las aperturas y los rechazos.
  BEGIN
    INSERT INTO ronda_eventos (grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, canal, detalle)
    VALUES (v_qr.grupo_id, v_punto.sede_id, 'pqrs', p_row.id, 'PQRS_RADICADA', 'ANONIMO', 'PUBLICO',
            jsonb_build_object('numero', p_row.numero, 'punto', v_punto.codigo,
                               'qr_id', v_qr.id, 'categoria', v_cat.codigo, 'modo', v_modo));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pqrs_radicar_publica: no se pudo auditar en ronda_eventos: %', SQLERRM;
  END;

  PERFORM pqrs_notificar('PQRS_RADICADA', p_row.id);
  RETURN p_row;
END; $$;

COMMENT ON FUNCTION public.pqrs_radicar_publica(TEXT, UUID, TEXT, TEXT, BOOLEAN, JSONB, TEXT, TEXT, JSONB, UUID) IS
  'Radica una PQRS desde el QR de un punto SIN sesión (F5 de Puntos QR). Valida el QR, su estado, la vigencia del contrato, el estado del punto, que el contrato reciba PQRS pública (grupo_reglas.pqrs_publico), la categoría y el límite por hora. La llama el SERVIDOR con la llave de servicio: no se concede a anon porque el ip_hash lo calcula el servidor con su sal.';

-- NO se le da a `anon` ni a `authenticated`: la llama el servidor con la llave
-- de servicio desde /q/<token>/pqrs. Ver el encabezado de este archivo.
--
-- OJO con el REVOKE: quitarle el permiso a PUBLIC NO alcanza. Supabase concede
-- EXECUTE explícitamente a `anon` y a `authenticated` sobre las funciones nuevas
-- del esquema `public` (ALTER DEFAULT PRIVILEGES), y un GRANT explícito sobrevive
-- al revoke de PUBLIC. Sin estas tres líneas, cualquiera con sesión podría
-- llamar la RPC pasándole el `ip_hash` que quisiera y saltarse el límite por
-- hora. Lo comprueba `scripts/probar-puntos-qr-f5.mjs`.
REVOKE ALL ON FUNCTION public.pqrs_radicar_publica(TEXT, UUID, TEXT, TEXT, BOOLEAN, JSONB, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pqrs_publica_cupo(TEXT, UUID) FROM PUBLIC;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.pqrs_radicar_publica(TEXT, UUID, TEXT, TEXT, BOOLEAN, JSONB, TEXT, TEXT, JSONB, UUID) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.pqrs_publica_cupo(TEXT, UUID) FROM %I', r);
      -- `pqrs_categorias_de` SÍ la usa la consola con la sesión del usuario (la
      -- ofrece al radicar), así que de ahí solo sale `anon`.
      IF r = 'anon' THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.pqrs_categorias_de(UUID) FROM anon';
      END IF;
    EXCEPTION WHEN undefined_object THEN NULL; END;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.pqrs_radicar_publica(TEXT, UUID, TEXT, TEXT, BOOLEAN, JSONB, TEXT, TEXT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pqrs_publica_cupo(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pqrs_categorias_de(UUID) TO service_role;

/**
 * Lo que necesita la página pública ANTES de mostrar el formulario: si este
 * contrato recibe PQRS por el QR. El catálogo se pide con `pqrs_categorias_de`.
 * Va por función y no por lectura directa de `grupo_reglas` para que la página
 * pública no tenga que leer una tabla de contrato entera.
 */
CREATE OR REPLACE FUNCTION public.pqrs_publica_activa(p_qr UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT COALESCE(r.pqrs_publico, false) AND public.ronda_qr_vigente(q.id)
      FROM ronda_qr q LEFT JOIN grupo_reglas r ON r.grupo_id = q.grupo_id
     WHERE q.id = p_qr
  ), false)
$$;
COMMENT ON FUNCTION public.pqrs_publica_activa(UUID) IS
  'TRUE si por este QR se puede radicar una PQRS pública: el contrato lo tiene encendido (grupo_reglas.pqrs_publico) y el QR está vigente.';
REVOKE ALL ON FUNCTION public.pqrs_publica_activa(UUID) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.pqrs_publica_activa(UUID) FROM anon';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
GRANT EXECUTE ON FUNCTION public.pqrs_publica_activa(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pqrs_publica_activa(UUID) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Seguimiento público del radicado (§6.3, mínimo)
-- ──────────────────────────────────────────────────────────────────────────────
-- Quien radicó sin cuenta tiene derecho a saber en qué va. Se consulta por
-- NÚMERO, y solo devuelve lo que ya sabe: su propio reporte y el estado. Nada
-- de la bitácora interna, ni responsable, ni quién atiende.
CREATE OR REPLACE FUNCTION public.pqrs_estado_publico(p_numero TEXT)
RETURNS TABLE (numero VARCHAR, estado VARCHAR, tipo VARCHAR, asunto VARCHAR,
               categoria VARCHAR, punto VARCHAR, fecha_limite DATE,
               radicada_at TIMESTAMPTZ, respondida_at TIMESTAMPTZ, respuesta TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.numero, p.estado, p.tipo, p.asunto, p.categoria_nombre, p.punto_nombre,
         p.fecha_limite, p.created_at, p.respondida_at, p.respuesta
    FROM pqrs p
   WHERE p.canal = 'QR'
     AND upper(btrim(p.numero)) = upper(btrim(p_numero))
$$;
COMMENT ON FUNCTION public.pqrs_estado_publico(TEXT) IS
  'Estado de una PQRS radicada por QR, para quien la radicó sin cuenta. Solo lo que esa persona ya sabe más el estado y la respuesta; nada de la bitácora interna. Solo canal QR: no sirve para pescar PQRS internas por número.';
REVOKE ALL ON FUNCTION public.pqrs_estado_publico(TEXT) FROM PUBLIC;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.pqrs_estado_publico(TEXT) FROM %I', r);
    EXCEPTION WHEN undefined_object THEN NULL; END;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.pqrs_estado_publico(TEXT) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Permisos en /roles
-- ──────────────────────────────────────────────────────────────────────────────
-- La clave se declara en apps/inventario/lib/permisos.ts (grupo "Operación
-- Conserjería"), que es la fuente de verdad de la pantalla. Aquí solo se la
-- siembra a quien ya parametriza el módulo, para que nadie se quede sin poder
-- tocar el catálogo después de la migración.
UPDATE public.roles
   SET permisos = permisos || '{"parametrizar_pqrs": true}'::jsonb
 WHERE COALESCE(permisos ->> 'gestionar_pqrs', 'false') = 'true'
   AND rol_base IN ('SUPER_ADMIN','ADMIN')
   AND COALESCE(permisos ->> 'parametrizar_pqrs', 'false') <> 'true';

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. Evento de notificación de lo que entra por el QR
-- ──────────────────────────────────────────────────────────────────────────────
-- Se reutiliza `PQRS_RADICADA`, que ya existe: para el motor de flujos una PQRS
-- del QR es una PQRS. Lo que cambia es el `canal` de las variables, que ya
-- viajaba en el evento. No se crea un evento nuevo a propósito: dos eventos
-- para lo mismo obligarían a configurar dos flujos.
