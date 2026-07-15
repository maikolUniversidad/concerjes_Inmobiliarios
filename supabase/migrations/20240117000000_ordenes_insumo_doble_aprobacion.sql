-- =============================================================================
-- Órdenes de insumo — doble aprobación + recepción en sede
--
-- Flujo definitivo:
--   Borrador ─────► Aprobado ─────► Alistamiento ─────► Enviado ─────► Recibido
--   Supervisor      Solicitante +    Supervisor de       Despacho       Supervisor
--   de sede         Coordinador      bodega/bodegueros                  del contrato
--
-- "Enviado" es el estado DESPACHADO que ya existía (solo cambia la etiqueta).
-- "Recibido" es nuevo y cierra el proceso.
-- =============================================================================

-- Estado final del proceso ----------------------------------------------------
ALTER TYPE estado_orden_insumo ADD VALUE IF NOT EXISTS 'RECIBIDO' AFTER 'DESPACHADO';

-- Doble aprobación: la orden solo pasa a alistamiento con AMBOS vistos buenos.
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS aprobado_solicitante_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS aprobado_solicitante_at  TIMESTAMPTZ;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS aprobado_coordinador_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS aprobado_coordinador_at  TIMESTAMPTZ;

-- Recepción en sede: la confirma el supervisor del contrato (grupo de la sede).
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS recibido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS recibido_at  TIMESTAMPTZ;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS recibido_obs TEXT;

-- Backfill: lo ya aprobado con el esquema anterior queda con ambos vistos buenos
-- para no dejar órdenes en curso trabadas esperando una firma que nadie dio.
UPDATE ordenes_insumo
SET aprobado_coordinador_por = COALESCE(aprobado_coordinador_por, aprobado_por),
    aprobado_coordinador_at  = COALESCE(aprobado_coordinador_at,  aprobado_at),
    aprobado_solicitante_por = COALESCE(aprobado_solicitante_por, creado_por),
    aprobado_solicitante_at  = COALESCE(aprobado_solicitante_at,  aprobado_at)
WHERE aprobado_at IS NOT NULL
  AND (aprobado_coordinador_at IS NULL OR aprobado_solicitante_at IS NULL);

-- ── Permiso de recepción ─────────────────────────────────────────────────────
-- El supervisor del contrato recibe; la central también puede cerrar el proceso.
UPDATE public.roles
SET permisos = permisos || '{"recibir_ordenes_insumo": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS')
   OR nombre IN ('Gerencia','Coordinador','Supervisor de Conserjería');

-- ── ¿El usuario pertenece al grupo de contrato de la sede de la orden? ────────
-- Se usa para que solo el supervisor de ESE contrato pueda dar el recibido.
-- Los usuarios sin grupo asignado (central/admin) no quedan restringidos.
CREATE OR REPLACE FUNCTION public.oi_es_del_grupo(p_orden UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grupo_orden   UUID;
  v_grupo_usuario UUID;
BEGIN
  SELECT s.grupo_id INTO v_grupo_orden
  FROM ordenes_insumo o JOIN sedes s ON s.id = o.sede_id
  WHERE o.id = p_orden;

  SELECT u.grupo_id INTO v_grupo_usuario
  FROM usuarios u WHERE u.id = auth.uid();

  -- Sin grupo asignado = central, no se restringe por contrato.
  IF v_grupo_usuario IS NULL THEN RETURN TRUE; END IF;

  RETURN v_grupo_usuario = v_grupo_orden;
END;
$$;

GRANT EXECUTE ON FUNCTION public.oi_es_del_grupo(UUID) TO authenticated;
