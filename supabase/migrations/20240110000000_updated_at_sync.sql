-- =============================================================================
-- Offline-first (Fase 1) — updated_at uniforme para sincronización incremental
-- Agrega updated_at + trigger set_updated_at a las tablas sincronizables que no
-- lo tenían, para poder hacer PULL por marca de tiempo (watermark). Aditivo e
-- idempotente. No afecta la app web.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  -- Tablas editables que se sincronizan al dispositivo y NO tenían updated_at
  tablas TEXT[] := ARRAY[
    'proveedores', 'sedes', 'grupos_contrato', 'usuarios',
    'pedidos_sede', 'rotacion', 'oc_items', 'arqueo_items'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()', t);
      -- Backfill inicial: usa created_at si existe, si no NOW()
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_at') THEN
        EXECUTE format('UPDATE public.%I SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL', t);
      END IF;
      -- Trigger que mantiene updated_at en cada UPDATE
      EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END IF;
  END LOOP;
END $$;

-- Índices para acelerar el PULL incremental (updated_at)
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'productos','stock','proveedores','sedes','grupos_contrato','usuarios',
    'bodegas','ubicaciones','ordenes_compra','oc_items','aprovisionamiento',
    'rotacion','pedidos_sede','arqueos','arqueo_items','roles'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='updated_at') THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%1$s_updated ON public.%1$s(updated_at)', t);
    END IF;
  END LOOP;
END $$;
