-- =============================================================================
-- Dónde se usa cada destino del directorio de correos
--
-- El directorio muestra, en cada lista y en los centros médicos, qué flujos de
-- notificación les escriben. Quien administra el directorio no siempre puede
-- ver los flujos (otro permiso), así que esta función devuelve solo el nombre
-- del flujo, su evento y si está activo.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.directorio_usos()
RETURNS TABLE (destino TEXT, flujo TEXT, activo BOOLEAN, evento TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH pasos AS (
    SELECT p.destinatarios, f.nombre, (f.activo AND p.activo) AS activo, f.evento_codigo
      FROM flujo_pasos p JOIN flujos_notificacion f ON f.id = p.flujo_id
     WHERE p.tipo = 'EMAIL'
       AND public.auth_permiso_any(ARRAY['ver_directorio_correos', 'gestionar_directorio_correos',
                                         'ver_flujos_notificacion', 'gestionar_flujos_notificacion'])
  )
  SELECT DISTINCT 'lista:' || l.valor, pasos.nombre, pasos.activo, pasos.evento_codigo
    FROM pasos CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(pasos.destinatarios -> 'listas') = 'array' THEN pasos.destinatarios -> 'listas' ELSE '[]'::jsonb END
    ) AS l(valor)
  UNION
  SELECT DISTINCT 'entidad:' || e.valor, pasos.nombre, pasos.activo, pasos.evento_codigo
    FROM pasos CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(pasos.destinatarios -> 'entidades') = 'array' THEN pasos.destinatarios -> 'entidades' ELSE '[]'::jsonb END
    ) AS e(valor)
$fn$;
REVOKE ALL ON FUNCTION public.directorio_usos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directorio_usos() TO authenticated, service_role;
