-- =============================================================================
-- Conserjes Inmobiliarios — PARTE 2 · Historial, IA, Arqueos, Notificaciones, Codigos, Roles
-- Idempotente. Corre este bloque COMPLETO en el SQL Editor y avísame el resultado.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>> 20240102000000_historial_importaciones.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Versionado / Historial + Cargas masivas
-- Idempotente. Agrega:
--   1. historial_cambios: registro automático (antes/después) de TODO cambio
--      en las tablas clave, vía trigger genérico.
--   2. importaciones: historial de cargas masivas (lotes).
-- =============================================================================

-- =============================================================================
-- HISTORIAL DE CAMBIOS (versionado de todo)
-- =============================================================================
CREATE TABLE IF NOT EXISTS historial_cambios (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabla            TEXT NOT NULL,
  registro_id      TEXT NOT NULL,
  accion           TEXT NOT NULL,                 -- INSERT | UPDATE | DELETE
  datos_anteriores JSONB,
  datos_nuevos     JSONB,
  campos_cambiados TEXT[],
  usuario_id       UUID,
  usuario_email    TEXT,
  origen           TEXT,                          -- app | import (app.origen)
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_historial_tabla_reg ON historial_cambios(tabla, registro_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historial_created   ON historial_cambios(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historial_usuario   ON historial_cambios(usuario_id);

-- Función de trigger genérica
CREATE OR REPLACE FUNCTION public.registrar_historial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old   JSONB;
  v_new   JSONB;
  v_id    TEXT;
  v_campos TEXT[];
  v_uid   UUID;
  v_email TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD); v_id := OLD.id::text;
  ELSIF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW); v_id := NEW.id::text;
  ELSE
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_id := NEW.id::text;
    SELECT array_agg(n.key) INTO v_campos
    FROM jsonb_each(v_new) n
    WHERE n.key <> 'updated_at'
      AND n.value IS DISTINCT FROM (v_old -> n.key);
    -- Si solo cambió updated_at, no registramos ruido
    IF v_campos IS NULL OR array_length(v_campos, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO historial_cambios (tabla, registro_id, accion, datos_anteriores, datos_nuevos, campos_cambiados, usuario_id, usuario_email, origen)
  VALUES (TG_TABLE_NAME, v_id, TG_OP, v_old, v_new, v_campos, v_uid, v_email, current_setting('app.origen', true));

  RETURN COALESCE(NEW, OLD);
END $$;

-- Helper para crear el trigger en cada tabla sin repetir
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY['productos','usuarios','proveedores','sedes','stock','ordenes_compra','oc_items','grupos_contrato','precios_proveedor'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tr_hist_%1$s ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_hist_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.registrar_historial()', t);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- IMPORTACIONES (historial de cargas masivas)
-- =============================================================================
CREATE TABLE IF NOT EXISTS importaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad        TEXT NOT NULL,                  -- productos | usuarios | proveedores
  archivo_nombre TEXT,
  total          INTEGER DEFAULT 0,
  creados        INTEGER DEFAULT 0,
  actualizados   INTEGER DEFAULT 0,
  errores        INTEGER DEFAULT 0,
  detalle        JSONB,
  usuario_id     UUID,
  usuario_email  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_importaciones_created ON importaciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_importaciones_entidad ON importaciones(entidad);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE historial_cambios ENABLE ROW LEVEL SECURITY;
ALTER TABLE importaciones      ENABLE ROW LEVEL SECURITY;

-- Lectura para autenticados (la escritura de historial es por trigger DEFINER)
DROP POLICY IF EXISTS auth_read_historial ON historial_cambios;
CREATE POLICY auth_read_historial ON historial_cambios FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_read_importaciones ON importaciones;
CREATE POLICY auth_read_importaciones ON importaciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_insert_importaciones ON importaciones;
CREATE POLICY auth_insert_importaciones ON importaciones FOR INSERT TO authenticated WITH CHECK (true);


-- >>>>>>>>>>>>>>>>>>>> 20240102000000_ia_chat.sql >>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>> 20240103000000_arqueos.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Arqueo / Control de inventario físico
-- Conteo colaborativo en tiempo real, ajuste de diferencias, historial y reporte.
-- Idempotente.
-- =============================================================================

DO $$ BEGIN CREATE TYPE estado_arqueo AS ENUM ('ABIERTO','CERRADO','ANULADO'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE estado_conteo AS ENUM ('PENDIENTE','CONTADO','AJUSTADO'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Sesión de arqueo --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arqueos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre               VARCHAR(200) NOT NULL,
  descripcion          TEXT,
  estado               estado_arqueo NOT NULL DEFAULT 'ABIERTO',
  filtro_tipo          tipo_insumo,                 -- alcance opcional (por tipo de insumo)
  total_items          INTEGER DEFAULT 0,
  items_contados       INTEGER DEFAULT 0,
  items_con_diferencia INTEGER DEFAULT 0,
  valor_diferencia     DECIMAL(16,2) DEFAULT 0,     -- impacto monetario al cerrar
  creado_por           UUID,
  cerrado_por          UUID,
  cerrado_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_arqueos_estado ON arqueos(estado, created_at DESC);

-- Línea de conteo por producto --------------------------------------------------
CREATE TABLE IF NOT EXISTS arqueo_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arqueo_id        UUID NOT NULL REFERENCES arqueos(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id),
  cantidad_sistema DECIMAL(12,2) NOT NULL DEFAULT 0,     -- foto del stock al iniciar
  cantidad_fisica  DECIMAL(12,2),                        -- contada (NULL = pendiente)
  diferencia       DECIMAL(12,2) GENERATED ALWAYS AS (COALESCE(cantidad_fisica,0) - cantidad_sistema) STORED,
  precio_lista     DECIMAL(12,2),                        -- foto del precio (para valorizar)
  estado           estado_conteo NOT NULL DEFAULT 'PENDIENTE',
  observacion      TEXT,
  contado_por      UUID,
  contado_por_nombre TEXT,
  contado_at       TIMESTAMPTZ,
  UNIQUE(arqueo_id, producto_id)
);
CREATE INDEX IF NOT EXISTS idx_arqueo_items_arqueo ON arqueo_items(arqueo_id);
CREATE INDEX IF NOT EXISTS idx_arqueo_items_estado ON arqueo_items(arqueo_id, estado);

DROP TRIGGER IF EXISTS tr_arqueos_upd ON arqueos;
CREATE TRIGGER tr_arqueos_upd BEFORE UPDATE ON arqueos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- FUNCIÓN: crear_arqueo — crea la sesión y toma la foto del inventario
-- =============================================================================
CREATE OR REPLACE FUNCTION public.crear_arqueo(
  p_nombre      TEXT,
  p_descripcion TEXT DEFAULT NULL,
  p_filtro      tipo_insumo DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  UUID;
  v_rol rol_usuario;
  v_n   INTEGER;
BEGIN
  v_rol := public.auth_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR') THEN
    RAISE EXCEPTION 'No tienes permisos para iniciar un arqueo';
  END IF;

  INSERT INTO arqueos (nombre, descripcion, filtro_tipo, creado_por)
  VALUES (p_nombre, p_descripcion, p_filtro, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO arqueo_items (arqueo_id, producto_id, cantidad_sistema, precio_lista)
  SELECT v_id, p.id, COALESCE(s.cantidad_real, 0), p.precio_lista
  FROM productos p
  LEFT JOIN stock s ON s.producto_id = p.id
  WHERE p.activo = true
    AND (p_filtro IS NULL OR p.tipo_insumo = p_filtro);

  SELECT count(*) INTO v_n FROM arqueo_items WHERE arqueo_id = v_id;
  UPDATE arqueos SET total_items = v_n WHERE id = v_id;

  RETURN v_id;
END $$;

-- =============================================================================
-- FUNCIÓN: contar_item — registra el conteo físico de una línea (colaborativo)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.contar_item(
  p_item     UUID,
  p_cantidad DECIMAL,
  p_obs      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol    rol_usuario;
  v_estado estado_arqueo;
  v_nombre TEXT;
BEGIN
  v_rol := public.auth_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','OPERADOR_SEDE','COORDINADOR_COMPRAS') THEN
    RAISE EXCEPTION 'No tienes permisos para contar';
  END IF;

  SELECT a.estado INTO v_estado FROM arqueos a JOIN arqueo_items i ON i.arqueo_id = a.id WHERE i.id = p_item;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'Ítem de arqueo no encontrado'; END IF;
  IF v_estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El arqueo ya está cerrado'; END IF;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = auth.uid();

  UPDATE arqueo_items
  SET cantidad_fisica = p_cantidad,
      observacion = p_obs,
      estado = 'CONTADO',
      contado_por = auth.uid(),
      contado_por_nombre = COALESCE(v_nombre, 'Usuario'),
      contado_at = NOW()
  WHERE id = p_item;
END $$;

-- =============================================================================
-- FUNCIÓN: cerrar_arqueo — aplica los ajustes de stock y valoriza diferencias
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cerrar_arqueo(p_arqueo UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol   rol_usuario;
  v_estado estado_arqueo;
  v_nombre TEXT;
  r RECORD;
  v_con_dif INTEGER := 0;
  v_valor   DECIMAL(16,2) := 0;
BEGIN
  v_rol := public.auth_rol();
  IF v_rol IS NULL OR v_rol NOT IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR') THEN
    RAISE EXCEPTION 'No tienes permisos para cerrar el arqueo';
  END IF;

  SELECT estado, nombre INTO v_estado, v_nombre FROM arqueos WHERE id = p_arqueo;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'Arqueo no encontrado'; END IF;
  IF v_estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El arqueo ya fue cerrado'; END IF;

  -- Aplica ajustes solo a ítems contados con diferencia
  FOR r IN
    SELECT id, producto_id, cantidad_fisica, diferencia, COALESCE(precio_lista,0) precio
    FROM arqueo_items
    WHERE arqueo_id = p_arqueo AND estado = 'CONTADO' AND diferencia <> 0
  LOOP
    INSERT INTO movimientos (tipo, producto_id, cantidad, observacion, usuario_id, ia_origen)
    VALUES ('AJUSTE', r.producto_id, r.cantidad_fisica, 'Arqueo: ' || v_nombre, auth.uid(), false);

    INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
    VALUES (r.producto_id, r.cantidad_fisica, r.cantidad_fisica)
    ON CONFLICT (producto_id) DO UPDATE
      SET cantidad_real = EXCLUDED.cantidad_real,
          cantidad_disp = EXCLUDED.cantidad_disp,
          updated_at = NOW();

    UPDATE arqueo_items SET estado = 'AJUSTADO' WHERE id = r.id;
    v_con_dif := v_con_dif + 1;
    v_valor := v_valor + (r.diferencia * r.precio);
  END LOOP;

  UPDATE arqueos
  SET estado = 'CERRADO',
      cerrado_por = auth.uid(),
      cerrado_at = NOW(),
      items_contados = (SELECT count(*) FROM arqueo_items WHERE arqueo_id = p_arqueo AND estado IN ('CONTADO','AJUSTADO')),
      items_con_diferencia = v_con_dif,
      valor_diferencia = v_valor
  WHERE id = p_arqueo;
END $$;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE arqueos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqueo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_arqueos ON arqueos;
CREATE POLICY auth_read_arqueos ON arqueos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_arqueo_items ON arqueo_items;
CREATE POLICY auth_read_arqueo_items ON arqueo_items FOR SELECT TO authenticated USING (true);
-- Las escrituras se hacen vía funciones SECURITY DEFINER (crear/contar/cerrar).

-- =============================================================================
-- REALTIME — conteo colaborativo en vivo
-- =============================================================================
ALTER TABLE arqueo_items REPLICA IDENTITY FULL;
ALTER TABLE arqueos      REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arqueo_items;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE arqueos;
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240103000000_notificaciones.sql >>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>> 20240104000000_codigos_barras.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Código de barras / QR por producto
--
-- Añade el código escaneable real de cada producto (distinto del `codigo`
-- interno numérico del maestro). Garantiza que NO se repita entre productos y
-- registra su origen: escaneado del producto físico o generado por nosotros.
--
-- IDEMPOTENTE.
-- =============================================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras         TEXT;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras_formato VARCHAR(20);  -- QR | CODE128 | EAN13 | CODE39
ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_barras_origen  VARCHAR(20);  -- ESCANEADO | GENERADO

-- Unicidad del código escaneable (permite múltiples NULL, prohíbe duplicados).
CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_codigo_barras
  ON productos (codigo_barras)
  WHERE codigo_barras IS NOT NULL;

-- Restringe los valores de origen a los esperados.
DO $$ BEGIN
  ALTER TABLE productos ADD CONSTRAINT chk_codigo_barras_origen
    CHECK (codigo_barras_origen IS NULL OR codigo_barras_origen IN ('ESCANEADO','GENERADO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240104000000_perfil_roles_seed.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- PERFIL DE USUARIO + ROLES DE REFERENCIA
-- =============================================================================
-- 1) Bucket de avatares (idempotente).
-- 2) RPC update_mi_perfil: cada usuario edita SOLO su propia fila y SOLO los
--    campos seguros (nombre, teléfono, avatar). No puede cambiar su rol/permisos.
-- 3) Seed de roles de referencia en la tabla `roles` con permisos convenientes.
-- =============================================================================

-- ── 1) Bucket de avatares ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatares', 'avatares', true)
ON CONFLICT (id) DO NOTHING;

-- ── 2) RPC: actualizar mi perfil (campos seguros) ────────────────────────────
-- SECURITY DEFINER para poder escribir en `usuarios` sin abrir una política de
-- UPDATE general (que permitiría a un usuario auto-asignarse rol de admin).
CREATE OR REPLACE FUNCTION public.update_mi_perfil(
  p_nombre     TEXT,
  p_telefono   TEXT,
  p_avatar_url TEXT
)
RETURNS public.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fila public.usuarios;
BEGIN
  UPDATE public.usuarios
  SET nombre     = COALESCE(NULLIF(trim(p_nombre), ''), nombre),
      telefono   = NULLIF(trim(p_telefono), ''),
      avatar_url = NULLIF(trim(p_avatar_url), '')
  WHERE id = (SELECT auth.uid())
  RETURNING * INTO fila;

  RETURN fila;
END;
$$;

REVOKE ALL ON FUNCTION public.update_mi_perfil(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_mi_perfil(TEXT, TEXT, TEXT) TO authenticated;

-- ── 3) Roles de referencia ───────────────────────────────────────────────────
-- Las claves de permisos coinciden con el catálogo de la pantalla /roles.
-- Solo se almacenan los permisos en `true`; la UI completa el resto en `false`.
INSERT INTO public.roles (nombre, descripcion, permisos, activo) VALUES
  (
    'Super Administrador',
    'Control total del sistema, incluida la gestión de roles y configuración.',
    jsonb_build_object(
      'ver_productos', true, 'editar_productos', true, 'ver_stock', true, 'ajustar_stock', true,
      'ver_movimientos', true, 'crear_movimientos', true, 'usar_scanner', true,
      'ver_aprovisionamiento', true, 'editar_aprovisionamiento', true, 'ver_contratos', true,
      'editar_contratos', true, 'ver_proveedores', true, 'editar_proveedores', true,
      'ver_ordenes_compra', true, 'crear_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'subir_documentos', true, 'ver_usuarios', true, 'gestionar_usuarios', true,
      'gestionar_roles', true, 'ver_actividad_log', true, 'ver_configuracion', true, 'editar_configuracion', true,
      'usar_ia_vision', true, 'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Administrador',
    'Gestiona operación, inventario, compras y usuarios. No administra roles.',
    jsonb_build_object(
      'ver_productos', true, 'editar_productos', true, 'ver_stock', true, 'ajustar_stock', true,
      'ver_movimientos', true, 'crear_movimientos', true, 'usar_scanner', true,
      'ver_aprovisionamiento', true, 'editar_aprovisionamiento', true, 'ver_contratos', true,
      'editar_contratos', true, 'ver_proveedores', true, 'editar_proveedores', true,
      'ver_ordenes_compra', true, 'crear_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'subir_documentos', true, 'ver_usuarios', true, 'gestionar_usuarios', true,
      'ver_actividad_log', true, 'ver_configuracion', true, 'editar_configuracion', true,
      'usar_ia_vision', true, 'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Supervisor',
    'Supervisa operación y consulta indicadores. Registra movimientos.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'ver_movimientos', true, 'crear_movimientos', true,
      'ver_aprovisionamiento', true, 'ver_contratos', true, 'ver_proveedores', true,
      'ver_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'ver_usuarios', true, 'ver_actividad_log', true,
      'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Coordinador de Compras',
    'Planifica aprovisionamiento, gestiona proveedores y órdenes de compra.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true,
      'ver_aprovisionamiento', true, 'editar_aprovisionamiento', true,
      'ver_proveedores', true, 'editar_proveedores', true,
      'ver_ordenes_compra', true, 'crear_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'usar_ia_asistente', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Bodeguero',
    'Maneja stock físico, registra entradas/salidas y usa el escáner.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'ajustar_stock', true,
      'ver_movimientos', true, 'crear_movimientos', true, 'usar_scanner', true,
      'ver_documentos', true
    ),
    true
  ),
  (
    'Auditor',
    'Acceso de solo lectura a toda la operación y al log de actividad.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'ver_movimientos', true,
      'ver_aprovisionamiento', true, 'ver_contratos', true, 'ver_proveedores', true,
      'ver_ordenes_compra', true, 'ver_reportes', true,
      'ver_documentos', true, 'ver_usuarios', true, 'ver_actividad_log', true,
      'ver_configuracion', true, 'ver_ia_analisis', true
    ),
    true
  ),
  (
    'Operador de Sede',
    'Personal en sede: consulta inventario, escanea y registra movimientos básicos.',
    jsonb_build_object(
      'ver_productos', true, 'ver_stock', true, 'usar_scanner', true,
      'crear_movimientos', true, 'usar_ia_asistente', true
    ),
    true
  )
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      permisos    = EXCLUDED.permisos,
      updated_at  = NOW();


-- >>>>>>>>>>>>>>>>>>>> 20240105000000_roles_dinamicos.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- ROLES DINÁMICOS — vincular usuarios ↔ tabla `roles`
-- =============================================================================
-- Objetivo: que la asignación de rol a un usuario y sus permisos provengan de
-- la tabla `roles` (editable desde /roles) y no de valores quemados.
--
-- Compatibilidad: se conserva la columna enum `usuarios.rol` (la usan las
-- políticas RLS vía auth_rol()). Un trigger la mantiene sincronizada a partir
-- del `rol_base` del rol asignado, de modo que la seguridad a nivel BD sigue
-- funcionando aunque la UI trabaje con roles dinámicos.
-- =============================================================================

-- ── 1) Enum base por rol (para RLS) ──────────────────────────────────────────
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS rol_base public.rol_usuario;

COMMENT ON COLUMN public.roles.rol_base IS
  'Rol enum base usado por las políticas RLS. Los roles personalizados pueden dejarlo en NULL (se asume AUDITOR / mínimo privilegio).';

-- Mapear los roles de referencia a su enum base
UPDATE public.roles SET rol_base = 'SUPER_ADMIN'         WHERE nombre = 'Super Administrador'    AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'ADMIN'               WHERE nombre = 'Administrador'           AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'SUPERVISOR'          WHERE nombre = 'Supervisor'              AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'COORDINADOR_COMPRAS' WHERE nombre = 'Coordinador de Compras'  AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'BODEGUERO'           WHERE nombre = 'Bodeguero'               AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'AUDITOR'             WHERE nombre = 'Auditor'                 AND rol_base IS NULL;
UPDATE public.roles SET rol_base = 'OPERADOR_SEDE'       WHERE nombre = 'Operador de Sede'        AND rol_base IS NULL;

-- ── 2) FK usuarios.rol_id → roles ────────────────────────────────────────────
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS rol_id UUID REFERENCES public.roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_rol_id ON public.usuarios(rol_id);

-- Backfill: asignar rol_id según el enum actual de cada usuario
UPDATE public.usuarios u
SET rol_id = r.id
FROM public.roles r
WHERE r.rol_base = u.rol
  AND u.rol_id IS NULL;

-- ── 3) Mantener el enum `rol` sincronizado desde el rol asignado ─────────────
-- Así las políticas RLS existentes (auth_rol()) siguen siendo válidas.
CREATE OR REPLACE FUNCTION public.sync_usuario_rol()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rol_id IS NOT NULL THEN
    NEW.rol := COALESCE(
      (SELECT rol_base FROM public.roles WHERE id = NEW.rol_id),
      NEW.rol,
      'AUDITOR'  -- mínimo privilegio para roles personalizados sin enum base
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_usuarios_sync_rol ON public.usuarios;
CREATE TRIGGER tr_usuarios_sync_rol
  BEFORE INSERT OR UPDATE OF rol_id ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.sync_usuario_rol();

-- ── 4) Permisos efectivos del usuario autenticado (para la app) ──────────────
-- Combina los permisos del rol asignado con overrides individuales en
-- usuarios.permisos (estos últimos ganan). SECURITY DEFINER para leer `roles`.
CREATE OR REPLACE FUNCTION public.auth_permisos()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.permisos, '{}'::jsonb) || COALESCE(u.permisos, '{}'::jsonb)
  FROM public.usuarios u
  LEFT JOIN public.roles r ON r.id = u.rol_id
  WHERE u.id = (SELECT auth.uid())
$$;

GRANT EXECUTE ON FUNCTION public.auth_permisos() TO authenticated;
