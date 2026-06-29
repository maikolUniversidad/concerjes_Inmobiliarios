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

CREATE POLICY "fotos_select" ON public.producto_fotos FOR SELECT TO authenticated USING (true);
CREATE POLICY "fotos_insert" ON public.producto_fotos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fotos_update" ON public.producto_fotos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "fotos_delete" ON public.producto_fotos FOR DELETE TO authenticated USING (true);
