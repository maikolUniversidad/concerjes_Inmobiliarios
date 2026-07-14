-- =============================================================================
-- SEED — Registro de Vacantes: catálogos base
-- =============================================================================
-- Idempotente (ON CONFLICT DO NOTHING). Los municipios cargan capitales +
-- ciudades principales como ARRANQUE; el listado DANE completo (~1.100) se
-- importará luego con la herramienta de cargue masivo o un archivo de datos.
-- =============================================================================

-- ── Departamentos (código DANE 2 dígitos) ────────────────────────────────────
INSERT INTO departamentos (codigo_dane, nombre) VALUES
  ('05','ANTIOQUIA'),('08','ATLÁNTICO'),('11','BOGOTÁ D.C.'),('13','BOLÍVAR'),
  ('15','BOYACÁ'),('17','CALDAS'),('18','CAQUETÁ'),('19','CAUCA'),('20','CESAR'),
  ('23','CÓRDOBA'),('25','CUNDINAMARCA'),('27','CHOCÓ'),('41','HUILA'),
  ('44','LA GUAJIRA'),('47','MAGDALENA'),('50','META'),('52','NARIÑO'),
  ('54','NORTE DE SANTANDER'),('63','QUINDÍO'),('66','RISARALDA'),
  ('68','SANTANDER'),('70','SUCRE'),('73','TOLIMA'),('76','VALLE DEL CAUCA'),
  ('81','ARAUCA'),('85','CASANARE'),('86','PUTUMAYO'),
  ('88','ARCHIPIÉLAGO DE SAN ANDRÉS'),('91','AMAZONAS'),('94','GUAINÍA'),
  ('95','GUAVIARE'),('97','VAUPÉS'),('99','VICHADA')
ON CONFLICT (codigo_dane) DO NOTHING;

-- ── Municipios: capitales + ciudades principales (arranque) ──────────────────
INSERT INTO municipios (codigo_dane, departamento_codigo, nombre) VALUES
  ('05001','05','MEDELLÍN'),('05088','05','BELLO'),('05360','05','ITAGÜÍ'),
  ('05266','05','ENVIGADO'),('05615','05','RIONEGRO'),('05631','05','SABANETA'),
  ('08001','08','BARRANQUILLA'),('08758','08','SOLEDAD'),('08573','08','PUERTO COLOMBIA'),
  ('08433','08','MALAMBO'),
  ('11001','11','BOGOTÁ D.C.'),
  ('13001','13','CARTAGENA'),('13430','13','MAGANGUÉ'),('13836','13','TURBACO'),
  ('15001','15','TUNJA'),('15238','15','DUITAMA'),('15759','15','SOGAMOSO'),
  ('17001','17','MANIZALES'),('17873','17','VILLAMARÍA'),
  ('18001','18','FLORENCIA'),
  ('19001','19','POPAYÁN'),
  ('20001','20','VALLEDUPAR'),
  ('23001','23','MONTERÍA'),('23417','23','LORICA'),
  ('25754','25','SOACHA'),('25290','25','FUSAGASUGÁ'),('25286','25','FUNZA'),
  ('25473','25','MOSQUERA'),('25126','25','CAJICÁ'),('25175','25','CHÍA'),
  ('25269','25','FACATATIVÁ'),('25899','25','ZIPAQUIRÁ'),('25430','25','MADRID'),
  ('27001','27','QUIBDÓ'),
  ('41001','41','NEIVA'),('41551','41','PITALITO'),
  ('44001','44','RIOHACHA'),('44430','44','MAICAO'),
  ('47001','47','SANTA MARTA'),('47189','47','CIÉNAGA'),
  ('50001','50','VILLAVICENCIO'),('50006','50','ACACÍAS'),
  ('52001','52','PASTO'),('52356','52','IPIALES'),
  ('54001','54','CÚCUTA'),('54874','54','VILLA DEL ROSARIO'),('54405','54','LOS PATIOS'),
  ('63001','63','ARMENIA'),
  ('66001','66','PEREIRA'),('66170','66','DOSQUEBRADAS'),
  ('68001','68','BUCARAMANGA'),('68276','68','FLORIDABLANCA'),('68307','68','GIRÓN'),
  ('68547','68','PIEDECUESTA'),('68081','68','BARRANCABERMEJA'),
  ('70001','70','SINCELEJO'),
  ('73001','73','IBAGUÉ'),('73268','73','ESPINAL'),
  ('76001','76','CALI'),('76520','76','PALMIRA'),('76892','76','YUMBO'),
  ('76109','76','BUENAVENTURA'),('76364','76','JAMUNDÍ'),('76834','76','TULUÁ'),
  ('81001','81','ARAUCA'),
  ('85001','85','YOPAL'),
  ('86001','86','MOCOA'),
  ('88001','88','SAN ANDRÉS'),
  ('91001','91','LETICIA'),
  ('94001','94','INÍRIDA'),
  ('95001','95','SAN JOSÉ DEL GUAVIARE'),
  ('97001','97','MITÚ'),
  ('99001','99','PUERTO CARREÑO')
ON CONFLICT (codigo_dane) DO NOTHING;

-- ── EPS vigentes ─────────────────────────────────────────────────────────────
INSERT INTO eps (nombre) VALUES
  ('NUEVA EPS'),('EPS SURA'),('EPS SANITAS'),('SALUD TOTAL EPS'),('COMPENSAR EPS'),
  ('FAMISANAR EPS'),('COOSALUD EPS'),('MUTUAL SER EPS'),('ALIANSALUD EPS'),
  ('SOS - SERVICIO OCCIDENTAL DE SALUD'),('COMFENALCO VALLE EPS'),('SAVIA SALUD EPS'),
  ('CAPITAL SALUD EPS'),('ASMET SALUD EPS'),('EMSSANAR EPS'),('CAJACOPI EPS'),
  ('COMFAORIENTE EPS'),('PIJAOS SALUD EPSI'),('DUSAKAWI EPSI')
ON CONFLICT (nombre) DO NOTHING;

-- ── AFP (fondos de pensión) ──────────────────────────────────────────────────
INSERT INTO afp (nombre) VALUES
  ('COLPENSIONES'),('PORVENIR'),('PROTECCIÓN'),('COLFONDOS'),('SKANDIA')
ON CONFLICT (nombre) DO NOTHING;

-- ── Cesantías ────────────────────────────────────────────────────────────────
INSERT INTO cesantias (nombre) VALUES
  ('PORVENIR'),('PROTECCIÓN'),('COLFONDOS'),('SKANDIA'),('FNA - FONDO NACIONAL DEL AHORRO')
ON CONFLICT (nombre) DO NOTHING;

-- ── Cajas de compensación (con departamento cuando aplica) ───────────────────
INSERT INTO cajas_compensacion (nombre, departamento_codigo) VALUES
  ('COMPENSAR','11'),('COLSUBSIDIO','11'),('CAFAM','11'),
  ('COMFAMA','05'),('COMFENALCO ANTIOQUIA','05'),
  ('COMFANDI','76'),('COMFENALCO VALLE','76'),
  ('CAJASAN','68'),('COMFENALCO SANTANDER','68'),
  ('COMBARRANQUILLA','08'),('COMFAMILIAR ATLÁNTICO','08'),
  ('COMFACOR','23'),('COMFACESAR','20'),('COMFANORTE','54'),
  ('COMFAMILIAR HUILA','41'),('COMFENALCO QUINDÍO','63'),('COMFAMILIAR RISARALDA','66'),
  ('COMFABOY','15'),('CONFA','17'),('CAFABA','68'),('COMFACA','18'),
  ('CAJACOPI ATLÁNTICO','08'),('COMFASUCRE','70'),('COMFAORIENTE','54')
ON CONFLICT DO NOTHING;

-- ── ARL ──────────────────────────────────────────────────────────────────────
INSERT INTO arl (nombre) VALUES
  ('ARL SURA'),('POSITIVA COMPAÑÍA DE SEGUROS'),('ARL COLMENA SEGUROS'),
  ('SEGUROS BOLÍVAR ARL'),('LA EQUIDAD SEGUROS ARL'),('MAPFRE ARL'),
  ('AXA COLPATRIA ARL'),('LIBERTY SEGUROS ARL')
ON CONFLICT (nombre) DO NOTHING;

-- ── Bancos ───────────────────────────────────────────────────────────────────
INSERT INTO bancos (nombre) VALUES
  ('BANCOLOMBIA'),('BANCO DE BOGOTÁ'),('DAVIVIENDA'),('BBVA COLOMBIA'),
  ('BANCO DE OCCIDENTE'),('BANCO POPULAR'),('SCOTIABANK COLPATRIA'),
  ('BANCO AV VILLAS'),('BANCO CAJA SOCIAL'),('BANCOOMEVA'),('BANCO AGRARIO'),
  ('ITAÚ'),('BANCO FALABELLA'),('BANCO PICHINCHA'),('BANCO GNB SUDAMERIS'),
  ('BANCO SERFINANZA'),('NEQUI'),('DAVIPLATA'),('LULO BANK'),('NU (NUBANK)'),('MOVII')
ON CONFLICT (nombre) DO NOTHING;

-- ── Cargos (operativos de aseo/cafetería/mantenimiento) ──────────────────────
INSERT INTO cargos (nombre, requiere_manipulacion_alimentos, requiere_trabajo_alturas) VALUES
  ('OPERARIO DE ASEO Y CAFETERÍA', true,  false),
  ('OPERARIO DE ASEO',             false, false),
  ('AUXILIAR DE CAFETERÍA',        true,  false),
  ('SERVICIOS GENERALES',          false, false),
  ('TODERO / MANTENIMIENTO',       false, true),
  ('OPERARIO DE MANTENIMIENTO',    false, true),
  ('JARDINERO',                    false, false),
  ('CONSERJE / PORTERÍA',          false, false),
  ('SUPERVISOR DE ASEO',           false, false),
  ('COORDINADOR OPERATIVO',        false, false)
ON CONFLICT DO NOTHING;

-- ── Parámetros legales por año ───────────────────────────────────────────────
-- ❗ VERIFICAR con el área jurídica/nómina antes de generar contratos.
--   2026 es PROVISIONAL (el decreto de SMLV se expide a cierre de año anterior).
INSERT INTO parametros_legales (anio, smlv, auxilio_transporte, uvt) VALUES
  (2024, 1300000, 162000, 47065),
  (2025, 1423500, 200000, 49799),
  (2026, 1623500, 231000, 53026)   -- ⚠️ PROVISIONAL — confirmar valores oficiales
ON CONFLICT (anio) DO NOTHING;

-- =============================================================================
-- SEED — Catálogo de tipos documentales (dos olas)
-- =============================================================================
-- ola 1 = registro público · ola 2 = preseleccionado (link privado con token)
INSERT INTO vac_tipos_documentales
  (codigo, nombre, grupo, obligatorio, min_archivos, max_archivos, vigencia_dias, requiere_ocr, aplica_si, ola, orden)
VALUES
  -- Grupo PERSONALES (ola 1)
  ('CEDULA',        'Cédula de ciudadanía / extranjería (ambas caras)', 'PERSONALES', true,  2, 2, NULL, true,  NULL, 1, 1),
  ('FOTO_CARNET',   'Foto tipo carnet (selfie)',                        'PERSONALES', true,  1, 1, NULL, false, NULL, 1, 2),
  ('LIBRETA_MILITAR','Libreta militar',                                 'PERSONALES', false, 1, 2, NULL, true,  '{"cargo.requiere_libreta_militar": true}', 1, 3),
  ('HOJA_VIDA',     'Hoja de vida (CV)',                                'PERSONALES', true,  1, 3, NULL, true,  NULL, 1, 4),
  ('PPT_PEP',       'PPT / PEP / visa (extranjeros)',                   'PERSONALES', false, 1, 2, NULL, true,  NULL, 1, 5),
  -- Grupo ESTUDIOS (ola 1)
  ('DIPLOMA',       'Diploma o acta de grado',                          'ESTUDIOS', true,  1, 3, NULL, true, NULL, 1, 10),
  ('CURSOS',        'Cursos activos',                                   'ESTUDIOS', false, 0, 10, NULL, true, NULL, 1, 11),
  ('CERT_ALIMENTOS','Certificado de manipulación de alimentos',         'ESTUDIOS', false, 1, 1, NULL, true, '{"cargo.requiere_manipulacion_alimentos": true}', 1, 12),
  ('CERT_ALTURAS',  'Certificado de trabajo en alturas',                'ESTUDIOS', false, 1, 1, NULL, true, '{"cargo.requiere_trabajo_alturas": true}', 1, 13),
  -- Grupo ANTECEDENTES (ola 1) — vigencia ≤ 30 días
  ('ANT_RNMC',      'Certificado RNMC',                                 'ANTECEDENTES', true, 1, 1, 30, true, NULL, 1, 20),
  ('ANT_POLICIA',   'Certificado Policía Nacional',                     'ANTECEDENTES', true, 1, 1, 30, true, NULL, 1, 21),
  ('ANT_CONTRALORIA','Certificado Contraloría',                         'ANTECEDENTES', true, 1, 1, 30, true, NULL, 1, 22),
  ('ANT_PROCURADURIA','Certificado Procuraduría',                       'ANTECEDENTES', true, 1, 1, 30, true, NULL, 1, 23),
  -- Grupo REFERENCIAS (ola 1)
  ('REF_LABORALES', 'Referencias laborales',                            'REFERENCIAS', true, 1, 5, NULL, false, NULL, 1, 30),
  ('REF_PERSONALES','Referencias personales',                           'REFERENCIAS', true, 1, 5, NULL, false, NULL, 1, 31),
  ('CERT_LABORALES','Certificados laborales anteriores',                'REFERENCIAS', false, 0, 10, NULL, false, NULL, 1, 32),
  -- Grupo VINCULACIÓN (ola 2 — preseleccionado)
  ('AFIL_EPS',      'Certificado de afiliación a EPS',                  'VINCULACION', true, 1, 1, NULL, true, NULL, 2, 40),
  ('AFIL_AFP',      'Certificado de afiliación a AFP / cesantías',      'VINCULACION', true, 1, 2, NULL, true, NULL, 2, 41),
  ('CERT_BANCARIA', 'Certificación bancaria',                          'VINCULACION', true, 1, 1, NULL, true, NULL, 2, 42),
  ('DOC_BENEF',     'Registro civil / TI de beneficiarios',            'VINCULACION', false, 0, 10, NULL, false, NULL, 2, 43),
  ('CONCEPTO_APTITUD','Concepto de aptitud médica ocupacional (solo el concepto)', 'VINCULACION', true, 1, 1, NULL, false, NULL, 2, 44)
ON CONFLICT (codigo) DO NOTHING;
