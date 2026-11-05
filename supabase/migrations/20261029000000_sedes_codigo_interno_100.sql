-- ════════════════════════════════════════════════════════════════════════════
-- Sedes: "N° contrato" (sedes.codigo_interno) admite hasta 100 caracteres
--
-- Era VARCHAR(20) y crear una sede con un número de contrato largo
-- ("70 PROSPERIDAD SOCIAL LETICIA", 29 caracteres) fallaba con
-- "value too long for type character varying(20)". Los 77 valores existentes
-- miden 15 o menos, así que ampliar no toca ningún dato. 100 es el mismo tope de
-- zona y ciudad. Ninguna vista ni índice depende de la columna.
--
-- Idempotente: si ya es de 100 o más, no hace nada.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sedes' AND column_name = 'codigo_interno') < 100 THEN
    ALTER TABLE public.sedes ALTER COLUMN codigo_interno TYPE VARCHAR(100);
  END IF;
END $$;

COMMENT ON COLUMN public.sedes.codigo_interno IS
  'N° de contrato de la sede (texto libre, hasta 100 caracteres).';

NOTIFY pgrst, 'reload schema';
