-- =============================================================================
-- ATS · Hoja de vida estructurada, firma con evidencia y ajustes de seguridad
-- =============================================================================
-- Para que el candidato "solo firme" los formatos de contratación, la
-- plataforma tiene que tener TODO lo que esos formatos piden. El expediente
-- físico de ejemplo (40 folios) muestra que la Actualización de datos, la hoja
-- de vida y el formato de entrevista piden, además de lo que ya capturaba el
-- formulario: estudios por nivel, empleos anteriores y referencias familiares
-- y personales. Esta migración los agrega como tablas hijas del candidato.
--
-- Además corrige tres cosas de 20260922000001:
--   · `digest()` vive en el esquema `extensions` (pgcrypto) y las funciones
--     tienen search_path = public: la firma y el cierre de pruebas habrían
--     fallado al ejecutarse. Se usa `sha256()`, que es nativa desde PG 11.
--   · La guardia del candidato corría DESPUÉS del trigger que registra el
--     cambio de fase, y le devolvía la fecha de fase al valor viejo cuando el
--     candidato enviaba su registro. Ahora corre primero.
--   · El formato de entrevista trae un concepto psicológico confidencial ("no
--     existe autorización para dar a conocer los resultados al postulante"):
--     los documentos generados ahora pueden quedar ocultos para el candidato.
--
-- También deja la IP de quien acepta o firma (evidencia exigible por la
-- Ley 1581 de 2012) leyendo las cabeceras que PostgREST expone a la sesión.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- =============================================================================
-- 1. EVIDENCIA DE LA SOLICITUD (IP y navegador de quien llama)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.vac_cabecera_solicitud(p_nombre TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $fn$
DECLARE h JSON;
BEGIN
  BEGIN
    h := NULLIF(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN RETURN NULL;
  END;
  RETURN h ->> lower(p_nombre);
END $fn$;

CREATE OR REPLACE FUNCTION public.vac_ip_solicitud()
RETURNS INET LANGUAGE plpgsql STABLE AS $fn$
DECLARE v TEXT;
BEGIN
  v := COALESCE(
    public.vac_cabecera_solicitud('cf-connecting-ip'),
    NULLIF(btrim(split_part(public.vac_cabecera_solicitud('x-forwarded-for'), ',', 1)), ''),
    public.vac_cabecera_solicitud('x-real-ip'));
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  RETURN btrim(v)::inet;
EXCEPTION WHEN others THEN RETURN NULL;
END $fn$;

-- Consentimientos: si el cliente no mandó IP / navegador, se toman de la solicitud.
CREATE OR REPLACE FUNCTION public.vac_consentimiento_evidencia()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.ip := COALESCE(NEW.ip, public.vac_ip_solicitud());
  NEW.user_agent := COALESCE(NEW.user_agent, public.vac_cabecera_solicitud('user-agent'));
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tr_consentimientos_evidencia ON consentimientos;
CREATE TRIGGER tr_consentimientos_evidencia BEFORE INSERT ON consentimientos
  FOR EACH ROW EXECUTE FUNCTION public.vac_consentimiento_evidencia();

-- =============================================================================
-- 2. HOJA DE VIDA ESTRUCTURADA
-- =============================================================================
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS perfil_laboral TEXT;
ALTER TABLE candidatos ADD COLUMN IF NOT EXISTS telefono_fijo  TEXT;

CREATE TABLE IF NOT EXISTS candidato_estudios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id          UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  nivel                 TEXT NOT NULL,     -- PRIMARIA | SECUNDARIA | TECNICO | TECNOLOGO | UNIVERSITARIO | POSGRADO | CURSO
  institucion           TEXT,
  titulo                TEXT,
  ciudad                TEXT,
  anio_finalizacion     INT,
  ultimo_curso_aprobado TEXT,              -- "9°", "11°", "5 semestre"…
  en_curso              BOOLEAN NOT NULL DEFAULT false,
  intensidad_horaria    TEXT,              -- cursos: "10 horas"
  vigencia              DATE,              -- cursos con vencimiento (alturas, alimentos)
  orden                 INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_estudios ON candidato_estudios(candidato_id, orden);

CREATE TABLE IF NOT EXISTS candidato_experiencias (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id        UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  empresa             TEXT NOT NULL,
  cargo               TEXT,
  direccion           TEXT,
  telefono            TEXT,
  jefe_inmediato      TEXT,
  cargo_jefe          TEXT,
  fecha_ingreso       DATE,
  fecha_retiro        DATE,
  trabaja_actualmente BOOLEAN NOT NULL DEFAULT false,
  motivo_retiro       TEXT,
  funciones           TEXT,
  tipo_contrato       TEXT,
  salario_inicial     NUMERIC(14,2),
  salario_final       NUMERIC(14,2),
  orden               INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_experiencias ON candidato_experiencias(candidato_id, orden);

CREATE TABLE IF NOT EXISTS candidato_referencias (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id      UUID NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL CHECK (tipo IN ('FAMILIAR','PERSONAL','LABORAL')),
  nombre            TEXT NOT NULL,
  parentesco        TEXT,
  ocupacion         TEXT,
  telefono          TEXT,
  direccion         TEXT,
  empresa           TEXT,
  telefono_empresa  TEXT,
  -- Verificación que hace RRHH (llamada a la referencia).
  verificada        BOOLEAN NOT NULL DEFAULT false,
  verificada_por    UUID,
  verificada_at     TIMESTAMPTZ,
  verificacion_nota TEXT,
  orden             INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cand_referencias ON candidato_referencias(candidato_id, tipo, orden);

ALTER TABLE candidato_estudios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_experiencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidato_referencias  ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['candidato_estudios','candidato_experiencias','candidato_referencias'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_sel ON %I FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id AND c.auth_uid = (SELECT auth.uid()))
             OR public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones']))$f$, t, t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_mod ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_mod ON %I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id AND c.auth_uid = (SELECT auth.uid()))
             OR public.auth_permiso('gestionar_postulaciones'))
      WITH CHECK (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id AND c.auth_uid = (SELECT auth.uid()))
             OR public.auth_permiso('gestionar_postulaciones'))$f$, t, t, t, t);
  END LOOP;
END $rls$;

-- =============================================================================
-- 3. DOCUMENTOS: visibilidad para el candidato y firma electrónica permitida
-- =============================================================================
ALTER TABLE plantillas_documento ADD COLUMN IF NOT EXISTS visible_candidato         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE plantillas_documento ADD COLUMN IF NOT EXISTS permite_firma_electronica BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE documentos_generados ADD COLUMN IF NOT EXISTS visible_candidato         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE documentos_generados ADD COLUMN IF NOT EXISTS permite_firma_electronica BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE documentos_generados ADD COLUMN IF NOT EXISTS firmado_por_staff         UUID;

DROP POLICY IF EXISTS docgen_read ON documentos_generados;
CREATE POLICY docgen_read ON documentos_generados FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones','gestionar_postulaciones'])
         OR (estado <> 'ANULADO' AND visible_candidato
             AND EXISTS (SELECT 1 FROM candidatos c WHERE c.id = candidato_id AND c.auth_uid = (SELECT auth.uid()))));

-- Firma electrónica simple: dibujo + hash + fecha + IP + navegador + versión.
CREATE OR REPLACE FUNCTION public.vac_firmar_documento(p_doc UUID, p_firma_data_url TEXT, p_user_agent TEXT DEFAULT NULL)
RETURNS documentos_generados
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE d documentos_generados%ROWTYPE; c candidatos%ROWTYPE; v_html TEXT; v_marca TEXT; v_fecha TEXT;
BEGIN
  SELECT * INTO d FROM documentos_generados WHERE id = p_doc;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Documento no encontrado.'; END IF;
  SELECT * INTO c FROM candidatos WHERE id = d.candidato_id;
  IF c.auth_uid IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'No autorizado.'; END IF;
  IF NOT d.visible_candidato THEN RAISE EXCEPTION 'No autorizado.'; END IF;
  IF d.estado <> 'PENDIENTE_FIRMA' THEN RAISE EXCEPTION 'Este documento ya no está pendiente de firma.'; END IF;
  IF NOT d.permite_firma_electronica THEN RAISE EXCEPTION 'Este documento se firma en físico en la oficina.'; END IF;
  IF p_firma_data_url IS NULL OR p_firma_data_url NOT LIKE 'data:image/png;base64,%' THEN RAISE EXCEPTION 'Firma inválida.'; END IF;
  IF length(p_firma_data_url) > 400000 THEN RAISE EXCEPTION 'La firma es demasiado grande.'; END IF;

  v_fecha := to_char(NOW() AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI');
  v_marca := '<img class="firma-img" alt="Firma" src="' || p_firma_data_url || '" />';
  v_html := replace(d.html_render, '{{FIRMA_TRABAJADOR}}', v_marca);
  v_html := replace(v_html, '{{FECHA_FIRMA}}', v_fecha);

  UPDATE documentos_generados SET
    estado = 'FIRMADO', metodo_firma = 'ELECTRONICA', firma_data_url = p_firma_data_url,
    html_firmado = v_html, firmado_at = NOW(),
    sha256 = encode(sha256(convert_to(v_html, 'UTF8')), 'hex'),
    firma_evidencia = jsonb_build_object(
      'user_agent', COALESCE(p_user_agent, public.vac_cabecera_solicitud('user-agent')),
      'ip', public.vac_ip_solicitud()::text,
      'firmado_at', NOW(), 'firmado_local', v_fecha, 'auth_uid', (SELECT auth.uid()),
      'documento', c.numero_documento, 'version_id', d.version_id,
      'sha256_documento_generado', encode(sha256(convert_to(d.html_render, 'UTF8')), 'hex'))
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
-- 4. PRUEBAS: cierre con hash nativo e IP
-- =============================================================================
ALTER TABLE prueba_intentos ADD COLUMN IF NOT EXISTS ip INET;

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
    firma_nombre = p_firma_nombre, firma_documento = p_firma_documento,
    user_agent = COALESCE(p_user_agent, public.vac_cabecera_solicitud('user-agent')),
    ip = public.vac_ip_solicitud(),
    hash = encode(sha256(convert_to(id::text || COALESCE(p_respuestas::text, '') || NOW()::text, 'UTF8')), 'hex')
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

-- =============================================================================
-- 5. GUARDIA DEL CANDIDATO: corre antes que la bitácora
-- =============================================================================
CREATE OR REPLACE FUNCTION public.vac_candidato_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;                 -- service role / SQL
  IF current_setting('vac.sistema', true) = 'on' THEN RETURN NEW; END IF; -- RPC del sistema
  IF public.auth_permiso('gestionar_postulaciones') THEN RETURN NEW; END IF;
  IF (SELECT auth.uid()) IS DISTINCT FROM OLD.auth_uid THEN RETURN NEW; END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND NOT (OLD.estado::text = 'BORRADOR' AND NEW.estado::text = 'POSTULADO') THEN
    RAISE EXCEPTION 'No puedes cambiar el estado de tu proceso.';
  END IF;
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    NEW.fase_desde := OLD.fase_desde;
  END IF;
  NEW.centro_costo_id        := OLD.centro_costo_id;
  NEW.requisicion_id         := OLD.requisicion_id;
  NEW.motivo_descarte        := OLD.motivo_descarte;
  NEW.descarte_detalle       := OLD.descarte_detalle;
  NEW.descartado_at          := OLD.descartado_at;
  NEW.descartado_por         := OLD.descartado_por;
  NEW.ips_id                 := OLD.ips_id;
  NEW.ips_nombre             := OLD.ips_nombre;
  NEW.ips_correo             := OLD.ips_correo;
  NEW.ips_fecha_remision     := OLD.ips_fecha_remision;
  NEW.ips_remitido_por       := OLD.ips_remitido_por;
  NEW.antecedentes_resultado := OLD.antecedentes_resultado;
  NEW.antecedentes_mensaje   := OLD.antecedentes_mensaje;
  NEW.antecedentes_fecha     := OLD.antecedentes_fecha;
  NEW.antecedentes_por       := OLD.antecedentes_por;
  NEW.observaciones_rrhh     := OLD.observaciones_rrhh;
  NEW.persona_id             := OLD.persona_id;
  RETURN NEW;
END $fn$;

-- Los BEFORE triggers corren en orden alfabético: "a_guard" va antes que
-- "cambio_estado" (bitácora) y que "sync_nombres".
DROP TRIGGER IF EXISTS tr_candidatos_guard ON candidatos;
DROP TRIGGER IF EXISTS tr_candidatos_a_guard ON candidatos;
CREATE TRIGGER tr_candidatos_a_guard BEFORE UPDATE ON candidatos
  FOR EACH ROW EXECUTE FUNCTION public.vac_candidato_guard();

-- =============================================================================
-- 6. BANDEJA: se agregan los conteos de hoja de vida
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
  (SELECT k.codigo FROM contratos k WHERE k.candidato_id = c.id AND k.estado <> 'ANULADO' ORDER BY k.generado_at DESC LIMIT 1) AS contrato_codigo,
  (SELECT COUNT(*) FROM candidato_referencias f WHERE f.candidato_id = c.id) AS referencias_total,
  (SELECT COUNT(*) FROM candidato_referencias f WHERE f.candidato_id = c.id AND f.verificada) AS referencias_verificadas
FROM candidatos c
LEFT JOIN cargos cg ON cg.id = c.cargo_postulacion_id
LEFT JOIN municipios mt ON mt.codigo_dane = c.municipio_trabajo
LEFT JOIN centros_costo cc ON cc.id = c.centro_costo_id
LEFT JOIN requisiciones r ON r.id = c.requisicion_id
WHERE c.estado::text <> 'BORRADOR';

GRANT SELECT ON vw_ats_bandeja TO authenticated, service_role;
