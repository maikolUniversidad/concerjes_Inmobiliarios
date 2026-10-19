-- =============================================================================
-- PROGRAMACIÓN DE PERSONAL · FASE 1 · catálogo y puente
-- =============================================================================
-- Diseño completo en docs/programacion-personal.md. Esta fase NO programa
-- turnos todavía: deja el mapa de la operación sobre el que la fase 2 arma la
-- malla semanal.
--
-- Lo que trae:
--
--   1. `sedes.centro_costo_id` — el PUENTE que faltaba. Hoy el lado inventario
--      (197 sedes, con grupo de contrato y responsable) y el lado nómina
--      (624 centros de costo, 92 con gente activa) no se tocan: `obra_id`,
--      `cliente_id` y `grupo_id` están vacíos en los 624 centros. La dirección
--      es N sedes → 1 centro de costo, porque `UNAD 2026-BOGOTA` paga varias
--      sedes de la UNAD en Bogotá.
--      `vw_sede_centro_sugerido` propone el cruce; lo confirma una persona.
--
--   2. `puestos` — el nivel nuevo (DECISIÓN 1 del documento, tomada).
--      Un puesto es la COBERTURA QUE EL CLIENTE COMPRÓ («el hall, L-D, 6 a 22,
--      un operario»), no una persona. Hace falta porque TRANSMILENIO 2026 son
--      302 personas activas y en `sedes` son DOS filas: el sitio físico real
--      —la estación, el portal, el patio— no existe en el modelo, y sin él la
--      malla de ese contrato sería una sola fila con 302 nombres.
--
--   3. `turno_patrones` — asciende la lista `TURNO` de `vac_listas_opciones`
--      (que ya usa `requisiciones.turnos[]`) a tabla con horas y días reales.
--      Mismo vocabulario en selección y en programación.
--      Los patrones genéricos (`8HD_LV`, `8HN_LD`…) declaran DURACIÓN y DÍAS,
--      no hora de reloj: esa queda NULL a propósito, porque el catálogo del
--      ATS no la trae y no se inventa aquí.
--
--   4. `programacion_reglas` — los topes, como PARÁMETRO y no como constante.
--      La jornada legal bajó por etapas con la Ley 2101 de 2021 y la ventana
--      del recargo nocturno cambió con la reforma laboral: escribirlas en el
--      código obliga a una migración cada vez. La fila global nace con los
--      valores PROPUESTOS y `confirmado_por_nomina = false`.
--
--   5. `calendario_festivos` + `festivos_colombia(anio)` — los festivos se
--      CALCULAN (Pascua por el algoritmo de Meeus y traslado al lunes de la
--      Ley Emiliani), no se transcriben a mano, para no equivocarse ni tener
--      que volver cada diciembre. Se siembran 2026 y 2027.
--
-- Permisos nuevos (catálogo en lib/permisos.ts, grupo Gestión Humana):
--   ver_programacion             ver la malla
--   gestionar_programacion       armar la malla
--   publicar_programacion        publicar (publicar no es editar)
--   ver_mi_turno                 el colaborador, solo lo suyo
--   reportar_novedad_turno       el responsable de sede: «no llegó»
--   gestionar_novedades_personal Gestión Humana: aprueba con soporte
--   autorizar_dobladas           jefatura
--   parametrizar_programacion    puestos, patrones, topes y festivos
--
-- IDEMPOTENTE: se puede repetir sin efecto.
-- =============================================================================

SET search_path TO public;

-- `btree_gist` permite mezclar `=` sobre uuid con `&&` sobre rangos en un mismo
-- índice de exclusión. Es lo que la FASE 2 necesita para que la base impida
-- físicamente que una persona quede en dos puestos a la misma hora. Se habilita
-- ahora para descubrir de una vez si el proyecto lo permite.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =============================================================================
-- 1. EL PUENTE: sedes ↔ centros de costo
-- =============================================================================
ALTER TABLE sedes ADD COLUMN IF NOT EXISTS centro_costo_id UUID
  REFERENCES centros_costo(id) ON DELETE SET NULL;

COMMENT ON COLUMN sedes.centro_costo_id IS
  'Centro de costos (contrato de nómina) que paga esta sede. N sedes → 1 centro. Se confirma a mano con la ayuda de vw_sede_centro_sugerido.';

CREATE INDEX IF NOT EXISTS idx_sedes_centro_costo ON sedes(centro_costo_id);

-- =============================================================================
-- 2. PATRONES DE TURNO
-- =============================================================================
CREATE TABLE IF NOT EXISTS turno_patrones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mismo valor que `vac_listas_opciones.valor` de la lista 'TURNO', para que
  -- la requisición y la programación hablen el mismo idioma.
  codigo           VARCHAR(40) NOT NULL UNIQUE,
  etiqueta         VARCHAR(120) NOT NULL,
  -- NULL a propósito en los patrones genéricos: '8 HD L-V' dice cuántas horas
  -- y qué días, no a qué hora entra. La hora concreta se fija en el turno.
  hora_inicio      TIME,
  hora_fin         TIME,
  horas            NUMERIC(4,2),
  -- 1 = lunes … 7 = domingo.
  dias             SMALLINT[] NOT NULL DEFAULT '{}',
  es_nocturno      BOOLEAN NOT NULL DEFAULT false,
  orden            INT NOT NULL DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true,
  observacion      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_patron_dias CHECK (dias <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
  CONSTRAINT ck_patron_horas CHECK (horas IS NULL OR (horas > 0 AND horas <= 24)),
  -- O están las dos horas, o ninguna.
  CONSTRAINT ck_patron_horario CHECK ((hora_inicio IS NULL) = (hora_fin IS NULL))
);

-- Un turno que termina a una hora menor o igual que la de inicio cruza la
-- medianoche. Se deja calculado para no repetir la regla en cada consulta: es
-- la trampa que descuadra el conteo de horas de todos los nocturnos.
ALTER TABLE turno_patrones DROP COLUMN IF EXISTS cruza_medianoche;
ALTER TABLE turno_patrones ADD COLUMN cruza_medianoche BOOLEAN
  GENERATED ALWAYS AS (hora_inicio IS NOT NULL AND hora_fin <= hora_inicio) STORED;

DROP TRIGGER IF EXISTS tr_turno_patrones_upd ON turno_patrones;
CREATE TRIGGER tr_turno_patrones_upd BEFORE UPDATE ON turno_patrones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Siembra: los 15 valores de la lista 'TURNO' del ATS, con horas y días.
-- L-V = {1..5}, L-S = {1..6}, L-D = {1..7}.
INSERT INTO turno_patrones (codigo, etiqueta, hora_inicio, hora_fin, horas, dias, es_nocturno, orden, activo, observacion) VALUES
  ('8HD_LV',      '8 HD L-V',                NULL,   NULL,   8,    '{1,2,3,4,5}',     false,  1, true,  'Ocho horas diurnas; la hora de entrada la fija el puesto.'),
  ('8HD_LS',      '8 HD L-S',                NULL,   NULL,   8,    '{1,2,3,4,5,6}',   false,  2, true,  'Ocho horas diurnas; la hora de entrada la fija el puesto.'),
  ('8HD_LD',      '8 HD L-D',                NULL,   NULL,   8,    '{1,2,3,4,5,6,7}', false,  3, true,  'Ocho horas diurnas; la hora de entrada la fija el puesto.'),
  ('4HD_LV',      '4 HD L-V',                NULL,   NULL,   4,    '{1,2,3,4,5}',     false,  4, true,  'Medio tiempo. Son los 12 de «Producción Salario Inferior al Mínimo».'),
  ('4HD_LS',      '4 HD L-S',                NULL,   NULL,   4,    '{1,2,3,4,5,6}',   false,  5, true,  'Medio tiempo.'),
  ('4HD_LD',      '4 HD L-D',                NULL,   NULL,   4,    '{1,2,3,4,5,6,7}', false,  6, true,  'Medio tiempo.'),
  ('8HN_LV',      '8 HN L-V',                NULL,   NULL,   8,    '{1,2,3,4,5}',     true,   7, true,  'Ocho horas nocturnas; la hora de entrada la fija el puesto y casi siempre cruzará la medianoche.'),
  ('8HN_LS',      '8 HN L-S',                NULL,   NULL,   8,    '{1,2,3,4,5,6}',   true,   8, true,  'Ocho horas nocturnas; la hora de entrada la fija el puesto.'),
  ('8HN_LD',      '8 HN L-D',                NULL,   NULL,   8,    '{1,2,3,4,5,6,7}', true,   9, true,  'Ocho horas nocturnas; la hora de entrada la fija el puesto.'),
  ('6AM_2PM_LD',  '6 AM - 2 PM L-D',         '06:00','14:00', 8,   '{1,2,3,4,5,6,7}', false, 10, true,  'Primer bloque de una cobertura de 24 horas.'),
  ('2PM_10PM_LD', '2 PM - 10 PM L-D',        '14:00','22:00', 8,   '{1,2,3,4,5,6,7}', false, 11, true,  'Segundo bloque. Parte cae en la ventana nocturna: el recargo lo decide programacion_reglas, no este campo.'),
  ('10PM_6AM_LD', '10 PM - 6 AM L-D',        '22:00','06:00', 8,   '{1,2,3,4,5,6,7}', true,  12, true,  'Tercer bloque; cruza la medianoche.'),
  ('ROTATIVO_8H', 'Turnos rotativos de 8 H', NULL,   NULL,   8,    '{1,2,3,4,5,6,7}', false, 13, true,  'La rotación la arma la malla semanal, no el patrón.'),
  ('46H_SEMANA',  '46 horas semana',         NULL,   NULL,   NULL, '{1,2,3,4,5,6}',   false, 14, false, 'DESACTIVADO: la jornada legal bajó por etapas con la Ley 2101 de 2021 y 46 horas ya no es el tope. Se conserva porque requisiciones viejas lo referencian; no se ofrece al programar.'),
  ('OTRO',        'Otro',                    NULL,   NULL,   NULL, '{}',              false, 15, true,  'Sin horario fijo: las horas se digitan en el turno.')
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
-- 3. PUESTOS  ·  la cobertura que el cliente compró
-- =============================================================================
CREATE TABLE IF NOT EXISTS puestos (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id                UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  -- Quién paga. Puede quedar nulo mientras la sede no tenga centro asignado;
  -- si está nulo, se hereda el de la sede al programar.
  centro_costo_id        UUID REFERENCES centros_costo(id) ON DELETE SET NULL,
  codigo                 VARCHAR(40) NOT NULL,
  nombre                 VARCHAR(200) NOT NULL,
  cargo_id               UUID REFERENCES cargos(id) ON DELETE SET NULL,
  -- Cuántas personas tienen que estar A LA VEZ en el puesto (no al día).
  personas_simultaneas   SMALLINT NOT NULL DEFAULT 1,
  -- Ventana de cobertura comprada. 1 = lunes … 7 = domingo.
  dias_cobertura         SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hora_desde             TIME,
  hora_hasta             TIME,
  cubre_24h              BOOLEAN NOT NULL DEFAULT false,
  patron_sugerido_id     UUID REFERENCES turno_patrones(id) ON DELETE SET NULL,
  -- Mismos requisitos que ya declara la requisición del ATS.
  requiere_alturas       BOOLEAN NOT NULL DEFAULT false,
  requiere_alimentos     BOOLEAN NOT NULL DEFAULT false,
  requiere_conduccion    BOOLEAN NOT NULL DEFAULT false,
  observacion            TEXT,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_puesto_dias CHECK (dias_cobertura <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
  CONSTRAINT ck_puesto_simultaneas CHECK (personas_simultaneas BETWEEN 1 AND 99),
  -- 24 horas no lleva ventana; si no cubre 24 horas, o están las dos horas o ninguna.
  CONSTRAINT ck_puesto_ventana CHECK (
    (cubre_24h AND hora_desde IS NULL AND hora_hasta IS NULL)
    OR (NOT cubre_24h AND (hora_desde IS NULL) = (hora_hasta IS NULL))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_puestos_sede_codigo ON puestos(sede_id, codigo);
CREATE INDEX IF NOT EXISTS idx_puestos_centro ON puestos(centro_costo_id);
CREATE INDEX IF NOT EXISTS idx_puestos_activo ON puestos(activo) WHERE activo;

COMMENT ON TABLE puestos IS
  'Cobertura comprada por el cliente en una sede. No es una persona: es la obligación de que alguien esté ahí. Varios puestos por sede (TRANSMILENIO: 302 personas en 2 sedes).';

DROP TRIGGER IF EXISTS tr_puestos_upd ON puestos;
CREATE TRIGGER tr_puestos_upd BEFORE UPDATE ON puestos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 4. REGLAS Y TOPES  ·  parámetros, no constantes
-- =============================================================================
CREATE TABLE IF NOT EXISTS programacion_reglas (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = la regla global. Una fila por contrato que necesite otra cosa.
  centro_costo_id           UUID REFERENCES centros_costo(id) ON DELETE CASCADE,
  horas_max_semana          NUMERIC(5,2) NOT NULL DEFAULT 42,
  descanso_min_horas        SMALLINT     NOT NULL DEFAULT 12,
  dobladas_max_semana       SMALLINT     NOT NULL DEFAULT 2,
  dias_descanso_min_semana  SMALLINT     NOT NULL DEFAULT 1,
  nocturno_desde            TIME         NOT NULL DEFAULT '19:00',
  nocturno_hasta            TIME         NOT NULL DEFAULT '06:00',
  permite_prestamo          BOOLEAN      NOT NULL DEFAULT false,
  -- Mientras esté en false, los topes se ADVIERTEN pero no se imponen: son la
  -- propuesta del diseño, no un valor que nómina haya confirmado.
  confirmado_por_nomina     BOOLEAN      NOT NULL DEFAULT false,
  observacion               TEXT,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_reglas_horas    CHECK (horas_max_semana BETWEEN 1 AND 84),
  CONSTRAINT ck_reglas_descanso CHECK (descanso_min_horas BETWEEN 0 AND 24),
  CONSTRAINT ck_reglas_dobladas CHECK (dobladas_max_semana BETWEEN 0 AND 7),
  CONSTRAINT ck_reglas_dias     CHECK (dias_descanso_min_semana BETWEEN 0 AND 7)
);

-- Una sola regla por contrato, y una sola global.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_centro ON programacion_reglas(centro_costo_id)
  WHERE centro_costo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_global ON programacion_reglas((centro_costo_id IS NULL))
  WHERE centro_costo_id IS NULL;

DROP TRIGGER IF EXISTS tr_programacion_reglas_upd ON programacion_reglas;
CREATE TRIGGER tr_programacion_reglas_upd BEFORE UPDATE ON programacion_reglas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- La fila global, con los valores propuestos en el documento. Sin confirmar.
INSERT INTO programacion_reglas (centro_costo_id, observacion)
SELECT NULL, 'Valores PROPUESTOS en docs/programacion-personal.md (decisión 3). '
             'Confirmar con nómina la jornada máxima vigente y la ventana del '
             'recargo nocturno antes de poner confirmado_por_nomina en true.'
WHERE NOT EXISTS (SELECT 1 FROM programacion_reglas WHERE centro_costo_id IS NULL);

-- Devuelve la regla que aplica a un contrato: la suya si la tiene, la global si no.
CREATE OR REPLACE FUNCTION public.programacion_reglas_vigentes(p_centro UUID DEFAULT NULL)
RETURNS programacion_reglas
LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT r.* FROM programacion_reglas r
   WHERE r.centro_costo_id = p_centro OR r.centro_costo_id IS NULL
   ORDER BY (r.centro_costo_id IS NULL)   -- la específica primero
   LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION public.programacion_reglas_vigentes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.programacion_reglas_vigentes(UUID) TO authenticated, service_role;

-- =============================================================================
-- 5. FESTIVOS  ·  calculados, no transcritos
-- =============================================================================
CREATE TABLE IF NOT EXISTS calendario_festivos (
  fecha       DATE PRIMARY KEY,
  nombre      VARCHAR(120) NOT NULL,
  anio        INT GENERATED ALWAYS AS (EXTRACT(YEAR FROM fecha)::INT) STORED,
  -- true cuando la Ley Emiliani lo corrió al lunes siguiente.
  trasladado  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_festivos_anio ON calendario_festivos(anio);

-- Domingo de Pascua por el algoritmo de Meeus/Jones/Butcher (calendario
-- gregoriano). Todas las divisiones son enteras.
CREATE OR REPLACE FUNCTION public.pascua(p_anio INT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  a INT; b INT; c INT; d INT; e INT; f INT; g INT; h INT;
  i INT; k INT; l INT; m INT; mes INT; dia INT;
BEGIN
  a := p_anio % 19;
  b := p_anio / 100;
  c := p_anio % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  RETURN make_date(p_anio, mes, dia);
END $fn$;

-- Ley Emiliani: si la fecha no cae lunes, el festivo se corre al lunes siguiente.
CREATE OR REPLACE FUNCTION public.lunes_siguiente(p_fecha DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $fn$
  SELECT p_fecha + ((8 - EXTRACT(ISODOW FROM p_fecha)::INT) % 7);
$fn$;

-- Los 18 festivos de Colombia para un año, con el traslado ya aplicado.
CREATE OR REPLACE FUNCTION public.festivos_colombia(p_anio INT)
RETURNS TABLE (fecha DATE, nombre VARCHAR, trasladado BOOLEAN)
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  pa DATE := public.pascua(p_anio);
BEGIN
  RETURN QUERY
  -- Fijos: no se trasladan nunca.
  SELECT f.d, f.n::VARCHAR, false FROM (VALUES
    (make_date(p_anio,  1,  1), 'Año Nuevo'),
    (make_date(p_anio,  5,  1), 'Día del Trabajo'),
    (make_date(p_anio,  7, 20), 'Grito de Independencia'),
    (make_date(p_anio,  8,  7), 'Batalla de Boyacá'),
    (make_date(p_anio, 12,  8), 'Inmaculada Concepción'),
    (make_date(p_anio, 12, 25), 'Navidad')
  ) AS f(d, n)
  UNION ALL
  -- Relativos a la Pascua y que tampoco se trasladan.
  SELECT f.d, f.n::VARCHAR, false FROM (VALUES
    (pa - 3, 'Jueves Santo'),
    (pa - 2, 'Viernes Santo')
  ) AS f(d, n)
  UNION ALL
  -- Relativos a la Pascua, ya corridos al lunes por la Ley Emiliani.
  SELECT f.d, f.n::VARCHAR, true FROM (VALUES
    (pa + 43, 'Ascensión del Señor'),
    (pa + 64, 'Corpus Christi'),
    (pa + 71, 'Sagrado Corazón')
  ) AS f(d, n)
  UNION ALL
  -- Trasladables: al lunes siguiente si no caen lunes.
  SELECT public.lunes_siguiente(f.d), f.n::VARCHAR,
         EXTRACT(ISODOW FROM f.d)::INT <> 1
    FROM (VALUES
    (make_date(p_anio,  1,  6), 'Reyes Magos'),
    (make_date(p_anio,  3, 19), 'San José'),
    (make_date(p_anio,  6, 29), 'San Pedro y San Pablo'),
    (make_date(p_anio,  8, 15), 'Asunción de la Virgen'),
    (make_date(p_anio, 10, 12), 'Día de la Raza'),
    (make_date(p_anio, 11,  1), 'Todos los Santos'),
    (make_date(p_anio, 11, 11), 'Independencia de Cartagena')
  ) AS f(d, n);
END $fn$;

COMMENT ON FUNCTION public.festivos_colombia(INT) IS
  'Festivos de Colombia de un año: fijos, relativos a la Pascua y trasladables al lunes (Ley Emiliani). Sirve para cualquier año; no hay que transcribir fechas a mano.';

-- Siembra el año en curso y el siguiente. Repetible.
CREATE OR REPLACE FUNCTION public.sembrar_festivos(p_anio INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INT;
BEGIN
  INSERT INTO calendario_festivos (fecha, nombre, trasladado)
  SELECT f.fecha, f.nombre, f.trasladado FROM public.festivos_colombia(p_anio) f
  ON CONFLICT (fecha) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

SELECT public.sembrar_festivos(EXTRACT(YEAR FROM CURRENT_DATE)::INT);
SELECT public.sembrar_festivos(EXTRACT(YEAR FROM CURRENT_DATE)::INT + 1);

CREATE OR REPLACE FUNCTION public.es_festivo(p_fecha DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM calendario_festivos WHERE fecha = p_fecha);
$fn$;
GRANT EXECUTE ON FUNCTION public.es_festivo(DATE) TO authenticated, service_role;

-- =============================================================================
-- 6. VISTAS
-- =============================================================================

-- Propuesta de cruce sede → centro de costo.
--
-- La ciudad es el filtro (obligatorio) y el nombre es el que ordena: se cuenta
-- qué proporción de las palabras del centro de costos aparece COMO PALABRA en
-- el nombre de la sede. La comparación por subcadena no sirve: el token 'CAR'
-- de 'CAR-BOGOTA' aparece dentro de 'CARTAGENA' y 'CARRERA', y proponía ese
-- centro para media Fiscalía. Tampoco sirve la similitud por trigramas: los
-- aciertos buenos de la UNAD puntuaban 0,28 y un error puntuaba 0,30.
--
-- Medido sobre los datos de hoy: 63 sedes de 194 con cobertura = 1 (todas
-- correctas a revisión), 5 parciales, 101 sin parecido de nombre aunque hay
-- centro con gente en su ciudad, y 25 sin ningún centro con gente en su ciudad.
-- Las 101 son las bibliotecas y los colegios: las paga
-- 'UT RED CULTURAL Y LA SCRD 567-2026-BOGOTA' y ningún texto lo adivina.
-- Por eso esto SUGIERE y no asigna.
DROP VIEW IF EXISTS vw_sede_centro_sugerido;
CREATE VIEW vw_sede_centro_sugerido AS
WITH cc AS (
  SELECT c.id, c.codigo, c.nombre,
         split_part(translate(upper(COALESCE(c.ciudad, '')), 'ÁÉÍÓÚÑ', 'AEIOUN'), ' D.C', 1) AS ciudad_n,
         ARRAY(
           SELECT t FROM unnest(regexp_split_to_array(
             btrim(regexp_replace(
               regexp_replace(translate(upper(c.nombre), 'ÁÉÍÓÚÑ', 'AEIOUN'), '[^A-Z0-9 ]', ' ', 'g'),
               '\s+', ' ', 'g')), ' ')) AS t
            WHERE length(t) >= 4 AND t !~ '^[0-9]+$'
         ) AS palabras,
         (SELECT COUNT(*) FROM personas p
           WHERE p.centro_costo_id = c.id AND p.estado = 'ACTIVO') AS personas_activas
    FROM centros_costo c
   WHERE c.activo
), s AS (
  SELECT se.id, se.nombre, se.ciudad, se.grupo_id, se.centro_costo_id,
         split_part(split_part(translate(upper(COALESCE(se.ciudad, '')), 'ÁÉÍÓÚÑ', 'AEIOUN'), ' - ', 1), ' D.C', 1) AS ciudad_n,
         ' ' || btrim(regexp_replace(
           regexp_replace(translate(upper(se.nombre), 'ÁÉÍÓÚÑ', 'AEIOUN'), '[^A-Z0-9 ]', ' ', 'g'),
           '\s+', ' ', 'g')) || ' ' AS nombre_n
    FROM sedes se
   WHERE se.activo
), pares AS (
  SELECT s.id AS sede_id, cc.id AS centro_costo_id, cc.codigo AS centro_codigo,
         cc.personas_activas,
         (SELECT COUNT(*) FROM unnest(cc.palabras) t WHERE s.nombre_n LIKE '% ' || t || ' %')::NUMERIC
           / cardinality(cc.palabras) AS cobertura
    FROM s
    JOIN cc ON cc.ciudad_n = s.ciudad_n
           AND cc.personas_activas > 0
           AND cardinality(cc.palabras) > 0
)
SELECT
  s.id            AS sede_id,
  s.nombre        AS sede,
  s.ciudad,
  s.grupo_id,
  s.centro_costo_id AS centro_costo_actual,
  mejor.centro_costo_id AS centro_costo_sugerido,
  mejor.centro_codigo,
  mejor.personas_activas,
  ROUND(mejor.cobertura, 2) AS cobertura,
  CASE
    WHEN mejor.cobertura IS NULL  THEN 'SIN_CANDIDATO'
    WHEN mejor.cobertura >= 1     THEN 'ALTA'
    WHEN mejor.cobertura >= 0.5   THEN 'MEDIA'
    ELSE 'BAJA'
  END AS confianza
FROM s
LEFT JOIN LATERAL (
  SELECT p.centro_costo_id, p.centro_codigo, p.personas_activas, p.cobertura
    FROM pares p
   WHERE p.sede_id = s.id AND p.cobertura > 0
   -- Más palabras coincidentes gana; si empatan, el contrato con más gente
   -- (así 'OFICINAS TRANSMILENIO' cae en TRANSMILENIO 2026 y no en el 2024).
   ORDER BY p.cobertura DESC, p.personas_activas DESC
   LIMIT 1
) AS mejor ON true;

COMMENT ON VIEW vw_sede_centro_sugerido IS
  'Propuesta de sedes.centro_costo_id: ciudad obligatoria + proporción de palabras del centro presentes en el nombre de la sede. SUGIERE, no asigna.';

-- Los puestos con todo su contexto, para la pantalla de parametrización.
DROP VIEW IF EXISTS vw_puestos;
CREATE VIEW vw_puestos AS
SELECT
  pu.id, pu.codigo, pu.nombre, pu.activo,
  pu.personas_simultaneas, pu.dias_cobertura, pu.hora_desde, pu.hora_hasta, pu.cubre_24h,
  pu.requiere_alturas, pu.requiere_alimentos, pu.requiere_conduccion, pu.observacion,
  s.id        AS sede_id,
  s.nombre    AS sede,
  s.ciudad,
  g.codigo    AS grupo_contrato,
  -- El centro del puesto si lo tiene; si no, el de la sede.
  COALESCE(pu.centro_costo_id, s.centro_costo_id) AS centro_costo_id,
  cc.codigo   AS centro_costo,
  cc.es_disponibilidad,
  ca.nombre   AS cargo,
  tp.codigo   AS patron_sugerido,
  tp.etiqueta AS patron_etiqueta,
  tp.horas    AS patron_horas,
  -- Cuántos turnos por semana exige este puesto: días de cobertura × personas.
  (cardinality(pu.dias_cobertura) * pu.personas_simultaneas) AS turnos_semana
FROM puestos pu
JOIN sedes s             ON s.id = pu.sede_id
LEFT JOIN grupos_contrato g ON g.id = s.grupo_id
LEFT JOIN centros_costo cc  ON cc.id = COALESCE(pu.centro_costo_id, s.centro_costo_id)
LEFT JOIN cargos ca         ON ca.id = pu.cargo_id
LEFT JOIN turno_patrones tp ON tp.id = pu.patron_sugerido_id;

-- Qué falta para poder programar. Es la lista de pendientes de la fase 1.
DROP VIEW IF EXISTS vw_programacion_pendientes;
CREATE VIEW vw_programacion_pendientes AS
SELECT 'SEDE_SIN_CENTRO_COSTO' AS motivo, s.id AS entidad_id, s.nombre AS detalle,
       'La sede no sabe qué contrato la paga' AS explicacion
  FROM sedes s WHERE s.activo AND s.centro_costo_id IS NULL
UNION ALL
SELECT 'SEDE_SIN_PUESTOS', s.id, s.nombre,
       'La sede no tiene ningún puesto: no hay qué programar'
  FROM sedes s
 WHERE s.activo AND NOT EXISTS (SELECT 1 FROM puestos p WHERE p.sede_id = s.id AND p.activo)
UNION ALL
SELECT 'SEDE_SIN_RESPONSABLE', s.id, s.nombre,
       'Nadie en la sede puede reportar que alguien no llegó'
  FROM sedes s WHERE s.activo AND s.responsable_id IS NULL
UNION ALL
SELECT 'CENTRO_CON_GENTE_SIN_SEDE', cc.id, cc.codigo,
       'El contrato tiene personal activo pero ninguna sede apunta a él'
  FROM centros_costo cc
 WHERE cc.activo AND NOT cc.es_disponibilidad
   AND EXISTS (SELECT 1 FROM personas p WHERE p.centro_costo_id = cc.id AND p.estado = 'ACTIVO')
   AND NOT EXISTS (SELECT 1 FROM sedes s WHERE s.centro_costo_id = cc.id AND s.activo)
UNION ALL
SELECT 'REGLAS_SIN_CONFIRMAR', r.id, 'Regla global',
       'Los topes de horas y la ventana nocturna siguen sin confirmar con nómina'
  FROM programacion_reglas r WHERE r.centro_costo_id IS NULL AND NOT r.confirmado_por_nomina;

-- =============================================================================
-- 7. RLS
-- =============================================================================
ALTER TABLE puestos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE turno_patrones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE programacion_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendario_festivos ENABLE ROW LEVEL SECURITY;

-- Puestos: los ve quien programa o quien ve la planta; los edita quien parametriza.
DROP POLICY IF EXISTS puestos_lee     ON puestos;
DROP POLICY IF EXISTS puestos_escribe ON puestos;
CREATE POLICY puestos_lee ON puestos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY[
    'ver_programacion','gestionar_programacion','parametrizar_programacion','ver_planta_personal']));
CREATE POLICY puestos_escribe ON puestos FOR ALL TO authenticated
  USING (public.auth_permiso('parametrizar_programacion'))
  WITH CHECK (public.auth_permiso('parametrizar_programacion'));

-- Patrones: catálogo. Lo lee cualquiera que programe o que cree requisiciones.
DROP POLICY IF EXISTS patrones_lee     ON turno_patrones;
DROP POLICY IF EXISTS patrones_escribe ON turno_patrones;
CREATE POLICY patrones_lee ON turno_patrones FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY[
    'ver_programacion','gestionar_programacion','parametrizar_programacion',
    'ver_requisiciones','gestionar_requisiciones']));
CREATE POLICY patrones_escribe ON turno_patrones FOR ALL TO authenticated
  USING (public.auth_permiso('parametrizar_programacion'))
  WITH CHECK (public.auth_permiso('parametrizar_programacion'));

-- Reglas: las lee quien programa (necesita ver contra qué valida).
DROP POLICY IF EXISTS reglas_lee     ON programacion_reglas;
DROP POLICY IF EXISTS reglas_escribe ON programacion_reglas;
CREATE POLICY reglas_lee ON programacion_reglas FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY[
    'ver_programacion','gestionar_programacion','parametrizar_programacion']));
CREATE POLICY reglas_escribe ON programacion_reglas FOR ALL TO authenticated
  USING (public.auth_permiso('parametrizar_programacion'))
  WITH CHECK (public.auth_permiso('parametrizar_programacion'));

-- Festivos: son públicos (es el calendario de Colombia). Escribirlos, no.
DROP POLICY IF EXISTS festivos_lee     ON calendario_festivos;
DROP POLICY IF EXISTS festivos_escribe ON calendario_festivos;
CREATE POLICY festivos_lee ON calendario_festivos FOR SELECT TO authenticated
  USING (true);
CREATE POLICY festivos_escribe ON calendario_festivos FOR ALL TO authenticated
  USING (public.auth_permiso('parametrizar_programacion'))
  WITH CHECK (public.auth_permiso('parametrizar_programacion'));

-- Las vistas heredan la RLS de sus tablas base (no son SECURITY DEFINER).
GRANT SELECT ON vw_puestos, vw_sede_centro_sugerido, vw_programacion_pendientes
  TO authenticated, service_role;

-- =============================================================================
-- 8. PERMISOS EN LOS ROLES
-- =============================================================================
-- El catálogo vive en lib/permisos.ts y /roles es la única fuente de verdad;
-- esto solo prende lo evidente para que el módulo sea usable de entrada.
-- Administrador, Gerencia y Super Administrador no se tocan: auth_permiso()
-- los deja pasar por rol_base.

-- Coordinación operativa arma la malla y parametriza.
UPDATE public.roles SET permisos = permisos || jsonb_build_object(
    'ver_programacion', true,
    'gestionar_programacion', true,
    'parametrizar_programacion', true,
    'reportar_novedad_turno', true)
 WHERE nombre IN ('Coordinador', 'Supervisor de Conserjería');

-- El responsable en sitio solo reporta la novedad y ve su turno.
UPDATE public.roles SET permisos = permisos || jsonb_build_object(
    'ver_mi_turno', true,
    'reportar_novedad_turno', true)
 WHERE nombre IN ('Conserje', 'Operador de Sede');

-- Las 853 cuentas de nómina: solo lo propio.
UPDATE public.roles SET permisos = permisos || jsonb_build_object('ver_mi_turno', true)
 WHERE nombre = 'Empleado';

-- Auditoría mira y no toca.
UPDATE public.roles SET permisos = permisos || jsonb_build_object('ver_programacion', true)
 WHERE nombre = 'Auditor';
