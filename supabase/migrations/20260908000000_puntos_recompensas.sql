-- =============================================================================
-- PROGRAMA DE PUNTOS Y RECOMPENSAS
-- =============================================================================
-- El cliente acumula puntos por lo que gasta y por lo que hace (calificar,
-- referir), y los cambia por recompensas de un catálogo.
--
-- Todo es parametrizable desde el administrativo: cuántos puntos da cada mil
-- pesos, qué recompensas hay, cuánto cuestan y cuántas quedan. Nada de eso está
-- escrito en el código de la app.
--
-- Dos decisiones que sostienen el resto:
--
-- 1. **Los puntos son un libro contable, no un número.** Cada movimiento queda
--    en `movimientos_puntos` con el saldo que quedó después. `clientes.puntos`
--    es solo una copia para no sumar el histórico en cada consulta, y la
--    mantiene un trigger. Si algún día no cuadran, el ledger manda.
-- 2. **Ganar y redimir se hacen con funciones, no con UPDATE.** Son
--    SECURITY DEFINER y toman un lock sobre la fila del cliente, así dos
--    redenciones simultáneas no pueden gastar el mismo saldo dos veces.
--
-- Idempotente: se puede repetir sin efecto.
-- =============================================================================

-- ── Saldo del cliente ────────────────────────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS puntos INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN clientes.puntos IS
  'Copia del saldo para consultar rápido. La fuente de verdad es movimientos_puntos; la mantiene el trigger tr_recalc_puntos.';

-- =============================================================================
-- PARÁMETROS DEL PROGRAMA
-- =============================================================================
CREATE TABLE IF NOT EXISTS parametros_puntos (
  codigo                VARCHAR(20) PRIMARY KEY,
  activo                BOOLEAN NOT NULL DEFAULT true,
  nombre_programa       VARCHAR(60) NOT NULL DEFAULT 'Puntos Conserjes',
  -- Cuánto se gana
  puntos_por_mil        NUMERIC(6,2) NOT NULL DEFAULT 1,    -- por cada $1.000 del servicio
  puntos_por_servicio   INTEGER NOT NULL DEFAULT 0,          -- fijo adicional al completar
  puntos_por_resena     INTEGER NOT NULL DEFAULT 50,
  puntos_por_referido   INTEGER NOT NULL DEFAULT 200,
  puntos_bienvenida     INTEGER NOT NULL DEFAULT 100,
  -- Reglas de uso
  minimo_redencion      INTEGER NOT NULL DEFAULT 0,          -- saldo mínimo para poder redimir
  vigencia_meses        SMALLINT,                            -- NULL = los puntos no vencen
  valor_punto           NUMERIC(10,2) NOT NULL DEFAULT 100,  -- equivalencia en pesos, informativa
  -- Textos que ve el cliente en el portal
  titulo_portal         VARCHAR(120) NOT NULL DEFAULT 'Tus puntos',
  texto_como_ganar      TEXT,
  terminos              TEXT,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO parametros_puntos (codigo, texto_como_ganar, terminos) VALUES (
  'DEFAULT',
  'Ganas puntos cada vez que completas un servicio, cuando calificas a tu conserje y cuando un amigo que refieres pide su primer servicio.',
  'Los puntos son personales e intransferibles y no son canjeables por dinero. Las recompensas están sujetas a disponibilidad.'
) ON CONFLICT (codigo) DO NOTHING;

DROP TRIGGER IF EXISTS tr_param_puntos_upd ON parametros_puntos;
CREATE TRIGGER tr_param_puntos_upd BEFORE UPDATE ON parametros_puntos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- LIBRO DE MOVIMIENTOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS movimientos_puntos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo          VARCHAR(20) NOT NULL,   -- GANADO | REDIMIDO | EXPIRADO | AJUSTE
  -- Positivo suma, negativo resta. El signo lo pone quien llama, y los CHECK
  -- de abajo impiden que un GANADO reste o que un REDIMIDO sume.
  puntos        INTEGER NOT NULL CHECK (puntos <> 0),
  saldo_despues INTEGER NOT NULL,
  origen        VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  -- SERVICIO | RESENA | REFERIDO | BIENVENIDA | REDENCION | MANUAL | EXPIRACION
  descripcion   VARCHAR(200),
  solicitud_id  UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  redencion_id  UUID,
  expira_el     DATE,
  creado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT mov_puntos_tipo CHECK (tipo IN ('GANADO','REDIMIDO','EXPIRADO','AJUSTE')),
  CONSTRAINT mov_puntos_signo CHECK (
    (tipo = 'GANADO'   AND puntos > 0) OR
    (tipo = 'REDIMIDO' AND puntos < 0) OR
    (tipo = 'EXPIRADO' AND puntos < 0) OR
    (tipo = 'AJUSTE')
  )
);
CREATE INDEX IF NOT EXISTS idx_mov_puntos_cliente
  ON movimientos_puntos(cliente_id, created_at DESC);
-- Un servicio no puede otorgar puntos dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_puntos_servicio
  ON movimientos_puntos(solicitud_id) WHERE solicitud_id IS NOT NULL AND origen = 'SERVICIO';

-- =============================================================================
-- CATÁLOGO DE RECOMPENSAS
-- =============================================================================
CREATE TABLE IF NOT EXISTS recompensas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         VARCHAR(30) UNIQUE NOT NULL,
  nombre         VARCHAR(120) NOT NULL,
  descripcion    TEXT,
  tipo           VARCHAR(20) NOT NULL DEFAULT 'DESCUENTO_FIJO',
  -- DESCUENTO_FIJO | DESCUENTO_PCT | SERVICIO_GRATIS | BENEFICIO
  costo_puntos   INTEGER NOT NULL CHECK (costo_puntos > 0),
  -- Qué vale: pesos si es fijo, porcentaje si es pct, horas si es servicio.
  valor          NUMERIC(12,2) NOT NULL DEFAULT 0,
  icono          VARCHAR(10) DEFAULT '🎁',
  imagen_url     TEXT,
  -- NULL = sin límite. Si tiene número, se descuenta al redimir.
  stock          INTEGER,
  entregadas     INTEGER NOT NULL DEFAULT 0,
  vence_dias     SMALLINT NOT NULL DEFAULT 90,  -- vigencia del cupón que se genera
  plan_minimo    VARCHAR(20),                   -- NULL | PRIME | PRO
  destacada      BOOLEAN NOT NULL DEFAULT false,
  activo         BOOLEAN NOT NULL DEFAULT true,
  orden          SMALLINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT recompensa_tipo CHECK (tipo IN ('DESCUENTO_FIJO','DESCUENTO_PCT','SERVICIO_GRATIS','BENEFICIO')),
  CONSTRAINT recompensa_stock CHECK (stock IS NULL OR stock >= 0)
);
CREATE INDEX IF NOT EXISTS idx_recompensas_activo ON recompensas(activo, orden);

INSERT INTO recompensas (codigo, nombre, descripcion, tipo, costo_puntos, valor, icono, orden) VALUES
  ('DESC10K',  'Cupón de $10.000',        'Descuento de $10.000 en tu próximo servicio.',            'DESCUENTO_FIJO', 500,  10000, '🎟️', 1),
  ('DESC25K',  'Cupón de $25.000',        'Descuento de $25.000 en tu próximo servicio.',            'DESCUENTO_FIJO', 1200, 25000, '🎟️', 2),
  ('DESC15PC', '15% de descuento',        'Un 15% menos en el próximo servicio que agendes.',        'DESCUENTO_PCT',  900,  15,    '🏷️', 3),
  ('HORAEXTRA','Una hora extra de aseo',  'Una hora adicional sin costo en tu próximo servicio.',    'BENEFICIO',      700,  1,     '⏱️', 4),
  ('MEDIODIA', 'Medio día de aseo gratis','Un servicio de medio día sin costo.',                     'SERVICIO_GRATIS',3000, 4,     '🧹', 5)
ON CONFLICT (codigo) DO NOTHING;

DROP TRIGGER IF EXISTS tr_recompensas_upd ON recompensas;
CREATE TRIGGER tr_recompensas_upd BEFORE UPDATE ON recompensas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- REDENCIONES
-- =============================================================================
CREATE TABLE IF NOT EXISTS redenciones (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero             VARCHAR(30) UNIQUE NOT NULL,
  cliente_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recompensa_id      UUID REFERENCES recompensas(id) ON DELETE SET NULL,
  -- Copia del nombre y el costo: si mañana cambia el catálogo, la redención
  -- tiene que seguir diciendo por qué se cambió y a qué precio.
  nombre_recompensa  VARCHAR(120) NOT NULL,
  costo_puntos       INTEGER NOT NULL,
  estado             VARCHAR(20) NOT NULL DEFAULT 'SOLICITADA',
  -- SOLICITADA | APROBADA | ENTREGADA | RECHAZADA | ANULADA
  cupon_id           UUID REFERENCES cupones_cliente(id) ON DELETE SET NULL,
  codigo             VARCHAR(20),
  notas              TEXT,
  motivo_rechazo     TEXT,
  gestionado_por     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  gestionado_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT redencion_estado CHECK (estado IN ('SOLICITADA','APROBADA','ENTREGADA','RECHAZADA','ANULADA'))
);
CREATE INDEX IF NOT EXISTS idx_redenciones_cliente ON redenciones(cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redenciones_estado  ON redenciones(estado, created_at DESC);

DROP TRIGGER IF EXISTS tr_redenciones_upd ON redenciones;
CREATE TRIGGER tr_redenciones_upd BEFORE UPDATE ON redenciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- FUNCIONES
-- =============================================================================

-- El saldo sale del ledger, no de la copia.
CREATE OR REPLACE FUNCTION public.saldo_puntos(p_cliente UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(SUM(puntos), 0)::INTEGER FROM movimientos_puntos WHERE cliente_id = p_cliente;
$fn$;

-- Mantiene `clientes.puntos` al día con el ledger.
CREATE OR REPLACE FUNCTION public.recalc_puntos_cliente()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE cid UUID := COALESCE(NEW.cliente_id, OLD.cliente_id);
BEGIN
  UPDATE clientes SET puntos = public.saldo_puntos(cid) WHERE id = cid;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS tr_recalc_puntos ON movimientos_puntos;
CREATE TRIGGER tr_recalc_puntos
  AFTER INSERT OR UPDATE OR DELETE ON movimientos_puntos
  FOR EACH ROW EXECUTE FUNCTION public.recalc_puntos_cliente();

-- ── Otorgar puntos ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.otorgar_puntos(
  p_cliente     UUID,
  p_puntos      INTEGER,
  p_origen      TEXT DEFAULT 'MANUAL',
  p_descripcion TEXT DEFAULT NULL,
  p_solicitud   UUID DEFAULT NULL,
  p_creado_por  UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_param   RECORD;
  v_saldo   INTEGER;
  v_expira  DATE;
  v_id      UUID;
BEGIN
  IF p_cliente IS NULL OR p_puntos IS NULL OR p_puntos = 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF NOT FOUND OR NOT v_param.activo THEN RETURN NULL; END IF;

  -- Lock del cliente: sin esto, dos otorgamientos a la vez calcularían el mismo
  -- saldo_despues y el histórico quedaría torcido.
  PERFORM 1 FROM clientes WHERE id = p_cliente FOR UPDATE;

  v_saldo := public.saldo_puntos(p_cliente) + p_puntos;
  IF v_param.vigencia_meses IS NOT NULL AND p_puntos > 0 THEN
    v_expira := (CURRENT_DATE + (v_param.vigencia_meses || ' months')::INTERVAL)::DATE;
  END IF;

  INSERT INTO movimientos_puntos (
    cliente_id, tipo, puntos, saldo_despues, origen, descripcion,
    solicitud_id, expira_el, creado_por
  ) VALUES (
    p_cliente,
    CASE WHEN p_puntos > 0 THEN 'GANADO' ELSE 'AJUSTE' END,
    p_puntos, v_saldo, p_origen, p_descripcion, p_solicitud, v_expira, p_creado_por
  )
  -- El índice único impide otorgar dos veces por el mismo servicio.
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END $fn$;

-- ── Puntos por servicio completado ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_por_servicio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_param  RECORD;
  v_puntos INTEGER;
BEGIN
  -- Solo cuando cruza a COMPLETADA, y solo si hay cliente y precio.
  IF NEW.estado <> 'COMPLETADA' OR COALESCE(OLD.estado, '') = 'COMPLETADA' THEN RETURN NEW; END IF;
  IF NEW.cliente_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF NOT FOUND OR NOT v_param.activo THEN RETURN NEW; END IF;

  v_puntos := FLOOR(COALESCE(NEW.precio_cotizado, 0) / 1000 * v_param.puntos_por_mil)::INTEGER
              + v_param.puntos_por_servicio;

  IF v_puntos > 0 THEN
    PERFORM public.otorgar_puntos(
      NEW.cliente_id, v_puntos, 'SERVICIO',
      'Servicio ' || NEW.numero || ' completado', NEW.id, NULL
    );
    PERFORM public.avisar_cliente(
      NEW.cliente_id, 'SISTEMA', 'Ganaste ' || v_puntos || ' puntos',
      'Por tu servicio ' || NEW.numero || '. Cámbialos por recompensas cuando quieras.',
      '/portal/puntos'
    );
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_puntos_servicio ON solicitudes_servicio_hogar;
CREATE TRIGGER tr_puntos_servicio
  AFTER UPDATE OF estado ON solicitudes_servicio_hogar
  FOR EACH ROW EXECUTE FUNCTION public.puntos_por_servicio();

-- ── Puntos de bienvenida ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_bienvenida()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_param RECORD;
BEGIN
  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF FOUND AND v_param.activo AND v_param.puntos_bienvenida > 0 THEN
    PERFORM public.otorgar_puntos(
      NEW.id, v_param.puntos_bienvenida, 'BIENVENIDA', 'Puntos de bienvenida'
    );
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_puntos_bienvenida ON clientes;
CREATE TRIGGER tr_puntos_bienvenida
  AFTER INSERT ON clientes FOR EACH ROW EXECUTE FUNCTION public.puntos_bienvenida();

-- ── Consecutivo de la redención ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.siguiente_numero_redencion()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO n FROM redenciones WHERE created_at >= DATE_TRUNC('year', NOW());
  RETURN 'RD-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(n::TEXT, 5, '0');
END $fn$;

-- ── Redimir una recompensa ───────────────────────────────────────────────────
-- Todo en una transacción: valida saldo y stock, descuenta los puntos, baja el
-- stock, crea el cupón y deja la redención. Si algo falla, no pasa nada de eso.
CREATE OR REPLACE FUNCTION public.redimir_recompensa(
  p_cliente    UUID,
  p_recompensa UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_param   RECORD;
  v_r       RECORD;
  v_cli     RECORD;
  v_saldo   INTEGER;
  v_red     UUID;
  v_cupon   UUID;
  v_codigo  TEXT;
BEGIN
  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF NOT FOUND OR NOT v_param.activo THEN
    RAISE EXCEPTION 'El programa de puntos no está activo.';
  END IF;

  -- Lock del cliente: dos redenciones simultáneas no pueden gastar el mismo saldo.
  SELECT * INTO v_cli FROM clientes WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado.'; END IF;

  SELECT * INTO v_r FROM recompensas WHERE id = p_recompensa FOR UPDATE;
  IF NOT FOUND OR NOT v_r.activo THEN
    RAISE EXCEPTION 'Esa recompensa no está disponible.';
  END IF;
  IF v_r.stock IS NOT NULL AND v_r.stock <= 0 THEN
    RAISE EXCEPTION 'Esa recompensa se agotó.';
  END IF;
  IF v_r.plan_minimo IS NOT NULL AND COALESCE(v_cli.plan, 'FREE') <> v_r.plan_minimo THEN
    RAISE EXCEPTION 'Esa recompensa es exclusiva del plan %.', v_r.plan_minimo;
  END IF;

  v_saldo := public.saldo_puntos(p_cliente);
  IF v_saldo < v_r.costo_puntos THEN
    RAISE EXCEPTION 'Te faltan % puntos para esa recompensa.', v_r.costo_puntos - v_saldo;
  END IF;
  IF v_saldo < v_param.minimo_redencion THEN
    RAISE EXCEPTION 'Necesitas al menos % puntos para empezar a redimir.', v_param.minimo_redencion;
  END IF;

  v_codigo := 'RC' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

  INSERT INTO redenciones (numero, cliente_id, recompensa_id, nombre_recompensa, costo_puntos, codigo, estado)
  VALUES (public.siguiente_numero_redencion(), p_cliente, v_r.id, v_r.nombre, v_r.costo_puntos, v_codigo, 'SOLICITADA')
  RETURNING id INTO v_red;

  -- Descontar los puntos. El saldo se recalcula dentro del lock.
  INSERT INTO movimientos_puntos (cliente_id, tipo, puntos, saldo_despues, origen, descripcion, redencion_id)
  VALUES (p_cliente, 'REDIMIDO', -v_r.costo_puntos, v_saldo - v_r.costo_puntos,
          'REDENCION', 'Cambio por ' || v_r.nombre, v_red);

  IF v_r.stock IS NOT NULL THEN
    UPDATE recompensas SET stock = stock - 1, entregadas = entregadas + 1 WHERE id = v_r.id;
  ELSE
    UPDATE recompensas SET entregadas = entregadas + 1 WHERE id = v_r.id;
  END IF;

  -- Los descuentos se vuelven un cupón que el cliente ya puede usar; los demás
  -- tipos los entrega el personal y por eso quedan en SOLICITADA.
  IF v_r.tipo IN ('DESCUENTO_FIJO', 'DESCUENTO_PCT') THEN
    INSERT INTO cupones_cliente (cliente_id, codigo, descripcion, valor, origen, estado, vence_el)
    VALUES (p_cliente, v_codigo, v_r.nombre, v_r.valor, 'PROMO', 'DISPONIBLE',
            (CURRENT_DATE + (v_r.vence_dias || ' days')::INTERVAL)::DATE)
    RETURNING id INTO v_cupon;

    UPDATE redenciones SET cupon_id = v_cupon, estado = 'APROBADA', gestionado_at = NOW()
     WHERE id = v_red;
  END IF;

  PERFORM public.avisar_cliente(
    p_cliente, 'SISTEMA', 'Cambiaste tus puntos por ' || v_r.nombre,
    'Tu código es ' || v_codigo || '. Míralo en la sección de puntos del portal.',
    '/portal/puntos'
  );

  RETURN v_red;
END $fn$;

-- ── Anular una redención y devolver los puntos ───────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_redencion(
  p_redencion UUID,
  p_motivo    TEXT DEFAULT NULL,
  p_usuario   UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_red   RECORD;
  v_saldo INTEGER;
BEGIN
  SELECT * INTO v_red FROM redenciones WHERE id = p_redencion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Redención no encontrada.'; END IF;
  IF v_red.estado IN ('ANULADA', 'RECHAZADA') THEN RETURN; END IF;
  IF v_red.estado = 'ENTREGADA' THEN
    RAISE EXCEPTION 'Esa recompensa ya se entregó; no se puede anular.';
  END IF;

  PERFORM 1 FROM clientes WHERE id = v_red.cliente_id FOR UPDATE;
  v_saldo := public.saldo_puntos(v_red.cliente_id) + v_red.costo_puntos;

  INSERT INTO movimientos_puntos (cliente_id, tipo, puntos, saldo_despues, origen, descripcion, redencion_id, creado_por)
  VALUES (v_red.cliente_id, 'AJUSTE', v_red.costo_puntos, v_saldo, 'REDENCION',
          'Devolución por anular ' || v_red.numero, v_red.id, p_usuario);

  -- El cupón deja de servir y la recompensa recupera su unidad.
  IF v_red.cupon_id IS NOT NULL THEN
    UPDATE cupones_cliente SET estado = 'VENCIDO' WHERE id = v_red.cupon_id;
  END IF;
  IF v_red.recompensa_id IS NOT NULL THEN
    UPDATE recompensas
       SET entregadas = GREATEST(0, entregadas - 1),
           stock = CASE WHEN stock IS NULL THEN NULL ELSE stock + 1 END
     WHERE id = v_red.recompensa_id;
  END IF;

  UPDATE redenciones
     SET estado = 'ANULADA', motivo_rechazo = p_motivo,
         gestionado_por = p_usuario, gestionado_at = NOW()
   WHERE id = p_redencion;
END $fn$;

-- Los clientes que ya existían empiezan con sus puntos de bienvenida.
DO $$
DECLARE v_param RECORD;
BEGIN
  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF FOUND AND v_param.puntos_bienvenida > 0 THEN
    INSERT INTO movimientos_puntos (cliente_id, tipo, puntos, saldo_despues, origen, descripcion)
    SELECT c.id, 'GANADO', v_param.puntos_bienvenida, v_param.puntos_bienvenida,
           'BIENVENIDA', 'Puntos de bienvenida'
      FROM clientes c
     WHERE NOT EXISTS (
       SELECT 1 FROM movimientos_puntos m WHERE m.cliente_id = c.id AND m.origen = 'BIENVENIDA'
     );
  END IF;
END $$;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE parametros_puntos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_puntos ENABLE ROW LEVEL SECURITY;
ALTER TABLE recompensas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE redenciones        ENABLE ROW LEVEL SECURITY;

-- El cliente lee las reglas y el catálogo; no los escribe.
DROP POLICY IF EXISTS param_puntos_public ON parametros_puntos;
CREATE POLICY param_puntos_public ON parametros_puntos FOR SELECT USING (true);

DROP POLICY IF EXISTS recompensas_public ON recompensas;
CREATE POLICY recompensas_public ON recompensas FOR SELECT USING (activo);

DROP POLICY IF EXISTS param_puntos_write ON parametros_puntos;
CREATE POLICY param_puntos_write ON parametros_puntos FOR ALL TO authenticated
  USING (public.auth_permiso('parametrizar_puntos_hogar'))
  WITH CHECK (public.auth_permiso('parametrizar_puntos_hogar'));

DROP POLICY IF EXISTS recompensas_write ON recompensas;
CREATE POLICY recompensas_write ON recompensas FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_recompensas'))
  WITH CHECK (public.auth_permiso('gestionar_recompensas'));

-- El cliente ve SU ledger, pero no puede escribirlo: los puntos solo se mueven
-- por las funciones, que son SECURITY DEFINER.
DROP POLICY IF EXISTS mov_puntos_self  ON movimientos_puntos;
DROP POLICY IF EXISTS mov_puntos_staff ON movimientos_puntos;
CREATE POLICY mov_puntos_self ON movimientos_puntos FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
CREATE POLICY mov_puntos_staff ON movimientos_puntos FOR SELECT TO authenticated
  USING (public.auth_permiso('ver_puntos_hogar'));

DROP POLICY IF EXISTS redenciones_self  ON redenciones;
DROP POLICY IF EXISTS redenciones_staff ON redenciones;
CREATE POLICY redenciones_self ON redenciones FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
CREATE POLICY redenciones_staff ON redenciones FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_puntos_hogar'))
  WITH CHECK (public.auth_permiso('gestionar_puntos_hogar'));

-- =============================================================================
-- PERMISOS DE ROL
-- =============================================================================
UPDATE public.roles
SET permisos = permisos || '{
  "ver_puntos_hogar": true,
  "gestionar_puntos_hogar": true,
  "parametrizar_puntos_hogar": true,
  "gestionar_recompensas": true
}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR');

UPDATE public.roles
SET permisos = permisos || '{"ver_puntos_hogar": true, "gestionar_puntos_hogar": true}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS';

-- =============================================================================
-- QUIÉN PUEDE LLAMAR A CADA FUNCIÓN
-- =============================================================================
-- Las funciones de arriba son SECURITY DEFINER y reciben el cliente como
-- parámetro, así que por sí solas dejarían que cualquier autenticado se
-- otorgara puntos o redimiera con el saldo de otro. Aquí se cierra eso.

-- `redimir_recompensa`: el cliente solo puede redimir PARA SÍ MISMO. El
-- personal con permiso puede hacerlo a nombre de un cliente (redención en
-- mostrador), y el service role —que no tiene auth.uid()— pasa derecho.
CREATE OR REPLACE FUNCTION public.redimir_recompensa(
  p_cliente    UUID,
  p_recompensa UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_param   RECORD;
  v_r       RECORD;
  v_cli     RECORD;
  v_saldo   INTEGER;
  v_red     UUID;
  v_cupon   UUID;
  v_codigo  TEXT;
  v_quien   UUID := (SELECT auth.uid());
BEGIN
  IF v_quien IS NOT NULL
     AND v_quien <> p_cliente
     AND NOT public.auth_permiso('gestionar_puntos_hogar') THEN
    RAISE EXCEPTION 'Solo puedes redimir con tus propios puntos.';
  END IF;

  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF NOT FOUND OR NOT v_param.activo THEN
    RAISE EXCEPTION 'El programa de puntos no está activo.';
  END IF;

  SELECT * INTO v_cli FROM clientes WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado.'; END IF;

  SELECT * INTO v_r FROM recompensas WHERE id = p_recompensa FOR UPDATE;
  IF NOT FOUND OR NOT v_r.activo THEN
    RAISE EXCEPTION 'Esa recompensa no está disponible.';
  END IF;
  IF v_r.stock IS NOT NULL AND v_r.stock <= 0 THEN
    RAISE EXCEPTION 'Esa recompensa se agotó.';
  END IF;
  IF v_r.plan_minimo IS NOT NULL AND COALESCE(v_cli.plan, 'FREE') <> v_r.plan_minimo THEN
    RAISE EXCEPTION 'Esa recompensa es exclusiva del plan %.', v_r.plan_minimo;
  END IF;

  v_saldo := public.saldo_puntos(p_cliente);
  IF v_saldo < v_r.costo_puntos THEN
    RAISE EXCEPTION 'Te faltan % puntos para esa recompensa.', v_r.costo_puntos - v_saldo;
  END IF;
  IF v_saldo < v_param.minimo_redencion THEN
    RAISE EXCEPTION 'Necesitas al menos % puntos para empezar a redimir.', v_param.minimo_redencion;
  END IF;

  v_codigo := 'RC' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

  INSERT INTO redenciones (numero, cliente_id, recompensa_id, nombre_recompensa, costo_puntos, codigo, estado)
  VALUES (public.siguiente_numero_redencion(), p_cliente, v_r.id, v_r.nombre, v_r.costo_puntos, v_codigo, 'SOLICITADA')
  RETURNING id INTO v_red;

  INSERT INTO movimientos_puntos (cliente_id, tipo, puntos, saldo_despues, origen, descripcion, redencion_id)
  VALUES (p_cliente, 'REDIMIDO', -v_r.costo_puntos, v_saldo - v_r.costo_puntos,
          'REDENCION', 'Cambio por ' || v_r.nombre, v_red);

  IF v_r.stock IS NOT NULL THEN
    UPDATE recompensas SET stock = stock - 1, entregadas = entregadas + 1 WHERE id = v_r.id;
  ELSE
    UPDATE recompensas SET entregadas = entregadas + 1 WHERE id = v_r.id;
  END IF;

  IF v_r.tipo IN ('DESCUENTO_FIJO', 'DESCUENTO_PCT') THEN
    INSERT INTO cupones_cliente (cliente_id, codigo, descripcion, valor, origen, estado, vence_el)
    VALUES (p_cliente, v_codigo, v_r.nombre, v_r.valor, 'PROMO', 'DISPONIBLE',
            (CURRENT_DATE + (v_r.vence_dias || ' days')::INTERVAL)::DATE)
    RETURNING id INTO v_cupon;

    UPDATE redenciones SET cupon_id = v_cupon, estado = 'APROBADA', gestionado_at = NOW()
     WHERE id = v_red;
  END IF;

  PERFORM public.avisar_cliente(
    p_cliente, 'SISTEMA', 'Cambiaste tus puntos por ' || v_r.nombre,
    'Tu código es ' || v_codigo || '. Míralo en la sección de puntos del portal.',
    '/portal/puntos'
  );

  RETURN v_red;
END $fn$;

-- Otorgar y anular NO son para el cliente: las usa el trigger de servicio
-- completado (que corre como definer) y el personal desde el administrativo.
-- Ojo: no basta con revocarle a PUBLIC. Supabase concede EXECUTE directamente a
-- `anon` y `authenticated` sobre las funciones del esquema público, así que hay
-- que quitárselo a esos roles por nombre.
REVOKE ALL ON FUNCTION public.otorgar_puntos(UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anular_redencion(UUID, TEXT, UUID)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalc_puntos_cliente()                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puntos_por_servicio()                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puntos_bienvenida()                                    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.otorgar_puntos(UUID, INTEGER, TEXT, TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.anular_redencion(UUID, TEXT, UUID)                    TO service_role;

-- Redimir y consultar el saldo sí las llama el cliente desde el portal.
GRANT EXECUTE ON FUNCTION public.redimir_recompensa(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.saldo_puntos(UUID)             TO authenticated, service_role;
