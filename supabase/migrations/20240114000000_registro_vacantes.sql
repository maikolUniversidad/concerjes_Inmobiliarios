-- =============================================================================
-- MÓDULO: REGISTRO DE VACANTES  (contratación / ATS público)
-- =============================================================================
-- Fase 1 — FUNDACIÓN: modelo de datos + catálogos + consentimientos + docs
--   multi-archivo + pgvector (listo pero vacío) + RLS público/anónimo.
--   La generación de contratos (paquete de 18 PDFs) queda para una fase
--   posterior; la tabla `contratos` se crea aquí solo como esqueleto.
--
-- Convenciones:
--   • Reutiliza `empresas_usuarias` como CLIENTE de la obra (no se crea `clientes`).
--   • El tipo documental de este módulo se llama `vac_tipos_documentales` para
--     NO colisionar con la tabla `tipos_documentales` (árbol) de Gestión Humana.
--   • El candidato público se autentica con SESIÓN ANÓNIMA de Supabase; su
--     `auth.uid()` se guarda en `candidatos.auth_uid` para poder reanudar y para
--     que la RLS lo deje ver/editar SOLO su propio registro.
--   • Personal interno (RRHH) escribe vía `public.auth_rol()` (SECURITY DEFINER).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- ENUMS
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE tipo_doc_vac AS ENUM ('CC','CE','PPT','PEP','PASAPORTE','CEDULA_DIGITAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_candidato AS ENUM (
    'BORRADOR','POSTULADO','EN_VERIFICACION','PRESELECCIONADO','EXAMEN_MEDICO',
    'APTO','NO_APTO','CONTRATADO','ACTIVO','RETIRADO','RECHAZADO','DESISTIO','BANCO_TALENTO'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_doc_vac AS ENUM ('PENDIENTE','CARGADO','EN_VALIDACION','VALIDADO','RECHAZADO','VENCIDO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- CATÁLOGOS  (tablas, no enums hardcodeados)
-- =============================================================================

-- ── DANE: departamentos y municipios ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departamentos (
  codigo_dane TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS municipios (
  codigo_dane        TEXT PRIMARY KEY,
  departamento_codigo TEXT NOT NULL REFERENCES departamentos(codigo_dane) ON DELETE CASCADE,
  nombre             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_municipios_depto ON municipios(departamento_codigo);

-- ── Catálogos de seguridad social y nómina ──────────────────────────────────
CREATE TABLE IF NOT EXISTS eps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE, codigo TEXT, activo BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS afp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE, codigo TEXT, activo BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS cesantias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE, codigo TEXT, activo BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS cajas_compensacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL, codigo TEXT,
  departamento_codigo TEXT REFERENCES departamentos(codigo_dane),
  activo BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS arl (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE, codigo TEXT, activo BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS bancos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE, codigo TEXT, activo BOOLEAN DEFAULT true
);

-- ── Parámetros legales por año de vigencia (SMLV, auxilio, UVT) ──────────────
CREATE TABLE IF NOT EXISTS parametros_legales (
  anio               INT PRIMARY KEY,
  smlv               NUMERIC NOT NULL,
  auxilio_transporte NUMERIC NOT NULL,
  uvt                NUMERIC NOT NULL
);

-- ── Cargos ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cargos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  manual_funciones_url TEXT,
  requiere_manipulacion_alimentos BOOLEAN DEFAULT false,
  requiere_trabajo_alturas        BOOLEAN DEFAULT false,
  requiere_libreta_militar        BOOLEAN DEFAULT false,
  activo BOOLEAN DEFAULT true
);

-- ── Obras / labor (vinculadas a un CLIENTE = empresas_usuarias) ──────────────
-- Ley 2466/2025: la descripción de la obra debe ser PRECISA y DETALLADA.
CREATE TABLE IF NOT EXISTS obras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES empresas_usuarias(id) ON DELETE RESTRICT,
  codigo_contrato_servicio TEXT NOT NULL,           -- 'CMM-2026-000029'
  descripcion_detallada TEXT NOT NULL,              -- ⚠️ Ley 2466/2025
  fecha_inicio DATE,
  fecha_fin_estimada DATE,
  duracion_estimada_meses INT,
  ciudad_codigo_dane TEXT REFERENCES municipios(codigo_dane),
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- La labor debe describirse de forma precisa y detallada (≥ 200 caracteres).
  CONSTRAINT ck_obra_descripcion_detallada CHECK (char_length(descripcion_detallada) >= 200)
);

-- ── Vacantes (cupos por obra + cargo, con link público) ──────────────────────
CREATE TABLE IF NOT EXISTS vacantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id  UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  cargo_id UUID NOT NULL REFERENCES cargos(id),
  cupos INT NOT NULL DEFAULT 1,
  cupos_ocupados INT NOT NULL DEFAULT 0,
  slug TEXT UNIQUE,                                  -- link público directo
  abierta BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CANDIDATOS  (núcleo — secciones 1–8 del formulario)
-- =============================================================================
CREATE TABLE IF NOT EXISTS candidatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Propiedad de la sesión anónima del candidato (para reanudar + RLS).
  auth_uid UUID,
  -- Enlace opcional al colaborador cuando sea CONTRATADO (Gestión Humana).
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,

  -- Sección 1 · Identificación
  tipo_documento tipo_doc_vac NOT NULL DEFAULT 'CC',
  numero_documento TEXT NOT NULL,
  fecha_expedicion_doc DATE,
  lugar_expedicion_doc TEXT,
  nombres TEXT,
  apellidos TEXT,
  fecha_nacimiento DATE,
  nacionalidad TEXT NOT NULL DEFAULT 'COLOMBIANA',
  pais_nacimiento TEXT,
  departamento_nacimiento TEXT REFERENCES departamentos(codigo_dane),
  municipio_nacimiento    TEXT REFERENCES municipios(codigo_dane),
  genero TEXT,
  estado_civil TEXT,
  grupo_sanguineo TEXT,
  nivel_escolaridad TEXT,
  libreta_militar_tipo TEXT,
  libreta_militar_numero TEXT,
  distrito_militar TEXT,

  -- Sección 2 · Contacto (la dirección vigente vive en candidato_direcciones)
  email TEXT,
  email_verificado BOOLEAN DEFAULT false,
  celular TEXT,
  celular_verificado BOOLEAN DEFAULT false,
  telefono_alterno TEXT,
  contacto_emergencia_nombre TEXT,
  contacto_emergencia_parentesco TEXT,
  contacto_emergencia_telefono TEXT,
  departamento_trabajo TEXT REFERENCES departamentos(codigo_dane),
  municipio_trabajo    TEXT REFERENCES municipios(codigo_dane),

  -- Sección 3 · Seguridad social y nómina
  eps_id UUID REFERENCES eps(id),
  afp_id UUID REFERENCES afp(id),
  cesantias_id UUID REFERENCES cesantias(id),
  ccf_id UUID REFERENCES cajas_compensacion(id),
  es_pensionado BOOLEAN DEFAULT false,
  banco_id UUID REFERENCES bancos(id),
  tipo_cuenta TEXT,
  numero_cuenta TEXT,
  cuenta_propia BOOLEAN,

  -- Sección 4 · Experiencia y postulación
  experiencia_anios INT,
  experiencia_meses INT,
  cargo_postulacion_id UUID REFERENCES cargos(id),
  experiencia_cargo_anios INT,
  disponibilidad_jornada TEXT[],
  fecha_disponible DATE,
  se_puede_desplazar BOOLEAN,
  aspiracion_salarial NUMERIC,
  fuente_reclutamiento TEXT,
  referido_por TEXT,

  -- Sección 5 · Dotación (Ley 11/1984)
  talla_camisa TEXT, talla_pantalon TEXT, talla_calzado TEXT, talla_chaqueta TEXT,

  -- Sección 6 · Grupo familiar
  tiene_personas_a_cargo BOOLEAN,
  conyuge_trabaja TEXT,                 -- SI | NO | NA

  -- Sección 7 · Encuesta sociodemográfica (SG-SST) — datos NO sensibles
  vivienda_tipo TEXT,
  estrato INT,
  tiempo_libre TEXT[],
  practica_deporte BOOLEAN,
  horas_sueno TEXT,

  -- Filtro (§6.0) + control
  ha_hecho_proceso_antes BOOLEAN,
  ha_trabajado_antes BOOLEAN,
  estado estado_candidato NOT NULL DEFAULT 'BORRADOR',
  paso_actual INT DEFAULT 0,            -- para reanudar el formulario
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_candidato_documento UNIQUE (tipo_documento, numero_documento),
  -- Mayor de edad: bloqueante SOLO cuando ya se capturó la fecha de nacimiento.
  CONSTRAINT ck_mayor_edad CHECK (
    fecha_nacimiento IS NULL OR fecha_nacimiento <= current_date - INTERVAL '18 years'
  )
);
CREATE INDEX IF NOT EXISTS idx_candidatos_auth_uid ON candidatos(auth_uid);
CREATE INDEX IF NOT EXISTS idx_candidatos_estado   ON candidatos(estado);
CREATE INDEX IF NOT EXISTS idx_candidatos_persona  ON candidatos(persona_id);

-- ── Direcciones VERSIONADAS (cláusula DÉCIMA PRIMERA / Art. 29 Ley 789/02) ────
CREATE TABLE IF NOT EXISTS candidato_direcciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  direccion TEXT NOT NULL,
  barrio TEXT,
  departamento_codigo TEXT REFERENCES departamentos(codigo_dane),
  municipio_codigo    TEXT REFERENCES municipios(codigo_dane),
  localidad TEXT,
  vigente_desde DATE NOT NULL DEFAULT current_date,
  vigente_hasta DATE,
  reportada_por TEXT
);
CREATE INDEX IF NOT EXISTS idx_direcciones_candidato ON candidato_direcciones(candidato_id, vigente_desde DESC);

-- ── Beneficiarios / grupo familiar ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beneficiarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  nombres TEXT NOT NULL, apellidos TEXT NOT NULL,
  parentesco TEXT NOT NULL,
  tipo_documento TEXT, numero_documento TEXT,
  fecha_nacimiento DATE
);
CREATE INDEX IF NOT EXISTS idx_beneficiarios_candidato ON beneficiarios(candidato_id);

-- =============================================================================
-- BIOMÉTRICO  (Ley 1581/2012 — dato sensible; se guarda el EMBEDDING, no la foto)
-- =============================================================================
CREATE TABLE IF NOT EXISTS registros_faciales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  modelo TEXT NOT NULL DEFAULT 'buffalo_l',
  modelo_version TEXT NOT NULL,
  calidad NUMERIC,
  liveness_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ultima_coincidencia TIMESTAMPTZ,
  purgar_despues_de DATE            -- retención 24 meses sin actividad (DECISIÓN 2 = B)
);
-- Índice HNSW para búsqueda 1:N por similitud coseno (a <50k registros basta).
CREATE INDEX IF NOT EXISTS idx_faciales_embedding
  ON registros_faciales USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_faciales_candidato ON registros_faciales(candidato_id);

CREATE TABLE IF NOT EXISTS intentos_identificacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resultado TEXT NOT NULL,          -- MATCH | DUDA | NO_MATCH | LIVENESS_FAIL | CALIDAD_BAJA
  score NUMERIC,
  candidato_id UUID REFERENCES candidatos(id) ON DELETE SET NULL,
  ip INET, user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CONSENTIMIENTOS  (la prueba de la autorización es carga del responsable)
-- =============================================================================
CREATE TABLE IF NOT EXISTS consentimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,               -- DATOS_PERSONALES | BIOMETRICO | ANTECEDENTES | ...
  otorgado BOOLEAN NOT NULL,
  texto_version TEXT NOT NULL,
  texto_hash TEXT NOT NULL,
  ip INET, user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revocado_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_consentimientos_candidato ON consentimientos(candidato_id, tipo);

-- =============================================================================
-- DOCUMENTOS  (N archivos por tipo documental)
-- =============================================================================
CREATE TABLE IF NOT EXISTS vac_tipos_documentales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  grupo TEXT NOT NULL,              -- PERSONALES | ESTUDIOS | ANTECEDENTES | REFERENCIAS | VINCULACION
  obligatorio BOOLEAN DEFAULT false,
  min_archivos INT DEFAULT 1,
  max_archivos INT DEFAULT 1,
  formatos_permitidos TEXT[] DEFAULT '{pdf,jpg,jpeg,png,heic}',
  vigencia_dias INT,               -- null = no vence
  requiere_ocr BOOLEAN DEFAULT false,
  aplica_si JSONB,                 -- {"cargo.requiere_manipulacion_alimentos": true}
  ola INT DEFAULT 1,               -- 1 = registro público, 2 = preseleccionado
  orden INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS candidato_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tipo_documental_id UUID NOT NULL REFERENCES vac_tipos_documentales(id),
  orden INT DEFAULT 1,             -- 1 = frente, 2 = reverso, ...
  storage_path TEXT NOT NULL,
  nombre_original TEXT,
  mime TEXT, tamano_bytes BIGINT,
  sha256 TEXT NOT NULL,
  estado estado_doc_vac DEFAULT 'CARGADO',
  motivo_rechazo TEXT,
  ocr_resultado JSONB,
  ocr_confianza NUMERIC,
  fecha_expedicion_detectada DATE,
  vence_el DATE,                   -- se calcula en trigger según vigencia_dias
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candocs_candidato ON candidato_documentos(candidato_id);
CREATE INDEX IF NOT EXISTS idx_candocs_sha256    ON candidato_documentos(sha256);  -- duplicados / fraude

-- =============================================================================
-- POSTULACIONES y CONTRATOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS postulaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  vacante_id UUID REFERENCES vacantes(id) ON DELETE SET NULL,
  cargo_postulacion_id UUID REFERENCES cargos(id),
  estado estado_candidato NOT NULL DEFAULT 'POSTULADO',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_postulaciones_candidato ON postulaciones(candidato_id);
CREATE INDEX IF NOT EXISTS idx_postulaciones_vacante   ON postulaciones(vacante_id);

-- Esqueleto: se completa en la fase de generación de contratos.
CREATE TABLE IF NOT EXISTS contratos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,             -- CONS20260603-001
  candidato_id UUID NOT NULL REFERENCES candidatos(id),
  postulacion_id UUID REFERENCES postulaciones(id),
  obra_id UUID NOT NULL REFERENCES obras(id),
  cargo_id UUID NOT NULL REFERENCES cargos(id),
  fecha_inicio_labores DATE NOT NULL,
  modalidad_salarial TEXT NOT NULL,
  salario NUMERIC NOT NULL,
  incluye_auxilio_transporte BOOLEAN NOT NULL,
  pactos_no_salariales TEXT[],
  periodo_pago TEXT NOT NULL,
  lugar_labores TEXT NOT NULL,
  ciudad_contratacion TEXT NOT NULL,
  periodo_prueba_dias INT NOT NULL,
  modalidad_jornada TEXT NOT NULL,
  testigo1_nombre TEXT, testigo1_documento TEXT,
  testigo2_nombre TEXT, testigo2_documento TEXT,
  ciudad_firma TEXT, fecha_firma DATE,
  template_version TEXT NOT NULL,
  pdf_path TEXT, pdf_sha256 TEXT,
  metodo_firma TEXT DEFAULT 'MANUSCRITA',  -- DECISIÓN 6 = A (impresión ahora)
  evidencia_firma JSONB,                   -- puerta abierta a firma electrónica
  generado_por UUID, generado_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consecutivo de contrato: NUNCA COUNT(*)+1 (colisiona en concurrencia).
CREATE SEQUENCE IF NOT EXISTS contrato_consecutivo_seq;

-- =============================================================================
-- AUDITORÍA del módulo (acceso a documentos y a datos biométricos)
-- =============================================================================
CREATE TABLE IF NOT EXISTS vac_auditoria (
  id BIGSERIAL PRIMARY KEY,
  actor UUID, actor_tipo TEXT,
  accion TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id UUID,
  antes JSONB, despues JSONB,
  ip INET, user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- TRIGGERS
-- =============================================================================
-- updated_at en candidatos (usa la función global set_updated_at del init)
DROP TRIGGER IF EXISTS tr_candidatos_upd ON candidatos;
CREATE TRIGGER tr_candidatos_upd BEFORE UPDATE ON candidatos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- vence_el = fecha_expedicion_detectada + vigencia_dias del tipo documental
CREATE OR REPLACE FUNCTION public.vac_set_vence_el()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_dias INT;
BEGIN
  SELECT vigencia_dias INTO v_dias FROM vac_tipos_documentales WHERE id = NEW.tipo_documental_id;
  IF v_dias IS NOT NULL AND NEW.fecha_expedicion_detectada IS NOT NULL THEN
    NEW.vence_el := NEW.fecha_expedicion_detectada + (v_dias || ' days')::interval;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tr_candocs_vence ON candidato_documentos;
CREATE TRIGGER tr_candocs_vence BEFORE INSERT OR UPDATE ON candidato_documentos
  FOR EACH ROW EXECUTE FUNCTION public.vac_set_vence_el();

-- =============================================================================
-- RPC: búsqueda facial 1:N por similitud coseno (SECURITY DEFINER)
-- =============================================================================
-- Devuelve los candidatos más cercanos a un embedding. La decisión
-- MATCH/DUDA/NO_MATCH se toma en la capa de aplicación con umbrales por env.
CREATE OR REPLACE FUNCTION public.vac_buscar_rostro(p_embedding vector(512), p_limite INT DEFAULT 5)
RETURNS TABLE (candidato_id UUID, similitud NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rf.candidato_id, (1 - (rf.embedding <=> p_embedding))::numeric AS similitud
  FROM registros_faciales rf
  ORDER BY rf.embedding <=> p_embedding
  LIMIT GREATEST(1, p_limite)
$$;
REVOKE ALL ON FUNCTION public.vac_buscar_rostro(vector, INT) FROM PUBLIC, anon, authenticated;
-- Solo el rol de servicio (API del microservicio facial) puede invocarla.
GRANT EXECUTE ON FUNCTION public.vac_buscar_rostro(vector, INT) TO service_role;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE departamentos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE eps                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE afp                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cesantias              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cajas_compensacion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE arl                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bancos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_legales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacantes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidatos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_direcciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_faciales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE intentos_identificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimientos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vac_tipos_documentales ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_documentos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE postulaciones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vac_auditoria          ENABLE ROW LEVEL SECURITY;

-- Helper: ¿el usuario actual es personal interno (RRHH/admin)?
--   auth_rol() devuelve NULL para la sesión anónima del candidato.
-- ── Catálogos: lectura pública (anon + authenticated), escritura personal ────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departamentos','municipios','eps','afp','cesantias','cajas_compensacion',
    'arl','bancos','parametros_legales','cargos','vac_tipos_documentales'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON %I FOR SELECT TO anon, authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_write ON %I FOR ALL TO authenticated
      USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
      WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))$f$, t, t);
  END LOOP;
END $$;

-- ── Obras / vacantes: lectura pública (para el link de vacante), escritura RRHH
DROP POLICY IF EXISTS obras_read ON obras;
CREATE POLICY obras_read ON obras FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS obras_write ON obras;
CREATE POLICY obras_write ON obras FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS vacantes_read ON vacantes;
CREATE POLICY vacantes_read ON vacantes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS vacantes_write ON vacantes;
CREATE POLICY vacantes_write ON vacantes FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- ── Candidatos: el dueño (sesión anónima) crea/ve/edita SOLO lo suyo ─────────
DROP POLICY IF EXISTS candidatos_owner_ins ON candidatos;
CREATE POLICY candidatos_owner_ins ON candidatos FOR INSERT TO authenticated
  WITH CHECK (auth_uid = (SELECT auth.uid()));
DROP POLICY IF EXISTS candidatos_owner_sel ON candidatos;
CREATE POLICY candidatos_owner_sel ON candidatos FOR SELECT TO authenticated
  USING (auth_uid = (SELECT auth.uid()) OR public.auth_rol() IS NOT NULL);
DROP POLICY IF EXISTS candidatos_owner_upd ON candidatos;
CREATE POLICY candidatos_owner_upd ON candidatos FOR UPDATE TO authenticated
  USING (auth_uid = (SELECT auth.uid()) OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (auth_uid = (SELECT auth.uid()) OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS candidatos_staff_del ON candidatos;
CREATE POLICY candidatos_staff_del ON candidatos FOR DELETE TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- ── Tablas hijas: acceso si el candidato padre es del usuario (o es RRHH) ────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'candidato_direcciones','beneficiarios','consentimientos','candidato_documentos','postulaciones'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_owner ON %I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id
                     AND (c.auth_uid = (SELECT auth.uid()) OR public.auth_rol() IS NOT NULL)))
      WITH CHECK (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id
                     AND (c.auth_uid = (SELECT auth.uid()) OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))))$f$,
      t, t, t, t);
  END LOOP;
END $$;

-- ── Biométrico: NADIE por RLS de cliente. Solo service_role (bypassa RLS). ───
-- No se crean políticas permisivas → el candidato anónimo NO puede leer/escribir
-- embeddings; el enrolamiento y la búsqueda pasan por el microservicio (service role).
DROP POLICY IF EXISTS faciales_staff ON registros_faciales;
CREATE POLICY faciales_staff ON registros_faciales FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS intentos_staff ON intentos_identificacion;
CREATE POLICY intentos_staff ON intentos_identificacion FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- ── Contratos y auditoría: solo personal interno ─────────────────────────────
DROP POLICY IF EXISTS contratos_staff ON contratos;
CREATE POLICY contratos_staff ON contratos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS auditoria_staff ON vac_auditoria;
CREATE POLICY auditoria_staff ON vac_auditoria FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- =============================================================================
-- STORAGE — bucket PRIVADO para documentos del candidato
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('registro-vacantes', 'registro-vacantes', false)
ON CONFLICT (id) DO NOTHING;

-- El candidato sube/lee SOLO sus propios objetos (owner = auth.uid());
-- el personal interno accede a todo (auth_rol() no nulo). Nunca URL pública.
DROP POLICY IF EXISTS "rv_insert" ON storage.objects;
CREATE POLICY "rv_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'registro-vacantes' AND owner = (SELECT auth.uid()));
DROP POLICY IF EXISTS "rv_select" ON storage.objects;
CREATE POLICY "rv_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'registro-vacantes'
         AND (owner = (SELECT auth.uid()) OR public.auth_rol() IS NOT NULL));
DROP POLICY IF EXISTS "rv_delete" ON storage.objects;
CREATE POLICY "rv_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'registro-vacantes'
         AND (owner = (SELECT auth.uid()) OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN')));
