-- =============================================================================
-- Conexión de logística: coordenadas de sedes + Realtime de rutas/paradas
-- -----------------------------------------------------------------------------
-- 1) Las sedes son los "puntos de entrega" del mapa. Añadimos dirección y
--    coordenadas (se llenan por geocodificación Nominatim + ajuste manual).
-- 2) Habilitamos Realtime para rutas_entrega y ruta_paradas, de modo que el
--    tablero administrativo y el mapa reflejen el avance de entregas al instante
--    (antes solo se sondeaba cada 25s).
-- =============================================================================

-- 1) Coordenadas y dirección de sedes ----------------------------------------
ALTER TABLE public.sedes ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE public.sedes ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
ALTER TABLE public.sedes ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);

COMMENT ON COLUMN public.sedes.direccion IS 'Dirección de entrega (usada para geocodificar y para el conductor).';
COMMENT ON COLUMN public.sedes.lat IS 'Latitud del punto de entrega (WGS84).';
COMMENT ON COLUMN public.sedes.lng IS 'Longitud del punto de entrega (WGS84).';

-- 2) Realtime para el avance de entregas -------------------------------------
-- ADD TABLE falla si la tabla ya es miembro de la publicación; lo hacemos
-- idempotente consultando pg_publication_tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rutas_entrega'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rutas_entrega;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ruta_paradas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ruta_paradas;
  END IF;
END $$;

-- Para que los payloads de Realtime incluyan la fila completa en UPDATE/DELETE.
ALTER TABLE public.rutas_entrega REPLICA IDENTITY FULL;
ALTER TABLE public.ruta_paradas  REPLICA IDENTITY FULL;
