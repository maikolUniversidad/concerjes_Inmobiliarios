-- ════════════════════════════════════════════════════════════════════════════
-- Órdenes de despacho PENDIENTES
--
-- Al despachar solo sale lo chuleado (alistado). Lo que no se chuleó —y lo que
-- se alistó con menos de lo solicitado— ya no se pierde: se genera una orden de
-- despacho independiente (con su propia remisión) que apunta a la orden de la
-- que viene.
--
--   ordenes_insumo.orden_origen_id        → la orden que la originó (NULL = orden normal)
--   orden_insumo_items.cantidad_a_pendiente → unidades de ese ítem que se pasaron
--                                             a la orden pendiente (así "Envío
--                                             restante" no las vuelve a ofrecer)
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ordenes_insumo
  ADD COLUMN IF NOT EXISTS orden_origen_id UUID REFERENCES public.ordenes_insumo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ordenes_insumo_origen
  ON public.ordenes_insumo (orden_origen_id) WHERE orden_origen_id IS NOT NULL;

COMMENT ON COLUMN public.ordenes_insumo.orden_origen_id IS
  'Orden de la que viene esta orden pendiente (lo que no salió en su despacho). NULL en órdenes normales.';

ALTER TABLE public.orden_insumo_items
  ADD COLUMN IF NOT EXISTS cantidad_a_pendiente DECIMAL(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orden_insumo_items.cantidad_a_pendiente IS
  'Unidades de este ítem que se trasladaron a la orden pendiente al despachar.';

-- Que la API vea las columnas y la relación nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
