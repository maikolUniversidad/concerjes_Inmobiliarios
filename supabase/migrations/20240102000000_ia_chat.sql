-- =============================================================================
-- MÓDULO: Asistente IA — Chat con historial, carpetas y multimodelo
-- =============================================================================
-- Tablas:
--   ia_carpetas        → carpetas para clasificar conversaciones (por usuario)
--   ia_conversaciones  → cada hilo de chat (pertenece a un usuario, opcional carpeta)
--   ia_mensajes        → mensajes de cada conversación (user / assistant)
-- Seguridad: RLS estricto — cada usuario solo ve/gestiona lo suyo.
-- =============================================================================

-- ── Carpetas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ia_carpetas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     VARCHAR(120) NOT NULL,
  color      VARCHAR(20) DEFAULT 'green',
  orden      INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Conversaciones ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ia_conversaciones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  carpeta_id UUID REFERENCES ia_carpetas(id) ON DELETE SET NULL,
  titulo     VARCHAR(200) NOT NULL DEFAULT 'Nueva conversación',
  modelo     VARCHAR(40) NOT NULL DEFAULT 'deepseek-chat',
  fijada     BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Mensajes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ia_mensajes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID NOT NULL REFERENCES ia_conversaciones(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL DEFAULT '',
  -- metadata: { modelo, tokens, audio: true, error: true, ... }
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ia_carpetas_user      ON ia_carpetas(user_id, orden);
CREATE INDEX IF NOT EXISTS idx_ia_conv_user          ON ia_conversaciones(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ia_conv_carpeta       ON ia_conversaciones(carpeta_id);
CREATE INDEX IF NOT EXISTS idx_ia_mensajes_conv      ON ia_mensajes(conversacion_id, created_at);

-- ── Trigger updated_at en conversaciones ────────────────────────────────────
DROP TRIGGER IF EXISTS tr_ia_conv_upd ON ia_conversaciones;
CREATE TRIGGER tr_ia_conv_upd BEFORE UPDATE ON ia_conversaciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Al insertar un mensaje, "tocar" la conversación para reordenar historial ---
CREATE OR REPLACE FUNCTION ia_touch_conversacion()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ia_conversaciones SET updated_at = NOW() WHERE id = NEW.conversacion_id;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_ia_msg_touch ON ia_mensajes;
CREATE TRIGGER tr_ia_msg_touch AFTER INSERT ON ia_mensajes
  FOR EACH ROW EXECUTE FUNCTION ia_touch_conversacion();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE ia_carpetas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_mensajes       ENABLE ROW LEVEL SECURITY;

-- Carpetas: el dueño gestiona todo
DROP POLICY IF EXISTS ia_carpetas_owner ON ia_carpetas;
CREATE POLICY ia_carpetas_owner ON ia_carpetas FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Conversaciones: el dueño gestiona todo
DROP POLICY IF EXISTS ia_conv_owner ON ia_conversaciones;
CREATE POLICY ia_conv_owner ON ia_conversaciones FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Mensajes: el dueño gestiona todo
DROP POLICY IF EXISTS ia_msg_owner ON ia_mensajes;
CREATE POLICY ia_msg_owner ON ia_mensajes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
