-- =============================================================================
-- Conserjes Inmobiliarios — PARTE 1 · Base (esquema, roles, RLS, auth)
-- Idempotente. Corre este bloque COMPLETO en el SQL Editor y avísame el resultado.
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
-- COMPATIBILIDAD: normaliza una tabla `roles` de esquema ANTERIOR incompatible.
-- Si existe un `roles` viejo (con la columna `role`, ajena al diseño actual),
-- se aparta a un respaldo con marca de tiempo para que abajo se cree el correcto.
-- =============================================================================
DO $$
DECLARE v_bk text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'role'
  ) THEN
    -- La FK usuarios.rol_id se recreará apuntando al roles nuevo (roles_dinamicos).
    ALTER TABLE IF EXISTS public.usuarios DROP COLUMN IF EXISTS rol_id;
    v_bk := 'roles_legacy_' || to_char(now(), 'YYYYMMDD_HH24MISS');
    EXECUTE format('ALTER TABLE public.roles RENAME TO %I', v_bk);
    RAISE NOTICE 'Tabla roles incompatible apartada como %', v_bk;
  END IF;
END $$;

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
