-- =============================================================================
-- ÓRDENES DE INSUMO — FLUJO DE APROBACIÓN CON TRAZABILIDAD
-- =============================================================================
-- El COORDINADOR de la sede propone los insumos (BORRADOR) y los envía a
-- revisión. La CENTRAL revisa: pide cambios (vuelve al coordinador) o aprueba.
-- Toda la conversación y los cambios de estado quedan en `orden_insumo_eventos`
-- (trazabilidad de lado a lado). Solo cuando la orden queda APROBADA entra al
-- módulo de ALISTAMIENTO de inventario.
--
--   BORRADOR ──enviar──► EN_REVISION ──aprobar──► APROBADA ──► EN_ALISTAMIENTO
--       ▲                     │                                      │
--       └──CAMBIOS_SOLICITADOS┘ (la central pide ajustes)            ▼
--                                                        ALISTADO ► DESPACHADO
-- IDEMPOTENTE.
-- =============================================================================

-- ── Nuevos estados del flujo ────────────────────────────────────────────────
ALTER TYPE estado_orden_insumo ADD VALUE IF NOT EXISTS 'BORRADOR'            BEFORE 'PENDIENTE';
ALTER TYPE estado_orden_insumo ADD VALUE IF NOT EXISTS 'EN_REVISION'         BEFORE 'PENDIENTE';
ALTER TYPE estado_orden_insumo ADD VALUE IF NOT EXISTS 'CAMBIOS_SOLICITADOS' BEFORE 'PENDIENTE';
ALTER TYPE estado_orden_insumo ADD VALUE IF NOT EXISTS 'APROBADA'            BEFORE 'PENDIENTE';

-- ── Marcas del flujo en la cabecera ─────────────────────────────────────────
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS enviado_revision_at TIMESTAMPTZ;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS aprobado_por        UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS aprobado_at         TIMESTAMPTZ;

-- =============================================================================
-- TRAZABILIDAD (conversación + cambios de estado, de lado a lado)
-- =============================================================================
CREATE TABLE IF NOT EXISTS orden_insumo_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id        UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  tipo            VARCHAR(30) NOT NULL,   -- CREACION | ENVIO_REVISION | CAMBIOS_SOLICITADOS | AJUSTE | APROBACION | COMENTARIO | ALISTAMIENTO | DESPACHO | ANULACION
  mensaje         TEXT,
  estado_anterior estado_orden_insumo,
  estado_nuevo    estado_orden_insumo,
  detalle         JSONB,
  usuario_id      UUID,
  usuario_nombre  VARCHAR(200),
  usuario_email   VARCHAR(200),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oi_eventos_orden ON orden_insumo_eventos(orden_id, created_at);

ALTER TABLE orden_insumo_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oi_ev_read ON orden_insumo_eventos;
CREATE POLICY oi_ev_read ON orden_insumo_eventos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_ev_write ON orden_insumo_eventos;
CREATE POLICY oi_ev_write ON orden_insumo_eventos FOR INSERT TO authenticated WITH CHECK (true);

-- ── Helper: registra un evento capturando al usuario ────────────────────────
CREATE OR REPLACE FUNCTION public.oi_evento(
  p_orden UUID, p_tipo VARCHAR, p_mensaje TEXT DEFAULT NULL,
  p_ant estado_orden_insumo DEFAULT NULL, p_nue estado_orden_insumo DEFAULT NULL,
  p_detalle JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_nom VARCHAR(200); v_mail VARCHAR(200);
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NOT NULL THEN
    SELECT nombre, email INTO v_nom, v_mail FROM usuarios WHERE id = v_uid;
  END IF;
  INSERT INTO orden_insumo_eventos (orden_id, tipo, mensaje, estado_anterior, estado_nuevo, detalle, usuario_id, usuario_nombre, usuario_email)
  VALUES (p_orden, p_tipo, p_mensaje, p_ant, p_nue, p_detalle, v_uid, v_nom, v_mail);
END $$;
GRANT EXECUTE ON FUNCTION public.oi_evento(UUID, VARCHAR, TEXT, estado_orden_insumo, estado_orden_insumo, JSONB) TO authenticated;

-- =============================================================================
-- PERMISOS: aprobar (central) separado de crear (coordinador) y alistar (bodega)
-- =============================================================================
-- Central / administración: aprueban y piden cambios.
UPDATE public.roles
SET permisos = permisos || '{"aprobar_ordenes_insumo": true, "ver_alistamiento": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS')
   OR nombre IN ('Gerencia');

-- Bodega: ve y trabaja el módulo de alistamiento.
UPDATE public.roles
SET permisos = permisos || '{"ver_alistamiento": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR')
   OR nombre IN ('Gerencia','Coordinador');

-- Coordinador de sede: propone órdenes (ya tiene crear_ordenes_insumo).
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true}'::jsonb
WHERE nombre IN ('Coordinador','Supervisor de Conserjería')
   OR rol_base IN ('SUPERVISOR','OPERADOR_SEDE');
