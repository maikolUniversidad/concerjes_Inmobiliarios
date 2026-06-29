-- =============================================
-- Conserjes Inmobiliarios — Schema Completo
-- Basado en CMI Reabastecimiento Excel
-- =============================================

-- Enums
CREATE TYPE categoria_rotacion AS ENUM ('A', 'B', 'C', 'D');
CREATE TYPE tipo_insumo AS ENUM (
  'CAFETERIA', 'LIQUIDOS', 'ASEO', 'EPP', 'PAPELERIA',
  'MAQUINARIA', 'JARDINERIA', 'REPUESTOS', 'NO_DISPONIBLE', 'OTROS'
);
CREATE TYPE grupo_contrato AS ENUM ('CA', 'MO', 'MB', 'PB', 'AD');
CREATE TYPE tipo_movimiento AS ENUM ('ENTRADA', 'SALIDA', 'TRASLADO', 'AJUSTE', 'DEVOLUCION');
CREATE TYPE estado_oc AS ENUM ('BORRADOR', 'ENVIADA', 'PARCIAL', 'COMPLETA', 'ANULADA');
CREATE TYPE rol_usuario AS ENUM (
  'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORDINADOR_COMPRAS',
  'BODEGUERO', 'AUDITOR', 'OPERADOR_SEDE'
);

-- =============================================
-- PROVEEDORES
-- =============================================
CREATE TABLE proveedores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       VARCHAR(200) NOT NULL,
  nit          VARCHAR(20) UNIQUE,
  contacto     VARCHAR(200),
  telefono     VARCHAR(30),
  email        VARCHAR(200),
  es_principal BOOLEAN DEFAULT false,
  activo       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- PRODUCTOS (catálogo maestro)
-- Basado en columnas: REF, NOMBRE ESTANDAR, PRESENTACION, TIPO DE INSUMO, CAT ROT
-- =============================================
CREATE TABLE productos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               INTEGER UNIQUE,                       -- REF del Excel
  codigo            INTEGER UNIQUE,                       -- CODIGO correlativo
  nombre_estandar   VARCHAR(300) NOT NULL,               -- NOMBRE ESTANDAR
  presentacion      VARCHAR(150),                         -- PRESENTACION
  complemento       TEXT,                                 -- Detalles/características
  tipo_insumo       tipo_insumo NOT NULL DEFAULT 'OTROS',
  cat_rotacion      categoria_rotacion NOT NULL DEFAULT 'C', -- A/B/C/D
  stock_minimo_asig DECIMAL(10,2) DEFAULT 0,              -- Sto. Min. Asig.
  stock_minimo_def  DECIMAL(10,2) DEFAULT 0,              -- Stock Min. Definido
  stock_min_suger   DECIMAL(10,2) DEFAULT 0,              -- Sto. Min. Sug.
  ind_rot_general   DECIMAL(8,2),                         -- I. Rot. GRAL
  ind_rot_mes       DECIMAL(8,2),                         -- I. Rot. MES
  proveedor_id      UUID REFERENCES proveedores(id),
  precio_lista      DECIMAL(12,2),                        -- Precio de lista
  proveedor2_id     UUID REFERENCES proveedores(id),
  precio_lista2     DECIMAL(12,2),                        -- Segundo precio
  imagen_url        TEXT,
  activo            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- PRECIOS POR PROVEEDOR (Matriz de Negociación)
-- Basado en columnas: MONTERREY, BEAUTE, SUMICORP, etc.
-- =============================================
CREATE TABLE precios_proveedor (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id  UUID NOT NULL REFERENCES productos(id),
  proveedor_id UUID NOT NULL REFERENCES proveedores(id),
  precio       DECIMAL(12,2),
  porcentaje_vs_conserjes DECIMAL(6,2),  -- % MON/CON, % BEA/CON
  vigente      BOOLEAN DEFAULT true,
  fecha_cotiz  DATE,
  UNIQUE(producto_id, proveedor_id)
);

-- =============================================
-- GRUPOS DE CONTRATO (C.A., M.O., M.B., P.B., AD)
-- =============================================
CREATE TABLE grupos_contrato (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      grupo_contrato UNIQUE NOT NULL,
  nombre      VARCHAR(200) NOT NULL,
  descripcion TEXT,
  supervisor_id UUID,                                     -- FK a usuarios
  activo      BOOLEAN DEFAULT true
);

-- =============================================
-- SEDES / CONTRATOS CLIENTE
-- Basado en las columnas de cada hoja (C.A., M.O., etc.)
-- =============================================
CREATE TABLE sedes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id        UUID NOT NULL REFERENCES grupos_contrato(id),
  codigo_interno  VARCHAR(20),                            -- Número del contrato
  nombre          VARCHAR(400) NOT NULL,                  -- Nombre completo del cliente
  zona            VARCHAR(100),                           -- ZONA 21, etc.
  ciudad          VARCHAR(100) DEFAULT 'BOGOTÁ D.C.',
  col_excel       INTEGER,                                -- Columna en el Excel (para migración)
  responsable_id  UUID,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- STOCK CENTRAL (bodega)
-- Basado en hoja "Stock": Codigo, Descripcion, Cantidad real, Cantidad disponible
-- =============================================
CREATE TABLE stock (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id      UUID NOT NULL REFERENCES productos(id) UNIQUE,
  cantidad_real    DECIMAL(10,2) NOT NULL DEFAULT 0,      -- Cantidad real
  cantidad_disp    DECIMAL(10,2) NOT NULL DEFAULT 0,      -- Cantidad disponible
  cantidad_entr    DECIMAL(10,2) DEFAULT 0,               -- Entrante (en tránsito)
  cantidad_sal     DECIMAL(10,2) DEFAULT 0,               -- Saliente
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- PEDIDOS POR SEDE (equivale a las celdas del Excel por sede)
-- =============================================
CREATE TABLE pedidos_sede (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id     UUID NOT NULL REFERENCES sedes(id),
  producto_id UUID NOT NULL REFERENCES productos(id),
  periodo     DATE NOT NULL,                              -- Primer día del mes: 2026-06-01
  cantidad    DECIMAL(10,2) NOT NULL DEFAULT 0,
  observacion TEXT,
  creado_por  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sede_id, producto_id, periodo)
);

-- =============================================
-- ROTACIÓN / CONSUMO HISTÓRICO
-- Basado en hoja "Rot": consumo por grupo mes a mes
-- =============================================
CREATE TABLE rotacion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES productos(id),
  grupo_id    UUID NOT NULL REFERENCES grupos_contrato(id),
  periodo     DATE NOT NULL,                              -- Primer día del mes
  consumo     DECIMAL(10,2) NOT NULL DEFAULT 0,
  pendiente   DECIMAL(10,2) DEFAULT 0,                    -- PEND C.A., PEND M.O., etc.
  UNIQUE(producto_id, grupo_id, periodo)
);

-- =============================================
-- APROVISIONAMIENTO / REABASTECIMIENTO
-- Basado en hoja "Aprov": plan mensual de compras
-- =============================================
CREATE TABLE aprovisionamiento (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id       UUID NOT NULL REFERENCES productos(id),
  periodo           DATE NOT NULL,                        -- Mes del pedido
  stock_al_inicio   DECIMAL(10,2),
  pedido_calculado  DECIMAL(10,2),                        -- TOTAL PEDIDO (suma sedes)
  pedido_ajustado   DECIMAL(10,2),                        -- Ajuste manual si aplica
  control_agotados  INTEGER DEFAULT 0,                    -- Control de Agotados
  sugerido_compra   DECIMAL(10,2),                        -- Sugerido Compra
  proveedor_sug_id  UUID REFERENCES proveedores(id),
  precio_sugerido   DECIMAL(12,2),
  oc_pendiente      DECIMAL(10,2) DEFAULT 0,              -- OC PENDIENTES
  adicional         DECIMAL(10,2) DEFAULT 0,
  total_compras     DECIMAL(12,2),
  total_entradas    DECIMAL(10,2),
  saldo_insumos     DECIMAL(10,2),
  aprobado_por      UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, periodo)
);

-- =============================================
-- ÓRDENES DE COMPRA
-- =============================================
CREATE TABLE ordenes_compra (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_oc       VARCHAR(50) UNIQUE NOT NULL,            -- No OC
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id),
  periodo         DATE NOT NULL,
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega   DATE,
  estado          estado_oc NOT NULL DEFAULT 'BORRADOR',
  valor_total     DECIMAL(14,2),
  observaciones   TEXT,
  creado_por      UUID NOT NULL,
  aprobado_por    UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE oc_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_id        UUID NOT NULL REFERENCES ordenes_compra(id),
  producto_id  UUID NOT NULL REFERENCES productos(id),
  cantidad_ped DECIMAL(10,2) NOT NULL,
  cantidad_rec DECIMAL(10,2) DEFAULT 0,
  precio_unit  DECIMAL(12,2) NOT NULL,
  subtotal     DECIMAL(14,2) GENERATED ALWAYS AS (cantidad_ped * precio_unit) STORED
);

-- =============================================
-- MOVIMIENTOS (trazabilidad de entradas/salidas)
-- =============================================
CREATE TABLE movimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          tipo_movimiento NOT NULL,
  producto_id   UUID NOT NULL REFERENCES productos(id),
  cantidad      DECIMAL(10,2) NOT NULL,
  sede_id       UUID REFERENCES sedes(id),
  oc_id         UUID REFERENCES ordenes_compra(id),
  periodo       DATE,
  observacion   TEXT,
  usuario_id    UUID NOT NULL,
  ia_origen     BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- USUARIOS Y ROLES (complementa Supabase Auth)
-- =============================================
CREATE TABLE usuarios (
  id            UUID PRIMARY KEY,                         -- = auth.users.id
  nombre        VARCHAR(200) NOT NULL,
  email         VARCHAR(200) UNIQUE NOT NULL,
  rol           rol_usuario NOT NULL DEFAULT 'AUDITOR',
  grupo_id      UUID REFERENCES grupos_contrato(id),      -- Para SUPERVISOR: su grupo
  sede_id       UUID REFERENCES sedes(id),                -- Para OPERADOR_SEDE: su sede
  activo        BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- CONTACTOS WEB (desde el sitio corporativo)
-- =============================================
CREATE TABLE contactos_web (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    VARCHAR(200) NOT NULL,
  empresa   VARCHAR(200),
  telefono  VARCHAR(30) NOT NULL,
  email     VARCHAR(200) NOT NULL,
  servicio  VARCHAR(100),
  mensaje   TEXT NOT NULL,
  leido     BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ÍNDICES
-- =============================================
CREATE INDEX idx_productos_tipo     ON productos(tipo_insumo);
CREATE INDEX idx_productos_cat      ON productos(cat_rotacion);
CREATE INDEX idx_productos_ref      ON productos(ref);
CREATE INDEX idx_stock_producto     ON stock(producto_id);
CREATE INDEX idx_pedidos_sede_per   ON pedidos_sede(sede_id, periodo);
CREATE INDEX idx_pedidos_prod_per   ON pedidos_sede(producto_id, periodo);
CREATE INDEX idx_rotacion_prod_per  ON rotacion(producto_id, periodo);
CREATE INDEX idx_rotacion_grupo_per ON rotacion(grupo_id, periodo);
CREATE INDEX idx_movimientos_prod   ON movimientos(producto_id, created_at DESC);
CREATE INDEX idx_movimientos_sede   ON movimientos(sede_id);
CREATE INDEX idx_sedes_grupo        ON sedes(grupo_id);
CREATE INDEX idx_aprov_prod_per     ON aprovisionamiento(producto_id, periodo);

-- =============================================
-- TRIGGERS: updated_at
-- =============================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER tr_productos_upd BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_stock_upd     BEFORE UPDATE ON stock     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_aprov_upd     BEFORE UPDATE ON aprovisionamiento FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_oc_upd        BEFORE UPDATE ON ordenes_compra    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================
-- DATOS MAESTROS: Grupos de contrato
-- =============================================
INSERT INTO grupos_contrato (codigo, nombre, descripcion) VALUES
  ('CA', 'C.A.', 'Transmilenio, Bibliotecas Distritales y entidades afines'),
  ('MO', 'M.O.', 'Alcaldías Locales, Ministerios y entidades públicas nacionales'),
  ('MB', 'M.B.', 'Comercio y Bases Militares — Comerbas, Fuerza Aérea'),
  ('PB', 'P.B.', 'UNAD — Universidad Nacional Abierta y a Distancia (multi-regional)'),
  ('AD', 'A.D.', 'Administración y contratos adicionales');

-- =============================================
-- DATOS MAESTROS: Proveedores principales
-- =============================================
INSERT INTO proveedores (nombre, es_principal) VALUES
  ('SCOPA', true),
  ('DETALGRAF', true),
  ('MONTERREY', false),
  ('BEAUTE', false),
  ('SUMICORP', false),
  ('CAJA MENOR', false),
  ('PROVEEDOR GENERAL', false);

-- =============================================
-- RLS — Row Level Security
-- =============================================
ALTER TABLE productos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock              ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sedes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_sede       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotacion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprovisionamiento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra     ENABLE ROW LEVEL SECURITY;
ALTER TABLE oc_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_proveedor  ENABLE ROW LEVEL SECURITY;

-- Política base: acceso autenticado (refinar por rol)
CREATE POLICY "auth_read_productos"    ON productos           FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_stock"        ON stock               FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_sedes"        ON sedes               FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_rotacion"     ON rotacion            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_pedidos"      ON pedidos_sede        FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_aprov"        ON aprovisionamiento   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_oc"           ON ordenes_compra      FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_oc_items"     ON oc_items            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_movimientos"  ON movimientos         FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_precios"      ON precios_proveedor   FOR SELECT TO authenticated USING (true);

-- Escritura: solo roles con permiso
CREATE POLICY "admin_write_productos"  ON productos           FOR ALL    TO authenticated
  USING ((SELECT rol FROM usuarios WHERE id = auth.uid()) IN ('SUPER_ADMIN','ADMIN'));
CREATE POLICY "admin_write_stock"      ON stock               FOR ALL    TO authenticated
  USING ((SELECT rol FROM usuarios WHERE id = auth.uid()) IN ('SUPER_ADMIN','ADMIN','BODEGUERO'));
CREATE POLICY "admin_write_movimientos" ON movimientos        FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_write_aprov"      ON aprovisionamiento   FOR ALL    TO authenticated
  USING ((SELECT rol FROM usuarios WHERE id = auth.uid()) IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));
CREATE POLICY "admin_write_oc"         ON ordenes_compra      FOR ALL    TO authenticated
  USING ((SELECT rol FROM usuarios WHERE id = auth.uid()) IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS'));
