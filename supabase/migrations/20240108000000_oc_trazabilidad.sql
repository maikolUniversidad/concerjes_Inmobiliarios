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
