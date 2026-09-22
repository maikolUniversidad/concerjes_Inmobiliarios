-- =============================================================================
-- Directorio de correos: a quién le escribe la plataforma
--
-- · Centros médicos (IPS): la tabla `ips` que usa la remisión del expediente,
--   ahora con correos en copia, persona de contacto y notas.
-- · Listas de distribución (Selección, Nómina, Seguridad…): contactos con su
--   correo y sus copias. Los pasos de correo de los flujos les escriben
--   eligiendo la lista (`destinatarios.listas`), o al centro médico que trae el
--   evento (`destinatarios.entidades = ["ips"]`).
-- · Plantillas y flujos del proceso de selección que usan el directorio.
--
-- Los datos se cargan con lo que ya tenía la plataforma (IPS, correos de la
-- empresa). Idempotente: se puede volver a correr sin duplicar.
-- =============================================================================

-- 0. Validación de correos ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.correo_valido(p TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT p IS NULL OR p ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$fn$;

CREATE OR REPLACE FUNCTION public.correos_validos(p TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(bool_and(public.correo_valido(x)), true) FROM unnest(p) AS x
$fn$;

-- 1. Centros médicos (IPS) -----------------------------------------------------
ALTER TABLE ips ADD COLUMN IF NOT EXISTS correos_copia TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ips ADD COLUMN IF NOT EXISTS contacto      TEXT;
ALTER TABLE ips ADD COLUMN IF NOT EXISTS notas         TEXT;
ALTER TABLE ips ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();
DO $$ BEGIN
  ALTER TABLE ips ADD CONSTRAINT ips_correos_ok
    CHECK (public.correo_valido(correo) AND public.correos_validos(correos_copia));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS tr_ips_upd ON ips;
CREATE TRIGGER tr_ips_upd BEFORE UPDATE ON ips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP POLICY IF EXISTS ips_write ON ips;
CREATE POLICY ips_write ON ips FOR ALL TO authenticated
  USING (public.auth_permiso_any(ARRAY['gestionar_directorio_correos', 'gestionar_postulaciones']))
  WITH CHECK (public.auth_permiso_any(ARRAY['gestionar_directorio_correos', 'gestionar_postulaciones']));

-- Los correos de la empresa (selección, datos personales, nómina) también se
-- editan desde el directorio.
DROP POLICY IF EXISTS vac_empresa_write ON vac_empresa;
CREATE POLICY vac_empresa_write ON vac_empresa FOR ALL TO authenticated
  USING (public.auth_permiso_any(ARRAY['gestionar_directorio_correos', 'gestionar_postulaciones']))
  WITH CHECK (public.auth_permiso_any(ARRAY['gestionar_directorio_correos', 'gestionar_postulaciones']));

-- 2. Listas de distribución --------------------------------------------------
CREATE TABLE IF NOT EXISTS directorio_listas (
  codigo      VARCHAR(60) PRIMARY KEY,
  nombre      VARCHAR(150) NOT NULL,
  descripcion TEXT,
  uso         TEXT,                                -- para qué la usa la plataforma
  orden       INT NOT NULL DEFAULT 100,
  activo      BOOLEAN NOT NULL DEFAULT true,
  es_sistema  BOOLEAN NOT NULL DEFAULT false,      -- la usa un flujo sembrado: no se borra
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS tr_directorio_listas_upd ON directorio_listas;
CREATE TRIGGER tr_directorio_listas_upd BEFORE UPDATE ON directorio_listas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS directorio_contactos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_codigo  VARCHAR(60) NOT NULL REFERENCES directorio_listas(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  nombre        VARCHAR(150) NOT NULL,             -- persona o buzón
  cargo         VARCHAR(150),                      -- cargo o área
  correo        VARCHAR(200),                      -- sin correo no recibe (queda pendiente)
  correos_copia TEXT[] NOT NULL DEFAULT '{}',      -- van en copia del mismo correo
  telefono      VARCHAR(80),
  notas         TEXT,
  activo        BOOLEAN NOT NULL DEFAULT true,
  orden         INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT directorio_contactos_correos_ok
    CHECK (public.correo_valido(correo) AND public.correos_validos(correos_copia))
);
CREATE INDEX IF NOT EXISTS idx_directorio_contactos_lista ON directorio_contactos(lista_codigo, orden);
DROP TRIGGER IF EXISTS tr_directorio_contactos_upd ON directorio_contactos;
CREATE TRIGGER tr_directorio_contactos_upd BEFORE UPDATE ON directorio_contactos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE directorio_listas ENABLE ROW LEVEL SECURITY;
ALTER TABLE directorio_contactos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS directorio_listas_read ON directorio_listas;
CREATE POLICY directorio_listas_read ON directorio_listas FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_directorio_correos', 'gestionar_directorio_correos',
                                       'ver_flujos_notificacion', 'gestionar_flujos_notificacion']));
DROP POLICY IF EXISTS directorio_listas_write ON directorio_listas;
CREATE POLICY directorio_listas_write ON directorio_listas FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_directorio_correos'))
  WITH CHECK (public.auth_permiso('gestionar_directorio_correos'));

DROP POLICY IF EXISTS directorio_contactos_read ON directorio_contactos;
CREATE POLICY directorio_contactos_read ON directorio_contactos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_directorio_correos', 'gestionar_directorio_correos',
                                       'ver_flujos_notificacion', 'gestionar_flujos_notificacion']));
DROP POLICY IF EXISTS directorio_contactos_write ON directorio_contactos;
CREATE POLICY directorio_contactos_write ON directorio_contactos FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_directorio_correos'))
  WITH CHECK (public.auth_permiso('gestionar_directorio_correos'));

-- Listas con los datos que ya tenía la plataforma.
INSERT INTO directorio_listas (codigo, nombre, descripcion, uso, orden, es_sistema) VALUES
  ('SELECCION', 'Selección y Gestión Humana', 'Equipo que lleva el proceso de selección y contratación.',
   'Recibe el aviso cuando un candidato termina las pruebas de selección.', 10, true),
  ('NOMINA', 'Nómina', 'Área que afilia y carga en WO a los nuevos ingresos.',
   'Recibe el aviso de cada contratación (entrega a nómina).', 20, true),
  ('SEGURIDAD', 'Estudios de seguridad', 'Quien hace el estudio de seguridad AAA y la verificación de antecedentes.',
   'Disponible para flujos; todavía no tiene envíos automáticos.', 30, false)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO directorio_contactos (lista_codigo, nombre, cargo, correo, telefono, orden)
SELECT 'SELECCION', 'Buzón de selección', 'Selección', e.correo_seleccion, e.telefono, 1
  FROM vac_empresa e
 WHERE e.id = 1 AND public.correo_valido(e.correo_seleccion) AND e.correo_seleccion IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM directorio_contactos WHERE lista_codigo = 'SELECCION');

-- El nombre de la persona de nómina se toma de la base (no se escribe aquí).
INSERT INTO directorio_contactos (lista_codigo, nombre, cargo, correo, telefono, notas, orden)
SELECT 'NOMINA', COALESCE(NULLIF(btrim(e.contacto_nomina), ''), 'Nómina'), 'Nómina', NULL, e.telefono_nomina,
       'Falta el correo: sin él no le llegan los avisos de ingreso.', 1
  FROM vac_empresa e
 WHERE e.id = 1
   AND NOT EXISTS (SELECT 1 FROM directorio_contactos WHERE lista_codigo = 'NOMINA');

-- 3. Permisos ----------------------------------------------------------------
UPDATE public.roles SET permisos = permisos || '{"ver_directorio_correos": true, "gestionar_directorio_correos": true}'::jsonb
 WHERE nombre IN ('Coordinador', 'Supervisor de Conserjería');
UPDATE public.roles SET permisos = permisos || '{"ver_directorio_correos": true}'::jsonb
 WHERE nombre = 'Auditor';

-- 4. ¿Hay con qué enviar? -----------------------------------------------------
-- El motor de flujos no encola correos si no hay cuenta: así no salen avisos
-- viejos (remisiones de hace semanas) el día que se conecte la cuenta.
-- SECURITY DEFINER: responde sí/no sin exponer la configuración de la cuenta.
CREATE OR REPLACE FUNCTION public.correo_envio_configurado() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM integraciones_correo
     WHERE envio_activo
       AND COALESCE(smtp_host, '') <> '' AND COALESCE(from_email, '') <> ''
       AND CASE WHEN auth_tipo = 'OAUTH2'
                THEN COALESCE(oauth_refresh_token, '') <> '' AND COALESCE(oauth_client_id, '') <> ''
                     AND COALESCE(oauth_client_secret, '') <> ''
                ELSE COALESCE(smtp_user, '') <> '' AND COALESCE(smtp_pass, '') <> '' END
  )
$fn$;
REVOKE ALL ON FUNCTION public.correo_envio_configurado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correo_envio_configurado() TO authenticated, service_role;

-- 5. Catálogo de eventos del proceso de selección: campos y ejemplo ----------
-- (el editor de flujos los muestra y "Probar flujo" usa el ejemplo; datos ficticios)
UPDATE eventos_notificacion SET
  variables = '[
    {"clave":"candidato_nombre","descripcion":"Nombre del aspirante"},
    {"clave":"tipo_documento","descripcion":"Tipo de documento"},
    {"clave":"documento","descripcion":"Número de documento"},
    {"clave":"fecha_nacimiento","descripcion":"Fecha de nacimiento"},
    {"clave":"celular","descripcion":"Celular del aspirante"},
    {"clave":"candidato_email","descripcion":"Correo del aspirante"},
    {"clave":"cargo","descripcion":"Cargo al que aspira"},
    {"clave":"eps","descripcion":"EPS"},
    {"clave":"afp","descripcion":"Fondo de pensiones"},
    {"clave":"trabajo_alturas","descripcion":"¿El cargo exige trabajo en alturas? (Sí/No)"},
    {"clave":"manipulacion_alimentos","descripcion":"¿El cargo manipula alimentos? (Sí/No)"},
    {"clave":"observaciones","descripcion":"Observaciones de RRHH para la IPS"},
    {"clave":"ips_id","descripcion":"Centro médico del directorio"},
    {"clave":"ips","descripcion":"Nombre del centro médico (IPS)"},
    {"clave":"ips_correo","descripcion":"Correo del centro médico"},
    {"clave":"fecha_remision","descripcion":"Fecha de la remisión"},
    {"clave":"remitido_por","descripcion":"Quién remitió"},
    {"clave":"empresa","descripcion":"Razón social de la empresa"},
    {"clave":"empresa_nit","descripcion":"NIT de la empresa"},
    {"clave":"correo_respuesta","descripcion":"Correo al que la IPS envía el concepto"}
  ]'::jsonb,
  payload_ejemplo = '{
    "candidato_id":"00000000-0000-0000-0000-000000000000","candidato_nombre":"LAURA MARCELA RÍOS PEÑA",
    "tipo_documento":"CC","documento":"1000123456","fecha_nacimiento":"15/03/1992","celular":"3000000010",
    "candidato_email":"laura.rios@example.com","cargo":"OPERARIO ASEO Y CAFETERIA","eps":"EPS DE EJEMPLO","afp":"FONDO DE EJEMPLO",
    "trabajo_alturas":"No","manipulacion_alimentos":"Sí","observaciones":"",
    "ips_id":null,"ips":"IPS DE EJEMPLO","ips_correo":"ips@example.com",
    "fecha_remision":"22/09/2026","remitido_por":"Analista de selección",
    "empresa":"CONSERJES INMOBILIARIOS LTDA","empresa_nit":"800.093.388-2","correo_respuesta":"seleccion@example.com"
  }'::jsonb
 WHERE codigo = 'ATS_REMISION_IPS';

UPDATE eventos_notificacion SET
  variables = '[
    {"clave":"candidato_nombre","descripcion":"Nombre del candidato"},
    {"clave":"candidato_email","descripcion":"Correo del candidato"},
    {"clave":"documento_nombre","descripcion":"Qué se generó (p. ej. 5 documento(s) de contratación)"},
    {"clave":"enlace","descripcion":"Enlace a Mi proceso para firmar"}
  ]'::jsonb,
  payload_ejemplo = '{"candidato_id":"00000000-0000-0000-0000-000000000000","candidato_nombre":"LAURA MARCELA RÍOS PEÑA",
    "candidato_email":"laura.rios@example.com","documento_nombre":"5 documento(s) de contratación",
    "enlace":"https://concerjes-inmobiliarios-inventario.vercel.app/registro-vacantes/mi-proceso"}'::jsonb
 WHERE codigo = 'ATS_DOCUMENTO_PARA_FIRMA';

UPDATE eventos_notificacion SET
  variables = '[
    {"clave":"candidato_nombre","descripcion":"Nombre del nuevo trabajador"},
    {"clave":"documento","descripcion":"Número de documento"},
    {"clave":"cargo","descripcion":"Cargo"},
    {"clave":"centro_costo","descripcion":"Código del centro de costo"},
    {"clave":"fecha_ingreso","descripcion":"Fecha de inicio de labores"}
  ]'::jsonb,
  payload_ejemplo = '{"candidato_id":"00000000-0000-0000-0000-000000000000","candidato_nombre":"LAURA MARCELA RÍOS PEÑA",
    "documento":"1000123456","cargo":"OPERARIO ASEO Y CAFETERIA","centro_costo":"CC-EJEMPLO","fecha_ingreso":"2026-10-01"}'::jsonb
 WHERE codigo = 'ATS_CONTRATADO';

UPDATE eventos_notificacion SET
  variables = '[
    {"clave":"candidato_nombre","descripcion":"Nombre del candidato"},
    {"clave":"candidato_email","descripcion":"Correo del candidato"},
    {"clave":"puntaje","descripcion":"Puntaje de la prueba de conocimientos"}
  ]'::jsonb,
  payload_ejemplo = '{"candidato_id":"00000000-0000-0000-0000-000000000000","candidato_nombre":"LAURA MARCELA RÍOS PEÑA",
    "candidato_email":"laura.rios@example.com","puntaje":5}'::jsonb
 WHERE codigo = 'ATS_PRUEBAS_COMPLETADAS';

UPDATE eventos_notificacion SET
  variables = '[
    {"clave":"candidato_nombre","descripcion":"Nombre del candidato"},
    {"clave":"candidato_email","descripcion":"Correo del candidato"},
    {"clave":"documento","descripcion":"Número de documento"},
    {"clave":"de_estado","descripcion":"Fase anterior (código)"},
    {"clave":"a_estado","descripcion":"Fase nueva (código)"},
    {"clave":"motivo","descripcion":"Motivo de descarte, si aplica"}
  ]'::jsonb,
  payload_ejemplo = '{"candidato_id":"00000000-0000-0000-0000-000000000000","candidato_nombre":"LAURA MARCELA RÍOS PEÑA",
    "candidato_email":"laura.rios@example.com","documento":"1000123456","de_estado":"EN_VERIFICACION","a_estado":"ENTREVISTA","motivo":null}'::jsonb
 WHERE codigo IN ('ATS_CAMBIO_ESTADO', 'ATS_DESCARTADO');

UPDATE eventos_notificacion SET
  variables = '[
    {"clave":"candidato_nombre","descripcion":"Nombre del candidato"},
    {"clave":"documento_nombre","descripcion":"Documento que firmó"}
  ]'::jsonb,
  payload_ejemplo = '{"candidato_id":"00000000-0000-0000-0000-000000000000","candidato_nombre":"LAURA MARCELA RÍOS PEÑA",
    "documento_nombre":"Autorización para el tratamiento de datos personales"}'::jsonb
 WHERE codigo = 'ATS_DOCUMENTO_FIRMADO';

-- 6. Plantillas de correo del proceso de selección ---------------------------
INSERT INTO plantillas_correo (codigo, nombre, descripcion, categoria, asunto, cuerpo_html, variables, es_sistema) VALUES
('ats_remision_ips', 'Remisión a examen médico de ingreso',
 'Se envía al centro médico (IPS) cuando RRHH registra la remisión en el expediente.', 'Selección y contratación',
 'Remisión examen médico ocupacional de ingreso · {{candidato_nombre}} · {{tipo_documento}} {{documento}}',
 $html$<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;line-height:1.5">
  <div style="border-bottom:3px solid #2E7D32;padding:10px 0;margin-bottom:16px"><strong style="font-size:18px;color:#2E7D32">Conserjes Inmobiliarios</strong></div>
  <p>Buen día, <strong>{{ips}}</strong>:</p>
  <p>Remitimos al siguiente aspirante para el <strong>examen médico ocupacional de ingreso</strong>.</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5;width:40%"><strong>Nombre</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{candidato_nombre}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Documento</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{tipo_documento}} {{documento}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Fecha de nacimiento</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{fecha_nacimiento}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Celular</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{celular}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Cargo</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{cargo}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>EPS / fondo de pensiones</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{eps}} · {{afp}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Trabajo en alturas</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{trabajo_alturas}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Manipulación de alimentos</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{manipulacion_alimentos}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Observaciones</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{observaciones}}</td></tr>
  </table>
  <p style="margin-top:16px">Empresa: <strong>{{empresa}}</strong> · NIT {{empresa_nit}}.<br>
  Por favor envíen el concepto de aptitud a <strong>{{correo_respuesta}}</strong>.</p>
  <p style="font-size:13px;color:#4b5563">Remitido por {{remitido_por}} el {{fecha_remision}}.</p>
  <p style="font-size:12px;color:#6b7280;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">Correo automático de la plataforma de Conserjes Inmobiliarios.</p>
</div>$html$,
 '[{"clave":"ips"},{"clave":"candidato_nombre"},{"clave":"tipo_documento"},{"clave":"documento"},{"clave":"fecha_nacimiento"},{"clave":"celular"},{"clave":"cargo"},{"clave":"eps"},{"clave":"afp"},{"clave":"trabajo_alturas"},{"clave":"manipulacion_alimentos"},{"clave":"observaciones"},{"clave":"empresa"},{"clave":"empresa_nit"},{"clave":"correo_respuesta"},{"clave":"remitido_por"},{"clave":"fecha_remision"}]'::jsonb,
 true),

('ats_documentos_para_firmar', 'Documentos listos para firmar',
 'Le avisa al candidato que sus formatos de contratación están listos para firmar en "Mi proceso".', 'Selección y contratación',
 'Tus documentos de contratación están listos para firmar',
 $html$<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;line-height:1.5">
  <div style="border-bottom:3px solid #2E7D32;padding:10px 0;margin-bottom:16px"><strong style="font-size:18px;color:#2E7D32">Conserjes Inmobiliarios</strong></div>
  <p>Hola, <strong>{{candidato_nombre}}</strong>:</p>
  <p>Tienes <strong>{{documento_nombre}}</strong> listos para firmar. Ya vienen llenos con los datos de tu registro: solo debes leerlos y firmarlos desde tu celular.</p>
  <p style="margin:22px 0"><a href="{{enlace}}" style="background:#2E7D32;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Ver y firmar mis documentos</a></p>
  <p style="font-size:13px;color:#4b5563">Para entrar usa tu número de documento y tu contraseña.</p>
  <p style="font-size:12px;color:#6b7280;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">Correo automático de la plataforma de Conserjes Inmobiliarios.</p>
</div>$html$,
 '[{"clave":"candidato_nombre"},{"clave":"documento_nombre"},{"clave":"enlace"}]'::jsonb,
 true),

('ats_ingreso_nomina', 'Nuevo ingreso para nómina',
 'Le avisa a Nómina cada contratación para afiliaciones y cargue en WO.', 'Selección y contratación',
 'Nuevo ingreso: {{candidato_nombre}} · {{cargo}} · desde {{fecha_ingreso}}',
 $html$<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;line-height:1.5">
  <div style="border-bottom:3px solid #2E7D32;padding:10px 0;margin-bottom:16px"><strong style="font-size:18px;color:#2E7D32">Conserjes Inmobiliarios</strong></div>
  <p>Se contrató a <strong>{{candidato_nombre}}</strong> y ya está en la planta de personal.</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5;width:40%"><strong>Documento</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{documento}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Cargo</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{cargo}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Centro de costo</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{centro_costo}}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #e5e7eb;background:#f4f6f5"><strong>Fecha de ingreso</strong></td><td style="padding:6px 8px;border:1px solid #e5e7eb">{{fecha_ingreso}}</td></tr>
  </table>
  <p style="margin-top:16px">Las afiliaciones y el Excel para WO se sacan desde Postulaciones (pestaña Contratados).</p>
  <p style="margin:22px 0"><a href="{{app_url}}/gestion-humana/postulaciones" style="background:#2E7D32;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Abrir Postulaciones</a></p>
  <p style="font-size:12px;color:#6b7280;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">Correo automático de la plataforma de Conserjes Inmobiliarios.</p>
</div>$html$,
 '[{"clave":"candidato_nombre"},{"clave":"documento"},{"clave":"cargo"},{"clave":"centro_costo"},{"clave":"fecha_ingreso"},{"clave":"app_url"}]'::jsonb,
 true),

('ats_pruebas_completadas', 'Pruebas de selección completadas',
 'Le avisa a Selección cuando un candidato termina las pruebas.', 'Selección y contratación',
 '{{candidato_nombre}} terminó las pruebas de selección',
 $html$<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;line-height:1.5">
  <div style="border-bottom:3px solid #2E7D32;padding:10px 0;margin-bottom:16px"><strong style="font-size:18px;color:#2E7D32">Conserjes Inmobiliarios</strong></div>
  <p><strong>{{candidato_nombre}}</strong> terminó la prueba de aptitud y la de conocimientos (puntaje de conocimientos: <strong>{{puntaje}}</strong>).</p>
  <p>Ya pasó a revisión documental. Los resultados y el PDF de cada prueba están en su expediente, pestaña «Pruebas y evaluaciones».</p>
  <p style="margin:22px 0"><a href="{{app_url}}/gestion-humana/postulaciones" style="background:#2E7D32;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Abrir Postulaciones</a></p>
  <p style="font-size:12px;color:#6b7280;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">Correo automático de la plataforma de Conserjes Inmobiliarios.</p>
</div>$html$,
 '[{"clave":"candidato_nombre"},{"clave":"puntaje"},{"clave":"app_url"}]'::jsonb,
 true)
ON CONFLICT (codigo) DO NOTHING;

-- 7. Flujos del proceso de selección ------------------------------------------
INSERT INTO flujos_notificacion (codigo, nombre, descripcion, evento_codigo, activo, prioridad) VALUES
  ('ats_remision_ips', 'Remisión a exámenes médicos → centro médico',
   'Envía la remisión al correo del centro médico (IPS) elegido en el expediente, con sus correos en copia.', 'ATS_REMISION_IPS', true, 10),
  ('ats_documentos_para_firmar', 'Documentos listos para firmar → candidato',
   'Avisa al candidato que tiene formatos para firmar en «Mi proceso».', 'ATS_DOCUMENTO_PARA_FIRMA', true, 20),
  ('ats_contratado_nomina', 'Nuevo ingreso → Nómina',
   'Avisa a la lista Nómina del directorio de cada contratación.', 'ATS_CONTRATADO', true, 30),
  ('ats_pruebas_completadas', 'Pruebas completadas → Selección',
   'Avisa a la lista Selección del directorio cuando un candidato termina las pruebas.', 'ATS_PRUEBAS_COMPLETADAS', true, 40)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO flujo_pasos (flujo_id, orden, nombre, tipo, demora_minutos, plantilla_id, destinatarios)
SELECT f.id, 1, x.nombre, 'EMAIL', 0, (SELECT id FROM plantillas_correo WHERE codigo = x.plantilla), x.dest::jsonb
  FROM (VALUES
    ('ats_remision_ips', 'Correo al centro médico', 'ats_remision_ips',
     '{"roles":[],"usuarios":[],"correos":[],"campos":[],"listas":[],"entidades":["ips"]}'),
    ('ats_documentos_para_firmar', 'Correo al candidato', 'ats_documentos_para_firmar',
     '{"roles":[],"usuarios":[],"correos":[],"campos":["candidato_email"],"listas":[],"entidades":[]}'),
    ('ats_contratado_nomina', 'Correo a Nómina', 'ats_ingreso_nomina',
     '{"roles":[],"usuarios":[],"correos":[],"campos":[],"listas":["NOMINA"],"entidades":[]}'),
    ('ats_pruebas_completadas', 'Correo a Selección', 'ats_pruebas_completadas',
     '{"roles":[],"usuarios":[],"correos":[],"campos":[],"listas":["SELECCION"],"entidades":[]}')
  ) AS x(flujo, nombre, plantilla, dest)
  JOIN flujos_notificacion f ON f.codigo = x.flujo
 WHERE NOT EXISTS (SELECT 1 FROM flujo_pasos p WHERE p.flujo_id = f.id);
