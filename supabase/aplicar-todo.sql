-- =============================================================================
-- Conserjes Inmobiliarios — SCRIPT CONSOLIDADO (todas las migraciones en orden)
-- Idempotente: seguro de correr completo en el SQL Editor de Supabase.
-- Generado por concatenación de supabase/migrations/*.sql en orden cronológico.
-- =============================================================================



-- >>>>>>>>>>>>>>>>>>>> 20240101000000_init.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Esquema canónico ÚNICO
-- Modelo: stock central + sedes/grupos de contrato + aprovisionamiento + OC
-- Basado en CMI Reabastecimiento (Excel maestro).
--
-- Este archivo es IDEMPOTENTE: puede correrse sobre una BD nueva o re-aplicarse
-- sobre una existente sin romper nada (IF NOT EXISTS / DROP POLICY IF EXISTS /
-- ON CONFLICT DO NOTHING). Es la única fuente de verdad del esquema.
-- =============================================================================

-- =============================================================================
-- ENUMS  (idempotentes vía DO/EXCEPTION)
-- =============================================================================
DO $$ BEGIN CREATE TYPE categoria_rotacion AS ENUM ('A','B','C','D'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE tipo_insumo AS ENUM (
  'CAFETERIA','LIQUIDOS','ASEO','EPP','PAPELERIA',
  'MAQUINARIA','JARDINERIA','REPUESTOS','NO_DISPONIBLE','OTROS'
); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE grupo_contrato AS ENUM ('CA','MO','MB','PB','AD'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE tipo_movimiento AS ENUM ('ENTRADA','SALIDA','TRASLADO','AJUSTE','DEVOLUCION'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE estado_oc AS ENUM ('BORRADOR','ENVIADA','PARCIAL','COMPLETA','ANULADA'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE rol_usuario AS ENUM (
  'SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS',
  'BODEGUERO','AUDITOR','OPERADOR_SEDE'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================================
-- TABLAS
-- =============================================================================

-- Proveedores ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proveedores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       VARCHAR(200) NOT NULL,
  nit          VARCHAR(20) UNIQUE,
  contacto     VARCHAR(200),
  telefono     VARCHAR(30),
  email        VARCHAR(200),
  logo_url     TEXT,
  es_principal BOOLEAN DEFAULT false,
  activo       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Para BD existentes (la tabla ya existía sin esta columna):
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Productos (catálogo maestro) ----------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               INTEGER UNIQUE,
  codigo            INTEGER UNIQUE,
  nombre_estandar   VARCHAR(300) NOT NULL,
  presentacion      VARCHAR(150),
  complemento       TEXT,
  tipo_insumo       tipo_insumo NOT NULL DEFAULT 'OTROS',
  cat_rotacion      categoria_rotacion NOT NULL DEFAULT 'C',
  stock_minimo_asig DECIMAL(10,2) DEFAULT 0,
  stock_minimo_def  DECIMAL(10,2) DEFAULT 0,
  stock_min_suger   DECIMAL(10,2) DEFAULT 0,
  ind_rot_general   DECIMAL(8,2),
  ind_rot_mes       DECIMAL(8,2),
  proveedor_id      UUID REFERENCES proveedores(id),
  precio_lista      DECIMAL(12,2),
  proveedor2_id     UUID REFERENCES proveedores(id),
  precio_lista2     DECIMAL(12,2),
  imagen_url        TEXT,
  activo            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Precios por proveedor (matriz de negociación) -----------------------------
CREATE TABLE IF NOT EXISTS precios_proveedor (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  precio       DECIMAL(12,2),
  porcentaje_vs_conserjes DECIMAL(6,2),
  vigente      BOOLEAN DEFAULT true,
  fecha_cotiz  DATE,
  UNIQUE(producto_id, proveedor_id)
);

-- Grupos de contrato ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS grupos_contrato (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        grupo_contrato UNIQUE NOT NULL,
  nombre        VARCHAR(200) NOT NULL,
  descripcion   TEXT,
  supervisor_id UUID,
  activo        BOOLEAN DEFAULT true
);

-- Sedes / contratos cliente --------------------------------------------------
CREATE TABLE IF NOT EXISTS sedes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id        UUID NOT NULL REFERENCES grupos_contrato(id),
  codigo_interno  VARCHAR(20),
  nombre          VARCHAR(400) NOT NULL,
  zona            VARCHAR(100),
  ciudad          VARCHAR(100) DEFAULT 'BOGOTÁ D.C.',
  col_excel       INTEGER,
  responsable_id  UUID,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Stock central --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE UNIQUE,
  cantidad_real DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_disp DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_entr DECIMAL(10,2) DEFAULT 0,
  cantidad_sal  DECIMAL(10,2) DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Pedidos por sede -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedidos_sede (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id     UUID NOT NULL REFERENCES sedes(id),
  producto_id UUID NOT NULL REFERENCES productos(id),
  periodo     DATE NOT NULL,
  cantidad    DECIMAL(10,2) NOT NULL DEFAULT 0,
  observacion TEXT,
  creado_por  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sede_id, producto_id, periodo)
);

-- Rotación / consumo histórico ----------------------------------------------
CREATE TABLE IF NOT EXISTS rotacion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES productos(id),
  grupo_id    UUID NOT NULL REFERENCES grupos_contrato(id),
  periodo     DATE NOT NULL,
  consumo     DECIMAL(10,2) NOT NULL DEFAULT 0,
  pendiente   DECIMAL(10,2) DEFAULT 0,
  UNIQUE(producto_id, grupo_id, periodo)
);

-- Aprovisionamiento / plan de compras ---------------------------------------
CREATE TABLE IF NOT EXISTS aprovisionamiento (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id      UUID NOT NULL REFERENCES productos(id),
  periodo          DATE NOT NULL,
  stock_al_inicio  DECIMAL(10,2),
  pedido_calculado DECIMAL(10,2),
  pedido_ajustado  DECIMAL(10,2),
  control_agotados INTEGER DEFAULT 0,
  sugerido_compra  DECIMAL(10,2),
  proveedor_sug_id UUID REFERENCES proveedores(id),
  precio_sugerido  DECIMAL(12,2),
  oc_pendiente     DECIMAL(10,2) DEFAULT 0,
  adicional        DECIMAL(10,2) DEFAULT 0,
  total_compras    DECIMAL(12,2),
  total_entradas   DECIMAL(10,2),
  saldo_insumos    DECIMAL(10,2),
  aprobado_por     UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, periodo)
);

-- Órdenes de compra ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_oc     VARCHAR(50) UNIQUE NOT NULL,
  proveedor_id  UUID NOT NULL REFERENCES proveedores(id),
  periodo       DATE NOT NULL,
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega DATE,
  estado        estado_oc NOT NULL DEFAULT 'BORRADOR',
  valor_total   DECIMAL(14,2),
  observaciones TEXT,
  creado_por    UUID NOT NULL,
  aprobado_por  UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oc_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_id        UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  producto_id  UUID NOT NULL REFERENCES productos(id),
  cantidad_ped DECIMAL(10,2) NOT NULL,
  cantidad_rec DECIMAL(10,2) DEFAULT 0,
  precio_unit  DECIMAL(12,2) NOT NULL,
  subtotal     DECIMAL(14,2) GENERATED ALWAYS AS (cantidad_ped * precio_unit) STORED
);

-- Movimientos ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movimientos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        tipo_movimiento NOT NULL,
  producto_id UUID NOT NULL REFERENCES productos(id),
  cantidad    DECIMAL(10,2) NOT NULL,
  sede_id     UUID REFERENCES sedes(id),
  oc_id       UUID REFERENCES ordenes_compra(id),
  periodo     DATE,
  observacion TEXT,
  usuario_id  UUID NOT NULL,
  ia_origen   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Usuarios (complementa Supabase Auth) --------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY,
  nombre        VARCHAR(200) NOT NULL,
  email         VARCHAR(200) UNIQUE NOT NULL,
  rol           rol_usuario NOT NULL DEFAULT 'AUDITOR',
  grupo_id      UUID REFERENCES grupos_contrato(id),
  sede_id       UUID REFERENCES sedes(id),
  activo        BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Contactos web (formulario del sitio corporativo) --------------------------
CREATE TABLE IF NOT EXISTS contactos_web (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(200) NOT NULL,
  empresa    VARCHAR(200),
  telefono   VARCHAR(30) NOT NULL,
  email      VARCHAR(200) NOT NULL,
  servicio   VARCHAR(100),
  mensaje    TEXT NOT NULL,
  leido      BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ÍNDICES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_productos_tipo     ON productos(tipo_insumo);
CREATE INDEX IF NOT EXISTS idx_productos_cat      ON productos(cat_rotacion);
CREATE INDEX IF NOT EXISTS idx_productos_ref      ON productos(ref);
CREATE INDEX IF NOT EXISTS idx_productos_activo   ON productos(activo);
CREATE INDEX IF NOT EXISTS idx_stock_producto     ON stock(producto_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_sede_per   ON pedidos_sede(sede_id, periodo);
CREATE INDEX IF NOT EXISTS idx_pedidos_prod_per   ON pedidos_sede(producto_id, periodo);
CREATE INDEX IF NOT EXISTS idx_rotacion_prod_per  ON rotacion(producto_id, periodo);
CREATE INDEX IF NOT EXISTS idx_rotacion_grupo_per ON rotacion(grupo_id, periodo);
CREATE INDEX IF NOT EXISTS idx_movimientos_prod   ON movimientos(producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_sede   ON movimientos(sede_id);
CREATE INDEX IF NOT EXISTS idx_sedes_grupo        ON sedes(grupo_id);
CREATE INDEX IF NOT EXISTS idx_aprov_prod_per     ON aprovisionamiento(producto_id, periodo);
CREATE INDEX IF NOT EXISTS idx_oc_items_oc        ON oc_items(oc_id);
CREATE INDEX IF NOT EXISTS idx_oc_proveedor       ON ordenes_compra(proveedor_id);

-- =============================================================================
-- TRIGGERS: updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_productos_upd ON productos;
CREATE TRIGGER tr_productos_upd BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_stock_upd ON stock;
CREATE TRIGGER tr_stock_upd     BEFORE UPDATE ON stock     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_aprov_upd ON aprovisionamiento;
CREATE TRIGGER tr_aprov_upd     BEFORE UPDATE ON aprovisionamiento FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_oc_upd ON ordenes_compra;
CREATE TRIGGER tr_oc_upd        BEFORE UPDATE ON ordenes_compra    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- HELPER: rol del usuario autenticado
-- SECURITY DEFINER para evitar recursión de RLS al consultar `usuarios` dentro
-- de las políticas. Solo devuelve el rol del PROPIO llamante (auth.uid()),
-- por lo que no expone datos de terceros.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS rol_usuario
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) $$;

-- =============================================================================
-- DATOS MAESTROS
-- =============================================================================
INSERT INTO grupos_contrato (codigo, nombre, descripcion) VALUES
  ('CA', 'C.A.', 'Transmilenio, Bibliotecas Distritales y entidades afines'),
  ('MO', 'M.O.', 'Alcaldías Locales, Ministerios y entidades públicas nacionales'),
  ('MB', 'M.B.', 'Comercio y Bases Militares — Comerbas, Fuerza Aérea'),
  ('PB', 'P.B.', 'UNAD — Universidad Nacional Abierta y a Distancia (multi-regional)'),
  ('AD', 'A.D.', 'Administración y contratos adicionales')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO proveedores (nombre, es_principal) VALUES
  ('SCOPA', true),
  ('DETALGRAF', true),
  ('MONTERREY', false),
  ('BEAUTE', false),
  ('SUMICORP', false),
  ('CAJA MENOR', false),
  ('PROVEEDOR GENERAL', false)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- RLS — Row Level Security
-- =============================================================================
ALTER TABLE proveedores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_proveedor  ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupos_contrato    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sedes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_sede       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotacion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprovisionamiento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra     ENABLE ROW LEVEL SECURITY;
ALTER TABLE oc_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contactos_web      ENABLE ROW LEVEL SECURITY;

-- Limpieza de políticas legacy (nombres de esquemas anteriores) -----------
DROP POLICY IF EXISTS admin_write_productos   ON productos;
DROP POLICY IF EXISTS admin_write_stock        ON stock;
DROP POLICY IF EXISTS admin_write_movimientos  ON movimientos;
DROP POLICY IF EXISTS admin_write_aprov         ON aprovisionamiento;
DROP POLICY IF EXISTS admin_write_oc            ON ordenes_compra;
DROP POLICY IF EXISTS admin_all_productos       ON productos;
DROP POLICY IF EXISTS admin_all_stock           ON stock;
DROP POLICY IF EXISTS admin_all_movimientos     ON movimientos;
DROP POLICY IF EXISTS admin_all_proveedores     ON proveedores;

-- Lectura general: cualquier usuario autenticado --------------------------
DROP POLICY IF EXISTS auth_read_proveedores ON proveedores;
CREATE POLICY auth_read_proveedores      ON proveedores      FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_productos ON productos;
CREATE POLICY auth_read_productos        ON productos        FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_precios ON precios_proveedor;
CREATE POLICY auth_read_precios          ON precios_proveedor FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_grupos ON grupos_contrato;
CREATE POLICY auth_read_grupos           ON grupos_contrato  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_sedes ON sedes;
CREATE POLICY auth_read_sedes            ON sedes            FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_stock ON stock;
CREATE POLICY auth_read_stock            ON stock            FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_pedidos ON pedidos_sede;
CREATE POLICY auth_read_pedidos          ON pedidos_sede     FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_rotacion ON rotacion;
CREATE POLICY auth_read_rotacion         ON rotacion         FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_aprov ON aprovisionamiento;
CREATE POLICY auth_read_aprov            ON aprovisionamiento FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_oc ON ordenes_compra;
CREATE POLICY auth_read_oc               ON ordenes_compra   FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_oc_items ON oc_items;
CREATE POLICY auth_read_oc_items         ON oc_items         FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_read_movimientos ON movimientos;
CREATE POLICY auth_read_movimientos      ON movimientos      FOR SELECT TO authenticated USING (true);

-- Escritura por rol (USING + WITH CHECK) ----------------------------------
-- Productos / proveedores / precios: admin
DROP POLICY IF EXISTS write_productos ON productos;
CREATE POLICY write_productos ON productos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS write_proveedores ON proveedores;
CREATE POLICY write_proveedores ON proveedores FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS write_precios ON precios_proveedor;
CREATE POLICY write_precios ON precios_proveedor FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));

-- Stock: admin + bodeguero
DROP POLICY IF EXISTS write_stock ON stock;
CREATE POLICY write_stock ON stock FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO'));

-- Movimientos: cualquier rol operativo puede registrar (INSERT)
DROP POLICY IF EXISTS write_movimientos ON movimientos;
CREATE POLICY write_movimientos ON movimientos FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR','OPERADOR_SEDE','COORDINADOR_COMPRAS'));

-- Pedidos sede: admin / supervisor / operador
DROP POLICY IF EXISTS write_pedidos ON pedidos_sede;
CREATE POLICY write_pedidos ON pedidos_sede FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','OPERADOR_SEDE'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','OPERADOR_SEDE'));

-- Aprovisionamiento y OC: admin / coordinador de compras
DROP POLICY IF EXISTS write_aprov ON aprovisionamiento;
CREATE POLICY write_aprov ON aprovisionamiento FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS write_oc ON ordenes_compra;
CREATE POLICY write_oc ON ordenes_compra FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS write_oc_items ON oc_items;
CREATE POLICY write_oc_items ON oc_items FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));

-- Sedes / grupos / rotación: admin gestiona
DROP POLICY IF EXISTS write_sedes ON sedes;
CREATE POLICY write_sedes ON sedes FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS write_grupos ON grupos_contrato;
CREATE POLICY write_grupos ON grupos_contrato FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS write_rotacion ON rotacion;
CREATE POLICY write_rotacion ON rotacion FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));

-- Usuarios: cada quien se ve a sí mismo; admin gestiona a todos -----------
DROP POLICY IF EXISTS self_read_usuarios ON usuarios;
CREATE POLICY self_read_usuarios ON usuarios FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS admin_write_usuarios ON usuarios;
CREATE POLICY admin_write_usuarios ON usuarios FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- Contactos web: el sitio público (anon) puede INSERTAR; admin lee/gestiona
DROP POLICY IF EXISTS anon_insert_contactos ON contactos_web;
CREATE POLICY anon_insert_contactos ON contactos_web FOR INSERT TO anon, authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS admin_read_contactos ON contactos_web;
CREATE POLICY admin_read_contactos ON contactos_web FOR SELECT TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));
DROP POLICY IF EXISTS admin_update_contactos ON contactos_web;
CREATE POLICY admin_update_contactos ON contactos_web FOR UPDATE TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- =============================================================================
-- INTEGRACIÓN CON AUTH
-- Cada usuario de Supabase Auth obtiene automáticamente una fila en `usuarios`.
-- Sin esto, auth_rol() devuelve NULL y TODAS las políticas de escritura niegan.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre, email, rol)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1)),
    NEW.email,
    'AUDITOR'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: crea `usuarios` para auth.users existentes.
-- El administrador inicial queda como SUPER_ADMIN.
INSERT INTO public.usuarios (id, nombre, email, rol)
SELECT
  u.id,
  split_part(u.email, '@', 1),
  u.email,
  CASE WHEN u.email = 'admin@conserjesinmobiliarios.com'
       THEN 'SUPER_ADMIN'::rol_usuario
       ELSE 'AUDITOR'::rol_usuario END
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- FUNCIÓN: registrar_movimiento
-- Inserta un movimiento y actualiza el stock central de forma atómica.
-- SECURITY INVOKER → respeta RLS (el llamante necesita rol con permiso de
-- escritura en movimientos y stock).
--   ENTRADA / DEVOLUCION → suma al stock
--   SALIDA               → resta del stock (piso en 0)
--   AJUSTE               → fija el stock al valor indicado (corrección de conteo)
--   TRASLADO             → registra el movimiento, no altera el stock central
-- =============================================================================
CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_producto    UUID,
  p_tipo        tipo_movimiento,
  p_cantidad    NUMERIC,
  p_sede        UUID DEFAULT NULL,
  p_observacion TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_delta NUMERIC;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  INSERT INTO movimientos (tipo, producto_id, cantidad, sede_id, observacion, usuario_id)
  VALUES (p_tipo, p_producto, p_cantidad, p_sede, p_observacion, auth.uid())
  RETURNING id INTO v_id;

  -- Garantiza que exista la fila de stock
  INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
  VALUES (p_producto, 0, 0)
  ON CONFLICT (producto_id) DO NOTHING;

  IF p_tipo = 'AJUSTE' THEN
    UPDATE stock SET cantidad_real = p_cantidad, cantidad_disp = p_cantidad, updated_at = NOW()
    WHERE producto_id = p_producto;
  ELSIF p_tipo IN ('ENTRADA', 'DEVOLUCION') THEN
    UPDATE stock SET
      cantidad_real = cantidad_real + p_cantidad,
      cantidad_disp = cantidad_disp + p_cantidad,
      updated_at = NOW()
    WHERE producto_id = p_producto;
  ELSIF p_tipo = 'SALIDA' THEN
    UPDATE stock SET
      cantidad_real = GREATEST(0, cantidad_real - p_cantidad),
      cantidad_disp = GREATEST(0, cantidad_disp - p_cantidad),
      updated_at = NOW()
    WHERE producto_id = p_producto;
  END IF;
  -- TRASLADO: no modifica el stock central

  RETURN v_id;
END $$;

-- =============================================================================
-- STORAGE — Políticas RLS para buckets públicos
-- Buckets: galeria-fotos, documentos-sst, productos-fotos
-- =============================================================================

-- galeria-fotos
DROP POLICY IF EXISTS "Public read galeria-fotos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload galeria-fotos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete galeria-fotos" ON storage.objects;

CREATE POLICY "Public read galeria-fotos" ON storage.objects
  FOR SELECT USING (bucket_id = 'galeria-fotos');
CREATE POLICY "Authenticated upload galeria-fotos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'galeria-fotos' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated delete galeria-fotos" ON storage.objects
  FOR DELETE USING (bucket_id = 'galeria-fotos' AND auth.role() = 'authenticated');

-- documentos-sst
DROP POLICY IF EXISTS "Public read documentos-sst" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload documentos-sst" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete documentos-sst" ON storage.objects;

CREATE POLICY "Public read documentos-sst" ON storage.objects
  FOR SELECT USING (bucket_id = 'documentos-sst');
CREATE POLICY "Authenticated upload documentos-sst" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'documentos-sst' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated delete documentos-sst" ON storage.objects
  FOR DELETE USING (bucket_id = 'documentos-sst' AND auth.role() = 'authenticated');

-- productos-fotos
DROP POLICY IF EXISTS "Public read productos-fotos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload productos-fotos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete productos-fotos" ON storage.objects;

CREATE POLICY "Public read productos-fotos" ON storage.objects
  FOR SELECT USING (bucket_id = 'productos-fotos');
CREATE POLICY "Authenticated upload productos-fotos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'productos-fotos' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated delete productos-fotos" ON storage.objects
  FOR DELETE USING (bucket_id = 'productos-fotos' AND auth.role() = 'authenticated');

-- =============================================================================
-- USUARIOS — columnas adicionales
-- =============================================================================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB DEFAULT '{}';

-- =============================================================================
-- ACTIVIDAD LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS actividad_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID REFERENCES usuarios(id),
  usuario_email  VARCHAR(200),
  usuario_nombre VARCHAR(200),
  accion         VARCHAR(100) NOT NULL,
  modulo         VARCHAR(80)  NOT NULL,
  entidad        VARCHAR(80),
  entidad_id     TEXT,
  descripcion    TEXT NOT NULL,
  detalle        JSONB,
  ip             VARCHAR(45),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_usuario ON actividad_log(usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_modulo  ON actividad_log(modulo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_created ON actividad_log(created_at DESC);

ALTER TABLE actividad_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_read_log"  ON actividad_log;
DROP POLICY IF EXISTS "insert_log"      ON actividad_log;
CREATE POLICY "admin_read_log" ON actividad_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.rol IN ('SUPER_ADMIN','ADMIN','AUDITOR')));
CREATE POLICY "insert_log" ON actividad_log FOR INSERT TO authenticated WITH CHECK (true);

-- =============================================================================
-- STORAGE — bucket avatares
-- =============================================================================
DROP POLICY IF EXISTS "Public read avatares"  ON storage.objects;
DROP POLICY IF EXISTS "Self upload avatar"    ON storage.objects;
DROP POLICY IF EXISTS "Self delete avatar"    ON storage.objects;
CREATE POLICY "Public read avatares" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatares');
CREATE POLICY "Self upload avatar" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatares' AND auth.role() = 'authenticated');
CREATE POLICY "Self delete avatar" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatares' AND auth.role() = 'authenticated');

-- =============================================================================
-- ROLES PERSONALIZADOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  permisos    JSONB NOT NULL DEFAULT '{}',
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Compatibilidad: si ya existía una tabla `roles` con otro esquema, garantiza
-- las columnas y la restricción única que usan las migraciones (ON CONFLICT nombre).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS nombre      VARCHAR(100);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS permisos    JSONB NOT NULL DEFAULT '{}';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS activo      BOOLEAN DEFAULT true;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();
DO $$ BEGIN
  ALTER TABLE roles ADD CONSTRAINT roles_nombre_key UNIQUE (nombre);
EXCEPTION WHEN duplicate_object THEN null; WHEN duplicate_table THEN null; END $$;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roles_select_authenticated" ON roles;
DROP POLICY IF EXISTS "roles_all_authenticated"    ON roles;
CREATE POLICY "roles_select_authenticated" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_all_authenticated"    ON roles FOR ALL    TO authenticated USING (true) WITH CHECK (true);


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


-- >>>>>>>>>>>>>>>>>>>> 20240106000000_gestion_humana.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- MÓDULO: GESTIÓN HUMANA
-- =============================================================================
-- Submódulos:
--   1) Personas  → colaboradores con su empresa usuaria asignada (CRUD + cargue masivo)
--   2) Documentos → árbol de tipos documentales + archivos por persona
-- =============================================================================

-- ── Empresas usuarias (empresas cliente donde presta servicio el personal) ───
CREATE TABLE IF NOT EXISTS empresas_usuarias (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(160) NOT NULL UNIQUE,
  nit        VARCHAR(30),
  ciudad     VARCHAR(120),
  contacto   VARCHAR(120),
  telefono   VARCHAR(30),
  email      VARCHAR(160),
  activo     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Personas (colaboradores) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc           VARCHAR(6) NOT NULL DEFAULT 'CC',   -- CC, CE, TI, PA, PEP, NIT
  documento          VARCHAR(30) NOT NULL UNIQUE,        -- clave de deduplicación
  nombres            VARCHAR(120) NOT NULL,
  apellidos          VARCHAR(120) NOT NULL,
  cargo              VARCHAR(120),
  empresa_usuaria_id UUID REFERENCES empresas_usuarias(id) ON DELETE SET NULL,
  sede_id            UUID REFERENCES sedes(id) ON DELETE SET NULL,
  fecha_ingreso      DATE,
  estado             VARCHAR(20) NOT NULL DEFAULT 'ACTIVO', -- ACTIVO, RETIRADO, SUSPENDIDO
  email              VARCHAR(160),
  telefono           VARCHAR(30),
  direccion          VARCHAR(200),
  eps                VARCHAR(120),
  arl                VARCHAR(120),
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personas_documento ON personas(documento);
CREATE INDEX IF NOT EXISTS idx_personas_empresa   ON personas(empresa_usuaria_id);
CREATE INDEX IF NOT EXISTS idx_personas_estado    ON personas(estado);
CREATE INDEX IF NOT EXISTS idx_personas_nombre    ON personas(apellidos, nombres);

-- ── Tipos documentales (árbol jerárquico, ramas y hojas ilimitadas) ──────────
CREATE TABLE IF NOT EXISTS tipos_documentales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES tipos_documentales(id) ON DELETE CASCADE,
  nombre      VARCHAR(160) NOT NULL,
  descripcion TEXT,
  orden       INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tipos_doc_parent ON tipos_documentales(parent_id, orden);

-- ── Documentos por persona ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documentos_persona (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id          UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  tipo_documental_id  UUID REFERENCES tipos_documentales(id) ON DELETE SET NULL,
  nombre_archivo      VARCHAR(255) NOT NULL,
  archivo_path        TEXT NOT NULL,              -- ruta en el bucket privado
  mime                VARCHAR(120),
  tamano              BIGINT,
  subido_por          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docper_persona ON documentos_persona(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docper_tipo    ON documentos_persona(tipo_documental_id);

-- ── Triggers updated_at ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_empresas_usuarias_upd ON empresas_usuarias;
CREATE TRIGGER tr_empresas_usuarias_upd BEFORE UPDATE ON empresas_usuarias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_personas_upd ON personas;
CREATE TRIGGER tr_personas_upd BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE empresas_usuarias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_documentales ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_persona ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado
DROP POLICY IF EXISTS gh_read_empresas ON empresas_usuarias;
CREATE POLICY gh_read_empresas ON empresas_usuarias FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gh_read_personas ON personas;
CREATE POLICY gh_read_personas ON personas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gh_read_tipos ON tipos_documentales;
CREATE POLICY gh_read_tipos ON tipos_documentales FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gh_read_docs ON documentos_persona;
CREATE POLICY gh_read_docs ON documentos_persona FOR SELECT TO authenticated USING (true);

-- Escritura: administración (SUPER_ADMIN / ADMIN / SUPERVISOR)
DROP POLICY IF EXISTS gh_write_empresas ON empresas_usuarias;
CREATE POLICY gh_write_empresas ON empresas_usuarias FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS gh_write_personas ON personas;
CREATE POLICY gh_write_personas ON personas FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS gh_write_tipos ON tipos_documentales;
CREATE POLICY gh_write_tipos ON tipos_documentales FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
DROP POLICY IF EXISTS gh_write_docs ON documentos_persona;
CREATE POLICY gh_write_docs ON documentos_persona FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- =============================================================================
-- STORAGE — bucket PRIVADO para documentos de RRHH (datos sensibles)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('gestion-humana', 'gestion-humana', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gh_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "gh_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "gh_delete_bucket" ON storage.objects;
CREATE POLICY "gh_read_bucket" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'gestion-humana');
CREATE POLICY "gh_upload_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'gestion-humana');
CREATE POLICY "gh_delete_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'gestion-humana');

-- ── Semilla mínima de tipos documentales (árbol de ejemplo) ──────────────────
DO $$
DECLARE
  r_ingreso UUID; r_afil UUID; r_contr UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tipos_documentales) THEN
    INSERT INTO tipos_documentales (nombre, descripcion, orden) VALUES
      ('Documentos de Ingreso', 'Documentación requerida al vincular', 1) RETURNING id INTO r_ingreso;
    INSERT INTO tipos_documentales (parent_id, nombre, orden) VALUES
      (r_ingreso, 'Hoja de vida', 1),
      (r_ingreso, 'Fotocopia de documento', 2),
      (r_ingreso, 'Exámenes médicos de ingreso', 3);

    INSERT INTO tipos_documentales (nombre, descripcion, orden) VALUES
      ('Afiliaciones', 'Seguridad social', 2) RETURNING id INTO r_afil;
    INSERT INTO tipos_documentales (parent_id, nombre, orden) VALUES
      (r_afil, 'EPS', 1),
      (r_afil, 'ARL', 2),
      (r_afil, 'Pensión', 3),
      (r_afil, 'Caja de compensación', 4);

    INSERT INTO tipos_documentales (nombre, descripcion, orden) VALUES
      ('Contratación', 'Documentos contractuales', 3) RETURNING id INTO r_contr;
    INSERT INTO tipos_documentales (parent_id, nombre, orden) VALUES
      (r_contr, 'Contrato firmado', 1),
      (r_contr, 'Otrosí', 2);
  END IF;
END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240106000000_sku_ubicacion_bodega.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- SKU y Ubicación en Bodega por Producto
-- =============================================================================

-- SKU interno único (CI-ASEO-0042, CI-CAF-X3B1, etc.)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS sku VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_sku
  ON productos (sku)
  WHERE sku IS NOT NULL;

-- Ubicación estructurada: pasillo, estante, nivel (se guarda como "A-02-3")
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ubicacion_bodega   VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS bodega_descripcion TEXT;

-- Índice para búsquedas por ubicación (ej: todos los de pasillo A)
CREATE INDEX IF NOT EXISTS idx_productos_ubicacion ON productos (ubicacion_bodega);

-- Función helper: genera SKU a partir de tipo_insumo + ref/codigo
-- Se puede llamar desde la app o directamente: SELECT gen_sku('ASEO', 42)
CREATE OR REPLACE FUNCTION public.gen_sku(p_tipo TEXT, p_num INT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  prefix TEXT;
  seq    TEXT;
BEGIN
  prefix := CASE upper(p_tipo)
    WHEN 'CAFETERIA'  THEN 'CAF'
    WHEN 'LIQUIDOS'   THEN 'LIQ'
    WHEN 'ASEO'       THEN 'ASE'
    WHEN 'EPP'        THEN 'EPP'
    WHEN 'PAPELERIA'  THEN 'PAP'
    WHEN 'MAQUINARIA' THEN 'MAQ'
    WHEN 'JARDINERIA' THEN 'JAR'
    WHEN 'REPUESTOS'  THEN 'REP'
    ELSE 'OTR'
  END;

  IF p_num IS NOT NULL THEN
    seq := lpad(p_num::TEXT, 4, '0');
  ELSE
    seq := lpad((floor(random() * 9000) + 1000)::TEXT, 4, '0');
  END IF;

  RETURN 'CI-' || prefix || '-' || seq;
END;
$$;


-- >>>>>>>>>>>>>>>>>>>> 20240107000000_producto_fotos.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Galería de fotos por producto (múltiples imágenes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.producto_fotos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  storage_path TEXT,           -- ruta dentro del bucket (para poder eliminar)
  orden       INT  DEFAULT 0,  -- posición en la galería
  es_principal BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_producto_fotos_producto ON public.producto_fotos (producto_id, orden);

ALTER TABLE public.producto_fotos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fotos_select" ON public.producto_fotos FOR SELECT TO authenticated USING (true);
CREATE POLICY "fotos_insert" ON public.producto_fotos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fotos_update" ON public.producto_fotos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "fotos_delete" ON public.producto_fotos FOR DELETE TO authenticated USING (true);


-- >>>>>>>>>>>>>>>>>>>> 20240107000000_tipos_refs.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- ENTRENAMIENTO DE CLASIFICACIÓN DOCUMENTAL
-- =============================================================================
-- Referencias/muestras por tipo documental. Sirven de contexto (few-shot) para
-- que la IA clasifique automáticamente los documentos que se suben.
--   origen 'muestra'    → documento de referencia subido manualmente
--   origen 'confirmado' → texto de un documento clasificado y confirmado (aprende)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tipos_documentales_refs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id      UUID NOT NULL REFERENCES tipos_documentales(id) ON DELETE CASCADE,
  texto        TEXT,                       -- palabras clave / resumen OCR
  archivo_path TEXT,                       -- ruta de la muestra en el bucket (opcional)
  origen       VARCHAR(20) NOT NULL DEFAULT 'muestra',
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiporefs_tipo ON tipos_documentales_refs(tipo_id, created_at DESC);

ALTER TABLE tipos_documentales_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gh_read_tiporefs ON tipos_documentales_refs;
CREATE POLICY gh_read_tiporefs ON tipos_documentales_refs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS gh_write_tiporefs ON tipos_documentales_refs;
CREATE POLICY gh_write_tiporefs ON tipos_documentales_refs FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));


-- >>>>>>>>>>>>>>>>>>>> 20240108000000_bodegas_ubicaciones.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Bodegas y Ubicaciones (plano físico)
-- Clasificación real de la(s) bodega(s): plano con marcadores de ubicación,
-- foto de cada estantería/zona, responsables (usuarios) y enlace a movimientos.
-- Idempotente.
-- =============================================================================

-- Bodegas / almacenes ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS bodegas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(200) NOT NULL,
  codigo         VARCHAR(30) UNIQUE,
  direccion      TEXT,
  descripcion    TEXT,
  plano_url      TEXT,                       -- imagen del plano/layout de la bodega
  responsable_id UUID REFERENCES usuarios(id),
  activo         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Ubicaciones dentro de una bodega (estantería / zona / posición) -------------
CREATE TABLE IF NOT EXISTS ubicaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bodega_id      UUID NOT NULL REFERENCES bodegas(id) ON DELETE CASCADE,
  codigo         VARCHAR(40) NOT NULL,        -- p.ej. "A-01-03"
  nombre         VARCHAR(200),                -- "Estantería A · Nivel 1"
  tipo           VARCHAR(40) DEFAULT 'ESTANTERIA', -- ESTANTERIA/ZONA/NEVERA/PALLET/VITRINA/OTRO
  descripcion    TEXT,
  foto_url       TEXT,                        -- foto real del lugar/estantería
  pos_x          NUMERIC(6,2),                -- % horizontal sobre el plano (0–100)
  pos_y          NUMERIC(6,2),                -- % vertical sobre el plano (0–100)
  responsable_id UUID REFERENCES usuarios(id),
  activo         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bodega_id, codigo)
);

-- Enlaces ---------------------------------------------------------------------
ALTER TABLE productos   ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES ubicaciones(id);
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES ubicaciones(id);

CREATE INDEX IF NOT EXISTS idx_ubicaciones_bodega ON ubicaciones(bodega_id);
CREATE INDEX IF NOT EXISTS idx_productos_ubicacion ON productos(ubicacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion ON movimientos(ubicacion_id);

-- updated_at + versionado (historial) -----------------------------------------
DROP TRIGGER IF EXISTS tr_bodegas_upd ON bodegas;
CREATE TRIGGER tr_bodegas_upd BEFORE UPDATE ON bodegas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS tr_ubic_upd ON ubicaciones;
CREATE TRIGGER tr_ubic_upd BEFORE UPDATE ON ubicaciones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t TEXT; tablas TEXT[] := ARRAY['bodegas','ubicaciones'];
BEGIN
  IF to_regproc('public.registrar_historial') IS NOT NULL THEN
    FOREACH t IN ARRAY tablas LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS tr_hist_%1$s ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_hist_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.registrar_historial()', t);
    END LOOP;
  END IF;
END $$;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE bodegas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ubicaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_bodegas ON bodegas;
CREATE POLICY auth_read_bodegas ON bodegas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS write_bodegas ON bodegas;
CREATE POLICY write_bodegas ON bodegas FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

DROP POLICY IF EXISTS auth_read_ubicaciones ON ubicaciones;
CREATE POLICY auth_read_ubicaciones ON ubicaciones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS write_ubicaciones ON ubicaciones;
CREATE POLICY write_ubicaciones ON ubicaciones FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

-- =============================================================================
-- SEED: una bodega central por defecto (si no existe ninguna)
-- =============================================================================
INSERT INTO bodegas (nombre, codigo, descripcion)
SELECT 'Bodega Central', 'CENTRAL', 'Bodega principal de Conserjes Inmobiliarios'
WHERE NOT EXISTS (SELECT 1 FROM bodegas);


-- >>>>>>>>>>>>>>>>>>>> 20240108000000_oc_trazabilidad.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- ÓRDENES DE COMPRA — TRAZABILIDAD Y FLUJO DE PROCESO
-- =============================================================================
-- Flujo: BORRADOR → APROBADA → ENVIADA (comprada) → PARCIAL → COMPLETA
--        (ANULADA en cualquier momento)
-- Toda creación, cambio de estado, edición, recepción o cambio de ítems queda
-- registrado automáticamente en `oc_eventos` mediante triggers.
-- =============================================================================

-- Nuevo estado intermedio "APROBADA" (antes de comprar/enviar)
ALTER TYPE estado_oc ADD VALUE IF NOT EXISTS 'APROBADA' BEFORE 'ENVIADA';

-- Fechas de proceso
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMPTZ;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS fecha_envio      TIMESTAMPTZ;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS fecha_recepcion  TIMESTAMPTZ;

-- ── Bitácora de eventos ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oc_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_id           UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  tipo            VARCHAR(30) NOT NULL,   -- CREACION, CAMBIO_ESTADO, EDICION, ITEM_AGREGADO, ITEM_MODIFICADO, ITEM_ELIMINADO, RECEPCION, COMENTARIO
  estado_anterior estado_oc,
  estado_nuevo    estado_oc,
  descripcion     TEXT NOT NULL,
  detalle         JSONB,
  usuario_id      UUID,
  usuario_email   VARCHAR(200),
  usuario_nombre  VARCHAR(200),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oc_eventos_oc ON oc_eventos(oc_id, created_at DESC);

-- ── Helper para registrar un evento capturando al usuario ────────────────────
CREATE OR REPLACE FUNCTION public.oc_registrar_evento(
  p_oc UUID, p_tipo VARCHAR, p_estado_ant estado_oc, p_estado_nue estado_oc, p_desc TEXT, p_detalle JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_email VARCHAR(200); v_nombre VARCHAR(200);
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NOT NULL THEN
    SELECT email, nombre INTO v_email, v_nombre FROM usuarios WHERE id = v_uid;
  END IF;
  INSERT INTO oc_eventos (oc_id, tipo, estado_anterior, estado_nuevo, descripcion, detalle, usuario_id, usuario_email, usuario_nombre)
  VALUES (p_oc, p_tipo, p_estado_ant, p_estado_nue, p_desc, p_detalle, v_uid, v_email, v_nombre);
END; $$;
GRANT EXECUTE ON FUNCTION public.oc_registrar_evento(UUID, VARCHAR, estado_oc, estado_oc, TEXT, JSONB) TO authenticated;

-- ── Trigger: eventos de la orden ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tr_oc_eventos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM oc_registrar_evento(NEW.id, 'CREACION', NULL, NEW.estado, 'Orden creada: ' || NEW.numero_oc, NULL);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      PERFORM oc_registrar_evento(NEW.id, 'CAMBIO_ESTADO', OLD.estado, NEW.estado,
        'Estado: ' || OLD.estado || ' → ' || NEW.estado, NULL);
    END IF;
    IF NEW.valor_total IS DISTINCT FROM OLD.valor_total
       OR NEW.fecha_entrega IS DISTINCT FROM OLD.fecha_entrega
       OR NEW.observaciones IS DISTINCT FROM OLD.observaciones
       OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id THEN
      PERFORM oc_registrar_evento(NEW.id, 'EDICION', NULL, NULL, 'Datos de la orden modificados',
        jsonb_strip_nulls(jsonb_build_object(
          'valor_total', CASE WHEN NEW.valor_total IS DISTINCT FROM OLD.valor_total THEN jsonb_build_object('antes', OLD.valor_total, 'despues', NEW.valor_total) END,
          'fecha_entrega', CASE WHEN NEW.fecha_entrega IS DISTINCT FROM OLD.fecha_entrega THEN jsonb_build_object('antes', OLD.fecha_entrega, 'despues', NEW.fecha_entrega) END,
          'observaciones', CASE WHEN NEW.observaciones IS DISTINCT FROM OLD.observaciones THEN true END
        )));
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_oc_eventos ON ordenes_compra;
CREATE TRIGGER tr_oc_eventos AFTER INSERT OR UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.tr_oc_eventos();

-- ── Trigger: eventos de los ítems ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tr_oc_items_eventos()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_oc UUID; v_prod TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_oc := OLD.oc_id; ELSE v_oc := NEW.oc_id; END IF;
  SELECT nombre_estandar INTO v_prod FROM productos WHERE id = COALESCE(NEW.producto_id, OLD.producto_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM oc_registrar_evento(v_oc, 'ITEM_AGREGADO', NULL, NULL, 'Ítem agregado: ' || COALESCE(v_prod, '?'),
      jsonb_build_object('producto', v_prod, 'cantidad', NEW.cantidad_ped, 'precio', NEW.precio_unit));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.cantidad_rec IS DISTINCT FROM OLD.cantidad_rec THEN
      PERFORM oc_registrar_evento(v_oc, 'RECEPCION', NULL, NULL, 'Recepción: ' || COALESCE(v_prod, '?'),
        jsonb_build_object('producto', v_prod, 'recibido_antes', OLD.cantidad_rec, 'recibido_ahora', NEW.cantidad_rec, 'pedido', NEW.cantidad_ped));
    END IF;
    IF NEW.cantidad_ped IS DISTINCT FROM OLD.cantidad_ped OR NEW.precio_unit IS DISTINCT FROM OLD.precio_unit THEN
      PERFORM oc_registrar_evento(v_oc, 'ITEM_MODIFICADO', NULL, NULL, 'Ítem modificado: ' || COALESCE(v_prod, '?'),
        jsonb_strip_nulls(jsonb_build_object(
          'producto', v_prod,
          'cantidad', CASE WHEN NEW.cantidad_ped IS DISTINCT FROM OLD.cantidad_ped THEN jsonb_build_object('antes', OLD.cantidad_ped, 'despues', NEW.cantidad_ped) END,
          'precio', CASE WHEN NEW.precio_unit IS DISTINCT FROM OLD.precio_unit THEN jsonb_build_object('antes', OLD.precio_unit, 'despues', NEW.precio_unit) END
        )));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM oc_registrar_evento(v_oc, 'ITEM_ELIMINADO', NULL, NULL, 'Ítem eliminado: ' || COALESCE(v_prod, '?'),
      jsonb_build_object('producto', v_prod, 'cantidad', OLD.cantidad_ped));
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS tr_oc_items_eventos ON oc_items;
CREATE TRIGGER tr_oc_items_eventos AFTER INSERT OR UPDATE OR DELETE ON oc_items
  FOR EACH ROW EXECUTE FUNCTION public.tr_oc_items_eventos();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE oc_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oc_eventos_read ON oc_eventos;
CREATE POLICY oc_eventos_read ON oc_eventos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oc_eventos_write ON oc_eventos;
CREATE POLICY oc_eventos_write ON oc_eventos FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));


-- >>>>>>>>>>>>>>>>>>>> 20240108000001_movimiento_ubicacion.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- registrar_movimiento + ubicación física (enlaza el movimiento a una estantería)
-- Reemplaza la función agregando p_ubicacion (opcional). Idempotente.
-- =============================================================================
DROP FUNCTION IF EXISTS public.registrar_movimiento(UUID, tipo_movimiento, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_producto    UUID,
  p_tipo        tipo_movimiento,
  p_cantidad    NUMERIC,
  p_sede        UUID DEFAULT NULL,
  p_observacion TEXT DEFAULT NULL,
  p_ubicacion   UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  INSERT INTO movimientos (tipo, producto_id, cantidad, sede_id, ubicacion_id, observacion, usuario_id)
  VALUES (p_tipo, p_producto, p_cantidad, p_sede, p_ubicacion, p_observacion, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
  VALUES (p_producto, 0, 0)
  ON CONFLICT (producto_id) DO NOTHING;

  IF p_tipo = 'AJUSTE' THEN
    UPDATE stock SET cantidad_real = p_cantidad, cantidad_disp = p_cantidad, updated_at = NOW()
    WHERE producto_id = p_producto;
  ELSIF p_tipo IN ('ENTRADA', 'DEVOLUCION') THEN
    UPDATE stock SET cantidad_real = cantidad_real + p_cantidad, cantidad_disp = cantidad_disp + p_cantidad, updated_at = NOW()
    WHERE producto_id = p_producto;
  ELSIF p_tipo = 'SALIDA' THEN
    UPDATE stock SET cantidad_real = GREATEST(0, cantidad_real - p_cantidad), cantidad_disp = GREATEST(0, cantidad_disp - p_cantidad), updated_at = NOW()
    WHERE producto_id = p_producto;
  END IF;

  RETURN v_id;
END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240109000000_roles_permisos_modulos.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Ajuste de roles existentes con los permisos de los módulos nuevos
-- (Arqueo, Bodegas, Generador de códigos, Exportar, Cargas masivas, Historial,
--  Notificaciones). Merge no destructivo: `permisos || {...}` solo agrega/activa
-- las claves nuevas según el rol base, preservando las existentes. Idempotente.
-- =============================================================================

-- SUPER_ADMIN y ADMIN: todos los módulos nuevos
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'realizar_arqueo', true,
  'ver_bodegas', true, 'gestionar_bodegas', true,
  'generar_codigos', true, 'exportar_datos', true,
  'importar_datos', true, 'ver_historial', true,
  'ver_notificaciones', true, 'gestionar_alertas', true
) WHERE rol_base IN ('SUPER_ADMIN', 'ADMIN');

-- SUPERVISOR
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'realizar_arqueo', true,
  'ver_bodegas', true, 'gestionar_bodegas', true,
  'exportar_datos', true, 'ver_historial', true, 'ver_notificaciones', true
) WHERE rol_base = 'SUPERVISOR';

-- BODEGUERO
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'realizar_arqueo', true,
  'ver_bodegas', true, 'gestionar_bodegas', true,
  'generar_codigos', true, 'ver_notificaciones', true
) WHERE rol_base = 'BODEGUERO';

-- COORDINADOR_COMPRAS
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'ver_bodegas', true,
  'exportar_datos', true, 'ver_notificaciones', true
) WHERE rol_base = 'COORDINADOR_COMPRAS';

-- AUDITOR (solo lectura)
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_arqueo', true, 'ver_bodegas', true,
  'exportar_datos', true, 'ver_historial', true, 'ver_notificaciones', true
) WHERE rol_base = 'AUDITOR';

-- OPERADOR_SEDE
UPDATE roles SET permisos = permisos || jsonb_build_object(
  'ver_bodegas', true, 'ver_notificaciones', true
) WHERE rol_base = 'OPERADOR_SEDE';


-- >>>>>>>>>>>>>>>>>>>> 20240110000000_bodega_planos.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Diseñador de planos de bodega (por pisos)
--
-- Cada bodega puede tener varios PISOS. Cada piso guarda sus dimensiones reales
-- (en metros), la escala del editor y el conjunto de ELEMENTOS dibujados
-- (estantes, zonas de almacenamiento, puertas, escaleras, paredes, etc.) como
-- JSONB. Los elementos usan coordenadas y medidas en metros; opcionalmente un
-- elemento puede enlazarse a una `ubicaciones` (ubicacion_id dentro del JSON).
--
-- IDEMPOTENTE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bodega_pisos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bodega_id  UUID NOT NULL REFERENCES bodegas(id) ON DELETE CASCADE,
  numero     INTEGER NOT NULL DEFAULT 1,          -- 1 = planta baja, 2 = piso 2 …
  nombre     VARCHAR(120),                        -- "Planta baja", "Mezzanine"…
  ancho_m    NUMERIC(8,2) NOT NULL DEFAULT 20,    -- ancho real del plano (m)
  alto_m     NUMERIC(8,2) NOT NULL DEFAULT 15,    -- alto real del plano (m)
  escala     NUMERIC(6,2) NOT NULL DEFAULT 40,    -- px por metro en el editor
  fondo_url  TEXT,                                -- imagen de fondo opcional (plano escaneado)
  elementos  JSONB NOT NULL DEFAULT '[]',         -- [{ id,tipo,x,y,w,h,rot,etiqueta,color,ubicacion_id }]
  orden      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (bodega_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_bodega_pisos_bodega ON bodega_pisos(bodega_id, numero);

-- updated_at
DROP TRIGGER IF EXISTS tr_bodega_pisos_upd ON bodega_pisos;
CREATE TRIGGER tr_bodega_pisos_upd BEFORE UPDATE ON bodega_pisos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historial/versionado si existe la función
DO $$ BEGIN
  IF to_regproc('public.registrar_historial') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tr_hist_bodega_pisos ON public.bodega_pisos;
    CREATE TRIGGER tr_hist_bodega_pisos AFTER INSERT OR UPDATE OR DELETE ON public.bodega_pisos
      FOR EACH ROW EXECUTE FUNCTION public.registrar_historial();
  END IF;
END $$;

-- =============================================================================
-- RLS — igual que bodegas: lectura autenticada, escritura roles de bodega
-- =============================================================================
ALTER TABLE bodega_pisos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_bodega_pisos ON bodega_pisos;
CREATE POLICY auth_read_bodega_pisos ON bodega_pisos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS write_bodega_pisos ON bodega_pisos;
CREATE POLICY write_bodega_pisos ON bodega_pisos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

-- =============================================================================
-- SEED: crea un piso 1 por cada bodega que aún no tenga pisos
-- =============================================================================
INSERT INTO bodega_pisos (bodega_id, numero, nombre)
SELECT b.id, 1, 'Planta baja'
FROM bodegas b
WHERE NOT EXISTS (SELECT 1 FROM bodega_pisos p WHERE p.bodega_id = b.id);


-- >>>>>>>>>>>>>>>>>>>> 20240110000000_updated_at_sync.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Offline-first (Fase 1) — updated_at uniforme para sincronización incremental
-- Agrega updated_at + trigger set_updated_at a las tablas sincronizables que no
-- lo tenían, para poder hacer PULL por marca de tiempo (watermark). Aditivo e
-- idempotente. No afecta la app web.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  -- Tablas editables que se sincronizan al dispositivo y NO tenían updated_at
  tablas TEXT[] := ARRAY[
    'proveedores', 'sedes', 'grupos_contrato', 'usuarios',
    'pedidos_sede', 'rotacion', 'oc_items', 'arqueo_items'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()', t);
      -- Backfill inicial: usa created_at si existe, si no NOW()
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_at') THEN
        EXECUTE format('UPDATE public.%I SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL', t);
      END IF;
      -- Trigger que mantiene updated_at en cada UPDATE
      EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END IF;
  END LOOP;
END $$;

-- Índices para acelerar el PULL incremental (updated_at)
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'productos','stock','proveedores','sedes','grupos_contrato','usuarios',
    'bodegas','ubicaciones','ordenes_compra','oc_items','aprovisionamiento',
    'rotacion','pedidos_sede','arqueos','arqueo_items','roles'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='updated_at') THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%1$s_updated ON public.%1$s(updated_at)', t);
    END IF;
  END LOOP;
END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240111000000_personas_usuarios_conserjeria.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- CONECTAR PERSONAS (Gestión Humana) ↔ USUARIOS (cuentas de plataforma)
-- + ROLES DE CONSERJERÍA (Conserje, Coordinador, Gerencia, Supervisor de Conserjería)
-- =============================================================================
-- Objetivo:
--   1) Cada colaborador (persona) puede tener una cuenta de plataforma con rol.
--      La cuenta se crea desde Gestión Humana (formulario o cargue masivo).
--   2) Roles orientados a la operación de conserjería, no solo a inventario.
--      La plataforma crecerá hacia PQRS, No conformes, Contratos, Gerencia; los
--      permisos correspondientes ya quedan sembrados en cada rol (aunque las
--      pantallas se construyan después).
--
-- Nota de arquitectura: los permisos son DATOS (JSONB en `roles`) que la app
-- web, /usuarios y la app offline (Dexie) consumen igual. Sembrar bien los roles
-- deja "todo con lo mismo" sin tocar código de gating.
-- =============================================================================

-- ── 1) Enlace persona → cuenta de plataforma ─────────────────────────────────
ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- Una cuenta de plataforma pertenece a lo sumo a una persona.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_personas_usuario_id
  ON public.personas(usuario_id) WHERE usuario_id IS NOT NULL;

COMMENT ON COLUMN public.personas.usuario_id IS
  'Cuenta de plataforma (auth/usuarios) vinculada a este colaborador. NULL = sin acceso.';

-- Backfill: enlazar personas existentes con usuarios que compartan email.
UPDATE public.personas p
SET usuario_id = u.id
FROM public.usuarios u
WHERE p.usuario_id IS NULL
  AND p.email IS NOT NULL
  AND lower(trim(p.email)) = lower(trim(u.email))
  -- evita romper la unicidad si dos personas comparten el mismo email
  AND NOT EXISTS (SELECT 1 FROM public.personas p2 WHERE p2.usuario_id = u.id);

-- ── 2) Renombrar el Supervisor existente → orientado a conserjería ───────────
-- Idempotente: si ya se renombró, el UPDATE no afecta filas.
UPDATE public.roles
SET nombre = 'Supervisor de Conserjería'
WHERE nombre = 'Supervisor';

-- ── 3) Roles de conserjería (seed idempotente) ───────────────────────────────
-- Las claves de permisos coinciden con el catálogo de /roles (lib/permisos.ts),
-- incluidas las nuevas del grupo "Operación Conserjería".
-- Nota: se usan literales JSON (`'{...}'::jsonb`) en lugar de jsonb_build_object
-- porque Postgres limita las funciones a 100 argumentos (el rol Gerencia excede).
INSERT INTO public.roles (nombre, descripcion, permisos, activo) VALUES
  (
    'Conserje',
    'Personal en sede: consulta inventario, escanea, registra novedades y radica PQRS.',
    '{
      "ver_productos": true, "ver_stock": true, "usar_scanner": true,
      "ver_movimientos": true, "crear_movimientos": true,
      "ver_notificaciones": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true,
      "usar_ia_asistente": true
    }'::jsonb,
    true
  ),
  (
    'Coordinador',
    'Coordina sedes y conserjes: personas, PQRS, no conformes, contratos y reportes.',
    '{
      "ver_productos": true, "ver_stock": true, "ver_movimientos": true, "usar_scanner": true,
      "ver_bodegas": true, "ver_arqueo": true,
      "ver_contratos": true, "ver_proveedores": true, "ver_ordenes_compra": true,
      "ver_reportes": true, "exportar_datos": true,
      "ver_personas": true, "gestionar_personas": true, "importar_personas": true,
      "ver_empresas_usuarias": true, "gestionar_empresas_usuarias": true,
      "ver_documentos_rrhh": true, "gestionar_documentos_rrhh": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true, "gestionar_contratos_conserjeria": true,
      "ver_notificaciones": true, "gestionar_alertas": true,
      "ver_documentos": true, "usar_ia_asistente": true, "ver_ia_analisis": true
    }'::jsonb,
    true
  ),
  (
    'Gerencia',
    'Dirección: visibilidad total de la operación, indicadores y panel gerencial.',
    '{
      "ver_productos": true, "editar_productos": true, "ver_stock": true, "ajustar_stock": true,
      "ver_movimientos": true, "crear_movimientos": true, "usar_scanner": true,
      "ver_arqueo": true, "realizar_arqueo": true, "ver_bodegas": true, "gestionar_bodegas": true,
      "generar_codigos": true,
      "ver_aprovisionamiento": true, "editar_aprovisionamiento": true,
      "ver_contratos": true, "editar_contratos": true,
      "ver_proveedores": true, "editar_proveedores": true,
      "ver_ordenes_compra": true, "crear_ordenes_compra": true,
      "ver_reportes": true, "exportar_datos": true,
      "ver_documentos": true, "subir_documentos": true,
      "ver_usuarios": true, "gestionar_usuarios": true, "gestionar_roles": true,
      "importar_datos": true, "ver_actividad_log": true, "ver_historial": true,
      "ver_notificaciones": true, "gestionar_alertas": true,
      "ver_configuracion": true, "editar_configuracion": true,
      "ver_personas": true, "gestionar_personas": true, "importar_personas": true,
      "ver_empresas_usuarias": true, "gestionar_empresas_usuarias": true,
      "ver_documentos_rrhh": true, "gestionar_documentos_rrhh": true, "gestionar_tipos_documentales": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true, "gestionar_contratos_conserjeria": true,
      "ver_panel_gerencia": true,
      "usar_ia_vision": true, "usar_ia_asistente": true, "ver_ia_analisis": true
    }'::jsonb,
    true
  )
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      permisos    = public.roles.permisos || EXCLUDED.permisos,  -- merge no destructivo
      updated_at  = NOW();

-- ── 4) Ampliar el Supervisor de Conserjería con permisos de conserjería ──────
UPDATE public.roles SET permisos = permisos || '{
  "ver_personas": true, "ver_empresas_usuarias": true, "ver_documentos_rrhh": true,
  "ver_pqrs": true, "gestionar_pqrs": true,
  "ver_no_conformes": true, "gestionar_no_conformes": true,
  "ver_contratos_conserjeria": true
}'::jsonb WHERE nombre = 'Supervisor de Conserjería';

-- ── 5) Mapear rol_base (enum RLS) de los roles nuevos ────────────────────────
-- Conserje → operación mínima en sede; Coordinador → supervisión; Gerencia → admin.
UPDATE public.roles SET rol_base = 'OPERADOR_SEDE' WHERE nombre = 'Conserje'   AND rol_base IS DISTINCT FROM 'OPERADOR_SEDE';
UPDATE public.roles SET rol_base = 'SUPERVISOR'    WHERE nombre = 'Coordinador' AND rol_base IS DISTINCT FROM 'SUPERVISOR';
UPDATE public.roles SET rol_base = 'ADMIN'         WHERE nombre = 'Gerencia'    AND rol_base IS DISTINCT FROM 'ADMIN';
UPDATE public.roles SET rol_base = 'SUPERVISOR'    WHERE nombre = 'Supervisor de Conserjería' AND rol_base IS NULL;


-- >>>>>>>>>>>>>>>>>>>> 20240112000000_integraciones_correo.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Integraciones · Correo electrónico
--
-- Vincula una cuenta de correo (de CUALQUIER plataforma) por SMTP (envío) e
-- IMAP (recepción). Guarda credenciales, estado de la última prueba y toggles.
--
-- Seguridad: SOLO administradores pueden leer/escribir esta tabla (contiene
-- credenciales). RLS estricta. Idempotente.
-- =============================================================================

-- Asegura la función helper de rol (por si la migración inicial no se aplicó).
CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS rol_usuario
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) $$;

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


-- >>>>>>>>>>>>>>>>>>>> 20240112000000_parametrizacion_sede.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- PARAMETRIZACIÓN POR SEDE
-- =============================================================================
-- Cada sede puede tener un catálogo específico de productos, cada uno con una
-- cantidad máxima (y mínima opcional para reposición). Es la base para el futuro
-- MÓDULO DE CONTRATO, que asignará estas parametrizaciones — por eso se reserva
-- la columna `contrato_id` (aún sin FK: la tabla `contratos` se creará después).
-- =============================================================================

CREATE TABLE IF NOT EXISTS sede_productos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id          UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_maxima  DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_minima  DECIMAL(10,2) DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true,
  observacion      TEXT,
  -- Reservado para el futuro módulo de contratos (sin FK hasta que exista la tabla).
  contrato_id      UUID,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sede_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_sede_productos_sede     ON sede_productos(sede_id);
CREATE INDEX IF NOT EXISTS idx_sede_productos_producto ON sede_productos(producto_id);
CREATE INDEX IF NOT EXISTS idx_sede_productos_contrato ON sede_productos(contrato_id);

COMMENT ON TABLE  sede_productos IS 'Parametrización por sede: catálogo de productos permitidos y su cantidad máxima/mínima. Base del futuro módulo de contratos.';
COMMENT ON COLUMN sede_productos.contrato_id IS 'Reservado: el módulo de contratos asignará estas parametrizaciones. Sin FK hasta que exista la tabla contratos.';

-- updated_at
DROP TRIGGER IF EXISTS tr_sede_productos_upd ON sede_productos;
CREATE TRIGGER tr_sede_productos_upd BEFORE UPDATE ON sede_productos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE sede_productos ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado.
DROP POLICY IF EXISTS sp_read ON sede_productos;
CREATE POLICY sp_read ON sede_productos FOR SELECT TO authenticated USING (true);

-- Escritura: administración y coordinación.
DROP POLICY IF EXISTS sp_write ON sede_productos;
CREATE POLICY sp_write ON sede_productos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- =============================================================================
-- PERMISOS EN LOS ROLES (claves del catálogo lib/permisos.ts)
-- =============================================================================
-- Ver + gestionar: administración, compras, gerencia y coordinación.
UPDATE public.roles
SET permisos = permisos || '{"ver_parametrizacion": true, "gestionar_parametrizacion": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS')
   OR nombre IN ('Gerencia','Coordinador');

-- Solo ver: supervisión, auditoría y bodega.
UPDATE public.roles
SET permisos = permisos || '{"ver_parametrizacion": true}'::jsonb
WHERE rol_base IN ('SUPERVISOR','AUDITOR','BODEGUERO')
   OR nombre IN ('Supervisor de Conserjería');


-- >>>>>>>>>>>>>>>>>>>> 20240113000000_correo_alertas.sql >>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>> 20240113000000_ordenes_insumo.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- ÓRDENES DE INSUMO (despacho a bodega + alistamiento + video de despacho)
-- =============================================================================
-- Flujo:
--   1) Se crea una orden POR SEDE tomando su parametrización (sede_productos):
--      productos permitidos + cantidad máxima (propuesta, editable hacia abajo).
--   2) Llega a la bodega como orden de despacho (estado PENDIENTE).
--   3) ALISTAMIENTO: se marca ítem por ítem lo que se va alistando y se asignan
--      responsables.
--   4) DESPACHO: se graba/sube un VIDEO que queda ligado a la orden y se registra
--      la SALIDA de stock (traslado de mercancía a la sede) vía registrar_movimiento.
--
-- `contrato_id` queda reservado para el futuro módulo de contratos.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE estado_orden_insumo AS ENUM
    ('PENDIENTE','EN_ALISTAMIENTO','ALISTADO','DESPACHADO','ANULADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Cabecera ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_insumo (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                   VARCHAR(30) UNIQUE NOT NULL,
  sede_id                  UUID NOT NULL REFERENCES sedes(id),
  bodega_id                UUID REFERENCES bodegas(id) ON DELETE SET NULL,
  estado                   estado_orden_insumo NOT NULL DEFAULT 'PENDIENTE',
  periodo                  DATE,
  observacion              TEXT,
  contrato_id              UUID,  -- reservado para el módulo de contratos
  creado_por               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alistamiento_iniciado_at TIMESTAMPTZ,
  alistado_at              TIMESTAMPTZ,
  despachado_por           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  despachado_at            TIMESTAMPTZ,
  video_path               TEXT,          -- ruta en el bucket privado ordenes-insumo
  video_mime               VARCHAR(60),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oi_sede    ON ordenes_insumo(sede_id);
CREATE INDEX IF NOT EXISTS idx_oi_estado  ON ordenes_insumo(estado);
CREATE INDEX IF NOT EXISTS idx_oi_creada  ON ordenes_insumo(created_at DESC);

-- ── Ítems ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id),
  cantidad_solicitada DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_maxima_ref DECIMAL(10,2) DEFAULT 0,   -- máximo parametrizado al crear
  cantidad_alistada   DECIMAL(10,2) NOT NULL DEFAULT 0,
  alistado            BOOLEAN NOT NULL DEFAULT false,
  alistado_por        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alistado_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_oi_items_orden ON orden_insumo_items(orden_id);

-- ── Responsables del alistamiento ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_responsables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id   UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_oi_resp_orden ON orden_insumo_responsables(orden_id);

-- ── updated_at ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_ordenes_insumo_upd ON ordenes_insumo;
CREATE TRIGGER tr_ordenes_insumo_upd BEFORE UPDATE ON ordenes_insumo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE ordenes_insumo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_responsables ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado.
DROP POLICY IF EXISTS oi_read ON ordenes_insumo;
CREATE POLICY oi_read ON ordenes_insumo FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_items_read ON orden_insumo_items;
CREATE POLICY oi_items_read ON orden_insumo_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_resp_read ON orden_insumo_responsables;
CREATE POLICY oi_resp_read ON orden_insumo_responsables FOR SELECT TO authenticated USING (true);

-- Escritura: administración, supervisión, bodega y compras.
DROP POLICY IF EXISTS oi_write ON ordenes_insumo;
CREATE POLICY oi_write ON ordenes_insumo FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_items_write ON orden_insumo_items;
CREATE POLICY oi_items_write ON orden_insumo_items FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_resp_write ON orden_insumo_responsables;
CREATE POLICY oi_resp_write ON orden_insumo_responsables FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));

-- =============================================================================
-- STORAGE — bucket PRIVADO para los videos de despacho
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('ordenes-insumo', 'ordenes-insumo', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "oi_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "oi_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "oi_delete_bucket" ON storage.objects;
CREATE POLICY "oi_read_bucket" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ordenes-insumo');
CREATE POLICY "oi_upload_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ordenes-insumo');
CREATE POLICY "oi_delete_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ordenes-insumo');

-- =============================================================================
-- PERMISOS EN LOS ROLES (claves del catálogo lib/permisos.ts)
-- =============================================================================
-- Ver + crear + alistar: administración, gerencia, supervisión.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true, "alistar_ordenes_insumo": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR')
   OR nombre IN ('Gerencia','Coordinador');

-- Compras: ver + crear.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS';

-- Bodega: ver + alistar (arma y despacha el pedido).
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "alistar_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'BODEGUERO';

-- Auditor: solo ver.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'AUDITOR';
