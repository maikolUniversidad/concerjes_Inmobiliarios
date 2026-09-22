-- =============================================================================
-- ATS · Correcciones encontradas con la prueba de punta a punta
-- =============================================================================
-- `vac_contrato_defaults` sumaba un interval a la fecha de inicio (queda
-- timestamp) y luego le restaba un entero: "operator does not exist:
-- timestamp without time zone - integer". Ningún contrato se podía guardar.
-- date + integer sí es date, que es lo que se quiere.
-- =============================================================================

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.vac_contrato_defaults()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.fecha_fin_periodo_prueba IS NULL AND NEW.fecha_inicio_labores IS NOT NULL AND COALESCE(NEW.periodo_prueba_dias, 60) > 0 THEN
    NEW.fecha_fin_periodo_prueba := NEW.fecha_inicio_labores + (COALESCE(NEW.periodo_prueba_dias, 60) - 1);
  END IF;
  NEW.fecha_afil_eps       := COALESCE(NEW.fecha_afil_eps, NEW.fecha_inicio_labores);
  NEW.fecha_afil_afp       := COALESCE(NEW.fecha_afil_afp, NEW.fecha_inicio_labores);
  NEW.fecha_afil_cesantias := COALESCE(NEW.fecha_afil_cesantias, NEW.fecha_inicio_labores);
  NEW.fecha_afil_ccf       := COALESCE(NEW.fecha_afil_ccf, NEW.fecha_inicio_labores);
  NEW.fecha_afil_arl       := COALESCE(NEW.fecha_afil_arl, NEW.fecha_inicio_labores);
  RETURN NEW;
END $fn$;
