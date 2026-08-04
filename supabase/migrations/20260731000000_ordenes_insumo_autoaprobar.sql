-- =============================================================================
-- Órdenes de insumo — autorización por supervisor desactivada (de momento)
--
-- Las órdenes nuevas nacen APROBADA (ver crearOrdenInsumo). Aquí liberamos las
-- que quedaron atrapadas en estados previos a la aprobación para que no se
-- traben esperando un visto bueno que ya no se pide.
-- =============================================================================

UPDATE public.ordenes_insumo
SET estado                   = 'APROBADA',
    aprobado_por             = COALESCE(aprobado_por, creado_por),
    aprobado_at              = COALESCE(aprobado_at, NOW()),
    aprobado_solicitante_por = COALESCE(aprobado_solicitante_por, creado_por),
    aprobado_solicitante_at  = COALESCE(aprobado_solicitante_at, NOW()),
    aprobado_coordinador_por = COALESCE(aprobado_coordinador_por, creado_por),
    aprobado_coordinador_at  = COALESCE(aprobado_coordinador_at, NOW())
WHERE estado IN ('BORRADOR', 'EN_REVISION', 'CAMBIOS_SOLICITADOS');
