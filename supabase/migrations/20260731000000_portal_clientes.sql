-- =============================================================================
-- PORTAL DE CLIENTES — Servicios del Hogar
-- Permite que clientes externos creen una cuenta (Google / Apple / correo /
-- WhatsApp-OTP), soliciten servicios, hagan seguimiento, vean su agenda y
-- gestionen su perfil y direcciones guardadas.
--
-- La autorización del portal NO usa el enum `rol_usuario`: se basa en la
-- pertenencia a la tabla `clientes` (id = auth.uid()) y en la propiedad de la
-- fila (cliente_id = auth.uid()). Así evitamos alterar el enum y su transacción
-- y no tocamos los permisos del personal interno.
-- =============================================================================

-- ── Perfil de cliente (1:1 con auth.users) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      VARCHAR(200) NOT NULL DEFAULT 'Cliente',
  email       VARCHAR(200),
  telefono    VARCHAR(30),
  documento   VARCHAR(40),
  foto_url    TEXT,
  proveedor   VARCHAR(20)  DEFAULT 'email',   -- email | google | apple | phone
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_email ON clientes(email);

-- ── Direcciones guardadas del cliente ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS direcciones_cliente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  etiqueta      VARCHAR(60)  NOT NULL DEFAULT 'Casa',   -- Casa, Oficina, Apto...
  direccion     TEXT         NOT NULL,
  ciudad        VARCHAR(100) NOT NULL DEFAULT 'Bogotá',
  barrio        VARCHAR(100),
  notas         TEXT,
  es_principal  BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_direcciones_cliente ON direcciones_cliente(cliente_id);

-- ── Vincular solicitudes con el cliente autenticado ──────────────────────────
ALTER TABLE solicitudes_servicio_hogar
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ssh_cliente ON solicitudes_servicio_hogar(cliente_id);

-- ── Trigger updated_at ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_clientes_upd ON clientes;
CREATE TRIGGER tr_clientes_upd
  BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE clientes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE direcciones_cliente ENABLE ROW LEVEL SECURITY;

-- Lista de roles de personal interno (todos menos AUDITOR, que también usan los
-- aspirantes y los clientes). Se repite en cada policy por claridad.

-- clientes: cada quien ve/edita SU perfil; el personal interno puede leer.
DROP POLICY IF EXISTS clientes_self       ON clientes;
DROP POLICY IF EXISTS clientes_staff_read ON clientes;
CREATE POLICY clientes_self ON clientes FOR ALL TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY clientes_staff_read ON clientes FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS','BODEGUERO','OPERADOR_SEDE'));

-- direcciones: cada quien gestiona las suyas; el personal interno puede leer.
DROP POLICY IF EXISTS dir_self       ON direcciones_cliente;
DROP POLICY IF EXISTS dir_staff_read ON direcciones_cliente;
CREATE POLICY dir_self ON direcciones_cliente FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid()))
  WITH CHECK (cliente_id = (SELECT auth.uid()));
CREATE POLICY dir_staff_read ON direcciones_cliente FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS','BODEGUERO','OPERADOR_SEDE'));

-- ── Reforzar RLS de solicitudes: el cliente sólo ve LAS SUYAS ────────────────
-- La policy anterior (ssh_auth_read) permitía a CUALQUIER autenticado leer todas
-- las solicitudes. La restringimos: el personal interno lee todo; el cliente
-- (AUDITOR por defecto) sólo ve las filas cuyo cliente_id sea el suyo.
DROP POLICY IF EXISTS ssh_auth_read     ON solicitudes_servicio_hogar;
CREATE POLICY ssh_auth_read ON solicitudes_servicio_hogar FOR SELECT TO authenticated
  USING (
    cliente_id = (SELECT auth.uid())
    OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS','BODEGUERO','OPERADOR_SEDE')
  );

-- El cliente puede crear su propia solicitud desde el portal (cliente_id = él).
DROP POLICY IF EXISTS ssh_cliente_insert ON solicitudes_servicio_hogar;
CREATE POLICY ssh_cliente_insert ON solicitudes_servicio_hogar FOR INSERT TO authenticated
  WITH CHECK (cliente_id = (SELECT auth.uid()));

-- El cliente puede calificar / cancelar SU propia solicitud (update acotado por
-- ownership; el personal interno mantiene su policy ssh_auth_write existente).
DROP POLICY IF EXISTS ssh_cliente_update ON solicitudes_servicio_hogar;
CREATE POLICY ssh_cliente_update ON solicitudes_servicio_hogar FOR UPDATE TO authenticated
  USING (cliente_id = (SELECT auth.uid()))
  WITH CHECK (cliente_id = (SELECT auth.uid()));

-- ── Reforzar RLS de agenda: el cliente ve las sesiones de SUS solicitudes ─────
DROP POLICY IF EXISTS agenda_sh_read ON agenda_servicio_hogar;
CREATE POLICY agenda_sh_read ON agenda_servicio_hogar FOR SELECT TO authenticated
  USING (
    public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS','BODEGUERO','OPERADOR_SEDE')
    OR EXISTS (
      SELECT 1 FROM solicitudes_servicio_hogar s
      WHERE s.id = agenda_servicio_hogar.solicitud_id
        AND s.cliente_id = (SELECT auth.uid())
    )
  );
