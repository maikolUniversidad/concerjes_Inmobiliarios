-- =============================================================================
-- ATS · PROCESO COMPLETO DE SELECCIÓN Y CONTRATACIÓN
-- =============================================================================
-- Cierra la brecha entre lo que tenía la plataforma (registro público + bandeja
-- básica) y el proceso real de la empresa, levantado el 2026-09-22 desde el
-- ATS anterior (conserjesats.com), la minuta de contrato, el formato de
-- entrevista, la carta de conocimiento de funciones, la requisición de
-- personal, el exporte de nómina (WO) y un expediente físico completo de 40
-- folios que muestra todo lo que se firma y se escanea al contratar.
--
-- Lo que agrega, en orden:
--   1. Catálogos: cargos unificados con nómina (+ funciones por cargo para la
--      carta de conocimiento), listas parametrizables, IPS de exámenes,
--      códigos de nómina en EPS/AFP/caja/ARL/banco y equivalencias ciudad→WO.
--   2. Candidato: nombres en 4 partes (como los pide nómina y todos los
--      formatos), cursos (alturas/alimentos/grecas), fase con fecha, motivo de
--      descarte, centro de costos, remisión a IPS y antecedentes.
--   3. Bitácora de cambios (quién movió a quién, cuándo, de qué fase a cuál),
--      observaciones y evaluaciones (entrevista, psicológica, seguridad AAA).
--   4. Requisiciones de personal (el formato C_1.1 V3 hecho tabla).
--   5. Pruebas de selección parametrizables (aptitud A/B y conocimientos con
--      temporizador, clave en el servidor, firma y verificación de cédula).
--   6. Plantillas de documentos VERSIONADAS y documentos generados con los
--      datos del candidato: la persona solo firma (en pantalla o en papel).
--   7. Contrato de trabajo completo (cabecera de la minuta + campos de WO) y
--      puente hacia la planta de personal al contratar.
--
-- IDEMPOTENTE. Requiere 20260922000000_ats_estados_enum.sql aplicada antes.
-- =============================================================================

SET search_path TO public;

-- =============================================================================
-- 1. CATÁLOGOS
-- =============================================================================

-- 1.1 Cargos ------------------------------------------------------------------
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS tipo                     TEXT NOT NULL DEFAULT 'OPERATIVO'; -- OPERATIVO | ADMINISTRATIVO
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS area                     TEXT;
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS postulable               BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS requiere_curso_grecas    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS requiere_examen_conduccion BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS funciones_generales      TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS funciones_especificas    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS funciones_operativas     TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS nombre_femenino          TEXT;   -- 'OPERARIA DE ASEO Y CAFETERÍA' para la carta

-- El ATS sembró cargos con nombres distintos a los de nómina. Nómina manda:
-- se repuntan todas las llaves foráneas y se borra el duplicado.
DO $merge$
DECLARE
  par  TEXT[];
  pares TEXT[][] := ARRAY[
    ['OPERARIO DE ASEO',             'OPERARIO ASEO'],
    ['OPERARIO DE ASEO Y CAFETERÍA', 'OPERARIO ASEO Y CAFETERIA'],
    ['OPERARIO DE MANTENIMIENTO',    'OPERARIO MANTENIMIENTO'],
    ['TODERO / MANTENIMIENTO',       'TODERO'],
    ['SUPERVISOR DE ASEO',           'SUPERVISOR'],
    ['JARDINERO',                    'OPERARIO JARDINERO']
  ];
  v_de UUID; v_a UUID; fk RECORD; i INT;
BEGIN
  FOR i IN 1..array_length(pares, 1) LOOP
    par := pares[i:i][1:2];
    SELECT id INTO v_de FROM cargos WHERE nombre = pares[i][1];
    SELECT id INTO v_a  FROM cargos WHERE nombre = pares[i][2];
    CONTINUE WHEN v_de IS NULL OR v_a IS NULL OR v_de = v_a;
    FOR fk IN
      SELECT c.conrelid::regclass AS tabla, a.attname AS columna
        FROM pg_constraint c
        JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f' AND c.confrelid = 'cargos'::regclass
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tabla, fk.columna, fk.columna) USING v_a, v_de;
    END LOOP;
    -- Conserva las banderas del duplicado si el canónico no las tenía.
    UPDATE cargos a SET
      requiere_manipulacion_alimentos = a.requiere_manipulacion_alimentos OR d.requiere_manipulacion_alimentos,
      requiere_trabajo_alturas        = a.requiere_trabajo_alturas OR d.requiere_trabajo_alturas
    FROM cargos d WHERE a.id = v_a AND d.id = v_de;
    DELETE FROM cargos WHERE id = v_de;
  END LOOP;
END $merge$;

-- Cargos del select público del ATS anterior que no existían aún.
INSERT INTO cargos (nombre, tipo) VALUES
  ('ASISTENTE ADMINISTRATIVO', 'ADMINISTRATIVO'),
  ('ASISTENTE FACTURACION',    'ADMINISTRATIVO'),
  ('ASISTENTE HSEQ',           'ADMINISTRATIVO'),
  ('ASISTENTE NOVEDADES',      'ADMINISTRATIVO'),
  ('ASISTENTE OPERACIONES',    'ADMINISTRATIVO'),
  ('ASISTENTE RH',             'ADMINISTRATIVO'),
  ('AUXILIAR PRODUCCION',      'OPERATIVO'),
  ('CONDUCTOR INSUMOS',        'OPERATIVO'),
  ('COORDINADOR AS',           'OPERATIVO'),
  ('EMPLEADA GM',              'OPERATIVO'),
  ('EMPLEADA MC',              'OPERATIVO'),
  ('OPERARIO ASEO AS',         'OPERATIVO'),
  ('OPERARIO ASEO/ RELV INC',  'OPERATIVO'),
  ('OPERARIO MANTENIMIENTO AS','OPERATIVO'),
  ('OPERARIO MANTENIMIENTO-ALTURAS', 'OPERATIVO'),
  ('PSICOLOGA CAPACITACION',   'ADMINISTRATIVO'),
  ('SUPERVISOR - RUTA',        'OPERATIVO'),
  ('SUPERVISORA',              'OPERATIVO'),
  ('TODERO EDIFICIOS',         'OPERATIVO')
ON CONFLICT (nombre) DO NOTHING;

UPDATE cargos SET tipo = 'ADMINISTRATIVO'
 WHERE nombre ~ '^(ANALISTA|DIRECTOR|GERENTE|SECRETARIA|PROFESIONAL|AUXILIAR ADMINISTRATIVO|ASISTENTE|PSICOLOGA|COORDINANDO|CONTROL|CONTADOR|LIDER|JEFE)'
   AND tipo <> 'ADMINISTRATIVO';
-- Los cargos de dirección no se ofrecen en el formulario público.
UPDATE cargos SET postulable = false
 WHERE nombre IN ('GERENTE','GERENTE TALENTO HUMANO','DIRECTOR GESTION','DIRECTOR JURIDICO','DIRECTOR TESORERIA','COORDINANDO IN HOUSE');

-- Banderas que condicionan documentos y cursos (según la requisición y el
-- expediente de ejemplo: alimentos y grecas para cafetería, alturas para
-- mantenimiento/alturas, examen psicosensométrico para quien conduce).
UPDATE cargos SET requiere_manipulacion_alimentos = true, requiere_curso_grecas = true
 WHERE nombre IN ('OPERARIO ASEO Y CAFETERIA','AUXILIAR DE CAFETERÍA','EMPLEADA GM','EMPLEADA MC');
UPDATE cargos SET requiere_trabajo_alturas = true
 WHERE nombre IN ('OPERARIO ALTURAS','OPERARIO MANTENIMIENTO','OPERARIO MANTENIMIENTO AS','OPERARIO MANTENIMIENTO-ALTURAS','TODERO','TODERO EDIFICIOS');
UPDATE cargos SET requiere_examen_conduccion = true
 WHERE nombre IN ('CONDUCTOR','CONDUCTOR INSUMOS','INSPECTOR ASEO MOTORIZADO','SUPERVISOR - RUTA');

-- Funciones por cargo (tal como están en la carta de conocimiento de funciones).
UPDATE cargos SET
  nombre_femenino = 'OPERARIA DE ASEO Y CAFETERÍA',
  funciones_generales = ARRAY[
    'Mantener en óptimas condiciones de limpieza, orden e higiene las instalaciones y prestar el servicio de cafetería de acuerdo con los procedimientos establecidos por la empresa.',
    'Garantizar un ambiente limpio, seguro y agradable para colaboradores y visitantes.',
    'Cumplir con las políticas, normas de seguridad, normas viales y lineamientos ambientales establecidos por la empresa.'],
  funciones_especificas = ARRAY[
    'Realizar la limpieza y desinfección de las áreas asignadas.',
    'Preparar y servir bebidas y refrigerios cuando se requiera.',
    'Mantener limpia y organizada la cafetería y sus utensilios.',
    'Reponer los insumos de aseo, cafetería y baños.',
    'Disponer adecuadamente los residuos.',
    'Reportar daños o novedades en las instalaciones.',
    'Cumplir las políticas, normas de seguridad, viales y ambientales de la empresa.'],
  funciones_operativas = ARRAY[
    'Barrer, trapear, limpiar y desinfectar las áreas asignadas.',
    'Preparar café, aromáticas y demás bebidas autorizadas.',
    'Lavar y organizar la loza, utensilios y equipos de cafetería.',
    'Vaciar canecas y cambiar bolsas de residuos.',
    'Utilizar correctamente los elementos de protección personal (EPP).',
    'Mantener ordenados los implementos de aseo y cafetería.',
    'Aplicar las normas de higiene, seguridad y manejo adecuado de los insumos durante la ejecución de sus labores.']
WHERE nombre = 'OPERARIO ASEO Y CAFETERIA' AND cardinality(funciones_generales) = 0;

UPDATE cargos SET
  nombre_femenino = 'OPERARIA DE ALTURAS',
  funciones_generales = ARRAY[
    'Ejecutar trabajos en alturas de forma segura, cumpliendo los procedimientos establecidos por la empresa.',
    'Utilizar correctamente los equipos de protección contra caídas y demás elementos de protección personal (EPP).',
    'Cumplir con las políticas, normas de seguridad, normas viales y lineamientos ambientales establecidos por la empresa.'],
  funciones_especificas = ARRAY[
    'Ejecutar labores de trabajo en alturas de acuerdo con la programación.',
    'Inspeccionar los equipos y elementos de protección antes de su uso.',
    'Reportar condiciones inseguras, incidentes o daños en equipos.',
    'Mantener el orden y aseo del área de trabajo.',
    'Cumplir con los procedimientos de trabajo seguro en alturas.',
    'Acatar las instrucciones del supervisor y las normas de seguridad.'],
  funciones_operativas = ARRAY[
    'Instalar y utilizar correctamente los sistemas de protección contra caídas.',
    'Verificar el estado de arneses, eslingas, líneas de vida y demás equipos.',
    'Delimitar y señalizar el área de trabajo.',
    'Ejecutar las actividades asignadas siguiendo los procedimientos establecidos.',
    'Usar correctamente los elementos de protección personal (EPP).',
    'Cumplir con las políticas, normas de seguridad, normas viales y lineamientos ambientales durante la ejecución de sus labores.']
WHERE nombre = 'OPERARIO ALTURAS' AND cardinality(funciones_generales) = 0;

UPDATE cargos SET
  funciones_generales = ARRAY[
    'Supervisar y garantizar la prestación del servicio.',
    'Cumplir con las consignas y protocolos del puesto de trabajo.',
    'Controlar el acceso de personas, vehículos y elementos.',
    'Reportar novedades e incidentes de manera oportuna.',
    'Mantener una conducta profesional, disciplinada y respetuosa.',
    'Dar uso adecuado a los equipos y elementos asignados.'],
  funciones_especificas = ARRAY[
    'Realizar visitas de supervisión a los puestos.',
    'Registrar eventos y novedades en tiempo real.',
    'Verificar señales de alerta y activar protocolos.',
    'Coordinar con el personal operativo ante incidentes.',
    'Diligenciar bitácoras y reportes del servicio.'],
  funciones_operativas = ARRAY[
    'Cumplir protocolos operativos y de supervisión.',
    'Aplicar medidas de prevención y control de riesgos.',
    'Atender y reaccionar ante emergencias conforme a los procedimientos establecidos.',
    'Reportar condiciones y actos inseguros.',
    'Participar en capacitaciones y simulacros programados.',
    'Cumplir con las normas de tránsito, seguridad vial y disposiciones ambientales aplicables al servicio.']
WHERE nombre = 'SUPERVISOR' AND cardinality(funciones_generales) = 0;

-- 1.2 Listas parametrizables (motivos de descarte, turnos, políticas…) --------
CREATE TABLE IF NOT EXISTS vac_listas_opciones (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista    TEXT NOT NULL,
  valor    TEXT NOT NULL,
  etiqueta TEXT NOT NULL,
  orden    INT  NOT NULL DEFAULT 0,
  activo   BOOLEAN NOT NULL DEFAULT true,
  datos    JSONB,
  UNIQUE (lista, valor)
);

INSERT INTO vac_listas_opciones (lista, valor, etiqueta, orden) VALUES
  ('MOTIVO_DESCARTE','PRUEBA_PSICOLOGIA','Prueba Psicología',1),
  ('MOTIVO_DESCARTE','SEGURIDAD_AAA','Seguridad AAA',2),
  ('MOTIVO_DESCARTE','CONSULTA_RNMC','Consulta básica (RNMC)',3),
  ('MOTIVO_DESCARTE','EXAMENES_MEDICOS','Exámenes médicos',4),
  ('MOTIVO_DESCARTE','DESISTIMIENTO','Desistimiento',5),
  ('MOTIVO_DESCARTE','ACREDITADO','Acreditado',6),
  ('MOTIVO_DESCARTE','DOCUMENTACION','Documentación',7),
  ('MOTIVO_DESCARTE','TOXICOLOGIA','Toxicología',8),
  ('MOTIVO_DESCARTE','ENTREVISTA','Entrevista',9),
  ('POLITICA_ORGANIZACIONAL','INTEGRAL','Política Integral',1),
  ('POLITICA_ORGANIZACIONAL','PROTECCION_DATOS','Política de Protección de Datos',2),
  ('POLITICA_ORGANIZACIONAL','BUEN_TRATO','Política de Buen Trato',3),
  ('POLITICA_ORGANIZACIONAL','ACOSO_SEXUAL','Política de Prevención del Acoso Sexual',4),
  ('POLITICA_ORGANIZACIONAL','DESCONEXION','Política de Desconexión Laboral',5),
  ('POLITICA_ORGANIZACIONAL','ALCOHOL_DROGAS','Política de Prevención de Consumo de Alcohol, Drogas y Cigarrillos',6),
  ('POLITICA_ORGANIZACIONAL','SEGURIDAD_VIAL','Política de Seguridad Vial',7),
  ('POLITICA_ORGANIZACIONAL','HIGIENE_SEGURIDAD','Reglamento de Higiene y Seguridad',8),
  ('POLITICA_ORGANIZACIONAL','SGI','Manual Sistema de Gestión Integrado',9),
  ('POLITICA_ORGANIZACIONAL','RSE','Valor Compartido / Responsabilidad Social Empresarial',10),
  ('TURNO','8HD_LV','8 HD L-V',1),('TURNO','8HD_LS','8 HD L-S',2),('TURNO','8HD_LD','8 HD L-D',3),
  ('TURNO','4HD_LV','4 HD L-V',4),('TURNO','4HD_LS','4 HD L-S',5),('TURNO','4HD_LD','4 HD L-D',6),
  ('TURNO','8HN_LV','8 HN L-V',7),('TURNO','8HN_LS','8 HN L-S',8),('TURNO','8HN_LD','8 HN L-D',9),
  ('TURNO','6AM_2PM_LD','6 AM - 2 PM L-D',10),('TURNO','2PM_10PM_LD','2 PM - 10 PM L-D',11),
  ('TURNO','10PM_6AM_LD','10 PM - 6 AM L-D',12),('TURNO','ROTATIVO_8H','Turnos rotativos de 8 H',13),
  ('TURNO','46H_SEMANA','46 horas semana',14),('TURNO','OTRO','Otro',15),
  ('MOTIVO_REQUISICION','CREACION_CARGO','Creación de cargo',1),
  ('MOTIVO_REQUISICION','EMPALME','Empalme',2),
  ('MOTIVO_REQUISICION','REEMPLAZO','Reemplazo',3),
  ('MOTIVO_REQUISICION','RENUNCIA','Renuncia',4),
  ('MODALIDAD_CONTRATO','OBRA_LABOR','Por la duración de una obra o labor determinada',1),
  ('MODALIDAD_CONTRATO','TERMINO_FIJO','A término fijo',2),
  ('MODALIDAD_CONTRATO','INDEFINIDO','A término indefinido',3),
  ('NIVEL_ACADEMICO','SIN_ESTUDIO','Sin estudio',1),('NIVEL_ACADEMICO','PRIMARIA','Primaria',2),
  ('NIVEL_ACADEMICO','BACHILLERATO_BASICO','Bachillerato básico',3),('NIVEL_ACADEMICO','BACHILLER','Bachiller',4),
  ('NIVEL_ACADEMICO','TECNICO','Técnico',5),('NIVEL_ACADEMICO','TECNOLOGO','Tecnólogo',6),
  ('NIVEL_ACADEMICO','PROFESIONAL','Profesional',7),
  ('NIVEL_RIESGO','BAJO','Riesgo bajo',1),('NIVEL_RIESGO','MEDIO','Riesgo medio',2),('NIVEL_RIESGO','ALTO','Riesgo alto',3),
  ('RESULTADO_EVALUACION','APROBADO','Aprobado',1),('RESULTADO_EVALUACION','NO_APROBADO','No aprobado',2),
  ('RESULTADO_EVALUACION','PENDIENTE','Pendiente',3)
ON CONFLICT (lista, valor) DO NOTHING;

-- 1.3 IPS para exámenes médicos ----------------------------------------------
CREATE TABLE IF NOT EXISTS ips (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre   TEXT NOT NULL UNIQUE,
  correo   TEXT,
  telefono TEXT,
  direccion TEXT,
  ciudad   TEXT,
  activo   BOOLEAN NOT NULL DEFAULT true,
  orden    INT NOT NULL DEFAULT 0
);
INSERT INTO ips (nombre, orden) VALUES
  ('COMERBAS',1),('UNISER',2),('TOSCANA',3),('HUMANOS',4),('CARIS',5)
ON CONFLICT (nombre) DO NOTHING;
UPDATE ips SET correo = COALESCE(correo, 'direccion.ips@comerbas.com'), direccion = COALESCE(direccion, 'Avenida Carrera 30 # 67-59'),
               telefono = COALESCE(telefono, '3148223014'), ciudad = COALESCE(ciudad, 'BOGOTÁ D.C.')
 WHERE nombre = 'COMERBAS';

-- 1.4 Códigos con los que nómina (WO) conoce a cada entidad -------------------
ALTER TABLE eps                ADD COLUMN IF NOT EXISTS codigo_nomina TEXT;
ALTER TABLE afp                ADD COLUMN IF NOT EXISTS codigo_nomina TEXT;
ALTER TABLE cesantias          ADD COLUMN IF NOT EXISTS codigo_nomina TEXT;
ALTER TABLE cajas_compensacion ADD COLUMN IF NOT EXISTS codigo_nomina TEXT;
ALTER TABLE arl                ADD COLUMN IF NOT EXISTS codigo_nomina TEXT;
ALTER TABLE bancos             ADD COLUMN IF NOT EXISTS codigo_nomina TEXT;

UPDATE eps SET codigo_nomina = v.c FROM (VALUES
  ('SALUD TOTAL EPS','SALUD TOTAL'),('EPS SURA','SURA EPS'),('EPS SANITAS','E.P.S. SANITAS S.A.'),
  ('NUEVA EPS','NUEVA E.P.S. S.A.'),('FAMISANAR EPS','E.P.S. FAMISANAR LTDA.'),('COMPENSAR EPS','ESS EPS COMPENSAR')
) AS v(n, c) WHERE eps.nombre = v.n AND eps.codigo_nomina IS NULL;
UPDATE afp SET codigo_nomina = v.c FROM (VALUES
  ('PORVENIR','PORVENIR'),('COLPENSIONES','COLPENSIONES AFPC'),('COLFONDOS','COLFONDOS AFPC'),
  ('PROTECCIÓN','PROTECCION'),('SKANDIA','SKANDIA - OLD MUTUAL')
) AS v(n, c) WHERE afp.nombre = v.n AND afp.codigo_nomina IS NULL;
UPDATE cesantias SET codigo_nomina = v.c FROM (VALUES
  ('PORVENIR','PORVENIR S.A. AFPC'),('PROTECCIÓN','PROTECCION S.A. AFPC'),('COLFONDOS','COLFONDOS AFPC'),
  ('FNA - FONDO NACIONAL DEL AHORRO','FONDO NACIONAL DEL AHORRO')
) AS v(n, c) WHERE cesantias.nombre = v.n AND cesantias.codigo_nomina IS NULL;
UPDATE cajas_compensacion SET codigo_nomina = 'CCF ' || nombre WHERE codigo_nomina IS NULL;
UPDATE arl SET codigo_nomina = v.c FROM (VALUES
  ('AXA COLPATRIA ARL','ARL SEGUROS DE VIDA COLPATRIA'),('ARL SURA','ARL SURA'),('POSITIVA COMPAÑÍA DE SEGUROS','POSITIVA')
) AS v(n, c) WHERE arl.nombre = v.n AND arl.codigo_nomina IS NULL;
UPDATE bancos SET codigo_nomina = nombre WHERE codigo_nomina IS NULL;

-- EPS del catálogo anterior que faltaban (solo las que siguen operando).
INSERT INTO eps (nombre) VALUES
  ('ANAS WAYUU EPSI'),('ASOCIACION INDIGENA DEL CAUCA AIC EPSI'),('CAPRESOCA EPS'),
  ('COMFACHOCO EPS'),('COMFAMILIAR HUILA EPS'),('MALLAMAS EPSI'),('SALUD BOLIVAR EPS')
ON CONFLICT (nombre) DO NOTHING;

-- Equivalencias ciudad de trabajo → códigos de nómina (Depto WO, Caja, ARL).
-- Es lo que el ATS anterior mostraba como "Resumen de códigos para nómina".
CREATE TABLE IF NOT EXISTS municipios_nomina (
  municipio_codigo TEXT PRIMARY KEY REFERENCES municipios(codigo_dane) ON DELETE CASCADE,
  ciudad_wo   TEXT NOT NULL,
  depto_wo    TEXT NOT NULL,
  ciudad_arl  TEXT,
  depto_arl   TEXT,
  ccf_id      UUID REFERENCES cajas_compensacion(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO municipios_nomina (municipio_codigo, ciudad_wo, depto_wo, ciudad_arl, depto_arl, ccf_id)
SELECT '11001', 'BOGOTA', 'BOGOTA D.E.', 'BOGOTA', 'BOGOTA D.C.', (SELECT id FROM cajas_compensacion WHERE nombre = 'COMPENSAR' LIMIT 1)
ON CONFLICT (municipio_codigo) DO NOTHING;
INSERT INTO municipios_nomina (municipio_codigo, ciudad_wo, depto_wo, ciudad_arl, depto_arl, ccf_id)
SELECT m.codigo_dane, m.nombre, d.nombre, m.nombre, d.nombre,
       (SELECT c.id FROM cajas_compensacion c WHERE c.departamento_codigo = d.codigo_dane ORDER BY c.nombre LIMIT 1)
  FROM municipios m JOIN departamentos d ON d.codigo_dane = m.departamento_codigo
ON CONFLICT (municipio_codigo) DO NOTHING;

-- 1.5 Parámetros del empleador (una sola fila; alimenta todos los documentos) --
CREATE TABLE IF NOT EXISTS vac_empresa (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  razon_social       TEXT NOT NULL,
  nit                TEXT NOT NULL,
  direccion          TEXT NOT NULL,
  ciudad             TEXT NOT NULL DEFAULT 'BOGOTÁ D.C.',
  telefono           TEXT,
  sitio_web          TEXT,
  correo_seleccion   TEXT,
  correo_datos       TEXT,
  representante_legal TEXT,
  representante_documento TEXT,
  firma_empleador_data_url TEXT,     -- firma del representante para estampar (opcional)
  telefono_nomina    TEXT,
  contacto_nomina    TEXT,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
-- contacto_nomina (nombre de la persona de nómina) se diligencia directamente en
-- la base: el repositorio es público y no guarda nombres de personas.
INSERT INTO vac_empresa (id, razon_social, nit, direccion, ciudad, telefono, sitio_web, correo_seleccion, correo_datos, telefono_nomina, contacto_nomina)
VALUES (1, 'CONSERJES INMOBILIARIOS LTDA', '800.093.388-2', 'Carrera 19 No. 166 - 34', 'BOGOTÁ D.C.',
        '+57 1 674 1400', 'www.conserjesinmobiliarios.com', 'seleccion@conserjesinmobiliarios.com',
        'vigicoladmon@hotmail.com', '6741400 ext. 304', NULL)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. CANDIDATO
-- =============================================================================
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS primer_nombre    TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS segundo_nombre   TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS primer_apellido  TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS segundo_apellido TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS estatura_cm      INT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS curso_alturas    BOOLEAN;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS curso_alturas_vigencia DATE;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS curso_alimentos  BOOLEAN;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS curso_alimentos_vigencia DATE;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS curso_grecas     BOOLEAN;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS fase_desde       TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS motivo_descarte  TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS descarte_detalle TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS descartado_at    TIMESTAMPTZ;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS descartado_por   UUID;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS centro_costo_id  UUID REFERENCES centros_costo(id) ON DELETE SET NULL;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS ips_id           UUID REFERENCES ips(id) ON DELETE SET NULL;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS ips_nombre       TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS ips_correo       TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS ips_fecha_remision TIMESTAMPTZ;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS ips_remitido_por UUID;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS antecedentes_resultado TEXT;   -- PENDIENTE | SIN_NOVEDAD | CON_NOVEDAD
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS antecedentes_mensaje   TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS antecedentes_fecha     TIMESTAMPTZ;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS antecedentes_por       UUID;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS observaciones_rrhh     TEXT;

CREATE INDEX IF NOT EXISTS idx_candidatos_centro_costo ON candidatos(centro_costo_id);
CREATE INDEX IF NOT EXISTS idx_candidatos_fase_desde   ON candidatos(fase_desde);

-- Partir "MARIA DEL SOCORRO" en primero / segundo respetando partículas.
CREATE OR REPLACE FUNCTION public.vac_partir_nombre(p_texto TEXT)
RETURNS TABLE (primero TEXT, segundo TEXT)
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  toks TEXT[];
  particulas TEXT[] := ARRAY['DE','DEL','LA','LAS','LOS','SAN','SANTA','DA','DI','DO','DOS','VAN','VON','MC','MAC','Y','E'];
  grupos TEXT[] := '{}';
  cur TEXT := '';
  t TEXT;
BEGIN
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    primero := NULL; segundo := NULL; RETURN NEXT; RETURN;
  END IF;
  toks := regexp_split_to_array(upper(btrim(regexp_replace(p_texto, '\s+', ' ', 'g'))), ' ');
  FOREACH t IN ARRAY toks LOOP
    IF t = ANY(particulas) THEN
      cur := CASE WHEN cur = '' THEN t ELSE cur || ' ' || t END;
    ELSE
      grupos := array_append(grupos, CASE WHEN cur = '' THEN t ELSE cur || ' ' || t END);
      cur := '';
    END IF;
  END LOOP;
  IF cur <> '' THEN
    IF cardinality(grupos) = 0 THEN grupos := ARRAY[cur];
    ELSE grupos[cardinality(grupos)] := grupos[cardinality(grupos)] || ' ' || cur;
    END IF;
  END IF;
  primero := grupos[1];
  segundo := CASE WHEN cardinality(grupos) > 1 THEN array_to_string(grupos[2:cardinality(grupos)], ' ') END;
  RETURN NEXT;
END $fn$;

-- Las 4 partes y nombres/apellidos se mantienen coherentes en los dos sentidos:
-- si cambian las partes, mandan las partes; si solo cambia el texto completo
-- (clientes viejos), se vuelve a partir.
CREATE OR REPLACE FUNCTION public.vac_sync_nombres()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE r RECORD;
  partes_nombre_cambiaron BOOLEAN; partes_apellido_cambiaron BOOLEAN;
  nombres_cambio BOOLEAN; apellidos_cambio BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    partes_nombre_cambiaron   := NEW.primer_nombre IS NOT NULL;
    partes_apellido_cambiaron := NEW.primer_apellido IS NOT NULL;
    nombres_cambio := NEW.nombres IS NOT NULL;
    apellidos_cambio := NEW.apellidos IS NOT NULL;
  ELSE
    partes_nombre_cambiaron   := NEW.primer_nombre IS DISTINCT FROM OLD.primer_nombre OR NEW.segundo_nombre IS DISTINCT FROM OLD.segundo_nombre;
    partes_apellido_cambiaron := NEW.primer_apellido IS DISTINCT FROM OLD.primer_apellido OR NEW.segundo_apellido IS DISTINCT FROM OLD.segundo_apellido;
    nombres_cambio   := NEW.nombres IS DISTINCT FROM OLD.nombres;
    apellidos_cambio := NEW.apellidos IS DISTINCT FROM OLD.apellidos;
  END IF;

  -- Nombres: mandan las partes si cambiaron; si solo cambió el texto, se parte.
  IF partes_nombre_cambiaron THEN
    NEW.primer_nombre  := NULLIF(upper(btrim(NEW.primer_nombre)), '');
    NEW.segundo_nombre := NULLIF(upper(btrim(NEW.segundo_nombre)), '');
    NEW.nombres := NULLIF(btrim(concat_ws(' ', NEW.primer_nombre, NEW.segundo_nombre)), '');
  ELSIF nombres_cambio AND NEW.nombres IS NOT NULL THEN
    SELECT * INTO r FROM public.vac_partir_nombre(NEW.nombres);
    NEW.primer_nombre := r.primero; NEW.segundo_nombre := r.segundo;
    NEW.nombres := upper(btrim(NEW.nombres));
  END IF;

  -- Apellidos: misma regla, independiente de los nombres.
  IF partes_apellido_cambiaron THEN
    NEW.primer_apellido  := NULLIF(upper(btrim(NEW.primer_apellido)), '');
    NEW.segundo_apellido := NULLIF(upper(btrim(NEW.segundo_apellido)), '');
    NEW.apellidos := NULLIF(btrim(concat_ws(' ', NEW.primer_apellido, NEW.segundo_apellido)), '');
  ELSIF apellidos_cambio AND NEW.apellidos IS NOT NULL THEN
    SELECT * INTO r FROM public.vac_partir_nombre(NEW.apellidos);
    NEW.primer_apellido := r.primero; NEW.segundo_apellido := r.segundo;
    NEW.apellidos := upper(btrim(NEW.apellidos));
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_candidatos_sync_nombres ON candidatos;
CREATE TRIGGER tr_candidatos_sync_nombres BEFORE INSERT OR UPDATE ON candidatos
  FOR EACH ROW EXECUTE FUNCTION public.vac_sync_nombres();

-- Relleno de lo que ya existía.
UPDATE candidatos c SET
  primer_nombre  = (SELECT primero FROM public.vac_partir_nombre(c.nombres)),
  segundo_nombre = (SELECT segundo FROM public.vac_partir_nombre(c.nombres))
 WHERE c.primer_nombre IS NULL AND c.nombres IS NOT NULL;
UPDATE candidatos c SET
  primer_apellido  = (SELECT primero FROM public.vac_partir_nombre(c.apellidos)),
  segundo_apellido = (SELECT segundo FROM public.vac_partir_nombre(c.apellidos))
 WHERE c.primer_apellido IS NULL AND c.apellidos IS NOT NULL;

-- =============================================================================
-- 3. BITÁCORA, OBSERVACIONES Y EVALUACIONES
-- =============================================================================
CREATE TABLE IF NOT EXISTS candidato_eventos (
  id            BIGSERIAL PRIMARY KEY,
  candidato_id  UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,        -- CAMBIO_ESTADO | OBSERVACION | EVALUACION | DOCUMENTO | REMISION_IPS | CONTRATO | FIRMA | PRUEBA | REQUISICION | CENTRO_COSTO
  de_estado     TEXT,
  a_estado      TEXT,
  motivo        TEXT,
  detalle       JSONB,
  actor         UUID,
  actor_nombre  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_eventos ON candidato_eventos(candidato_id, created_at DESC);

CREATE TABLE IF NOT EXISTS candidato_observaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id  UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  texto         TEXT NOT NULL,
  autor         UUID,
  autor_nombre  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_obs ON candidato_observaciones(candidato_id, created_at DESC);

CREATE TABLE IF NOT EXISTS candidato_evaluaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id  UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,        -- ENTREVISTA | PSICOLOGICA | SEGURIDAD | REFERENCIAS | VISITA_DOMICILIARIA | POLIGRAFO | OTRA
  resultado     TEXT,                 -- APROBADO | NO_APROBADO | PENDIENTE | BAJO | MEDIO | ALTO
  concepto      TEXT,                 -- concepto general / reseña
  datos         JSONB NOT NULL DEFAULT '{}',  -- campos del formato (entrevista)
  evaluador     UUID,
  evaluador_nombre TEXT,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_eval ON candidato_evaluaciones(candidato_id, tipo);
DROP TRIGGER IF EXISTS tr_cand_eval_upd ON candidato_evaluaciones;
CREATE TRIGGER tr_cand_eval_upd BEFORE UPDATE ON candidato_evaluaciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Nombre del actor para la bitácora (usuarios.nombre o el correo).
CREATE OR REPLACE FUNCTION public.vac_actor_nombre()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(u.nombre, u.email) FROM usuarios u WHERE u.id = (SELECT auth.uid())
$fn$;

-- Bitácora automática al cambiar de fase: quién, cuándo, de dónde a dónde y
-- con qué motivo. También reinicia el contador "días en fase" y avisa al motor
-- de notificaciones.
CREATE OR REPLACE FUNCTION public.vac_candidato_cambio_estado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE es_corte BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    es_corte := NEW.estado::text IN ('RECHAZADO','NO_APTO','DESISTIO','BANCO_TALENTO','RETIRADO');
    NEW.fase_desde := NOW();
    IF es_corte THEN
      NEW.descartado_at  := NOW();
      NEW.descartado_por := (SELECT auth.uid());
    END IF;
    INSERT INTO candidato_eventos (candidato_id, tipo, de_estado, a_estado, motivo, actor, actor_nombre)
    VALUES (NEW.id, 'CAMBIO_ESTADO', OLD.estado::text, NEW.estado::text,
            CASE WHEN es_corte THEN COALESCE(NEW.motivo_descarte, '') || COALESCE(' · ' || NEW.descarte_detalle, '') END,
            (SELECT auth.uid()), public.vac_actor_nombre());
    PERFORM public.emitir_evento(
      CASE WHEN es_corte THEN 'ATS_DESCARTADO' ELSE 'ATS_CAMBIO_ESTADO' END,
      jsonb_build_object(
        'candidato_id', NEW.id, 'candidato_email', NEW.email, 'candidato_nombre', concat_ws(' ', NEW.nombres, NEW.apellidos),
        'documento', NEW.numero_documento, 'de_estado', OLD.estado::text, 'a_estado', NEW.estado::text,
        'motivo', NEW.motivo_descarte),
      'candidatos', NEW.id::text);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_candidatos_cambio_estado ON candidatos;
CREATE TRIGGER tr_candidatos_cambio_estado BEFORE UPDATE OF estado, motivo_descarte ON candidatos
  FOR EACH ROW EXECUTE FUNCTION public.vac_candidato_cambio_estado();


-- El candidato edita su propio registro por RLS, pero hay columnas que son del
-- área administrativa (fase, centro de costos, descarte, IPS, antecedentes…).
-- Esta guardia deja pasar a staff, a los RPC del sistema (bandera de sesión) y
-- a las escrituras de servicio (sin auth.uid()); al dueño solo le permite el
-- envío de su registro (BORRADOR → POSTULADO) y le revierte lo demás.
CREATE OR REPLACE FUNCTION public.vac_candidato_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;
  IF current_setting('vac.sistema', true) = 'on' THEN RETURN NEW; END IF;
  IF public.auth_permiso('gestionar_postulaciones') THEN RETURN NEW; END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM OLD.auth_uid THEN RETURN NEW; END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND NOT (OLD.estado::text = 'BORRADOR' AND NEW.estado::text = 'POSTULADO') THEN
    RAISE EXCEPTION 'No puedes cambiar el estado de tu proceso.';
  END IF;
  NEW.fase_desde        := OLD.fase_desde;
  NEW.centro_costo_id   := OLD.centro_costo_id;
  NEW.requisicion_id    := OLD.requisicion_id;
  NEW.motivo_descarte   := OLD.motivo_descarte;
  NEW.descarte_detalle  := OLD.descarte_detalle;
  NEW.descartado_at     := OLD.descartado_at;
  NEW.descartado_por    := OLD.descartado_por;
  NEW.ips_id            := OLD.ips_id;
  NEW.ips_nombre        := OLD.ips_nombre;
  NEW.ips_correo        := OLD.ips_correo;
  NEW.ips_fecha_remision := OLD.ips_fecha_remision;
  NEW.ips_remitido_por  := OLD.ips_remitido_por;
  NEW.antecedentes_resultado := OLD.antecedentes_resultado;
  NEW.antecedentes_mensaje   := OLD.antecedentes_mensaje;
  NEW.antecedentes_fecha     := OLD.antecedentes_fecha;
  NEW.antecedentes_por       := OLD.antecedentes_por;
  NEW.observaciones_rrhh     := OLD.observaciones_rrhh;
  NEW.persona_id             := OLD.persona_id;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_candidatos_guard ON candidatos;
CREATE TRIGGER tr_candidatos_guard BEFORE UPDATE ON candidatos
  FOR EACH ROW EXECUTE FUNCTION public.vac_candidato_guard();

-- Eventos del catálogo para el motor de notificaciones.
INSERT INTO eventos_notificacion (codigo, nombre, descripcion, modulo, variables) VALUES
  ('ATS_CAMBIO_ESTADO', 'Candidato cambió de fase', 'Un candidato del registro de vacantes pasó a otra fase del proceso.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_email","descripcion":"Correo del aspirante"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"documento","descripcion":"Documento"},{"clave":"de_estado","descripcion":"Fase anterior"},{"clave":"a_estado","descripcion":"Fase nueva"}]'),
  ('ATS_DESCARTADO', 'Candidato descartado', 'Un candidato salió del proceso con motivo tipificado.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_email","descripcion":"Correo del aspirante"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"motivo","descripcion":"Motivo de descarte"}]'),
  ('ATS_PRUEBAS_COMPLETADAS', 'Pruebas de selección completadas', 'El candidato terminó la prueba de aptitud y la de conocimientos.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_email","descripcion":"Correo del aspirante"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"puntaje","descripcion":"Puntaje de conocimientos"}]'),
  ('ATS_REMISION_IPS', 'Remisión a exámenes médicos', 'Se remitió al candidato a una IPS para el examen ocupacional de ingreso.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_email","descripcion":"Correo del aspirante"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"documento","descripcion":"Documento"},{"clave":"ips","descripcion":"IPS"},{"clave":"ips_correo","descripcion":"Correo de la IPS"},{"clave":"cargo","descripcion":"Cargo"}]'),
  ('ATS_DOCUMENTO_PARA_FIRMA', 'Documento listo para firmar', 'Se generó un documento con los datos del candidato y está pendiente de firma.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_email","descripcion":"Correo del aspirante"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"documento_nombre","descripcion":"Nombre del documento"},{"clave":"enlace","descripcion":"Enlace para firmar"}]'),
  ('ATS_DOCUMENTO_FIRMADO', 'Documento firmado', 'El candidato firmó un documento en la plataforma.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"documento_nombre","descripcion":"Nombre del documento"}]'),
  ('ATS_CONTRATADO', 'Candidato contratado', 'El candidato pasó a la planta de personal.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_nombre","descripcion":"Nombre completo"},{"clave":"documento","descripcion":"Documento"},{"clave":"cargo","descripcion":"Cargo"},{"clave":"centro_costo","descripcion":"Centro de costos"},{"clave":"fecha_ingreso","descripcion":"Fecha de ingreso"}]')
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
-- 4. REQUISICIONES DE PERSONAL  (formato C_1.1 REQUISICIÓN DE PERSONAL V3)
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS requisicion_consecutivo_seq;

CREATE OR REPLACE FUNCTION public.vac_codigo_requisicion()
RETURNS TEXT LANGUAGE sql VOLATILE AS $fn$
  SELECT 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('requisicion_consecutivo_seq')::text, 4, '0')
$fn$;

CREATE TABLE IF NOT EXISTS requisiciones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                TEXT NOT NULL UNIQUE DEFAULT public.vac_codigo_requisicion(),
  fecha_solicitud       DATE NOT NULL DEFAULT CURRENT_DATE,
  solicitante_id        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  solicitante_nombre    TEXT NOT NULL,
  proceso               TEXT,                       -- OPERACIONES, ADMINISTRATIVO…
  -- Datos del contrato
  centro_costo_id       UUID REFERENCES centros_costo(id) ON DELETE SET NULL,
  cliente_id            UUID REFERENCES empresas_usuarias(id) ON DELETE SET NULL,
  cliente_nombre        TEXT,                       -- "NOMBRE DEL CONTRATO (CLIENTE)"
  sede                  TEXT,
  fecha_inicio          DATE,
  fecha_inicio_texto    TEXT,                       -- "LO MÁS PRONTO POSIBLE"
  cantidad              INT NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  -- Motivo y cargo
  motivo                TEXT,                       -- CREACION_CARGO | EMPALME | REEMPLAZO | RENUNCIA
  motivo_detalle        TEXT,
  tipo_cargo            TEXT NOT NULL DEFAULT 'OPERATIVO',
  cargo_id              UUID REFERENCES cargos(id) ON DELETE SET NULL,
  cargo_texto           TEXT,
  perfil_cargo          TEXT,
  competencias_tecnicas TEXT,
  requiere_curso_alturas   BOOLEAN NOT NULL DEFAULT false,
  requiere_curso_alimentos BOOLEAN NOT NULL DEFAULT false,
  requiere_examen_conduccion BOOLEAN NOT NULL DEFAULT false,
  salario_basico        NUMERIC(14,2),
  turnos                TEXT[] NOT NULL DEFAULT '{}',
  turno_otro            TEXT,
  edad_requerida        TEXT,
  sexo_requerido        TEXT,
  nivel_academico       TEXT,
  experiencia_anios     INT,
  experiencia_meses     INT,
  modalidad_contrato    TEXT DEFAULT 'OBRA_LABOR',
  funciones             TEXT,
  -- Ciclo de vida
  estado                TEXT NOT NULL DEFAULT 'ABIERTA',  -- BORRADOR | ABIERTA | EN_PROCESO | CUBIERTA | CERRADA | ANULADA
  cupos_cubiertos       INT NOT NULL DEFAULT 0,
  aprobada_lider        BOOLEAN NOT NULL DEFAULT false,
  aprobada_th           BOOLEAN NOT NULL DEFAULT false,
  fecha_limite          DATE,                        -- 5 días hábiles para operativos (acuerdo de servicio)
  observaciones         TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_requisiciones_estado ON requisiciones(estado);
CREATE INDEX IF NOT EXISTS idx_requisiciones_centro ON requisiciones(centro_costo_id);
DROP TRIGGER IF EXISTS tr_requisiciones_upd ON requisiciones;
CREATE TRIGGER tr_requisiciones_upd BEFORE UPDATE ON requisiciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE postulaciones ADD COLUMN IF NOT EXISTS requisicion_id UUID REFERENCES requisiciones(id) ON DELETE SET NULL;
ALTER TABLE candidatos    ADD COLUMN IF NOT EXISTS requisicion_id UUID REFERENCES requisiciones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_postulaciones_requisicion ON postulaciones(requisicion_id);

-- Cupos cubiertos = candidatos contratados/activos amarrados a la requisición.
CREATE OR REPLACE FUNCTION public.vac_recalcular_cupos_requisicion(p_req UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE requisiciones r SET
    cupos_cubiertos = (SELECT COUNT(*) FROM candidatos c WHERE c.requisicion_id = r.id AND c.estado::text IN ('CONTRATADO','ACTIVO')),
    estado = CASE
      WHEN r.estado IN ('CERRADA','ANULADA','BORRADOR') THEN r.estado
      WHEN (SELECT COUNT(*) FROM candidatos c WHERE c.requisicion_id = r.id AND c.estado::text IN ('CONTRATADO','ACTIVO')) >= r.cantidad THEN 'CUBIERTA'
      WHEN EXISTS (SELECT 1 FROM candidatos c WHERE c.requisicion_id = r.id AND c.estado::text NOT IN ('BORRADOR','RECHAZADO','NO_APTO','DESISTIO','BANCO_TALENTO','RETIRADO')) THEN 'EN_PROCESO'
      ELSE 'ABIERTA' END
  WHERE r.id = p_req;
$fn$;

CREATE OR REPLACE FUNCTION public.vac_tr_cupos_requisicion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.requisicion_id IS NOT NULL AND OLD.requisicion_id IS DISTINCT FROM NEW.requisicion_id THEN
    PERFORM public.vac_recalcular_cupos_requisicion(OLD.requisicion_id);
  END IF;
  IF NEW.requisicion_id IS NOT NULL THEN PERFORM public.vac_recalcular_cupos_requisicion(NEW.requisicion_id); END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tr_candidatos_cupos_req ON candidatos;
CREATE TRIGGER tr_candidatos_cupos_req AFTER INSERT OR UPDATE OF requisicion_id, estado ON candidatos
  FOR EACH ROW EXECUTE FUNCTION public.vac_tr_cupos_requisicion();

-- =============================================================================
-- 5. PRUEBAS DE SELECCIÓN  (aptitud A/B + conocimientos con temporizador)
-- =============================================================================
CREATE TABLE IF NOT EXISTS pruebas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            TEXT NOT NULL UNIQUE,
  nombre            TEXT NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('APTITUD','CONOCIMIENTOS')),
  cargo_id          UUID REFERENCES cargos(id) ON DELETE CASCADE,   -- NULL = banco general
  descripcion       TEXT,
  instrucciones     TEXT,
  tiempo_limite_min INT,                       -- NULL = sin temporizador
  requiere_firma    BOOLEAN NOT NULL DEFAULT false,
  obligatoria       BOOLEAN NOT NULL DEFAULT true,
  orden             INT NOT NULL DEFAULT 0,
  activa            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS tr_pruebas_upd ON pruebas;
CREATE TRIGGER tr_pruebas_upd BEFORE UPDATE ON pruebas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS prueba_preguntas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prueba_id          UUID NOT NULL REFERENCES pruebas(id) ON DELETE CASCADE,
  orden              INT NOT NULL DEFAULT 0,
  enunciado          TEXT NOT NULL,
  opciones           JSONB NOT NULL DEFAULT '[]',   -- [{"clave":"A","texto":"…"}]
  respuesta_correcta TEXT,                          -- NULL en pruebas de perfil (sin puntaje)
  dimension          TEXT,                          -- lo que evalúa el ítem (perfil)
  activa             BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_prueba_preguntas ON prueba_preguntas(prueba_id, orden);

CREATE TABLE IF NOT EXISTS prueba_intentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id   UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  prueba_id      UUID NOT NULL REFERENCES pruebas(id) ON DELETE CASCADE,
  estado         TEXT NOT NULL DEFAULT 'EN_CURSO',   -- EN_CURSO | FINALIZADA | EXPIRADA
  iniciado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  limite_at      TIMESTAMPTZ,
  finalizado_at  TIMESTAMPTZ,
  respuestas     JSONB NOT NULL DEFAULT '{}',        -- {pregunta_id: clave}
  puntaje        INT,
  puntaje_max    INT,
  perfil         JSONB,                              -- {dimension: {A: n, B: n}}
  firma_nombre   TEXT,
  firma_documento TEXT,
  user_agent     TEXT,
  hash           TEXT,
  UNIQUE (candidato_id, prueba_id)                   -- un solo intento: bloquea reintentos
);
CREATE INDEX IF NOT EXISTS idx_prueba_intentos_cand ON prueba_intentos(candidato_id);

-- Lo que puede ver el candidato: preguntas SIN la clave de respuesta.
CREATE OR REPLACE VIEW vw_prueba_preguntas AS
  SELECT id, prueba_id, orden, enunciado, opciones, dimension
    FROM prueba_preguntas WHERE activa ORDER BY prueba_id, orden;
GRANT SELECT ON vw_prueba_preguntas TO anon, authenticated, service_role;

-- Pruebas que aplican a un candidato: por cada tipo, la del cargo si existe;
-- si no, la general.
CREATE OR REPLACE FUNCTION public.vac_pruebas_de_candidato(p_candidato UUID)
RETURNS TABLE (
  prueba_id UUID, codigo TEXT, nombre TEXT, tipo TEXT, descripcion TEXT, instrucciones TEXT,
  tiempo_limite_min INT, requiere_firma BOOLEAN, obligatoria BOOLEAN, orden INT,
  intento_id UUID, intento_estado TEXT, iniciado_at TIMESTAMPTZ, limite_at TIMESTAMPTZ,
  finalizado_at TIMESTAMPTZ, puntaje INT, puntaje_max INT, total_preguntas BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH cand AS (
    SELECT c.id, c.cargo_postulacion_id FROM candidatos c
     WHERE c.id = p_candidato
       AND (c.auth_uid = (SELECT auth.uid()) OR public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones']))
  ),
  aplicables AS (
    SELECT DISTINCT ON (p.tipo) p.*
      FROM pruebas p, cand
     WHERE p.activa AND (p.cargo_id IS NULL OR p.cargo_id = cand.cargo_postulacion_id)
     ORDER BY p.tipo, (p.cargo_id IS NOT NULL) DESC, p.orden
  )
  SELECT a.id, a.codigo, a.nombre, a.tipo, a.descripcion, a.instrucciones, a.tiempo_limite_min,
         a.requiere_firma, a.obligatoria, a.orden,
         i.id, i.estado, i.iniciado_at, i.limite_at, i.finalizado_at, i.puntaje, i.puntaje_max,
         (SELECT COUNT(*) FROM prueba_preguntas q WHERE q.prueba_id = a.id AND q.activa)
    FROM aplicables a
    LEFT JOIN prueba_intentos i ON i.prueba_id = a.id AND i.candidato_id = p_candidato
   ORDER BY a.orden;
$fn$;
REVOKE ALL ON FUNCTION public.vac_pruebas_de_candidato(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vac_pruebas_de_candidato(UUID) TO authenticated, service_role;

-- Inicia (o retoma) el intento. Solo el dueño del candidato.
CREATE OR REPLACE FUNCTION public.vac_iniciar_prueba(p_prueba UUID)
RETURNS prueba_intentos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_cand candidatos%ROWTYPE; v_prueba pruebas%ROWTYPE; v_int prueba_intentos%ROWTYPE;
BEGIN
  SELECT * INTO v_cand FROM candidatos WHERE auth_uid = (SELECT auth.uid()) ORDER BY updated_at DESC LIMIT 1;
  IF v_cand.id IS NULL THEN RAISE EXCEPTION 'No encontramos tu registro.'; END IF;
  IF v_cand.estado::text = 'BORRADOR' THEN RAISE EXCEPTION 'Primero envía tu registro.'; END IF;
  SELECT * INTO v_prueba FROM pruebas WHERE id = p_prueba AND activa;
  IF v_prueba.id IS NULL THEN RAISE EXCEPTION 'La prueba no está disponible.'; END IF;

  SELECT * INTO v_int FROM prueba_intentos WHERE candidato_id = v_cand.id AND prueba_id = p_prueba;
  IF v_int.id IS NOT NULL THEN
    IF v_int.estado <> 'EN_CURSO' THEN RAISE EXCEPTION 'Ya presentaste esta prueba.'; END IF;
    RETURN v_int;
  END IF;

  INSERT INTO prueba_intentos (candidato_id, prueba_id, limite_at)
  VALUES (v_cand.id, p_prueba,
          CASE WHEN v_prueba.tiempo_limite_min IS NOT NULL THEN NOW() + make_interval(mins => v_prueba.tiempo_limite_min) END)
  RETURNING * INTO v_int;

  IF v_cand.estado::text = 'POSTULADO' THEN
    PERFORM set_config('vac.sistema', 'on', true);
    UPDATE candidatos SET estado = 'EN_PRUEBAS' WHERE id = v_cand.id;
  END IF;
  RETURN v_int;
END $fn$;
REVOKE ALL ON FUNCTION public.vac_iniciar_prueba(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vac_iniciar_prueba(UUID) TO authenticated;

-- Cierra el intento, califica en el servidor (la clave nunca viaja al
-- navegador), exige firma + verificación de cédula cuando la prueba lo pide y,
-- si ya no queda ninguna prueba obligatoria pendiente, pasa al candidato a
-- revisión documental.
CREATE OR REPLACE FUNCTION public.vac_finalizar_prueba(
  p_intento UUID, p_respuestas JSONB, p_firma_nombre TEXT DEFAULT NULL,
  p_firma_documento TEXT DEFAULT NULL, p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_int prueba_intentos%ROWTYPE; v_prueba pruebas%ROWTYPE; v_cand candidatos%ROWTYPE;
  q RECORD; v_puntaje INT := 0; v_max INT := 0; v_perfil JSONB := '{}'; v_resp TEXT;
  v_estado TEXT := 'FINALIZADA'; v_pendientes INT; v_dim JSONB;
BEGIN
  SELECT * INTO v_int FROM prueba_intentos WHERE id = p_intento;
  IF v_int.id IS NULL THEN RAISE EXCEPTION 'Intento no encontrado.'; END IF;
  SELECT * INTO v_cand FROM candidatos WHERE id = v_int.candidato_id;
  IF v_cand.auth_uid IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'No autorizado.'; END IF;
  IF v_int.estado <> 'EN_CURSO' THEN RAISE EXCEPTION 'Esta prueba ya fue enviada.'; END IF;
  SELECT * INTO v_prueba FROM pruebas WHERE id = v_int.prueba_id;

  IF v_prueba.requiere_firma THEN
    IF COALESCE(btrim(p_firma_nombre), '') = '' THEN RAISE EXCEPTION 'Escribe tu nombre completo como firma.'; END IF;
    IF regexp_replace(COALESCE(p_firma_documento, ''), '\D', '', 'g') <> regexp_replace(v_cand.numero_documento, '\D', '', 'g') THEN
      RAISE EXCEPTION 'El número de cédula no coincide con el de tu registro.';
    END IF;
  END IF;

  -- 2 minutos de gracia sobre el límite (latencia, envío al vencer el reloj).
  IF v_int.limite_at IS NOT NULL AND NOW() > v_int.limite_at + INTERVAL '2 minutes' THEN v_estado := 'EXPIRADA'; END IF;

  FOR q IN SELECT id, respuesta_correcta, dimension FROM prueba_preguntas WHERE prueba_id = v_prueba.id AND activa LOOP
    v_resp := p_respuestas ->> q.id::text;
    IF q.respuesta_correcta IS NOT NULL THEN
      v_max := v_max + 1;
      IF v_resp IS NOT NULL AND upper(v_resp) = upper(q.respuesta_correcta) THEN v_puntaje := v_puntaje + 1; END IF;
    END IF;
    IF q.dimension IS NOT NULL AND v_resp IS NOT NULL THEN
      v_dim := COALESCE(v_perfil -> q.dimension, '{}'::jsonb);
      v_dim := jsonb_set(v_dim, ARRAY[upper(v_resp)], to_jsonb(COALESCE((v_dim ->> upper(v_resp))::int, 0) + 1), true);
      v_perfil := jsonb_set(v_perfil, ARRAY[q.dimension], v_dim, true);
    END IF;
  END LOOP;

  UPDATE prueba_intentos SET
    estado = v_estado, finalizado_at = NOW(), respuestas = COALESCE(p_respuestas, '{}'),
    puntaje = CASE WHEN v_max > 0 THEN v_puntaje END, puntaje_max = CASE WHEN v_max > 0 THEN v_max END,
    perfil = CASE WHEN v_perfil = '{}'::jsonb THEN NULL ELSE v_perfil END,
    firma_nombre = p_firma_nombre, firma_documento = p_firma_documento, user_agent = p_user_agent,
    hash = encode(digest(id::text || COALESCE(p_respuestas::text, '') || NOW()::text, 'sha256'), 'hex')
  WHERE id = v_int.id;

  INSERT INTO candidato_eventos (candidato_id, tipo, motivo, detalle, actor, actor_nombre)
  VALUES (v_cand.id, 'PRUEBA', v_prueba.nombre,
          jsonb_build_object('prueba', v_prueba.codigo, 'estado', v_estado, 'puntaje', v_puntaje, 'puntaje_max', v_max),
          (SELECT auth.uid()), 'Candidato');

  -- ¿Quedan pruebas obligatorias sin presentar?
  SELECT COUNT(*) INTO v_pendientes
    FROM public.vac_pruebas_de_candidato(v_cand.id) p
   WHERE p.obligatoria AND (p.intento_estado IS NULL OR p.intento_estado = 'EN_CURSO');
  IF v_pendientes = 0 AND v_cand.estado::text IN ('POSTULADO','EN_PRUEBAS') THEN
    PERFORM set_config('vac.sistema', 'on', true);
    UPDATE candidatos SET estado = 'EN_VERIFICACION' WHERE id = v_cand.id;
    PERFORM public.emitir_evento('ATS_PRUEBAS_COMPLETADAS',
      jsonb_build_object('candidato_id', v_cand.id, 'candidato_email', v_cand.email,
                         'candidato_nombre', concat_ws(' ', v_cand.nombres, v_cand.apellidos), 'puntaje', v_puntaje),
      'candidatos', v_cand.id::text);
  END IF;

  RETURN jsonb_build_object('estado', v_estado, 'puntaje', v_puntaje, 'puntaje_max', v_max, 'pendientes', v_pendientes);
END $fn$;
REVOKE ALL ON FUNCTION public.vac_finalizar_prueba(UUID, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vac_finalizar_prueba(UUID, JSONB, TEXT, TEXT, TEXT) TO authenticated;

-- Bancos de preguntas del ATS anterior (cargo OPERARIO ASEO → banco general).
INSERT INTO pruebas (codigo, nombre, tipo, descripcion, instrucciones, tiempo_limite_min, requiere_firma, orden) VALUES
  ('APTITUD_GENERAL', 'Prueba de aptitud', 'APTITUD',
   'Evalúa tu personalidad y habilidades psicotécnicas. No tiene tiempo límite ni respuestas correctas o incorrectas.',
   'Lee cada afirmación y selecciona la opción que mejor describa tu comportamiento o actitud en situaciones laborales. Tómate tu tiempo y responde con sinceridad.',
   NULL, false, 1),
  ('CONOCIMIENTOS_ASEO', 'Prueba de conocimientos operativos', 'CONOCIMIENTOS',
   'Evalúa tus conocimientos operativos del cargo. Tiene un tiempo límite de 10 minutos.',
   'Apreciado postulante, por favor complete la siguiente prueba de conocimientos. Todas las preguntas son de selección múltiple con única respuesta. Al finalizar deberá firmar con su nombre completo y confirmar su número de cédula.',
   10, true, 2)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO prueba_preguntas (prueba_id, orden, enunciado, opciones, dimension)
SELECT p.id, v.orden, v.enunciado, v.opciones::jsonb, v.dimension
FROM pruebas p, (VALUES
  (1, 'Ante un derrame de un químico en el área de trabajo, normalmente:',
   '[{"clave":"A","texto":"Mantengo la calma, evalúo la situación y sigo el protocolo de limpieza."},{"clave":"B","texto":"Busco apoyo de un compañero para resolverlo de forma segura."}]', 'Seguridad y manejo de emergencias'),
  (2, 'Cuando se trata de seguir protocolos de limpieza específicos:',
   '[{"clave":"A","texto":"Siempre respeto los procedimientos establecidos al pie de la letra."},{"clave":"B","texto":"Me adapto si considero que una técnica diferente puede ser más eficiente."}]', 'Apego a la norma vs. flexibilidad'),
  (3, 'Si un cliente señala que un área no ha quedado completamente limpia, yo:',
   '[{"clave":"A","texto":"Me disculpo y limpio el área inmediatamente según sus indicaciones."},{"clave":"B","texto":"Escucho sus comentarios, busco mejorar y vuelvo a limpiar el área."}]', 'Servicio al cliente'),
  (4, 'En el caso de que un compañero utilice mal un químico de limpieza:',
   '[{"clave":"A","texto":"Le explico cómo usarlo correctamente para prevenir futuros errores."},{"clave":"B","texto":"Informo al supervisor para que la situación sea corregida."}]', 'Conducto regular / trabajo en equipo'),
  (5, 'Me siento más cómodo trabajando en un ambiente donde:',
   '[{"clave":"A","texto":"Las tareas y procedimientos de limpieza están claramente definidos."},{"clave":"B","texto":"Hay libertad para proponer nuevas formas de realizar las tareas."}]', 'Apego a la norma vs. flexibilidad'),
  (6, 'Si se me asigna una nueva tarea de limpieza en un área desconocida, mi primera reacción es:',
   '[{"clave":"A","texto":"Observar el área y pedir detalles si algo no está claro."},{"clave":"B","texto":"Comenzar de inmediato y ajustar el método según sea necesario."}]', 'Afrontamiento de lo desconocido'),
  (7, 'Ante un desacuerdo con un compañero sobre cómo realizar una tarea de limpieza, yo:',
   '[{"clave":"A","texto":"Prefiero hablar con calma para llegar a un acuerdo."},{"clave":"B","texto":"Dejo pasar la situación y trato de continuar trabajando."}]', 'Resolución de conflictos'),
  (8, 'Cuando trabajo bajo presión para limpiar varias áreas en poco tiempo, suelo:',
   '[{"clave":"A","texto":"Mantener la calma y enfocarme en hacer las cosas bien, pero rápido."},{"clave":"B","texto":"Pedir ayuda para dividir las tareas y cubrir más áreas."}]', 'Tolerancia a la presión'),
  (9, 'En un equipo de limpieza, si necesito liderar una tarea grupal, yo:',
   '[{"clave":"A","texto":"Escucho las ideas del equipo antes de asignar las tareas."},{"clave":"B","texto":"Tomo decisiones rápidas para que el trabajo fluya sin interrupciones."}]', 'Estilo de liderazgo'),
  (10, 'Para mantener un ambiente de limpieza seguro, considero que lo más importante es:',
   '[{"clave":"A","texto":"Seguir estrictamente los protocolos de seguridad y manejo de químicos."},{"clave":"B","texto":"Trabajar en equipo para que todos contribuyan a la seguridad."}]', 'Seguridad y manejo de emergencias')
) AS v(orden, enunciado, opciones, dimension)
WHERE p.codigo = 'APTITUD_GENERAL'
  AND NOT EXISTS (SELECT 1 FROM prueba_preguntas q WHERE q.prueba_id = p.id);

-- ❗ La clave es la deducida del contenido técnico (ver especificación §7.2):
--   confirmar contra la clave oficial antes de usarla para descartar.
INSERT INTO prueba_preguntas (prueba_id, orden, enunciado, opciones, respuesta_correcta)
SELECT p.id, v.orden, v.enunciado, v.opciones::jsonb, v.clave
FROM pruebas p, (VALUES
  (1, '¿Qué equipo de protección personal (EPP) se debe usar al manipular químicos de limpieza?',
   '[{"clave":"A","texto":"Tapabocas, monogafas, guantes"},{"clave":"B","texto":"Escoba, trapero y balde"},{"clave":"C","texto":"Aviso preventivo, atomizador, bayetilla"}]', 'A'),
  (2, '¿Por qué es importante leer las etiquetas de los productos de aseo antes de usarlos?',
   '[{"clave":"A","texto":"Para uso correcto del producto"},{"clave":"B","texto":"Garantizar la seguridad personal"},{"clave":"C","texto":"A y B"},{"clave":"D","texto":"Ninguna de las anteriores"}]', 'C'),
  (3, '¿Cómo organizarías tu tiempo si te asignan limpiar varias áreas en una jornada laboral diaria?',
   '[{"clave":"A","texto":"Realizar las actividades más rápidas y fáciles"},{"clave":"B","texto":"Realizar una sola actividad"},{"clave":"C","texto":"Realizar una rutina de trabajo"},{"clave":"D","texto":"Realizar todas las actividades superficialmente"}]', 'C'),
  (4, '¿Qué precauciones tomarías para evitar caídas mientras se realiza la limpieza en un piso?',
   '[{"clave":"A","texto":"Colocar avisos preventivos"},{"clave":"B","texto":"Volver a trapear el piso"},{"clave":"C","texto":"Cuidar el piso hasta secarse"}]', 'A'),
  (5, '¿Cuál sería el paso a paso para realizar correctamente la limpieza de un piso en cualquier área?',
   '[{"clave":"A","texto":"Prender la greca y preparar bebidas"},{"clave":"B","texto":"Utilizar EPPS, alistar insumos y elementos para aseo"},{"clave":"C","texto":"Trapear y mopear"},{"clave":"D","texto":"Señalizar, barrer y trapear"},{"clave":"E","texto":"B y D"},{"clave":"F","texto":"A y C"}]', 'E'),
  (6, '¿Cuál sería mi conducto regular cuando se presenta alguna novedad durante el servicio en mi lugar de trabajo?',
   '[{"clave":"A","texto":"Interventor del contrato o funcionario a cargo de la entidad"},{"clave":"B","texto":"Compañero de trabajo"},{"clave":"C","texto":"Supervisor o coordinador de la empresa"},{"clave":"D","texto":"Guarda de seguridad"}]', 'C')
) AS v(orden, enunciado, opciones, clave)
WHERE p.codigo = 'CONOCIMIENTOS_ASEO'
  AND NOT EXISTS (SELECT 1 FROM prueba_preguntas q WHERE q.prueba_id = p.id);

-- =============================================================================
-- 6. PLANTILLAS DE DOCUMENTOS (versionadas) Y DOCUMENTOS GENERADOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS plantillas_documento (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             TEXT NOT NULL UNIQUE,
  nombre             TEXT NOT NULL,
  descripcion        TEXT,
  categoria          TEXT NOT NULL DEFAULT 'FORMATO',      -- CONTRATO | AUTORIZACION | FORMATO | CONSTANCIA | CARTA | HOJA_VIDA | REQUISICION
  momento            TEXT NOT NULL DEFAULT 'CONTRATACION', -- SELECCION | CONTRATACION | INGRESO
  orden              INT NOT NULL DEFAULT 0,
  obligatoria        BOOLEAN NOT NULL DEFAULT true,
  activa             BOOLEAN NOT NULL DEFAULT true,
  es_sistema         BOOLEAN NOT NULL DEFAULT false,
  requiere_firma_trabajador BOOLEAN NOT NULL DEFAULT true,
  requiere_firma_empleador  BOOLEAN NOT NULL DEFAULT false,
  requiere_testigos  BOOLEAN NOT NULL DEFAULT false,
  requiere_huella    BOOLEAN NOT NULL DEFAULT false,
  requiere_contrato  BOOLEAN NOT NULL DEFAULT false,       -- solo se puede generar con contrato
  aplica_cargos      UUID[],                               -- NULL = todos los cargos
  codigo_formato     TEXT,                                 -- código/versión impresa del formato físico ("Versión 8 · 16/02/2016")
  archivo_original_path   TEXT,                            -- el .doc/.docx/.xls original en storage
  archivo_original_nombre TEXT,
  version_vigente    INT NOT NULL DEFAULT 0,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS tr_plantillas_doc_upd ON plantillas_documento;
CREATE TRIGGER tr_plantillas_doc_upd BEFORE UPDATE ON plantillas_documento
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS plantilla_versiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plantilla_id   UUID NOT NULL REFERENCES plantillas_documento(id) ON DELETE CASCADE,
  version        INT NOT NULL,
  cuerpo_html    TEXT NOT NULL,
  variables      TEXT[] NOT NULL DEFAULT '{}',       -- variables que usa (para validar antes de generar)
  notas          TEXT,
  sha256         TEXT,
  publicada      BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID,
  creado_por_nombre TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plantilla_id, version)
);
CREATE INDEX IF NOT EXISTS idx_plantilla_versiones ON plantilla_versiones(plantilla_id, version DESC);

-- Al publicar una versión, la plantilla apunta a ella.
CREATE OR REPLACE FUNCTION public.vac_tr_version_publicada()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.publicada THEN
    UPDATE plantillas_documento SET version_vigente = NEW.version WHERE id = NEW.plantilla_id AND version_vigente < NEW.version;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tr_plantilla_version_pub ON plantilla_versiones;
CREATE TRIGGER tr_plantilla_version_pub AFTER INSERT OR UPDATE OF publicada ON plantilla_versiones
  FOR EACH ROW EXECUTE FUNCTION public.vac_tr_version_publicada();

CREATE TABLE IF NOT EXISTS documentos_generados (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id       UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  contrato_id        UUID,                                   -- FK más abajo (contratos ya existe)
  plantilla_id       UUID NOT NULL REFERENCES plantillas_documento(id) ON DELETE RESTRICT,
  version_id         UUID NOT NULL REFERENCES plantilla_versiones(id) ON DELETE RESTRICT,
  codigo_plantilla   TEXT NOT NULL,
  nombre             TEXT NOT NULL,
  datos              JSONB NOT NULL DEFAULT '{}',            -- foto de las variables al generar
  html_render        TEXT NOT NULL,                          -- documento listo para imprimir/firmar
  html_firmado       TEXT,                                   -- con la firma estampada
  estado             TEXT NOT NULL DEFAULT 'PENDIENTE_FIRMA', -- PENDIENTE_FIRMA | FIRMADO | GENERADO | ANULADO
  metodo_firma       TEXT,                                   -- ELECTRONICA | MANUSCRITA
  firma_data_url     TEXT,
  firmado_at         TIMESTAMPTZ,
  firma_evidencia    JSONB,
  sha256             TEXT,
  archivo_firmado_path TEXT,                                 -- escaneado del papel firmado (bucket registro-vacantes)
  archivo_firmado_at TIMESTAMPTZ,
  generado_por       UUID,
  generado_por_nombre TEXT,
  generado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anulado_at         TIMESTAMPTZ,
  anulado_motivo     TEXT
);
CREATE INDEX IF NOT EXISTS idx_docgen_candidato ON documentos_generados(candidato_id, estado);
CREATE INDEX IF NOT EXISTS idx_docgen_contrato  ON documentos_generados(contrato_id);

-- Firma electrónica simple del candidato: dibuja en pantalla, la imagen viaja
-- como data URL y el servidor la estampa en el HTML ya generado (el texto no lo
-- puede alterar el navegador). Queda hash, fecha, user-agent y versión.
CREATE OR REPLACE FUNCTION public.vac_firmar_documento(p_doc UUID, p_firma_data_url TEXT, p_user_agent TEXT DEFAULT NULL)
RETURNS documentos_generados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE d documentos_generados%ROWTYPE; c candidatos%ROWTYPE; v_html TEXT; v_marca TEXT;
BEGIN
  SELECT * INTO d FROM documentos_generados WHERE id = p_doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento no encontrado.'; END IF;
  SELECT * INTO c FROM candidatos WHERE id = d.candidato_id;
  IF c.auth_uid IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'No autorizado.'; END IF;
  IF d.estado <> 'PENDIENTE_FIRMA' THEN RAISE EXCEPTION 'Este documento ya no está pendiente de firma.'; END IF;
  IF p_firma_data_url IS NULL OR p_firma_data_url NOT LIKE 'data:image/png;base64,%' THEN RAISE EXCEPTION 'Firma inválida.'; END IF;
  IF length(p_firma_data_url) > 400000 THEN RAISE EXCEPTION 'La firma es demasiado grande.'; END IF;

  v_marca := '<img class="firma-img" alt="Firma" src="' || p_firma_data_url || '" />';
  v_html := replace(d.html_render, '{{FIRMA_TRABAJADOR}}', v_marca);
  v_html := replace(v_html, '{{FECHA_FIRMA}}', to_char(NOW() AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'));

  UPDATE documentos_generados SET
    estado = 'FIRMADO', metodo_firma = 'ELECTRONICA', firma_data_url = p_firma_data_url,
    html_firmado = v_html, firmado_at = NOW(),
    sha256 = encode(digest(v_html, 'sha256'), 'hex'),
    firma_evidencia = jsonb_build_object('user_agent', p_user_agent, 'firmado_at', NOW(), 'auth_uid', (SELECT auth.uid()),
                                         'documento', c.numero_documento, 'version_id', d.version_id)
  WHERE id = d.id RETURNING * INTO d;

  INSERT INTO candidato_eventos (candidato_id, tipo, motivo, detalle, actor, actor_nombre)
  VALUES (c.id, 'FIRMA', d.nombre, jsonb_build_object('documento_id', d.id, 'metodo', 'ELECTRONICA'), (SELECT auth.uid()), 'Candidato');
  PERFORM public.emitir_evento('ATS_DOCUMENTO_FIRMADO',
    jsonb_build_object('candidato_id', c.id, 'candidato_nombre', concat_ws(' ', c.nombres, c.apellidos), 'documento_nombre', d.nombre),
    'documentos_generados', d.id::text);
  RETURN d;
END $fn$;
REVOKE ALL ON FUNCTION public.vac_firmar_documento(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vac_firmar_documento(UUID, TEXT, TEXT) TO authenticated;

-- =============================================================================
-- 7. CONTRATO DE TRABAJO  (cabecera de la minuta + lo que pide nómina/WO)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.vac_codigo_contrato()
RETURNS TEXT LANGUAGE sql VOLATILE AS $fn$
  SELECT 'CONS' || to_char(now() AT TIME ZONE 'America/Bogota', 'YYYYMMDD') || '-' || lpad(nextval('contrato_consecutivo_seq')::text, 3, '0')
$fn$;

ALTER TABLE contratos ALTER COLUMN obra_id DROP NOT NULL;
ALTER TABLE contratos ALTER COLUMN codigo SET DEFAULT public.vac_codigo_contrato();
ALTER TABLE contratos ALTER COLUMN modalidad_salarial SET DEFAULT 'SMLV_AUXILIO';
ALTER TABLE contratos ALTER COLUMN salario SET DEFAULT 0;
ALTER TABLE contratos ALTER COLUMN incluye_auxilio_transporte SET DEFAULT true;
ALTER TABLE contratos ALTER COLUMN periodo_pago SET DEFAULT 'MES VENCIDO (QUINTO DÍA HÁBIL DE CADA MES)';
ALTER TABLE contratos ALTER COLUMN lugar_labores SET DEFAULT 'BOGOTÁ';
ALTER TABLE contratos ALTER COLUMN ciudad_contratacion SET DEFAULT 'BOGOTÁ';
ALTER TABLE contratos ALTER COLUMN periodo_prueba_dias SET DEFAULT 60;
ALTER TABLE contratos ALTER COLUMN modalidad_jornada SET DEFAULT 'JORNADA MÁXIMA LEGAL';
ALTER TABLE contratos ALTER COLUMN template_version SET DEFAULT '';

ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tipo_contrato        TEXT NOT NULL DEFAULT 'OBRA_LABOR';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS estado               TEXT NOT NULL DEFAULT 'BORRADOR';  -- BORRADOR | GENERADO | FIRMADO | VIGENTE | TERMINADO | ANULADO
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS centro_costo_id      UUID REFERENCES centros_costo(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS requisicion_id       UUID REFERENCES requisiciones(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS contrato_servicio    TEXT;    -- "CONTRATO DE SERVICIO DE ASEO…: UT ASECO 2026-CMM-2026-000029"
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS salario_texto        TEXT NOT NULL DEFAULT 'Mínimo Legal Vigente más Auxilio de Transporte y Recargos de Ley';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_fin_periodo_prueba DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_fin_contrato   DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS area                 TEXT NOT NULL DEFAULT 'Produccion';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS clase_salario        TEXT NOT NULL DEFAULT 'Normal';   -- Normal | Salario Inferior al Minimo
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS clasificacion_dian   TEXT NOT NULL DEFAULT 'Normal';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tipo_direccion       TEXT NOT NULL DEFAULT 'Casa';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS arl_id               UUID REFERENCES arl(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tarifa_arl           NUMERIC(6,3) NOT NULL DEFAULT 1.044;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS eps_id               UUID REFERENCES eps(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS afp_id               UUID REFERENCES afp(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS cesantias_id         UUID REFERENCES cesantias(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS ccf_id               UUID REFERENCES cajas_compensacion(id) ON DELETE SET NULL;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_afil_eps       DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_afil_afp       DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_afil_cesantias DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_afil_ccf       DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS fecha_afil_arl       DATE;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tipo_cotizante       TEXT NOT NULL DEFAULT 'Dependiente';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS subtipo_cotizante    TEXT NOT NULL DEFAULT 'Ninguno';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS dotacion             BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS declarante           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tipo_sena            TEXT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS codigo_empleado      TEXT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS observaciones        TEXT;
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS clausulas_adicionales TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_contratos_candidato ON contratos(candidato_id);
DROP TRIGGER IF EXISTS tr_contratos_upd ON contratos;
CREATE TRIGGER tr_contratos_upd BEFORE UPDATE ON contratos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_docgen_contrato') THEN
    ALTER TABLE documentos_generados ADD CONSTRAINT fk_docgen_contrato
      FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE SET NULL;
  END IF;
END $fk$;

-- Fin del periodo de prueba: 2 meses calendario (cláusula SEXTA), salvo que se
-- indique otro; las fechas de afiliación por defecto son la de ingreso.
CREATE OR REPLACE FUNCTION public.vac_contrato_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.fecha_fin_periodo_prueba IS NULL AND NEW.fecha_inicio_labores IS NOT NULL THEN
    NEW.fecha_fin_periodo_prueba := NEW.fecha_inicio_labores + make_interval(days => COALESCE(NEW.periodo_prueba_dias, 60)) - 1;
  END IF;
  NEW.fecha_afil_eps       := COALESCE(NEW.fecha_afil_eps, NEW.fecha_inicio_labores);
  NEW.fecha_afil_afp       := COALESCE(NEW.fecha_afil_afp, NEW.fecha_inicio_labores);
  NEW.fecha_afil_cesantias := COALESCE(NEW.fecha_afil_cesantias, NEW.fecha_inicio_labores);
  NEW.fecha_afil_ccf       := COALESCE(NEW.fecha_afil_ccf, NEW.fecha_inicio_labores);
  NEW.fecha_afil_arl       := COALESCE(NEW.fecha_afil_arl, NEW.fecha_inicio_labores);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tr_contratos_defaults ON contratos;
CREATE TRIGGER tr_contratos_defaults BEFORE INSERT OR UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION public.vac_contrato_defaults();

-- Entrega a nómina: al marcar CONTRATADO nace la ficha en `personas` y su
-- vinculación ACTIVA, enlazadas al contrato. Idempotente por documento.
CREATE OR REPLACE FUNCTION public.vac_contratar_candidato(p_candidato UUID, p_contrato UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE c candidatos%ROWTYPE; k contratos%ROWTYPE; v_persona UUID; v_cargo TEXT; v_ciudad TEXT; v_depto TEXT;
        v_dir TEXT; v_eps TEXT; v_arl TEXT; v_centro TEXT;
BEGIN
  IF NOT public.auth_permiso('gestionar_postulaciones') THEN RAISE EXCEPTION 'No tienes permiso para contratar.'; END IF;
  SELECT * INTO c FROM candidatos WHERE id = p_candidato;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Candidato no encontrado.'; END IF;
  IF p_contrato IS NOT NULL THEN SELECT * INTO k FROM contratos WHERE id = p_contrato AND candidato_id = c.id; END IF;
  IF k.id IS NULL THEN SELECT * INTO k FROM contratos WHERE candidato_id = c.id AND estado <> 'ANULADO' ORDER BY generado_at DESC LIMIT 1; END IF;

  SELECT nombre INTO v_cargo FROM cargos WHERE id = COALESCE(k.cargo_id, c.cargo_postulacion_id);
  SELECT m.nombre, d.nombre INTO v_ciudad, v_depto FROM municipios m JOIN departamentos d ON d.codigo_dane = m.departamento_codigo
   WHERE m.codigo_dane = c.municipio_trabajo;
  SELECT direccion INTO v_dir FROM candidato_direcciones WHERE candidato_id = c.id AND vigente_hasta IS NULL ORDER BY vigente_desde DESC LIMIT 1;
  SELECT nombre INTO v_eps FROM eps WHERE id = c.eps_id;
  SELECT nombre INTO v_arl FROM arl WHERE id = k.arl_id;
  SELECT codigo INTO v_centro FROM centros_costo WHERE id = COALESCE(k.centro_costo_id, c.centro_costo_id);

  INSERT INTO personas (tipo_doc, documento, nombres, apellidos, nombre_completo, cargo, fecha_ingreso, estado, email, telefono,
                        direccion, eps, arl, centro_costo_id, ciudad, departamento, salario, tipo_contrato, origen, nombre_confianza)
  VALUES (c.tipo_documento::text, c.numero_documento, c.nombres, c.apellidos, concat_ws(' ', c.apellidos, c.nombres), v_cargo,
          COALESCE(k.fecha_inicio_labores, CURRENT_DATE), 'ACTIVO', c.email, c.celular, v_dir, v_eps, v_arl,
          COALESCE(k.centro_costo_id, c.centro_costo_id), v_ciudad, v_depto, k.salario,
          CASE k.tipo_contrato WHEN 'OBRA_LABOR' THEN 'Labor Contratada' WHEN 'INDEFINIDO' THEN 'Indefinido' WHEN 'TERMINO_FIJO' THEN 'Término fijo' ELSE k.tipo_contrato END,
          'REGISTRO_VACANTES', 'ALTA')
  ON CONFLICT (documento) DO UPDATE SET
    nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos, nombre_completo = EXCLUDED.nombre_completo,
    cargo = EXCLUDED.cargo, fecha_ingreso = EXCLUDED.fecha_ingreso, estado = 'ACTIVO', email = EXCLUDED.email,
    telefono = EXCLUDED.telefono, direccion = EXCLUDED.direccion, eps = EXCLUDED.eps, arl = EXCLUDED.arl,
    centro_costo_id = EXCLUDED.centro_costo_id, ciudad = EXCLUDED.ciudad, departamento = EXCLUDED.departamento,
    salario = EXCLUDED.salario, tipo_contrato = EXCLUDED.tipo_contrato, fecha_retiro = NULL, motivo_retiro = NULL
  RETURNING id INTO v_persona;

  -- Cierra vinculaciones abiertas viejas (recontratación) y abre la nueva.
  UPDATE persona_vinculaciones SET estado = 'TERMINADA', fecha_retiro = COALESCE(fecha_retiro, CURRENT_DATE)
   WHERE persona_id = v_persona AND estado = 'ACTIVA' AND (k.id IS NULL OR contrato_id IS DISTINCT FROM k.id);
  INSERT INTO persona_vinculaciones (persona_id, centro_costo_id, cargo, cargo_id, contrato_id, obra_id, tipo_contrato,
                                     salario, fecha_ingreso, periodo_prueba, fecha_fin_contrato, estado, origen, clave_origen)
  SELECT v_persona, COALESCE(k.centro_costo_id, c.centro_costo_id), v_cargo, COALESCE(k.cargo_id, c.cargo_postulacion_id), k.id, k.obra_id,
         CASE k.tipo_contrato WHEN 'OBRA_LABOR' THEN 'Labor Contratada' WHEN 'INDEFINIDO' THEN 'Indefinido' WHEN 'TERMINO_FIJO' THEN 'Término fijo' ELSE k.tipo_contrato END,
         k.salario, COALESCE(k.fecha_inicio_labores, CURRENT_DATE), COALESCE(k.periodo_prueba_dias::text || ' días', NULL), k.fecha_fin_contrato,
         'ACTIVA', 'REGISTRO_VACANTES', 'ATS:' || c.numero_documento || ':' || COALESCE(k.codigo, to_char(CURRENT_DATE, 'YYYYMMDD'))
  WHERE NOT EXISTS (SELECT 1 FROM persona_vinculaciones v WHERE v.persona_id = v_persona AND v.estado = 'ACTIVA')
  ON CONFLICT (clave_origen) DO NOTHING;

  UPDATE candidatos SET persona_id = v_persona, estado = 'CONTRATADO' WHERE id = c.id AND estado::text <> 'CONTRATADO';
  IF k.id IS NOT NULL THEN UPDATE contratos SET estado = CASE WHEN estado IN ('BORRADOR','GENERADO') THEN 'VIGENTE' ELSE estado END WHERE id = k.id; END IF;

  INSERT INTO candidato_eventos (candidato_id, tipo, motivo, detalle, actor, actor_nombre)
  VALUES (c.id, 'CONTRATO', 'Entregado a nómina (planta de personal)',
          jsonb_build_object('persona_id', v_persona, 'contrato', k.codigo, 'centro_costo', v_centro), (SELECT auth.uid()), public.vac_actor_nombre());
  PERFORM public.emitir_evento('ATS_CONTRATADO',
    jsonb_build_object('candidato_id', c.id, 'candidato_nombre', concat_ws(' ', c.nombres, c.apellidos), 'documento', c.numero_documento,
                       'cargo', v_cargo, 'centro_costo', v_centro, 'fecha_ingreso', COALESCE(k.fecha_inicio_labores, CURRENT_DATE)),
    'candidatos', c.id::text);
  RETURN v_persona;
END $fn$;
REVOKE ALL ON FUNCTION public.vac_contratar_candidato(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vac_contratar_candidato(UUID, UUID) TO authenticated, service_role;

-- =============================================================================
-- 8. TIPOS DOCUMENTALES: lo que el expediente físico demostró que se escanea
-- =============================================================================
ALTER TABLE vac_tipos_documentales ADD COLUMN IF NOT EXISTS descripcion      TEXT;
ALTER TABLE vac_tipos_documentales ADD COLUMN IF NOT EXISTS plantilla_codigo TEXT;   -- si lo genera la plataforma
ALTER TABLE vac_tipos_documentales ADD COLUMN IF NOT EXISTS sube_staff       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vac_tipos_documentales ADD COLUMN IF NOT EXISTS activo           BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE candidato_documentos   ADD COLUMN IF NOT EXISTS subido_por       TEXT NOT NULL DEFAULT 'CANDIDATO';  -- CANDIDATO | STAFF
ALTER TABLE candidato_documentos   ADD COLUMN IF NOT EXISTS subido_por_uid   UUID;
ALTER TABLE candidato_documentos   ADD COLUMN IF NOT EXISTS observacion      TEXT;
ALTER TABLE candidato_documentos   ADD COLUMN IF NOT EXISTS validado_por     UUID;
ALTER TABLE candidato_documentos   ADD COLUMN IF NOT EXISTS validado_at      TIMESTAMPTZ;

INSERT INTO vac_tipos_documentales
  (codigo, nombre, grupo, obligatorio, min_archivos, max_archivos, formatos_permitidos, vigencia_dias, requiere_ocr, aplica_si, ola, orden, descripcion, sube_staff)
VALUES
  ('ANT_PERSONERIA', 'Certificado de antecedentes Personería (Bogotá)', 'ANTECEDENTES', false, 0, 1, '{pdf,jpg,jpeg,png,heic}', 30, true, NULL, 1, 24,
   'Solo para vinculación en Bogotá D.C. No mayor a 30 días.', false),
  ('REF_FAMILIARES', 'Referencias familiares', 'REFERENCIAS', false, 0, 3, '{pdf,jpg,jpeg,png,heic,doc,docx}', 30, false, NULL, 1, 33,
   'Carta de un familiar que no viva contigo, no mayor a 30 días.', false),
  ('CERT_GRECAS', 'Certificado de manejo de grecas', 'ESTUDIOS', false, 0, 1, '{pdf,jpg,jpeg,png,heic}', NULL, true, '{"cargo.requiere_curso_grecas": true}', 1, 14, NULL, false),
  ('AFIL_CCF', 'Certificado de afiliación a caja de compensación', 'VINCULACION', false, 0, 1, '{pdf,jpg,jpeg,png}', NULL, false, NULL, 3, 50,
   'Lo expide la caja después de la afiliación que hace la empresa.', true),
  ('AFIL_ARL', 'Certificado de afiliación a ARL', 'VINCULACION', false, 0, 1, '{pdf,jpg,jpeg,png}', NULL, false, NULL, 3, 51,
   'Lo expide la ARL después de la afiliación que hace la empresa.', true),
  ('PLAN_EXEQUIAL', 'Solicitud / certificado de plan exequial', 'VINCULACION', false, 0, 2, '{pdf,jpg,jpeg,png}', NULL, false, NULL, 3, 52,
   'Formulario del plan exequial empresarial o certificado del plan propio con carta de retiro.', true),
  ('CONTRATO_FIRMADO', 'Contrato de trabajo firmado (escaneado)', 'CONTRATACION', false, 0, 3, '{pdf,jpg,jpeg,png}', NULL, false, NULL, 3, 60,
   'Solo cuando el contrato se firma en papel. Si se firma en la plataforma, no hace falta.', true),
  ('PAQUETE_INGRESO_FIRMADO', 'Formatos de ingreso firmados (escaneados)', 'CONTRATACION', false, 0, 20, '{pdf,jpg,jpeg,png}', NULL, false, NULL, 3, 61,
   'Autorizaciones, constancias y demás formatos firmados en papel.', true)
ON CONFLICT (codigo) DO NOTHING;

-- Ajustes según la lista de chequeo de la empresa y el expediente de ejemplo.
UPDATE vac_tipos_documentales SET vigencia_dias = 30, descripcion = COALESCE(descripcion, 'Dos referencias personales no mayores a 30 días.')
 WHERE codigo = 'REF_PERSONALES';
UPDATE vac_tipos_documentales SET vigencia_dias = 30, descripcion = COALESCE(descripcion, 'Certificación de afiliación no mayor a 30 días (no sirve ADRES ni FOSYGA).')
 WHERE codigo IN ('AFIL_EPS','AFIL_AFP');
UPDATE vac_tipos_documentales SET descripcion = COALESCE(descripcion, 'Fotocopia ampliada al 150 %, ambas caras.') WHERE codigo = 'CEDULA';
UPDATE vac_tipos_documentales SET descripcion = COALESCE(descripcion, 'Fondo azul o blanco, reciente.') WHERE codigo = 'FOTO_CARNET';
UPDATE vac_tipos_documentales SET descripcion = COALESCE(descripcion, 'No mayor a 30 días: Policía, Procuraduría, Contraloría y Medidas Correctivas (RNMC).')
 WHERE codigo IN ('ANT_RNMC','ANT_POLICIA','ANT_CONTRALORIA','ANT_PROCURADURIA');
UPDATE vac_tipos_documentales SET descripcion = COALESCE(descripcion, 'Diploma y acta de bachiller, o certificado del último año cursado.') WHERE codigo = 'DIPLOMA';
UPDATE vac_tipos_documentales SET descripcion = COALESCE(descripcion, 'Todas las certificaciones laborales de empleos anteriores.') WHERE codigo = 'CERT_LABORALES';
-- La hoja de vida ahora la genera la plataforma con lo que el candidato llenó.
UPDATE vac_tipos_documentales SET obligatorio = false, plantilla_codigo = 'HOJA_VIDA',
       descripcion = COALESCE(descripcion, 'Opcional: la plataforma genera tu hoja de vida con los datos del formulario.')
 WHERE codigo = 'HOJA_VIDA';
UPDATE vac_tipos_documentales SET formatos_permitidos = '{pdf,jpg,jpeg,png,heic,doc,docx}'
 WHERE codigo IN ('HOJA_VIDA','REF_LABORALES','REF_PERSONALES','CERT_LABORALES','CURSOS');
UPDATE vac_tipos_documentales SET plantilla_codigo = 'CONTRATO_OBRA_LABOR' WHERE codigo = 'CONTRATO_FIRMADO';

-- =============================================================================
-- 9. RLS
-- =============================================================================
ALTER TABLE vac_listas_opciones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ips                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipios_nomina       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vac_empresa             ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_eventos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_observaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_evaluaciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisiciones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pruebas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE prueba_preguntas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prueba_intentos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantillas_documento    ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantilla_versiones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_generados    ENABLE ROW LEVEL SECURITY;

-- Catálogos: lectura pública, escritura de quien gestiona el proceso.
DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vac_listas_opciones','ips','municipios_nomina','vac_empresa'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO anon, authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_write ON %I FOR ALL TO authenticated
      USING (public.auth_permiso('gestionar_postulaciones')) WITH CHECK (public.auth_permiso('gestionar_postulaciones'))$f$, t, t);
  END LOOP;
END $rls$;

-- Bitácora: el staff la lee; el candidato ve la suya (línea de tiempo de "mi proceso").
DROP POLICY IF EXISTS cand_eventos_read ON candidato_eventos;
CREATE POLICY cand_eventos_read ON candidato_eventos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones'])
         OR EXISTS (SELECT 1 FROM candidatos c WHERE c.id = candidato_id AND c.auth_uid = (SELECT auth.uid())));
DROP POLICY IF EXISTS cand_eventos_write ON candidato_eventos;
CREATE POLICY cand_eventos_write ON candidato_eventos FOR INSERT TO authenticated
  WITH CHECK (public.auth_permiso('gestionar_postulaciones'));

-- Observaciones y evaluaciones: solo staff.
DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['candidato_observaciones','candidato_evaluaciones'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_read ON %I FOR SELECT TO authenticated
      USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones']))$f$, t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_write ON %I FOR ALL TO authenticated
      USING (public.auth_permiso('gestionar_postulaciones')) WITH CHECK (public.auth_permiso('gestionar_postulaciones'))$f$, t, t);
  END LOOP;
END $rls$;

-- Requisiciones: permisos propios (ver / gestionar).
DROP POLICY IF EXISTS requisiciones_read ON requisiciones;
CREATE POLICY requisiciones_read ON requisiciones FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_requisiciones','gestionar_requisiciones','ver_postulaciones','gestionar_postulaciones']));
DROP POLICY IF EXISTS requisiciones_write ON requisiciones;
CREATE POLICY requisiciones_write ON requisiciones FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_requisiciones')) WITH CHECK (public.auth_permiso('gestionar_requisiciones'));

-- Pruebas: el catálogo (sin clave) lo lee cualquiera autenticado; la tabla con
-- la clave, solo el staff. Los intentos: el dueño los ve; los escribe el RPC.
DROP POLICY IF EXISTS pruebas_read ON pruebas;
CREATE POLICY pruebas_read ON pruebas FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS pruebas_write ON pruebas;
CREATE POLICY pruebas_write ON pruebas FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_postulaciones')) WITH CHECK (public.auth_permiso('gestionar_postulaciones'));
DROP POLICY IF EXISTS prueba_preguntas_staff ON prueba_preguntas;
CREATE POLICY prueba_preguntas_staff ON prueba_preguntas FOR ALL TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones']))
  WITH CHECK (public.auth_permiso('gestionar_postulaciones'));
DROP POLICY IF EXISTS prueba_intentos_read ON prueba_intentos;
CREATE POLICY prueba_intentos_read ON prueba_intentos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones'])
         OR EXISTS (SELECT 1 FROM candidatos c WHERE c.id = candidato_id AND c.auth_uid = (SELECT auth.uid())));

-- Plantillas: quien las ve / quien las gestiona. Los candidatos no las ven
-- (reciben el documento ya generado).
DROP POLICY IF EXISTS plantillas_doc_read ON plantillas_documento;
CREATE POLICY plantillas_doc_read ON plantillas_documento FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_plantillas_documento','gestionar_plantillas_documento','ver_postulaciones','gestionar_postulaciones']));
DROP POLICY IF EXISTS plantillas_doc_write ON plantillas_documento;
CREATE POLICY plantillas_doc_write ON plantillas_documento FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_plantillas_documento')) WITH CHECK (public.auth_permiso('gestionar_plantillas_documento'));
DROP POLICY IF EXISTS plantilla_versiones_read ON plantilla_versiones;
CREATE POLICY plantilla_versiones_read ON plantilla_versiones FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_plantillas_documento','gestionar_plantillas_documento','ver_postulaciones','gestionar_postulaciones']));
DROP POLICY IF EXISTS plantilla_versiones_write ON plantilla_versiones;
CREATE POLICY plantilla_versiones_write ON plantilla_versiones FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_plantillas_documento')) WITH CHECK (public.auth_permiso('gestionar_plantillas_documento'));

-- Documentos generados: staff lee/escribe; el candidato lee los suyos (no
-- anulados) y firma solo por el RPC.
DROP POLICY IF EXISTS docgen_read ON documentos_generados;
CREATE POLICY docgen_read ON documentos_generados FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones'])
         OR (estado <> 'ANULADO' AND EXISTS (SELECT 1 FROM candidatos c WHERE c.id = candidato_id AND c.auth_uid = (SELECT auth.uid()))));
DROP POLICY IF EXISTS docgen_write ON documentos_generados;
CREATE POLICY docgen_write ON documentos_generados FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_postulaciones')) WITH CHECK (public.auth_permiso('gestionar_postulaciones'));

-- Contratos: ahora son del ATS (antes colgaban del permiso de contratos de
-- conserjería, que es otro concepto: contratos de servicio con clientes).
DROP POLICY IF EXISTS contratos_staff ON contratos;
DROP POLICY IF EXISTS contratos_read ON contratos;
CREATE POLICY contratos_read ON contratos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones']));
DROP POLICY IF EXISTS contratos_write ON contratos;
CREATE POLICY contratos_write ON contratos FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_postulaciones')) WITH CHECK (public.auth_permiso('gestionar_postulaciones'));

-- Storage: el staff con permiso debe poder VER los documentos del candidato
-- (la política de lectura seguía atada a la lista de roles enum, que ya no es
-- la fuente de verdad) y subir por él ("cárgalos manualmente desde aquí").
DROP POLICY IF EXISTS rv_select ON storage.objects;
CREATE POLICY rv_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'registro-vacantes'
         AND (owner = (SELECT auth.uid()) OR public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones'])));
DROP POLICY IF EXISTS rv_insert ON storage.objects;
CREATE POLICY rv_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'registro-vacantes');
DROP POLICY IF EXISTS rv_update ON storage.objects;
CREATE POLICY rv_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'registro-vacantes' AND (owner = (SELECT auth.uid()) OR public.auth_permiso('gestionar_postulaciones')))
  WITH CHECK (bucket_id = 'registro-vacantes');

-- Bucket privado para los archivos originales de las plantillas (.doc/.docx/.xls).
INSERT INTO storage.buckets (id, name, public) VALUES ('plantillas-documentos', 'plantillas-documentos', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS plantillas_documentos_select ON storage.objects;
CREATE POLICY plantillas_documentos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plantillas-documentos'
         AND public.auth_permiso_any(ARRAY['ver_plantillas_documento','gestionar_plantillas_documento','gestionar_postulaciones']));
DROP POLICY IF EXISTS plantillas_documentos_insert_perm ON storage.objects;
CREATE POLICY plantillas_documentos_insert_perm ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plantillas-documentos' AND public.auth_permiso('gestionar_plantillas_documento'));
DROP POLICY IF EXISTS plantillas_documentos_update_perm ON storage.objects;
CREATE POLICY plantillas_documentos_update_perm ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plantillas-documentos' AND public.auth_permiso('gestionar_plantillas_documento'))
  WITH CHECK (bucket_id = 'plantillas-documentos' AND public.auth_permiso('gestionar_plantillas_documento'));
DROP POLICY IF EXISTS plantillas_documentos_delete_perm ON storage.objects;
CREATE POLICY plantillas_documentos_delete_perm ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plantillas-documentos' AND public.auth_permiso('gestionar_plantillas_documento'));

-- =============================================================================
-- 10. PERMISOS NUEVOS EN LOS ROLES QUE YA LLEVAN EL PROCESO
-- =============================================================================
UPDATE public.roles SET permisos = permisos || '{
  "ver_requisiciones": true, "gestionar_requisiciones": true,
  "ver_plantillas_documento": true, "gestionar_plantillas_documento": true
}'::jsonb
WHERE nombre IN ('Coordinador','Supervisor de Conserjería');

UPDATE public.roles SET permisos = permisos || '{
  "ver_requisiciones": true, "ver_plantillas_documento": true
}'::jsonb
WHERE nombre = 'Auditor';

-- =============================================================================
-- 11. VISTA DE BANDEJA: días en fase y completitud documental en una consulta
-- =============================================================================
CREATE OR REPLACE VIEW vw_ats_bandeja WITH (security_invoker = true) AS
SELECT
  c.id, c.estado, c.fase_desde,
  EXTRACT(DAY FROM (NOW() - c.fase_desde))::INT AS dias_en_fase,
  c.tipo_documento, c.numero_documento, c.nombres, c.apellidos, c.primer_nombre, c.segundo_nombre,
  c.primer_apellido, c.segundo_apellido, c.email, c.celular, c.fecha_nacimiento, c.genero,
  c.cargo_postulacion_id, cg.nombre AS cargo,
  c.municipio_trabajo, mt.nombre AS ciudad_trabajo,
  c.centro_costo_id, cc.codigo AS centro_costo,
  c.requisicion_id, r.numero AS requisicion,
  c.motivo_descarte, c.ips_nombre, c.ips_fecha_remision, c.antecedentes_resultado,
  c.ha_trabajado_antes, c.persona_id, c.foto_perfil_path, c.auth_uid,
  c.created_at, c.updated_at,
  (SELECT COUNT(*) FROM candidato_documentos d WHERE d.candidato_id = c.id) AS docs_total,
  (SELECT COUNT(*) FROM candidato_documentos d WHERE d.candidato_id = c.id AND d.estado = 'VALIDADO') AS docs_validados,
  (SELECT COUNT(*) FROM candidato_documentos d WHERE d.candidato_id = c.id AND d.estado = 'RECHAZADO') AS docs_rechazados,
  (SELECT COUNT(*) FROM prueba_intentos i WHERE i.candidato_id = c.id AND i.estado <> 'EN_CURSO') AS pruebas_presentadas,
  (SELECT i.puntaje || '/' || i.puntaje_max FROM prueba_intentos i JOIN pruebas p ON p.id = i.prueba_id
     WHERE i.candidato_id = c.id AND p.tipo = 'CONOCIMIENTOS' AND i.puntaje_max IS NOT NULL LIMIT 1) AS puntaje_conocimientos,
  (SELECT COUNT(*) FROM documentos_generados g WHERE g.candidato_id = c.id AND g.estado = 'PENDIENTE_FIRMA') AS docs_por_firmar,
  (SELECT COUNT(*) FROM documentos_generados g WHERE g.candidato_id = c.id AND g.estado = 'FIRMADO') AS docs_firmados,
  (SELECT k.codigo FROM contratos k WHERE k.candidato_id = c.id AND k.estado <> 'ANULADO' ORDER BY k.generado_at DESC LIMIT 1) AS contrato_codigo
FROM candidatos c
LEFT JOIN cargos cg ON cg.id = c.cargo_postulacion_id
LEFT JOIN municipios mt ON mt.codigo_dane = c.municipio_trabajo
LEFT JOIN centros_costo cc ON cc.id = c.centro_costo_id
LEFT JOIN requisiciones r ON r.id = c.requisicion_id
WHERE c.estado::text <> 'BORRADOR';

GRANT SELECT ON vw_ats_bandeja TO authenticated, service_role;
