-- =============================================================================
-- PLANTA DE PERSONAL  ·  nómina ↔ contratación ↔ disponibilidad
-- =============================================================================
-- Trae a la plataforma los dos informes de nómina que hasta ahora vivían en
-- Excel —«Personal Por Cargos» (activos) y «Personal por Fecha de Retiro»
-- (retirados)— y los deja conectados con lo que ya existe:
--
--   · `personas` es el maestro único de colaboradores (documento = llave).
--     Se le agregan los campos de nómina que faltaban (código de empleado,
--     centro de costos, ciudad, tipo de nómina, salario, fecha de retiro).
--   · `persona_vinculaciones` guarda el HISTORIAL laboral: una fila por cada
--     paso por la empresa. Hace falta porque 471 documentos aparecen en los dos
--     informes: gente retirada que volvió a entrar. Sin historial, la segunda
--     vinculación pisaría la primera y se perdería la trazabilidad.
--   · `centros_costo` normaliza el texto «TRANSMILENIO 2026-BOGOTA» y es el
--     puente hacia contratación: cada centro de costos puede apuntar a la
--     `obra` y al cliente (`empresas_usuarias`) que lo originan.
--   · El ATS (registro de vacantes) queda enganchado: un candidato que ya
--     trabajó con nosotros se reconoce por documento y el drawer puede mostrar
--     su hoja de vida laboral y si es elegible para recontratación.
--   · Las vistas `vw_planta_personal`, `vw_personal_disponible` y
--     `vw_personal_recontratable` son lo que consume la programación de
--     personal para saber con quién se cuenta hoy.
--
-- IDEMPOTENTE: se puede repetir sin efecto.
-- =============================================================================

SET search_path TO public;

-- =============================================================================
-- 1. CENTROS DE COSTO  (puente nómina ↔ contrato/obra ↔ cliente)
-- =============================================================================
CREATE TABLE IF NOT EXISTS centros_costo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            VARCHAR(160) NOT NULL UNIQUE,   -- tal cual viene de nómina
  nombre            VARCHAR(160) NOT NULL,          -- 'TRANSMILENIO 2026'
  ciudad            VARCHAR(120),                   -- 'BOGOTA'
  -- Enganche con contratación. Se llenan a mano desde el administrativo: la
  -- nómina no sabe de obras, pero el nombre del centro de costos casi siempre
  -- corresponde a un contrato de servicio con un cliente.
  cliente_id        UUID REFERENCES empresas_usuarias(id) ON DELETE SET NULL,
  obra_id           UUID REFERENCES obras(id) ON DELETE SET NULL,
  grupo_id          UUID REFERENCES grupos_contrato(id) ON DELETE SET NULL,
  -- 'DISPONIBLE-BOGOTA' no es un contrato: es el banco de personal sin asignar.
  es_disponibilidad BOOLEAN NOT NULL DEFAULT false,
  es_administrativo BOOLEAN NOT NULL DEFAULT false,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_centros_costo_ciudad ON centros_costo(ciudad);
CREATE INDEX IF NOT EXISTS idx_centros_costo_obra   ON centros_costo(obra_id);

DROP TRIGGER IF EXISTS tr_centros_costo_upd ON centros_costo;
CREATE TRIGGER tr_centros_costo_upd BEFORE UPDATE ON centros_costo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. `personas` gana los campos de nómina
-- =============================================================================
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nombre_completo   VARCHAR(240);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS codigo_empleado   VARCHAR(30);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS centro_costo_id   UUID REFERENCES centros_costo(id) ON DELETE SET NULL;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS ciudad            VARCHAR(120);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS departamento      VARCHAR(120);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS tipo_nomina       VARCHAR(160);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS salario           NUMERIC(14,2);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS tipo_contrato     VARCHAR(60);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS fecha_retiro      DATE;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS motivo_retiro     TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS elegible_recontratacion BOOLEAN NOT NULL DEFAULT true;
-- De dónde salió la ficha: MANUAL, IMPORTACION_NOMINA, REGISTRO_VACANTES.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS origen            VARCHAR(40) NOT NULL DEFAULT 'MANUAL';
-- Los informes traen «Apellidos y Nombres» en un solo campo. El corte se hace
-- por frecuencia (ver scripts/importar-planta-personal.mjs) y esta columna
-- avisa cuándo hay que revisarlo a mano.
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nombre_confianza  VARCHAR(10);

COMMENT ON COLUMN personas.nombre_completo  IS 'Nombre exacto como viene de nómina; fuente de verdad si el corte apellidos/nombres queda dudoso.';
COMMENT ON COLUMN personas.nombre_confianza IS 'ALTA | MEDIA | BAJA — confianza del corte automático entre apellidos y nombres.';

CREATE INDEX IF NOT EXISTS idx_personas_centro_costo ON personas(centro_costo_id);
CREATE INDEX IF NOT EXISTS idx_personas_ciudad       ON personas(ciudad);
CREATE INDEX IF NOT EXISTS idx_personas_retiro       ON personas(fecha_retiro DESC);

-- El estado ya se usaba libre; se fija el dominio ahora que entra la nómina.
UPDATE personas SET estado = 'ACTIVO'
 WHERE estado IS NULL OR estado NOT IN ('ACTIVO','RETIRADO','SUSPENDIDO');
ALTER TABLE personas DROP CONSTRAINT IF EXISTS ck_personas_estado;
ALTER TABLE personas ADD  CONSTRAINT ck_personas_estado
  CHECK (estado IN ('ACTIVO','RETIRADO','SUSPENDIDO'));

-- =============================================================================
-- 3. HISTORIAL LABORAL  (una fila por paso por la empresa)
-- =============================================================================
CREATE TABLE IF NOT EXISTS persona_vinculaciones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  centro_costo_id     UUID REFERENCES centros_costo(id) ON DELETE SET NULL,
  cargo               VARCHAR(120),
  cargo_id            UUID REFERENCES cargos(id) ON DELETE SET NULL,
  -- Enganche con contratación: cuando la vinculación nazca de un contrato
  -- generado por el ATS, aquí queda el vínculo con el papel firmado.
  contrato_id         UUID REFERENCES contratos(id) ON DELETE SET NULL,
  obra_id             UUID REFERENCES obras(id) ON DELETE SET NULL,
  tipo_contrato       VARCHAR(60),                  -- Labor Contratada | Indefinido
  codigo_empleado     VARCHAR(30),
  tipo_nomina         VARCHAR(160),
  salario             NUMERIC(14,2),
  fecha_ingreso       DATE,
  periodo_prueba      VARCHAR(60),
  fecha_fin_contrato  DATE,
  fecha_retiro        DATE,
  motivo_retiro       TEXT,
  estado              VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',  -- ACTIVA | TERMINADA
  origen              VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  -- Llave de reimportación: 'ACT:<doc>' o 'RET:<doc>:<fecha_retiro>'. Permite
  -- volver a correr el cargue sin duplicar ni perder lo editado a mano.
  clave_origen        VARCHAR(120) UNIQUE,
  observacion         TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT ck_vinculacion_estado CHECK (estado IN ('ACTIVA','TERMINADA'))
);
CREATE INDEX IF NOT EXISTS idx_vinc_persona ON persona_vinculaciones(persona_id, fecha_ingreso DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vinc_estado  ON persona_vinculaciones(estado);
CREATE INDEX IF NOT EXISTS idx_vinc_centro  ON persona_vinculaciones(centro_costo_id);
CREATE INDEX IF NOT EXISTS idx_vinc_retiro  ON persona_vinculaciones(fecha_retiro DESC);
-- Una sola vinculación abierta por persona: no se puede estar contratado dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vinc_una_activa
  ON persona_vinculaciones(persona_id) WHERE estado = 'ACTIVA';

DROP TRIGGER IF EXISTS tr_vinculaciones_upd ON persona_vinculaciones;
CREATE TRIGGER tr_vinculaciones_upd BEFORE UPDATE ON persona_vinculaciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 4. CARGOS  ·  catálogo único compartido con el ATS
-- =============================================================================
-- La tabla venía sin restricción única y quedó cada cargo duplicado. Se colapsa
-- a uno solo (repuntando las referencias) para poder hacer upsert por nombre.
DO $dedupe$
DECLARE
  r   RECORD;
  fk  RECORD;
BEGIN
  FOR r IN
    SELECT nombre, MIN(id::text)::uuid AS conservar, array_agg(id) AS todos
      FROM cargos GROUP BY nombre HAVING COUNT(*) > 1
  LOOP
    -- Se repuntan TODAS las columnas que referencian cargos, sin listarlas a
    -- mano: la lista crece (vacantes, contratos, postulaciones, candidatos…)
    -- y una omisión rompe el borrado con violación de llave foránea.
    FOR fk IN
      SELECT c.conrelid::regclass AS tabla,
             a.attname            AS columna
        FROM pg_constraint c
        JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f' AND c.confrelid = 'cargos'::regclass
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = ANY($2)', fk.tabla, fk.columna, fk.columna)
        USING r.conservar, r.todos;
    END LOOP;
    DELETE FROM cargos WHERE id = ANY(r.todos) AND id <> r.conservar;
  END LOOP;
END $dedupe$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cargos_nombre ON cargos(nombre);

-- =============================================================================
-- 5. ENGANCHE CON CONTRATACIÓN Y SELECCIÓN
-- =============================================================================
-- Un candidato del formulario público que ya trabajó con nosotros se reconoce
-- por documento. El enlace se hace solo, en los dos sentidos, para que el ATS
-- muestre la hoja de vida laboral sin que nadie tenga que buscarla.
CREATE OR REPLACE FUNCTION public.enlazar_candidato_persona()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.persona_id IS NULL AND NEW.numero_documento IS NOT NULL THEN
    SELECT p.id INTO NEW.persona_id
      FROM personas p
     WHERE p.documento = NEW.numero_documento
     LIMIT 1;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_candidato_enlaza_persona ON candidatos;
CREATE TRIGGER tr_candidato_enlaza_persona
  BEFORE INSERT OR UPDATE OF numero_documento ON candidatos
  FOR EACH ROW EXECUTE FUNCTION public.enlazar_candidato_persona();

-- Al revés: cuando entra una persona nueva (cargue de nómina o contratación),
-- se le amarra el candidato que ya existiera con ese documento.
CREATE OR REPLACE FUNCTION public.enlazar_persona_candidato()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE candidatos SET persona_id = NEW.id
   WHERE numero_documento = NEW.documento AND persona_id IS DISTINCT FROM NEW.id;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_persona_enlaza_candidato ON personas;
CREATE TRIGGER tr_persona_enlaza_candidato
  AFTER INSERT OR UPDATE OF documento ON personas
  FOR EACH ROW EXECUTE FUNCTION public.enlazar_persona_candidato();

-- Amarre de lo que ya existía antes de que hubiera triggers.
UPDATE candidatos c
   SET persona_id = p.id
  FROM personas p
 WHERE p.documento = c.numero_documento AND c.persona_id IS DISTINCT FROM p.id;

-- Hoja de vida laboral de un documento — la consume el drawer del ATS.
CREATE OR REPLACE FUNCTION public.historial_laboral(p_documento TEXT)
RETURNS TABLE (
  vinculacion_id UUID, cargo TEXT, centro_costo TEXT, ciudad TEXT,
  tipo_contrato TEXT, fecha_ingreso DATE, fecha_retiro DATE,
  dias_trabajados INT, estado TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT v.id, v.cargo::TEXT, cc.codigo::TEXT, cc.ciudad::TEXT,
         v.tipo_contrato::TEXT, v.fecha_ingreso, v.fecha_retiro,
         (COALESCE(v.fecha_retiro, CURRENT_DATE) - v.fecha_ingreso)::INT,
         v.estado::TEXT
    FROM persona_vinculaciones v
    JOIN personas p ON p.id = v.persona_id
    LEFT JOIN centros_costo cc ON cc.id = v.centro_costo_id
   WHERE p.documento = p_documento
   ORDER BY v.fecha_ingreso DESC NULLS FIRST;
$fn$;

REVOKE ALL ON FUNCTION public.historial_laboral(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historial_laboral(TEXT) TO authenticated, service_role;

-- =============================================================================
-- 6. VISTAS  ·  lo que lee la programación de personal
-- =============================================================================
DROP VIEW IF EXISTS vw_planta_inconsistencias;
DROP VIEW IF EXISTS vw_personal_recontratable;
DROP VIEW IF EXISTS vw_personal_disponible;
DROP VIEW IF EXISTS vw_planta_personal;

-- Foto de la planta: persona + su centro de costos + su cuenta de plataforma.
CREATE VIEW vw_planta_personal AS
SELECT
  p.id, p.documento, p.tipo_doc, p.nombre_completo, p.nombres, p.apellidos,
  p.nombre_confianza, p.cargo, p.estado, p.codigo_empleado,
  p.ciudad, p.departamento, p.telefono, p.direccion, p.email,
  p.salario, p.tipo_nomina, p.tipo_contrato,
  p.fecha_ingreso, p.fecha_retiro, p.elegible_recontratacion, p.origen,
  cc.id     AS centro_costo_id,
  cc.codigo AS centro_costo,
  cc.nombre AS centro_costo_nombre,
  cc.es_disponibilidad,
  cc.es_administrativo,
  cc.obra_id,
  cc.cliente_id,
  p.usuario_id,
  u.email   AS usuario_email,
  u.activo  AS usuario_activo,
  r.nombre  AS usuario_rol,
  (p.usuario_id IS NOT NULL) AS tiene_cuenta,
  (SELECT COUNT(*) FROM persona_vinculaciones v WHERE v.persona_id = p.id) AS veces_vinculado,
  EXISTS (SELECT 1 FROM persona_vinculaciones v
           WHERE v.persona_id = p.id AND v.estado = 'ACTIVA') AS tiene_vinculacion_activa,
  c.id AS candidato_id
FROM personas p
LEFT JOIN centros_costo cc ON cc.id = p.centro_costo_id
LEFT JOIN usuarios u       ON u.id = p.usuario_id
LEFT JOIN roles r          ON r.id = u.rol_id
LEFT JOIN candidatos c     ON c.persona_id = p.id;

-- Personal con el que se cuenta HOY para programar. `disponible` marca a quien
-- está en planta pero no amarrado a un contrato: en un centro de «DISPONIBLE»,
-- o sin centro de costos asignado. Se exige vinculación activa para que las
-- fichas sueltas (responsables de sede cargados a mano, sin contrato laboral)
-- no se cuenten como personal disponible para programar.
CREATE VIEW vw_personal_disponible AS
SELECT
  v.*,
  (v.tiene_vinculacion_activa
   AND (v.centro_costo_id IS NULL OR v.es_disponibilidad)) AS disponible
FROM vw_planta_personal v
WHERE v.estado = 'ACTIVO';

-- Banco de recontratación: quien salió, no está activo hoy y sigue elegible.
CREATE VIEW vw_personal_recontratable AS
SELECT
  v.*,
  (CURRENT_DATE - v.fecha_retiro)::INT AS dias_desde_retiro
FROM vw_planta_personal v
WHERE v.estado = 'RETIRADO' AND v.elegible_recontratacion;

-- Lo que hay que mirar a mano antes de dar la planta por buena.
CREATE VIEW vw_planta_inconsistencias AS
-- El corte automático entre apellidos y nombres quedó dudoso.
SELECT p.id, p.documento, p.nombre_completo, 'NOMBRE_DUDOSO' AS motivo,
       'Revisar el corte entre apellidos y nombres' AS detalle
  FROM personas p
 WHERE p.origen = 'IMPORTACION_NOMINA' AND p.nombre_confianza IN ('BAJA','MEDIA')
UNION ALL
-- Aparece en planta y a la vez tiene un retiro que casi toca el corte del
-- informe de retiros. Ahí sí puede ser un desfase entre los dos exportes: que
-- el de activos se haya generado antes de que nómina procesara ese retiro.
--
-- La ventana va contra el CORTE DEL INFORME, no contra la fecha de hoy, y es de
-- 15 días. Con 60 días contra la fecha de hoy esto marcaba 14 fichas que no
-- tenían nada de malo: 13 eran el cierre y la renovación del contrato
-- POLICIA-SAN ANDRES el 2026-07-31 (12 de ellas con el mismo ingreso y el mismo
-- retiro). Reciclar así al equipo es lo NORMAL con «Labor Contratada»: se
-- liquida al cerrar la obra y se vuelve a vincular con la renovación —
-- TRANSMILENIO 2026 lo hizo con 181 personas y UNAD 2026 con 140. Medir eso
-- como inconsistencia era medir el ciclo del negocio.
SELECT p.id, p.documento, p.nombre_completo, 'ACTIVO_CON_RETIRO_RECIENTE',
       'Retirado el ' || to_char(v.fecha_retiro, 'YYYY-MM-DD')
         || ', a menos de 15 días del corte del informe, y sigue en el de activos'
  FROM personas p
  JOIN persona_vinculaciones v ON v.persona_id = p.id AND v.estado = 'TERMINADA'
 WHERE p.estado = 'ACTIVO'
   AND v.fecha_retiro > (SELECT MAX(fecha_retiro) FROM persona_vinculaciones) - INTERVAL '15 days'
UNION ALL
-- Ficha sin ciudad: no se puede programar a alguien sin saber dónde está.
SELECT p.id, p.documento, p.nombre_completo, 'SIN_CIUDAD',
       'La ficha no trae ciudad ni departamento'
  FROM personas p
 WHERE p.origen = 'IMPORTACION_NOMINA' AND p.ciudad IS NULL
UNION ALL
-- Documento que no parece una cédula (los cargues manuales viejos metieron
-- números de celular en el campo del documento).
SELECT p.id, p.documento, p.nombre_completo, 'DOCUMENTO_SOSPECHOSO',
       'El documento parece un número de celular'
  FROM personas p
 WHERE p.documento ~ '^3[0-9]{9}$';

GRANT SELECT ON vw_planta_inconsistencias TO authenticated, service_role;

-- Los cinco números de la cabecera de la pantalla, en una sola ida a la base.
-- SECURITY INVOKER (el modo por defecto): cuenta solo lo que quien pregunta
-- alcanza a ver por RLS.
CREATE OR REPLACE FUNCTION public.planta_resumen()
RETURNS TABLE (
  activos BIGINT, disponibles BIGINT, retirados BIGINT,
  con_cuenta BIGINT, centros BIGINT
)
LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT
    COUNT(*) FILTER (WHERE estado = 'ACTIVO'),
    COUNT(*) FILTER (WHERE estado = 'ACTIVO' AND tiene_vinculacion_activa AND es_disponibilidad),
    COUNT(*) FILTER (WHERE estado = 'RETIRADO'),
    COUNT(*) FILTER (WHERE estado = 'ACTIVO' AND tiene_cuenta),
    (SELECT COUNT(*) FROM centros_costo WHERE activo)
  FROM vw_planta_personal;
$fn$;

REVOKE ALL ON FUNCTION public.planta_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.planta_resumen() TO authenticated, service_role;

-- =============================================================================
-- 7. RLS
-- =============================================================================
ALTER TABLE centros_costo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_vinculaciones  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cc_lee     ON centros_costo;
DROP POLICY IF EXISTS cc_escribe ON centros_costo;
CREATE POLICY cc_lee ON centros_costo FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_planta_personal','ver_personas','ver_postulaciones']));
CREATE POLICY cc_escribe ON centros_costo FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_planta_personal'))
  WITH CHECK (public.auth_permiso('gestionar_planta_personal'));

DROP POLICY IF EXISTS vinc_lee     ON persona_vinculaciones;
DROP POLICY IF EXISTS vinc_escribe ON persona_vinculaciones;
DROP POLICY IF EXISTS vinc_propia  ON persona_vinculaciones;
CREATE POLICY vinc_lee ON persona_vinculaciones FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_planta_personal','ver_personas','ver_postulaciones']));
CREATE POLICY vinc_escribe ON persona_vinculaciones FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_planta_personal'))
  WITH CHECK (public.auth_permiso('gestionar_planta_personal'));
-- Cada empleado ve su propio historial laboral (y nada más).
CREATE POLICY vinc_propia ON persona_vinculaciones FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM personas p
                  WHERE p.id = persona_id AND p.usuario_id = (SELECT auth.uid())));

-- Las vistas heredan la RLS de las tablas base (no son SECURITY DEFINER).
GRANT SELECT ON vw_planta_personal, vw_personal_disponible, vw_personal_recontratable
  TO authenticated, service_role;

-- La política de lectura de `personas` ya existía para el staff; se agrega la
-- del propio colaborador para que el empleado vea su ficha desde su perfil.
DROP POLICY IF EXISTS gh_persona_propia ON personas;
CREATE POLICY gh_persona_propia ON personas FOR SELECT TO authenticated
  USING (usuario_id = (SELECT auth.uid()));

-- =============================================================================
-- 8. PERMISOS Y ROL «EMPLEADO»
-- =============================================================================
-- El rol de los colaboradores de planta. `rol_base` = AUDITOR a propósito:
-- `sync_usuario_rol` copia rol_base a `usuarios.rol`, que es lo que mira el
-- bypass de ADMIN en toda la RLS. Con OPERADOR_SEDE (el rol «Conserje») una
-- cuenta de empleado podría registrar movimientos y alterar el stock; AUDITOR
-- es el mínimo privilegio y los permisos finos se dan por clave.
INSERT INTO roles (nombre, descripcion, rol_base, permisos, activo)
VALUES (
  'Empleado',
  'Colaborador de planta. Ve su propia ficha, su historial laboral y su carnet.',
  'AUDITOR',
  '{}'::jsonb,
  true
)
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      rol_base    = EXCLUDED.rol_base,
      activo      = true;

-- Quien lleva la planta de personal necesita ver y mantener el maestro.
UPDATE public.roles SET permisos = permisos || '{
  "ver_planta_personal": true,
  "gestionar_planta_personal": true
}'::jsonb
WHERE nombre IN ('Coordinador','Supervisor de Conserjería');

-- Auditoría solo consulta.
UPDATE public.roles SET permisos = permisos || '{
  "ver_planta_personal": true
}'::jsonb
WHERE nombre = 'Auditor';

-- Limpieza: `ver_disponibilidad_personal` se sembró en una versión anterior de
-- esta migración y no la exige ninguna pantalla ni política. Un permiso que
-- nadie verifica solo estorba en /roles (lo marca scripts/auditar-permisos.mjs).
UPDATE public.roles SET permisos = permisos - 'ver_disponibilidad_personal'
 WHERE permisos ? 'ver_disponibilidad_personal';
UPDATE public.usuarios SET permisos = permisos - 'ver_disponibilidad_personal'
 WHERE permisos ? 'ver_disponibilidad_personal';
