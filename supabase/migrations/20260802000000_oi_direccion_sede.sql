-- =============================================================================
-- Dirección de despacho de la sede — escritura para el flujo de remisiones
--
-- La dirección de entrega vive en sedes.direccion, pero write_sedes solo permite
-- ADMIN/SUPER_ADMIN. Para que quien despacha (bodega) pueda registrarla cuando
-- la sede aún no la tiene, se expone una función SECURITY DEFINER acotada a ese
-- único campo. El permiso de la app se valida en el server action.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.oi_set_direccion_sede(p_sede UUID, p_direccion TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  UPDATE public.sedes
  SET direccion = NULLIF(btrim(p_direccion), '')
  WHERE id = p_sede;
END;
$$;

GRANT EXECUTE ON FUNCTION public.oi_set_direccion_sede(UUID, TEXT) TO authenticated;
