-- =============================================================================
-- PAGOS — Servicios del Hogar (alquiler de conserjes)
--
-- Cierra el ciclo del portal de clientes: agendar -> seguimiento -> calificar ->
-- PAGAR. Todo el comportamiento del cobro es PARAMETRIZABLE desde la
-- administración (no hay valores quemados en el código de la app):
--
--   • parametros_pago_hogar  → política de cobro: IVA, anticipo, plazos, mora,
--                              consecutivo, textos y canales de aviso.
--   • metodos_pago_hogar     → catálogo de formas de pago que ve el cliente
--                              (transferencia, Nequi, efectivo, link/pasarela…)
--                              con sus instrucciones y datos de la cuenta.
--   • cobros_servicio_hogar  → la cuenta de cobro que "le llega" al cliente.
--   • cobro_items_hogar      → detalle (líneas) del cobro.
--   • pagos_hogar            → pagos aplicados a un cobro. El cliente los
--                              REPORTA (con comprobante) y el personal los
--                              VERIFICA; el saldo del cobro se recalcula solo.
--   • notificaciones_cliente → bandeja del portal (así "le llega" el cobro),
--                              con encolado de correo si está configurado.
--
-- IDEMPOTENTE: puede re-aplicarse sin romper nada.
-- =============================================================================

-- ── Parámetros de cobro (fila única) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parametros_pago_hogar (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                  VARCHAR(20)  UNIQUE NOT NULL DEFAULT 'DEFAULT',
  moneda                  VARCHAR(5)   NOT NULL DEFAULT 'COP',
  -- Impuestos
  iva_porcentaje          NUMERIC(5,2) NOT NULL DEFAULT 0,
  precios_incluyen_iva    BOOLEAN      NOT NULL DEFAULT true,
  -- Política de cobro
  requiere_anticipo       BOOLEAN      NOT NULL DEFAULT false,
  anticipo_porcentaje     NUMERIC(5,2) NOT NULL DEFAULT 50,
  permitir_pago_parcial   BOOLEAN      NOT NULL DEFAULT true,
  dias_vencimiento        SMALLINT     NOT NULL DEFAULT 3,
  recargo_mora_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- Consecutivo de la cuenta de cobro
  prefijo_cobro           VARCHAR(10)  NOT NULL DEFAULT 'CC',
  consecutivo             INTEGER      NOT NULL DEFAULT 0,
  -- Avisos al cliente
  notificar_portal        BOOLEAN      NOT NULL DEFAULT true,
  notificar_email         BOOLEAN      NOT NULL DEFAULT true,
  -- Textos que ve el cliente
  instrucciones_pago      TEXT,
  politica_cancelacion    TEXT,
  terminos                TEXT,
  -- Base del portal del cliente (apps/web). Se usa para que el enlace del
  -- correo apunte al portal y no a la app interna.
  url_portal              TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE parametros_pago_hogar ADD COLUMN IF NOT EXISTS url_portal TEXT;

INSERT INTO parametros_pago_hogar (codigo, instrucciones_pago, politica_cancelacion, terminos)
VALUES (
  'DEFAULT',
  'Realiza el pago por cualquiera de los medios habilitados y repórtalo desde el portal adjuntando el comprobante. Verificamos tu pago en horario hábil.',
  'Puedes cancelar sin costo hasta 24 horas antes del servicio. Cancelaciones posteriores pueden generar un cobro administrativo.',
  'El valor cotizado corresponde al servicio y la duración seleccionados. Tiempos adicionales se cobran por separado.'
)
ON CONFLICT (codigo) DO NOTHING;

-- ── Métodos de pago (catálogo parametrizable) ────────────────────────────────
CREATE TABLE IF NOT EXISTS metodos_pago_hogar (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                VARCHAR(30) UNIQUE NOT NULL,
  nombre                VARCHAR(100) NOT NULL,
  tipo                  VARCHAR(20)  NOT NULL DEFAULT 'TRANSFERENCIA',
  -- TRANSFERENCIA | BILLETERA | EFECTIVO | PASARELA | TARJETA | DATAFONO
  icono                 VARCHAR(10)  DEFAULT '🏦',
  instrucciones         TEXT,
  titular               VARCHAR(150),
  entidad               VARCHAR(100),      -- banco / billetera
  numero_cuenta         VARCHAR(60),
  tipo_cuenta           VARCHAR(30),       -- Ahorros | Corriente | Celular
  url_pago              TEXT,              -- link de pasarela (opcional)
  requiere_comprobante  BOOLEAN NOT NULL DEFAULT true,
  requiere_referencia   BOOLEAN NOT NULL DEFAULT false,
  visible_cliente       BOOLEAN NOT NULL DEFAULT true,
  activo                BOOLEAN NOT NULL DEFAULT true,
  orden                 SMALLINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metodos_pago_activo ON metodos_pago_hogar(activo, orden);

INSERT INTO metodos_pago_hogar (codigo, nombre, tipo, icono, instrucciones, tipo_cuenta, requiere_comprobante, requiere_referencia, orden) VALUES
  ('TRANSFERENCIA', 'Transferencia bancaria', 'TRANSFERENCIA', '🏦',
   'Transfiere el valor a la cuenta indicada y adjunta el soporte de la transacción.', 'Ahorros', true,  true,  1),
  ('NEQUI',         'Nequi',                  'BILLETERA',     '💜',
   'Envía el pago al número indicado y adjunta el pantallazo de la transacción.', 'Celular', true, true, 2),
  ('DAVIPLATA',     'Daviplata',              'BILLETERA',     '❤️',
   'Envía el pago al número indicado y adjunta el pantallazo de la transacción.', 'Celular', true, true, 3),
  ('EFECTIVO',      'Efectivo al finalizar',  'EFECTIVO',      '💵',
   'Paga en efectivo al conserje al terminar el servicio. Queda registrado cuando el personal confirma la recepción.', NULL, false, false, 4),
  ('LINK',          'Pago en línea',          'PASARELA',      '💳',
   'Paga con tarjeta o PSE desde el enlace seguro que aparece en tu cuenta de cobro.', NULL, false, false, 5)
ON CONFLICT (codigo) DO NOTHING;

-- El método de pasarela sólo se ofrece cuando el administrador cargó la URL.
UPDATE metodos_pago_hogar SET visible_cliente = false
 WHERE codigo = 'LINK' AND COALESCE(url_pago, '') = '';

-- ── Cuentas de cobro ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobros_servicio_hogar (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            VARCHAR(30) UNIQUE NOT NULL,
  solicitud_id      UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  cliente_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cliente_nombre    VARCHAR(200),
  cliente_email     VARCHAR(200),
  concepto          VARCHAR(200) NOT NULL DEFAULT 'Servicio del hogar',
  tipo              VARCHAR(20)  NOT NULL DEFAULT 'TOTAL',
  -- TOTAL | ANTICIPO | SALDO | ADICIONAL
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento         NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_porcentaje    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  iva_valor         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  pagado            NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo             NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda            VARCHAR(5)    NOT NULL DEFAULT 'COP',
  estado            VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR',
  -- BORRADOR | EMITIDO | PARCIAL | PAGADO | ANULADO
  fecha_emision     DATE,
  fecha_vencimiento DATE,
  link_pago         TEXT,
  metodo_sugerido   UUID REFERENCES metodos_pago_hogar(id) ON DELETE SET NULL,
  notas             TEXT,
  motivo_anulacion  TEXT,
  notificado_at     TIMESTAMPTZ,
  creado_por        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cobros_cliente   ON cobros_servicio_hogar(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cobros_solicitud ON cobros_servicio_hogar(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_cobros_estado    ON cobros_servicio_hogar(estado, fecha_vencimiento);

-- ── Detalle del cobro ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cobro_items_hogar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id        UUID NOT NULL REFERENCES cobros_servicio_hogar(id) ON DELETE CASCADE,
  descripcion     VARCHAR(250) NOT NULL,
  cantidad        NUMERIC(8,2)  NOT NULL DEFAULT 1,
  valor_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * valor_unitario) STORED,
  orden           SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cobro_items ON cobro_items_hogar(cobro_id, orden);

-- ── Pagos aplicados a un cobro ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos_hogar (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id          UUID NOT NULL REFERENCES cobros_servicio_hogar(id) ON DELETE CASCADE,
  cliente_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metodo_id         UUID REFERENCES metodos_pago_hogar(id) ON DELETE SET NULL,
  metodo_nombre     VARCHAR(100),
  monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  referencia        VARCHAR(120),
  comprobante_path  TEXT,                 -- ruta dentro del bucket 'comprobantes-pago'
  fecha_pago        DATE NOT NULL DEFAULT CURRENT_DATE,
  origen            VARCHAR(20) NOT NULL DEFAULT 'CLIENTE',  -- CLIENTE | STAFF | PASARELA
  estado            VARCHAR(20) NOT NULL DEFAULT 'REPORTADO',
  -- REPORTADO | VERIFICADO | RECHAZADO
  notas             TEXT,
  motivo_rechazo    TEXT,
  verificado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verificado_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagos_cobro   ON pagos_hogar(cobro_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON pagos_hogar(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_estado  ON pagos_hogar(estado, created_at DESC);

-- ── Bandeja de avisos del cliente (portal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS notificaciones_cliente (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo        VARCHAR(30) NOT NULL DEFAULT 'SISTEMA',
  -- COBRO_EMITIDO | PAGO_VERIFICADO | PAGO_RECHAZADO | SERVICIO | SISTEMA
  titulo      VARCHAR(160) NOT NULL,
  mensaje     TEXT,
  enlace      VARCHAR(300),
  leida       BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_cliente ON notificaciones_cliente(cliente_id, leida, created_at DESC);

-- ── Triggers updated_at ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_param_pago_upd ON parametros_pago_hogar;
CREATE TRIGGER tr_param_pago_upd BEFORE UPDATE ON parametros_pago_hogar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_metodos_pago_upd ON metodos_pago_hogar;
CREATE TRIGGER tr_metodos_pago_upd BEFORE UPDATE ON metodos_pago_hogar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_cobros_upd ON cobros_servicio_hogar;
CREATE TRIGGER tr_cobros_upd BEFORE UPDATE ON cobros_servicio_hogar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_pagos_upd ON pagos_hogar;
CREATE TRIGGER tr_pagos_upd BEFORE UPDATE ON pagos_hogar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- FUNCIONES
-- =============================================================================

-- Consecutivo del cobro tomando el prefijo de la parametrización.
CREATE OR REPLACE FUNCTION public.siguiente_numero_cobro()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE pref TEXT; n INTEGER;
BEGIN
  UPDATE parametros_pago_hogar
     SET consecutivo = consecutivo + 1
   WHERE codigo = 'DEFAULT'
  RETURNING prefijo_cobro, consecutivo INTO pref, n;

  IF n IS NULL THEN
    pref := 'CC';
    n := (SELECT COUNT(*) + 1 FROM cobros_servicio_hogar);
  END IF;
  RETURN pref || '-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(n::TEXT, 5, '0');
END $fn$;

-- Aviso al cliente: bandeja del portal + (opcional) cola de correo saliente.
CREATE OR REPLACE FUNCTION public.avisar_cliente(
  p_cliente_id UUID,
  p_tipo       TEXT,
  p_titulo     TEXT,
  p_mensaje    TEXT,
  p_enlace     TEXT DEFAULT NULL,
  p_email      TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_portal BOOLEAN;
  v_email  BOOLEAN;
  v_url    TEXT;
  correo   TEXT;
  enlace   TEXT;
BEGIN
  SELECT notificar_portal, notificar_email, url_portal
    INTO v_portal, v_email, v_url
    FROM parametros_pago_hogar WHERE codigo = 'DEFAULT';

  IF p_cliente_id IS NOT NULL AND COALESCE(v_portal, true) THEN
    -- En el portal el enlace se navega con el router: se guarda relativo.
    INSERT INTO notificaciones_cliente (cliente_id, tipo, titulo, mensaje, enlace)
    VALUES (p_cliente_id, p_tipo, p_titulo, p_mensaje, p_enlace);
  END IF;

  IF COALESCE(v_email, false) THEN
    correo := COALESCE(p_email, (SELECT email FROM clientes WHERE id = p_cliente_id));
    IF correo IS NOT NULL AND correo <> '' THEN
      -- En el correo el enlace debe ser absoluto y apuntar al PORTAL, no a la
      -- app interna (que es la base por defecto del buzón de correo saliente).
      enlace := CASE
        WHEN p_enlace IS NULL THEN NULL
        WHEN COALESCE(v_url, '') = '' THEN p_enlace
        ELSE RTRIM(v_url, '/') || p_enlace
      END;
      INSERT INTO correo_saliente (para, asunto, cuerpo_texto, enlace, origen, ref_id)
      VALUES (correo, p_titulo, p_mensaje, enlace, 'servicios-hogar', p_cliente_id::TEXT);
    END IF;
  END IF;
END $fn$;

-- Recalcula pagado / saldo / estado del cobro a partir de sus pagos VERIFICADOS.
CREATE OR REPLACE FUNCTION public.recalc_cobro_hogar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cid  UUID := COALESCE(NEW.cobro_id, OLD.cobro_id);
  c    RECORD;
  suma NUMERIC(12,2);
  nuevo_estado TEXT;
BEGIN
  SELECT * INTO c FROM cobros_servicio_hogar WHERE id = cid;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(monto), 0) INTO suma
    FROM pagos_hogar WHERE cobro_id = cid AND estado = 'VERIFICADO';

  nuevo_estado := c.estado;
  IF c.estado <> 'ANULADO' THEN
    IF suma <= 0 THEN
      nuevo_estado := CASE WHEN c.estado = 'BORRADOR' THEN 'BORRADOR' ELSE 'EMITIDO' END;
    ELSIF suma >= c.total THEN
      nuevo_estado := 'PAGADO';
    ELSE
      nuevo_estado := 'PARCIAL';
    END IF;
  END IF;

  UPDATE cobros_servicio_hogar
     SET pagado = suma,
         saldo  = GREATEST(total - suma, 0),
         estado = nuevo_estado
   WHERE id = cid;

  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS tr_recalc_cobro ON pagos_hogar;
CREATE TRIGGER tr_recalc_cobro
  AFTER INSERT OR UPDATE OR DELETE ON pagos_hogar
  FOR EACH ROW EXECUTE FUNCTION public.recalc_cobro_hogar();

-- Avisa al cliente cuando el pago que reportó se verifica o se rechaza.
CREATE OR REPLACE FUNCTION public.avisar_pago_hogar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE c RECORD;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN RETURN NEW; END IF;

  SELECT numero, cliente_id, cliente_email INTO c
    FROM cobros_servicio_hogar WHERE id = NEW.cobro_id;

  IF NEW.estado = 'VERIFICADO' THEN
    PERFORM public.avisar_cliente(
      c.cliente_id, 'PAGO_VERIFICADO',
      'Pago confirmado · ' || c.numero,
      'Recibimos y verificamos tu pago por $' || TO_CHAR(NEW.monto, 'FM999,999,999') || '. ¡Gracias!',
      '/portal/pagos/' || NEW.cobro_id, c.cliente_email);
  ELSIF NEW.estado = 'RECHAZADO' THEN
    PERFORM public.avisar_cliente(
      c.cliente_id, 'PAGO_RECHAZADO',
      'No pudimos validar tu pago · ' || c.numero,
      COALESCE(NEW.motivo_rechazo, 'El soporte enviado no pudo ser verificado. Revísalo e inténtalo de nuevo.'),
      '/portal/pagos/' || NEW.cobro_id, c.cliente_email);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_avisar_pago ON pagos_hogar;
CREATE TRIGGER tr_avisar_pago
  AFTER UPDATE OF estado ON pagos_hogar
  FOR EACH ROW EXECUTE FUNCTION public.avisar_pago_hogar();

-- Avisa al cliente cuando el cobro pasa a EMITIDO (así "le llega" la cuenta).
CREATE OR REPLACE FUNCTION public.avisar_cobro_hogar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  -- En un trigger de INSERT no existe OLD: hay que resolverlo por TG_OP.
  estado_anterior TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado ELSE NULL END;
BEGIN
  IF NEW.estado = 'EMITIDO'
     AND COALESCE(estado_anterior, '') <> 'EMITIDO'
     AND NEW.notificado_at IS NULL THEN
    PERFORM public.avisar_cliente(
      NEW.cliente_id, 'COBRO_EMITIDO',
      'Tienes una cuenta de cobro · ' || NEW.numero,
      NEW.concepto || ' por $' || TO_CHAR(NEW.total, 'FM999,999,999') ||
      COALESCE('. Vence el ' || TO_CHAR(NEW.fecha_vencimiento, 'DD/MM/YYYY'), '') || '.',
      '/portal/pagos/' || NEW.id, NEW.cliente_email);
    UPDATE cobros_servicio_hogar SET notificado_at = NOW() WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS tr_avisar_cobro ON cobros_servicio_hogar;
CREATE TRIGGER tr_avisar_cobro
  AFTER INSERT OR UPDATE OF estado ON cobros_servicio_hogar
  FOR EACH ROW EXECUTE FUNCTION public.avisar_cobro_hogar();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE parametros_pago_hogar  ENABLE ROW LEVEL SECURITY;
ALTER TABLE metodos_pago_hogar     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobros_servicio_hogar  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobro_items_hogar      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_hogar            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones_cliente ENABLE ROW LEVEL SECURITY;

-- Parámetros: cualquier autenticado los lee (el portal muestra plazos y textos);
-- sólo admin/supervisor los edita.
DROP POLICY IF EXISTS param_pago_read  ON parametros_pago_hogar;
DROP POLICY IF EXISTS param_pago_write ON parametros_pago_hogar;
CREATE POLICY param_pago_read ON parametros_pago_hogar FOR SELECT TO authenticated USING (true);
CREATE POLICY param_pago_write ON parametros_pago_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Métodos: el cliente ve los activos y visibles; el personal gestiona todo.
DROP POLICY IF EXISTS metodos_pago_read  ON metodos_pago_hogar;
DROP POLICY IF EXISTS metodos_pago_write ON metodos_pago_hogar;
CREATE POLICY metodos_pago_read ON metodos_pago_hogar FOR SELECT TO authenticated
  USING (
    (activo = true AND visible_cliente = true)
    OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS')
  );
CREATE POLICY metodos_pago_write ON metodos_pago_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Cobros: el cliente ve LOS SUYOS (nunca los borradores); el personal gestiona.
DROP POLICY IF EXISTS cobros_cliente_read ON cobros_servicio_hogar;
DROP POLICY IF EXISTS cobros_staff_all    ON cobros_servicio_hogar;
CREATE POLICY cobros_cliente_read ON cobros_servicio_hogar FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()) AND estado <> 'BORRADOR');
CREATE POLICY cobros_staff_all ON cobros_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- Ítems: se leen si el cobro padre es visible para quien pregunta.
DROP POLICY IF EXISTS cobro_items_read  ON cobro_items_hogar;
DROP POLICY IF EXISTS cobro_items_staff ON cobro_items_hogar;
CREATE POLICY cobro_items_read ON cobro_items_hogar FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM cobros_servicio_hogar c
     WHERE c.id = cobro_items_hogar.cobro_id
       AND c.cliente_id = (SELECT auth.uid())
       AND c.estado <> 'BORRADOR'
  ));
CREATE POLICY cobro_items_staff ON cobro_items_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- Pagos: el cliente ve los suyos y puede REPORTAR uno sobre un cobro suyo.
-- No puede editarlos después: la verificación es del personal.
DROP POLICY IF EXISTS pagos_cliente_read   ON pagos_hogar;
DROP POLICY IF EXISTS pagos_cliente_insert ON pagos_hogar;
DROP POLICY IF EXISTS pagos_staff_all      ON pagos_hogar;
CREATE POLICY pagos_cliente_read ON pagos_hogar FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
CREATE POLICY pagos_cliente_insert ON pagos_hogar FOR INSERT TO authenticated
  WITH CHECK (
    cliente_id = (SELECT auth.uid())
    AND estado = 'REPORTADO'
    AND origen = 'CLIENTE'
    AND EXISTS (
      SELECT 1 FROM cobros_servicio_hogar c
       WHERE c.id = cobro_id
         AND c.cliente_id = (SELECT auth.uid())
         AND c.estado IN ('EMITIDO','PARCIAL')
    )
  );
CREATE POLICY pagos_staff_all ON pagos_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- Avisos del portal: cada cliente sólo los suyos; el personal puede leerlos.
DROP POLICY IF EXISTS notif_cliente_self  ON notificaciones_cliente;
DROP POLICY IF EXISTS notif_cliente_staff ON notificaciones_cliente;
CREATE POLICY notif_cliente_self ON notificaciones_cliente FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid()))
  WITH CHECK (cliente_id = (SELECT auth.uid()));
CREATE POLICY notif_cliente_staff ON notificaciones_cliente FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- =============================================================================
-- STORAGE: comprobantes de pago (privado — cada cliente en su carpeta)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes-pago', 'comprobantes-pago', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS cp_cliente_insert ON storage.objects;
DROP POLICY IF EXISTS cp_cliente_read   ON storage.objects;
DROP POLICY IF EXISTS cp_staff_read     ON storage.objects;
DROP POLICY IF EXISTS cp_staff_delete   ON storage.objects;
CREATE POLICY cp_cliente_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprobantes-pago'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY cp_cliente_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'comprobantes-pago'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY cp_staff_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'comprobantes-pago'
         AND public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));
CREATE POLICY cp_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'comprobantes-pago'
         AND public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- =============================================================================
-- PERMISOS DE ROL
-- =============================================================================
UPDATE public.roles
SET permisos = permisos || '{
  "ver_pagos_hogar": true,
  "gestionar_pagos_hogar": true,
  "parametrizar_pagos_hogar": true
}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR');

UPDATE public.roles
SET permisos = permisos || '{
  "ver_pagos_hogar": true,
  "gestionar_pagos_hogar": true
}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS';
