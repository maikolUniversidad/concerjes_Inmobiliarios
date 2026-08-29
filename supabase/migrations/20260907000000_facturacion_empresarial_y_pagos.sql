-- =============================================================================
-- FACTURACIÓN EMPRESARIAL, TAMAÑO DEL INMUEBLE Y PAGOS POR PASARELA
-- =============================================================================
-- Tres cosas que el portal necesitaba:
--
-- 1. **Facturar a nombre de una empresa.** Hasta ahora solo se guardaba un
--    nombre y un documento por cliente. Un mismo cliente puede necesitar a
--    veces factura personal y a veces a nombre de su empresa, con NIT, régimen
--    y el RUT adjunto — así que pasa a ser una lista de perfiles, no un campo.
--
-- 2. **Tamaño del inmueble.** Con «casa u oficina» no alcanza para dimensionar
--    el servicio. Se guardan área, habitaciones, baños, pisos y puestos de
--    trabajo, tanto en la solicitud como en la dirección guardada, para que la
--    segunda vez ya venga puesto.
--
-- 3. **Pagos por pasarela (Wompi / PSE).** El flujo completo: se crea una
--    transacción, el cliente paga afuera, la pasarela avisa por webhook, se
--    verifica la firma y el pago se aplica al cobro. Los eventos quedan
--    guardados para poder auditar y para no procesar dos veces el mismo.
--
-- Idempotente: se puede repetir sin efecto.
-- =============================================================================

-- =============================================================================
-- 1. PERFILES DE FACTURACIÓN
-- =============================================================================
CREATE TABLE IF NOT EXISTS perfiles_facturacion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo_persona      VARCHAR(10) NOT NULL DEFAULT 'NATURAL',   -- NATURAL | JURIDICA
  -- Persona natural
  nombre_completo   VARCHAR(200),
  tipo_documento    VARCHAR(10) NOT NULL DEFAULT 'CC',        -- CC | CE | NIT | PAS
  numero_documento  VARCHAR(40) NOT NULL,
  -- Persona jurídica
  razon_social      VARCHAR(250),
  digito_verificacion VARCHAR(1),
  regimen_iva       VARCHAR(30),   -- RESPONSABLE_IVA | NO_RESPONSABLE_IVA | GRAN_CONTRIBUYENTE
  responsabilidades TEXT[] NOT NULL DEFAULT '{}',   -- códigos DIAN: O-13, O-15, O-23, O-47…
  actividad_ciiu    VARCHAR(10),
  -- Contacto de facturación
  email_factura     VARCHAR(200),
  telefono          VARCHAR(30),
  direccion         TEXT,
  ciudad            VARCHAR(100),
  -- RUT (obligatorio en la práctica para persona jurídica)
  rut_path          TEXT,          -- ruta dentro del bucket 'rut-clientes'
  rut_nombre        VARCHAR(200),  -- nombre original del archivo, para mostrarlo
  rut_subido_at     TIMESTAMPTZ,
  es_principal      BOOLEAN NOT NULL DEFAULT false,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT perfil_fact_tipo_persona
    CHECK (tipo_persona IN ('NATURAL', 'JURIDICA')),
  -- Una empresa sin razón social no sirve para facturar.
  CONSTRAINT perfil_fact_juridica_completa
    CHECK (tipo_persona <> 'JURIDICA' OR (razon_social IS NOT NULL AND razon_social <> '')),
  -- Una persona natural sin nombre, tampoco.
  CONSTRAINT perfil_fact_natural_completa
    CHECK (tipo_persona <> 'NATURAL' OR (nombre_completo IS NOT NULL AND nombre_completo <> ''))
);
CREATE INDEX IF NOT EXISTS idx_perfiles_fact_cliente
  ON perfiles_facturacion(cliente_id, activo);

-- Un solo perfil principal por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_perfiles_fact_principal
  ON perfiles_facturacion(cliente_id) WHERE es_principal AND activo;

-- Traer lo que ya había en la tabla vieja (un registro por cliente).
INSERT INTO perfiles_facturacion (
  cliente_id, tipo_persona, nombre_completo, tipo_documento, numero_documento,
  email_factura, direccion, es_principal
)
SELECT d.cliente_id,
       CASE WHEN d.tipo_documento = 'NIT' THEN 'JURIDICA' ELSE 'NATURAL' END,
       d.nombre_completo, d.tipo_documento, d.numero_documento,
       d.email_factura, d.direccion, true
  FROM datos_facturacion_cliente d
 WHERE NOT EXISTS (SELECT 1 FROM perfiles_facturacion p WHERE p.cliente_id = d.cliente_id)
   -- El CHECK exige razón social para jurídica; los que venían con NIT no la
   -- tienen todavía, así que entran como natural y se corrigen desde el portal.
   AND d.tipo_documento <> 'NIT';

COMMENT ON TABLE datos_facturacion_cliente IS
  'OBSOLETA: reemplazada por perfiles_facturacion, que admite varios perfiles por cliente y datos de empresa. Se conserva por compatibilidad; no escribir aquí.';

DROP TRIGGER IF EXISTS tr_perfiles_fact_upd ON perfiles_facturacion;
CREATE TRIGGER tr_perfiles_fact_upd BEFORE UPDATE ON perfiles_facturacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Con qué perfil se facturó cada servicio.
ALTER TABLE solicitudes_servicio_hogar
  ADD COLUMN IF NOT EXISTS perfil_facturacion_id UUID
    REFERENCES perfiles_facturacion(id) ON DELETE SET NULL;

ALTER TABLE cobros_servicio_hogar
  ADD COLUMN IF NOT EXISTS perfil_facturacion_id UUID
    REFERENCES perfiles_facturacion(id) ON DELETE SET NULL;

-- =============================================================================
-- 2. TAMAÑO DEL INMUEBLE
-- =============================================================================
-- En la dirección guardada, para que la segunda vez ya venga puesto.
ALTER TABLE direcciones_cliente
  ADD COLUMN IF NOT EXISTS tipo_inmueble   VARCHAR(20) NOT NULL DEFAULT 'HOGAR', -- HOGAR | OFICINA
  ADD COLUMN IF NOT EXISTS area_m2         NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS habitaciones    SMALLINT,
  ADD COLUMN IF NOT EXISTS banos           SMALLINT,
  ADD COLUMN IF NOT EXISTS pisos           SMALLINT,
  ADD COLUMN IF NOT EXISTS puestos_trabajo SMALLINT;

-- En la solicitud, porque el tamaño del día del servicio puede no ser el que
-- quedó guardado en la dirección.
ALTER TABLE solicitudes_servicio_hogar
  ADD COLUMN IF NOT EXISTS banos           SMALLINT,
  ADD COLUMN IF NOT EXISTS pisos           SMALLINT,
  ADD COLUMN IF NOT EXISTS puestos_trabajo SMALLINT;

COMMENT ON COLUMN solicitudes_servicio_hogar.dormitorios IS
  'Habitaciones cuando es HOGAR. Para OFICINA se usa puestos_trabajo.';

-- =============================================================================
-- 3. PAGOS POR PASARELA
-- =============================================================================
-- Una transacción por intento de pago. La pasarela es la fuente de verdad del
-- estado; aquí se guarda para poder mostrarlo y auditarlo.
CREATE TABLE IF NOT EXISTS transacciones_pasarela (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id          UUID NOT NULL REFERENCES cobros_servicio_hogar(id) ON DELETE CASCADE,
  cliente_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pasarela          VARCHAR(20)  NOT NULL DEFAULT 'WOMPI',   -- WOMPI | PAYU | MERCADOPAGO
  -- Referencia que viaja a la pasarela y vuelve en el webhook. Es nuestra, y es
  -- única: por ella se reconcilia el evento con la transacción.
  referencia        VARCHAR(64)  UNIQUE NOT NULL,
  metodo            VARCHAR(20),  -- PSE | CARD | NEQUI | BANCOLOMBIA_TRANSFER | OTRO
  monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  -- Lo que se le manda a la pasarela, en centavos y sin decimales.
  monto_centavos    BIGINT       NOT NULL,
  moneda            VARCHAR(5)   NOT NULL DEFAULT 'COP',
  estado            VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
  -- PENDIENTE | APROBADA | RECHAZADA | ANULADA | ERROR | EXPIRADA
  id_pasarela       VARCHAR(80),   -- id de la transacción del lado de la pasarela
  url_pago          TEXT,          -- checkout al que se manda al cliente
  mensaje           TEXT,          -- razón del rechazo, si la hubo
  datos             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- payload de la pasarela
  pago_id           UUID REFERENCES pagos_hogar(id) ON DELETE SET NULL,
  aprobada_at       TIMESTAMPTZ,
  expira_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_cobro    ON transacciones_pasarela(cobro_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_cliente  ON transacciones_pasarela(cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_estado   ON transacciones_pasarela(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_pasarela ON transacciones_pasarela(pasarela, id_pasarela);

DROP TRIGGER IF EXISTS tr_tx_pasarela_upd ON transacciones_pasarela;
CREATE TRIGGER tr_tx_pasarela_upd BEFORE UPDATE ON transacciones_pasarela
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Bitácora de webhooks. La pasarela reintenta cuando no recibe 200, así que el
-- mismo evento llega varias veces: `evento_id` único es lo que hace el proceso
-- idempotente.
CREATE TABLE IF NOT EXISTS eventos_pasarela (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pasarela       VARCHAR(20) NOT NULL DEFAULT 'WOMPI',
  evento_id      VARCHAR(120),          -- id/timestamp del evento del lado de la pasarela
  tipo           VARCHAR(60),           -- transaction.updated, nequi_token.updated…
  referencia     VARCHAR(64),
  transaccion_id UUID REFERENCES transacciones_pasarela(id) ON DELETE SET NULL,
  firma_valida   BOOLEAN NOT NULL DEFAULT false,
  procesado      BOOLEAN NOT NULL DEFAULT false,
  error          TEXT,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eventos_pasarela_unico
  ON eventos_pasarela(pasarela, evento_id) WHERE evento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eventos_pasarela_ref
  ON eventos_pasarela(referencia, created_at DESC);

-- ── Aplicar una transacción aprobada al cobro ────────────────────────────────
-- Crea el pago VERIFICADO y deja que `recalc_cobro_hogar` actualice saldo y
-- estado. Es idempotente: si la transacción ya tiene pago, no hace nada.
CREATE OR REPLACE FUNCTION public.aplicar_pago_pasarela(p_transaccion UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t        RECORD;
  v_metodo UUID;
  v_pago   UUID;
BEGIN
  SELECT * INTO t FROM transacciones_pasarela WHERE id = p_transaccion FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transacción % no existe', p_transaccion;
  END IF;

  -- Ya se aplicó, o todavía no está aprobada: no hay nada que hacer.
  IF t.pago_id IS NOT NULL THEN RETURN t.pago_id; END IF;
  IF t.estado <> 'APROBADA' THEN RETURN NULL; END IF;

  SELECT id INTO v_metodo FROM metodos_pago_hogar
   WHERE codigo = CASE WHEN t.metodo = 'PSE' THEN 'PSE' ELSE 'LINK' END
   LIMIT 1;

  INSERT INTO pagos_hogar (
    cobro_id, cliente_id, metodo_id, metodo_nombre, monto, referencia,
    fecha_pago, origen, estado, notas, verificado_at
  ) VALUES (
    t.cobro_id, t.cliente_id, v_metodo,
    COALESCE(t.metodo, 'Pago en línea'), t.monto, t.referencia,
    CURRENT_DATE, 'PASARELA', 'VERIFICADO',
    'Pago en línea confirmado por ' || t.pasarela || ' (' || COALESCE(t.id_pasarela, 's/n') || ')',
    NOW()
  )
  RETURNING id INTO v_pago;

  UPDATE transacciones_pasarela
     SET pago_id = v_pago, aprobada_at = COALESCE(aprobada_at, NOW())
   WHERE id = p_transaccion;

  -- El cliente se entera por la bandeja del portal (y por correo si está activo).
  PERFORM public.avisar_cliente(
    t.cliente_id, 'PAGO_VERIFICADO', 'Recibimos tu pago',
    'Confirmamos tu pago en línea por $' || TRIM(TO_CHAR(t.monto, '999G999G999')) || '.',
    '/portal/pagos/' || t.cobro_id::TEXT
  );

  RETURN v_pago;
END $fn$;

-- ── Métodos de pago visibles al cliente ──────────────────────────────────────
INSERT INTO metodos_pago_hogar (codigo, nombre, tipo, icono, instrucciones, requiere_comprobante, requiere_referencia, orden)
VALUES
  ('PSE', 'PSE — débito desde tu banco', 'PASARELA', '🏛️',
   'Te llevamos al portal de tu banco para autorizar el débito. Cuando el banco confirme, el pago queda aplicado solo.',
   false, false, 6)
ON CONFLICT (codigo) DO NOTHING;

UPDATE metodos_pago_hogar
   SET nombre = 'Pago en línea (tarjeta, Nequi o Bancolombia)',
       instrucciones = 'Pagas desde el portal con tarjeta, Nequi o transferencia. La confirmación es automática; no tienes que adjuntar comprobante.'
 WHERE codigo = 'LINK';

-- =============================================================================
-- STORAGE: RUT de los clientes (privado — cada cliente en su carpeta)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('rut-clientes', 'rut-clientes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS rut_cliente_insert ON storage.objects;
DROP POLICY IF EXISTS rut_cliente_read   ON storage.objects;
DROP POLICY IF EXISTS rut_cliente_delete ON storage.objects;
DROP POLICY IF EXISTS rut_staff_read     ON storage.objects;
CREATE POLICY rut_cliente_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rut-clientes'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY rut_cliente_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rut-clientes'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY rut_cliente_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rut-clientes'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY rut_staff_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rut-clientes'
         AND public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE perfiles_facturacion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transacciones_pasarela  ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_pasarela        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfil_fact_self       ON perfiles_facturacion;
DROP POLICY IF EXISTS perfil_fact_staff_read ON perfiles_facturacion;
CREATE POLICY perfil_fact_self ON perfiles_facturacion FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid())) WITH CHECK (cliente_id = (SELECT auth.uid()));
CREATE POLICY perfil_fact_staff_read ON perfiles_facturacion FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- El cliente ve sus transacciones pero no las escribe: las crea el servidor con
-- la llave de servicio, porque el monto no lo puede decidir el navegador.
DROP POLICY IF EXISTS tx_self       ON transacciones_pasarela;
DROP POLICY IF EXISTS tx_staff_read ON transacciones_pasarela;
CREATE POLICY tx_self ON transacciones_pasarela FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
CREATE POLICY tx_staff_read ON transacciones_pasarela FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- La bitácora de webhooks es solo para administración.
DROP POLICY IF EXISTS eventos_staff ON eventos_pasarela;
CREATE POLICY eventos_staff ON eventos_pasarela FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- =============================================================================
-- PERMISOS DE ROL
-- =============================================================================
UPDATE public.roles
SET permisos = permisos || '{"ver_transacciones_pasarela": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS');
