-- ════════════════════════════════════════════════════════════════════════════
-- Movimientos: número de referencia consecutivo propio
--
-- El movimiento no tenía identificador visible: la columna REF de la pantalla
-- mostraba el código del PRODUCTO y salía vacía cuando el producto no tenía.
-- Ahora cada movimiento lleva `numero`, con el estilo de las órdenes de insumo:
--
--   MOV-AAAAMM-0001   (consecutivo por mes, hora de Bogotá)
--
--   · Históricos: se numeran por created_at (y id para desempatar).
--   · Nuevos: los asigna el trigger, tomando el consecutivo de
--     `movimientos_consecutivos` con un UPSERT atómico. Así dos inserciones
--     simultáneas no se pisan y no hay que tocar registrar_movimiento,
--     registrar_entrada ni ninguna otra función que inserte movimientos.
--   · Un movimiento eliminado deja su número sin usar: el contador solo sube.
--
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- Sin escrituras concurrentes mientras se numera lo existente.
LOCK TABLE public.movimientos IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.movimientos ADD COLUMN IF NOT EXISTS numero VARCHAR(20);

COMMENT ON COLUMN public.movimientos.numero IS
  'Referencia consecutiva del movimiento: MOV-AAAAMM-0001 (por mes, hora de Bogotá).';

-- Solo lo usa el trigger (SECURITY DEFINER): con RLS y sin políticas, nadie más.
CREATE TABLE IF NOT EXISTS public.movimientos_consecutivos (
  periodo CHAR(6) PRIMARY KEY,
  ultimo  INTEGER NOT NULL
);
ALTER TABLE public.movimientos_consecutivos ENABLE ROW LEVEL SECURITY;

-- El contador arranca en lo ya asignado (repetir la migración no reinicia nada).
INSERT INTO public.movimientos_consecutivos (periodo, ultimo)
SELECT substring(numero FROM 5 FOR 6), max(substring(numero FROM 12)::INTEGER)
FROM public.movimientos
WHERE numero IS NOT NULL
GROUP BY 1
ON CONFLICT (periodo) DO UPDATE SET ultimo = GREATEST(public.movimientos_consecutivos.ultimo, EXCLUDED.ultimo);

-- Históricos, en el orden en que se hicieron.
WITH orden AS (
  SELECT id,
         to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYYMM') AS periodo,
         row_number() OVER (
           PARTITION BY to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYYMM')
           ORDER BY created_at, id
         ) AS n
  FROM public.movimientos
  WHERE numero IS NULL
)
UPDATE public.movimientos m
SET numero = 'MOV-' || o.periodo || '-' || lpad((COALESCE(c.ultimo, 0) + o.n)::TEXT, 4, '0')
FROM orden o
LEFT JOIN public.movimientos_consecutivos c ON c.periodo = o.periodo
WHERE m.id = o.id;

INSERT INTO public.movimientos_consecutivos (periodo, ultimo)
SELECT substring(numero FROM 5 FOR 6), max(substring(numero FROM 12)::INTEGER)
FROM public.movimientos
GROUP BY 1
ON CONFLICT (periodo) DO UPDATE SET ultimo = GREATEST(public.movimientos_consecutivos.ultimo, EXCLUDED.ultimo);

CREATE OR REPLACE FUNCTION public.tr_movimientos_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_periodo CHAR(6);
  v_n       INTEGER;
BEGIN
  IF NEW.numero IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_periodo := to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'America/Bogota', 'YYYYMM');

  INSERT INTO movimientos_consecutivos (periodo, ultimo) VALUES (v_periodo, 1)
  ON CONFLICT (periodo) DO UPDATE SET ultimo = movimientos_consecutivos.ultimo + 1
  RETURNING ultimo INTO v_n;

  -- GREATEST: lpad RECORTA si el texto es más largo que el ancho pedido.
  NEW.numero := 'MOV-' || v_periodo || '-' || lpad(v_n::TEXT, GREATEST(4, length(v_n::TEXT)), '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_movimientos_numero ON public.movimientos;
CREATE TRIGGER tr_movimientos_numero
  BEFORE INSERT ON public.movimientos
  FOR EACH ROW EXECUTE FUNCTION public.tr_movimientos_numero();

ALTER TABLE public.movimientos ALTER COLUMN numero SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_numero ON public.movimientos (numero);

NOTIFY pgrst, 'reload schema';
