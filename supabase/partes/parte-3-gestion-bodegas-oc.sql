-- Conserjes Inmobiliarios — PARTE 3 (idempotente)


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

DROP POLICY IF EXISTS "fotos_select" ON public.producto_fotos;
DROP POLICY IF EXISTS "fotos_insert" ON public.producto_fotos;
DROP POLICY IF EXISTS "fotos_update" ON public.producto_fotos;
DROP POLICY IF EXISTS "fotos_delete" ON public.producto_fotos;
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
