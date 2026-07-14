-- =============================================================================
-- Conserjes Inmobiliarios — Alertas por correo (buzón de salida)
--
-- Cuando una regla de alerta tiene canal_email = true, emitir_notificacion()
-- encola un correo por cada destinatario en `correo_saliente`. Un proceso
-- externo (cron / botón) los envía por SMTP con la integración de correo.
--
-- IDEMPOTENTE.
-- =============================================================================

-- Asegura la función helper de rol (por si la migración inicial no se aplicó).
CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS rol_usuario
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) $$;

-- Buzón de salida -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correo_saliente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  para         VARCHAR(200) NOT NULL,
  asunto       VARCHAR(300),
  cuerpo_texto TEXT,
  enlace       VARCHAR(400),               -- ruta interna (se hace absoluta al enviar)
  estado       VARCHAR(20) DEFAULT 'PENDIENTE', -- PENDIENTE | ENVIADO | ERROR
  intentos     INTEGER DEFAULT 0,
  error        TEXT,
  origen       VARCHAR(80),                -- 'notificacion'
  ref_id       TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  enviado_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_correo_saliente_estado ON correo_saliente(estado, created_at);

ALTER TABLE correo_saliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_correo_saliente ON correo_saliente;
CREATE POLICY admin_correo_saliente ON correo_saliente FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- =============================================================================
-- emitir_notificacion: ahora entrega por app (canal_app) Y/O encola email
-- (canal_email). SECURITY DEFINER → puede insertar en ambas tablas.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.emitir_notificacion(
  p_codigo      tipo_notificacion,
  p_titulo      TEXT,
  p_descripcion TEXT DEFAULT NULL,
  p_entidad     TEXT DEFAULT NULL,
  p_entidad_id  TEXT DEFAULT NULL,
  p_enlace      TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT '{}'
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_regla reglas_alerta%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_regla FROM reglas_alerta WHERE codigo = p_codigo;
  IF NOT FOUND OR NOT v_regla.activa THEN
    RETURN 0;
  END IF;

  -- Canal app (bandeja en la plataforma)
  IF v_regla.canal_app THEN
    INSERT INTO notificaciones (usuario_id, tipo, severidad, titulo, descripcion, entidad, entidad_id, enlace, metadata, regla_codigo)
    SELECT u.id, v_regla.codigo, v_regla.severidad, p_titulo, p_descripcion, p_entidad, p_entidad_id, p_enlace, COALESCE(p_metadata, '{}'), v_regla.codigo
    FROM usuarios u
    LEFT JOIN notificaciones_preferencias pref ON pref.usuario_id = u.id
    WHERE u.activo
      AND u.rol = ANY (v_regla.roles_destino)
      AND (pref.tipos_silenciados IS NULL OR NOT (v_regla.codigo = ANY (pref.tipos_silenciados)));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  -- Canal email (encola en el buzón de salida)
  IF v_regla.canal_email THEN
    INSERT INTO correo_saliente (para, asunto, cuerpo_texto, enlace, origen, ref_id)
    SELECT u.email, p_titulo, COALESCE(p_descripcion, ''), p_enlace, 'notificacion', p_entidad_id
    FROM usuarios u
    LEFT JOIN notificaciones_preferencias pref ON pref.usuario_id = u.id
    WHERE u.activo
      AND u.email IS NOT NULL
      AND u.rol = ANY (v_regla.roles_destino)
      AND (pref.tipos_silenciados IS NULL OR NOT (v_regla.codigo = ANY (pref.tipos_silenciados)));
  END IF;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END $$;
