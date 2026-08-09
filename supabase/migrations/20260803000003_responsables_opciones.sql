-- =============================================================================
-- Vista responsables_opciones — nombre del/los responsable(s) por orden de insumo
-- =============================================================================
-- Igual que conductores_opciones: para mostrar en Alistamiento QUIÉN es
-- responsable de cada orden, hay que leer usuarios.nombre, pero la RLS de
-- `usuarios` (self_read_usuarios) solo deja al ADMIN leer nombres de otros. Una
-- vista con privilegios del dueño (security_invoker=false, por defecto) salta esa
-- RLS y expone SOLO (orden_id, usuario_id, nombre).
-- =============================================================================

CREATE OR REPLACE VIEW public.responsables_opciones AS
  SELECT r.orden_id, r.usuario_id, u.nombre
  FROM public.orden_insumo_responsables r
  JOIN public.usuarios u ON u.id = r.usuario_id;

GRANT SELECT ON public.responsables_opciones TO authenticated;
