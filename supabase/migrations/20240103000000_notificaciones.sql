-- =============================================================================
-- Conserjes Inmobiliarios — Módulo de Notificaciones y Alertas
--
-- Diseño:
--   • reglas_alerta            → catálogo PARAMETRIZABLE de alertas del sistema.
--                                Define QUÉ alertas existen, su severidad, a qué
--                                roles avisan, por qué canales y con qué umbrales.
--                                Es lo que el administrador configura desde la UI.
--   • notificaciones           → instancias entregadas a cada usuario (bandeja).
--   • notificaciones_preferencias → silencios y canal por usuario.
--
-- Motor: las reglas se evalúan mediante triggers (stock, OC, contactos, usuarios)
-- que llaman a emitir_notificacion(). Activar/desactivar/ajustar una regla cambia
-- el comportamiento sin tocar código.
--
-- IDEMPOTENTE: puede correrse sobre BD nueva o re-aplicarse sin romper nada.
-- =============================================================================

-- =============================================================================
-- ENUMS
-- =============================================================================
DO $$ BEGIN CREATE TYPE tipo_notificacion AS ENUM (
  'STOCK_BAJO','STOCK_AGOTADO','OC_CREADA','OC_RECIBIDA','OC_POR_VENCER',
  'MOVIMIENTO','CONTACTO_WEB','USUARIO_NUEVO','SISTEMA'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE severidad_notificacion AS ENUM (
  'INFO','EXITO','ADVERTENCIA','CRITICA'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE estado_notificacion AS ENUM (
  'NO_LEIDA','LEIDA','ARCHIVADA'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- TABLA: reglas_alerta  (catálogo parametrizable)
-- =============================================================================
CREATE TABLE IF NOT EXISTS reglas_alerta (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        tipo_notificacion UNIQUE NOT NULL,   -- identificador estable de la alerta
  nombre        VARCHAR(150) NOT NULL,
  descripcion   TEXT,
  severidad     severidad_notificacion NOT NULL DEFAULT 'INFO',
  activa        BOOLEAN NOT NULL DEFAULT true,        -- on/off global de la alerta
  canal_app     BOOLEAN NOT NULL DEFAULT true,        -- notificación dentro de la app
  canal_email   BOOLEAN NOT NULL DEFAULT false,       -- envío por correo (reservado)
  roles_destino rol_usuario[] NOT NULL DEFAULT '{}',  -- qué roles reciben la alerta
  umbral        JSONB NOT NULL DEFAULT '{}',          -- parámetros (ej. días de aviso)
  es_sistema    BOOLEAN NOT NULL DEFAULT true,        -- regla base (no se puede borrar)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- TABLA: notificaciones  (bandeja por usuario)
-- =============================================================================
CREATE TABLE IF NOT EXISTS notificaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo         tipo_notificacion NOT NULL,
  severidad    severidad_notificacion NOT NULL DEFAULT 'INFO',
  titulo       VARCHAR(250) NOT NULL,
  descripcion  TEXT,
  entidad      VARCHAR(80),                 -- 'Producto', 'OrdenCompra', ...
  entidad_id   TEXT,                        -- id del registro relacionado
  enlace       VARCHAR(300),                -- ruta interna a la que navegar
  metadata     JSONB DEFAULT '{}',
  estado       estado_notificacion NOT NULL DEFAULT 'NO_LEIDA',
  leido_at     TIMESTAMPTZ,
  regla_codigo tipo_notificacion,           -- regla que la originó (si aplica)
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- TABLA: notificaciones_preferencias  (por usuario)
-- =============================================================================
CREATE TABLE IF NOT EXISTS notificaciones_preferencias (
  usuario_id        UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  tipos_silenciados tipo_notificacion[] NOT NULL DEFAULT '{}', -- alertas que el usuario muteó
  email_activo      BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ÍNDICES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_notif_usuario_estado ON notificaciones(usuario_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_usuario_fecha  ON notificaciones(usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_tipo           ON notificaciones(tipo, created_at DESC);

-- =============================================================================
-- TRIGGERS updated_at
-- =============================================================================
DROP TRIGGER IF EXISTS tr_reglas_alerta_upd ON reglas_alerta;
CREATE TRIGGER tr_reglas_alerta_upd BEFORE UPDATE ON reglas_alerta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_notif_pref_upd ON notificaciones_preferencias;
CREATE TRIGGER tr_notif_pref_upd BEFORE UPDATE ON notificaciones_preferencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- DATOS MAESTROS: catálogo base de alertas
-- (define QUÉ alertas existen; el admin las ajusta luego desde Configuración)
-- =============================================================================
INSERT INTO reglas_alerta (codigo, nombre, descripcion, severidad, activa, canal_app, roles_destino, umbral) VALUES
  ('STOCK_BAJO',   'Stock bajo',
   'Avisa cuando el stock de un producto cae al mínimo definido o por debajo.',
   'ADVERTENCIA', true,  true, '{SUPER_ADMIN,ADMIN,COORDINADOR_COMPRAS,BODEGUERO}', '{}'),
  ('STOCK_AGOTADO','Stock agotado',
   'Avisa cuando un producto queda en cero existencias.',
   'CRITICA',     true,  true, '{SUPER_ADMIN,ADMIN,COORDINADOR_COMPRAS,BODEGUERO}', '{}'),
  ('OC_CREADA',    'Orden de compra creada',
   'Avisa cuando se registra una nueva orden de compra.',
   'INFO',        true,  true, '{SUPER_ADMIN,ADMIN,COORDINADOR_COMPRAS}', '{}'),
  ('OC_RECIBIDA',  'Orden de compra recibida',
   'Avisa cuando una orden de compra se marca como recibida (parcial o completa).',
   'EXITO',       true,  true, '{SUPER_ADMIN,ADMIN,COORDINADOR_COMPRAS,BODEGUERO}', '{}'),
  ('OC_POR_VENCER','Orden de compra por vencer',
   'Avisa cuando una OC pendiente se acerca a su fecha de entrega.',
   'ADVERTENCIA', true,  true, '{SUPER_ADMIN,ADMIN,COORDINADOR_COMPRAS}', '{"dias_aviso": 3}'),
  ('MOVIMIENTO',   'Movimiento de inventario',
   'Avisa por cada movimiento de stock registrado (puede generar mucho ruido).',
   'INFO',        false, true, '{SUPER_ADMIN,ADMIN}', '{}'),
  ('CONTACTO_WEB', 'Nuevo contacto web',
   'Avisa cuando alguien envía el formulario del sitio corporativo.',
   'INFO',        true,  true, '{SUPER_ADMIN,ADMIN}', '{}'),
  ('USUARIO_NUEVO','Nuevo usuario',
   'Avisa cuando se da de alta un nuevo usuario en el sistema.',
   'INFO',        true,  true, '{SUPER_ADMIN,ADMIN}', '{}'),
  ('SISTEMA',      'Mensaje del sistema',
   'Notificaciones manuales o anuncios generales del sistema.',
   'INFO',        true,  true, '{SUPER_ADMIN,ADMIN,SUPERVISOR,COORDINADOR_COMPRAS,BODEGUERO,AUDITOR,OPERADOR_SEDE}', '{}')
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE reglas_alerta              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones_preferencias ENABLE ROW LEVEL SECURITY;

-- reglas_alerta: lectura para autenticados; escritura solo admin
DROP POLICY IF EXISTS auth_read_reglas ON reglas_alerta;
CREATE POLICY auth_read_reglas ON reglas_alerta FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS admin_write_reglas ON reglas_alerta;
CREATE POLICY admin_write_reglas ON reglas_alerta FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- notificaciones: cada quien ve y gestiona las suyas
DROP POLICY IF EXISTS self_read_notif ON notificaciones;
CREATE POLICY self_read_notif ON notificaciones FOR SELECT TO authenticated
  USING (usuario_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS self_update_notif ON notificaciones;
CREATE POLICY self_update_notif ON notificaciones FOR UPDATE TO authenticated
  USING (usuario_id = (SELECT auth.uid()))
  WITH CHECK (usuario_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS self_delete_notif ON notificaciones;
CREATE POLICY self_delete_notif ON notificaciones FOR DELETE TO authenticated
  USING (usuario_id = (SELECT auth.uid()));
-- INSERT: el fan-out real ocurre vía emitir_notificacion (SECURITY DEFINER).
-- Se permite insertar la propia (p. ej. mensajes manuales dirigidos a uno mismo).
DROP POLICY IF EXISTS self_insert_notif ON notificaciones;
CREATE POLICY self_insert_notif ON notificaciones FOR INSERT TO authenticated
  WITH CHECK (usuario_id = (SELECT auth.uid()));

-- preferencias: cada quien las suyas
DROP POLICY IF EXISTS self_all_pref ON notificaciones_preferencias;
CREATE POLICY self_all_pref ON notificaciones_preferencias FOR ALL TO authenticated
  USING (usuario_id = (SELECT auth.uid()))
  WITH CHECK (usuario_id = (SELECT auth.uid()));

-- =============================================================================
-- MOTOR: emitir_notificacion
-- Evalúa la regla por su código y entrega la notificación a los usuarios cuyos
-- roles coinciden con roles_destino, respetando silencios por usuario.
-- SECURITY DEFINER → puede insertar para otros usuarios y leer `usuarios`.
-- Nunca rompe la transacción del llamante (captura cualquier error).
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

  -- Regla inexistente, desactivada o sin canal app → no se emite nada
  IF NOT FOUND OR NOT v_regla.activa OR NOT v_regla.canal_app THEN
    RETURN 0;
  END IF;

  INSERT INTO notificaciones (usuario_id, tipo, severidad, titulo, descripcion, entidad, entidad_id, enlace, metadata, regla_codigo)
  SELECT u.id, v_regla.codigo, v_regla.severidad, p_titulo, p_descripcion, p_entidad, p_entidad_id, p_enlace, COALESCE(p_metadata, '{}'), v_regla.codigo
  FROM usuarios u
  LEFT JOIN notificaciones_preferencias pref ON pref.usuario_id = u.id
  WHERE u.activo
    AND u.rol = ANY (v_regla.roles_destino)
    AND (pref.tipos_silenciados IS NULL OR NOT (v_regla.codigo = ANY (pref.tipos_silenciados)));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear la operación principal por un fallo al notificar
  RETURN 0;
END $$;

-- =============================================================================
-- TRIGGER: alertas de stock (bajo / agotado) — solo al cruzar el umbral
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tr_stock_alertas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nombre TEXT;
  v_min    NUMERIC;
BEGIN
  SELECT nombre_estandar, COALESCE(stock_minimo_def, 0)
    INTO v_nombre, v_min
  FROM productos WHERE id = NEW.producto_id;

  IF v_nombre IS NULL THEN
    RETURN NEW;
  END IF;

  -- Agotado: cruza a 0
  IF NEW.cantidad_real <= 0 AND (OLD.cantidad_real IS NULL OR OLD.cantidad_real > 0) THEN
    PERFORM emitir_notificacion(
      'STOCK_AGOTADO',
      'Stock agotado: ' || v_nombre,
      'El producto se quedó sin existencias.',
      'Producto', NEW.producto_id::text, '/productos/' || NEW.producto_id::text,
      jsonb_build_object('cantidad', NEW.cantidad_real, 'minimo', v_min)
    );
  -- Bajo: cruza el mínimo (y no está agotado)
  ELSIF v_min > 0 AND NEW.cantidad_real > 0 AND NEW.cantidad_real <= v_min
        AND (OLD.cantidad_real IS NULL OR OLD.cantidad_real > v_min) THEN
    PERFORM emitir_notificacion(
      'STOCK_BAJO',
      'Stock bajo: ' || v_nombre,
      'Existencias en ' || NEW.cantidad_real || ' (mínimo ' || v_min || ').',
      'Producto', NEW.producto_id::text, '/productos/' || NEW.producto_id::text,
      jsonb_build_object('cantidad', NEW.cantidad_real, 'minimo', v_min)
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_stock_alertas ON stock;
CREATE TRIGGER tr_stock_alertas AFTER UPDATE OF cantidad_real ON stock
  FOR EACH ROW EXECUTE FUNCTION public.tr_stock_alertas();

-- =============================================================================
-- TRIGGER: órdenes de compra (creada / recibida)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tr_oc_alertas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM emitir_notificacion(
      'OC_CREADA',
      'Nueva orden de compra ' || NEW.numero_oc,
      'Se registró la orden ' || NEW.numero_oc || '.',
      'OrdenCompra', NEW.id::text, '/ordenes-compra',
      jsonb_build_object('numero_oc', NEW.numero_oc, 'estado', NEW.estado)
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.estado IN ('PARCIAL','COMPLETA')
        AND OLD.estado IS DISTINCT FROM NEW.estado THEN
    PERFORM emitir_notificacion(
      'OC_RECIBIDA',
      'OC ' || NEW.numero_oc || ' recibida (' || NEW.estado || ')',
      'La orden ' || NEW.numero_oc || ' cambió a estado ' || NEW.estado || '.',
      'OrdenCompra', NEW.id::text, '/ordenes-compra',
      jsonb_build_object('numero_oc', NEW.numero_oc, 'estado', NEW.estado)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_oc_alertas ON ordenes_compra;
CREATE TRIGGER tr_oc_alertas AFTER INSERT OR UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.tr_oc_alertas();

-- =============================================================================
-- TRIGGER: nuevo contacto web
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tr_contacto_alertas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM emitir_notificacion(
    'CONTACTO_WEB',
    'Nuevo contacto: ' || NEW.nombre,
    COALESCE(NEW.empresa || ' — ', '') || COALESCE(NEW.servicio, 'Solicitud general'),
    'ContactoWeb', NEW.id::text, '/configuracion',
    jsonb_build_object('email', NEW.email, 'telefono', NEW.telefono)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_contacto_alertas ON contactos_web;
CREATE TRIGGER tr_contacto_alertas AFTER INSERT ON contactos_web
  FOR EACH ROW EXECUTE FUNCTION public.tr_contacto_alertas();

-- =============================================================================
-- TRIGGER: nuevo usuario
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tr_usuario_alertas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM emitir_notificacion(
    'USUARIO_NUEVO',
    'Nuevo usuario: ' || NEW.nombre,
    NEW.email || ' se unió como ' || NEW.rol || '.',
    'Usuario', NEW.id::text, '/usuarios',
    jsonb_build_object('email', NEW.email, 'rol', NEW.rol)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_usuario_alertas ON usuarios;
CREATE TRIGGER tr_usuario_alertas AFTER INSERT ON usuarios
  FOR EACH ROW EXECUTE FUNCTION public.tr_usuario_alertas();

-- =============================================================================
-- REALTIME (opcional): publicar la tabla para suscripciones en vivo.
-- Se ignora si ya está publicada.
-- =============================================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notificaciones;
EXCEPTION WHEN OTHERS THEN null; END $$;
