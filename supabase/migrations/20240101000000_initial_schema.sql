-- =============================================
-- Conserjes Inmobiliarios — Migración inicial
-- =============================================

-- Enums
CREATE TYPE categoria AS ENUM ('ASEO','CAFETERIA','EPP','MAQUINARIA','JARDINERIA','CONSUMIBLES','REPUESTOS','OTROS');
CREATE TYPE unidad_medida AS ENUM ('UNIDAD','LITRO','KILOGRAMO','METRO','CAJA','BOLSA','GALON','ROLLO');
CREATE TYPE tipo_bodega AS ENUM ('BODEGA_CENTRAL','SEDE_CLIENTE','VEHICULO');
CREATE TYPE tipo_movimiento AS ENUM ('ENTRADA','SALIDA','TRASLADO','AJUSTE','DEVOLUCION');

-- Proveedores
CREATE TABLE proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  nit VARCHAR(20) UNIQUE,
  contacto_nombre VARCHAR(200),
  telefono VARCHAR(20),
  email VARCHAR(200),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Productos
CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(30) UNIQUE NOT NULL,
  codigo_barras VARCHAR(50) UNIQUE,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  categoria categoria NOT NULL,
  subcategoria VARCHAR(100),
  unidad_medida unidad_medida NOT NULL,
  precio_costo DECIMAL(12,2),
  precio_referencia DECIMAL(12,2),
  stock_minimo DECIMAL(10,2) DEFAULT 0,
  stock_maximo DECIMAL(10,2),
  proveedor_id UUID REFERENCES proveedores(id),
  imagen_url TEXT,
  imagen_ia_ref TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contratos
CREATE TABLE contratos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  cliente_nombre VARCHAR(200) NOT NULL,
  tipo_servicio TEXT[] DEFAULT '{}',
  fecha_inicio DATE,
  fecha_fin DATE,
  presupuesto_dotacion DECIMAL(14,2),
  responsable_id UUID,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bodegas
CREATE TABLE bodegas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  tipo tipo_bodega NOT NULL,
  direccion TEXT,
  responsable_id UUID,
  contrato_id UUID REFERENCES contratos(id),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock
CREATE TABLE stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID NOT NULL REFERENCES productos(id),
  bodega_id UUID NOT NULL REFERENCES bodegas(id),
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 0,
  lote VARCHAR(100),
  fecha_vencimiento DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(producto_id, bodega_id, lote)
);

-- Movimientos
CREATE TABLE movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo tipo_movimiento NOT NULL,
  producto_id UUID NOT NULL REFERENCES productos(id),
  bodega_origen_id UUID REFERENCES bodegas(id),
  bodega_destino_id UUID REFERENCES bodegas(id),
  cantidad DECIMAL(10,2) NOT NULL,
  precio_unitario DECIMAL(12,2),
  numero_documento VARCHAR(100),
  contrato_id UUID REFERENCES contratos(id),
  observacion TEXT,
  usuario_id UUID NOT NULL,
  ia_origen BOOLEAN DEFAULT false,
  ia_confianza DECIMAL(3,2),
  comprobante_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contactos (web pública)
CREATE TABLE contactos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(200) NOT NULL,
  empresa VARCHAR(200),
  telefono VARCHAR(30) NOT NULL,
  email VARCHAR(200) NOT NULL,
  servicio VARCHAR(100),
  mensaje TEXT NOT NULL,
  leido BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers: updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productos_updated_at BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER stock_updated_at BEFORE UPDATE ON stock FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX idx_productos_categoria ON productos(categoria);
CREATE INDEX idx_productos_activo ON productos(activo);
CREATE INDEX idx_stock_producto ON stock(producto_id);
CREATE INDEX idx_stock_bodega ON stock(bodega_id);
CREATE INDEX idx_movimientos_producto ON movimientos(producto_id);
CREATE INDEX idx_movimientos_created ON movimientos(created_at DESC);
CREATE INDEX idx_movimientos_contrato ON movimientos(contrato_id);

-- RLS: Enable Row Level Security
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE bodegas ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Admin ve todo — ampliar por rol)
CREATE POLICY "admin_all_productos" ON productos USING (true);
CREATE POLICY "admin_all_stock" ON stock USING (true);
CREATE POLICY "admin_all_movimientos" ON movimientos USING (true);
CREATE POLICY "admin_all_bodegas" ON bodegas USING (true);
CREATE POLICY "admin_all_contratos" ON contratos USING (true);
CREATE POLICY "admin_all_proveedores" ON proveedores USING (true);
