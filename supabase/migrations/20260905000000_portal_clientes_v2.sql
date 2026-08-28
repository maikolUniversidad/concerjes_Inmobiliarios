-- =============================================================================
-- PORTAL DE CLIENTES v2 — Servicios del Hogar
-- Lo que la app de clientes necesita para parecerse a las apps del sector:
-- mini guía de primer ingreso, favoritos y bloqueados, direcciones y métodos de
-- pago guardados, membresía, referidos con cupones, borradores que arma la IA,
-- y el simulador de servicios para empresas.
--
-- Autorización: igual que `20260731000000_portal_clientes.sql` — la propiedad de
-- la fila (cliente_id = auth.uid()) manda; el personal interno puede leer.
-- =============================================================================

-- ── Perfil del cliente: guía, idioma, referidos, plan ────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS onboarding_visto_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idioma              VARCHAR(5)  NOT NULL DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS codigo_referido     VARCHAR(12),
  ADD COLUMN IF NOT EXISTS referido_por        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan                VARCHAR(20) NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS plan_hasta          DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_codigo_referido
  ON clientes(codigo_referido) WHERE codigo_referido IS NOT NULL;

-- Código de referido: 2 letras + 5 dígitos, único, generado al vuelo.
CREATE OR REPLACE FUNCTION public.generar_codigo_referido()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE cod TEXT; intentos INT := 0;
BEGIN
  LOOP
    cod := CHR(65 + FLOOR(RANDOM() * 26)::INT)
        || CHR(65 + FLOOR(RANDOM() * 26)::INT)
        || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM clientes WHERE codigo_referido = cod);
    intentos := intentos + 1;
    IF intentos > 20 THEN
      cod := 'CI' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0');
      EXIT;
    END IF;
  END LOOP;
  RETURN cod;
END $fn$;

CREATE OR REPLACE FUNCTION public.asignar_codigo_referido()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.codigo_referido IS NULL THEN
    NEW.codigo_referido := public.generar_codigo_referido();
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_clientes_codigo_referido ON clientes;
CREATE TRIGGER tr_clientes_codigo_referido
  BEFORE INSERT ON clientes FOR EACH ROW EXECUTE FUNCTION public.asignar_codigo_referido();

-- Los clientes que ya existían se quedaron sin código: se los damos ahora.
UPDATE clientes SET codigo_referido = public.generar_codigo_referido()
 WHERE codigo_referido IS NULL;

-- ── Planes de membresía ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planes_membresia (
  codigo          VARCHAR(20) PRIMARY KEY,       -- FREE | PRIME | PRO
  nombre          VARCHAR(60)  NOT NULL,
  precio_mensual  NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento_pct   NUMERIC(5,2)  NOT NULL DEFAULT 0,   -- descuento por servicio
  beneficios      TEXT[]        NOT NULL DEFAULT '{}',
  destacado       BOOLEAN       NOT NULL DEFAULT false,
  activo          BOOLEAN       NOT NULL DEFAULT true,
  orden           SMALLINT      NOT NULL DEFAULT 0
);

INSERT INTO planes_membresia (codigo, nombre, precio_mensual, descuento_pct, beneficios, destacado, orden) VALUES
  ('FREE',  'Plan Free',  0,      0,  ARRAY[
     'Tarifas regulares transparentes',
     'Sin cuota mensual',
     'Asistencia por WhatsApp',
     'Seguimiento del servicio en tiempo real',
     'Seguro incluido',
     'Pago al finalizar',
     'Cuenta de cobro electrónica'], false, 1),
  ('PRIME', 'Plan Prime', 54900, 9,  ARRAY[
     'Todo lo del Plan Free',
     'Descuento del 9% en cada servicio',
     'Conserje favorito con prioridad',
     'Reprogramación sin costo',
     'Atención prioritaria'], true, 2),
  ('PRO',   'Plan Pro',   74900, 15, ARRAY[
     'Todo lo del Plan Prime',
     'Descuento del 15% en cada servicio',
     'Servicio express garantizado el mismo día',
     'Coordinador asignado',
     'Reporte mensual de servicios'], false, 3)
ON CONFLICT (codigo) DO NOTHING;

-- ── Conserjes favoritos y bloqueados ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS concerjes_favoritos (
  cliente_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concerje_id UUID NOT NULL REFERENCES concerjes_hogar(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cliente_id, concerje_id)
);

CREATE TABLE IF NOT EXISTS concerjes_bloqueados (
  cliente_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concerje_id UUID NOT NULL REFERENCES concerjes_hogar(id) ON DELETE CASCADE,
  motivo      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cliente_id, concerje_id)
);

-- ── Métodos de pago guardados del cliente ────────────────────────────────────
-- NUNCA se guardan datos de tarjeta: solo lo que la pasarela devuelve tras
-- tokenizar en su propio dominio (marca, últimos 4, token).
CREATE TABLE IF NOT EXISTS metodos_pago_cliente (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo           VARCHAR(20) NOT NULL DEFAULT 'TARJETA',   -- TARJETA | EFECTIVO | PSE
  marca          VARCHAR(20),                              -- VISA | MASTERCARD | AMEX
  ultimos4       VARCHAR(4),
  titular        VARCHAR(120),
  token_pasarela TEXT,                                     -- token de Wompi u otra
  pasarela       VARCHAR(30),
  vence_mes      SMALLINT CHECK (vence_mes BETWEEN 1 AND 12),
  vence_anio     SMALLINT,
  es_principal   BOOLEAN NOT NULL DEFAULT false,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mpc_cliente ON metodos_pago_cliente(cliente_id, activo);

-- ── Datos de facturación ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datos_facturacion_cliente (
  cliente_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_completo  VARCHAR(200) NOT NULL,
  tipo_documento   VARCHAR(10)  NOT NULL DEFAULT 'CC',   -- CC | CE | NIT | PAS
  numero_documento VARCHAR(40)  NOT NULL,
  email_factura    VARCHAR(200),
  direccion        TEXT,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Referidos y cupones ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referidos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referidor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referido_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  codigo       VARCHAR(12) NOT NULL,
  estado       VARCHAR(20) NOT NULL DEFAULT 'REGISTRADO',
  -- REGISTRADO | PRIMER_SERVICIO | PREMIADO
  premiado_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referidos_referidor ON referidos(referidor_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referidos_referido
  ON referidos(referido_id) WHERE referido_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cupones_cliente (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  codigo      VARCHAR(20) NOT NULL,
  descripcion VARCHAR(200),
  valor       NUMERIC(12,2) NOT NULL DEFAULT 0,
  origen      VARCHAR(20) NOT NULL DEFAULT 'REFERIDO',   -- REFERIDO | PROMO | CORTESIA
  estado      VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE', -- DISPONIBLE | USADO | VENCIDO
  vence_el    DATE,
  usado_en    UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cupones_cliente ON cupones_cliente(cliente_id, estado);

-- ── Borrador de solicitud que arma el asistente ──────────────────────────────
-- El cliente cuenta qué necesita, la IA propone una orden completa y la deja
-- aquí; solo cuando la aprueba se crea la solicitud real.
CREATE TABLE IF NOT EXISTS borradores_solicitud (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  origen       VARCHAR(20) NOT NULL DEFAULT 'ASISTENTE',  -- ASISTENTE | WIZARD
  peticion     TEXT,                                      -- lo que el cliente escribió
  propuesta    JSONB NOT NULL DEFAULT '{}'::jsonb,        -- la orden propuesta
  conversacion JSONB NOT NULL DEFAULT '[]'::jsonb,        -- turnos de la charla
  estado       VARCHAR(20) NOT NULL DEFAULT 'ABIERTO',
  -- ABIERTO | APROBADO | DESCARTADO
  solicitud_id UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_borradores_cliente
  ON borradores_solicitud(cliente_id, estado, created_at DESC);

-- ── Simulador de servicios para empresas ─────────────────────────────────────
-- Edificios, centros de eventos, conjuntos: varias personas por varios meses.
-- El simulador da un estimado y crea un lead para que ventas lo cierre.
CREATE TABLE IF NOT EXISTS empresas_cotizacion (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               VARCHAR(30) UNIQUE NOT NULL,
  -- empresa
  empresa              VARCHAR(200) NOT NULL,
  nit                  VARCHAR(40),
  sector               VARCHAR(60),
  -- EDIFICIO | CONJUNTO | CENTRO_EVENTOS | OFICINAS | HOTEL | INDUSTRIA | OTRO
  ciudad               VARCHAR(100) NOT NULL DEFAULT 'Bogotá',
  direccion            TEXT,
  -- contacto
  contacto_nombre      VARCHAR(200) NOT NULL,
  contacto_cargo       VARCHAR(100),
  contacto_email       VARCHAR(200) NOT NULL,
  contacto_telefono    VARCHAR(30)  NOT NULL,
  cliente_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- alcance
  meses                SMALLINT NOT NULL DEFAULT 1 CHECK (meses > 0),
  personas             SMALLINT NOT NULL DEFAULT 1 CHECK (personas > 0),
  dias_semana          SMALLINT NOT NULL DEFAULT 5 CHECK (dias_semana BETWEEN 1 AND 7),
  horas_dia            NUMERIC(4,1) NOT NULL DEFAULT 8,
  m2_aprox             NUMERIC(10,2),
  fecha_inicio         DATE,
  requiere_insumos     BOOLEAN NOT NULL DEFAULT false,
  requiere_maquinaria  BOOLEAN NOT NULL DEFAULT false,
  turno_nocturno       BOOLEAN NOT NULL DEFAULT false,
  incluye_fines_semana BOOLEAN NOT NULL DEFAULT false,
  notas                TEXT,
  -- estimado que devolvió el simulador (referencia, no es oferta en firme)
  estimado_mensual     NUMERIC(14,2),
  estimado_total       NUMERIC(14,2),
  desglose             JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- gestión comercial
  estado               VARCHAR(20) NOT NULL DEFAULT 'NUEVO',
  -- NUEVO | CONTACTADO | EN_NEGOCIACION | GANADO | PERDIDO
  asignado_a           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contactado_at        TIMESTAMPTZ,
  motivo_cierre        TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_cot_estado  ON empresas_cotizacion(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emp_cot_cliente ON empresas_cotizacion(cliente_id);

CREATE TABLE IF NOT EXISTS empresas_cotizacion_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id UUID NOT NULL REFERENCES empresas_cotizacion(id) ON DELETE CASCADE,
  tipo_id       UUID REFERENCES tipos_servicio_hogar(id) ON DELETE SET NULL,
  descripcion   VARCHAR(200) NOT NULL,
  personas      SMALLINT NOT NULL DEFAULT 1,
  horas_dia     NUMERIC(4,1) NOT NULL DEFAULT 8,
  dias_mes      SMALLINT NOT NULL DEFAULT 22,
  valor_hora    NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal_mes  NUMERIC(14,2) NOT NULL DEFAULT 0,
  orden         SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_emp_cot_items ON empresas_cotizacion_items(cotizacion_id, orden);

-- Parámetros del simulador: qué vale la hora por tipo de sector y qué recargos
-- aplican. Administrable sin tocar código.
CREATE TABLE IF NOT EXISTS parametros_simulador_empresas (
  codigo             VARCHAR(30) PRIMARY KEY,
  nombre             VARCHAR(120) NOT NULL,
  valor_hora_base    NUMERIC(12,2) NOT NULL DEFAULT 12000,
  recargo_nocturno   NUMERIC(5,2)  NOT NULL DEFAULT 35,   -- %
  recargo_fin_semana NUMERIC(5,2)  NOT NULL DEFAULT 25,   -- %
  insumos_pct        NUMERIC(5,2)  NOT NULL DEFAULT 8,    -- % sobre la mano de obra
  maquinaria_mes     NUMERIC(12,2) NOT NULL DEFAULT 350000,
  activo             BOOLEAN NOT NULL DEFAULT true,
  orden              SMALLINT NOT NULL DEFAULT 0
);

INSERT INTO parametros_simulador_empresas (codigo, nombre, valor_hora_base, orden) VALUES
  ('EDIFICIO',       'Edificio residencial',       12000, 1),
  ('CONJUNTO',       'Conjunto cerrado',           12000, 2),
  ('OFICINAS',       'Oficinas y coworking',       13500, 3),
  ('CENTRO_EVENTOS', 'Centro de eventos',          16000, 4),
  ('HOTEL',          'Hotel y hospedaje',          15000, 5),
  ('INDUSTRIA',      'Planta industrial o bodega', 17000, 6),
  ('OTRO',           'Otro',                       13000, 9)
ON CONFLICT (codigo) DO NOTHING;

-- Descuento por volumen: entre más meses contrate, mejor la tarifa.
CREATE TABLE IF NOT EXISTS descuentos_volumen_empresas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meses_desde   SMALLINT NOT NULL,
  meses_hasta   SMALLINT,
  descuento_pct NUMERIC(5,2) NOT NULL DEFAULT 0
);

INSERT INTO descuentos_volumen_empresas (meses_desde, meses_hasta, descuento_pct)
SELECT * FROM (VALUES
    (1::SMALLINT,  2::SMALLINT,    0.0::NUMERIC),
    (3::SMALLINT,  5::SMALLINT,    5.0::NUMERIC),
    (6::SMALLINT,  11::SMALLINT,  10.0::NUMERIC),
    (12::SMALLINT, NULL::SMALLINT, 15.0::NUMERIC)
  ) AS v(meses_desde, meses_hasta, descuento_pct)
WHERE NOT EXISTS (SELECT 1 FROM descuentos_volumen_empresas);

-- ── Consecutivo de la cotización ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.siguiente_numero_cotizacion_empresa()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO n FROM empresas_cotizacion
   WHERE created_at >= DATE_TRUNC('year', NOW());
  RETURN 'EMP-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(n::TEXT, 5, '0');
END $fn$;

-- ── Triggers updated_at ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_borradores_upd ON borradores_solicitud;
CREATE TRIGGER tr_borradores_upd BEFORE UPDATE ON borradores_solicitud
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_emp_cot_upd ON empresas_cotizacion;
CREATE TRIGGER tr_emp_cot_upd BEFORE UPDATE ON empresas_cotizacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_datos_fact_upd ON datos_facturacion_cliente;
CREATE TRIGGER tr_datos_fact_upd BEFORE UPDATE ON datos_facturacion_cliente
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE planes_membresia              ENABLE ROW LEVEL SECURITY;
ALTER TABLE concerjes_favoritos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE concerjes_bloqueados          ENABLE ROW LEVEL SECURITY;
ALTER TABLE metodos_pago_cliente          ENABLE ROW LEVEL SECURITY;
ALTER TABLE datos_facturacion_cliente     ENABLE ROW LEVEL SECURITY;
ALTER TABLE referidos                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cupones_cliente               ENABLE ROW LEVEL SECURITY;
ALTER TABLE borradores_solicitud          ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_cotizacion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_cotizacion_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_simulador_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE descuentos_volumen_empresas   ENABLE ROW LEVEL SECURITY;

-- Catálogos que la web pública necesita leer sin sesión.
DROP POLICY IF EXISTS planes_public ON planes_membresia;
CREATE POLICY planes_public ON planes_membresia FOR SELECT USING (activo);

DROP POLICY IF EXISTS sim_param_public ON parametros_simulador_empresas;
CREATE POLICY sim_param_public ON parametros_simulador_empresas FOR SELECT USING (activo);

DROP POLICY IF EXISTS sim_desc_public ON descuentos_volumen_empresas;
CREATE POLICY sim_desc_public ON descuentos_volumen_empresas FOR SELECT USING (true);

-- Escritura de catálogos: solo administración.
DROP POLICY IF EXISTS planes_write ON planes_membresia;
CREATE POLICY planes_write ON planes_membresia FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

DROP POLICY IF EXISTS sim_param_write ON parametros_simulador_empresas;
CREATE POLICY sim_param_write ON parametros_simulador_empresas FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

DROP POLICY IF EXISTS sim_desc_write ON descuentos_volumen_empresas;
CREATE POLICY sim_desc_write ON descuentos_volumen_empresas FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Tablas del cliente: cada quien gestiona lo suyo, el personal interno lee.
DROP POLICY IF EXISTS fav_self ON concerjes_favoritos;
CREATE POLICY fav_self ON concerjes_favoritos FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid())) WITH CHECK (cliente_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS blo_self ON concerjes_bloqueados;
CREATE POLICY blo_self ON concerjes_bloqueados FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid())) WITH CHECK (cliente_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS mpc_self ON metodos_pago_cliente;
CREATE POLICY mpc_self ON metodos_pago_cliente FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid())) WITH CHECK (cliente_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS fact_self ON datos_facturacion_cliente;
CREATE POLICY fact_self ON datos_facturacion_cliente FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid())) WITH CHECK (cliente_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS cupones_self ON cupones_cliente;
CREATE POLICY cupones_self ON cupones_cliente FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS borradores_self ON borradores_solicitud;
CREATE POLICY borradores_self ON borradores_solicitud FOR ALL TO authenticated
  USING (cliente_id = (SELECT auth.uid())) WITH CHECK (cliente_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS referidos_self ON referidos;
CREATE POLICY referidos_self ON referidos FOR SELECT TO authenticated
  USING (referidor_id = (SELECT auth.uid()) OR referido_id = (SELECT auth.uid()));

-- Cotizaciones de empresas: el lead lo crea el servidor (service role). El
-- cliente autenticado ve las suyas; el personal comercial ve todas.
DROP POLICY IF EXISTS emp_cot_self  ON empresas_cotizacion;
DROP POLICY IF EXISTS emp_cot_staff ON empresas_cotizacion;
CREATE POLICY emp_cot_self ON empresas_cotizacion FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
CREATE POLICY emp_cot_staff ON empresas_cotizacion FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

DROP POLICY IF EXISTS emp_cot_items_staff ON empresas_cotizacion_items;
CREATE POLICY emp_cot_items_staff ON empresas_cotizacion_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM empresas_cotizacion c WHERE c.id = cotizacion_id
                   AND (c.cliente_id = (SELECT auth.uid())
                        OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- El personal interno también necesita leer favoritos/bloqueados para asignar.
DROP POLICY IF EXISTS fav_staff_read ON concerjes_favoritos;
CREATE POLICY fav_staff_read ON concerjes_favoritos FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','OPERADOR_SEDE'));

DROP POLICY IF EXISTS blo_staff_read ON concerjes_bloqueados;
CREATE POLICY blo_staff_read ON concerjes_bloqueados FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','OPERADOR_SEDE'));

-- =============================================================================
-- PRECIOS DEL PORTAL — recargos y descuentos parametrizables
-- El wizard de solicitud y el asistente muestran el precio en vivo; las reglas
-- viven aquí para poder ajustarlas sin desplegar.
-- =============================================================================
CREATE TABLE IF NOT EXISTS parametros_precio_hogar (
  codigo                       VARCHAR(20) PRIMARY KEY,
  recargo_fin_semana_pct       NUMERIC(5,2) NOT NULL DEFAULT 12,
  descuento_primer_servicio_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  descuento_semanal_pct        NUMERIC(5,2) NOT NULL DEFAULT 10,
  descuento_quincenal_pct      NUMERIC(5,2) NOT NULL DEFAULT 7,
  descuento_mensual_pct        NUMERIC(5,2) NOT NULL DEFAULT 5,
  updated_at                   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO parametros_precio_hogar (codigo) VALUES ('DEFAULT')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE parametros_precio_hogar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS param_precio_public ON parametros_precio_hogar;
CREATE POLICY param_precio_public ON parametros_precio_hogar FOR SELECT USING (true);

DROP POLICY IF EXISTS param_precio_write ON parametros_precio_hogar;
CREATE POLICY param_precio_write ON parametros_precio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

DROP TRIGGER IF EXISTS tr_param_precio_upd ON parametros_precio_hogar;
CREATE TRIGGER tr_param_precio_upd BEFORE UPDATE ON parametros_precio_hogar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Recomendación de duración según el tamaño de la vivienda: es lo que el wizard
-- muestra como «Recomendado para N dormitorios» junto a cada bloque de horas.
ALTER TABLE tarifas_servicio_hogar
  ADD COLUMN IF NOT EXISTS dormitorios_recomendados SMALLINT,
  ADD COLUMN IF NOT EXISTS recomendacion            VARCHAR(120);

UPDATE tarifas_servicio_hogar SET dormitorios_recomendados = 1, recomendacion = 'Recomendado para 1 dormitorio'
 WHERE duracion_horas <= 2 AND dormitorios_recomendados IS NULL;
UPDATE tarifas_servicio_hogar SET dormitorios_recomendados = 2, recomendacion = 'Recomendado para 2 dormitorios'
 WHERE duracion_horas > 2 AND duracion_horas <= 4 AND dormitorios_recomendados IS NULL;
UPDATE tarifas_servicio_hogar SET dormitorios_recomendados = 3, recomendacion = 'Recomendado para 3 o más dormitorios'
 WHERE duracion_horas > 4 AND dormitorios_recomendados IS NULL;

-- La solicitud guarda si el servicio es para vivienda u oficina y el desglose
-- de precio con el que el cliente aceptó.
ALTER TABLE solicitudes_servicio_hogar
  ADD COLUMN IF NOT EXISTS tipo_inmueble   VARCHAR(20) NOT NULL DEFAULT 'HOGAR',  -- HOGAR | OFICINA
  ADD COLUMN IF NOT EXISTS dormitorios     SMALLINT,
  ADD COLUMN IF NOT EXISTS metodo_pago     VARCHAR(20),   -- EFECTIVO | TARJETA | TRANSFERENCIA | LINK
  ADD COLUMN IF NOT EXISTS preferencia_concerje VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLES',
  -- DISPONIBLES | FAVORITAS | ESPECIFICA
  ADD COLUMN IF NOT EXISTS desglose_precio JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS origen          VARCHAR(20) NOT NULL DEFAULT 'PORTAL';
  -- PORTAL | ASISTENTE | WEB | TELEFONO
