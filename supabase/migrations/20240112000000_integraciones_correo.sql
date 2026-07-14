-- =============================================================================
-- Conserjes Inmobiliarios — Integraciones · Correo electrónico
--
-- Vincula una cuenta de correo (de CUALQUIER plataforma) por SMTP (envío) e
-- IMAP (recepción). Guarda credenciales, estado de la última prueba y toggles.
--
-- Seguridad: SOLO administradores pueden leer/escribir esta tabla (contiene
-- credenciales). RLS estricta. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS integraciones_correo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(120) DEFAULT 'Correo principal',
  from_nombre    VARCHAR(150),                 -- nombre visible del remitente
  from_email     VARCHAR(200),                 -- correo de la cuenta
  -- SMTP (envío) ---------------------------------------------------------------
  smtp_host      VARCHAR(200),
  smtp_port      INTEGER DEFAULT 587,
  smtp_secure    BOOLEAN DEFAULT false,        -- true = SSL directo (465)
  smtp_user      VARCHAR(200),
  smtp_pass      TEXT,                          -- contraseña / app password
  envio_activo   BOOLEAN DEFAULT true,
  -- IMAP (recepción) -----------------------------------------------------------
  imap_host      VARCHAR(200),
  imap_port      INTEGER DEFAULT 993,
  imap_secure    BOOLEAN DEFAULT true,
  imap_user      VARCHAR(200),
  imap_pass      TEXT,
  recepcion_activa BOOLEAN DEFAULT false,
  -- Estado ---------------------------------------------------------------------
  estado         VARCHAR(20) DEFAULT 'SIN_PROBAR', -- SIN_PROBAR | OK | ERROR
  ultimo_test    TIMESTAMPTZ,
  ultimo_error   TEXT,
  activo         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tr_integr_correo_upd ON integraciones_correo;
CREATE TRIGGER tr_integr_correo_upd BEFORE UPDATE ON integraciones_correo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS — solo administradores (la tabla guarda credenciales)
-- =============================================================================
ALTER TABLE integraciones_correo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_integr_correo ON integraciones_correo;
CREATE POLICY admin_all_integr_correo ON integraciones_correo FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
